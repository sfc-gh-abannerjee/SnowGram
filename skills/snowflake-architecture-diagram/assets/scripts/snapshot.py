#!/usr/bin/env python3
"""
Snapshot extractor for snowflake-architecture-diagram skill.

Captures the LIVE deployed state of SnowGram from a target Snowflake
account into JSON files bundled with this skill. The snapshot is the
canonical source for standalone-mode rendering — bundled SQL files
in the SnowGram repo are hints only.

What gets captured:
  - assets/templates/<id>.json       (ARCHITECTURE_TEMPLATES rows)
  - assets/component_blocks.json     (COMPONENT_BLOCKS rows)
  - assets/component_synonyms.json   (COMPONENT_SYNONYMS rows)
  - assets/agent_spec.json           (cortex agents describe SNOWGRAM_AGENT)
  - assets/semantic_view.yaml        (cortex semantic-views get COMPONENT_MAP_SV)
  - assets/functions/<NAME>.sql      (GET_DDL for each composer/router function)
  - assets/_snapshot_meta.json       (timestamp, source account, sha256s)

Auth:
  Uses an active Cortex Code connection (via `cortex` CLI). NEVER reads
  .env files — keeps secrets out of skill assets.

Usage:
  python3 snapshot.py --connection se_demo
  python3 snapshot.py --connection se_demo --skip-functions   # faster re-run
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent.parent
ASSETS_DIR = SKILL_DIR / "assets"
TEMPLATES_DIR = ASSETS_DIR / "templates"
FUNCTIONS_DIR = ASSETS_DIR / "functions"
META_PATH = ASSETS_DIR / "_snapshot_meta.json"

# --------------------------------------------------------------------------- #
# Config — these match the deployed SnowGram canonical names
# --------------------------------------------------------------------------- #
DB = "SNOWGRAM_DB"
CORE_SCHEMA = f"{DB}.CORE"
AGENT_FQN = f"{DB}.AGENTS.SNOWGRAM_AGENT"
SEMANTIC_VIEW_FQN = f"{CORE_SCHEMA}.COMPONENT_MAP_SV"

CAPTURED_FUNCTIONS = [
    # (function_name, signature) — signature required for GET_DDL on overloaded UDFs
    ("GENERATE_MERMAID_FROM_COMPONENTS", "ARRAY, VARIANT"),
    ("SUGGEST_COMPONENTS_FOR_USE_CASE", "VARCHAR"),
    ("MAP_COMPONENT", "VARCHAR"),
    ("CLASSIFY_COMPONENT", "VARCHAR"),
    ("VALIDATE_MERMAID_SYNTAX", "VARCHAR"),
    ("COMPOSE_DIAGRAM_FROM_TEMPLATE", "VARCHAR"),
    ("GET_ARCHITECTURE_BEST_PRACTICE", "VARCHAR"),
]

# Tables to snapshot in full
TABLES = [
    ("ARCHITECTURE_TEMPLATES", "templates"),       # fanned out to per-id files
    ("COMPONENT_BLOCKS", "component_blocks"),
    ("COMPONENT_SYNONYMS", "component_synonyms"),
]


# --------------------------------------------------------------------------- #
# Shell helpers
# --------------------------------------------------------------------------- #
def _run(cmd: list[str], *, check: bool = True, env_extra: Optional[dict] = None) -> subprocess.CompletedProcess:
    """Run a subprocess with sane defaults; capture stdout/stderr."""
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        cmd,
        check=check,
        text=True,
        capture_output=True,
        env=env,
    )


def _snow_sql_json(query: str, connection: str, warehouse: Optional[str] = None) -> list[dict[str, Any]]:
    """
    Run a SELECT and return rows as list[dict] using `snow sql --format json`.
    Snowflake CLI must be installed and configured with the target connection.
    """
    cmd = ["snow", "sql", "-c", connection, "--format", "json"]
    if warehouse:
        cmd += ["--warehouse", warehouse]
    cmd += ["-q", query]
    result = _run(cmd)
    out = result.stdout.strip()
    if not out:
        return []
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"Failed to parse JSON from `snow sql` output:\n{out[:500]}\n... ({e})"
        ) from e


def _snow_sql_scalar(query: str, connection: str, warehouse: Optional[str] = None) -> str:
    """Run a query that returns one VARCHAR scalar; return the value."""
    rows = _snow_sql_json(query, connection, warehouse=warehouse)
    if not rows:
        return ""
    first = rows[0]
    if isinstance(first, dict) and first:
        return str(next(iter(first.values())))
    return str(first)


def _cortex(args: list[str]) -> str:
    """Run `cortex <args>` and return stdout."""
    result = _run(["cortex"] + args)
    return result.stdout


# --------------------------------------------------------------------------- #
# Capture routines
# --------------------------------------------------------------------------- #
def capture_tables(connection: str, warehouse: Optional[str] = None) -> dict[str, Any]:
    """Snapshot the three core tables."""
    captured: dict[str, Any] = {}

    for table_name, _label in TABLES:
        rows = _snow_sql_json(
            f"SELECT * FROM {CORE_SCHEMA}.{table_name}", connection, warehouse=warehouse
        )
        captured[table_name] = rows
        print(f"  ✓ {table_name}: {len(rows)} rows", file=sys.stderr)

    return captured


def fan_out_templates(rows: list[dict[str, Any]]) -> int:
    """Write one JSON per template_id."""
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    index: list[dict[str, str]] = []

    for row in rows:
        # Snowflake JSON output normalises column names to UPPER
        tid = row.get("TEMPLATE_ID") or row.get("template_id")
        if not tid:
            continue
        path = TEMPLATES_DIR / f"{tid}.json"
        path.write_text(json.dumps(row, indent=2, default=str), encoding="utf-8")
        index.append(
            {
                "template_id": tid,
                "name": row.get("TEMPLATE_NAME") or row.get("template_name") or "",
                "category": row.get("USE_CASE_CATEGORY") or row.get("use_case_category") or "",
            }
        )
        written += 1

    (TEMPLATES_DIR / "_index.json").write_text(
        json.dumps(index, indent=2), encoding="utf-8"
    )
    return written


def capture_function_ddls(connection: str, warehouse: Optional[str] = None) -> dict[str, str]:
    """GET_DDL for each composer/router function. Critical for portable composer."""
    FUNCTIONS_DIR.mkdir(parents=True, exist_ok=True)
    ddls: dict[str, str] = {}

    for name, sig in CAPTURED_FUNCTIONS:
        fqn = f"{CORE_SCHEMA}.{name}({sig})"
        # Use parameterless arg form for GET_DDL — pass FQN via single quotes
        query = f"SELECT GET_DDL('FUNCTION', '{fqn}', TRUE)"
        try:
            ddl = _snow_sql_scalar(query, connection, warehouse=warehouse)
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠ {name}: {e}", file=sys.stderr)
            continue
        if not ddl:
            print(f"  ⚠ {name}: empty DDL", file=sys.stderr)
            continue
        out_path = FUNCTIONS_DIR / f"{name}.sql"
        out_path.write_text(ddl, encoding="utf-8")
        ddls[name] = ddl
        print(f"  ✓ {name}: {len(ddl)} chars", file=sys.stderr)

    return ddls


def capture_semantic_view(connection: str) -> Optional[str]:
    """
    Capture COMPONENT_MAP_SV via `cortex semantic-views get`. Falls back to
    `cortex semantic-views ddl` if YAML get is unavailable.
    """
    out_yaml = ASSETS_DIR / "semantic_view.yaml"
    try:
        # `cortex semantic-views get` writes a YAML file to disk by default
        _cortex(
            [
                "semantic-views",
                "get",
                SEMANTIC_VIEW_FQN,
                "-c",
                connection,
                "-o",
                str(out_yaml),
            ]
        )
        if out_yaml.exists() and out_yaml.stat().st_size > 0:
            print(f"  ✓ semantic view: {out_yaml.name}", file=sys.stderr)
            return out_yaml.read_text(encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ cortex semantic-views get failed: {e}", file=sys.stderr)

    # Fallback to DDL
    try:
        ddl = _cortex(["semantic-views", "ddl", SEMANTIC_VIEW_FQN, "-c", connection])
        if ddl.strip():
            (ASSETS_DIR / "semantic_view.sql").write_text(ddl, encoding="utf-8")
            print("  ✓ semantic view: fallback to DDL", file=sys.stderr)
            return ddl
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ cortex semantic-views ddl failed: {e}", file=sys.stderr)

    return None


def capture_agent_spec(connection: str) -> Optional[dict[str, Any]]:
    """Capture deployed agent definition via `cortex agents describe`."""
    try:
        out = _cortex(["agents", "describe", AGENT_FQN, "-c", connection])
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ cortex agents describe failed: {e}", file=sys.stderr)
        return None

    spec_path = ASSETS_DIR / "agent_spec.json"
    # Try JSON; fall back to raw text dump
    try:
        parsed = json.loads(out)
        spec_path.write_text(json.dumps(parsed, indent=2), encoding="utf-8")
        print("  ✓ agent spec (json)", file=sys.stderr)
        return parsed
    except json.JSONDecodeError:
        spec_path.with_suffix(".txt").write_text(out, encoding="utf-8")
        print("  ✓ agent spec (text fallback)", file=sys.stderr)
        return None


# --------------------------------------------------------------------------- #
# Meta + integrity
# --------------------------------------------------------------------------- #
def _sha256_of_payload(payload: Any) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


def _sha256_of_repo_sql() -> Optional[str]:
    """
    Hash the SQL files in the SnowGram repo whose content the snapshot is
    expected to mirror. Used by CI to detect drift.
    """
    # SKILL_DIR = <repo>/skills/<name>; repo root is two levels up.
    repo_root = SKILL_DIR.parent.parent
    candidates = [
        repo_root / "backend" / "modular" / "full_templates.sql",
        repo_root / "backend" / "modular" / "composed_patterns.sql",
        repo_root / "backend" / "modular" / "component_blocks.sql",
        repo_root / "backend" / "sql" / "component_synonyms.sql",
        repo_root / "backend" / "agent" / "custom_tools.sql",
        repo_root / "backend" / "agent" / "agent_fixes_jan2026.sql",
    ]
    h = hashlib.sha256()
    seen_any = False
    for p in candidates:
        if p.exists():
            h.update(p.read_bytes())
            seen_any = True
    return h.hexdigest() if seen_any else None


def write_meta(
    connection: str,
    table_payloads: dict[str, Any],
    function_ddls: dict[str, str],
    semantic_view: Optional[str],
) -> None:
    meta = {
        "snapshot_version": 1,
        "snapshot_at": _dt.datetime.now(tz=_dt.timezone.utc).isoformat(),
        "source_connection": connection,
        "source_db": DB,
        "tables": {
            name: {
                "row_count": len(table_payloads.get(name, [])),
                "sha256": _sha256_of_payload(table_payloads.get(name, [])),
            }
            for name, _ in TABLES
        },
        "functions": {
            name: hashlib.sha256(ddl.encode("utf-8")).hexdigest()
            for name, ddl in function_ddls.items()
        },
        "semantic_view_sha256": (
            hashlib.sha256(semantic_view.encode("utf-8")).hexdigest()
            if semantic_view
            else None
        ),
        "source_sql_sha256": _sha256_of_repo_sql(),
        "captured_by": "snapshot.py",
    }
    META_PATH.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"  ✓ meta: {META_PATH.name}", file=sys.stderr)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Snapshot deployed SnowGram into skill assets.")
    ap.add_argument("--connection", "-c", required=True, help="cortex/snow connection name")
    ap.add_argument("--warehouse", "-w", default="SNOWGRAM_WH", help="Warehouse to use (default: SNOWGRAM_WH)")
    ap.add_argument("--skip-functions", action="store_true", help="Skip GET_DDL function capture")
    ap.add_argument("--skip-semantic-view", action="store_true")
    ap.add_argument("--skip-agent", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="Probe access only; write nothing")
    args = ap.parse_args(argv)

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Snapshotting from connection: {args.connection} (warehouse: {args.warehouse})", file=sys.stderr)
    print("[tables]", file=sys.stderr)
    table_payloads = capture_tables(args.connection, warehouse=args.warehouse)

    if not args.dry_run:
        # Save raw payloads
        (ASSETS_DIR / "component_blocks.json").write_text(
            json.dumps(table_payloads.get("COMPONENT_BLOCKS", []), indent=2, default=str),
            encoding="utf-8",
        )
        (ASSETS_DIR / "component_synonyms.json").write_text(
            json.dumps(table_payloads.get("COMPONENT_SYNONYMS", []), indent=2, default=str),
            encoding="utf-8",
        )
        n_tpl = fan_out_templates(table_payloads.get("ARCHITECTURE_TEMPLATES", []))
        print(f"  ✓ templates fanned out: {n_tpl}", file=sys.stderr)

    function_ddls: dict[str, str] = {}
    if not args.skip_functions:
        print("[functions]", file=sys.stderr)
        function_ddls = capture_function_ddls(args.connection, warehouse=args.warehouse)

    semantic_view: Optional[str] = None
    if not args.skip_semantic_view:
        print("[semantic view]", file=sys.stderr)
        semantic_view = capture_semantic_view(args.connection)

    if not args.skip_agent:
        print("[agent spec]", file=sys.stderr)
        capture_agent_spec(args.connection)

    print("[meta]", file=sys.stderr)
    if not args.dry_run:
        write_meta(args.connection, table_payloads, function_ddls, semantic_view)

    print("\nSnapshot complete.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
