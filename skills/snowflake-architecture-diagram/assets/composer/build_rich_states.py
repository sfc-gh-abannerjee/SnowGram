#!/usr/bin/env python3
"""
Maintenance script — author/refresh the RICH_STATE field on every bundled
template JSON.

Each template's existing FULL_MERMAID_CODE is preserved (it's still consumed
by the live viewer's state.json path). This adds a parallel RICH_STATE field
so the standalone diagram_from_prompt.py one-shot can render through the
viewer's custom orthogonal engine instead of falling back to Mermaid default.

Run once after editing _SPECS below:
    python3 assets/composer/build_rich_states.py

Idempotent: re-running rewrites RICH_STATE based on the current _SPECS.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
_ASSETS = _HERE.parent
_TEMPLATES_DIR = _ASSETS / "templates"
_ICON_MANIFEST_PATH = _ASSETS / "icon_manifest.json"


def _load_icon_manifest() -> dict:
    return json.loads(_ICON_MANIFEST_PATH.read_text(encoding="utf-8"))


# Canonical Snowflake doc URLs used to attach citations per object_type.
_DOC_URLS = {
    "TABLE":             "https://docs.snowflake.com/en/sql-reference/sql/create-table",
    "DYNAMIC_TABLE":     "https://docs.snowflake.com/en/user-guide/dynamic-tables-about",
    "STREAM":            "https://docs.snowflake.com/en/user-guide/streams-intro",
    "TASK":              "https://docs.snowflake.com/en/user-guide/tasks-intro",
    "PIPE":              "https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro",
    "SNOWPIPE_STREAMING":"https://docs.snowflake.com/en/user-guide/snowpipe-streaming/data-load-snowpipe-streaming-overview",
    "STAGE":             "https://docs.snowflake.com/en/sql-reference/sql/create-stage",
    "VIEW":              "https://docs.snowflake.com/en/sql-reference/sql/create-view",
    "SECURE_VIEW":       "https://docs.snowflake.com/en/user-guide/views-secure",
    "MATERIALIZED_VIEW": "https://docs.snowflake.com/en/user-guide/views-materialized",
    "WAREHOUSE":         "https://docs.snowflake.com/en/user-guide/warehouses-overview",
    "MASKING_POLICY":    "https://docs.snowflake.com/en/user-guide/security-column-ddm-intro",
    "ROW_ACCESS_POLICY": "https://docs.snowflake.com/en/user-guide/security-row-intro",
    "ICEBERG_TABLE":     "https://docs.snowflake.com/en/user-guide/tables-iceberg",
    "HYBRID_TABLE":      "https://docs.snowflake.com/en/user-guide/tables-hybrid",
    "EXTERNAL_FUNCTION": "https://docs.snowflake.com/en/sql-reference/sql/create-external-function",
    "FUNCTION":          "https://docs.snowflake.com/en/sql-reference/sql/create-function",
    "TAG":               "https://docs.snowflake.com/en/user-guide/object-tagging",
    "ROLE":              "https://docs.snowflake.com/en/user-guide/security-access-control-overview",
    "S3":                "https://docs.snowflake.com/en/user-guide/data-load-s3",
    "AZURE_BLOB":        "https://docs.snowflake.com/en/user-guide/data-load-azure",
    "GCS":               "https://docs.snowflake.com/en/user-guide/data-load-gcs",
    "KAFKA":             "https://docs.snowflake.com/en/user-guide/kafka-connector",
    "IOT":               "https://docs.snowflake.com/en/user-guide/snowpipe-streaming/data-load-snowpipe-streaming-overview",
    "DATA_SHARE":        "https://docs.snowflake.com/en/user-guide/data-sharing-intro",
    "MARKETPLACE":       "https://docs.snowflake.com/en/user-guide/data-marketplace",
    "BI_TOOL":           "https://docs.snowflake.com/en/user-guide/odbc-download",
    "STREAMLIT":         "https://docs.snowflake.com/en/developer-guide/streamlit/about-streamlit",
    "SNOWPARK":          "https://docs.snowflake.com/en/developer-guide/snowpark/index",
    "CORTEX":            "https://docs.snowflake.com/en/user-guide/snowflake-cortex/overview",
    "SPCS":              "https://docs.snowflake.com/en/developer-guide/snowpark-container-services/overview",
    "WEB_APP":           "https://docs.snowflake.com/en/developer-guide/streamlit/about-streamlit",
    "NATIVE_APP":        "https://docs.snowflake.com/en/developer-guide/native-apps/native-apps-about",
}

_OBJECT_TYPE_ALIASES = {
    "SNOWPIPE_STREAMING": "PIPE",
    "TABLEAU": "BI_TOOL",
    "POWERBI": "BI_TOOL",
    "POWER_BI": "BI_TOOL",
    "LOOKER": "BI_TOOL",
    "FIVETRAN": "S3",
    "AIRBYTE": "S3",
    "POSTGRES": "S3",
    "API_GATEWAY": "EXTERNAL_FUNCTION",
    "LAMBDA": "EXTERNAL_FUNCTION",
    "AZURE_FUNCTION": "EXTERNAL_FUNCTION",
    "KINESIS": "KAFKA",
    "ML_MODEL": "FUNCTION",
    "FEATURE_STORE": "TABLE",
    "MODEL_REGISTRY": "FUNCTION",
    "CDP": "TABLE",
    "PROFILE_TABLE": "TABLE",
    "ACTIVATION": "BI_TOOL",
    "PROCEDURE": "STORED_PROCEDURE",
    "STORED_PROCEDURE": "STORED_PROCEDURE",
}


def _icon_for(object_type: str, manifest: dict) -> tuple[str, str]:
    key = _OBJECT_TYPE_ALIASES.get(object_type, object_type)
    entry = manifest.get(key)
    if entry and isinstance(entry, dict) and "icon" in entry:
        return entry["icon"], entry["category"]
    ext = manifest.get("_external_systems", {}).get(key)
    if ext:
        return ext["icon"], ext["category"]
    cons = manifest.get("_consumption", {}).get(key)
    if cons:
        return cons["icon"], cons["category"]
    fb = manifest.get(
        "_fallback", {"icon": "Snowflake_ICON_Architecture.svg", "category": "snow"}
    )
    return fb["icon"], fb["category"]


# ===========================================================================
# Per-template specs.
#
# Each spec is a list of stage entries:
#   {id, label, detail, object_type, zone, category(optional override)}
# Edges are produced sequentially in the listed order, with extra branch edges
# defined by `extra_edges` per template if needed.
# ===========================================================================


def _build_state(
    title: str,
    subtitle: str,
    spec: list[dict[str, Any]],
    *,
    extra_edges: list[tuple[str, str]] | None = None,
    zone_categories: dict[str, str] | None = None,
    manifest: dict | None = None,
    explicit_edges_only: bool = False,
) -> dict[str, Any]:
    if manifest is None:
        manifest = _load_icon_manifest()

    nodes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in spec:
        nid = entry["id"]
        if nid in seen:
            raise ValueError(f"Duplicate node id: {nid}")
        seen.add(nid)

        ot = entry["object_type"]
        icon, default_cat = _icon_for(ot, manifest)
        category = entry.get("category", default_cat)
        node = {
            "id": nid,
            "label": entry["label"],
            "detail": entry.get("detail", ""),
            "icon": icon,
            "category": category,
            "zone": entry["zone"],
            "object_type": ot,
            "stage": entry.get("stage"),
        }
        doc = entry.get("doc_url") or _DOC_URLS.get(_OBJECT_TYPE_ALIASES.get(ot, ot)) or _DOC_URLS.get(ot)
        if doc:
            node["doc_url"] = doc
        # Strip None fields to keep the JSON tidy.
        node = {k: v for k, v in node.items() if v is not None}
        nodes.append(node)

    edges: list[dict[str, str]] = []
    if not explicit_edges_only:
        # Sequential edges along the spec order.
        for i in range(1, len(nodes)):
            edges.append({"source": nodes[i - 1]["id"], "target": nodes[i]["id"]})
    if extra_edges:
        for s, t in extra_edges:
            if not any(e["source"] == s and e["target"] == t for e in edges):
                edges.append({"source": s, "target": t})

    # Group nodes by zone in declaration order.
    zone_order: list[str] = []
    by_zone: dict[str, list[str]] = {}
    for n in nodes:
        z = n["zone"]
        if z not in by_zone:
            by_zone[z] = []
            zone_order.append(z)
        by_zone[z].append(n["id"])

    zones: list[dict[str, Any]] = []
    for z in zone_order:
        cats = [next(n["category"] for n in nodes if n["id"] == nid) for nid in by_zone[z]]
        cat = (zone_categories or {}).get(z) or max(set(cats), key=cats.count)
        zones.append({"name": z, "category": cat, "node_ids": by_zone[z]})

    return {
        "title": title,
        "subtitle": subtitle,
        "nodes": nodes,
        "edges": edges,
        "zones": zones,
    }


# --- Per-template specifications ------------------------------------------- #

def _spec_medallion_lakehouse() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "Medallion Architecture (Bronze-Silver-Gold)",
        "External cloud storage → Bronze → Silver → Gold → BI",
        [
            {"id": "s3",    "label": "AWS S3",       "detail": "Data lake source",       "object_type": "S3",            "zone": "External Sources", "stage": "source"},
            {"id": "stage", "label": "External Stage","detail": "Snowflake-managed stage","object_type": "STAGE",         "zone": "Ingestion",        "stage": "ingestion"},
            {"id": "pipe",  "label": "Snowpipe",     "detail": "Auto-ingest, separate from streaming WH", "object_type": "PIPE", "zone": "Ingestion","stage": "ingestion"},
            {"id": "bronze","label": "Bronze Tables","detail": "Append-only raw, VARIANT for JSON",       "object_type": "TABLE","zone": "Bronze Layer","stage": "raw_storage"},
            {"id": "stream","label": "Bronze Stream","detail": "CDC over raw",                            "object_type": "STREAM","zone": "Bronze Layer","stage": "transformation"},
            {"id": "silver","label": "Silver Tables","detail": "Cleaned, conformed, deduped",             "object_type": "DYNAMIC_TABLE","zone": "Silver Layer","stage": "curated_storage"},
            {"id": "gold",  "label": "Gold Tables",  "detail": "Business-ready aggregates",               "object_type": "DYNAMIC_TABLE","zone": "Gold Layer","stage": "serving"},
            {"id": "bi",    "label": "BI Platform",  "detail": "Dashboards & reports",                    "object_type": "BI_TOOL","zone": "Consumption","stage": "consumption"},
        ],
        None,
    )


def _spec_medallion_snowflake_only() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "Medallion Architecture (Snowflake-Only)",
        "All-Snowflake medallion: Stages → Bronze → Silver → Gold → BI",
        [
            {"id": "stage", "label": "Internal Stage","detail": "Snowflake-managed staging","object_type": "STAGE","zone": "Ingestion","stage": "ingestion"},
            {"id": "pipe",  "label": "Snowpipe",      "detail": "Auto-ingest from stage",   "object_type": "PIPE", "zone": "Ingestion","stage": "ingestion"},
            {"id": "bronze","label": "Bronze Tables", "detail": "Raw landing tables",        "object_type": "TABLE","zone": "Bronze Layer","stage": "raw_storage"},
            {"id": "silver","label": "Silver Dynamic Tables","detail": "Declarative cleansing","object_type": "DYNAMIC_TABLE","zone": "Silver Layer","stage": "curated_storage"},
            {"id": "gold",  "label": "Gold Dynamic Tables",  "detail": "Aggregated marts",     "object_type": "DYNAMIC_TABLE","zone": "Gold Layer","stage": "serving"},
            {"id": "bi",    "label": "BI Platform",          "detail": "Reports & dashboards", "object_type": "BI_TOOL","zone": "Consumption","stage": "consumption"},
        ],
        None,
    )


def _spec_streaming() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "Streaming Data Stack",
        "Kafka → Snowpipe Streaming → Dynamic Tables → Real-time analytics",
        [
            {"id": "kafka", "label": "Kafka",                "detail": "Streaming topic",             "object_type": "KAFKA","zone": "External Sources","stage": "source"},
            {"id": "pipe",  "label": "Snowpipe Streaming",   "detail": "Sub-second row-level ingest", "object_type": "SNOWPIPE_STREAMING","zone": "Ingestion","stage": "ingestion"},
            {"id": "raw",   "label": "Raw Stream Table",     "detail": "Append-only events",          "object_type": "TABLE","zone": "Raw Layer","stage": "raw_storage"},
            {"id": "dt1",   "label": "Dynamic Table",        "detail": "Real-time aggregation",        "object_type": "DYNAMIC_TABLE","zone": "Curated Layer","stage": "transformation"},
            {"id": "dt2",   "label": "Serving Dynamic Table","detail": "Business-ready stream output","object_type": "DYNAMIC_TABLE","zone": "Serving Layer","stage": "serving"},
            {"id": "bi",    "label": "Real-time Dashboard",  "detail": "Live operational view",        "object_type": "BI_TOOL","zone": "Consumption","stage": "consumption"},
        ],
        None,
    )


def _spec_security_analytics() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "Security Analytics (SIEM on Snowflake)",
        "Log sources → Ingest → Search Optimization → Detection rules → SOC",
        [
            {"id": "logs",  "label": "Log Sources",        "detail": "Cloud / endpoint / network",  "object_type": "S3","zone": "External Sources","stage": "source"},
            {"id": "pipe",  "label": "Snowpipe Streaming", "detail": "High-volume log ingest",       "object_type": "SNOWPIPE_STREAMING","zone": "Ingestion","stage": "ingestion"},
            {"id": "raw",   "label": "Raw Logs",           "detail": "VARIANT semi-structured",     "object_type": "TABLE","zone": "Raw Layer","stage": "raw_storage"},
            {"id": "sos",   "label": "Search Optimization","detail": "Point-lookup acceleration",   "object_type": "FUNCTION","zone": "Curated Layer","stage": "transformation"},
            {"id": "rules", "label": "Detection Rules",    "detail": "Streams + Tasks alerting",    "object_type": "TASK","zone": "Curated Layer","stage": "transformation"},
            {"id": "alerts","label": "Alert Tables",       "detail": "Triaged incidents",            "object_type": "TABLE","zone": "Serving Layer","stage": "serving"},
            {"id": "soc",   "label": "SOC Dashboard",      "detail": "Investigator UI",              "object_type": "BI_TOOL","zone": "Consumption","stage": "consumption"},
        ],
        None,
    )


def _spec_customer_360() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "Customer 360 / CDP",
        "CRM + Web + App data → Identity resolution → Profiles → Activation",
        [
            {"id": "crm",     "label": "CRM",            "detail": "Salesforce / HubSpot",        "object_type": "S3","zone": "External Sources","stage": "source"},
            {"id": "web",     "label": "Web Events",     "detail": "Clickstream / analytics",     "object_type": "KAFKA","zone": "External Sources","stage": "source"},
            {"id": "app",     "label": "Mobile App",     "detail": "Product telemetry",            "object_type": "KAFKA","zone": "External Sources","stage": "source"},
            {"id": "ingest",  "label": "Snowpipe Streaming","detail": "Multi-source ingest",       "object_type": "SNOWPIPE_STREAMING","zone": "Ingestion","stage": "ingestion"},
            {"id": "raw",     "label": "Raw Events",     "detail": "Cross-system landing",        "object_type": "TABLE","zone": "Raw Layer","stage": "raw_storage"},
            {"id": "identity","label": "Identity Resolution","detail": "Stitching / dedupe",       "object_type": "DYNAMIC_TABLE","zone": "Curated Layer","stage": "transformation"},
            {"id": "profile", "label": "Customer Profiles","detail": "Unified 360° view",          "object_type": "DYNAMIC_TABLE","zone": "Serving Layer","stage": "serving"},
            {"id": "ml",      "label": "Cortex ML",      "detail": "Propensity / churn scoring",  "object_type": "CORTEX","zone": "Serving Layer","stage": "serving"},
            {"id": "activate","label": "Activation",     "detail": "Reverse ETL / campaigns",     "object_type": "BI_TOOL","zone": "Consumption","stage": "consumption"},
        ],
        [("crm", "ingest"), ("web", "ingest"), ("app", "ingest"), ("profile", "activate"), ("ml", "activate")],
    )


def _spec_ml_feature_engineering() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "ML Feature Engineering & Serving",
        "Source → Feature pipelines → Model Registry → Inference (Cortex / SPCS)",
        [
            {"id": "src",     "label": "Source Data",        "detail": "Curated business tables",   "object_type": "TABLE","zone": "Raw Layer","stage": "raw_storage"},
            {"id": "feat_dt", "label": "Feature Dynamic Tables","detail": "Declarative feature views","object_type": "DYNAMIC_TABLE","zone": "Curated Layer","stage": "transformation"},
            {"id": "fs",      "label": "Feature Store",      "detail": "Versioned feature tables",   "object_type": "TABLE","zone": "Curated Layer","stage": "curated_storage"},
            {"id": "registry","label": "Model Registry",     "detail": "Snowpark ML registry",       "object_type": "MODEL_REGISTRY","zone": "Serving Layer","stage": "serving"},
            {"id": "udf",     "label": "Inference UDF",      "detail": "Snowpark / Cortex inference","object_type": "FUNCTION","zone": "Serving Layer","stage": "serving"},
            {"id": "spcs",    "label": "SPCS Service",       "detail": "Container-hosted models",    "object_type": "SPCS","zone": "Serving Layer","stage": "serving"},
            {"id": "app",     "label": "ML-powered App",     "detail": "Streamlit / REST consumer",   "object_type": "STREAMLIT","zone": "Consumption","stage": "consumption"},
        ],
        [("registry", "udf"), ("registry", "spcs"), ("udf", "app"), ("spcs", "app")],
    )


def _spec_batch_dwh() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "Batch Data Warehouse (Star Schema)",
        "File drops → Snowpipe → Staging → Star schema → Reports",
        [
            {"id": "files", "label": "File Drops",   "detail": "Nightly batch CSV / Parquet",  "object_type": "S3","zone": "External Sources","stage": "source"},
            {"id": "stage", "label": "External Stage","detail": "Snowflake-managed staging",   "object_type": "STAGE","zone": "Ingestion","stage": "ingestion"},
            {"id": "pipe",  "label": "Snowpipe",     "detail": "Auto-ingest on file arrival", "object_type": "PIPE","zone": "Ingestion","stage": "ingestion"},
            {"id": "raw",   "label": "Staging Tables","detail": "Append-only landing",         "object_type": "TABLE","zone": "Raw Layer","stage": "raw_storage"},
            {"id": "dim",   "label": "Dimension Tables","detail": "SCD Type 2 conformed dims","object_type": "DYNAMIC_TABLE","zone": "Curated Layer","stage": "transformation"},
            {"id": "fact",  "label": "Fact Tables",  "detail": "Star-schema facts",            "object_type": "DYNAMIC_TABLE","zone": "Serving Layer","stage": "serving"},
            {"id": "bi",    "label": "BI Platform",  "detail": "Scheduled reports",            "object_type": "BI_TOOL","zone": "Consumption","stage": "consumption"},
        ],
        [("dim", "fact")],
    )


def _spec_iot() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "Real-Time IoT Pipeline",
        "Devices → MQTT broker → Streaming ingest → Time-series → Operations",
        [
            {"id": "devices","label": "IoT Devices",     "detail": "Sensors / edge gateways",   "object_type": "IOT","zone": "External Sources","stage": "source"},
            {"id": "mqtt",   "label": "MQTT Broker",     "detail": "Pub/sub fan-in",            "object_type": "IOT","zone": "External Sources","stage": "source"},
            {"id": "pipe",   "label": "Snowpipe Streaming","detail": "Sub-second sensor ingest","object_type": "SNOWPIPE_STREAMING","zone": "Ingestion","stage": "ingestion"},
            {"id": "raw",    "label": "Time-Series Table","detail": "Raw sensor readings",      "object_type": "TABLE","zone": "Raw Layer","stage": "raw_storage"},
            {"id": "dt",     "label": "Dynamic Table",   "detail": "Windowed rollups",          "object_type": "DYNAMIC_TABLE","zone": "Curated Layer","stage": "transformation"},
            {"id": "anomaly","label": "Anomaly Output",  "detail": "Threshold breach signals",  "object_type": "DYNAMIC_TABLE","zone": "Serving Layer","stage": "serving"},
            {"id": "ops",    "label": "Operations App",  "detail": "Live monitoring",            "object_type": "STREAMLIT","zone": "Consumption","stage": "consumption"},
        ],
        [("devices", "mqtt")],
    )


def _spec_governance() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "Data Governance & Compliance",
        "Tagged sensitive data → Masking + RLS → Secure views → Compliant access",
        [
            {"id": "src",      "label": "Source Tables",    "detail": "Customer / transaction data","object_type": "TABLE","zone": "Raw Layer","stage": "raw_storage"},
            {"id": "tag",      "label": "Object Tags",      "detail": "PII / SENSITIVE classification","object_type": "TAG","zone": "Security & Governance","stage": "security"},
            {"id": "mask",     "label": "Masking Policy",   "detail": "Column-level dynamic masking","object_type": "MASKING_POLICY","zone": "Security & Governance","stage": "security"},
            {"id": "rls",      "label": "Row Access Policy","detail": "Row-level security",          "object_type": "ROW_ACCESS_POLICY","zone": "Security & Governance","stage": "security"},
            {"id": "roles",    "label": "Functional Roles", "detail": "RBAC enforcement",            "object_type": "ROLE","zone": "Security & Governance","stage": "security"},
            {"id": "secview",  "label": "Secure View",      "detail": "Policy-enforced access",       "object_type": "SECURE_VIEW","zone": "Serving Layer","stage": "serving"},
            {"id": "consumers","label": "Analysts & Apps",  "detail": "Role-scoped consumption",     "object_type": "BI_TOOL","zone": "Consumption","stage": "consumption"},
        ],
        # Branching edges only (no back-edges). Sequential chain already covers
        # src → tag → mask → rls → roles → secview → consumers.
        [("tag", "mask"), ("tag", "rls"), ("mask", "secview"), ("rls", "secview")],
    )


def _spec_embedded_analytics() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "Embedded Analytics",
        "Operational app → Hybrid Tables → Multi-cluster WH → Embedded UI",
        [
            {"id": "app",      "label": "Operational App",   "detail": "OLTP-style writes",          "object_type": "WEB_APP","zone": "External Sources","stage": "source"},
            {"id": "hybrid",   "label": "Hybrid Table",      "detail": "OLTP + analytics",            "object_type": "HYBRID_TABLE","zone": "Curated Layer","stage": "curated_storage"},
            {"id": "dt",       "label": "Aggregation DT",    "detail": "Materialized rollups",        "object_type": "DYNAMIC_TABLE","zone": "Serving Layer","stage": "serving"},
            {"id": "wh",       "label": "Multi-Cluster WH",  "detail": "Auto-scale concurrency",      "object_type": "WAREHOUSE","zone": "Serving Layer","stage": "serving"},
            {"id": "embed",    "label": "Embedded Dashboard","detail": "Customer-facing analytics",   "object_type": "STREAMLIT","zone": "Consumption","stage": "consumption"},
        ],
        [("hybrid", "dt"), ("dt", "embed"), ("wh", "embed")],
    )


def _spec_data_mesh() -> tuple[str, str, list[dict], list[tuple[str, str]] | None, dict]:
    return (
        "Multi-Cloud Data Mesh",
        "Domain accounts (AWS / Azure / GCP) → Cross-cloud sharing → Federated views",
        [
            {"id": "aws",     "label": "AWS Domain",       "detail": "Customer & sales data",     "object_type": "DATABASE","zone": "Domain (AWS)","stage": "raw_storage"},
            {"id": "azure",   "label": "Azure Domain",     "detail": "Product & inventory data",  "object_type": "DATABASE","zone": "Domain (Azure)","stage": "raw_storage"},
            {"id": "gcp",     "label": "GCP Domain",       "detail": "Marketing & web data",      "object_type": "DATABASE","zone": "Domain (GCP)","stage": "raw_storage"},
            {"id": "share",   "label": "Cross-Cloud Share","detail": "Secure Data Sharing",        "object_type": "DATA_SHARE","zone": "Mesh Layer","stage": "transformation"},
            {"id": "fed",     "label": "Federated Views",  "detail": "Mesh-wide query layer",     "object_type": "VIEW","zone": "Serving Layer","stage": "serving"},
            {"id": "consumers","label": "Domain Consumers","detail": "Each team queries the mesh","object_type": "BI_TOOL","zone": "Consumption","stage": "consumption"},
        ],
        # Explicit edges only — domains are PARALLEL, not sequential.
        [("aws", "share"), ("azure", "share"), ("gcp", "share"), ("share", "fed"), ("fed", "consumers")],
        {"explicit_edges_only": True},
    )


def _spec_serverless() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "Serverless Data Stack",
        "Event sources → Functions → Snowpipe → Cortex / Streamlit",
        [
            {"id": "event",  "label": "Event Source",     "detail": "API Gateway / queue",      "object_type": "S3","zone": "External Sources","stage": "source"},
            {"id": "lambda", "label": "Lambda / Function","detail": "Serverless transform",      "object_type": "EXTERNAL_FUNCTION","zone": "Ingestion","stage": "ingestion"},
            {"id": "pipe",   "label": "Snowpipe Streaming","detail": "Push to Snowflake",        "object_type": "SNOWPIPE_STREAMING","zone": "Ingestion","stage": "ingestion"},
            {"id": "raw",    "label": "Event Tables",     "detail": "VARIANT payload",           "object_type": "TABLE","zone": "Raw Layer","stage": "raw_storage"},
            {"id": "dt",     "label": "Dynamic Table",    "detail": "Declarative aggregation",   "object_type": "DYNAMIC_TABLE","zone": "Serving Layer","stage": "serving"},
            {"id": "cortex", "label": "Cortex AI",        "detail": "Embedded LLM / vector",     "object_type": "CORTEX","zone": "Serving Layer","stage": "serving"},
            {"id": "app",    "label": "Streamlit App",    "detail": "Serverless data app",       "object_type": "STREAMLIT","zone": "Consumption","stage": "consumption"},
        ],
        [("dt", "app"), ("cortex", "app")],
    )


def _spec_realtime_financial() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "Real-Time Financial Transactions",
        "Card / payment events → Streaming ingest → Fraud scoring → Alerts",
        [
            {"id": "events",  "label": "Transaction Events","detail": "Card swipes / payments",   "object_type": "KAFKA","zone": "External Sources","stage": "source"},
            {"id": "pipe",    "label": "Snowpipe Streaming","detail": "Sub-second ingest",         "object_type": "SNOWPIPE_STREAMING","zone": "Ingestion","stage": "ingestion"},
            {"id": "raw",     "label": "Raw Transactions",  "detail": "Append-only",                "object_type": "TABLE","zone": "Raw Layer","stage": "raw_storage"},
            {"id": "fraud_dt","label": "Fraud Scoring DT",   "detail": "Real-time enrichment",       "object_type": "DYNAMIC_TABLE","zone": "Curated Layer","stage": "transformation"},
            {"id": "model",   "label": "Cortex ML Model",    "detail": "Anomaly classifier",         "object_type": "CORTEX","zone": "Curated Layer","stage": "transformation"},
            {"id": "alerts",  "label": "Alerts Table",       "detail": "Flagged transactions",       "object_type": "TABLE","zone": "Serving Layer","stage": "serving"},
            {"id": "ops",     "label": "Fraud Ops Console",  "detail": "Investigator UI",            "object_type": "STREAMLIT","zone": "Consumption","stage": "consumption"},
        ],
        [("model", "fraud_dt")],
    )


def _spec_hybrid_lakehouse() -> tuple[str, str, list[dict], list[tuple[str, str]] | None]:
    return (
        "Hybrid Cloud Lakehouse (Iceberg)",
        "External Iceberg catalog → Snowflake-managed Iceberg → Dynamic Tables → AI/BI",
        [
            {"id": "catalog","label": "External Catalog","detail": "AWS Glue / Polaris",          "object_type": "S3","zone": "External Sources","stage": "source"},
            {"id": "iceberg","label": "Iceberg Tables",  "detail": "Open table format",            "object_type": "ICEBERG_TABLE","zone": "Raw Layer","stage": "raw_storage"},
            {"id": "dt",     "label": "Dynamic Tables",  "detail": "Refreshed transforms",         "object_type": "DYNAMIC_TABLE","zone": "Curated Layer","stage": "transformation"},
            {"id": "serve",  "label": "Serving Iceberg", "detail": "Read across engines",          "object_type": "ICEBERG_TABLE","zone": "Serving Layer","stage": "serving"},
            {"id": "cortex", "label": "Cortex AI",       "detail": "LLM / search over lakehouse", "object_type": "CORTEX","zone": "Serving Layer","stage": "serving"},
            {"id": "bi",     "label": "BI / Spark",      "detail": "Engine-agnostic consumption", "object_type": "BI_TOOL","zone": "Consumption","stage": "consumption"},
        ],
        [("dt", "serve"), ("serve", "cortex"), ("cortex", "bi")],
    )


_SPECS = {
    "MEDALLION_LAKEHOUSE":              _spec_medallion_lakehouse,
    "MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY": _spec_medallion_snowflake_only,
    "STREAMING_DATA_STACK":             _spec_streaming,
    "SECURITY_ANALYTICS":               _spec_security_analytics,
    "CUSTOMER_360":                     _spec_customer_360,
    "ML_FEATURE_ENGINEERING":           _spec_ml_feature_engineering,
    "BATCH_DATA_WAREHOUSE":             _spec_batch_dwh,
    "REALTIME_IOT_PIPELINE":            _spec_iot,
    "DATA_GOVERNANCE_COMPLIANCE":       _spec_governance,
    "EMBEDDED_ANALYTICS":               _spec_embedded_analytics,
    "MULTI_CLOUD_DATA_MESH":            _spec_data_mesh,
    "SERVERLESS_DATA_STACK":            _spec_serverless,
    "REALTIME_FINANCIAL_TRANSACTIONS":  _spec_realtime_financial,
    "HYBRID_CLOUD_LAKEHOUSE":           _spec_hybrid_lakehouse,
}


def main() -> int:
    manifest = _load_icon_manifest()
    files = sorted(_TEMPLATES_DIR.glob("*.json"))
    files = [f for f in files if f.name != "_index.json"]

    written = 0
    for fp in files:
        tmpl = json.loads(fp.read_text(encoding="utf-8"))
        tid = tmpl.get("TEMPLATE_ID") or fp.stem
        if tid not in _SPECS:
            print(f"WARN: no spec for {tid}; skipping", flush=True)
            continue

        spec_result = _SPECS[tid]()
        # Some templates return a 5-tuple with extra options; default the rest.
        if len(spec_result) == 4:
            title, subtitle, spec, extra_edges = spec_result
            options: dict = {}
        else:
            title, subtitle, spec, extra_edges, options = spec_result

        rich_state = _build_state(
            title, subtitle, spec,
            extra_edges=extra_edges, manifest=manifest,
            **options,
        )
        tmpl["RICH_STATE"] = rich_state
        fp.write_text(json.dumps(tmpl, indent=2) + "\n", encoding="utf-8")
        written += 1
        print(f"✓ {tid}: {len(rich_state['nodes'])} nodes, "
              f"{len(rich_state['edges'])} edges, {len(rich_state['zones'])} zones")

    print(f"Wrote RICH_STATE to {written} template(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
