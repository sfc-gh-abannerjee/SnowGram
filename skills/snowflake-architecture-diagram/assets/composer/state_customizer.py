"""
State customizer — apply prompt-driven additions to a baseline diagram state.

Runs AFTER knowledge_pack.apply_pack() so user prompt overrides general
best-practice defaults if there's a conflict (e.g. user explicitly asks for
"Tableau" — that overrides any "BI_TOOL" recommended by `snowflake-best-practices`).

Conservative additions only: never delete template-asserted nodes. The
guarantee is that a state passing through `customize()` is a strict superset
in component coverage; existing edges are preserved.

Public API:
    customize(state, prompt) -> state
"""

from __future__ import annotations

import re
from typing import Any, Optional


# Source classes — mirrors intent_router.SOURCE_CLASSES so prompts that mention
# a specific source result in that node being present.
_SOURCE_TRIGGERS: dict[str, dict[str, str]] = {
    "s3": {
        "label": "AWS S3",
        "detail": "Object store / data lake",
        "icon": "Snowflake_ICON_Workloads_Data_Lake.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/data-load-s3",
        "object_type": "S3",
    },
    "azure_blob": {
        "label": "Azure Blob",
        "detail": "ADLS / Blob Storage",
        "icon": "Snowflake_ICON_Workloads_Data_Lake.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/data-load-azure",
        "object_type": "AZURE_BLOB",
    },
    "gcs": {
        "label": "Google Cloud Storage",
        "detail": "GCS bucket",
        "icon": "Snowflake_ICON_Workloads_Data_Lake.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/data-load-gcs",
        "object_type": "GCS",
    },
    "kafka": {
        "label": "Kafka",
        "detail": "Streaming topic",
        "icon": "Snowflake_ICON_Kafka_Connectors.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/kafka-connector",
        "object_type": "KAFKA",
    },
    "kinesis": {
        "label": "Kinesis",
        "detail": "AWS streaming source",
        "icon": "Snowflake_ICON_Kafka_Connectors.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/snowpipe-streaming/data-load-snowpipe-streaming-overview",
        "object_type": "KINESIS",
    },
    "mqtt": {
        "label": "MQTT Broker",
        "detail": "IoT pub/sub",
        "icon": "Snowflake_ICON_IoT.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/snowpipe-streaming/data-load-snowpipe-streaming-overview",
        "object_type": "IOT",
    },
    "iceberg": {
        "label": "Iceberg Table",
        "detail": "External catalog",
        "icon": "Snowflake_ICON_RA_Iceberg_Table.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/tables-iceberg",
        "object_type": "ICEBERG_TABLE",
    },
    "fivetran": {
        "label": "Fivetran",
        "detail": "Managed ELT connector",
        "icon": "Snowflake_ICON_Architecture.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/data-pipelines",
        "object_type": "FIVETRAN",
    },
    "airbyte": {
        "label": "Airbyte",
        "detail": "Open-source ELT connector",
        "icon": "Snowflake_ICON_Architecture.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/data-pipelines",
        "object_type": "AIRBYTE",
    },
    "postgres": {
        "label": "PostgreSQL",
        "detail": "External relational source",
        "icon": "Snowflake_ICON_Architecture.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/data-pipelines",
        "object_type": "POSTGRES",
    },
}

_SOURCE_PATTERNS: dict[str, list[str]] = {
    "s3":         ["s3", "aws s3", "object store", "data lake bucket"],
    "azure_blob": ["azure blob", "adls", "azure storage"],
    "gcs":        ["gcs", "google cloud storage"],
    "kafka":      ["kafka", "msk", "confluent"],
    "kinesis":    ["kinesis"],
    "mqtt":       ["mqtt"],
    "iceberg":    ["iceberg"],
    "fivetran":   ["fivetran"],
    "airbyte":    ["airbyte"],
    "postgres":   ["postgres", "postgresql"],
}

