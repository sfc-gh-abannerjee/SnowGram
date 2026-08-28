#!/usr/bin/env python3
"""
build_icons_vocab.py - build-time semantic pre-resolution of the skill's known
component-type vocabulary.

For types NOT covered by COMPONENT_ICON_MAP, the agent falls back to the
ICON_SEARCH Cortex service. To give the local resolver an OFFLINE semantic
baseline, this runs ICON_SEARCH once over the skill's known vocabulary and bakes
the winners into vocab_resolved.json. Hand-curated OVERRIDES fix the spots where
ICON_SEARCH is weak (e.g. it returns zendesk for "salesforce", a generic "log"
for feature store) - we prefer the obvious Snowflake-native icon instead.

Winners whose icon isn't already in the vendored store are fetched and appended
to blobs.json / path_index.json, so vocab_resolved is fully usable offline.

Invoked by build_icons.py --with-vocab, or standalone:
  python3 build_icons_vocab.py -c snowhouse
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
OUT_DIR = SCRIPT_DIR / "icons_generated"
SEARCH_SERVICE = "TEMP.ABANNERJEE.ICON_SEARCH"
CATALOG_TABLE = "TEMP.ABANNERJEE.ICON_CATALOG"

# Known component-type vocabulary (manifest keys + alias keys + common extras).
# Tokens already in COMPONENT_ICON_MAP are skipped (map wins first at resolve time).
VOCAB = [
    # tables / objects
    "dynamic_table", "table", "external_table", "iceberg_table", "hybrid_table",
    "external_volume", "catalog_integration", "view", "secure_view",
    "materialized_view", "stream", "task", "pipe", "stage", "warehouse",
    "database", "function", "stored_procedure", "udf", "external_function",
    "role", "masking_policy", "row_access_policy", "tag",
    # ingestion / streaming
    "snowpipe_streaming", "snowpipe", "openflow", "kafka", "kinesis", "iot",
    "fivetran", "airbyte", "connector",
    # external systems
    "s3", "azure_blob", "gcs", "postgres", "mysql", "oracle", "mongodb",
    "data_share", "marketplace", "native_app",
    # ai / ml
    "snowflake_ml", "ml_model", "feature_store", "model_registry", "cortex",
    "snowpark", "spcs",
    # consumption
    "bi_tool", "tableau", "powerbi", "looker", "streamlit", "web_app",
    "saas", "salesforce", "reverse_etl", "cdp", "activation",
    # serverless / compute
    "lambda", "azure_function", "api_gateway",
    # governance
    "governance",
]

# Hand-curated overrides where ICON_SEARCH is weak. Prefer obvious Snowflake-native
# (sno-icon-*) icons. All of these live in the curated 'sno-icon' provider subset.
OVERRIDES = {
    "snowflake_ml": "sno-icon-snowflake-ml-blue.svg",
    "ml_model": "sno-icon-models-blue.svg",
    "feature_store": "sno-icon-models-blue.svg",
    "model_registry": "sno-icon-snowpark-modeling-registry-blue.svg",
    "snowpipe_streaming": "sno-icon-snowpipe-streaming-blue.svg",
    "snowpark": "sno-icon-snowpark-blue.svg",
    "spcs": "sno-icon-snowpark-containers-blue.svg",
    # data-integration connectors: ICON_SEARCH picks unrelated icons; use the
    # connector glyph (keeps everything inside the curated providers too).
    "airbyte": "sno-icon-kafka-connectors-blue.svg",
    "fivetran": "sno-icon-kafka-connectors-blue.svg",
    # generic SaaS (no real Salesforce icon exists in the catalog).
    "saas": "saas/saas.svg",
    "salesforce": "saas/saas.svg",
}

# Optional query hints for ambiguous tokens (improves ICON_SEARCH relevance).
QUERY_HINTS = {
    "saas": "saas cloud application",
    "reverse_etl": "data activation outbound sync",
    "cdp": "customer data platform",
    "activation": "marketing activation audience",
    "web_app": "web application",
    "iot": "internet of things device",
}


def _snow_json(query: str, connection: str, warehouse: str | None) -> list[dict]:
    cmd = ["snow", "sql", "-c", connection, "--format", "json"]
    if warehouse:
        cmd += ["--warehouse", warehouse]
    cmd += ["-q", query]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"snow sql failed: {res.stderr or res.stdout}")
    out = res.stdout.strip()
    return json.loads(out) if out else []


def _search_top_path(token: str, connection: str, warehouse: str | None) -> str | None:
    q = QUERY_HINTS.get(token, token.replace("_", " "))
    payload = json.dumps({"query": q, "columns": ["RELATIVE_PATH"], "limit": 1})
    sql = (
        f"SELECT PARSE_JSON(SNOWFLAKE.CORTEX.SEARCH_PREVIEW('{SEARCH_SERVICE}', "
        f"'{payload}')):results[0]:RELATIVE_PATH::string AS P"
    )
    rows = _snow_json(sql, connection, warehouse)
    return rows[0].get("P") if rows and rows[0].get("P") else None


def _fetch_data_uri(path: str, connection: str, warehouse: str | None) -> str | None:
    safe = path.replace("'", "''")
    rows = _snow_json(
        f"SELECT SVG_BASE64_DATA_URI AS U FROM {CATALOG_TABLE} WHERE RELATIVE_PATH='{safe}' LIMIT 1",
        connection, warehouse,
    )
    return rows[0].get("U") if rows else None


def _sha_of_data_uri(uri: str) -> str | None:
    if not uri or "," not in uri:
        return None
    try:
        return hashlib.sha256(base64.b64decode(uri.split(",", 1)[1])).hexdigest()
    except Exception:
        return None


def build_vocab(connection: str, warehouse: str | None, out_dir: Path, path_index: dict) -> dict:
    catalog_map = json.loads((out_dir / "catalog_map.json").read_text()) if (out_dir / "catalog_map.json").exists() else {}
    blobs = json.loads((out_dir / "blobs.json").read_text()) if (out_dir / "blobs.json").exists() else {}

    vocab_resolved: dict[str, str] = {}
    appended = 0
    for token in VOCAB:
        if token in catalog_map:
            continue  # curated map already wins for this token
        path = OVERRIDES.get(token) or _search_top_path(token, connection, warehouse)
        if not path:
            continue
        # Ensure the winner is vendored (fetch + append if missing).
        if path not in path_index:
            uri = _fetch_data_uri(path, connection, warehouse)
            sha = _sha_of_data_uri(uri) if uri else None
            if not sha:
                continue
            path_index[path] = sha
            blobs.setdefault(sha, uri)
            appended += 1
        vocab_resolved[token] = path

    (out_dir / "vocab_resolved.json").write_text(json.dumps(vocab_resolved, indent=0, sort_keys=True), encoding="utf-8")
    (out_dir / "path_index.json").write_text(json.dumps(path_index, indent=0, sort_keys=True), encoding="utf-8")
    (out_dir / "blobs.json").write_text(json.dumps(blobs, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    print(f"vocab_resolved: {len(vocab_resolved)} tokens ({appended} new icons appended)", file=sys.stderr)
    return vocab_resolved


def main() -> int:
    ap = argparse.ArgumentParser(description="Pre-resolve known vocabulary via ICON_SEARCH (+ overrides).")
    ap.add_argument("-c", "--connection", default="snowhouse")
    ap.add_argument("--warehouse")
    args = ap.parse_args()
    pi_path = OUT_DIR / "path_index.json"
    if not pi_path.exists():
        print("ERROR: run build_icons.py first (path_index.json missing)", file=sys.stderr)
        return 2
    path_index = json.loads(pi_path.read_text())
    build_vocab(args.connection, args.warehouse, OUT_DIR, path_index)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
