"""Tests for knowledge_pack.apply_pack and disk cache."""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

import knowledge_pack as kp  # noqa: E402


def _baseline_state():
    return {
        "title": "Test",
        "nodes": [
            {"id": "src",  "label": "AWS S3",        "object_type": "S3",
             "category": "onprem", "zone": "External Sources", "stage": "source"},
            {"id": "pipe", "label": "Snowpipe",      "object_type": "PIPE",
             "category": "bridge", "zone": "Ingestion", "stage": "ingestion"},
            {"id": "tbl",  "label": "Landing Table", "object_type": "TABLE",
             "category": "snow",   "zone": "Raw Layer", "stage": "raw_storage"},
        ],
        "edges": [
            {"source": "src", "target": "pipe"},
            {"source": "pipe", "target": "tbl"},
        ],
        "zones": [
            {"name": "External Sources", "category": "onprem", "node_ids": ["src"]},
            {"name": "Ingestion",        "category": "bridge", "node_ids": ["pipe"]},
            {"name": "Raw Layer",        "category": "snow",   "node_ids": ["tbl"]},
        ],
    }


def test_validate_good_pack():
    errs = kp.validate_pack({
        "pipeline_type": "streaming",
        "component_overrides": {"transformation": "DYNAMIC_TABLE"},
        "doc_citations": [{"url": "x", "title": "y"}],
        "best_practice_directives": ["use Snowpipe Streaming"],
        "annotations": [{"object_type": "PIPE", "note": "..."}],
    })
    assert errs == [], errs


def test_validate_bad_stage():
    errs = kp.validate_pack({"component_overrides": {"BAD_STAGE": "TABLE"}})
    assert any("BAD_STAGE" in e for e in errs)


def test_apply_component_override():
    state = _baseline_state()
    kp.apply_pack(state, {"component_overrides": {"ingestion": "SNOWPIPE_STREAMING"}})
    pipe_node = next(n for n in state["nodes"] if n["id"] == "pipe")
    assert pipe_node["object_type"] == "SNOWPIPE_STREAMING"
    # Snowpipe Streaming aliases to PIPE icon.
    assert "Pipe" in pipe_node["icon"]
    assert "snowpipe-streaming" in pipe_node["doc_url"]


def test_apply_citations_dedupe():
    state = _baseline_state()
    state["citations"] = [{"url": "x", "title": "existing"}]
    kp.apply_pack(state, {"doc_citations": [{"url": "x", "title": "dup"}, {"url": "y", "title": "new"}]})
    assert len(state["citations"]) == 2
    urls = {c["url"] for c in state["citations"]}
    assert urls == {"x", "y"}


def test_apply_bp_notes_dedupe():
    state = _baseline_state()
    state["bp_notes"] = ["existing"]
    kp.apply_pack(state, {"best_practice_directives": ["existing", "new"]})
    assert state["bp_notes"] == ["existing", "new"]


def test_apply_annotations():
    state = _baseline_state()
    kp.apply_pack(state, {"annotations": [{"object_type": "PIPE", "note": "TARGET_LAG = 1m"}]})
    pipe_node = next(n for n in state["nodes"] if n["id"] == "pipe")
    assert pipe_node["annotations"] == ["TARGET_LAG = 1m"]


def test_apply_pack_none_is_noop():
    state = _baseline_state()
    before = json.dumps(state)
    kp.apply_pack(state, None)
    assert json.dumps(state) == before


def test_idempotency():
    state = _baseline_state()
    pack = {"component_overrides": {"ingestion": "SNOWPIPE_STREAMING"},
            "doc_citations": [{"url": "x", "title": "y"}],
            "best_practice_directives": ["dt rule"]}
    kp.apply_pack(state, pack)
    snapshot = json.dumps(state)
    kp.apply_pack(state, pack)
    assert json.dumps(state) == snapshot, "second apply diverged from first"


def test_cache_roundtrip():
    pack = {"pipeline_type": "iot", "best_practice_directives": ["use SP-Streaming"]}
    kp.set_cached("iot", "build me an iot pipe", pack)
    got = kp.get_cached("iot", "build me an iot pipe")
    assert got == pack
    assert kp.get_cached("iot", "different prompt") is None


def test_load_pack_file():
    pack = {"pipeline_type": "batch"}
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tf:
        json.dump(pack, tf)
        path = tf.name
    try:
        loaded = kp.load_pack(path)
        assert loaded == pack
    finally:
        Path(path).unlink(missing_ok=True)


def test_load_pack_missing():
    assert kp.load_pack("/nonexistent/path.json") == {}
    assert kp.load_pack("") == {}
    assert kp.load_pack(None) == {}


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
