"""
Block-to-flow-node mapper.

Translates a sequence of BLOCK_IDs (from the snapshot) into structured flow
nodes that the rich viewer renders. Each node carries:
  - id, label, detail   (display text)
  - icon                (filename under assets/viewer/icons/)
  - category            (one of: onprem, bridge, snow, outcome — used for
                         color/style classes that match the petrohunt
                         design language)

The category mapping is intentional and matches the reference HTML's
node-onprem / node-bridge / node-snow / node-outcome classes:
  - onprem  : external sources, on-prem / 3rd-party systems (orange)
  - bridge  : ingestion + integration (Snowpipe, Stages, External Functions)
  - snow    : in-Snowflake compute / storage / transformation
  - outcome : end-user-facing surfaces (BI, dashboards, search, AI)
"""

from __future__ import annotations

from typing import Any

# --------------------------------------------------------------------------- #
# Icon mapping — verified against the bundled icon set under viewer/icons/
# --------------------------------------------------------------------------- #
#
# Each entry maps a BLOCK_ID to:
#   {label, detail, icon, category}
#
# Labels are human-readable (override BLOCK_NAME for brevity).
# Detail is a one-line caption shown beneath the label.
# Icons MUST exist in viewer/icons/ — falls back to a generic icon if missing.
# --------------------------------------------------------------------------- #
BLOCK_REGISTRY: dict[str, dict[str, str]] = {
    # --- External / on-prem sources ---
    "S3_BUCKET_BLOCK":          {"label": "AWS S3",            "detail": "Object store / data lake",  "icon": "Snowflake_ICON_3rd_Party.svg",        "category": "onprem"},
    "AZURE_BLOB_BLOCK":         {"label": "Azure Blob",        "detail": "ADLS / Blob Storage",        "icon": "Snowflake_ICON_3rd_Party.svg",        "category": "onprem"},
    "GCS_BUCKET_BLOCK":         {"label": "GCS",               "detail": "Google Cloud Storage",       "icon": "Snowflake_ICON_3rd_Party.svg",        "category": "onprem"},
    "KAFKA_CONNECTOR_BLOCK":    {"label": "Kafka",             "detail": "Streaming topic",            "icon": "Snowflake_ICON_Kafka_Connectors.svg", "category": "onprem"},
    "EXTERNAL_FUNCTION_BLOCK":  {"label": "External Function", "detail": "API / model service",        "icon": "Snowflake_ICON_RA_Function_External.svg", "category": "onprem"},
    "DATA_SHARE_BLOCK":         {"label": "Secure Data Share", "detail": "Cross-account share",        "icon": "Snowflake_ICON_Sharing_Collaboration.svg", "category": "onprem"},

    # --- Ingestion / bridge ---
    "EXTERNAL_STAGE_BLOCK":     {"label": "External Stage",    "detail": "Snowflake-managed staging",  "icon": "Snowflake_ICON_RA_Stage_External.svg", "category": "bridge"},
    "SNOWPIPE_BLOCK":           {"label": "Snowpipe",          "detail": "Auto-ingest from object store", "icon": "Snowflake_ICON_RA_Pipe.svg",      "category": "bridge"},
    "SNOWPIPE_STREAMING_BLOCK": {"label": "Snowpipe Streaming","detail": "Sub-second row-level ingest", "icon": "Snowflake_ICON_RA_Pipe.svg",         "category": "bridge"},

    # --- Bronze layer ---
    "BRONZE_DB_BLOCK":          {"label": "Bronze Database",   "detail": "Raw landing zone",           "icon": "Snowflake_ICON_Database.svg",         "category": "snow"},
    "BRONZE_TABLE_BLOCK":       {"label": "Bronze Table",      "detail": "Raw, append-only",           "icon": "Snowflake_ICON_RA_Table.svg",         "category": "snow"},
    "BRONZE_STREAM_BLOCK":      {"label": "Bronze Stream",     "detail": "CDC over raw",               "icon": "Snowflake_ICON_RA_Stream.svg",        "category": "snow"},
    "TABLE_RAW_BLOCK":          {"label": "Raw Table",         "detail": "Landing table",              "icon": "Snowflake_ICON_RA_Table.svg",         "category": "snow"},

    # --- Silver layer ---
    "SILVER_DB_BLOCK":          {"label": "Silver Database",   "detail": "Cleaned, conformed",         "icon": "Snowflake_ICON_Database.svg",         "category": "snow"},
    "SILVER_TABLE_BLOCK":       {"label": "Silver Table",      "detail": "Cleaned, deduped",           "icon": "Snowflake_ICON_RA_Table.svg",         "category": "snow"},
    "SILVER_STREAM_BLOCK":      {"label": "Silver Stream",     "detail": "CDC over silver",            "icon": "Snowflake_ICON_RA_Stream.svg",        "category": "snow"},
    "CLEAN_TASK_BLOCK":         {"label": "Quality Task",      "detail": "Constraints + validation",   "icon": "Snowflake_ICON_RA_Task.svg",          "category": "snow"},
    "TABLE_TRANSFORMED_BLOCK":  {"label": "Transformed Table", "detail": "Post-transform output",      "icon": "Snowflake_ICON_RA_Table.svg",         "category": "snow"},

    # --- Transformation / orchestration ---
    "STREAM_BLOCK":             {"label": "Stream",            "detail": "Change data capture",        "icon": "Snowflake_ICON_RA_Stream.svg",        "category": "snow"},
    "TASK_BLOCK":               {"label": "Task",              "detail": "Scheduled transform",        "icon": "Snowflake_ICON_RA_Task.svg",          "category": "snow"},
    "PROCEDURE_BLOCK":          {"label": "Procedure",         "detail": "Multi-step logic",           "icon": "Snowflake_ICON_RA_Function_Stored_Procedure.svg", "category": "snow"},
    "UDF_BLOCK":                {"label": "UDF",               "detail": "User-defined function",      "icon": "Snowflake_ICON_RA_Function.svg",      "category": "snow"},
    "DYNAMIC_TABLE_BLOCK":      {"label": "Dynamic Table",     "detail": "Declarative refresh",        "icon": "Snowflake_ICON_Dynamic_Tables.svg",   "category": "snow"},

    # --- Compute ---
    "WAREHOUSE_XS_BLOCK":       {"label": "Warehouse (XS)",    "detail": "Light workloads",            "icon": "Snowflake_ICON_RA_Virtual_Warehouse.svg", "category": "snow"},
    "WAREHOUSE_M_BLOCK":        {"label": "Warehouse (M)",     "detail": "Standard compute",           "icon": "Snowflake_ICON_RA_Virtual_Warehouse.svg", "category": "snow"},
    "WAREHOUSE_L_BLOCK":        {"label": "Warehouse (L)",     "detail": "Heavy ETL",                  "icon": "Snowflake_ICON_RA_Virtual_Warehouse.svg", "category": "snow"},
    "BI_WAREHOUSE_BLOCK":       {"label": "BI Warehouse",      "detail": "Auto-scaled for BI",         "icon": "Snowflake_ICON_RA_Virtual_Warehouse.svg", "category": "snow"},

    # --- Storage primitives ---
    "DATABASE_BLOCK":           {"label": "Database",          "detail": "Snowflake database",         "icon": "Snowflake_ICON_Database.svg",         "category": "snow"},
    "SCHEMA_BLOCK":             {"label": "Schema",            "detail": "Logical namespace",          "icon": "Snowflake_ICON_Database.svg",         "category": "snow"},
    "VIEW_BLOCK":               {"label": "View",              "detail": "Query abstraction",          "icon": "Snowflake_ICON_RA_View.svg",          "category": "snow"},
    "SECURE_VIEW_BLOCK":        {"label": "Secure View",       "detail": "RLS-enforcing view",         "icon": "Snowflake_ICON_RA_View_Secure.svg",   "category": "snow"},

    # --- Security ---
    "ROLE_BLOCK":               {"label": "Role",              "detail": "RBAC entity",                "icon": "Snowflake_ICON_Access.svg",           "category": "snow"},
    "USER_BLOCK":               {"label": "User",              "detail": "Account principal",          "icon": "Snowflake_ICON_Access.svg",           "category": "snow"},
    "GRANT_BLOCK":              {"label": "Grant",             "detail": "Privilege binding",          "icon": "Snowflake_ICON_Access.svg",           "category": "snow"},

    # --- Gold layer ---
    "GOLD_DB_BLOCK":            {"label": "Gold Database",     "detail": "Curated, business-ready",    "icon": "Snowflake_ICON_Database.svg",         "category": "outcome"},
    "GOLD_TABLE_BLOCK":         {"label": "Gold Table",        "detail": "Business-ready output",      "icon": "Snowflake_ICON_RA_Table.svg",         "category": "outcome"},
    "FACT_TABLE_BLOCK":         {"label": "Fact Table",        "detail": "Star schema fact",           "icon": "Snowflake_ICON_RA_Table.svg",         "category": "outcome"},
    "DIM_TABLE_BLOCK":          {"label": "Dimension Table",   "detail": "Reference attributes",       "icon": "Snowflake_ICON_RA_Table.svg",         "category": "outcome"},
    "BUSINESS_VIEW_BLOCK":      {"label": "Business View",     "detail": "KPI-ready view",             "icon": "Snowflake_ICON_RA_View.svg",          "category": "outcome"},

    # --- BI / consumption ---
    "TABLEAU_BLOCK":            {"label": "Tableau",           "detail": "BI dashboards",              "icon": "Snowflake_ICON_Analytics.svg",        "category": "outcome"},
    "POWERBI_BLOCK":            {"label": "Power BI",          "detail": "BI dashboards",              "icon": "Snowflake_ICON_Analytics.svg",        "category": "outcome"},
    "RLS_VIEW_BLOCK":           {"label": "RLS View",          "detail": "Row-level secured BI view",  "icon": "Snowflake_ICON_RA_View_Secure.svg",   "category": "outcome"},
}

