#!/usr/bin/env python3
"""
review_harness.py — regenerate a human-in-the-loop visual review package for
the layout-engine + render pipeline. By DEFAULT it also runs the live agent and
builds a mandatory offline-vs-live SIDE-BY-SIDE (the artifact a reviewer signs
off on); pass --offline-only to skip that (needs Snowflake + the cortex CLI).

Why this exists: iterative layout-engine/render-engine changes need a fast,
repeatable way to SEE the effect of a change (crossings, spacing, nesting)
alongside the numeric test suite, without hand-writing one-off Playwright/
matplotlib scripts each time and without leaving throwaway artifacts in /tmp.
This script is the reusable version of that — run it after any layout-engine
or render_diagram.dev.sql change to get a fresh, versioned review package.

Pipeline per fixture:
  tests/fixtures/<name>.json  (SAME file tests/run.mjs uses -- one source of
                                truth, so the numeric suite and this visual
                                package can never drift apart)
    -> render_local.build()   (layout_cli.mjs geometry + the vendored
                                render_diagram_generated.py -- full parity
                                with the live agent's rendering)
    -> <name>.html (+ .svg/.drawio.xml/.mmd sidecars)
    -> <name>.png          (interactive-HTML Playwright screenshot,
                             skipped gracefully if Playwright isn't installed)
    -> <name>.pdf + <name>.static.png  (static-SVG renderer, via the SAME
                             weasyprint/pdf2image path the deployed
                             GENERATE_DIAGRAM_ARTIFACTS proc uses -- skipped
                             gracefully if weasyprint/its system libs are
                             missing. On macOS: `brew install pango` AND
                             run with DYLD_LIBRARY_PATH=/opt/homebrew/lib,
                             or a plain pip install still fails to load
                             libgobject-2.0-0.)
EVERY format is part of the package every run -- a reviewer should never
need to regenerate a specific format separately to see it.

Also runs `node tests/run.mjs` and folds its output into REVIEW.md.

Output: skills/snowflake-architecture-diagram/review-runs/<run-id>/
  (gitignored — regenerate on demand, this is a build artifact, not source)

Usage:
  python3 review_harness.py                      # live + offline-vs-live side-by-side (default)
  python3 review_harness.py --offline-only       # offline only; marked NOT-FOR-SIGN-OFF
  python3 review_harness.py --fixture nested_containers
  python3 review_harness.py --skip-render-sync   # skip build_render.py resync
  python3 review_harness.py --agent TEMP.ABANNERJEE.SNOWGRAM_AGENT --connection snowhouse
"""
from __future__ import annotations

import argparse
import datetime as _dt
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent            # assets/scripts
ASSETS_DIR = SCRIPTS_DIR.parent                            # assets
SKILL_DIR = ASSETS_DIR.parent                               # skill root
LAYOUT_ENGINE_DIR = ASSETS_DIR / "layout-engine"
FIXTURES_DIR = LAYOUT_ENGINE_DIR / "tests" / "fixtures"
RENDER_LOCAL = SCRIPTS_DIR / "render_local.py"
BUILD_RENDER = ASSETS_DIR / "render" / "build_render.py"
EXTRACT_SHARED_RULES = ASSETS_DIR / "render" / "extract_shared_rules.py"
RUNS_DIR = SKILL_DIR / "review-runs"
SNOWGRAM_ENG_REPO = Path.home() / "Documents" / "snowgram-eng"  # sibling checkout; matches build_render.py's DEFAULT_SRC

