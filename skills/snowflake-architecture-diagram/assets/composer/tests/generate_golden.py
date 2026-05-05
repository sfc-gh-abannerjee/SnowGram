"""
Generate golden test fixtures for composer.py.

Calls the LIVE deployed GENERATE_MERMAID_FROM_COMPONENTS UDF for a set of
representative BLOCK_ID arrays and saves each (input, expected_output) pair
to assets/composer/tests/golden/<case>.json. The test runner then compares
the local Python composer output against these captured outputs to ensure
byte-for-byte parity.

Run once per snapshot refresh:
  python3 generate_golden.py --connection se_demo --warehouse SNOWGRAM_WH
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
GOLDEN_DIR = SCRIPT_DIR / "golden"

# Representative cases covering all categories + ordering edge cases.
# Each tuple: (case_name, block_ids).
CASES: list[tuple[str, list[str]]] = [
    # External -> ingestion -> raw landing
    ("simple_pipeline", ["S3_BUCKET_BLOCK", "EXTERNAL_STAGE_BLOCK", "SNOWPIPE_BLOCK"]),
    # Streaming with Kafka
    ("kafka_streaming", ["KAFKA_CONNECTOR_BLOCK", "SNOWPIPE_STREAMING_BLOCK"]),
    # Single-block (edge case: no edges)
    ("single_block", ["S3_BUCKET_BLOCK"]),
    # Empty input (edge case)
    ("empty", []),
    # Unknown block id (skipped silently)
    ("with_unknown", ["S3_BUCKET_BLOCK", "DOES_NOT_EXIST", "SNOWPIPE_BLOCK"]),
]


def run_live_udf(block_ids: list[str], connection: str, warehouse: str) -> str:
    """Invoke the deployed GENERATE_MERMAID_FROM_COMPONENTS via snow sql."""
    if not block_ids:
        # The UDF on empty array would error or return null; we capture
        # behaviour explicitly by passing an empty array via SELECT.
        sql = (
            "SELECT SNOWGRAM_DB.CORE.GENERATE_MERMAID_FROM_COMPONENTS("
            "ARRAY_CONSTRUCT(), TO_VARIANT(NULL))"
        )
    else:
        items = ", ".join(f"'{b}'" for b in block_ids)
        sql = (
            "SELECT SNOWGRAM_DB.CORE.GENERATE_MERMAID_FROM_COMPONENTS("
            f"ARRAY_CONSTRUCT({items}), TO_VARIANT(NULL))"
        )
    cmd = [
        "snow", "sql", "-c", connection, "--warehouse", warehouse,
        "--format", "json", "-q", sql,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    rows = json.loads(result.stdout) if result.stdout.strip() else []
    if not rows:
        return ""
    first = rows[0]
    if isinstance(first, dict) and first:
        val = next(iter(first.values()))
        return val if val is not None else ""
    return str(first) if first is not None else ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--connection", "-c", required=True)
    ap.add_argument("--warehouse", "-w", default="SNOWGRAM_WH")
    args = ap.parse_args()

    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)

    for case_name, block_ids in CASES:
        try:
            expected = run_live_udf(block_ids, args.connection, args.warehouse)
        except subprocess.CalledProcessError as e:
            print(f"  ⚠ {case_name}: UDF error\n{e.stderr}", file=sys.stderr)
            expected = None

        fixture: dict[str, Any] = {
            "case": case_name,
            "input": {"block_ids": block_ids, "connections": None},
            "expected_output": expected,
        }
        out = GOLDEN_DIR / f"{case_name}.json"
        out.write_text(json.dumps(fixture, indent=2), encoding="utf-8")
        print(f"  ✓ {case_name}: {len(expected) if expected else 0} chars")

    print(f"\n{len(CASES)} fixtures written to {GOLDEN_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
