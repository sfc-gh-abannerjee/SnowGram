"""Tests for state_customizer.customize."""
from __future__ import annotations

import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

import state_customizer as sc  # noqa: E402


def _baseline_state():
    return {
        "title": "Test",
        "nodes": [
            {"id": "src", "label": "Cloud Storage", "category": "onprem",
             "zone": "External Sources", "object_type": "S3", "stage": "source"},
            {"id": "pipe", "label": "Snowpipe", "category": "bridge",
             "zone": "Ingestion", "object_type": "PIPE", "stage": "ingestion"},
            {"id": "tbl", "label": "Landing Table", "category": "snow",
             "zone": "Raw Layer", "object_type": "TABLE", "stage": "raw_storage"},
            {"id": "bi", "label": "BI Platform", "category": "outcome",
             "zone": "Consumption", "object_type": "BI_TOOL", "stage": "consumption"},
        ],
        "edges": [
            {"source": "src", "target": "pipe"},
            {"source": "pipe", "target": "tbl"},
            {"source": "tbl", "target": "bi"},
        ],
        "zones": [
            {"name": "External Sources", "category": "onprem", "node_ids": ["src"]},
            {"name": "Ingestion", "category": "bridge", "node_ids": ["pipe"]},
            {"name": "Raw Layer", "category": "snow", "node_ids": ["tbl"]},
            {"name": "Consumption", "category": "outcome", "node_ids": ["bi"]},
        ],
    }


def test_tableau_swaps_existing_consumption_node():
    state = sc.customize(_baseline_state(), "expose data via Tableau")
    bi = next(n for n in state["nodes"] if n["id"] == "bi")
    assert bi["object_type"] == "TABLEAU"
    assert bi["label"] == "Tableau"


def test_powerbi_swap():
    state = sc.customize(_baseline_state(), "serve via Power BI")
    bi = next(n for n in state["nodes"] if n["id"] == "bi")
    assert bi["object_type"] == "POWERBI"


def test_kafka_source_added_when_missing():
    state = sc.customize(_baseline_state(), "ingest from Kafka")
    labels = [n["label"] for n in state["nodes"]]
    assert "Kafka" in labels
    # Kafka should be wired to the first ingestion node.
    kafka_id = next(n["id"] for n in state["nodes"] if n["label"] == "Kafka")
    assert any(e["source"] == kafka_id and e["target"] == "pipe" for e in state["edges"])


def test_iceberg_source_added():
    state = sc.customize(_baseline_state(), "use Iceberg tables")
    labels = [n["label"] for n in state["nodes"]]
    assert "Iceberg Table" in labels


def test_pii_adds_security_zone():
    state = sc.customize(_baseline_state(), "needs masking and row level security for PII")
    sec_nodes = [n["label"] for n in state["nodes"] if n.get("zone") == "Security & Governance"]
    assert "Masking Policy" in sec_nodes
    assert "Row Access Policy" in sec_nodes


def test_idempotent_double_apply():
    state = sc.customize(_baseline_state(), "ingest from Kafka and expose via Tableau")
    snapshot = json.dumps(state, sort_keys=True)
    state = sc.customize(state, "ingest from Kafka and expose via Tableau")
    assert json.dumps(state, sort_keys=True) == snapshot


def test_no_prompt_is_noop():
    s1 = _baseline_state()
    snap = json.dumps(s1, sort_keys=True)
    sc.customize(s1, "")
    assert json.dumps(s1, sort_keys=True) == snap


def test_existing_kafka_is_not_duplicated():
    state = _baseline_state()
    state["nodes"].insert(1, {
        "id": "kafka", "label": "Kafka", "category": "onprem",
        "zone": "External Sources", "object_type": "KAFKA", "stage": "source",
    })
    state["zones"][0]["node_ids"].append("kafka")
    sc.customize(state, "ingest from Kafka")
    kafka_count = sum(1 for n in state["nodes"] if (n.get("object_type") or "").upper() == "KAFKA")
    assert kafka_count == 1


def test_compose_path_label_match_prevents_duplicate():
    """When state came from compose path with label='AWS S3' but no object_type."""
    state = _baseline_state()
    state["nodes"][0] = {"id": "src", "label": "AWS S3", "category": "onprem",
                          "zone": "External Sources"}  # no object_type
    sc.customize(state, "from S3")
    s3_count = sum(1 for n in state["nodes"]
                   if "s3" in (n.get("label") or "").lower())
    assert s3_count == 1


if __name__ == "__main__":
    fns = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    raise SystemExit(0 if failed == 0 else 1)