FIXTURE_DESCRIPTIONS = {
    "medallion": "Baseline sanity check: a simple 8-node medallion pipeline.",
    "fanout_finin": "Fan-out/fan-in across zones + a skip-zone edge — exercises bridged H-V-H-V-H routing.",
    "row_wrap_stress": "Apex-Health-scale, 18 nodes / 9 zones — the exact shape that produced an "
                        "unbounded ~16:1 layout before row-wrapping (Phase 1).",
    "nested_containers": "'AWS Account' (pure wrapper) nesting 'AWS VPC' (wraps 2 zones) — Phase 2/3 "
                          "recursive nested containers, geometry + rendering.",
    "apex_health_privatelink_stub": "The REAL 16-node/18-edge Apex Health model pulled from an actual "
                                     "live-agent trace — used for every port-approach-stub/hug-clearance/ "
                                     "self-card-re-entry/fan-in-spacing/title-overflow regression this "
                                     "session, since reduced minimal repros repeatedly failed to reproduce "
                                     "bugs that only emerge from all 18 edges' combined obstacle/lane "
                                     "pressure. The most representative fixture for a general visual pass.",
}

# The fixture that gets the mandatory offline-vs-live side-by-side (see
# build_side_by_side + main). It is the most representative model AND the one the
# live-agent check composes, so the two panels are directly comparable. If this is
# ever renamed, update it here or the side-by-side silently loses its offline panel.
COMPARISON_FIXTURE = "apex_health_privatelink_stub"


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _git(repo: Path, *args: str) -> str:
    try:
        return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "unknown"


