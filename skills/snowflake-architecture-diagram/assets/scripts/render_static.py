"""
Render a state.json into a single self-contained HTML file.

The bundled viewer (assets/viewer/index.html) reads state.json over HTTP
and references icon files relatively. For sharing or attachment use, this
script bakes the state + all icon images directly into one HTML file, so
the recipient gets a complete, offline-viewable architecture diagram.

Usage:
    python3 render_static.py --state /path/to/state.json --out /path/to/diagram.html
    python3 render_static.py --state state.json --out -          # stdout
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent.parent
VIEWER_DIR = SKILL_DIR / "assets" / "viewer"
ICONS_DIR = VIEWER_DIR / "icons"
INDEX_HTML = VIEWER_DIR / "index.html"


def _icon_to_data_uri(icon_filename: str) -> str:
    p = ICONS_DIR / icon_filename
    if not p.exists():
        # Fall back to generic
        p = ICONS_DIR / "Snowflake_ICON_Architecture.svg"
    if not p.exists():
        return ""
    suffix = p.suffix.lower()
    mime = "image/svg+xml" if suffix == ".svg" else "image/png"
    data = p.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"


def render(state: dict) -> str:
    """Produce a self-contained HTML string with state inlined and icons embedded."""
    if not INDEX_HTML.exists():
        raise FileNotFoundError(f"viewer index.html not found at {INDEX_HTML}")
    html = INDEX_HTML.read_text(encoding="utf-8")

    # Replace each node's icon filename with a data URI
    rewritten_state = json.loads(json.dumps(state))  # deep copy
    for node in rewritten_state.get("nodes", []) or []:
        icon_name = node.get("icon")
        if icon_name:
            node["icon_data"] = _icon_to_data_uri(icon_name)

    # Replace the loadState() fetch call with an inline assignment so the page
    # works without an HTTP server. Use a lambda repl to avoid regex escape
    # interpretation in the JSON payload.
    state_blob = json.dumps(rewritten_state)
    inline_loader = (
        "async function loadState() {\n"
        f"      return {state_blob};\n"
        "    }"
    )
    # Match the entire loadState function including its try/catch body.
    # Pattern walks: 'async function loadState()' then matches until the
    # first '}\n  }' (the catch block's closing brace + the outer function).
    html = re.sub(
        r"async function loadState\(\)\s*\{[\s\S]*?\n\s*\}\s*\n\s*\}",
        lambda _m: inline_loader,
        html,
        count=1,
    )

    # Swap the icon src lookup so it uses node.icon_data when present.
    # NOTE: replacement MUST include the closing ">" — otherwise the browser
    # tries to absorb sibling elements into this img's attribute list and
    # the entire flow-node DOM becomes malformed (label width collapses to
    # the intrinsic width of its text instead of filling the card).
    icon_src_swap = (
        '<img src="${(node.icon_data || (\'icons/\' + escapeHtml(node.icon)))}"'
        ' alt="" onerror="this.style.display=\'none\'">'
    )
    html = re.sub(
        r'<img src="icons/\$\{escapeHtml\(node\.icon\)\}"[^>]*>',
        lambda _m: icon_src_swap,
        html,
        count=1,
    )

    # Inline the two vendored libraries so the file is fully offline.
    for lib_name in ("mermaid.min.js", "html-to-image.min.js"):
        lib_path = VIEWER_DIR / "lib" / lib_name
        if not lib_path.exists():
            continue
        lib_src = lib_path.read_text(encoding="utf-8")
        html = html.replace(
            f'<script src="lib/{lib_name}"></script>',
            f'<script>\n/* {lib_name} (vendored) */\n{lib_src}\n</script>',
            1,
        )

    return html


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", required=True, help="Path to state.json")
    ap.add_argument("--out", required=True, help="Output HTML path or '-' for stdout")
    args = ap.parse_args(argv)

    state = json.loads(Path(args.state).read_text(encoding="utf-8"))
    html = render(state)

    if args.out == "-":
        sys.stdout.write(html)
    else:
        Path(args.out).write_text(html, encoding="utf-8")
        size_kb = len(html) // 1024
        print(f"Wrote {args.out} ({size_kb} KB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
