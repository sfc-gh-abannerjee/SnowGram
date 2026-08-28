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
RENDER_STATIC = ASSETS / "scripts" / "render_static.py"
ICON_RESOLVER = ASSETS / "scripts" / "icon_resolver.py"


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# Port of GENERATE_DIAGRAM_ARTIFACTS._category so local categories match the
# agent's intent (drives boundary membership + the node subhead styling).
def _category(ctype: str, label: str, path: str | None) -> str:
    c = (ctype or "").lower()
    l = (label or "").lower()
    pth = path or ""
    if any(k in c for k in ("snowpipe", "openflow", "kafka connector", "connector for kafka")):
        return "bridge"
    if any(k in c or k in l for k in (
        "streamlit", "tableau", "power bi", "powerbi", "looker", "dashboard",
        "superset", "sigma", "metabase", "quicksight", "notebook",
    )):
        return "outcome"
    if pth and not pth.startswith("sno-icon"):
        return "onprem"
    if any(k in c for k in (
        "s3", "kafka", "kinesis", "blob", "gcs", "event hub", "eventhub",
        "postgres", "mysql", "oracle", "mongo", "redis", "external", "data lake",
        "databricks", "spark", "bigquery", "synapse", "redshift", "pub/sub", "pubsub",
    )):
        return "onprem"
    return "snow"


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

    nodes = [dict(n) for n in (model.get("nodes") or [])]
    edges = [dict(e) for e in (model.get("edges") or [])]

    id_to_label: dict = {}
    id_to_type: dict = {}
    icons: dict = {}
    cats: dict = {}

    for n in nodes:
        nid = n.get("id")
        label = n.get("label") or nid
        ctype = n.get("component_type") or n.get("type") or ""
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
        # category: explicit > manifest-resolved > heuristic
        if n.get("category"):
            cats[nid] = n["category"]
        else:
            resolved = rs._resolve_icon_for_object_type(ctype, manifest)
            cats[nid] = (resolved[1] if resolved else None) or _category(ctype, label, icon_path)

    g_nodes = [
        {
            "id": n.get("id"),
            "label": id_to_label.get(n.get("id")),
            "componentType": id_to_type.get(n.get("id"), ""),
            "zone": n.get("layer") or n.get("zone") or "Main",
            "category": cats.get(n.get("id")),
        }
        for n in nodes
    ]
    g_edges = [
        {"from": e.get("source") or e.get("from"), "to": e.get("target") or e.get("to")}
        for e in edges
        if (e.get("source") or e.get("from")) and (e.get("target") or e.get("to"))
    ]
    edge_labels = {}
    for e in edges:
        s = e.get("source") or e.get("from")
        t = e.get("target") or e.get("to")
        if e.get("label") and s and t:
            edge_labels[f"{s}|{t}"] = e["label"]

    base_graph = {"nodes": g_nodes, "edges": g_edges}
    if model.get("containers"):
        base_graph["containers"] = model["containers"]

    # narrow geometry (svg/drawio/mmd) + wide geometry (HTML icon-left)
    layout = _run_layout(json.dumps(base_graph), wide=False)
    for ln in layout.get("nodes", []) or []:
        ln["label"] = id_to_label.get(ln.get("id"), ln.get("label") or ln.get("id"))

    html_layout = _run_layout(json.dumps({**base_graph, "nodeStyle": "wide"}), wide=True)
    for ln in html_layout.get("nodes", []) or []:
        nid = ln.get("id")
        ln["label"] = id_to_label.get(nid, ln.get("label") or nid)
        ln["componentType"] = id_to_type.get(nid, "")
        ln["category"] = cats.get(nid)

    enrich: dict = {"icons": icons, "edgeLabels": edge_labels}
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