# --------------------------------------------------------------------------- #
# Fallback by category (when BLOCK_ID is not in the registry above)
# --------------------------------------------------------------------------- #
CATEGORY_FALLBACK_ICON = {
    "external":       "Snowflake_ICON_3rd_Party.svg",
    "ingestion":      "Snowflake_ICON_RA_Pipe.svg",
    "bronze":         "Snowflake_ICON_RA_Table.svg",
    "silver":         "Snowflake_ICON_RA_Table.svg",
    "gold":           "Snowflake_ICON_RA_Table.svg",
    "transformation": "Snowflake_ICON_RA_Task.svg",
    "compute":        "Snowflake_ICON_RA_Virtual_Warehouse.svg",
    "storage":        "Snowflake_ICON_Database.svg",
    "security":       "Snowflake_ICON_Access.svg",
    "bi":             "Snowflake_ICON_Analytics.svg",
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


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def block_to_node(block: dict[str, Any]) -> dict[str, str]:
    """
    Turn a COMPONENT_BLOCKS row (with BLOCK_ID, BLOCK_NAME, BLOCK_CATEGORY,
    DESCRIPTION) into a flow-node spec for the rich viewer.
    """
    bid = block.get("BLOCK_ID", "")
    if bid in BLOCK_REGISTRY:
        spec = dict(BLOCK_REGISTRY[bid])
        return {
            "id": _node_id_for(bid),
            "label": spec["label"],
            "detail": spec["detail"],
            "icon": spec["icon"],
            "category": spec["category"],
        }

    # Fallback: derive from category + name
    cat = (block.get("BLOCK_CATEGORY") or "").lower()
    icon = CATEGORY_FALLBACK_ICON.get(cat, GENERIC_ICON)
    flow_class = CATEGORY_TO_FLOW_CLASS.get(cat, "snow")
    return {
        "id": _node_id_for(bid),
        "label": block.get("BLOCK_NAME", bid).split(" – ")[0][:32],
        "detail": (block.get("DESCRIPTION") or "")[:80],
        "icon": icon,
        "category": flow_class,
    }


def _node_id_for(block_id: str) -> str:
    """Produce a stable short DOM id from a BLOCK_ID."""
    return block_id.lower().replace("_block", "")


def build_flow(
    block_ids: list[str],
    blocks_by_id: dict[str, dict[str, Any]],
) -> dict[str, list]:
    """
    Build {nodes, edges} for the rich viewer from an ordered BLOCK_ID list.

    Edges follow input order (matches composer.py / SQL UDF semantics).
    """
    nodes: list[dict[str, str]] = []
    seen_ids: list[str] = []
    for bid in block_ids:
        block = blocks_by_id.get(bid)
        if block is None:
            continue
        node = block_to_node(block)
        # Avoid duplicate node ids if the same BLOCK_ID appears twice
        if node["id"] in seen_ids:
            continue
        nodes.append(node)
        seen_ids.append(node["id"])

    edges: list[dict[str, str]] = []
    for i in range(1, len(nodes)):
        edges.append({"source": nodes[i - 1]["id"], "target": nodes[i]["id"]})

    return {"nodes": nodes, "edges": edges}