# BI / consumption swaps.
_CONSUMPTION_TRIGGERS: dict[str, dict[str, str]] = {
    "tableau": {
        "label": "Tableau",
        "detail": "Interactive dashboards",
        "icon": "Snowflake_ICON_Embedded_Analytics.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/odbc-download",
        "object_type": "TABLEAU",
    },
    "powerbi": {
        "label": "Power BI",
        "detail": "Microsoft BI",
        "icon": "Snowflake_ICON_Embedded_Analytics.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/odbc-download",
        "object_type": "POWERBI",
    },
    "looker": {
        "label": "Looker",
        "detail": "BI / semantic layer",
        "icon": "Snowflake_ICON_Embedded_Analytics.svg",
        "doc_url": "https://docs.snowflake.com/en/user-guide/odbc-download",
        "object_type": "LOOKER",
    },
    "streamlit": {
        "label": "Streamlit",
        "detail": "In-Snowflake data app",
        "icon": "Snowflake_ICON_Embedded_Analytics.svg",
        "doc_url": "https://docs.snowflake.com/en/developer-guide/streamlit/about-streamlit",
        "object_type": "STREAMLIT",
    },
}

_CONSUMPTION_PATTERNS: dict[str, list[str]] = {
    "tableau":   ["tableau"],
    "powerbi":   ["power bi", "powerbi", "power-bi"],
    "looker":    ["looker"],
    "streamlit": ["streamlit"],
}

# Security overlays — added when masking / RLS / PII signals appear.
_SECURITY_PATTERNS: list[str] = ["pii", "masking", "row level security", "rls", "row access policy", "sensitive data"]


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().strip())


def _detect_classes(prompt_norm: str, table: dict[str, list[str]]) -> list[str]:
    hits: list[str] = []
    for cls, triggers in table.items():
        if any(t in prompt_norm for t in triggers):
            hits.append(cls)
    return hits


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_") or "node"


def _has_object(state: dict[str, Any], object_type: str) -> bool:
    """
    Heuristic: is a node representing this object_type already in state?
    Matches by `object_type`, by canonical label (e.g. "AWS S3"), or by
    keyword in label/detail (e.g. "S3" appearing in any label/detail).
    """
    ot = (object_type or "").upper()
    canonical_label = (object_type or "").replace("_", " ").lower()
    keyword = canonical_label.split()[0] if canonical_label else ""
    for n in state.get("nodes") or []:
        if (n.get("object_type") or "").upper() == ot:
            return True
        if (n.get("label") or "").lower() == canonical_label:
            return True
        # Substring match on label/detail handles compose-path nodes that
        # use BLOCK_REGISTRY labels like "AWS S3" / "Iceberg Table".
        if keyword:
            label_l = (n.get("label") or "").lower()
            detail_l = (n.get("detail") or "").lower()
            if keyword in label_l or keyword in detail_l:
                return True
    return False


def _first_node_in_zone(state: dict[str, Any], zone_name: str) -> Optional[dict[str, Any]]:
    for n in state.get("nodes") or []:
        if (n.get("zone") or "").lower() == zone_name.lower():
            return n
    return None


def _ensure_zone(state: dict[str, Any], name: str, category: str) -> dict[str, Any]:
    """Find a zone by name, creating it if missing."""
    for z in state.get("zones") or []:
        if (z.get("name") or "").lower() == name.lower():
            return z
    new_zone = {"name": name, "category": category, "node_ids": []}
    state.setdefault("zones", []).append(new_zone)
    return new_zone


def _add_node_to_zone(state: dict[str, Any], node: dict[str, Any], zone_name: str, category: str) -> None:
    state.setdefault("nodes", []).append(node)
    z = _ensure_zone(state, zone_name, category)
    z.setdefault("node_ids", []).append(node["id"])


def _add_edge(state: dict[str, Any], src: str, tgt: str) -> None:
    edges = state.setdefault("edges", [])
    if any(e.get("source") == src and e.get("target") == tgt for e in edges):
        return
    edges.append({"source": src, "target": tgt})


def _unique_id(state: dict[str, Any], base: str) -> str:
    existing = {n.get("id") for n in state.get("nodes") or []}
    if base not in existing:
        return base
    i = 2
    while f"{base}_{i}" in existing:
        i += 1
    return f"{base}_{i}"


def _add_source(state: dict[str, Any], src_class: str) -> None:
    spec = _SOURCE_TRIGGERS.get(src_class)
    if not spec:
        return
    if _has_object(state, spec["object_type"]):
        return
    nid = _unique_id(state, _slug(spec["label"]))
    node = {
        "id": nid,
        "label": spec["label"],
        "detail": spec["detail"],
        "icon": spec["icon"],
        "category": "onprem",
        "zone": "External Sources",
        "doc_url": spec["doc_url"],
        "object_type": spec["object_type"],
        "stage": "source",
    }
    _add_node_to_zone(state, node, "External Sources", "onprem")

    # Wire to the first ingestion node, or the first non-source node, so the
    # diagram stays connected.
    target = (
        _first_node_in_zone(state, "Ingestion")
        or _first_node_in_zone(state, "Raw Layer")
        or _first_node_in_zone(state, "Bronze Layer")
    )
    if target is None:
        # Fall back to the second node in the diagram (skip the new source).
        nodes = [n for n in state.get("nodes") or [] if n["id"] != nid]
        if nodes:
            target = nodes[0]
    if target:
        _add_edge(state, nid, target["id"])


