#!/usr/bin/env python3
"""
extract_shared_rules.py — vendor the SHARED_MODEL_RULES block out of
generate_artifacts.dev.sql into a plain, importable shared_rules.py.

Why this exists: render_local.py (the offline review-harness pipeline)
used to carry its OWN hand-copied _category() function, parallel to the
one in generate_artifacts.dev.sql (the deployed proc a real agent call
actually runs). The two silently drifted -- render_local.py's copy was
missing the 'data share' -> 'bridge' rule for a full session (found
2026-09-10) with nothing to catch it, meaning the offline review package
could show a DIFFERENT boundary placement than the live agent for the
exact same model, undermining the whole point of an offline sanity check.

generate_artifacts.dev.sql marks its single source of truth with
SHARED_MODEL_RULES_BEGIN/END comments (currently _category() and
_build_edges()). This script extracts that block verbatim and writes it,
banner-stamped like build_render.py's render_diagram_generated.py, to
shared_rules.py. render_local.py imports THIS file directly instead of
maintaining its own copy, so drift of this kind is no longer possible --
there is exactly one place this logic is written.

Also runs a smoke test (exec the extracted block, call both functions
against known cases) so a future rename/restructure of the marked block
fails LOUDLY here instead of silently vendoring something broken or
stale.

Usage:
  python3 extract_shared_rules.py
  python3 extract_shared_rules.py --src /path/to/generate_artifacts.dev.sql

Called automatically by review_harness.py before every render, exactly
like build_render.py's render sync -- you should not normally need to run
this by hand.
"""
from __future__ import annotations

import argparse
import ast
import datetime as _dt
import hashlib
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent            # assets/render
DEFAULT_SRC = SCRIPT_DIR / "source" / "generate_artifacts.dev.sql"
OUT_PATH = SCRIPT_DIR / "shared_rules.py"

BEGIN_MARKER = "# === SHARED_MODEL_RULES_BEGIN ==="
END_MARKER = "# === SHARED_MODEL_RULES_END ==="

BANNER = (
    "# GENERATED FROM generate_artifacts.dev.sql (the SHARED_MODEL_RULES block) "
    "by assets/render/extract_shared_rules.py - DO NOT EDIT.\n"
    "# Canonical source: {src}\n"
    "# sha256(source): {sha}\n"
    "# generated: {ts}\n"
    "#\n"
    "# This is the SAME logic the deployed GENERATE_DIAGRAM_ARTIFACTS proc runs\n"
    "# for a real agent call (boundary-category classification + edge label/\n"
    "# style/bidirectional extraction) -- imported directly by render_local.py\n"
    "# so the offline review-harness pipeline can never silently diverge from\n"
    "# what a live agent response actually produces. Edit the source .sql file's\n"
    "# SHARED_MODEL_RULES block, not this file; re-run this script (or\n"
    "# review_harness.py, which does so automatically) to pick up the change.\n"
)


def _resolve_src(arg: str | None) -> Path:
    return Path(os.path.expanduser(arg)) if arg else DEFAULT_SRC


def extract_block(sql_text: str) -> str:
    i = sql_text.find(BEGIN_MARKER)
    j = sql_text.find(END_MARKER)
    if i < 0 or j < 0 or j <= i:
        raise ValueError(
            f"could not find {BEGIN_MARKER!r}/{END_MARKER!r} markers in the source -- "
            "has generate_artifacts.dev.sql been restructured? Update this script's "
            "markers (and the source file's) together."
        )
    # Keep the BEGIN marker's own line out of the extracted body (it's a
    # banner comment, not part of the runnable code) but include everything
    # up to (not including) the END marker line.
    body = sql_text[i:j]
    body = body[len(BEGIN_MARKER):]
    return body.strip("\n") + "\n"


def smoke_test(body: str) -> None:
    ns: dict = {}
    exec(compile(body, "shared_rules_body", "exec"), ns)
    category = ns.get("_category")
    build_edges = ns.get("_build_edges")
    if not callable(category) or not callable(build_edges):
        raise SystemExit("SMOKE TEST FAILED: extracted block does not define both "
                          "_category() and _build_edges()")
    # A handful of cases spanning every branch, so a future edit that breaks
    # one of them (e.g. a typo in a keyword tuple) fails HERE, at extraction
    # time, not silently in a rendered diagram days later.
    cases = [
        (("snowpipe", "Snowpipe", None), "bridge"),
        (("data share", "Inbound Share", None), "bridge"),
        (("power bi", "Power BI", None), "onprem"),
        (("streamlit", "Streamlit App", None), "outcome"),
        (("user", "Analyst", None), "outcome"),
        (("azure data factory", "Azure Data Factory", "azure/data-factory.svg"), "onprem"),
        (("snowflake_account", "Arcadia Health (Snowflake)", "sno-icon-x.svg"), "onprem"),
        (("dynamic table", "Bronze Dynamic Table", "sno-icon-x.svg"), "snow"),
    ]
    for (ctype, label, path), expected in cases:
        got = category(ctype, label, path)
        if got != expected:
            raise SystemExit(
                f"SMOKE TEST FAILED: _category({ctype!r}, {label!r}, {path!r}) "
                f"= {got!r}, expected {expected!r}"
            )
    edges = [
        {"source": "a", "target": "b", "label": "extract"},
        {"source": "b", "target": "c", "style": "governance"},
        {"source": "c", "target": "a", "bidirectional": True},
        {"source": "x", "target": "y", "style": "not-a-real-style"},
    ]
    g_edges, edge_labels, edge_bidir, edge_styles = build_edges(edges)
    assert len(g_edges) == 4, g_edges
    assert edge_labels.get("a|b") == "extract", edge_labels
    assert edge_styles.get("b|c") == "governance", edge_styles
    assert edge_bidir.get("c|a") is True, edge_bidir
    assert "x|y" not in edge_styles, edge_styles  # invalid style silently dropped, not stored
    print("SMOKE TEST OK -- _category() and _build_edges() match expected output on 8+4 known cases")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", help="path to generate_artifacts.dev.sql (overrides default)")
    args = ap.parse_args()

    src = _resolve_src(args.src)
    if not src.exists():
        print(f"ERROR: source not found: {src}", file=sys.stderr)
        return 2

    sql_text = src.read_text(encoding="utf-8")
    try:
        body = extract_block(sql_text)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 3

    smoke_test(body)

    sha = hashlib.sha256(sql_text.encode("utf-8")).hexdigest()
    ts = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
    banner = BANNER.format(src=src, sha=sha, ts=ts)
    OUT_PATH.write_text(banner + "\n" + body, encoding="utf-8")
    print(f"wrote {OUT_PATH}  ({len(body)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
