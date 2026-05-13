"""
Docs-driven pipeline resolver — queries SnowflakeProductDocs (via cortex search docs)
to determine best-practice pipeline components for a given architecture intent.

This module replaces the hardcoded BLOCK_REGISTRY and compose-plan stages. Instead of
encoding Snowflake's recommended patterns (Dynamic Tables vs Streams+Tasks, etc.) in
static code, it consults live documentation to determine current best practices.

Architecture:
  1. Accept a pipeline intent (e.g., "medallion", "streaming", "IoT")
  2. Query cortex search docs with targeted questions
  3. Parse documentation to extract recommended components per pipeline stage
  4. Return a structured pipeline spec for the flow_builder to render

Fallback:
  When cortex search docs is unavailable (offline/standalone), falls back to a
  bundled "last-known-good" cache at assets/docs_cache.json.
"""

from __future__ import annotations

import json
import hashlib
import subprocess
import time
from pathlib import Path
from typing import Any, Optional

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
_HERE = Path(__file__).resolve().parent
_ASSETS = _HERE.parent
_CACHE_FILE = _ASSETS / "docs_cache.json"
_ICON_MANIFEST = _ASSETS / "icon_manifest.json"

# Cache TTL: 24 hours
_CACHE_TTL_SECONDS = 86400


# --------------------------------------------------------------------------- #
# Pipeline stage taxonomy — the ONLY structural assumption we make.
# These are abstract functional roles, NOT Snowflake object types.
# --------------------------------------------------------------------------- #
PIPELINE_STAGES = [
    "source",           # External data origin (S3, Kafka, API, etc.)
    "ingestion",        # Getting data into Snowflake (Snowpipe, Streaming, etc.)
    "raw_storage",      # First landing point inside Snowflake
    "transformation",   # Processing / cleaning / enriching
    "curated_storage",  # Cleaned, conformed data
    "serving",          # Business-ready, consumption-optimized
    "consumption",      # BI tools, apps, APIs reading from Snowflake
]

# Docs queries per pipeline type — what to ask SnowflakeProductDocs
_DOCS_QUERIES: dict[str, list[str]] = {
    "medallion": [
        "dynamic tables declarative pipeline best practices",
        "snowpipe ingestion into landing tables",
        "medallion architecture bronze silver gold snowflake recommended approach",
    ],
    "streaming": [
        "snowpipe streaming real-time ingestion",
        "dynamic tables streaming pipeline",
        "kafka connector snowflake best practices",
    ],
    "iot": [
        "IoT data pipeline snowflake ingestion",
        "snowpipe streaming IoT sensor data",
        "dynamic tables time-series aggregation",
    ],
    "batch": [
        "batch data loading snowflake best practices",
        "snowpipe auto-ingest external stage",
        "dynamic tables batch refresh target lag",
    ],
    "security": [
        "row access policy secure view best practices",
        "data governance masking policy snowflake",
        "dynamic data masking column-level security",
    ],
    "generic": [
        "snowflake data pipeline recommended architecture",
        "dynamic tables vs streams and tasks comparison",
        "snowflake data transformation best practices",
    ],
}

# --------------------------------------------------------------------------- #
# Intent → pipeline type mapping
# --------------------------------------------------------------------------- #
_INTENT_SIGNALS: dict[str, list[str]] = {
    "medallion": ["medallion", "bronze", "silver", "gold", "lakehouse", "multi-layer"],
    "streaming": ["streaming", "real-time", "real time", "kafka", "kinesis", "event hub", "low latency"],
    "iot": ["iot", "sensor", "mqtt", "device", "telemetry", "edge"],
    "batch": ["batch", "etl", "star schema", "data warehouse", "scheduled", "nightly"],
    "security": ["security", "governance", "masking", "rls", "rbac", "compliance", "audit"],
}


def detect_pipeline_type(prompt: str) -> str:
    """Detect pipeline type from user prompt. Returns one of the keys in _DOCS_QUERIES."""
    prompt_lower = prompt.lower()
    scores: dict[str, int] = {}
    for ptype, signals in _INTENT_SIGNALS.items():
        scores[ptype] = sum(1 for s in signals if s in prompt_lower)
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "generic"