def _swap_consumption(state: dict[str, Any], cls: str) -> None:
    spec = _CONSUMPTION_TRIGGERS.get(cls)
    if not spec:
        return
    if _has_object(state, spec["object_type"]):
        return

    # Find an existing consumption node; swap label/icon/detail in place to
    # keep the topology intact. Add a new one only if no consumption node
    # exists at all.
    target = None
    for n in state.get("nodes") or []:
        if (n.get("category") or "").lower() == "outcome" and \
           (n.get("zone") or "").lower() in {"consumption", "analytics", "consumption layer"}:
            target = n
            break

    if target:
        target.update({
            "label": spec["label"],
            "detail": spec["detail"],
            "icon": spec["icon"],
            "doc_url": spec["doc_url"],
            "object_type": spec["object_type"],
        })
        return

    # No consumption node — append one wired off the last serving node.
    nid = _unique_id(state, _slug(spec["label"]))
    node = {
        "id": nid,
        "label": spec["label"],
        "detail": spec["detail"],
        "icon": spec["icon"],
        "category": "outcome",
        "zone": "Consumption",
        "doc_url": spec["doc_url"],
        "object_type": spec["object_type"],
        "stage": "consumption",
    }
    _add_node_to_zone(state, node, "Consumption", "outcome")
    nodes = state.get("nodes") or []
    prior = [n for n in nodes if n["id"] != nid]
    if prior:
        _add_edge(state, prior[-1]["id"], nid)


def _ensure_security(state: dict[str, Any]) -> None:
    """When prompt mentions PII / masking / RLS, ensure both policy nodes exist."""
    needed = []
    if not _has_object(state, "MASKING_POLICY"):
        needed.append({
            "object_type": "MASKING_POLICY",
            "label": "Masking Policy",
            "detail": "Column-level dynamic masking",
            "icon": "Snowflake_ICON_Access.svg",
            "doc_url": "https://docs.snowflake.com/en/user-guide/security-column-ddm-intro",
            "stage": "security",
        })
    if not _has_object(state, "ROW_ACCESS_POLICY"):
        needed.append({
            "object_type": "ROW_ACCESS_POLICY",
            "label": "Row Access Policy",
            "detail": "Row-level security",
            "icon": "Snowflake_ICON_Access.svg",
            "doc_url": "https://docs.snowflake.com/en/user-guide/security-row-intro",
            "stage": "security",
        })
    if not needed:
        return

    # Anchor: connect from the first storage / curated node so policies sit
    # alongside the data, not as orphans.
    anchor = (
        _first_node_in_zone(state, "Curated Layer")
        or _first_node_in_zone(state, "Silver Layer")
        or _first_node_in_zone(state, "Raw Layer")
        or _first_node_in_zone(state, "Bronze Layer")
    )

    for spec in needed:
        nid = _unique_id(state, _slug(spec["label"]))
        node = {
            "id": nid,
            "label": spec["label"],
            "detail": spec["detail"],
            "icon": spec["icon"],
            "category": "snow",
            "zone": "Security & Governance",
            "doc_url": spec["doc_url"],
            "object_type": spec["object_type"],
            "stage": spec["stage"],
        }
        _add_node_to_zone(state, node, "Security & Governance", "snow")
        if anchor:
            _add_edge(state, anchor["id"], nid)


def customize(state: dict[str, Any], prompt: str) -> dict[str, Any]:
    """
    Apply prompt-driven additions to a baseline state. Idempotent.
    Mutates and returns `state`.
    """
    if not prompt:
        return state
    norm = _normalize(prompt)

    for src in _detect_classes(norm, _SOURCE_PATTERNS):
        _add_source(state, src)

    for c in _detect_classes(norm, _CONSUMPTION_PATTERNS):
        _swap_consumption(state, c)

    if any(p in norm for p in _SECURITY_PATTERNS):
        _ensure_security(state)

    return state
