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
    # Cloud object stores ARE the user's data lake — use Workloads_Data_Lake
    # rather than the generic 3rd_Party icon.
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
    # Use Snowflake-specific database icon rather than generic Database.
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
    # Use the dedicated dynamic-table icon, not the generic table icon.
    "DYNAMIC_TABLE_BLOCK":      {"label": "Dynamic Table",     "detail": "Declarative refresh",        "icon": "Snowflake_ICON_RA_Table_Dynamic.svg",    "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/dynamic-tables-about"},

    # --- Compute ---
    "WAREHOUSE_XS_BLOCK":       {"label": "Warehouse (XS)",    "detail": "Light workloads",            "icon": "Snowflake_ICON_RA_Virtual_Warehouse.svg", "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/warehouses-overview"},
    "WAREHOUSE_M_BLOCK":        {"label": "Warehouse (M)",     "detail": "Standard compute",           "icon": "Snowflake_ICON_RA_Virtual_Warehouse.svg", "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/warehouses-overview"},
    "WAREHOUSE_L_BLOCK":        {"label": "Warehouse (L)",     "detail": "Heavy ETL",                  "icon": "Snowflake_ICON_RA_Virtual_Warehouse.svg", "category": "snow",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/warehouses-overview"},
    # BI workloads benefit from auto-scaling — use the adaptive warehouse icon.
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
    # Gold = curated, BI-ready — the data-warehouse workload icon fits better
    # than a generic database icon.
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
    # Embedded Analytics icon reflects the BI/dashboard purpose.
    "TABLEAU_BLOCK":            {"label": "Tableau",           "detail": "BI dashboards",              "icon": "Snowflake_ICON_Embedded_Analytics.svg",  "category": "outcome",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/odbc-download"},
    "POWERBI_BLOCK":            {"label": "Power BI",          "detail": "BI dashboards",              "icon": "Snowflake_ICON_Embedded_Analytics.svg",  "category": "outcome",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/odbc-download"},
    # Row-level secured BI views map directly to the secure-view RA icon.
    "RLS_VIEW_BLOCK":           {"label": "RLS View",          "detail": "Row-level secured BI view",  "icon": "Snowflake_ICON_RA_View_Secure.svg",      "category": "outcome",
                                 "doc_url": "https://docs.snowflake.com/en/user-guide/security-row-intro"},
}

# --------------------------------------------------------------------------- #
# Fallback by category (when BLOCK_ID is not in the registry above)
# --------------------------------------------------------------------------- #
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


# --------------------------------------------------------------------------- #
# Zone assignment — groups blocks into named architectural zones for the
# 2D enterprise-style diagram layout (vs a single horizontal flow row).
#
# Zone order is significant: it determines left-to-right placement of
# zone columns in the rendered diagram.
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
    "storage":        "Bronze Layer",   # generic Database/Schema/View land here unless overridden
    "gold":           "Gold Layer",
    "security":       "Security & Governance",
    "bi":             "Consumption",
}

# Per-block override (some blocks fit better in a zone other than their
# raw BLOCK_CATEGORY would suggest).
BLOCK_TO_ZONE_OVERRIDE: dict[str, str] = {
    # Secure View / RLS View land in Security & Governance regardless of
    # whether they originate from "storage" or "bi" categories.
    "SECURE_VIEW_BLOCK": "Security & Governance",
    "RLS_VIEW_BLOCK":    "Security & Governance",
    # External Function is used as an outbound enrichment call — keep in
    # Transformation rather than External Sources.
    "EXTERNAL_FUNCTION_BLOCK": "Transformation",
    # Data shares are a consumption pattern.
    "DATA_SHARE_BLOCK": "Consumption",
}


# Each zone has its own visual identity (stripe + tinting) independent of
# the categories of the nodes that happen to live inside it. Without this,
# a zone like "Transformation" containing an "External Function" (onprem
# category) would inherit an orange stripe even though the zone itself is
# Snowflake-side.
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


def _zone_for(block_id: str, category: str) -> str:
    if block_id in BLOCK_TO_ZONE_OVERRIDE:
        return BLOCK_TO_ZONE_OVERRIDE[block_id]
    return CATEGORY_TO_ZONE.get((category or "").lower(), "Bronze Layer")


# --------------------------------------------------------------------------- #
# Public API
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

    - nodes : flat list with zone field per node
    - edges : sequential edges in input order (matches deployed UDF semantics)
    - zones : ordered list of {name, category, node_ids} for the 2D enterprise
              layout. Zone order follows ZONE_ORDER, restricted to zones that
              actually have at least one node.
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

    # ── Naming consistency: normalize medallion ↔ generic ──────────────────
    # If the architecture doesn't use at least 2 of the 3 medallion layers
    # (Bronze/Silver/Gold), rename to generic equivalents so zone labels
    # don't imply a medallion pattern that isn't actually present.
    medallion_zones = {"Bronze Layer", "Silver Layer", "Gold Layer"}
    present_medallion = medallion_zones & set(z["name"] for z in zones)
    if len(present_medallion) < 2:
        rename_map = {
            "Bronze Layer": "Raw Layer",
            "Silver Layer": "Curated Layer",
            "Gold Layer": "Serving Layer",
        }
        for z in zones:
            if z["name"] in rename_map:
                z["name"] = rename_map[z["name"]]
        # Also update node zone references
        for n in nodes:
            if n.get("zone") in rename_map:
                n["zone"] = rename_map[n["zone"]]

    return {"nodes": nodes, "edges": edges, "zones": zones}


def build_citations(nodes: list[dict[str, str]]) -> list[dict[str, str]]:
    """
    Auto-generate documentation citations from flow nodes.

    Produces one citation per unique doc_url found across nodes, preserving
    node order. Deduplicates by URL so that multiple nodes pointing to the
    same docs page (e.g. Bronze Table + Silver Table → create-table) produce
    only one citation entry.
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
