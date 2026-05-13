"""
Block-to-flow-node mapper (hybrid: docs-driven + legacy fallback).

This module provides TWO paths for generating flow nodes:

1. DOCS-DRIVEN (preferred): Uses docs_resolver.py to query SnowflakeProductDocs
   for current best-practice pipeline components. No hardcoded knowledge of which
   Snowflake objects to recommend for each pipeline stage.

2. LEGACY (fallback): Uses the static BLOCK_REGISTRY for backward compatibility
   with existing test personas and the freeform composer. This path is preserved
   so that `run_personas.py` continues to work unchanged during the transition.

The docs-driven path is activated via `build_flow_from_docs()`.
The legacy path remains at `build_flow()` (unchanged API).

Each node carries:
  - id, label, detail   (display text)
  - icon                (filename under assets/viewer/icons/)
  - category            (one of: onprem, bridge, snow, outcome)
  - zone                (architectural zone for 2D layout)
  - doc_url             (link to Snowflake documentation)
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

# --------------------------------------------------------------------------- #
# Icon manifest — the ONLY static component knowledge for the docs-driven path
# --------------------------------------------------------------------------- #
_HERE = Path(__file__).resolve().parent
_ASSETS = _HERE.parent
_ICON_MANIFEST_PATH = _ASSETS / "icon_manifest.json"

_icon_manifest_cache: Optional[dict[str, Any]] = None


def _load_icon_manifest() -> dict[str, Any]:
    global _icon_manifest_cache
    if _icon_manifest_cache is None:
        if _ICON_MANIFEST_PATH.exists():
            _icon_manifest_cache = json.loads(
                _ICON_MANIFEST_PATH.read_text(encoding="utf-8")
            )
        else:
            _icon_manifest_cache = {}
    return _icon_manifest_cache


def _icon_for(object_type: str) -> tuple[str, str]:
    """
    Look up icon and category for a Snowflake object type from the manifest.
    Returns (icon_filename, category).
    """
    manifest = _load_icon_manifest()
    # Direct lookup
    entry = manifest.get(object_type)
    if entry and isinstance(entry, dict) and "icon" in entry:
        return entry["icon"], entry["category"]
    # External systems
    ext = manifest.get("_external_systems", {}).get(object_type)
    if ext:
        return ext["icon"], ext["category"]
    # Consumption
    cons = manifest.get("_consumption", {}).get(object_type)
    if cons:
        return cons["icon"], cons["category"]
    # Fallback
    fb = manifest.get("_fallback", {"icon": "Snowflake_ICON_Architecture.svg", "category": "snow"})
    return fb["icon"], fb["category"]


# =========================================================================== #
# DOCS-DRIVEN PATH — new, preferred
# =========================================================================== #

def build_flow_from_docs(
    prompt: str,
    *,
    pipeline_type: Optional[str] = None,
    use_docs: bool = True,
) -> dict[str, list]:
    """
    Build {nodes, edges, zones} using docs-driven pipeline resolution.

    This is the modern path that queries SnowflakeProductDocs for current
    best practices instead of relying on a hardcoded block registry.

    Args:
        prompt: User's natural language request
        pipeline_type: Override pipeline type detection (medallion, streaming, etc.)
        use_docs: Whether to query live docs (False = use cached/default specs only)

    Returns:
        {"nodes": [...], "edges": [...], "zones": [...]}
    """
    from . import docs_resolver

    spec = docs_resolver.resolve_pipeline(
        prompt, pipeline_type=pipeline_type, use_docs=use_docs
    )
    return _spec_to_flow(spec)


def build_flow_from_components(
    components: list[str],
    *,
    use_docs: bool = True,
) -> dict[str, list]:
    """
    Build flow from explicit component names using docs-driven resolution.

    Args:
        components: List like ["S3", "PIPE", "DYNAMIC_TABLE", "DYNAMIC_TABLE", "BI_TOOL"]
        use_docs: Whether to enrich from live docs

    Returns:
        {"nodes": [...], "edges": [...], "zones": [...]}
    """
    from . import docs_resolver

    spec = docs_resolver.resolve_custom_pipeline(components, use_docs=use_docs)
    return _spec_to_flow(spec)


def _spec_to_flow(spec: list[dict[str, Any]]) -> dict[str, list]:
    """
    Convert a pipeline spec (from docs_resolver) into the viewer's
    {nodes, edges, zones} format.
    """
    nodes: list[dict[str, str]] = []
    seen_ids: set[str] = set()

    for i, entry in enumerate(spec):
        object_type = entry.get("object_type", "TABLE")
        icon, category = _icon_for(object_type)

        # Generate stable node ID
        node_id = _node_id_from_spec(entry, i)
        if node_id in seen_ids:
            node_id = f"{node_id}_{i}"
        seen_ids.add(node_id)

        node: dict[str, str] = {
            "id": node_id,
            "label": entry.get("label", object_type.replace("_", " ").title()),
            "detail": entry.get("detail", ""),
            "icon": icon,
            "category": category,
            "zone": entry.get("zone", "Transformation"),
        }
        if entry.get("doc_url"):
            node["doc_url"] = entry["doc_url"]
        nodes.append(node)

    # Sequential edges
    edges: list[dict[str, str]] = []
    for i in range(1, len(nodes)):
        edges.append({"source": nodes[i - 1]["id"], "target": nodes[i]["id"]})

    # Group nodes by zone
    by_zone: dict[str, list[str]] = {}
    for n in nodes:
        zname = n.get("zone", "Transformation")
        by_zone.setdefault(zname, []).append(n["id"])

    # Zone ordering: follow the pipeline stage order from the spec
    zone_order_seen: list[str] = []
    for entry in spec:
        zname = entry.get("zone", "Transformation")
        if zname not in zone_order_seen:
            zone_order_seen.append(zname)

    zones: list[dict[str, Any]] = []
    for zname in zone_order_seen:
        if zname in by_zone:
            # Determine zone category from its nodes
            zone_nodes = [n for n in nodes if n.get("zone") == zname]
            # Use the most common category among zone nodes
            cats = [n["category"] for n in zone_nodes]
            zone_cat = max(set(cats), key=cats.count) if cats else "snow"
            zones.append({
                "name": zname,
                "category": zone_cat,
                "node_ids": by_zone[zname],
            })

    return {"nodes": nodes, "edges": edges, "zones": zones}


def _node_id_from_spec(entry: dict[str, Any], index: int) -> str:
    """Generate a DOM-safe node ID from a pipeline spec entry."""
    label = entry.get("label", "")
    if label:
        # Convert "Dynamic Table" -> "dynamic_table"
        return re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    return f"node_{index}"


# =========================================================================== #
# LEGACY PATH — backward compatible (unchanged from previous implementation)
# =========================================================================== #

# --------------------------------------------------------------------------- #
# Legacy block registry — preserved for backward compatibility with existing
# test personas and the freeform Mermaid composer. New code should use the
# docs-driven path above.
# --------------------------------------------------------------------------- #
BLOCK_REGISTRY: dict[str, dict[str, str]] = {
    # --- External / on-prem sources ---
    "S3_BUCKET_BLOCK":          {"label": "AWS S3",            "detail": "Object store / data lake",  "icon": "Snowflake_ICON_Workloads_Data_Lake.svg", "category": "onprem",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/data-load-s3"},
    "AZURE_BLOB_BLOCK":         {"label": "Azure Blob",        "detail": "ADLS / Blob Storage",        "icon": "Snowflake_ICON_Workloads_Data_Lake.svg", "category": "onprem",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/data-load-azure"},
    "GCS_BUCKET_BLOCK":         {"label": "GCS",               "detail": "Google Cloud Storage",       "icon": "Snowflake_ICON_Workloads_Data_Lake.svg", "category": "onprem",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/data-load-gcs"},
    "KAFKA_CONNECTOR_BLOCK":    {"label": "Kafka",             "detail": "Streaming topic",            "icon": "Snowflake_ICON_Kafka_Connectors.svg",    "category": "onprem",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/kafka-connector"},
    "EXTERNAL_FUNCTION_BLOCK":  {"label": "External Function", "detail": "API / model service",        "icon": "Snowflake_ICON_RA_Function_External.svg", "category": "onprem",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-external-function"},
    "DATA_SHARE_BLOCK":         {"label": "Secure Data Share", "detail": "Cross-account share",        "icon": "Snowflake_ICON_Sharing_Collaboration.svg", "category": "onprem",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/data-sharing-intro"},
    "IOT_GATEWAY_BLOCK":        {"label": "IoT Gateway",        "detail": "MQTT / device telemetry",    "icon": "Snowflake_ICON_IoT.svg",                 "category": "onprem",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/data-load-snowpipe-streaming-overview"},

    # --- Ingestion / bridge ---
    "EXTERNAL_STAGE_BLOCK":     {"label": "External Stage",    "detail": "Snowflake-managed staging",  "icon": "Snowflake_ICON_RA_Stage_External.svg",   "category": "bridge",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-stage"},
    "SNOWPIPE_BLOCK":           {"label": "Snowpipe",          "detail": "Auto-ingest from object store", "icon": "Snowflake_ICON_RA_Pipe.svg",          "category": "bridge",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro"},
    "SNOWPIPE_STREAMING_BLOCK": {"label": "Snowpipe Streaming","detail": "Sub-second row-level ingest", "icon": "Snowflake_ICON_RA_Pipe.svg",            "category": "bridge",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/data-load-snowpipe-streaming-overview"},

    # --- Bronze layer ---
    "BRONZE_DB_BLOCK":          {"label": "Bronze Database",   "detail": "Raw landing zone",           "icon": "Snowflake_ICON_RA_Snowflake_Database.svg", "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-database"},
    "BRONZE_TABLE_BLOCK":       {"label": "Bronze Table",      "detail": "Raw, append-only",           "icon": "Snowflake_ICON_RA_Table.svg",            "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-table"},
    "BRONZE_STREAM_BLOCK":      {"label": "Bronze Stream",     "detail": "CDC over raw",               "icon": "Snowflake_ICON_RA_Stream.svg",           "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/streams-intro"},
    "TABLE_RAW_BLOCK":          {"label": "Raw Table",         "detail": "Landing table",              "icon": "Snowflake_ICON_RA_Table.svg",            "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-table"},

    # --- Silver layer ---
    "SILVER_DB_BLOCK":          {"label": "Silver Database",   "detail": "Cleaned, conformed",         "icon": "Snowflake_ICON_RA_Snowflake_Database.svg", "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-database"},
    "SILVER_TABLE_BLOCK":       {"label": "Silver Table",      "detail": "Cleaned, deduped",           "icon": "Snowflake_ICON_RA_Table.svg",            "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-table"},
    "SILVER_STREAM_BLOCK":      {"label": "Silver Stream",     "detail": "CDC over silver",            "icon": "Snowflake_ICON_RA_Stream.svg",           "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/streams-intro"},
    "CLEAN_TASK_BLOCK":         {"label": "Quality Task",      "detail": "Constraints + validation",   "icon": "Snowflake_ICON_RA_Task.svg",             "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-task"},
    "TABLE_TRANSFORMED_BLOCK":  {"label": "Transformed Table", "detail": "Post-transform output",      "icon": "Snowflake_ICON_RA_Table.svg",            "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-table"},

    # --- Transformation / orchestration ---
    "STREAM_BLOCK":             {"label": "Stream",            "detail": "Change data capture",        "icon": "Snowflake_ICON_RA_Stream.svg",           "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/streams-intro"},
    "TASK_BLOCK":               {"label": "Task",              "detail": "Scheduled transform",        "icon": "Snowflake_ICON_RA_Task.svg",             "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/tasks-intro"},
    "PROCEDURE_BLOCK":          {"label": "Procedure",         "detail": "Multi-step logic",           "icon": "Snowflake_ICON_RA_Function_Stored_Procedure.svg", "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-procedure"},
    "UDF_BLOCK":                {"label": "UDF",               "detail": "User-defined function",      "icon": "Snowflake_ICON_RA_Function_User-Defined_SQL.svg", "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-function"},
    "DYNAMIC_TABLE_BLOCK":      {"label": "Dynamic Table",     "detail": "Declarative refresh",        "icon": "Snowflake_ICON_RA_Table_Dynamic.svg",    "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/dynamic-tables-about"},

    # --- Compute ---
    "WAREHOUSE_XS_BLOCK":       {"label": "Warehouse (XS)",    "detail": "Light workloads",            "icon": "Snowflake_ICON_RA_Virtual_Warehouse.svg", "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/warehouses-overview"},
    "WAREHOUSE_M_BLOCK":        {"label": "Warehouse (M)",     "detail": "Standard compute",           "icon": "Snowflake_ICON_RA_Virtual_Warehouse.svg", "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/warehouses-overview"},
    "WAREHOUSE_L_BLOCK":        {"label": "Warehouse (L)",     "detail": "Heavy ETL",                  "icon": "Snowflake_ICON_RA_Virtual_Warehouse.svg", "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/warehouses-overview"},
    "BI_WAREHOUSE_BLOCK":       {"label": "BI Warehouse",      "detail": "Auto-scaled for BI",         "icon": "Snowflake_ICON_Warehouse_Adaptive.svg",  "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/warehouses-multicluster"},

    # --- Storage primitives ---
    "DATABASE_BLOCK":           {"label": "Database",          "detail": "Snowflake database",         "icon": "Snowflake_ICON_RA_Snowflake_Database.svg", "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-database"},
    "SCHEMA_BLOCK":             {"label": "Schema",            "detail": "Logical namespace",          "icon": "Snowflake_ICON_RA_Snowflake_Database.svg", "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-schema"},
    "VIEW_BLOCK":               {"label": "View",              "detail": "Query abstraction",          "icon": "Snowflake_ICON_RA_View.svg",             "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-view"},
    "SECURE_VIEW_BLOCK":        {"label": "Secure View",       "detail": "RLS-enforcing view",         "icon": "Snowflake_ICON_RA_View_Secure.svg",      "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/views-secure"},

    # --- Security ---
    "ROLE_BLOCK":               {"label": "Role",              "detail": "RBAC entity",                "icon": "Snowflake_ICON_Access.svg",              "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/security-access-control-overview"},
    "USER_BLOCK":               {"label": "User",              "detail": "Account principal",          "icon": "Snowflake_ICON_Access.svg",              "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-user"},
    "GRANT_BLOCK":              {"label": "Grant",             "detail": "Privilege binding",          "icon": "Snowflake_ICON_Access.svg",              "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/grant-privilege"},

    # --- Gold layer ---
    "GOLD_DB_BLOCK":            {"label": "Gold Database",     "detail": "Curated, business-ready",    "icon": "Snowflake_ICON_Workloads_Data_Warehouse.svg", "category": "outcome",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-database"},
    "GOLD_TABLE_BLOCK":         {"label": "Gold Table",        "detail": "Business-ready output",      "icon": "Snowflake_ICON_RA_Table.svg",            "category": "outcome",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-table"},
    "FACT_TABLE_BLOCK":         {"label": "Fact Table",        "detail": "Star schema fact",           "icon": "Snowflake_ICON_RA_Table.svg",            "category": "outcome",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-table"},
    "DIM_TABLE_BLOCK":          {"label": "Dimension Table",   "detail": "Reference attributes",       "icon": "Snowflake_ICON_RA_Table_Directory.svg",  "category": "outcome",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-table"},
    "BUSINESS_VIEW_BLOCK":      {"label": "Business View",     "detail": "KPI-ready view",             "icon": "Snowflake_ICON_RA_View.svg",             "category": "outcome",
                                 "doc_url": "https://docs.snowflake.com/en/sql-reference/sql/create-view"},

    # --- BI / consumption ---
    "TABLEAU_BLOCK":            {"label": "Tableau",           "detail": "BI dashboards",              "icon": "Snowflake_ICON_Embedded_Analytics.svg",  "category": "outcome",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/odbc-download"},
    "POWERBI_BLOCK":            {"label": "Power BI",          "detail": "BI dashboards",              "icon": "Snowflake_ICON_Embedded_Analytics.svg",  "category": "outcome",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/odbc-download"},
    "RLS_VIEW_BLOCK":           {"label": "RLS View",          "detail": "Row-level secured BI view",  "icon": "Snowflake_ICON_RA_View_Secure.svg",      "category": "outcome",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/security-row-intro"},
}

# --------------------------------------------------------------------------- #
# Legacy zone assignment
# --------------------------------------------------------------------------- #
ZONE_ORDER = [
    "External Sources",
    "Ingestion",
    "Bronze Layer",
    "Silver Layer",
    "Transformation",
    "Compute",
    "Gold Layer",
    "Security & Governance",
    "Consumption",
]

CATEGORY_TO_ZONE = {
    "external":       "External Sources",
    "ingestion":      "Ingestion",
    "bronze":         "Bronze Layer",
    "silver":         "Silver Layer",
    "transformation": "Transformation",
    "compute":        "Compute",
    "storage":        "Bronze Layer",
    "gold":           "Gold Layer",
    "security":       "Security & Governance",
    "bi":             "Consumption",
}

BLOCK_TO_ZONE_OVERRIDE: dict[str, str] = {
    "SECURE_VIEW_BLOCK": "Security & Governance",
    "RLS_VIEW_BLOCK":    "Security & Governance",
    "EXTERNAL_FUNCTION_BLOCK": "Transformation",
    "DATA_SHARE_BLOCK": "Consumption",
}

ZONE_CATEGORY = {
    "External Sources":       "onprem",
    "Ingestion":              "bridge",
    "Bronze Layer":           "snow",
    "Silver Layer":           "snow",
    "Transformation":         "snow",
    "Compute":                "snow",
    "Gold Layer":             "outcome",
    "Security & Governance":  "snow",
    "Consumption":            "outcome",
}

CATEGORY_FALLBACK_ICON = {
    "external":       "Snowflake_ICON_Workloads_Data_Lake.svg",
    "ingestion":      "Snowflake_ICON_RA_Pipe.svg",
    "bronze":         "Snowflake_ICON_RA_Table.svg",
    "silver":         "Snowflake_ICON_RA_Table.svg",
    "gold":           "Snowflake_ICON_RA_Table.svg",
    "transformation": "Snowflake_ICON_RA_Task.svg",
    "compute":        "Snowflake_ICON_RA_Virtual_Warehouse.svg",
    "storage":        "Snowflake_ICON_RA_Snowflake_Database.svg",
    "security":       "Snowflake_ICON_Access.svg",
    "bi":             "Snowflake_ICON_Embedded_Analytics.svg",
}

CATEGORY_TO_FLOW_CLASS = {
    "external":       "onprem",
    "ingestion":      "bridge",
    "bronze":         "snow",
    "silver":         "snow",
    "transformation": "snow",
    "compute":        "snow",
    "storage":        "snow",
    "security":       "snow",
    "gold":           "outcome",
    "bi":             "outcome",
}

GENERIC_ICON = "Snowflake_ICON_Architecture.svg"


def _zone_for(block_id: str, category: str) -> str:
    if block_id in BLOCK_TO_ZONE_OVERRIDE:
        return BLOCK_TO_ZONE_OVERRIDE[block_id]
    return CATEGORY_TO_ZONE.get((category or "").lower(), "Bronze Layer")


# --------------------------------------------------------------------------- #
# Legacy public API (unchanged)
# --------------------------------------------------------------------------- #
def block_to_node(block: dict[str, Any]) -> dict[str, str]:
    """
    Turn a COMPONENT_BLOCKS row (with BLOCK_ID, BLOCK_NAME, BLOCK_CATEGORY,
    DESCRIPTION) into a flow-node spec for the rich viewer.
    """
    bid = block.get("BLOCK_ID", "")
    raw_category = (block.get("BLOCK_CATEGORY") or "").lower()
    if bid in BLOCK_REGISTRY:
        spec = dict(BLOCK_REGISTRY[bid])
        node: dict[str, str] = {
            "id": _node_id_for(bid),
            "label": spec["label"],
            "detail": spec["detail"],
            "icon": spec["icon"],
            "category": spec["category"],
            "zone": _zone_for(bid, raw_category),
        }
        if spec.get("doc_url"):
            node["doc_url"] = spec["doc_url"]
        return node

    # Fallback: derive from category + name
    icon = CATEGORY_FALLBACK_ICON.get(raw_category, GENERIC_ICON)
    flow_class = CATEGORY_TO_FLOW_CLASS.get(raw_category, "snow")
    return {
        "id": _node_id_for(bid),
        "label": block.get("BLOCK_NAME", bid).split(" – ")[0][:32],
        "detail": (block.get("DESCRIPTION") or "")[:80],
        "icon": icon,
        "category": flow_class,
        "zone": _zone_for(bid, raw_category),
    }


def _node_id_for(block_id: str) -> str:
    """Produce a stable short DOM id from a BLOCK_ID."""
    return block_id.lower().replace("_block", "")


def build_flow(
    block_ids: list[str],
    blocks_by_id: dict[str, dict[str, Any]],
) -> dict[str, list]:
    """
    Build {nodes, edges, zones} for the rich viewer from an ordered BLOCK_ID list.
    (LEGACY PATH — preserved for backward compatibility.)

    - nodes : flat list with zone field per node
    - edges : sequential edges in input order
    - zones : ordered list of {name, category, node_ids}
    """
    nodes: list[dict[str, str]] = []
    seen_ids: list[str] = []
    for bid in block_ids:
        block = blocks_by_id.get(bid)
        if block is None:
            continue
        node = block_to_node(block)
        if node["id"] in seen_ids:
            continue
        nodes.append(node)
        seen_ids.append(node["id"])

    edges: list[dict[str, str]] = []
    for i in range(1, len(nodes)):
        edges.append({"source": nodes[i - 1]["id"], "target": nodes[i]["id"]})

    # Group nodes by zone, preserve canonical zone order
    by_zone: dict[str, list[str]] = {}
    for n in nodes:
        zname = n.get("zone") or "Bronze Layer"
        by_zone.setdefault(zname, []).append(n["id"])

    zones = []
    for zname in ZONE_ORDER:
        if zname in by_zone:
            zones.append(
                {
                    "name": zname,
                    "category": ZONE_CATEGORY.get(zname, "snow"),
                    "node_ids": by_zone[zname],
                }
            )
    # Add any zones that didn't appear in ZONE_ORDER (defensive)
    for zname, ids in by_zone.items():
        if zname not in ZONE_ORDER:
            zones.append(
                {"name": zname, "category": ZONE_CATEGORY.get(zname, "snow"), "node_ids": ids}
            )

    # ── Smart naming: detect paradigm and normalize labels ──────────────────
    _normalize_naming(nodes, zones)

    return {"nodes": nodes, "edges": edges, "zones": zones}


# --------------------------------------------------------------------------- #
# Naming intelligence — paradigm detection + normalization (legacy path)
# --------------------------------------------------------------------------- #

_MEDALLION_ZONES = {"Bronze Layer", "Silver Layer", "Gold Layer"}

_MEDALLION_TO_GENERIC = {
    "Bronze Layer": "Raw Layer",
    "Silver Layer": "Curated Layer",
    "Gold Layer": "Serving Layer",
}
_MEDALLION_LABEL_MAP = {
    "Bronze": "Raw",
    "Silver": "Curated",
    "Gold": "Serving",
}

_MERGE_CANDIDATES = [
    ("Compute", "Transformation", 1),
]


def _detect_paradigm(zones: list[dict]) -> str:
    zone_names = {z["name"] for z in zones}
    present_medallion = _MEDALLION_ZONES & zone_names
    if len(present_medallion) >= 2:
        return "medallion"
    return "generic"


def _normalize_naming(nodes: list[dict], zones: list[dict]) -> None:
    """
    In-place normalization of zone names, node labels, and node details
    based on the detected architectural paradigm. (Legacy path only.)
    """
    paradigm = _detect_paradigm(zones)

    if paradigm != "medallion":
        for z in zones:
            if z["name"] in _MEDALLION_TO_GENERIC:
                z["name"] = _MEDALLION_TO_GENERIC[z["name"]]
        for n in nodes:
            if n.get("zone") in _MEDALLION_TO_GENERIC:
                n["zone"] = _MEDALLION_TO_GENERIC[n["zone"]]
            for medallion_term, generic_term in _MEDALLION_LABEL_MAP.items():
                if n["label"].startswith(medallion_term):
                    n["label"] = generic_term + n["label"][len(medallion_term):]
                    break
            detail = n.get("detail", "")
            for medallion_term, generic_term in _MEDALLION_LABEL_MAP.items():
                lc = medallion_term.lower()
                if lc in detail.lower():
                    n["detail"] = re.sub(
                        re.escape(lc), generic_term.lower(), detail, flags=re.IGNORECASE
                    )
                    break

    # Merge single-node zones
    zone_by_name = {z["name"]: z for z in zones}
    for smaller, target, max_nodes in _MERGE_CANDIDATES:
        if smaller in zone_by_name and target in zone_by_name:
            sz = zone_by_name[smaller]
            tz = zone_by_name[target]
            if len(sz["node_ids"]) <= max_nodes:
                tz["node_ids"].extend(sz["node_ids"])
                zones.remove(sz)
                for n in nodes:
                    if n.get("zone") == smaller:
                        n["zone"] = target

    # Contextual relabeling
    zone_by_name = {z["name"]: z for z in zones}
    if "Security & Governance" in zone_by_name:
        sec_zone = zone_by_name["Security & Governance"]
        sec_nodes = [n for n in nodes if n.get("zone") == "Security & Governance"]
        if sec_nodes and all(n.get("category") == "outcome" for n in sec_nodes):
            sec_zone["name"] = "Access Layer"
            for n in sec_nodes:
                n["zone"] = "Access Layer"

    # Update ZONE_CATEGORY for renamed zones
    for z in zones:
        if z["name"] not in ZONE_CATEGORY:
            if z["name"] in ("Raw Layer", "Curated Layer"):
                z["category"] = "snow"
            elif z["name"] in ("Serving Layer", "Access Layer"):
                z["category"] = "outcome"


# --------------------------------------------------------------------------- #
# Citations (shared by both paths)
# --------------------------------------------------------------------------- #
def build_citations(nodes: list[dict[str, str]]) -> list[dict[str, str]]:
    """
    Auto-generate documentation citations from flow nodes.

    Produces one citation per unique doc_url found across nodes, preserving
    node order. Deduplicates by URL so that multiple nodes pointing to the
    same docs page produce only one citation entry.
    """
    seen_urls: set[str] = set()
    citations: list[dict[str, str]] = []
    for node in nodes:
        url = node.get("doc_url")
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        citations.append({
            "url": url,
            "title": node["label"],
            "excerpt": node.get("detail") or "",
        })
    return citations
