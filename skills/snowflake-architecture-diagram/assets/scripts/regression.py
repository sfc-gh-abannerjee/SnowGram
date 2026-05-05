"""
Regression harness for snowflake-architecture-diagram skill.

Runs the four canonical test prompts from AGENTS.md (T1–T4) through the
template router and asserts each produces non-empty Mermaid containing
the expected component substrings. This is a structural smoke test, not
a visual diff.

Run:
  python3 regression.py

Exit 0 = all pass.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent
TEMPLATES = ASSETS / "templates"

# Each case: (prompt, expected_template_id, expected_substrings_in_mermaid)
CASES = [
    (
        "T1: Create a medallion lakehouse",
        "MEDALLION_LAKEHOUSE",
        ["Bronze", "Silver", "Gold"],
    ),
    (
        "T2: Build a streaming data pipeline",
        "STREAMING_DATA_STACK",
        ["Snowpipe", "Dynamic Table"],
    ),
    (
        "T3: Design BI analytics architecture",
        "EMBEDDED_ANALYTICS",
        ["Hybrid Tables", "Embedded BI"],
    ),
    (
        "T4: Create IoT data pipeline",
        "REALTIME_IOT_PIPELINE",
        ["IoT", "Snowpipe"],
    ),
]


def main() -> int:
    failed = 0
    for label, tid, expected in CASES:
        tpath = TEMPLATES / f"{tid}.json"
        if not tpath.exists():
            print(f"FAIL  {label}: template {tid}.json not found")
            failed += 1
            continue
        row = json.loads(tpath.read_text(encoding="utf-8"))
        mermaid = row.get("FULL_MERMAID_CODE") or row.get("full_mermaid_code") or ""
        if not mermaid:
            print(f"FAIL  {label}: empty Mermaid in {tid}.json")
            failed += 1
            continue
        # Case-insensitive substring search
        m = mermaid.lower()
        missing = [s for s in expected if s.lower() not in m]
        if missing:
            print(f"FAIL  {label}: missing substrings {missing} in {tid}")
            failed += 1
            continue
        print(f"PASS  {label}  -> {tid} ({len(mermaid)} chars)")

    print()
    print(f"{len(CASES) - failed}/{len(CASES)} passed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
