"""
Intent router — decides between picking a canned template vs composing
from individual blocks based on a user's natural-language prompt.

Why this exists:
    The standalone sub-skill's keyword table maps single keywords to
    single templates. Real prompts often mention multiple sources
    ("S3 and Kafka", "Snowpipe and Iceberg") that no single canned
    template covers cleanly. This router detects multi-source prompts
    and falls into compose-from-blocks mode using the synonyms +
    component_blocks snapshots; otherwise it returns the best-fit
    template id.

API:
    route(prompt, *, snapshots_dir=None) -> RouterDecision

A RouterDecision is one of:
    {"type": "template", "template_id": str, "confidence": float, "rationale": str}
    {"type": "compose",  "block_ids": list[str], "confidence": float,
                          "rationale": str, "covered_terms": list[str]}

Usage:
    from intent_router import route
    decision = route("medallion architecture with S3 and Kafka")
    if decision["type"] == "template":
        ...load assets/templates/<template_id>.json...
    else:
        ...feed decision["block_ids"] to composer.compose()...

CLI:
    python3 intent_router.py "medallion architecture with S3 and Kafka"
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

# --------------------------------------------------------------------------- #
# Defaults — resolve to the snapshot bundled with the skill
# --------------------------------------------------------------------------- #
_HERE = Path(__file__).resolve().parent
_ASSETS = _HERE.parent  # composer/ -> assets/

DEFAULT_BLOCKS_PATH = _ASSETS / "component_blocks.json"
DEFAULT_SYNONYMS_PATH = _ASSETS / "component_synonyms.json"
DEFAULT_TEMPLATES_DIR = _ASSETS / "templates"

# --------------------------------------------------------------------------- #
# Template keyword table (mirrors modes/standalone/SKILL.md routing rules)
# --------------------------------------------------------------------------- #
TEMPLATE_KEYWORDS: dict[str, list[str]] = {
    "MEDALLION_LAKEHOUSE": [
        "medallion", "bronze silver gold", "lakehouse",
    ],
    "MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY": [
        "snowflake-only medallion", "snowflake only medallion",
    ],
    "STREAMING_DATA_STACK": [
        "streaming pipeline", "real-time streaming", "kafka pipeline",
        "dynamic tables pipeline",
    ],
    "SECURITY_ANALYTICS": [
        "security analytics", "siem", "log analytics", "log ingest",
    ],
    "CUSTOMER_360": [
        "customer 360", "cdp", "customer data platform",
    ],
    "ML_FEATURE_ENGINEERING": [
        "ml pipeline", "machine learning", "feature engineering",
        "model registry",
    ],
    "BATCH_DATA_WAREHOUSE": [
        "batch", "etl", "star schema", "data warehouse",
    ],
    "REALTIME_IOT_PIPELINE": [
        "iot", "sensor", "mqtt", "edge",
    ],
    "DATA_GOVERNANCE_COMPLIANCE": [
        "governance", "masking", "rls", "row level security", "compliance",
    ],
    "EMBEDDED_ANALYTICS": [
        "embedded analytics", "in-app analytics", "hybrid tables",
        "dashboard analytics",
    ],
    "MULTI_CLOUD_DATA_MESH": [
        "data mesh", "multi-cloud", "federated data",
    ],
    "SERVERLESS_DATA_STACK": [
        "serverless", "lambda", "functions",
    ],
    "REALTIME_FINANCIAL_TRANSACTIONS": [
        "financial transactions", "fraud detection", "fraud scoring",
        "card transactions",
    ],
    "HYBRID_CLOUD_LAKEHOUSE": [
        "iceberg", "hybrid cloud", "external catalog",
    ],
}

# --------------------------------------------------------------------------- #
# Source-type vocabulary — used to detect multi-source prompts
# --------------------------------------------------------------------------- #
# Each "source class" has trigger phrases. A prompt mentioning ≥2 distinct
# source classes is a multi-source prompt and benefits from compose mode.
SOURCE_CLASSES: dict[str, list[str]] = {
    "s3":           ["s3", "aws s3", "object store", "data lake bucket"],
    "kafka":        ["kafka", "msk", "confluent"],
    "kinesis":      ["kinesis"],
    "azure_blob":   ["azure blob", "adls", "azure storage"],
    "gcs":          ["gcs", "google cloud storage"],
    "rest_api":     ["rest api", "http endpoint"],
    "mqtt":         ["mqtt"],
    "fivetran":     ["fivetran"],
    "airbyte":      ["airbyte"],
    "snowpipe":     ["snowpipe"],
    "iceberg":      ["iceberg"],
    "external_db":  ["postgres source", "mysql source", "oracle source",
                     "sql server source"],
    "kafka_connector": ["kafka connector", "snowflake kafka connector"],
}

# Mapping from detected source class to the most representative BLOCK_ID
# (these BLOCK_IDs are present in the bundled COMPONENT_BLOCKS snapshot;
#  unknown ids are silently dropped by composer.compose).
SOURCE_BLOCK_HINTS: dict[str, str] = {
    "s3":              "S3_BUCKET_BLOCK",
    "kafka":           "KAFKA_CONNECTOR_BLOCK",
    "kafka_connector": "KAFKA_CONNECTOR_BLOCK",
    "azure_blob":      "AZURE_BLOB_BLOCK",
    "gcs":             "GCS_BLOCK",
    "kinesis":         "KINESIS_BLOCK",
    "mqtt":            "MQTT_BLOCK",
    "rest_api":        "REST_API_BLOCK",
    "snowpipe":        "SNOWPIPE_BLOCK",
    "iceberg":         "ICEBERG_TABLE_BLOCK",
    "external_db":     "EXTERNAL_TABLE_BLOCK",
    "fivetran":        "FIVETRAN_BLOCK",
    "airbyte":         "AIRBYTE_BLOCK",
}

# --------------------------------------------------------------------------- #
# Snapshot loaders
# --------------------------------------------------------------------------- #
def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_blocks(path: Optional[Path]) -> list[dict[str, Any]]:
    p = path or DEFAULT_BLOCKS_PATH
    return _load_json(p) if p.exists() else []


def _load_synonyms(path: Optional[Path]) -> list[dict[str, Any]]:
    p = path or DEFAULT_SYNONYMS_PATH
    return _load_json(p) if p.exists() else []


# --------------------------------------------------------------------------- #
# Detection helpers
# --------------------------------------------------------------------------- #
def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().strip())


def _score_template(prompt_norm: str, template_id: str) -> float:
    """
    Score how strongly a normalised prompt matches a template's keyword set.
    Score is the count of distinct keyword phrases hit.
    """
    keywords = TEMPLATE_KEYWORDS.get(template_id, [])
    return float(sum(1 for kw in keywords if kw in prompt_norm))


def _detect_sources(prompt_norm: str) -> list[str]:
    """Return the list of source classes mentioned in the prompt."""
    hits: list[str] = []
    for src_class, triggers in SOURCE_CLASSES.items():
        if any(t in prompt_norm for t in triggers):
            hits.append(src_class)
    return hits


def _resolve_synonym_to_block(
    term: str, synonyms: list[dict[str, Any]], blocks: list[dict[str, Any]]
) -> Optional[str]:
    """Map a free-text term to a BLOCK_ID via the synonyms snapshot."""
    term_l = term.lower().strip()
    if not term_l:
        return None

    # 1. Direct synonym match -> COMPONENT_TYPE
    component_type: Optional[str] = None
    for row in synonyms:
        syn = (row.get("SYNONYM") or row.get("synonym") or "").lower()
        if syn == term_l:
            component_type = row.get("COMPONENT_TYPE") or row.get("component_type")
            break

    if not component_type:
        # Fuzzy contains
        for row in synonyms:
            syn = (row.get("SYNONYM") or "").lower()
            if syn and (term_l in syn or syn in term_l):
                component_type = row.get("COMPONENT_TYPE")
                break

    if not component_type:
        return None

    # 2. Component_type -> first matching BLOCK_ID
    ct_l = component_type.lower()
    for blk in blocks:
        bid = (blk.get("BLOCK_ID") or "").upper()
        bcat = (blk.get("BLOCK_CATEGORY") or "").lower()
        bname = (blk.get("BLOCK_NAME") or "").lower()
        if ct_l in bid.lower() or ct_l in bname or ct_l == bcat:
            return blk["BLOCK_ID"]
    return None


# --------------------------------------------------------------------------- #
# Compose-mode plan
# --------------------------------------------------------------------------- #
def _compose_plan_for_prompt(
    prompt_norm: str,
    detected_sources: list[str],
    blocks: list[dict[str, Any]],
    synonyms: list[dict[str, Any]],
) -> tuple[list[str], list[str]]:
    """
    Build an ordered BLOCK_ID list for compose mode based on a multi-source prompt.
    Returns (block_ids, covered_terms).

    Strategy: source blocks (in detection order) -> ingestion -> bronze ->
    transformation -> silver -> gold -> bi/serve. Each stage is filled in only
    if a prompt hint suggests it.
    """
    block_ids: list[str] = []
    covered: list[str] = []
    known_block_ids = {b.get("BLOCK_ID") for b in blocks}

    # Stage 1 — source blocks for each detected source class
    for src in detected_sources:
        hint = SOURCE_BLOCK_HINTS.get(src)
        if hint and hint in known_block_ids and hint not in block_ids:
            block_ids.append(hint)
            covered.append(src)

    # Stage 2 — ingestion (Snowpipe / Snowpipe Streaming) when streaming words present
    if any(w in prompt_norm for w in ("streaming", "real-time", "real time", "kafka")):
        for bid in ("SNOWPIPE_STREAMING_BLOCK", "SNOWPIPE_BLOCK"):
            if bid in known_block_ids and bid not in block_ids:
                block_ids.append(bid)
                covered.append(bid.lower())
                break
    elif any(w in prompt_norm for w in ("snowpipe", "auto-ingest", "batch ingest")):
        if "SNOWPIPE_BLOCK" in known_block_ids and "SNOWPIPE_BLOCK" not in block_ids:
            block_ids.append("SNOWPIPE_BLOCK")
            covered.append("snowpipe")

    # Stage 3 — Bronze
    if any(w in prompt_norm for w in ("bronze", "raw table", "landing")):
        for bid in ("BRONZE_TABLE_BLOCK", "RAW_TABLE_BLOCK"):
            if bid in known_block_ids and bid not in block_ids:
                block_ids.append(bid)
                covered.append("bronze")
                break

    # Stage 4 — CDC + transformation
    if any(w in prompt_norm for w in ("cdc", "stream", "change data capture")):
        for bid in ("CDC_STREAM_BLOCK", "STREAM_BLOCK"):
            if bid in known_block_ids and bid not in block_ids:
                block_ids.append(bid)
                covered.append("cdc_stream")
                break
    if any(w in prompt_norm for w in ("transform", "task", "dbt")):
        for bid in ("TRANSFORM_TASK_BLOCK", "TASK_BLOCK", "DBT_BLOCK"):
            if bid in known_block_ids and bid not in block_ids:
                block_ids.append(bid)
                covered.append("transform_task")
                break

    # Stage 5 — Silver
    if any(w in prompt_norm for w in ("silver", "clean")):
        for bid in ("SILVER_TABLE_BLOCK",):
            if bid in known_block_ids and bid not in block_ids:
                block_ids.append(bid)
                covered.append("silver")
                break

    # Stage 6 — Gold / analytics
    if any(w in prompt_norm for w in ("gold", "mart", "analytics", "fact", "dim")):
        for bid in ("GOLD_TABLE_BLOCK", "ANALYTICS_VIEW_BLOCK"):
            if bid in known_block_ids and bid not in block_ids:
                block_ids.append(bid)
                covered.append("gold")
                break

    # Stage 7 — BI / serve
    bi_terms = [
        ("tableau",   "TABLEAU_BLOCK"),
        ("power bi",  "POWERBI_BLOCK"),
        ("powerbi",   "POWERBI_BLOCK"),
        ("looker",    "LOOKER_BLOCK"),
        ("streamlit", "STREAMLIT_BLOCK"),
        ("dashboard", "DASHBOARD_BLOCK"),
    ]
    for term, bid in bi_terms:
        if term in prompt_norm and bid in known_block_ids and bid not in block_ids:
            block_ids.append(bid)
            covered.append(term)
            break

    return block_ids, covered


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def route(
    prompt: str,
    *,
    blocks_path: Optional[Path] = None,
    synonyms_path: Optional[Path] = None,
    multi_source_threshold: int = 2,
) -> dict[str, Any]:
    """
    Decide between template-mode and compose-mode for a user prompt.

    A prompt that names ≥multi_source_threshold distinct source classes is
    routed to compose-mode with an ordered BLOCK_ID list. Otherwise the
    best-scoring template is returned (or a default if no keyword fires).
    """
    prompt_norm = _normalize(prompt)
    blocks = _load_blocks(blocks_path)
    synonyms = _load_synonyms(synonyms_path)

    detected_sources = _detect_sources(prompt_norm)

    # 1. Score every template
    scored: list[tuple[float, str]] = sorted(
        ((_score_template(prompt_norm, tid), tid) for tid in TEMPLATE_KEYWORDS),
        reverse=True,
    )
    best_score, best_template = scored[0]

    # 2. Multi-source check — overrides single-template selection
    if len(detected_sources) >= multi_source_threshold:
        block_ids, covered = _compose_plan_for_prompt(
            prompt_norm, detected_sources, blocks, synonyms
        )
        if block_ids:
            return {
                "type": "compose",
                "block_ids": block_ids,
                "confidence": min(1.0, len(detected_sources) / 3.0),
                "rationale": (
                    f"Prompt mentions {len(detected_sources)} distinct source "
                    f"classes ({', '.join(detected_sources)}); a single canned "
                    "template would not cover all of them. Composing from blocks."
                ),
                "covered_terms": covered,
            }

    # 3. Single-template path
    if best_score > 0:
        return {
            "type": "template",
            "template_id": best_template,
            "confidence": min(1.0, best_score / 3.0),
            "rationale": (
                f"Matched {int(best_score)} keyword(s) for {best_template}; "
                f"{len(detected_sources)} source class(es) detected — within "
                f"single-template coverage."
            ),
        }

    # 4. No keyword fired — fallback to a generic medallion shell
    return {
        "type": "template",
        "template_id": "MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY",
        "confidence": 0.1,
        "rationale": "No template keywords matched; defaulting to Snowflake-only medallion.",
    }


# --------------------------------------------------------------------------- #
# CONFIDENCE-GATED ROUTING (route_v2 — preferred for prompt-driven generation)
#
# Per the standalone-skill design rule: templates are FALLBACKS, not the
# default path. A template only wins when the prompt clearly matches its
# pattern (≥ template_threshold distinct keyword phrases). Otherwise route
# to from_scratch and let flow_builder.build_flow_from_docs() compose a
# fresh rich-state diagram informed by SnowflakeProductDocs.
# --------------------------------------------------------------------------- #

DEFAULT_TEMPLATE_THRESHOLD = 2


def _detect_pipeline_type_local(prompt_norm: str) -> str:
    """
    Lightweight pipeline-type detection that does not import docs_resolver
    (kept dependency-free so route_v2 stays usable in restricted envs).
    Mirrors docs_resolver._INTENT_SIGNALS.
    """
    signals: dict[str, list[str]] = {
        "medallion": ["medallion", "bronze", "silver", "gold", "lakehouse", "multi-layer"],
        "streaming": ["streaming", "real-time", "real time", "kafka", "kinesis", "event hub", "low latency"],
        "iot":       ["iot", "sensor", "mqtt", "device", "telemetry", "edge"],
        "batch":     ["batch", "etl", "star schema", "data warehouse", "scheduled", "nightly"],
        "security":  ["security", "governance", "masking", "rls", "rbac", "compliance", "audit"],
    }
    scores: dict[str, int] = {pt: 0 for pt in signals}
    for pt, keys in signals.items():
        scores[pt] = sum(1 for k in keys if k in prompt_norm)
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "generic"


def route_v2(
    prompt: str,
    *,
    knowledge_pack: Optional[dict[str, Any]] = None,
    template_threshold: int = DEFAULT_TEMPLATE_THRESHOLD,
    blocks_path: Optional[Path] = None,
    synonyms_path: Optional[Path] = None,
) -> dict[str, Any]:
    """
    Confidence-gated routing.

    Returns one of:
        {"type": "template",    "template_id", "confidence", "score",
         "matched_keywords", "rationale"}
        {"type": "from_scratch","pipeline_type", "confidence", "rationale"}
        {"type": "compose",     "block_ids", "covered_terms", "confidence",
         "rationale"}

    Template path requires score >= template_threshold AND no tie at the top.
    A knowledge_pack with an explicit pipeline_type can override the template
    path when the template's category disagrees with the pack.
    """
    prompt_norm = _normalize(prompt)
    blocks = _load_blocks(blocks_path)
    synonyms = _load_synonyms(synonyms_path)

    detected_sources = _detect_sources(prompt_norm)

    # Multi-source prompts → compose (no template covers ≥ 2 source classes).
    # BUT only if compose can assemble a meaningfully populated pipeline (≥ 4
    # components spanning source + downstream stages). For thinner prompts we
    # fall through to from_scratch which always produces a full pipeline.
    if len(detected_sources) >= 2:
        block_ids, covered = _compose_plan_for_prompt(
            prompt_norm, detected_sources, blocks, synonyms
        )
        if len(block_ids) >= 4:
            return {
                "type": "compose",
                "block_ids": block_ids,
                "confidence": min(1.0, len(detected_sources) / 3.0),
                "rationale": (
                    f"Prompt mentions {len(detected_sources)} distinct source "
                    f"classes ({', '.join(detected_sources)}); composing from blocks."
                ),
                "covered_terms": covered,
            }

    # Score every template, capture matched keywords.
    scored: list[tuple[int, str, list[str]]] = []
    for tid, kws in TEMPLATE_KEYWORDS.items():
        hits = [kw for kw in kws if kw in prompt_norm]
        scored.append((len(hits), tid, hits))
    scored.sort(reverse=True, key=lambda x: x[0])
    best_score, best_template, best_hits = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0

    pack_pipeline_type = (knowledge_pack or {}).get("pipeline_type")
    detected_pipeline_type = pack_pipeline_type or _detect_pipeline_type_local(prompt_norm)

    # Template path — only when score is decisive AND no tie at the top.
    if best_score >= template_threshold and best_score > second_score:
        return {
            "type": "template",
            "template_id": best_template,
            "score": best_score,
            "matched_keywords": best_hits,
            "confidence": min(1.0, 0.5 + 0.15 * best_score),
            "rationale": (
                f"Matched {best_score} distinct keyword phrase(s) for "
                f"{best_template}: {best_hits}. Template path."
            ),
        }

    # Fall through to from-scratch — the default for ambiguous prompts.
    return {
        "type": "from_scratch",
        "pipeline_type": detected_pipeline_type,
        "confidence": 0.7,
        "rationale": (
            f"No template scored above the {template_threshold}-keyword threshold "
            f"(best={best_score} for {best_template}). Composing fresh "
            f"'{detected_pipeline_type}' pipeline from docs-driven flow_builder."
        ),
        "best_template_candidate": {
            "template_id": best_template,
            "score": best_score,
            "matched_keywords": best_hits,
        },
    }


# --------------------------------------------------------------------------- #
# DOCS-DRIVEN ROUTING (preferred — uses SnowflakeProductDocs)
# --------------------------------------------------------------------------- #
def route_docs_driven(
    prompt: str,
    *,
    use_docs: bool = True,
) -> dict[str, Any]:
    """
    Route using docs-driven pipeline resolution instead of hardcoded blocks.

    This is the modern path that queries SnowflakeProductDocs to determine
    best-practice components. Falls back to cached/default specs when offline.

    Returns a decision dict:
        {"type": "docs_driven", "pipeline_type": str, "spec": [...],
         "confidence": float, "rationale": str}
    """
    from . import docs_resolver

    prompt_norm = _normalize(prompt)
    pipeline_type = docs_resolver.detect_pipeline_type(prompt_norm)
    spec = docs_resolver.resolve_pipeline(
        prompt, pipeline_type=pipeline_type, use_docs=use_docs
    )

    return {
        "type": "docs_driven",
        "pipeline_type": pipeline_type,
        "spec": spec,
        "confidence": 0.8 if use_docs else 0.6,
        "rationale": (
            f"Docs-driven resolution for '{pipeline_type}' pipeline. "
            f"{'Enriched from live SnowflakeProductDocs.' if use_docs else 'Using cached/default spec (offline).'}"
        ),
    }


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _load_docs_resolver():
    """Side-load docs_resolver as a module without requiring package context."""
    import importlib.util
    spec_mod = importlib.util.spec_from_file_location(
        "docs_resolver", Path(__file__).parent / "docs_resolver.py"
    )
    mod = importlib.util.module_from_spec(spec_mod)
    spec_mod.loader.exec_module(mod)
    return mod


def _main() -> int:
    argv = sys.argv[1:]
    if not argv:
        print(
            "Usage: intent_router.py \"<prompt>\"                # confidence-gated route_v2 (default)\n"
            "       intent_router.py --legacy \"<prompt>\"        # legacy route() for back-compat\n"
            "       intent_router.py --docs \"<prompt>\"          # docs-driven full resolution\n"
            "       intent_router.py --detect-type \"<prompt>\"   # print pipeline_type only\n"
            "       intent_router.py --queries-for <pipeline_type>  # print docs queries to run",
            file=sys.stderr,
        )
        return 2

    flag = argv[0]

    if flag == "--detect-type":
        prompt = " ".join(argv[1:])
        ptype = _detect_pipeline_type_local(_normalize(prompt))
        print(json.dumps({"pipeline_type": ptype}))
        return 0

    if flag == "--queries-for":
        if len(argv) < 2:
            print("ERROR: --queries-for requires a pipeline type", file=sys.stderr)
            return 2
        ptype = argv[1]
        docs_resolver = _load_docs_resolver()
        queries = docs_resolver._DOCS_QUERIES.get(
            ptype, docs_resolver._DOCS_QUERIES["generic"]
        )
        print(json.dumps({"pipeline_type": ptype, "queries": list(queries)}))
        return 0

    if flag == "--docs":
        prompt = " ".join(argv[1:])
        docs_resolver = _load_docs_resolver()
        pipeline_type = docs_resolver.detect_pipeline_type(prompt.lower())
        pipeline_spec = docs_resolver.resolve_pipeline(prompt, use_docs=True)
        decision = {
            "type": "docs_driven",
            "pipeline_type": pipeline_type,
            "spec": pipeline_spec,
            "confidence": 0.8,
            "rationale": f"Docs-driven resolution for '{pipeline_type}' pipeline.",
        }
        print(json.dumps(decision, indent=2))
        return 0

    if flag == "--legacy":
        decision = route(" ".join(argv[1:]))
    else:
        # Default: route_v2 — confidence-gated, templates-as-fallback.
        decision = route_v2(" ".join(argv))

    print(json.dumps(decision, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(_main())
