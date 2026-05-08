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

from flow_builder import build_flow, build_citations  # noqa: E402

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
            "SNOWPIPE_STREAMING_BLOCK", "BRONZE_TABLE_BLOCK", "STREAM_BLOCK",
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-screenshot", action="store_true")
    ap.add_argument("--personas", nargs="+", help="Subset of persona names to run")
    args = ap.parse_args(argv)

    blocks = json.loads((ASSETS / "component_blocks.json").read_text())
    blocks_index = {b["BLOCK_ID"]: b for b in blocks}

    targets = PERSONAS
    if args.personas:
        wanted = set(args.personas)
        targets = [p for p in PERSONAS if p["name"] in wanted]

    for persona in targets:
        run_one(persona, blocks_index=blocks_index,
                take_screenshot=not args.no_screenshot)

    print()
    print(f"Outputs in: {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