def sync_render_module() -> str:
    proc = subprocess.run([sys.executable, str(BUILD_RENDER)], capture_output=True, text=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        print(out, file=sys.stderr)
        raise SystemExit("build_render.py failed -- see output above")
    return out.strip()


def sync_shared_rules() -> str:
    # Re-extracts shared_rules.py from generate_artifacts.dev.sql's
    # SHARED_MODEL_RULES block (category classification + edge label/
    # style/bidirectional extraction) EVERY run, the same way
    # sync_render_module() above always re-syncs render_diagram_generated.py
    # -- this is the whole point: the offline pipeline can never render
    # against a stale or hand-copied version of this logic. Its own smoke
    # test (inside the script) fails loudly if the source's marked block
    # has been restructured in a way extraction can't follow.
    proc = subprocess.run([sys.executable, str(EXTRACT_SHARED_RULES)], capture_output=True, text=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        print(out, file=sys.stderr)
        raise SystemExit("extract_shared_rules.py failed -- see output above")
    return out.strip()


def run_test_suite() -> tuple[bool, str]:
    proc = subprocess.run(["node", "tests/run.mjs"], cwd=str(LAYOUT_ENGINE_DIR), capture_output=True, text=True)
    text = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode == 0, text


def screenshot(html_path: Path, png_path: Path, viewport=(1600, 1000)) -> str | None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return "Playwright not installed (`pip install playwright && playwright install chromium`) -- HTML written, PNG skipped."
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": viewport[0], "height": viewport[1]})
            page.goto(html_path.resolve().as_uri())
            page.wait_for_timeout(250)
            page.screenshot(path=str(png_path), full_page=True)
            browser.close()
        return None
    except Exception as e:
        return f"Screenshot failed: {e}"


def _diagram_shot(page, html_path: Path, tmp_png: Path) -> bool:
    """Screenshot ONLY the diagram region of a rendered page (not the header or the
    documentation panel), so the offline and live panels compare like-for-like. Falls
    back through selectors, then to a full-page shot if none match."""
    page.goto(html_path.resolve().as_uri())
    page.wait_for_timeout(400)
    for sel in ("[data-diagram-root]", ".diagram-root", ".canvas"):
        try:
            loc = page.locator(sel).first
            if loc.count() > 0:
                loc.screenshot(path=str(tmp_png))
                return True
        except Exception:
            continue
    page.screenshot(path=str(tmp_png), full_page=True)
    return True


def build_side_by_side(left_html: Path | None, right_html: Path | None, out_path: Path,
                       left_label: str, right_label: str) -> str | None:
    """Composite the two DIAGRAMS (not full pages) into ONE image, each in an
    EQUAL-SIZED cell (same width and height) with its diagram contain-fit + centered,
    so a reviewer compares them at matched proportions regardless of each render's
    native aspect ratio. Clean divider + labeled header. Returns None on success, or a
    warning string (missing panel / no PIL / no browser) so the caller can enforce."""
    if not left_html or not left_html.exists():
        return "side-by-side missing the offline HTML panel"
    if not right_html or not right_html.exists():
        return "side-by-side missing the live HTML panel"
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        return f"playwright unavailable for side-by-side ({e})"
    try:
        from PIL import Image, ImageDraw, ImageFont
    except Exception as e:
        return f"PIL unavailable for side-by-side ({e})"

    import tempfile
    lt = Path(tempfile.mktemp(suffix="_sbs_l.png"))
    rt = Path(tempfile.mktemp(suffix="_sbs_r.png"))
    try:
        with sync_playwright() as p:
            try:
                b = p.chromium.launch()
            except Exception as e:
                return f"chromium unavailable for side-by-side ({e})"
            pg = b.new_page(viewport={"width": 1700, "height": 1200})
            _diagram_shot(pg, left_html, lt)
            _diagram_shot(pg, right_html, rt)
            b.close()
        L = Image.open(lt).convert("RGB")
        R = Image.open(rt).convert("RGB")
    except Exception as e:
        return f"diagram screenshot for side-by-side failed ({e})"

    bg = (238, 242, 247)
    # Equal cells: both panels get the SAME box (the larger of each dimension); each
    # diagram is scaled to fit inside preserving aspect, then centered/padded.
    cell_w, cell_h = max(L.width, R.width), max(L.height, R.height)

    def _cell(im):
        s = min(cell_w / im.width, cell_h / im.height)
        nw, nh = max(1, round(im.width * s)), max(1, round(im.height * s))
        c = Image.new("RGB", (cell_w, cell_h), bg)
        c.paste(im.resize((nw, nh)), ((cell_w - nw) // 2, (cell_h - nh) // 2))
        return c

    Lc, Rc = _cell(L), _cell(R)
    gap, header, divider = 28, 52, 4
    right_x = cell_w + gap + divider + gap
    canvas = Image.new("RGB", (right_x + cell_w, cell_h + header), bg)
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
    except Exception:
        font = ImageFont.load_default()
    draw.text((gap, 15), left_label, fill=(22, 32, 58), font=font)
    draw.text((right_x, 15), right_label, fill=(22, 32, 58), font=font)
    canvas.paste(Lc, (0, header))
    canvas.paste(Rc, (right_x, header))
    dx = cell_w + gap + divider // 2
    draw.line([(dx, 0), (dx, cell_h + header)], fill=(41, 181, 232), width=divider)
    canvas.save(out_path)
    for t in (lt, rt):
        try:
            t.unlink()
        except Exception:
            pass
    return None


def render_fixture(name: str, out_dir: Path) -> dict:
    # `out_dir` here is the run's offline/ subfolder (see main()) -- every
    # path returned is relative to IT, so write_review_md() must prefix
    # with "offline/" when linking from the top-level REVIEW.md.
    render_local = _load_module("render_local", RENDER_LOCAL)
    model_path = FIXTURES_DIR / f"{name}.json"
    model = json.loads(model_path.read_text(encoding="utf-8"))
    title = name.replace("_", " ").title()
    result = render_local.build(model, title, None, online_icons=False)

    html_path = out_dir / f"{name}.html"
    html_path.write_text(result.get("html") or "", encoding="utf-8")
    written = {"html": html_path.name}
    for key, ext in (("svg", "svg"), ("drawio", "drawio.xml"), ("mmd", "mmd")):
        content = result.get(key) or ""
        if content:
            path = out_dir / f"{name}.{ext}"
            path.write_text(content, encoding="utf-8")
            written[key] = path.name

    # Interactive-HTML screenshot (Playwright) -- reviews the INTERACTIVE
    # experience specifically (hover, customize panel, wide icon-left cards).
    png_path = out_dir / f"{name}.png"
    warning = screenshot(html_path, png_path)
    if warning is None:
        written["png"] = png_path.name

    # PDF + a separately-named static.png, both via the SAME weasyprint/
    # pdf2image conversion the deployed GENERATE_DIAGRAM_ARTIFACTS proc
    # uses (render_local.svg_to_pdf_png) -- a DIFFERENT code path from the
    # Playwright screenshot above (that one exercises the interactive HTML
    # renderer; this one exercises the static SVG renderer), so both need
    # their own artifact rather than one standing in for the other. See
    # that function's docstring for the DYLD_LIBRARY_PATH gotcha on macOS.
    pdf_error = result.get("pdf_error")
    if result.get("pdf"):
        pdf_path = out_dir / f"{name}.pdf"
        pdf_path.write_bytes(result["pdf"])
        written["pdf"] = pdf_path.name
    if result.get("static_png"):
        static_png_path = out_dir / f"{name}.static.png"
        static_png_path.write_bytes(result["static_png"])
        written["static_png"] = static_png_path.name

    return {
        "name": name,
        "description": FIXTURE_DESCRIPTIONS.get(name, ""),
        **written,
        "warning": warning,
        "pdf_error": pdf_error,
    }


def live_agent_check(agent_fqn: str, connection: str, out_dir: Path) -> dict | None:
    prompt = (
        "Build the Apex Health Snowflake-on-Azure architecture: Azure Synapse, Azure SQL, and Azure "
        "Blob Storage feed dbt transformations, which feed Azure Data Factory orchestration, which "
        "connects over Azure Private Link into the Snowflake account. Arcadia Health, a separate "
        "Snowflake customer, shares curated medallion data in via Secure Data Sharing. Snowpipe "
        "ingests into Bronze/Silver/Gold dynamic tables. Horizon governance sits over the medallion "
        "layers. Cortex Cowork and a Streamlit/React app serve Apex analysts, with legacy Power BI "
        "also still reaching Snowflake over Private Link during the transition."
    )
    proc = subprocess.run(
        ["cortex", "agents", "run", agent_fqn, prompt, "-c", connection],
        capture_output=True, text=True, timeout=300,
    )
    response = (proc.stdout or "") + (proc.stderr or "")
    (out_dir / "live_agent_response.txt").write_text(response, encoding="utf-8")

    import re
    # Extension-based extraction (not label-text-based, not markdown-link-
    # syntax-based) so EVERY format the agent's response links -- not just
    # HTML -- gets downloaded, matching the same "every output format,
    # every run" bar the offline fixtures are held to. Verified against a
    # real response (2026-09-10): the actual format is a plain-text bullet
    # ("- HTML (interactive) \u2014 https://...&X-Amz-Signature=..."), NOT a
    # markdown link -- an earlier version of this regex assumed markdown
    # syntax and matched nothing. A bare URL's PATH component (before any
    # "?" query string) reliably ends in the real file extension regardless
    # of surrounding prose/punctuation, so match on that alone.
    links: dict[str, str] = {}
    for m in re.finditer(r"https://\S+", response):
        url = m.group(0).rstrip(".,;)")  # trim trailing prose punctuation
        path = url.split("?", 1)[0]
        for ext in ("html", "svg", "drawio.xml", "mmd", "pdf", "png"):
            if path.endswith("." + ext):
                # Normalize keys to match the offline package's naming:
                # the agent's own "png" link is the deployed static-SVG
                # renderer's weasyprint output (same code path as offline's
                # static_png, NOT the interactive-HTML screenshot the
                # offline "png" key means).
                key = {"drawio.xml": "drawio", "png": "static_png"}.get(ext, ext)
                links.setdefault(key, (url, ext))  # first match per format wins
                break
    if not links:
        return {"response_file": "live_agent_response.txt",
                "warning": "Could not find any format download link in the response."}

    written: dict[str, str] = {}
    for key, (url, ext) in links.items():
        # Use the FILE extension for the on-disk name (so it still opens
        # correctly), but the KEY for anything renamed above (static_png),
        # or it would collide with the interactive screenshot's own
        # live_agent_apex_health.png written just below.
        suffix = "static.png" if key == "static_png" else ext
        dest = out_dir / f"live_agent_apex_health.{suffix}"
        curl = subprocess.run(["curl", "-s", url, "-o", str(dest)], capture_output=True, text=True)
        if curl.returncode == 0:
            written[key] = dest.name
        else:
            print(f"WARNING: download failed for .{ext}: {curl.stderr}", file=sys.stderr)

    warning = None
    if written.get("html"):
        # Screenshots the actual downloaded INTERACTIVE html -- matching
        # the offline package's "png" key/purpose exactly now that the
        # agent-provided static render is normalized to "static_png" above.
        png_path = out_dir / "live_agent_apex_health.png"
        warning = screenshot(out_dir / written["html"], png_path, viewport=(1700, 1100))
        if warning is None:
            written["png"] = png_path.name
    return {
        "response_file": "live_agent_response.txt",
        **written,
        "warning": warning,
    }


def write_review_md(out_dir: Path, meta: dict, test_ok: bool, test_output: str,
                     fixtures: list[dict], live: dict | None,
                     side_by_side: str | None = None, offline_only: bool = False,
                     enforcement_error: str | None = None) -> None:
    # Headline: the offline-vs-live side-by-side is the artifact a reviewer signs
    # off on. It is mandatory unless --offline-only; when it is missing, say so
    # LOUDLY at the very top instead of quietly omitting it.
    if side_by_side:
        sbs_lines = [
            "## Side-by-side: offline vs live (sign-off view)",
            "",
            f"![offline vs live side-by-side]({side_by_side})",
            "",
            "Left = `render_local.py` (offline). Right = the live `SNOWGRAM_AGENT`. "
            "Compare these two before sign-off; the per-fixture and per-pipeline "
            "renders below are for drilling into detail.",
            "",
        ]
    elif offline_only:
        sbs_lines = [
            "## ⚠ NOT FOR SIGN-OFF — offline-only run",
            "",
            "This package was generated with `--offline-only`, so the mandatory "
            "offline-vs-live **side-by-side was NOT produced**. Do not sign off a "
            "visual change from this package; rerun `python3 review_harness.py` "
            "(no flag) with a live connection to get the comparison.",
            "",
        ]
    else:
        sbs_lines = [
            "## ⚠ INCOMPLETE — side-by-side could not be produced",
            "",
            f"The mandatory offline-vs-live side-by-side failed: **{enforcement_error}**. "
            "The live render or its screenshot did not succeed, so there is nothing to "
            "sign off against. Fix the live path and rerun.",
            "",
        ]
    lines = [
        "# SnowGram review package",
        "",
        f"Generated: {meta['timestamp']}",
        f"SnowGram repo: `{meta['snowgram_sha']}`" + (" (dirty)" if meta["snowgram_dirty"] else ""),
        f"snowgram-eng repo: `{meta['eng_sha']}`" + (" (dirty)" if meta["eng_dirty"] else ""),
        "",
        *sbs_lines,
        "Regenerate this package any time with:",
        "```bash",
        "cd " + str(SCRIPTS_DIR),
        "python3 review_harness.py" + (" --offline-only" if offline_only else ""),
        "```",
        "",
        "Live + the offline-vs-live side-by-side run BY DEFAULT (needs network + the "
        "`cortex` CLI). Pass `--offline-only` to skip them, which produces a package "
        "explicitly marked not-for-sign-off.",
        "",
        "> **Note on categories in these renders:** the local pipeline (`render_local.py`) "
        "resolves onprem/snow/outcome category with a simplified heuristic, not the live "
        "agent's `component_resolver`. Use the offline renders to judge layout/spacing/ "
        "crossings/nesting, and the live panel for exact boundary placement.",
        "",
        "## Numeric test suite (`node tests/run.mjs`)",
        "",
        f"Result: **{'ALL PASS' if test_ok else 'FAILURES -- see below'}**",
        "",
        "<details><summary>Full output</summary>",
        "",
        "```",
        test_output.strip(),
        "```",
        "</details>",
        "",
        "## Fixture renders (offline/, no Snowflake)",
        "",
    ]
    for f in fixtures:
        lines.append(f"### {f['name']}")
        if f["description"]:
            lines.append(f["description"])
        lines.append("")
        # Two independent screenshots: the interactive-HTML one (Playwright)
        # shows what a real user opening the .html sees; the static one
        # (weasyprint SVG->PDF->PNG) shows the SAME code path the PDF/PNG
        # export formats actually use -- they are not interchangeable, a
        # bug can live in one renderer and not the other (this session's
        # segBlocked/PORT_SLOT_SPACING fixes were layout-side and show in
        # both; the card-title word-wrap fix was static-SVG-only and would
        # NOT have shown in the interactive screenshot alone).
        if f.get("png"):
            lines.append(f"**Interactive HTML (Playwright screenshot):**\n![{f['name']} interactive](offline/{f['png']})")
        elif f.get("warning"):
            lines.append(f"_Interactive screenshot: {f['warning']}_")
        lines.append("")
        if f.get("static_png"):
            lines.append(f"**Static SVG/PDF renderer (weasyprint screenshot):**\n![{f['name']} static](offline/{f['static_png']})")
        elif f.get("pdf_error"):
            lines.append(f"_Static PDF/PNG skipped: {f['pdf_error']}_")
        lines.append("")
        # Every format produced for this fixture, so a reviewer never has
        # to go hunting in the run directory for one -- this is the actual
        # ask ("I need to see each of the outputs... part of the review
        # run package each time"), not just an html+png pair.
        fmt_links = []
        for key, label in (("html", "HTML"), ("svg", "SVG"), ("drawio", "drawio XML"),
                            ("mmd", "Mermaid"), ("pdf", "PDF"), ("static_png", "static PNG"),
                            ("png", "interactive PNG")):
            if f.get(key):
                fmt_links.append(f"[{label}](offline/{f[key]})")
        lines.append("Formats: " + " · ".join(fmt_links))
        lines.append("")

    if live:
        lines += [
            "## Live agent real-world check (online/, Apex Health)",
            "",
            "Full response: [live_agent_response.txt](online/live_agent_response.txt)",
            "",
        ]
        if live.get("png"):
            lines.append(f"**Interactive HTML (Playwright screenshot):**\n![live agent apex health interactive](online/{live['png']})")
        if live.get("static_png"):
            lines.append(f"**Static SVG/PDF renderer (agent-provided PNG):**\n![live agent apex health static](online/{live['static_png']})")
        if live.get("warning"):
            lines.append(f"_{live['warning']}_")
        lines.append("")
        fmt_links = []
        for key, label in (("html", "HTML"), ("svg", "SVG"), ("drawio", "drawio XML"),
                            ("mmd", "Mermaid"), ("pdf", "PDF"), ("static_png", "static PNG"),
                            ("png", "interactive PNG")):
            if live.get(key):
                fmt_links.append(f"[{label}](online/{live[key]})")
        if fmt_links:
            lines.append("Formats: " + " · ".join(fmt_links))
        lines.append("")

    (out_dir / "REVIEW.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fixture", action="append", help="only render this fixture (repeatable); default: all")
    ap.add_argument("--skip-render-sync", action="store_true", help="skip build_render.py resync")
    ap.add_argument("--skip-tests", action="store_true", help="skip node tests/run.mjs")
    ap.add_argument("--offline-only", action="store_true",
                    help="skip the live-agent render + the mandatory offline-vs-live side-by-side. "
                         "Produces a package explicitly marked NOT-FOR-SIGN-OFF. Use only where "
                         "Snowflake/network is unavailable.")
    ap.add_argument("--live", action="store_true", help="(deprecated no-op) live + side-by-side is now the default")
    ap.add_argument("--agent", default="TEMP.ABANNERJEE.SNOWGRAM_AGENT", help="agent FQN for the live check")
    ap.add_argument("--connection", default="snowhouse", help="snow/cortex connection for the live check")
    ap.add_argument("--run-id", help="output subdir name; default: timestamp")
    args = ap.parse_args()
    # Live + side-by-side is ENFORCED by default; opting out is explicit. --live is
    # kept as an accepted no-op so old commands still work.
    do_live = not args.offline_only

    if not args.skip_render_sync:
        print("Syncing render_diagram_generated.py from assets/render/source/...")
        print(sync_render_module())
        print("Syncing shared_rules.py from generate_artifacts.dev.sql's SHARED_MODEL_RULES block...")
        print(sync_shared_rules())

    ts = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    run_id = args.run_id or ts
    out_dir = RUNS_DIR / run_id
    # offline/ (render_local.py fixtures, no Snowflake) and online/ (a real
    # live agent call's downloaded artifacts) are kept in separate
    # subfolders of the SAME run -- both are dated/versioned together, but
    # a reviewer should never have to guess which pipeline produced which
    # file sitting side by side in one flat directory.
    offline_dir = out_dir / "offline"
    offline_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output: {out_dir}")

    test_ok, test_output = (True, "(skipped)") if args.skip_tests else run_test_suite()
    print(test_output)
    if not test_ok:
        print("WARNING: test suite has failures -- continuing to render fixtures anyway.", file=sys.stderr)

    names = args.fixture or sorted(p.stem for p in FIXTURES_DIR.glob("*.json"))
    # The side-by-side needs the comparison fixture's offline panel, so render it
    # even when --fixture narrows the set (otherwise the mandatory composite loses
    # its offline half whenever someone filters fixtures).
    if do_live and COMPARISON_FIXTURE not in names:
        names = list(names) + [COMPARISON_FIXTURE]
    fixtures = []
    for name in names:
        print(f"Rendering fixture: {name}")
        fixtures.append(render_fixture(name, offline_dir))

    live_result = None
    side_by_side = None            # relative path in the package, or None
    enforcement_error = None       # set when the mandatory side-by-side can't be produced
    if do_live:
        online_dir = out_dir / "online"
        online_dir.mkdir(parents=True, exist_ok=True)
        print(f"Running live agent check against {args.agent} ...")
        live_result = live_agent_check(args.agent, args.connection, online_dir)

        # MANDATORY side-by-side: offline comparison-fixture diagram | live-agent
        # diagram, each screenshotted diagram-only and placed in an equal-sized cell.
        offline_html = offline_dir / f"{COMPARISON_FIXTURE}.html"
        live_html = online_dir / live_result["html"] if (live_result and live_result.get("html")) else None
        sbs_path = out_dir / "side_by_side.png"
        warn = build_side_by_side(
            offline_html, live_html, sbs_path,
            f"OFFLINE — render_local ({COMPARISON_FIXTURE})", "ONLINE — live agent")
        if warn is None:
            side_by_side = sbs_path.name
            print(f"Side-by-side written: {sbs_path}")
        else:
            enforcement_error = warn
            print(f"ENFORCEMENT FAILURE: side-by-side not produced -- {warn}", file=sys.stderr)

    meta = {
        "timestamp": _dt.datetime.now().isoformat(timespec="seconds"),
        "snowgram_sha": _git(SKILL_DIR.parent.parent, "rev-parse", "--short", "HEAD"),
        "snowgram_dirty": bool(_git(SKILL_DIR.parent.parent, "status", "--porcelain")),
        "eng_sha": _git(SNOWGRAM_ENG_REPO, "rev-parse", "--short", "HEAD"),
        "eng_dirty": bool(_git(SNOWGRAM_ENG_REPO, "status", "--porcelain")),
    }
    write_review_md(out_dir, meta, test_ok, test_output, fixtures, live_result,
                    side_by_side=side_by_side, offline_only=args.offline_only,
                    enforcement_error=enforcement_error)
    print(f"\nReview package ready: {out_dir / 'REVIEW.md'}")
    if enforcement_error:
        print("REVIEW PACKAGE INCOMPLETE: the mandatory offline-vs-live side-by-side was not produced. "
              "Fix the live render, or rerun with --offline-only to acknowledge a not-for-sign-off package.",
              file=sys.stderr)
    return 0 if (test_ok and not enforcement_error) else 1


if __name__ == "__main__":
    raise SystemExit(main())
