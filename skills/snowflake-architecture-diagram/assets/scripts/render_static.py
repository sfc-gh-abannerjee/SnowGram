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
ICON_MANIFEST_PATH = SKILL_DIR / "assets" / "icon_manifest.json"

# Object type aliases — incoming object_type values that map to a different
# canonical key in the manifest. Kept in sync with build_rich_states.py.
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
}


def _load_manifest() -> dict:
    if not ICON_MANIFEST_PATH.exists():
        return {}
    try:
        return json.loads(ICON_MANIFEST_PATH.read_text())
    except Exception:
        return {}


def _resolve_icon_for_object_type(object_type: str, manifest: dict) -> tuple[str, str] | None:
    """Look up the canonical (icon, category) for a Snowflake object_type.

    Returns None if the object_type is not in the manifest or its alias map.
    Caller can then fall back to whatever icon the node already specifies.
    """
    if not object_type:
        return None
    key = _OBJECT_TYPE_ALIASES.get(object_type, object_type)
    entry = manifest.get(key)
    if isinstance(entry, dict) and "icon" in entry:
        return entry["icon"], entry.get("category", "snow")
    ext = manifest.get("_external_systems", {}).get(key)
    if isinstance(ext, dict) and "icon" in ext:
        return ext["icon"], ext.get("category", "onprem")
    cons = manifest.get("_consumption", {}).get(key)
    if isinstance(cons, dict) and "icon" in cons:
        return cons["icon"], cons.get("category", "outcome")
    return None


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

    manifest = _load_manifest()

    # Replace each node's icon filename with a data URI. Defensively resolve
    # the icon from the node's object_type — this protects against producers
    # that hand-roll a state.json and stamp a wrong/uniform icon string on
    # every Snowflake node (a real failure mode for CoCo-improvised states).
    # If the manifest has a canonical icon for the object_type, use that;
    # otherwise fall back to whatever the node specifies.
    rewritten_state = json.loads(json.dumps(state))  # deep copy
    for node in rewritten_state.get("nodes", []) or []:
        object_type = node.get("object_type") or ""
        canonical = _resolve_icon_for_object_type(object_type, manifest)
        if canonical:
            canonical_icon, canonical_category = canonical
            # Override the icon with the canonical one for this object type.
            # Keep the existing category if the node already specified one.
            node["icon"] = canonical_icon
            if not node.get("category"):
                node["category"] = canonical_category
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
    # NOTE2: the viewer has multiple <img src="icons/..."> templates (one
    # for zones layout, one for the legacy flat-flow fallback). Swap ALL.
    icon_src_swap = (
        '<img src="${(node.icon_data || (\'icons/\' + escapeHtml(node.icon)))}"'
        ' alt="" onerror="this.style.display=\'none\'">'
    )
    html = re.sub(
        r'<img src="icons/\$\{escapeHtml\(node\.icon\)\}"[^>]*>',
        lambda _m: icon_src_swap,
        html,
    )

    # Inline the vendored libraries so the file is fully offline.
    #
    # Mermaid is OPTIONAL: it's only used by the viewer's fallback path
    # when state has a top-level `mermaid` field (the rich-state SVG
    # connector renderer doesn't need it). Inlining mermaid.min.js
    # unconditionally bloats every rendered HTML file by ~3.3 MB of
    # dead minified JS that also leaks into raw text views (e.g.
    # GitHub's blob viewer or "view source"). Skip it when the state
    # doesn't actually use it.
    state_uses_mermaid = bool(rewritten_state.get("mermaid"))
    libs_to_inline = ["html-to-image.min.js"]
    if state_uses_mermaid:
        libs_to_inline.insert(0, "mermaid.min.js")
    for lib_name in libs_to_inline:
        lib_path = VIEWER_DIR / "lib" / lib_name
        if not lib_path.exists():
            continue
        lib_src = lib_path.read_text(encoding="utf-8")
        html = html.replace(
            f'<script src="lib/{lib_name}"></script>',
            f'<script>\n/* {lib_name} (vendored) */\n{lib_src}\n</script>',
            1,
        )
    # Drop any library script tag that we did NOT inline so the
    # rendered file doesn't 404 when opened standalone.
    if not state_uses_mermaid:
        html = html.replace(
            '<script src="lib/mermaid.min.js"></script>',
            '<!-- mermaid.min.js omitted: state has no `mermaid` field -->',
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
