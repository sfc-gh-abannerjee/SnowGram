"""Tests for intent_router.route_v2 confidence-gated routing."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_COMPOSER = _HERE.parent
sys.path.insert(0, str(_COMPOSER))

import intent_router as ir  # noqa: E402


def test_strong_template_match_routes_template():
    d = ir.route_v2("create a medallion lakehouse with bronze silver gold layers")
    assert d["type"] == "template", d
    assert d["template_id"] == "MEDALLION_LAKEHOUSE", d
    assert d["score"] >= 2


def test_weak_template_match_routes_from_scratch():
    # Single-keyword hits should NOT win.
    d = ir.route_v2("Snowflake-only pipeline")
    assert d["type"] == "from_scratch", d


def test_no_keyword_routes_from_scratch():
    d = ir.route_v2("ingest data into Snowflake")
    assert d["type"] == "from_scratch", d
    assert d["pipeline_type"] in {"medallion", "streaming", "iot", "batch", "security", "generic"}


def test_multi_source_thin_falls_through_to_from_scratch():
    # Only mentions s3 + iceberg sources but no downstream stages — compose
    # would produce < 4 components, so we should fall through to from_scratch.
    d = ir.route_v2("Migrate Iceberg tables from S3 with masking policies for sensitive data")
    assert d["type"] == "from_scratch", d


def test_multi_source_rich_routes_compose():
    # Mentions s3 + kafka sources AND multiple downstream hints (snowpipe,
    # bronze, silver, gold, transform) — compose builds ≥ 4 blocks.
    d = ir.route_v2("ingest from S3 and Kafka via Snowpipe into bronze silver gold tables and serve via dashboards")
    # Either compose or template — both are acceptable; just must NOT be from_scratch.
    assert d["type"] in {"compose", "template"}, d


def test_knowledge_pack_pipeline_type_carries_through():
    pack = {"pipeline_type": "streaming"}
    d = ir.route_v2("ingest data into Snowflake", knowledge_pack=pack)
    assert d["type"] == "from_scratch"
    assert d["pipeline_type"] == "streaming"


def test_legacy_route_unchanged():
    """Legacy route() still defaults a template even with no keywords."""
    d = ir.route("ingest data into Snowflake")
    assert d["type"] == "template"
    assert d["template_id"] == "MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY"


def test_detect_pipeline_type_local():
    assert ir._detect_pipeline_type_local("medallion lakehouse with bronze silver gold") == "medallion"
    assert ir._detect_pipeline_type_local("real-time kafka streaming pipeline") == "streaming"
    assert ir._detect_pipeline_type_local("iot sensors and mqtt") == "iot"
    assert ir._detect_pipeline_type_local("nightly batch etl into star schema") == "batch"
    assert ir._detect_pipeline_type_local("masking policies for compliance") == "security"
    assert ir._detect_pipeline_type_local("hello world") == "generic"


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
