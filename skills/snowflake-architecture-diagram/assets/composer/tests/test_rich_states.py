"""Validate the RICH_STATE field on every bundled template JSON."""
from __future__ import annotations

import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_TEMPLATES = _HERE.parent.parent / "templates"


def _validate_rich_state(rich: dict, tid: str):
    assert isinstance(rich, dict), f"{tid}: RICH_STATE not a dict"
    for key in ("title", "nodes", "edges", "zones"):
        assert key in rich, f"{tid}: missing {key!r}"

    nodes = rich["nodes"]
    edges = rich["edges"]
    zones = rich["zones"]

    assert isinstance(nodes, list) and nodes, f"{tid}: nodes empty"
    assert isinstance(edges, list), f"{tid}: edges not a list"
    assert isinstance(zones, list) and zones, f"{tid}: zones empty"

    node_ids = set()
    for n in nodes:
        for f in ("id", "label", "icon", "category", "zone"):
            assert f in n, f"{tid}: node missing {f!r}: {n}"
        assert n["id"] not in node_ids, f"{tid}: duplicate node id {n['id']}"
        node_ids.add(n["id"])

    for e in edges:
        assert "source" in e and "target" in e, f"{tid}: malformed edge {e}"
        assert e["source"] in node_ids, f"{tid}: edge source missing: {e}"
        assert e["target"] in node_ids, f"{tid}: edge target missing: {e}"

    seen_in_zones = set()
    for z in zones:
        for f in ("name", "category", "node_ids"):
            assert f in z, f"{tid}: zone missing {f!r}: {z}"
        for nid in z["node_ids"]:
            assert nid in node_ids, f"{tid}: zone {z['name']} references unknown node {nid}"
            assert nid not in seen_in_zones, f"{tid}: node {nid} in multiple zones"
            seen_in_zones.add(nid)
    # Every node must be in exactly one zone.
    assert seen_in_zones == node_ids, (
        f"{tid}: nodes not all assigned to a zone: missing {node_ids - seen_in_zones}"
    )


def test_all_templates_have_valid_rich_state():
    files = sorted(_TEMPLATES.glob("*.json"))
    files = [f for f in files if f.name != "_index.json"]
    assert len(files) >= 14, f"expected ≥ 14 templates, got {len(files)}"

    for fp in files:
        tmpl = json.loads(fp.read_text(encoding="utf-8"))
        tid = tmpl.get("TEMPLATE_ID") or fp.stem
        rich = tmpl.get("RICH_STATE")
        assert rich is not None, f"{tid}: missing RICH_STATE"
        _validate_rich_state(rich, tid)
        # Ensure FULL_MERMAID_CODE is preserved for back-compat.
        assert tmpl.get("FULL_MERMAID_CODE"), f"{tid}: FULL_MERMAID_CODE was removed"


if __name__ == "__main__":
    try:
        test_all_templates_have_valid_rich_state()
        print("PASS test_all_templates_have_valid_rich_state")
    except AssertionError as e:
        print(f"FAIL: {e}")
        raise SystemExit(1)
