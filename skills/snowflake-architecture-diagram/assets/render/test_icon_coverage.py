#!/usr/bin/env python3
"""Curation-coverage safeguard for icons.

Root-cause guard (added 2026-09-11): components missing from the curated icon map
(`COMPONENT_ICON_MAP` online, exported to `icons_generated/catalog_map.json` offline)
silently fall through to semantic ICON_SEARCH/fuzzy, which returns a plausible-but-
WRONG icon. That is exactly how Azure SQL, Azure Private Link, and the data-share
provider got wrong icons. This test fails loudly if any component_type that appears
in a reference fixture -- or in the CORE set of common component types below -- is not
covered by the curated map (and, for offline, does not have a vendored blob).

Run: python3 test_icon_coverage.py   (exit 0 = all covered, 1 = gaps)
It is offline/deterministic: it reads the vendored catalog only, no Snowflake needed.
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ICONS = HERE / "icons_generated"
FIXTURES = HERE.parent / "layout-engine" / "tests" / "fixtures"


def _norm(s: str) -> str:
    # Same separator-insensitive canonical key as icon_resolver._norm and
    # MAP_ICON_PATH: underscores/hyphens/spaces collapse to one space.
    return re.sub(r"[\s_-]+", " ", (s or "").strip().lower()).strip()

# Common component types that MUST always resolve via the curated map, independent
# of whether a fixture currently exercises them -- the everyday vocabulary of a
# Snowflake-on-a-cloud diagram. Keep lowercase (MAP_ICON_PATH lowercases the key).
CORE_TYPES = [
    # Snowflake-native
    "dynamic table", "stream", "task", "snowpipe", "cortex", "streamlit",
    "governance", "warehouse", "iceberg table", "hybrid table", "materialized view",
    "secure view", "snowpark", "native app", "data share", "secure data sharing",
    # external / cloud sources + connectivity that were the reported failures
    "snowflake account", "azure sql", "azure private link", "private link",
    "azure synapse", "azure data factory", "azure blob storage",
    "power bi", "dbt", "kafka", "aws s3",
]


def _load(name: str) -> dict:
    return json.loads((ICONS / name).read_text(encoding="utf-8"))


def _fixture_component_types() -> set[str]:
    types: set[str] = set()
    for fp in sorted(FIXTURES.glob("*.json")):
        model = json.loads(fp.read_text(encoding="utf-8"))
        for n in model.get("nodes", []):
            ct = _norm(n.get("componentType") or n.get("component_type") or "")
            if ct:
                types.add(ct)
    return types


def main() -> int:
    catalog_map = {_norm(k): v for k, v in _load("catalog_map.json").items()}
    path_index = _load("path_index.json")
    blobs = _load("blobs.json")

    required = _fixture_component_types() | {_norm(t) for t in CORE_TYPES}

    uncurated = sorted(t for t in required if t not in catalog_map)
    # For curated entries, the vendored blob must actually be resolvable offline.
    no_blob = sorted(
        t for t in required
        if t in catalog_map and (
            catalog_map[t] not in path_index or path_index[catalog_map[t]] not in blobs
        )
    )

    ok = not uncurated and not no_blob
    print(f"icon coverage: {len(required)} required types | "
          f"{len(uncurated)} uncurated | {len(no_blob)} curated-but-missing-blob")
    if uncurated:
        print("  UNCURATED (fall through to semantic search -> wrong icon risk):")
        for t in uncurated:
            print(f"    - {t}")
    if no_blob:
        print("  CURATED BUT NO VENDORED BLOB (offline resolve fails):")
        for t in no_blob:
            print(f"    - {t} -> {catalog_map[t]}")
    print("ICON COVERAGE OK" if ok else "ICON COVERAGE FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
