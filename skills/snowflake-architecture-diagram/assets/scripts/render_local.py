#!/usr/bin/env python3
"""
render_local.py - render a diagram to self-contained HTML using the SAME code
as the SnowGram agent (RENDER_DIAGRAM), so the local output is at full feature
parity (Customize panel, Cover + Present mode, hover-focus, inline edit +
Save-as-HTML, styling) with the agent.

Pipeline (mirrors the GENERATE_DIAGRAM_ARTIFACTS proc, run locally):
  model {nodes, edges}
    -> g_nodes/g_edges/edge_labels + per-node category + icon data URIs
    -> layout-engine via layout_cli.mjs  (narrow + wide geometry)
    -> enrich {icons, edgeLabels, doc?}
    -> render_diagram_generated.run(layout, enrich, title, html_layout)
    -> {mmd, drawio, svg, html}
    -> write <out>.html  (+ .mmd/.svg/.drawio.xml sidecars)

The renderer module is the vendored extraction of render_diagram.dev.sql
(assets/render/render_diagram_generated.py). Run assets/render/build_render.py
to refresh it. The agent UDF is never touched.

Model JSON shape (matches the agent's NODES/EDGES):
  {"nodes": [{"id","label","component_type","layer",
              "svg_data_uri"?,"icon"?,"category"?}],
   "edges": [{"source","target","label"?}]}

Usage:
  python3 render_local.py --model model.json --title "My Arch" --out out.html
  python3 render_local.py --model model.json --out -            # stdout
  python3 render_local.py --model model.json --out out.html --doc doc.json
  python3 render_local.py --model model.json --out out.html --no-sidecars
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent.parent
ASSETS = SKILL_DIR / "assets"
LAYOUT_ENGINE_DIR = ASSETS / "layout-engine"
LAYOUT_CLI = LAYOUT_ENGINE_DIR / "layout_cli.mjs"
RENDER_MODULE = ASSETS / "render" / "render_diagram_generated.py"
SHARED_RULES_MODULE = ASSETS / "render" / "shared_rules.py"
RENDER_STATIC = ASSETS / "scripts" / "render_static.py"
ICON_RESOLVER = ASSETS / "scripts" / "icon_resolver.py"


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# Ported verbatim from generate_artifacts.dev.sql's _svg_to_pdf_png, so the
# offline review package's PDF/PNG go through the SAME conversion path
# (weasyprint SVG->PDF, pdf2image PDF->PNG) as the deployed
# GENERATE_DIAGRAM_ARTIFACTS proc actually uses in production -- not a
# separate Playwright-screenshot-of-the-HTML approximation (that's a
# different code path, kept as its own sidecar since it's useful for
# reviewing the INTERACTIVE experience specifically).
#
# On macOS, weasyprint needs Pango/GObject (`brew install pango`) AND
# DYLD_LIBRARY_PATH pointing at Homebrew's lib dir for the dynamic linker
# to find them -- a plain `pip install weasyprint` alone raises
# "cannot load library 'libgobject-2.0-0'" even with the brew package
# installed. Run this script (or review_harness.py) with:
#   DYLD_LIBRARY_PATH=/opt/homebrew/lib python3 review_harness.py
# Gracefully degrades (same pattern as the Playwright screenshot below) if
# weasyprint isn't importable at all.
def svg_to_pdf_png(svg_text: str, dpi: int = 150):
    import re as _re
    m = _re.search(r'<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"[^>]*\bheight="(\d+(?:\.\d+)?)"', svg_text)
    w = float(m.group(1)) if m else 1200.0
    h = float(m.group(2)) if m else 800.0
    html_wrapped = (
        '<html><head><style>@page { size: ' + str(w) + 'px ' + str(h) + 'px; margin: 0; } '
        'html,body { margin:0; padding:0; }</style></head><body>' + svg_text + '</body></html>'
    )
    from weasyprint import HTML
    pdf_bytes = HTML(string=html_wrapped).write_pdf()
    from pdf2image import convert_from_bytes
    images = convert_from_bytes(pdf_bytes, dpi=dpi)
    import io as _io
    buf = _io.BytesIO()
    images[0].save(buf, format="PNG")
    return pdf_bytes, buf.getvalue()


# _category() and edge-label/style/bidirectional extraction used to be
# hand-copied here, parallel to generate_artifacts.dev.sql's own copies --
# they silently drifted (missing the 'data share' -> 'bridge' rule for a
# full session, found 2026-09-10) with nothing to catch it. build() below
# now imports both directly from shared_rules.py, a verbatim extraction of
# generate_artifacts.dev.sql's SHARED_MODEL_RULES block (see
# extract_shared_rules.py) -- there is exactly one copy of this logic now.
#
# review_harness.py re-runs the extraction automatically every run, but
# render_local.py can also be invoked directly (its own CLI, or another
# caller) -- this catches the case where shared_rules.py exists but is
# STALE relative to the current generate_artifacts.dev.sql (banner sha256
# mismatch), so a bypassed sync degrades to a loud warning instead of a
# silent wrong render.
GENERATE_ARTIFACTS_SOURCE = ASSETS / "render" / "source" / "generate_artifacts.dev.sql"


def _warn_if_shared_rules_stale() -> None:
    import hashlib
    import re as _re
    banner = SHARED_RULES_MODULE.read_text(encoding="utf-8")
    m = _re.search(r"sha256\(source\):\s*([0-9a-f]{64})", banner)
    if not m or not GENERATE_ARTIFACTS_SOURCE.exists():
        return
    current_sha = hashlib.sha256(GENERATE_ARTIFACTS_SOURCE.read_bytes()).hexdigest()
    if m.group(1) != current_sha:
        print(
            f"WARNING: {SHARED_RULES_MODULE.name} was extracted from a DIFFERENT "
            f"version of {GENERATE_ARTIFACTS_SOURCE.name} than what's on disk now "
            "-- re-run assets/render/extract_shared_rules.py before trusting this "
            "render's category/edge-label output.",
            file=sys.stderr,
        )


def _run_layout(graph_json: str, wide: bool) -> dict:
    cmd = ["node", LAYOUT_CLI.name, "-"] + (["--wide"] if wide else [])
    proc = subprocess.run(
        cmd, input=graph_json, capture_output=True, text=True, cwd=str(LAYOUT_ENGINE_DIR)
    )
    if proc.returncode != 0:
        raise RuntimeError(f"layout_cli failed (wide={wide}): {proc.stderr or proc.stdout}")
    out = json.loads(proc.stdout)
    if isinstance(out, dict) and out.get("error"):
        raise RuntimeError(f"layout engine error (wide={wide}): {out['error']}")
    return out


def state_to_model(state: dict) -> dict:
    """Adapt a composer/viewer rich-state into the {nodes, edges} model this
    renderer consumes. Maps object_type->component_type and stage/layer/zone->
    layer; preserves explicit category and any pre-resolved icon data URI.
    Shared by diagram_from_prompt.py and serve_viewer.py."""
    nodes = []
    for n in state.get("nodes", []) or []:
        nodes.append({
            "id": n.get("id"),
            "label": n.get("label") or n.get("id"),
            "component_type": n.get("object_type") or n.get("component_type") or "",
            "layer": n.get("stage") or n.get("layer") or n.get("zone") or "Main",
            "category": n.get("category"),
            "svg_data_uri": n.get("icon_data") or n.get("svg_data_uri"),
            "icon": n.get("icon"),
        })
    edges = []
    for e in state.get("edges", []) or []:
        edges.append({
            "source": e.get("source") or e.get("from"),
            "target": e.get("target") or e.get("to"),
            "label": e.get("label"),
        })
    return {"nodes": nodes, "edges": edges}


def build(model: dict, title: str, doc: dict | None, *, online_icons: bool = False,
          connection: str = "snowhouse") -> dict:
    rs = _load_module("render_static", RENDER_STATIC)
    manifest = rs._load_manifest()
    try:
        ir = _load_module("icon_resolver", ICON_RESOLVER)
    except Exception:
        ir = None
    if not SHARED_RULES_MODULE.exists():
        raise RuntimeError(
            f"{SHARED_RULES_MODULE} missing -- run assets/render/extract_shared_rules.py "
            "(review_harness.py does this automatically)"
        )
    _warn_if_shared_rules_stale()
    shared = _load_module("shared_rules", SHARED_RULES_MODULE)

    nodes = [dict(n) for n in (model.get("nodes") or [])]
    edges = [dict(e) for e in (model.get("edges") or [])]
    # Local test fixtures (tests/fixtures/*.json) predate this model's
    # "source"/"target" convention and still use "from"/"to" -- normalize
    # here so shared._build_edges() (which only recognizes "source"/
    # "target", matching the deployed proc exactly) works for both without
    # needing its own, separately-drifting leniency logic.
    for e in edges:
        e.setdefault("source", e.get("from"))
        e.setdefault("target", e.get("to"))

    id_to_label: dict = {}
    id_to_type: dict = {}
    icons: dict = {}
    cats: dict = {}

    for n in nodes:
        nid = n.get("id")
        label = n.get("label") or nid
        ctype = n.get("component_type") or n.get("componentType") or n.get("type") or ""
        id_to_label[nid] = label
        id_to_type[nid] = ctype

        icon_path = n.get("icon")
        if n.get("svg_data_uri"):
            icons[nid] = n["svg_data_uri"]
        else:
            # Tier 1: SnowGram-parity resolver (curated map -> vocab -> live
            # ICON_SEARCH+cache -> fuzzy over the vendored catalog).
            uri = ir.resolve(ctype, label, online=online_icons, connection=connection) if ir else None
            if uri:
                icons[nid] = uri
            else:
                # Tier 2: legacy manifest fallback (keeps pre-build behavior).
                resolved = rs._resolve_icon_for_object_type(ctype, manifest)
                if resolved:
                    icon_file, _mcat = resolved
                    icon_path = icon_path or icon_file
                    luri = rs._icon_to_data_uri(icon_file)
                    if luri:
                        icons[nid] = luri
        # category: shared, icon-independent (explicit > type/label heuristic).
        # Deliberately NOT via the manifest's icon-derived category, and NOT
        # passing icon_path -- both were offline-only inputs that made this
        # diverge from the deployed proc's classification for the same model.
        cats[nid] = shared.resolve_category(n)

    g_nodes = [
        {
            "id": n.get("id"),
            "label": id_to_label.get(n.get("id")),
            "componentType": id_to_type.get(n.get("id"), ""),
            "zone": n.get("layer") or n.get("zone") or "Main",
            "category": cats.get(n.get("id")),
            "detail": n.get("detail") or "",
            "style": n.get("style"),
        }
        for n in nodes
    ]
    g_edges, edge_labels, edge_bidirectional, edge_styles = shared._build_edges(edges)

    base_graph = {"nodes": g_nodes, "edges": g_edges}
    if model.get("containers"):
        base_graph["containers"] = model["containers"]
    if model.get("boundaryLabel"):
        base_graph["boundaryLabel"] = model["boundaryLabel"]
    if model.get("boundarySubtitle"):
        base_graph["boundarySubtitle"] = model["boundarySubtitle"]

    # narrow geometry (svg/drawio/mmd) + wide geometry (HTML icon-left)
    layout = _run_layout(json.dumps(base_graph), wide=False)
    for ln in layout.get("nodes", []) or []:
        ln["label"] = id_to_label.get(ln.get("id"), ln.get("label") or ln.get("id"))

    html_layout = _run_layout(json.dumps({**base_graph, "nodeStyle": "wide"}), wide=True)
    id_to_detail: dict = {n.get("id"): n.get("detail") or "" for n in nodes}
    for ln in html_layout.get("nodes", []) or []:
        nid = ln.get("id")
        ln["label"] = id_to_label.get(nid, ln.get("label") or nid)
        ln["componentType"] = id_to_type.get(nid, "")
        ln["category"] = cats.get(nid)
        ln["detail"] = id_to_detail.get(nid, "")

    enrich: dict = {"icons": icons, "edgeLabels": edge_labels, "edgeBidirectional": edge_bidirectional, "edgeStyles": edge_styles}
    if doc:
        enrich["doc"] = doc

    rd = _load_module("render_diagram_generated", RENDER_MODULE)
    result = rd.run(
        json.dumps(layout),
        json.dumps(enrich),
        title,
        json.dumps(html_layout) if html_layout else None,
    )
    if isinstance(result, str):
        result = json.loads(result)

    # PDF + a PDF-rasterized PNG via the SAME weasyprint/pdf2image path the
    # deployed GENERATE_DIAGRAM_ARTIFACTS proc uses (see svg_to_pdf_png's
    # docstring above) -- gracefully degrades (matching the Playwright
    # screenshot's own try/except pattern in review_harness.py) rather than
    # failing the whole build when weasyprint/its system libs are missing.
    try:
        pdf_bytes, png_bytes = svg_to_pdf_png(result.get("svg") or "")
        result["pdf"] = pdf_bytes
        result["static_png"] = png_bytes
    except Exception as e:
        result["pdf_error"] = str(e)

    return result


def main() -> int:
    ap = argparse.ArgumentParser(description="Render a diagram to self-contained HTML via the shared SnowGram renderer.")
    ap.add_argument("--model", required=True, help="path to model JSON ({nodes, edges})")
    ap.add_argument("--title", default="Architecture", help="diagram title")
    ap.add_argument("--out", required=True, help="output .html path, or - for stdout")
    ap.add_argument("--doc", help="optional doc JSON (overview/components/best_practices)")
    ap.add_argument("--no-sidecars", action="store_true", help="do not write .mmd/.svg/.drawio.xml")
    ap.add_argument("--online-icons", action="store_true",
                    help="allow live ICON_SEARCH (cached) for icons not in the vendored map/vocab")
    ap.add_argument("--connection", default="snowhouse", help="snow CLI connection for --online-icons")
    args = ap.parse_args()

    if not RENDER_MODULE.exists():
        print(f"ERROR: {RENDER_MODULE} missing - run assets/render/build_render.py first", file=sys.stderr)
        return 2

    model = json.loads(Path(args.model).read_text(encoding="utf-8"))
    doc = json.loads(Path(args.doc).read_text(encoding="utf-8")) if args.doc else None

    result = build(model, args.title, doc, online_icons=args.online_icons, connection=args.connection)
    html = result.get("html") or ""

    if args.out == "-":
        sys.stdout.write(html)
        return 0

    out = Path(args.out)
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out}  ({len(html)} bytes)")

    if not args.no_sidecars:
        sidecars = {"mmd": out.with_suffix(".mmd"),
                    "svg": out.with_suffix(".svg"),
                    "drawio": out.with_suffix(".drawio.xml")}
        for key, path in sidecars.items():
            content = result.get(key) or ""
            if content:
                path.write_text(content, encoding="utf-8")
                print(f"wrote {path}  ({len(content)} bytes)")
        if result.get("pdf"):
            pdf_path = out.with_suffix(".pdf")
            pdf_path.write_bytes(result["pdf"])
            print(f"wrote {pdf_path}  ({len(result['pdf'])} bytes)")
        if result.get("static_png"):
            png_path = out.parent / (out.stem + ".static.png")
            png_path.write_bytes(result["static_png"])
            print(f"wrote {png_path}  ({len(result['static_png'])} bytes)")
        if result.get("pdf_error"):
            print(f"WARNING: PDF/static PNG skipped -- {result['pdf_error']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
