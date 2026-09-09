#!/usr/bin/env python3
"""
build_render.py - extract the canonical SnowGram renderer into the local skill.

SnowGram's RENDER_DIAGRAM UDF (render_diagram.dev.sql) is the single source of
truth for the diagram HTML (panel / present / edit / theme / hover). To reach
parity WITHOUT changing the agent, the local skill consumes that same code by
extraction:

  1. The Python UDF body is unwrapped (SQL `AS '...'`, `''` -> `'`) and written
     verbatim to  assets/render/render_diagram_generated.py  (a real importable
     module exposing run(layout_json, enrich_json, title, html_layout_json)).
  2. The feature-layer constants (_PANEL_CSS/_PANEL_JS/_PANEL_MARKUP/_THEME_CSS/
     _THEME_INIT) are dumped to  assets/diagram-interactivity/chrome/  so the
     live viewer can include the exact same chrome.

Both outputs are GENERATED - never hand-edit them. Edit render_diagram.dev.sql
(the canonical source) and re-run this build.

Source resolution order:
  --src ARG  >  $SNOWGRAM_RENDER_SRC  >  the in-repo default (assets/render/source/).

Usage:
  python3 build_render.py                 # module + chrome
  python3 build_render.py --src /path/to/render_diagram.dev.sql
  python3 build_render.py --module-only
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as _dt
import hashlib
import io
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent          # assets/render
SKILL_DIR = SCRIPT_DIR.parent.parent                   # skill root
RENDER_OUT = SCRIPT_DIR / "render_diagram_generated.py"
CHROME_DIR = SKILL_DIR / "assets" / "diagram-interactivity" / "chrome"

# In-repo canonical source (2026-09-09 consolidation: was
# ~/Documents/snowgram-eng/backend/sql/dev_temp_abannerjee/render_diagram.dev.sql,
# a SEPARATE repo/GitHub account now kept frozen. The engineering-repo copy still
# exists there as a historical snapshot but is no longer read by this build --
# edit THIS file going forward.
DEFAULT_SRC = SCRIPT_DIR / "source" / "render_diagram.dev.sql"

# Feature-layer constants to surface for the viewer (Phase 3/4).
CHROME_CONSTANTS = {
    "_PANEL_CSS": "panel.css",
    "_THEME_CSS": "theme.css",
    "_PANEL_MARKUP": "panel.markup.html",
    "_PANEL_JS": "panel.js",
    "_THEME_INIT": "theme-init.js",
}

BANNER = (
    "# GENERATED FROM render_diagram.dev.sql by assets/render/build_render.py - DO NOT EDIT.\n"
    "# Canonical source: {src}\n"
    "# sha256(source): {sha}\n"
    "# generated: {ts}\n"
)


def _resolve_src(arg: str | None) -> Path:
    if arg:
        return Path(os.path.expanduser(arg))
    env = os.environ.get("SNOWGRAM_RENDER_SRC")
    if env:
        return Path(os.path.expanduser(env))
    return DEFAULT_SRC


def _extract_body(sql_text: str) -> str:
    """Unwrap the Python body from CREATE FUNCTION ... AS '<body>';"""
    marker = "\nAS '"
    i = sql_text.index(marker) + len(marker)
    j = sql_text.rstrip().rfind("';")
    if j <= i:
        raise ValueError("could not locate the AS '...' body bounds")
    body_sql = sql_text[i:j]
    # SQL single-quote unescaping: '' -> '
    return body_sql.replace("''", "'")


def _exec_body(body: str) -> dict:
    ns: dict = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile(body, "render_diagram_body", "exec"), ns)
    return ns


def main() -> int:
    ap = argparse.ArgumentParser(description="Extract the canonical renderer into the local skill.")
    ap.add_argument("--src", help="path to render_diagram.dev.sql (overrides env/default)")
    ap.add_argument("--module-only", action="store_true", help="skip chrome asset extraction")
    args = ap.parse_args()

    src = _resolve_src(args.src)
    if not src.exists():
        print(f"ERROR: render source not found: {src}", file=sys.stderr)
        print("       pass --src or set SNOWGRAM_RENDER_SRC", file=sys.stderr)
        return 2

    sql_text = src.read_text(encoding="utf-8")
    body = _extract_body(sql_text)
    sha = hashlib.sha256(sql_text.encode("utf-8")).hexdigest()
    ts = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
    banner = BANNER.format(src=src, sha=sha, ts=ts)

    # Sanity: the body must exec and expose run().
    ns = _exec_body(body)
    run = ns.get("run")
    if not callable(run):
        print("ERROR: extracted body does not expose a callable run()", file=sys.stderr)
        return 3

    RENDER_OUT.parent.mkdir(parents=True, exist_ok=True)
    RENDER_OUT.write_text(banner + "\n" + body + "\n", encoding="utf-8")
    print(f"wrote {RENDER_OUT}  ({len(body)} bytes of renderer)")

    if not args.module_only:
        CHROME_DIR.mkdir(parents=True, exist_ok=True)
        chrome_banner = (
            "/* GENERATED FROM render_diagram.dev.sql ({name}) by build_render.py - DO NOT EDIT. */\n"
        )
        for const, fname in CHROME_CONSTANTS.items():
            val = ns.get(const)
            if not isinstance(val, str):
                print(f"WARN: {const} missing or not a string; skipped", file=sys.stderr)
                continue
            out = CHROME_DIR / fname
            comment = "" if fname.endswith(".html") else chrome_banner.format(name=const)
            out.write_text(comment + val, encoding="utf-8")
            print(f"wrote {out}  ({len(val)} bytes from {const})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