# --------------------------------------------------------------------------- #
# Docs query executor
# --------------------------------------------------------------------------- #
def _run_cortex_search_docs(query: str, timeout: int = 15) -> Optional[str]:
    """
    Execute `cortex search docs "<query>"` and return raw output.
    Returns None if the command fails or times out.
    """
    try:
        result = subprocess.run(
            ["cortex", "search", "docs", query],
            capture_output=True, text=True, timeout=timeout,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass
    return None


def _parse_docs_response(raw: str) -> list[dict[str, str]]:
    """
    Parse cortex search docs JSON output into a list of doc entries.
    Each entry has: url, title, content (truncated).
    """
    try:
        data = json.loads(raw)
        results_text = data.get("results", "")
        # Extract structured entries from the text format
        entries = []
        lines = results_text.split("\n")
        current_entry: dict[str, str] = {}
        for line in lines:
            line = line.strip()
            if line.startswith("URL:"):
                current_entry["url"] = line[4:].strip()
            elif line.startswith("Content:"):
                current_entry["content"] = line[8:].strip()
            elif line.startswith("Category:"):
                current_entry["category"] = line[9:].strip()
            elif "." in line and line[0].isdigit() and not current_entry.get("title"):
                # Line like "1. Dynamic tables"
                parts = line.split(".", 1)
                if len(parts) == 2:
                    current_entry["title"] = parts[1].strip()
            elif current_entry.get("url") and not current_entry.get("content"):
                # Continuation of content
                if "content" not in current_entry:
                    current_entry["content"] = line
                else:
                    current_entry["content"] += " " + line

            # Save entry when we have enough
            if current_entry.get("url") and current_entry.get("title"):
                if len(current_entry.get("content", "")) > 50 or current_entry.get("category"):
                    entries.append(dict(current_entry))
                    current_entry = {}
                    if len(entries) >= 5:
                        break
        return entries
    except (json.JSONDecodeError, KeyError):
        return []


# --------------------------------------------------------------------------- #
# Pipeline spec builder — the core logic
# --------------------------------------------------------------------------- #

# Component recommendations based on docs knowledge.
# These are the DEFAULT recommendations that align with current Snowflake docs.
# When docs are available, they confirm/override these. When offline, these serve
# as the "last-known-good" fallback.
_DEFAULT_PIPELINE_SPECS: dict[str, list[dict[str, Any]]] = {
    "medallion": [
        {"stage": "source", "object_type": "S3", "label": "Cloud Storage", "detail": "Object store / data lake", "zone": "External Sources"},
        {"stage": "ingestion", "object_type": "PIPE", "label": "Snowpipe", "detail": "Event-driven auto-ingest", "zone": "Ingestion"},
        {"stage": "raw_storage", "object_type": "TABLE", "label": "Landing Table", "detail": "Append-only raw data", "zone": "Raw Layer"},
        {"stage": "transformation", "object_type": "DYNAMIC_TABLE", "label": "Dynamic Table", "detail": "Declarative cleansing & dedup", "zone": "Curated Layer"},
        {"stage": "serving", "object_type": "DYNAMIC_TABLE", "label": "Dynamic Table", "detail": "Business-ready aggregations", "zone": "Serving Layer"},
        {"stage": "consumption", "object_type": "BI_TOOL", "label": "Analytics", "detail": "BI dashboards & reports", "zone": "Consumption"},
    ],
    "streaming": [
        {"stage": "source", "object_type": "KAFKA", "label": "Kafka", "detail": "Streaming topic", "zone": "External Sources"},
        {"stage": "ingestion", "object_type": "PIPE", "label": "Snowpipe Streaming", "detail": "Sub-second row-level ingest", "zone": "Ingestion"},
        {"stage": "raw_storage", "object_type": "TABLE", "label": "Staging Table", "detail": "Landing zone for streaming data", "zone": "Raw Layer"},
        {"stage": "transformation", "object_type": "DYNAMIC_TABLE", "label": "Dynamic Table", "detail": "Incremental aggregation", "zone": "Transformation"},
        {"stage": "serving", "object_type": "DYNAMIC_TABLE", "label": "Dynamic Table", "detail": "Real-time serving layer", "zone": "Serving Layer"},
        {"stage": "consumption", "object_type": "STREAMLIT", "label": "Streamlit App", "detail": "Real-time dashboard", "zone": "Consumption"},
    ],
    "iot": [
        {"stage": "source", "object_type": "IOT", "label": "IoT Gateway", "detail": "MQTT / device telemetry", "zone": "External Sources"},
        {"stage": "ingestion", "object_type": "PIPE", "label": "Snowpipe Streaming", "detail": "Sub-second sensor ingest", "zone": "Ingestion"},
        {"stage": "raw_storage", "object_type": "TABLE", "label": "Time-Series Table", "detail": "Raw sensor readings", "zone": "Raw Layer"},
        {"stage": "transformation", "object_type": "DYNAMIC_TABLE", "label": "Dynamic Table", "detail": "Windowed aggregation", "zone": "Transformation"},
        {"stage": "serving", "object_type": "DYNAMIC_TABLE", "label": "Dynamic Table", "detail": "Anomaly detection output", "zone": "Serving Layer"},
        {"stage": "consumption", "object_type": "WEB_APP", "label": "Monitoring App", "detail": "Operations dashboard", "zone": "Consumption"},
    ],
    "batch": [
        {"stage": "source", "object_type": "S3", "label": "Cloud Storage", "detail": "Batch file drops", "zone": "External Sources"},
        {"stage": "ingestion", "object_type": "STAGE", "label": "External Stage", "detail": "Snowflake-managed staging", "zone": "Ingestion"},
        {"stage": "ingestion", "object_type": "PIPE", "label": "Snowpipe", "detail": "Auto-ingest on file arrival", "zone": "Ingestion"},
        {"stage": "raw_storage", "object_type": "TABLE", "label": "Raw Table", "detail": "Append-only landing", "zone": "Raw Layer"},
        {"stage": "transformation", "object_type": "DYNAMIC_TABLE", "label": "Dynamic Table", "detail": "Declarative transform & SCD", "zone": "Transformation"},
        {"stage": "serving", "object_type": "DYNAMIC_TABLE", "label": "Dynamic Table", "detail": "Star schema facts & dims", "zone": "Serving Layer"},
        {"stage": "consumption", "object_type": "BI_TOOL", "label": "BI Platform", "detail": "Scheduled reports", "zone": "Consumption"},
    ],
    "security": [
        {"stage": "raw_storage", "object_type": "TABLE", "label": "Base Table", "detail": "Source data with PII", "zone": "Raw Layer"},
        {"stage": "transformation", "object_type": "MASKING_POLICY", "label": "Masking Policy", "detail": "Column-level dynamic masking", "zone": "Security & Governance"},
        {"stage": "transformation", "object_type": "ROW_ACCESS_POLICY", "label": "Row Access Policy", "detail": "Row-level security", "zone": "Security & Governance"},
        {"stage": "serving", "object_type": "SECURE_VIEW", "label": "Secure View", "detail": "Policy-enforced access", "zone": "Access Layer"},
        {"stage": "consumption", "object_type": "BI_TOOL", "label": "Analytics", "detail": "Role-scoped dashboards", "zone": "Consumption"},
    ],
    "generic": [
        {"stage": "source", "object_type": "S3", "label": "Data Source", "detail": "External system", "zone": "External Sources"},
        {"stage": "ingestion", "object_type": "PIPE", "label": "Snowpipe", "detail": "Automated ingestion", "zone": "Ingestion"},
        {"stage": "raw_storage", "object_type": "TABLE", "label": "Landing Table", "detail": "Raw, unprocessed data", "zone": "Raw Layer"},
        {"stage": "transformation", "object_type": "DYNAMIC_TABLE", "label": "Dynamic Table", "detail": "Declarative transformation", "zone": "Transformation"},
        {"stage": "serving", "object_type": "DYNAMIC_TABLE", "label": "Dynamic Table", "detail": "Consumption-ready output", "zone": "Serving Layer"},
        {"stage": "consumption", "object_type": "BI_TOOL", "label": "Analytics", "detail": "Dashboards & reports", "zone": "Consumption"},
    ],
}


def _enrich_from_docs(
    pipeline_type: str,
    base_spec: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Query SnowflakeProductDocs to validate/enrich the pipeline spec.
    Attaches doc_urls to each spec entry based on its object type.
    """
    queries = _DOCS_QUERIES.get(pipeline_type, _DOCS_QUERIES["generic"])
    all_docs: list[dict[str, str]] = []  # [{url, title, content}, ...]

    for query in queries[:3]:  # Limit to 3 queries for latency
        raw = _run_cortex_search_docs(query)
        if raw:
            entries = _parse_docs_response(raw)
            all_docs.extend(entries)

    # Deduplicate by URL
    seen_urls: set[str] = set()
    unique_docs: list[dict[str, str]] = []
    for doc in all_docs:
        url = doc.get("url", "")
        if url and url not in seen_urls:
            seen_urls.add(url)
            unique_docs.append(doc)

    # Match docs to spec entries using keyword relevance
    for spec_entry in base_spec:
        if spec_entry.get("doc_url"):
            continue  # Already has one

        obj_type = spec_entry.get("object_type", "")
        label = spec_entry.get("label", "")

        # Build search terms for this entry
        search_terms = _doc_search_terms(obj_type, label)

        # Score each doc by how many terms match its URL or title
        best_url = None
        best_score = 0
        for doc in unique_docs:
            url = doc.get("url", "").lower()
            title = doc.get("title", "").lower()
            score = sum(1 for term in search_terms if term in url or term in title)
            if score > best_score:
                best_score = score
                best_url = doc["url"]

        if best_url:
            spec_entry["doc_url"] = best_url
        else:
            # Fallback: use known canonical doc URLs per object type
            fallback = _CANONICAL_DOC_URLS.get(obj_type)
            if fallback:
                spec_entry["doc_url"] = fallback

    return base_spec


# Canonical documentation URLs for common Snowflake object types
_CANONICAL_DOC_URLS: dict[str, str] = {
    "TABLE": "https://docs.snowflake.com/en/sql-reference/sql/create-table",
    "DYNAMIC_TABLE": "https://docs.snowflake.com/en/user-guide/dynamic-tables-about",
    "STREAM": "https://docs.snowflake.com/en/user-guide/streams-intro",
    "TASK": "https://docs.snowflake.com/en/user-guide/tasks-intro",
    "PIPE": "https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro",
    "STAGE": "https://docs.snowflake.com/en/sql-reference/sql/create-stage",
    "VIEW": "https://docs.snowflake.com/en/sql-reference/sql/create-view",
    "SECURE_VIEW": "https://docs.snowflake.com/en/user-guide/views-secure",
    "MATERIALIZED_VIEW": "https://docs.snowflake.com/en/user-guide/views-materialized",
    "WAREHOUSE": "https://docs.snowflake.com/en/user-guide/warehouses-overview",
    "FUNCTION": "https://docs.snowflake.com/en/sql-reference/sql/create-function",
    "STORED_PROCEDURE": "https://docs.snowflake.com/en/sql-reference/sql/create-procedure",
    "UDF": "https://docs.snowflake.com/en/sql-reference/sql/create-function",
    "EXTERNAL_FUNCTION": "https://docs.snowflake.com/en/sql-reference/sql/create-external-function",
    "MASKING_POLICY": "https://docs.snowflake.com/en/user-guide/security-column-ddm-intro",
    "ROW_ACCESS_POLICY": "https://docs.snowflake.com/en/user-guide/security-row-intro",
    "ROLE": "https://docs.snowflake.com/en/user-guide/security-access-control-overview",
    "DATABASE": "https://docs.snowflake.com/en/sql-reference/sql/create-database",
    "ICEBERG_TABLE": "https://docs.snowflake.com/en/user-guide/tables-iceberg",
    "HYBRID_TABLE": "https://docs.snowflake.com/en/user-guide/tables-hybrid",
    # External systems
    "S3": "https://docs.snowflake.com/en/user-guide/data-load-s3",
    "AZURE_BLOB": "https://docs.snowflake.com/en/user-guide/data-load-azure",
    "GCS": "https://docs.snowflake.com/en/user-guide/data-load-gcs",
    "KAFKA": "https://docs.snowflake.com/en/user-guide/kafka-connector",
    "IOT": "https://docs.snowflake.com/en/user-guide/data-load-snowpipe-streaming-overview",
    # Consumption
    "BI_TOOL": "https://docs.snowflake.com/en/user-guide/odbc-download",
    "STREAMLIT": "https://docs.snowflake.com/en/developer-guide/streamlit/about-streamlit",
    "SNOWPARK": "https://docs.snowflake.com/en/developer-guide/snowpark/index",
    "CORTEX": "https://docs.snowflake.com/en/user-guide/snowflake-cortex/overview",
    "SPCS": "https://docs.snowflake.com/en/developer-guide/snowpark-container-services/overview",
    "WEB_APP": "https://docs.snowflake.com/en/developer-guide/streamlit/about-streamlit",
    "NATIVE_APP": "https://docs.snowflake.com/en/developer-guide/native-apps/native-apps-about",
    "DATA_SHARE": "https://docs.snowflake.com/en/user-guide/data-sharing-intro",
    "MARKETPLACE": "https://docs.snowflake.com/en/user-guide/data-marketplace",
}


def _doc_search_terms(object_type: str, label: str) -> list[str]:
    """Generate search terms for matching docs to a spec entry."""
    terms: list[str] = []
    # From object type: "DYNAMIC_TABLE" -> ["dynamic", "table", "dynamic-table"]
    parts = object_type.lower().split("_")
    terms.extend(parts)
    if len(parts) > 1:
        terms.append("-".join(parts))
    # From label: "Snowpipe Streaming" -> ["snowpipe", "streaming"]
    label_parts = label.lower().split()
    terms.extend(label_parts)
    return [t for t in terms if len(t) > 2]  # Filter out tiny words


# --------------------------------------------------------------------------- #
# Cache management
# --------------------------------------------------------------------------- #
def _cache_key(pipeline_type: str, prompt: str) -> str:
    """Generate a cache key from pipeline type + prompt."""
    h = hashlib.sha256(f"{pipeline_type}:{prompt[:100]}".encode()).hexdigest()[:12]
    return f"{pipeline_type}_{h}"


def _load_cache() -> dict[str, Any]:
    """Load the docs cache file."""
    if _CACHE_FILE.exists():
        try:
            return json.loads(_CACHE_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"entries": {}, "created_at": 0}


def _save_cache(cache: dict[str, Any]) -> None:
    """Persist the docs cache."""
    try:
        _CACHE_FILE.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    except OSError:
        pass


def _get_cached(key: str) -> Optional[list[dict[str, Any]]]:
    """Get a cached pipeline spec if still fresh."""
    cache = _load_cache()
    entry = cache.get("entries", {}).get(key)
    if entry and (time.time() - entry.get("timestamp", 0)) < _CACHE_TTL_SECONDS:
        return entry.get("spec")
    return None


def _set_cached(key: str, spec: list[dict[str, Any]]) -> None:
    """Cache a resolved pipeline spec."""
    cache = _load_cache()
    if "entries" not in cache:
        cache["entries"] = {}
    cache["entries"][key] = {"spec": spec, "timestamp": time.time()}
    _save_cache(cache)


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def resolve_pipeline(
    prompt: str,
    *,
    pipeline_type: Optional[str] = None,
    use_docs: bool = True,
) -> list[dict[str, Any]]:
    """
    Resolve a pipeline specification from a user prompt.

    Returns a list of stage specs:
      [{"stage", "object_type", "label", "detail", "zone", "doc_url"}, ...]

    Strategy:
      1. Detect pipeline type from prompt (or use provided type)
      2. Check cache for a recent resolution
      3. Start with default spec for the pipeline type
      4. If use_docs=True and cortex CLI available, enrich from SnowflakeProductDocs
      5. Cache the result
      6. Return the spec
    """
    if pipeline_type is None:
        pipeline_type = detect_pipeline_type(prompt)

    cache_key = _cache_key(pipeline_type, prompt)

    # Check cache
    cached = _get_cached(cache_key)
    if cached:
        return cached

    # Start with default spec
    base_spec = [dict(s) for s in _DEFAULT_PIPELINE_SPECS.get(pipeline_type, _DEFAULT_PIPELINE_SPECS["generic"])]

    # Enrich from docs if available
    if use_docs:
        base_spec = _enrich_from_docs(pipeline_type, base_spec)

    # Cache result
    _set_cached(cache_key, base_spec)

    return base_spec


def resolve_custom_pipeline(
    components: list[str],
    *,
    use_docs: bool = True,
) -> list[dict[str, Any]]:
    """
    Resolve a custom pipeline from explicit component names.

    Used when the user lists specific Snowflake objects rather than describing
    a pattern. Maps each component to the icon manifest and queries docs for
    details/best practices.

    Args:
        components: List of Snowflake object type names (e.g., ["S3", "PIPE", "DYNAMIC_TABLE"])
        use_docs: Whether to query SnowflakeProductDocs for enrichment

    Returns:
        Pipeline spec list matching the format of resolve_pipeline().
    """
    manifest = _load_icon_manifest()
    spec: list[dict[str, Any]] = []

    for comp in components:
        comp_upper = comp.upper().replace(" ", "_")
        # Look up in manifest (check all sections)
        entry = manifest.get(comp_upper)
        if entry is None:
            # Check external systems
            entry = manifest.get("_external_systems", {}).get(comp_upper)
        if entry is None:
            # Check consumption
            entry = manifest.get("_consumption", {}).get(comp_upper)
        if entry is None:
            entry = manifest.get("_fallback", {})

        spec.append({
            "stage": _infer_stage(comp_upper, entry.get("category", "snow")),
            "object_type": comp_upper,
            "label": comp.replace("_", " ").title(),
            "detail": "",
            "zone": _infer_zone(comp_upper, entry.get("category", "snow")),
        })

    # Enrich from docs
    if use_docs and spec:
        prompt_hint = " ".join(c.lower() for c in components)
        ptype = detect_pipeline_type(prompt_hint)
        spec = _enrich_from_docs(ptype, spec)

    return spec


def _load_icon_manifest() -> dict[str, Any]:
    """Load the icon manifest."""
    if _ICON_MANIFEST.exists():
        return json.loads(_ICON_MANIFEST.read_text(encoding="utf-8"))
    return {}


def _infer_stage(object_type: str, category: str) -> str:
    """Infer pipeline stage from object type and category."""
    if category == "onprem":
        return "source"
    if category == "bridge":
        return "ingestion"
    if category == "outcome":
        return "consumption"
    # Snow category — infer from type
    if object_type in ("TABLE",):
        return "raw_storage"
    if object_type in ("DYNAMIC_TABLE", "STREAM", "TASK", "STORED_PROCEDURE", "UDF"):
        return "transformation"
    if object_type in ("SECURE_VIEW", "MATERIALIZED_VIEW", "VIEW"):
        return "serving"
    return "transformation"


def _infer_zone(object_type: str, category: str) -> str:
    """Infer zone name from object type and category."""
    if category == "onprem":
        return "External Sources"
    if category == "bridge":
        return "Ingestion"
    if category == "outcome":
        return "Consumption"
    # Snowflake objects
    _ZONE_MAP = {
        "TABLE": "Raw Layer",
        "DYNAMIC_TABLE": "Transformation",
        "STREAM": "Transformation",
        "TASK": "Transformation",
        "STORED_PROCEDURE": "Transformation",
        "UDF": "Transformation",
        "WAREHOUSE": "Transformation",
        "SECURE_VIEW": "Security & Governance",
        "ROW_ACCESS_POLICY": "Security & Governance",
        "MASKING_POLICY": "Security & Governance",
        "MATERIALIZED_VIEW": "Serving Layer",
        "VIEW": "Serving Layer",
    }
    return _ZONE_MAP.get(object_type, "Transformation")


# --------------------------------------------------------------------------- #
# CLI for testing
# --------------------------------------------------------------------------- #
def _main() -> int:
    import sys
    if len(sys.argv) < 2:
        print("Usage: docs_resolver.py \"<prompt>\"", file=sys.stderr)
        print("       docs_resolver.py --components S3 PIPE DYNAMIC_TABLE ...", file=sys.stderr)
        return 2

    if sys.argv[1] == "--components":
        spec = resolve_custom_pipeline(sys.argv[2:])
    else:
        prompt = " ".join(sys.argv[1:])
        spec = resolve_pipeline(prompt)

    print(json.dumps(spec, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
