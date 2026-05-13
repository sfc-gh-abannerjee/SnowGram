#!/usr/bin/env python3
"""
Persona test runner — regenerate the three synthetic-customer outputs.

Runs each prompt through:
  intent_router  ->  (template OR compose)  ->  flow_builder
  ->  state.json  ->  render_static.py  ->  HTML  ->  Chrome screenshot

Outputs go to test_outputs/personas/:
  <persona>_decision.json   intent router output (router transparency)
  <persona>_state.json      rich-viewer state with nodes + edges + icons
  <persona>_v3.html         self-contained HTML (offline-viewable)
  <persona>_v3.png          1900x800 Chrome screenshot

Usage:
  python3 test_outputs/run_personas.py
  python3 test_outputs/run_personas.py --no-screenshot   (skip Chrome)
  python3 test_outputs/run_personas.py --personas sarah  (one only)
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL_DIR = HERE.parent
ASSETS = SKILL_DIR / "assets"
COMPOSER = ASSETS / "composer"
SCRIPTS = ASSETS / "scripts"
OUT_DIR = HERE / "personas"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Make composer importable
sys.path.insert(0, str(COMPOSER))
sys.path.insert(0, str(SCRIPTS))

from flow_builder import build_flow, build_flow_from_docs, _spec_to_flow, build_citations  # noqa: E402
from docs_resolver import resolve_pipeline, detect_pipeline_type  # noqa: E402

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# (name, prompt, title, subtitle, [BLOCK_IDs])
PERSONAS = [
    {
        "name": "sarah",
        "prompt": "medallion lakehouse with POS data from S3, ERP via Kafka, CDC into Silver, Gold for analytics",
        "title": "Acme Retail — Multi-Source Medallion",
        "subtitle": "Standalone mode · S3 + Kafka → Bronze/Silver/Gold",
        "blocks": [
            "S3_BUCKET_BLOCK", "KAFKA_CONNECTOR_BLOCK",
            "SNOWPIPE_STREAMING_BLOCK", "STREAM_BLOCK",
            "SILVER_TABLE_BLOCK", "GOLD_TABLE_BLOCK",
        ],
    },
    {
        "name": "raj",
        "prompt": "50000 medical devices streaming through MQTT, real-time ingest, clinical analytics, Tableau dashboard",
        "title": "MedTech — Real-Time IoT Telemetry",
        "subtitle": "Standalone mode · MQTT → Snowpipe Streaming → Tableau",
        "blocks": [
            "IOT_GATEWAY_BLOCK", "SNOWPIPE_STREAMING_BLOCK", "BRONZE_TABLE_BLOCK", "STREAM_BLOCK",
            "TASK_BLOCK", "SILVER_TABLE_BLOCK", "DYNAMIC_TABLE_BLOCK",
            "TABLEAU_BLOCK",
        ],
    },
    {
        "name": "maya",
        "prompt": "real-time fraud detection card transactions via Kafka fraud-scoring model row-level security PII",
        "title": "Finovate — Real-Time Fraud Detection",
        "subtitle": "Standalone mode · Kafka → Fraud scoring → RLS analyst views",
        "blocks": [
            "KAFKA_CONNECTOR_BLOCK", "SNOWPIPE_STREAMING_BLOCK",
            "BRONZE_TABLE_BLOCK", "EXTERNAL_FUNCTION_BLOCK",
            "STREAM_BLOCK", "TASK_BLOCK", "SECURE_VIEW_BLOCK",
            "RLS_VIEW_BLOCK",
        ],
    },
    # ── EDGE CASE: Minimal pipeline (2 nodes, 1 edge) ──────────────────────
    # Tests: Does the layout degrade gracefully with very few components?
    # Does the platform boundary render sensibly with a single snow zone?
    {
        "name": "edge_minimal",
        "prompt": "simple S3 to Snowpipe ingest, nothing else",
        "title": "Edge Case — Minimal 2-Node Pipeline",
        "subtitle": "Stress test · S3 → Snowpipe only",
        "blocks": [
            "S3_BUCKET_BLOCK", "SNOWPIPE_BLOCK",
        ],
    },
    # ── EDGE CASE: Single zone (all nodes in one zone) ──────────────────────
    # Tests: What happens when ALL nodes land in the same zone?
    # Connector routing must use intra-zone vertical paths exclusively.
    # No cross-zone connectors at all — does SVG render empty gracefully?
    {
        "name": "edge_single_zone",
        "prompt": "stream to task to dynamic table, all transformation",
        "title": "Edge Case — Single Zone (Transformation Only)",
        "subtitle": "Stress test · All nodes in one zone",
        "blocks": [
            "STREAM_BLOCK", "TASK_BLOCK", "DYNAMIC_TABLE_BLOCK",
        ],
    },
    # ── EDGE CASE: Wide pipeline (8+ columns) ───────────────────────────────
    # Tests: Layout at maximum column count. Does the grid overflow?
    # Do connectors still route correctly across 7+ gaps?
    # Does the platform boundary span correctly?
    {
        "name": "edge_wide",
        "prompt": "full medallion with compute warehouse, security, and BI consumption",
        "title": "Edge Case — Maximum Width (8 Columns)",
        "subtitle": "Stress test · Every zone type present",
        "blocks": [
            "S3_BUCKET_BLOCK", "EXTERNAL_STAGE_BLOCK", "BRONZE_TABLE_BLOCK",
            "STREAM_BLOCK", "SILVER_TABLE_BLOCK", "WAREHOUSE_L_BLOCK",
            "GOLD_TABLE_BLOCK", "SECURE_VIEW_BLOCK", "TABLEAU_BLOCK",
        ],
    },
    # ── EDGE CASE: Only Gold (single medallion zone, tests naming) ──────────
    # Tests: "Gold Layer" alone should become "Serving Layer" (no 2+ medallion)
    # Also tests single-node snow zone + single-node outcome zone layout.
    {
        "name": "edge_gold_only",
        "prompt": "batch ETL from Azure into a gold analytics table for Power BI",
        "title": "Edge Case — Gold Only (No Bronze/Silver)",
        "subtitle": "Stress test · Should rename to Serving Layer",
        "blocks": [
            "AZURE_BLOB_BLOCK", "EXTERNAL_STAGE_BLOCK", "GOLD_TABLE_BLOCK",
            "POWERBI_BLOCK",
        ],
    },
    # ── EDGE CASE: Tall zone (5 nodes in one zone) ──────────────────────────
    # Tests: Very tall single zone with many nodes. Do intra-zone connectors
    # stay vertical and readable? Does the zone height not compress icons?
    {
        "name": "edge_tall_zone",
        "prompt": "multi-step transformation: stream, task, procedure, UDF, dynamic table",
        "title": "Edge Case — Tall Zone (5 Nodes in Transformation)",
        "subtitle": "Stress test · Vertical connector chain",
        "blocks": [
            "KAFKA_CONNECTOR_BLOCK", "SNOWPIPE_STREAMING_BLOCK",
            "BRONZE_TABLE_BLOCK",
            "STREAM_BLOCK", "TASK_BLOCK", "PROCEDURE_BLOCK", "UDF_BLOCK",
            "DYNAMIC_TABLE_BLOCK", "TABLEAU_BLOCK",
        ],
    },
    # ── EDGE CASE: Compute zone merge ───────────────────────────────────────
    # Tests: Single-node Compute zone should merge into Transformation.
    # Verifies the _MERGE_CANDIDATES logic actually fires.
    {
        "name": "edge_compute_merge",
        "prompt": "IoT ingest with dedicated warehouse then stream processing",
        "title": "Edge Case — Compute Merge into Transformation",
        "subtitle": "Stress test · Warehouse + Stream/Task should merge zones",
        "blocks": [
            "IOT_GATEWAY_BLOCK", "SNOWPIPE_STREAMING_BLOCK",
            "BRONZE_TABLE_BLOCK", "WAREHOUSE_L_BLOCK",
            "STREAM_BLOCK", "TASK_BLOCK", "SILVER_TABLE_BLOCK",
        ],
    },
    # ── EDGE CASE: No external sources (Snowflake-only) ─────────────────────
    # Tests: No onprem/bridge zones. Platform boundary should still render.
    # All nodes are category "snow" or "outcome".
    {
        "name": "edge_snow_only",
        "prompt": "internal Snowflake transformation pipeline, no external sources",
        "title": "Edge Case — Snowflake-Only (No External Sources)",
        "subtitle": "Stress test · No onprem/bridge zones",
        "blocks": [
            "BRONZE_TABLE_BLOCK", "BRONZE_STREAM_BLOCK",
            "TASK_BLOCK", "SILVER_TABLE_BLOCK",
            "GOLD_TABLE_BLOCK", "BUSINESS_VIEW_BLOCK",
        ],
    },
]

# --------------------------------------------------------------------------- #
# DOCS-DRIVEN PERSONAS — use SnowflakeProductDocs for component resolution
# --------------------------------------------------------------------------- #
DOCS_PERSONAS = [
    {
        "name": "docs_medallion",
        "prompt": "medallion lakehouse architecture with S3 ingestion",
        "title": "Docs-Driven — Modern Medallion",
        "subtitle": "Dynamic Tables for curated & serving layers",
    },
    {
        "name": "docs_streaming",
        "prompt": "real-time streaming pipeline from Kafka with sub-second latency",
        "title": "Docs-Driven — Streaming Pipeline",
        "subtitle": "Snowpipe Streaming + Dynamic Tables",
    },
    {
        "name": "docs_iot",
        "prompt": "IoT sensor pipeline with MQTT devices and anomaly detection",
        "title": "Docs-Driven — IoT Pipeline",
        "subtitle": "Device telemetry → Dynamic Tables → monitoring",
    },
]


def run_one(persona: dict, *, blocks_index: dict, take_screenshot: bool) -> None:
    name = persona["name"]
    print(f"=== {name} ===")

    # 1. Intent router decision (informational)
    router_out = subprocess.run(
        ["python3", str(COMPOSER / "intent_router.py"), persona["prompt"]],
        capture_output=True, text=True, check=True,
    )
    (OUT_DIR / f"{name}_decision.json").write_text(router_out.stdout)
    print(f"  ✓ {name}_decision.json")

    # 2. Build flow + state
    flow = build_flow(persona["blocks"], blocks_index)
    # Auto-generate citations from node doc_urls — every component gets a link
    citations = build_citations(flow["nodes"])
    state = {
        "title": persona["title"],
        "subtitle": persona["subtitle"],
        "source": "standalone:compose",
        "nodes": flow["nodes"],
        "edges": flow["edges"],
        "zones": flow["zones"],
        "citations": citations,
    }
    state_path = OUT_DIR / f"{name}_state.json"
    state_path.write_text(json.dumps(state, indent=2))
    print(f"  ✓ {name}_state.json ({len(flow['nodes'])} nodes)")

    # 3. Self-contained HTML
    html_path = OUT_DIR / f"{name}_v5.html"
    subprocess.run(
        ["python3", str(SCRIPTS / "render_static.py"),
         "--state", str(state_path), "--out", str(html_path)],
        check=True, capture_output=True,
    )
    print(f"  ✓ {name}_v5.html ({html_path.stat().st_size // 1024} KB)")

    # 4. Chrome screenshot
    if take_screenshot and Path(CHROME).exists():
        png_path = OUT_DIR / f"{name}_v5.png"
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--no-first-run", "--disable-extensions",
             "--window-size=2200,920", "--virtual-time-budget=4000",
             "--force-color-profile=srgb",
             f"--screenshot={png_path}", f"file://{html_path}"],
            check=False, capture_output=True, timeout=30,
        )
        if png_path.exists():
            print(f"  ✓ {name}_v5.png ({png_path.stat().st_size // 1024} KB)")


def run_docs_persona(persona: dict, *, take_screenshot: bool) -> None:
    """Run a docs-driven persona (no BLOCK_IDs — resolves via SnowflakeProductDocs)."""
    name = persona["name"]
    print(f"=== {name} (docs-driven) ===")

    # 1. Resolve pipeline from docs
    spec = resolve_pipeline(persona["prompt"], use_docs=True)
    flow = _spec_to_flow(spec)
    citations = build_citations(flow["nodes"])

    # Save decision (for transparency)
    decision = {
        "type": "docs_driven",
        "pipeline_type": detect_pipeline_type(persona["prompt"]),
        "spec": spec,
    }
    (OUT_DIR / f"{name}_decision.json").write_text(json.dumps(decision, indent=2))
    print(f"  ✓ {name}_decision.json (docs-driven)")

    # 2. Write state
    state = {
        "title": persona["title"],
        "subtitle": persona["subtitle"],
        "source": "standalone:docs_driven",
        "nodes": flow["nodes"],
        "edges": flow["edges"],
        "zones": flow["zones"],
        "citations": citations,
    }
    state_path = OUT_DIR / f"{name}_state.json"
    state_path.write_text(json.dumps(state, indent=2))
    print(f"  ✓ {name}_state.json ({len(flow['nodes'])} nodes)")

    # 3. Self-contained HTML
    html_path = OUT_DIR / f"{name}_v5.html"
    subprocess.run(
        ["python3", str(SCRIPTS / "render_static.py"),
         "--state", str(state_path), "--out", str(html_path)],
        check=True, capture_output=True,
    )
    print(f"  ✓ {name}_v5.html ({html_path.stat().st_size // 1024} KB)")

    # 4. Chrome screenshot
    if take_screenshot and Path(CHROME).exists():
        png_path = OUT_DIR / f"{name}_v5.png"
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--no-first-run", "--disable-extensions",
             "--window-size=2200,920", "--virtual-time-budget=4000",
             "--force-color-profile=srgb",
             f"--screenshot={png_path}", f"file://{html_path}"],
            check=False, capture_output=True, timeout=30,
        )
        if png_path.exists():
            print(f"  ✓ {name}_v5.png ({png_path.stat().st_size // 1024} KB)")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-screenshot", action="store_true")
    ap.add_argument("--personas", nargs="+", help="Subset of persona names to run")
    ap.add_argument("--docs-only", action="store_true", help="Run only docs-driven personas")
    ap.add_argument("--legacy-only", action="store_true", help="Run only legacy personas")
    args = ap.parse_args(argv)

    blocks = json.loads((ASSETS / "component_blocks.json").read_text())
    blocks_index = {b["BLOCK_ID"]: b for b in blocks}

    # Legacy personas
    if not args.docs_only:
        targets = PERSONAS
        if args.personas:
            wanted = set(args.personas)
            targets = [p for p in PERSONAS if p["name"] in wanted]
        for persona in targets:
            run_one(persona, blocks_index=blocks_index,
                    take_screenshot=not args.no_screenshot)

    # Docs-driven personas
    if not args.legacy_only:
        docs_targets = DOCS_PERSONAS
        if args.personas:
            wanted = set(args.personas)
            docs_targets = [p for p in DOCS_PERSONAS if p["name"] in wanted]
        for persona in docs_targets:
            run_docs_persona(persona, take_screenshot=not args.no_screenshot)

    print()
    print(f"Outputs in: {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
