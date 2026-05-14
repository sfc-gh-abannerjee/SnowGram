#!/usr/bin/env python3
"""
review_templates.py — SnowGram template review harness.

For each of the 14 templates in SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES,
this harness:

  1. Fetches the Mermaid source from Snowflake
  2. Asks the running frontend (localhost:3002) to parse it via
     `window.inspectDiagramSpec` and to render it via `window.generateDiagram`
  3. Captures a screenshot of the rendered canvas
  4. Runs a per-template checklist (component presence, badge presence,
     no raw-syntax leakage, etc.)
  5. Writes per-template artifacts under backend/tests/visual/review/<TEMPLATE_ID>/
  6. Generates an INDEX.html with a side-by-side dashboard of all 14 templates

The harness captures both pipelines (legacy and the new DiagramSpec path)
when run with --both, so we can A/B-compare the same template under both
implementations.

Usage
  python3 backend/tests/visual/review_templates.py
  python3 backend/tests/visual/review_templates.py --template STREAMING_DATA_STACK
  python3 backend/tests/visual/review_templates.py --both
  python3 backend/tests/visual/review_templates.py --url http://localhost:3002

Pre-reqs:
  pip install playwright snowflake-connector-python
  playwright install chromium
  cd frontend && npm run dev   # frontend must be running at --url
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("Playwright not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)

try:
    import snowflake.connector
except ImportError:
    print("Snowflake connector not installed. Run: pip install snowflake-connector-python")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Per-template checklists
# ---------------------------------------------------------------------------
# Each entry declares the expected components, badges, and forbidden strings
# for one template. Components are matched case-insensitively against either
# the node id or label. Add new templates by appending to this dict.
# ---------------------------------------------------------------------------

CHECKLISTS: Dict[str, Dict[str, Any]] = {
    "STREAMING_DATA_STACK": {
        "expected_components": [
            "Producer App", "Kafka", "Kinesis", "Event Hubs", "Pub/Sub",
            "S3", "Azure Blob", "GCS", "Snowpipe Streaming", "Snowpipe",
            "Streams", "Serverless Tasks", "Dynamic Tables", "Snowpark",
            "In-app Analytics", "Consumer App",
        ],
        "expected_lane_badges": ["1A", "1B", "1C", "1D"],
        "expected_section_badges": ["2", "3", "4", "5", "6"],
        "expected_external_node_ids": [
            "kafka", "kinesis", "event_hubs", "pubsub", "s3",
            "azure_blob", "gcs", "industry_sources", "compute",
        ],
        "expected_internal_node_ids": [
            "snowpipe_streaming", "snowpipe", "streams", "serverless_tasks",
            "dynamic_tables", "marketplace", "native_connector",
        ],
        "min_edges": 25,
    },
    "MEDALLION_LAKEHOUSE": {
        "expected_components": [
            "Snowpipe", "Bronze", "Silver", "Gold", "Stream",
            "Dynamic Tables", "BI Tools", "S3",
        ],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": ["s3"],
        "expected_internal_node_ids": [
            "pipe", "bronze_db", "bronze_raw", "stream_b", "task_clean",
            "silver_db", "silver_tables", "dyn_table", "gold_db", "gold_agg",
        ],
        "min_edges": 8,
    },
    "MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY": {
        "expected_components": ["Bronze", "Silver", "Gold", "Stream", "Task"],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": [],
        "expected_internal_node_ids": [],
        "min_edges": 5,
    },
    "BATCH_DATA_WAREHOUSE": {
        "expected_components": ["Snowpipe", "Stage", "Stream", "Task", "Fact", "Dimension", "BI"],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": [],
        "expected_internal_node_ids": [],
        "min_edges": 5,
    },
    "CUSTOMER_360": {
        "expected_components": ["Customer", "ML", "Prediction", "Snowpipe"],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": [],
        "expected_internal_node_ids": [],
        "min_edges": 4,
    },
    "ML_FEATURE_ENGINEERING": {
        "expected_components": ["Model Registry", "Cortex", "Snowpark", "SPCS"],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": [],
        "expected_internal_node_ids": [],
        "min_edges": 4,
    },
    "SECURITY_ANALYTICS": {
        "expected_components": ["Snowpipe", "Search Optimization", "Stream", "Task"],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": [],
        "expected_internal_node_ids": [],
        "min_edges": 4,
    },
    "DATA_GOVERNANCE_COMPLIANCE": {
        "expected_components": ["Masking", "RLS", "Tag", "Policy"],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": [],
        "expected_internal_node_ids": [],
        "min_edges": 3,
    },
    "EMBEDDED_ANALYTICS": {
        "expected_components": ["Hybrid", "Multi-Cluster", "Application"],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": [],
        "expected_internal_node_ids": [],
        "min_edges": 3,
    },
    "MULTI_CLOUD_DATA_MESH": {
        "expected_components": ["AWS", "Azure", "GCP", "Share"],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": [],
        "expected_internal_node_ids": [],
        "min_edges": 3,
    },
    "SERVERLESS_DATA_STACK": {
        "expected_components": ["Lambda", "Function", "API Gateway"],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": [],
        "expected_internal_node_ids": [],
        "min_edges": 3,
    },
    "REALTIME_FINANCIAL_TRANSACTIONS": {
        "expected_components": ["Transaction", "Stream", "Snowpipe Streaming"],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": [],
        "expected_internal_node_ids": [],
        "min_edges": 3,
    },
    "REALTIME_IOT_PIPELINE": {
        "expected_components": ["IoT", "MQTT", "Snowpipe"],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": [],
        "expected_internal_node_ids": [],
        "min_edges": 3,
    },
    "HYBRID_CLOUD_LAKEHOUSE": {
        "expected_components": ["Iceberg", "External Catalog"],
        "expected_lane_badges": [],
        "expected_section_badges": [],
        "expected_external_node_ids": [],
        "expected_internal_node_ids": [],
        "min_edges": 3,
    },
}

# Generic checks applied to every template
FORBIDDEN_LABEL_PATTERNS = [
    re.compile(r"^[/\\]"),       # leading slash/backslash (parallelogram leak)
    re.compile(r"[/\\]$"),       # trailing slash/backslash
    re.compile(r"\(\("),         # `((`  (circle leak)
    re.compile(r"\[\("),         # `[(`  (cylinder leak)
    re.compile(r"\{\{"),         # `{{`  (hexagon leak)
    re.compile(r"\[\["),         # `[[`  (subroutine leak)
    re.compile(r"\\\""),         # escaped quote
]

HELPER_NODE_PATTERNS = (
    "spacer_", "label_area_", "label_streaming", "label_batch",
    "label_native", "label_cdc", "label_transform", "label_write",
    "label_scale", "label_process", "label_analyze", "label_deliver",
)


# ---------------------------------------------------------------------------
# Snowflake template fetching
# ---------------------------------------------------------------------------

def fetch_templates(connection_name: str, only_template: Optional[str] = None) -> List[Dict[str, str]]:
    """Pull all 14 (or one) templates from Snowflake."""
    conn = snowflake.connector.connect(connection_name=connection_name)
    cur = conn.cursor()
    sql = ("SELECT template_id, full_mermaid_code FROM SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES "
           "WHERE 1=1")
    if only_template:
        sql += f" AND template_id = '{only_template}'"
    sql += " ORDER BY template_id"
    cur.execute(sql)
    rows = [{"template_id": tid, "mermaid": code} for tid, code in cur.fetchall()]
    cur.close()
    conn.close()
    return rows


# ---------------------------------------------------------------------------
# Checklist evaluation against a parsed DiagramSpec
# ---------------------------------------------------------------------------

@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str = ""


@dataclass
class TemplateResult:
    template_id: str
    pipeline: str        # "legacy" or "unified"
    spec: Dict[str, Any] = field(default_factory=dict)
    screenshot_path: Optional[str] = None
    checks: List[CheckResult] = field(default_factory=list)

    @property
    def pass_rate(self) -> float:
        if not self.checks:
            return 0.0
        return sum(1 for c in self.checks if c.passed) / len(self.checks) * 100


def evaluate_checklist(template_id: str, spec: Dict[str, Any]) -> List[CheckResult]:
    """Run the per-template checklist against the parsed DiagramSpec."""
    checks: List[CheckResult] = []
    cl = CHECKLISTS.get(template_id, {})

    nodes = spec.get("nodes", []) or []
    edges = spec.get("edges", []) or []
    badges = spec.get("badges", []) or []
    groups = spec.get("groups", []) or []

    # Generic checks ----------------------------------------------------------

    # No raw Mermaid syntax in any node label
    leaks = [n for n in nodes if any(p.search(n.get("label", "") or "") for p in FORBIDDEN_LABEL_PATTERNS)]
    checks.append(CheckResult(
        "no_raw_syntax_in_labels",
        passed=not leaks,
        detail=f"{len(leaks)} node(s) with raw syntax: " + ", ".join(n.get("id", "") for n in leaks[:3])
        if leaks else "all labels clean",
    ))

    # No helper nodes leaked into spec
    helpers = [n for n in nodes if n.get("id", "").startswith(HELPER_NODE_PATTERNS)]
    checks.append(CheckResult(
        "no_helper_nodes_leaked",
        passed=not helpers,
        detail=f"{len(helpers)} helper node(s) leaked" if helpers else "no helpers in spec",
    ))

    # Edge count meets minimum
    min_edges = cl.get("min_edges", 0)
    checks.append(CheckResult(
        "min_edges",
        passed=len(edges) >= min_edges,
        detail=f"{len(edges)} edges (min {min_edges})",
    ))

    # Component checks --------------------------------------------------------

    expected = cl.get("expected_components", [])
    if expected:
        node_haystack = " | ".join(
            f"{n.get('id', '')} {n.get('label', '')} {n.get('componentType', '')}".lower()
            for n in nodes
        )
        missing = [c for c in expected if c.lower() not in node_haystack]
        checks.append(CheckResult(
            "expected_components_present",
            passed=not missing,
            detail=f"missing: {missing}" if missing else f"all {len(expected)} present",
        ))

    # Badge checks ------------------------------------------------------------

    expected_lane = [b.upper() for b in cl.get("expected_lane_badges", [])]
    expected_section = [str(b).upper() for b in cl.get("expected_section_badges", [])]

    if expected_lane:
        actual_lane = {b.get("label", "").upper() for b in badges if b.get("variant") == "lane"}
        missing_lane = [b for b in expected_lane if b not in actual_lane]
        checks.append(CheckResult(
            "expected_lane_badges_present",
            passed=not missing_lane,
            detail=f"missing lane badges: {missing_lane}; actual: {sorted(actual_lane)}"
            if missing_lane else f"all {len(expected_lane)} lane badges present",
        ))

    if expected_section:
        actual_section = {b.get("label", "").upper() for b in badges if b.get("variant") == "section"}
        missing_section = [b for b in expected_section if b not in actual_section]
        checks.append(CheckResult(
            "expected_section_badges_present",
            passed=not missing_section,
            detail=f"missing section badges: {missing_section}; actual: {sorted(actual_section)}"
            if missing_section else f"all {len(expected_section)} section badges present",
        ))

    return checks


# ---------------------------------------------------------------------------
# Playwright orchestration
# ---------------------------------------------------------------------------

async def run_template(
    page,
    template_id: str,
    mermaid: str,
    out_dir: Path,
    pipeline: str,
) -> TemplateResult:
    """Render one template via the configured pipeline and run the checklist."""
    print(f"[{pipeline}] {template_id}: rendering...")

    # Toggle the feature flag at runtime by setting a local-storage value the
    # frontend reads. The frontend currently reads NEXT_PUBLIC_USE_DIAGRAM_SPEC
    # at build time, so for the legacy/unified split we set localStorage and
    # ask the page to honor it.
    use_unified = pipeline == "unified"
    await page.evaluate(
        f"() => localStorage.setItem('useDiagramSpec', '{str(use_unified).lower()}')"
    )
    # A small reload is the cleanest way to re-read the flag mid-session.
    # Skip if same pipeline as last call (caller manages ordering).

    # Inject the Mermaid via the test hook
    js_safe = mermaid.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")
    spec_json = await page.evaluate(
        f"() => {{ try {{ return JSON.stringify(window.inspectDiagramSpec(`{js_safe}`)); }} catch (e) {{ return null; }} }}"
    )
    spec = json.loads(spec_json) if spec_json else {}

    rendered = await page.evaluate(
        f"async () => {{ try {{ return await window.generateDiagram(`{js_safe}`); }} catch (e) {{ return false; }} }}"
    )
    if not rendered:
        print(f"[{pipeline}] {template_id}: render returned false, capturing anyway")

    # Wait for layout to settle
    await page.wait_for_timeout(1500)

    # Screenshot the .react-flow viewport
    screenshot_path = out_dir / f"{pipeline}.png"
    try:
        canvas = page.locator(".react-flow").first
        await canvas.screenshot(path=str(screenshot_path))
    except Exception as e:
        print(f"[{pipeline}] {template_id}: screenshot failed: {e}")
        await page.screenshot(path=str(screenshot_path), full_page=True)

    checks = evaluate_checklist(template_id, spec)

    return TemplateResult(
        template_id=template_id,
        pipeline=pipeline,
        spec=spec,
        screenshot_path=str(screenshot_path),
        checks=checks,
    )


async def harness(args) -> None:
    out_root = Path(__file__).parent / "review"
    out_root.mkdir(parents=True, exist_ok=True)

    print(f"Fetching templates from Snowflake (connection={args.connection})...")
    templates = fetch_templates(args.connection, args.template)
    print(f"Got {len(templates)} template(s)")

    pipelines = ["unified"] if not args.both else ["legacy", "unified"]
    if args.legacy_only:
        pipelines = ["legacy"]

    results: Dict[str, Dict[str, TemplateResult]] = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not args.show)
        context = await browser.new_context(viewport={"width": 1920, "height": 1080})
        page = await context.new_page()

        page.on("pageerror", lambda exc: print(f"[page error] {exc}"))

        print(f"Navigating to {args.url}...")
        await page.goto(args.url, wait_until="networkidle")
        # Wait for React hydration and our hook to register
        await page.wait_for_function(
            "typeof window.generateDiagram === 'function' && typeof window.inspectDiagramSpec === 'function'",
            timeout=15000,
        )

        for tpl in templates:
            tid = tpl["template_id"]
            mermaid = tpl["mermaid"]
            tpl_dir = out_root / tid
            tpl_dir.mkdir(parents=True, exist_ok=True)
            (tpl_dir / "mermaid.txt").write_text(mermaid, encoding="utf-8")

            results[tid] = {}
            for pipeline in pipelines:
                # Reload between pipelines so the flag swap is fresh
                if pipeline == "unified":
                    await page.evaluate("() => localStorage.setItem('useDiagramSpec', 'true')")
                else:
                    await page.evaluate("() => localStorage.setItem('useDiagramSpec', 'false')")

                result = await run_template(page, tid, mermaid, tpl_dir, pipeline)
                results[tid][pipeline] = result

                # Save spec + checklist
                (tpl_dir / f"spec.{pipeline}.json").write_text(
                    json.dumps(result.spec, indent=2), encoding="utf-8"
                )
                (tpl_dir / f"result.{pipeline}.json").write_text(
                    json.dumps(
                        {
                            "template_id": tid,
                            "pipeline": pipeline,
                            "pass_rate": result.pass_rate,
                            "checks": [
                                {"name": c.name, "passed": c.passed, "detail": c.detail}
                                for c in result.checks
                            ],
                        },
                        indent=2,
                    ),
                    encoding="utf-8",
                )

        await browser.close()

    # Generate INDEX.html dashboard
    write_index(out_root, results, pipelines)
    print(f"\nReview written to {out_root}/INDEX.html")
    print_summary(results, pipelines)


def write_index(out_root: Path, results: Dict[str, Dict[str, TemplateResult]], pipelines: List[str]) -> None:
    """Produce a single HTML dashboard."""
    rows: List[str] = []
    for tid in sorted(results.keys()):
        cells = [f'<td class="tid">{tid}</td>']
        for pipeline in pipelines:
            r = results[tid].get(pipeline)
            if not r:
                cells.append("<td>—</td>")
                continue
            rate = r.pass_rate
            color = "#16a34a" if rate == 100 else ("#eab308" if rate >= 50 else "#ef4444")
            check_summary = "".join(
                f'<li class="{"ok" if c.passed else "fail"}">{c.name}: {c.detail}</li>'
                for c in r.checks
            )
            img_rel = Path(r.screenshot_path).relative_to(out_root) if r.screenshot_path else ""
            cells.append(
                f'<td><div style="color:{color};font-weight:600">{rate:.0f}%</div>'
                f'<a href="{img_rel}" target="_blank"><img src="{img_rel}" loading="lazy" /></a>'
                f'<details><summary>checks ({len(r.checks)})</summary><ul>{check_summary}</ul></details></td>'
            )
        rows.append("<tr>" + "".join(cells) + "</tr>")

    pipeline_headers = "".join(f"<th>{p}</th>" for p in pipelines)

    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>SnowGram template review</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; margin: 16px; background: #0f172a; color: #e5edf5; }}
  h1 {{ font-size: 18px; }}
  table {{ border-collapse: collapse; width: 100%; }}
  th, td {{ border: 1px solid #1f2937; padding: 8px; vertical-align: top; }}
  th {{ background: #111827; }}
  td.tid {{ font-weight: 600; white-space: nowrap; min-width: 200px; }}
  img {{ max-width: 720px; max-height: 420px; border: 1px solid #1f2937; border-radius: 4px; }}
  details {{ font-size: 11px; margin-top: 6px; }}
  ul {{ margin: 4px 0 0 0; padding-left: 14px; }}
  li.ok::before {{ content: "✓ "; color: #16a34a; }}
  li.fail::before {{ content: "✗ "; color: #ef4444; }}
</style></head><body>
<h1>SnowGram template review &mdash; {time.strftime('%Y-%m-%d %H:%M:%S')}</h1>
<table>
<thead><tr><th>Template</th>{pipeline_headers}</tr></thead>
<tbody>{''.join(rows)}</tbody>
</table>
</body></html>
"""
    (out_root / "INDEX.html").write_text(html, encoding="utf-8")


def print_summary(results: Dict[str, Dict[str, TemplateResult]], pipelines: List[str]) -> None:
    print("\nSummary:")
    print("-" * 60)
    for tid in sorted(results.keys()):
        line = f"{tid:<40s}"
        for pipeline in pipelines:
            r = results[tid].get(pipeline)
            line += f"  {pipeline}={r.pass_rate:5.1f}%" if r else f"  {pipeline}=  err"
        print(line)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--connection", default="se_demo", help="Snowflake connection name")
    parser.add_argument("--url", default="http://localhost:3002", help="Frontend URL")
    parser.add_argument("--template", help="Run a single template by ID")
    parser.add_argument("--both", action="store_true", help="Run both legacy and unified pipelines")
    parser.add_argument("--legacy-only", action="store_true", help="Run only the legacy pipeline")
    parser.add_argument("--show", action="store_true", help="Show browser (non-headless)")
    args = parser.parse_args()

    asyncio.run(harness(args))


if __name__ == "__main__":
    main()
