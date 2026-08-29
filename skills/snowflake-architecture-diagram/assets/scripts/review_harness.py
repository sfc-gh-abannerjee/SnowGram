#!/usr/bin/env python3
"""
review_harness.py — regenerate a human-in-the-loop visual review package for
the layout-engine + render pipeline, entirely offline (no Snowflake, no live
agent) unless --live is passed.

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
    -> <name>.png  (Playwright screenshot, skipped gracefully if Playwright
                     isn't installed)

Also runs `node tests/run.mjs` and folds its output into REVIEW.md.

Output: skills/snowflake-architecture-diagram/review-runs/<run-id>/
  (gitignored — regenerate on demand, this is a build artifact, not source)

Usage:
  python3 review_harness.py                      # offline, all fixtures
  python3 review_harness.py --fixture nested_containers
  python3 review_harness.py --skip-render-sync   # skip build_render.py resync
  python3 review_harness.py --live               # + a live-agent real-world check
  python3 review_harness.py --live --agent TEMP.ABANNERJEE.SNOWGRAM_AGENT --connection snowhouse
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
RUNS_DIR = SKILL_DIR / "review-runs"
SNOWGRAM_ENG_REPO = Path.home() / "Documents" / "snowgram-eng"  # sibling checkout; matches build_render.py's DEFAULT_SRC

FIXTURE_DESCRIPTIONS = {
    "medallion": "Baseline sanity check: a simple 8-node medallion pipeline.",
    "fanout_finin": "Fan-out/fan-in across zones + a skip-zone edge — exercises bridged H-V-H-V-H routing.",
    "row_wrap_stress": "Apex-Health-scale, 18 nodes / 9 zones — the exact shape that produced an "
                        "unbounded ~16:1 layout before row-wrapping (Phase 1).",
    "nested_containers": "'AWS Account' (pure wrapper) nesting 'AWS VPC' (wraps 2 zones) — Phase 2/3 "
                          "recursive nested containers, geometry + rendering.",
}


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


def render_fixture(name: str, out_dir: Path) -> dict:
    render_local = _load_module("render_local", RENDER_LOCAL)
    model_path = FIXTURES_DIR / f"{name}.json"
    model = json.loads(model_path.read_text(encoding="utf-8"))
    title = name.replace("_", " ").title()
    result = render_local.build(model, title, None, online_icons=False)

    html_path = out_dir / f"{name}.html"
    html_path.write_text(result.get("html") or "", encoding="utf-8")
    for key, ext in (("svg", "svg"), ("drawio", "drawio.xml"), ("mmd", "mmd")):
        content = result.get(key) or ""
        if content:
            (out_dir / f"{name}.{ext}").write_text(content, encoding="utf-8")

    png_path = out_dir / f"{name}.png"
    warning = screenshot(html_path, png_path)
    return {
        "name": name,
        "description": FIXTURE_DESCRIPTIONS.get(name, ""),
        "html": html_path.name,
        "png": png_path.name if warning is None else None,
        "warning": warning,
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
    m = re.search(r"HTML \(interactive\)\s*(?:->|→|-)\s*\[.*?\]\((https://[^)]+)\)", response)
    if not m:
        return {"response_file": "live_agent_response.txt", "warning": "Could not find an HTML download link in the response."}
    html_path = out_dir / "live_agent_apex_health.html"
    curl = subprocess.run(["curl", "-s", m.group(1), "-o", str(html_path)], capture_output=True, text=True)
    if curl.returncode != 0:
        return {"response_file": "live_agent_response.txt", "warning": "Downloaded HTML failed: " + curl.stderr}
    png_path = out_dir / "live_agent_apex_health.png"
    warning = screenshot(html_path, png_path, viewport=(1700, 1100))
    return {
        "response_file": "live_agent_response.txt",
        "html": html_path.name,
        "png": png_path.name if warning is None else None,
        "warning": warning,
    }


def write_review_md(out_dir: Path, meta: dict, test_ok: bool, test_output: str,
                     fixtures: list[dict], live: dict | None) -> None:
    lines = [
        "# SnowGram review package",
        "",
        f"Generated: {meta['timestamp']}",
        f"SnowGram repo: `{meta['snowgram_sha']}`" + (" (dirty)" if meta["snowgram_dirty"] else ""),
        f"snowgram-eng repo: `{meta['eng_sha']}`" + (" (dirty)" if meta["eng_dirty"] else ""),
        "",
        "Regenerate this package any time with:",
        "```bash",
        "cd " + str(SCRIPTS_DIR),
        "python3 review_harness.py" + ("" if live is None else " --live"),
        "```",
        "",
        "Add `--live` to also run a real live-agent request (needs network + the "
        "`cortex` CLI) and screenshot its actual downloaded HTML artifact -- slower, "
        "but the closest thing to what a real user sees.",
        "",
        "> **Note on categories in these renders:** the local pipeline (`render_local.py`) "
        "resolves onprem/snow/outcome category with a simplified heuristic, not the live "
        "agent's `component_resolver`. Use these renders to judge layout/spacing/crossings/ "
        "nesting, not exact boundary placement for exotic component types -- use `--live` "
        "or the agent directly for that.",
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
        "## Fixture renders (offline, no Snowflake)",
        "",
    ]
    for f in fixtures:
        lines.append(f"### {f['name']}")
        if f["description"]:
            lines.append(f["description"])
        lines.append("")
        if f.get("png"):
            lines.append(f"![{f['name']}]({f['png']})")
        elif f.get("warning"):
            lines.append(f"_{f['warning']}_")
        lines.append(f"\nFull HTML: [{f['html']}]({f['html']})")
        lines.append("")

    if live:
        lines += [
            "## Live agent real-world check (Apex Health)",
            "",
            "Full response: [live_agent_response.txt](live_agent_response.txt)",
            "",
        ]
        if live.get("png"):
            lines.append(f"![live agent apex health]({live['png']})")
        elif live.get("warning"):
            lines.append(f"_{live['warning']}_")
        lines.append("")

    (out_dir / "REVIEW.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fixture", action="append", help="only render this fixture (repeatable); default: all")
    ap.add_argument("--skip-render-sync", action="store_true", help="skip build_render.py resync")
    ap.add_argument("--skip-tests", action="store_true", help="skip node tests/run.mjs")
    ap.add_argument("--live", action="store_true", help="also run a live-agent real-world check (needs network + cortex CLI)")
    ap.add_argument("--agent", default="TEMP.ABANNERJEE.SNOWGRAM_AGENT", help="agent FQN for --live")
    ap.add_argument("--connection", default="snowhouse", help="snow/cortex connection for --live")
    ap.add_argument("--run-id", help="output subdir name; default: timestamp")
    args = ap.parse_args()

    if not args.skip_render_sync:
        print("Syncing render_diagram_generated.py from snowgram-eng...")
        print(sync_render_module())

    ts = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    run_id = args.run_id or ts
    out_dir = RUNS_DIR / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output: {out_dir}")

    test_ok, test_output = (True, "(skipped)") if args.skip_tests else run_test_suite()
    print(test_output)
    if not test_ok:
        print("WARNING: test suite has failures -- continuing to render fixtures anyway.", file=sys.stderr)

    names = args.fixture or sorted(p.stem for p in FIXTURES_DIR.glob("*.json"))
    fixtures = []
    for name in names:
        print(f"Rendering fixture: {name}")
        fixtures.append(render_fixture(name, out_dir))

    live_result = None
    if args.live:
        print(f"Running live agent check against {args.agent} ...")
        live_result = live_agent_check(args.agent, args.connection, out_dir)

    meta = {
        "timestamp": _dt.datetime.now().isoformat(timespec="seconds"),
        "snowgram_sha": _git(SKILL_DIR.parent.parent, "rev-parse", "--short", "HEAD"),
        "snowgram_dirty": bool(_git(SKILL_DIR.parent.parent, "status", "--porcelain")),
        "eng_sha": _git(SNOWGRAM_ENG_REPO, "rev-parse", "--short", "HEAD"),
        "eng_dirty": bool(_git(SNOWGRAM_ENG_REPO, "status", "--porcelain")),
    }
    write_review_md(out_dir, meta, test_ok, test_output, fixtures, live_result)
    print(f"\nReview package ready: {out_dir / 'REVIEW.md'}")
    return 0 if test_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
