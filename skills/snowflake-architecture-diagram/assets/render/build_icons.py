#!/usr/bin/env python3
"""
build_icons.py - vendor the SnowGram agent's icon system into the local skill.

The agent resolves node icons via TEMP.ABANNERJEE.COMPONENT_ICON_MAP (curated
type->path) -> ICON_CATALOG (path->svg data URI) -> ICON_SEARCH (semantic). The
local skill historically shipped a small, DIFFERENT icon set (Snowflake_ICON_RA_*)
+ a 46-entry manifest with lossy aliases, so it picked generic/wrong icons.

This build step exports the agent's curated map + a curated-subset catalog from
Snowflake into a CONTENT-ADDRESSED store so the local resolver can produce
agent-identical icons offline:

  icons_generated/
    catalog_map.json   { component_key: relative_path }      (COMPONENT_ICON_MAP, verbatim)
    path_index.json    { relative_path: sha256 }             (curated subset)
    blobs.json         { sha256: data_uri }                  (each unique SVG stored ONCE)
    meta.json          provenance + dedup stats

Content addressing means a single icon that appears under multiple agent paths
(old Snowflake_ICON_* vs new sno-icon-*-blue naming, or aws/analytics vs aws/media
duplicates) is stored only once - no duplicates sneak in. vocab_resolved.json
(build-time ICON_SEARCH winners) is produced by --with-vocab (see build_icons_vocab).

Usage:
  python3 build_icons.py -c snowhouse
  python3 build_icons.py -c snowhouse --providers sno-icon,aws,azure,gcp,onprem,saas,generic
  python3 build_icons.py -c snowhouse --with-vocab
"""
from __future__ import annotations

import argparse
import base64
import datetime as _dt
import hashlib
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent           # assets/render
SKILL_DIR = SCRIPT_DIR.parent.parent
OUT_DIR = SCRIPT_DIR / "icons_generated"
SKILL_ICONS_DIR = SKILL_DIR / "assets" / "viewer" / "icons"
BRAND_SOURCES = SCRIPT_DIR / "brand_sources.json"   # git-tracked provenance ledger

MAP_TABLE = "TEMP.ABANNERJEE.COMPONENT_ICON_MAP"
CATALOG_TABLE = "TEMP.ABANNERJEE.ICON_CATALOG"
SEARCH_SERVICE = "TEMP.ABANNERJEE.ICON_SEARCH"

# Curated providers (first path segment). "sno-icon" matches the top-level
# Snowflake product icons (sno-icon-*.svg, no slash). The rest are provider/dirs.
DEFAULT_PROVIDERS = ["sno-icon", "aws", "azure", "gcp", "onprem", "saas", "generic"]


def snow_json(query: str, connection: str, warehouse: str | None = None) -> list[dict]:
    cmd = ["snow", "sql", "-c", connection, "--format", "json"]
    if warehouse:
        cmd += ["--warehouse", warehouse]
    cmd += ["-q", query]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"snow sql failed: {res.stderr or res.stdout}")
    out = res.stdout.strip()
    if not out:
        return []
    return json.loads(out)


def _provider_where(providers: list[str]) -> str:
    clauses = []
    for p in providers:
        if p == "sno-icon":
            clauses.append("RELATIVE_PATH LIKE 'sno-icon-%'")
        else:
            clauses.append(f"RELATIVE_PATH LIKE '{p}/%'")
    return "(" + " OR ".join(clauses) + ")"


def _sanitize_svg(svg: str) -> str:
    """Strip <script> blocks and inline on* handlers (defensive; img-rendered SVG
    does not execute script, but we never want active content in the store)."""
    svg = re.sub(r"<script\b[^>]*>.*?</script>", "", svg, flags=re.I | re.S)
    svg = re.sub(r"\son\w+\s*=\s*\"[^\"]*\"", "", svg, flags=re.I)
    svg = re.sub(r"\son\w+\s*=\s*'[^']*'", "", svg, flags=re.I)
    return svg.strip()


def _merge_brand_sources(path_index: dict[str, str], blobs: dict[str, str]) -> int:
    """Inject git-pinned, non-catalog brand icons (brand_sources.json) into the
    content store. These are gap-fill logos absent from the agent catalog (e.g.
    Salesforce). Pinning by source_url + sha256 keeps the lean baseline fully
    reproducible from git even if the dev catalog is unavailable, while the
    catalog row (seeded separately) remains the source of truth for the agent."""
    if not BRAND_SOURCES.exists():
        return 0
    try:
        ledger = json.loads(BRAND_SOURCES.read_text(encoding="utf-8"))
    except Exception as ex:
        print(f"  brand_sources.json unreadable ({ex}); skipping", file=sys.stderr)
        return 0
    merged = 0
    for rel, e in sorted(ledger.items()):
        url = (e or {}).get("source_url")
        want_sha = (e or {}).get("sha256")
        if not url:
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "snowgram-icon-vendor"})
            svg = _sanitize_svg(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))
        except Exception as ex:
            print(f"  brand '{rel}': fetch failed ({ex}); skipping", file=sys.stderr)
            continue
        if "<svg" not in svg.lower() or "<script" in svg.lower():
            print(f"  brand '{rel}': not a clean svg; skipping", file=sys.stderr)
            continue
        if want_sha and hashlib.sha256(svg.encode("utf-8")).hexdigest() != want_sha:
            print(f"  brand '{rel}': sha256 mismatch (pinned vs fetched); skipping", file=sys.stderr)
            continue
        data_uri = "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")
        sha = _sha_of_data_uri(data_uri)
        if not sha:
            continue
        old = path_index.get(rel)
        path_index[rel] = sha            # git-pinned version is authoritative for this path
        blobs[sha] = data_uri
        if old and old != sha and old not in set(path_index.values()):
            blobs.pop(old, None)         # prune orphaned prior blob (e.g. catalog re-encoding)
        merged += 1
        print(f"  brand '{rel}': merged (sha {sha[:12]})", file=sys.stderr)
    return merged


def _sha_of_data_uri(data_uri: str) -> str | None:
    """sha256 of the decoded SVG bytes inside a data: URI (None if undecodable)."""
    if not data_uri or "," not in data_uri:
        return None
    b64 = data_uri.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return None
    return hashlib.sha256(raw).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description="Vendor the agent icon map + curated catalog (content-addressed, deduped).")
    ap.add_argument("-c", "--connection", default="snowhouse", help="snow CLI connection name")
    ap.add_argument("--warehouse", help="optional warehouse")
    ap.add_argument("--providers", default=",".join(DEFAULT_PROVIDERS),
                    help="comma-separated curated providers (default: %(default)s)")
    ap.add_argument("--with-vocab", action="store_true",
                    help="also pre-resolve the known type vocabulary via ICON_SEARCH (build_icons_vocab)")
    args = ap.parse_args()
    providers = [p.strip() for p in args.providers.split(",") if p.strip()]

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. COMPONENT_ICON_MAP -> catalog_map.json (verbatim)
    print("fetching COMPONENT_ICON_MAP ...", file=sys.stderr)
    map_rows = snow_json(f"SELECT COMPONENT_KEY, RELATIVE_PATH FROM {MAP_TABLE}", args.connection, args.warehouse)
    catalog_map = {r["COMPONENT_KEY"]: r["RELATIVE_PATH"] for r in map_rows if r.get("RELATIVE_PATH")}
    (OUT_DIR / "catalog_map.json").write_text(json.dumps(catalog_map, indent=0, sort_keys=True), encoding="utf-8")
    print(f"  map entries: {len(catalog_map)}", file=sys.stderr)

    # 2. Fetch curated-subset catalog rows, per provider (keeps each stdout sane).
    path_to_uri: dict[str, str] = {}
    for p in providers:
        where = _provider_where([p])
        print(f"fetching catalog provider '{p}' ...", file=sys.stderr)
        rows = snow_json(
            f"SELECT RELATIVE_PATH, SVG_BASE64_DATA_URI FROM {CATALOG_TABLE} WHERE {where}",
            args.connection, args.warehouse,
        )
        for r in rows:
            if r.get("RELATIVE_PATH") and r.get("SVG_BASE64_DATA_URI"):
                path_to_uri[r["RELATIVE_PATH"]] = r["SVG_BASE64_DATA_URI"]
        print(f"  {p}: {len(rows)} rows", file=sys.stderr)

    # Guarantee every map-referenced path is present (even if outside curated providers).
    missing_map_paths = sorted({v for v in catalog_map.values() if v not in path_to_uri})
    if missing_map_paths:
        print(f"fetching {len(missing_map_paths)} map-referenced paths outside curated providers ...", file=sys.stderr)
        # chunk the IN-list
        for i in range(0, len(missing_map_paths), 200):
            chunk = missing_map_paths[i:i + 200]
            inlist = ",".join("'" + c.replace("'", "''") + "'" for c in chunk)
            rows = snow_json(
                f"SELECT RELATIVE_PATH, SVG_BASE64_DATA_URI FROM {CATALOG_TABLE} WHERE RELATIVE_PATH IN ({inlist})",
                args.connection, args.warehouse,
            )
            for r in rows:
                if r.get("RELATIVE_PATH") and r.get("SVG_BASE64_DATA_URI"):
                    path_to_uri[r["RELATIVE_PATH"]] = r["SVG_BASE64_DATA_URI"]

    # 3. Content-addressed store: path_index{path:sha}, blobs{sha:data_uri} (each sha once).
    path_index: dict[str, str] = {}
    blobs: dict[str, str] = {}
    skipped = 0
    for path, uri in path_to_uri.items():
        sha = _sha_of_data_uri(uri)
        if not sha:
            skipped += 1
            continue
        path_index[path] = sha
        if sha not in blobs:
            blobs[sha] = uri

    # 3b. Merge git-pinned brand gap-fill icons (reproducible from brand_sources.json).
    brand_merged = _merge_brand_sources(path_index, blobs)
    if brand_merged:
        print(f"merged {brand_merged} git-pinned brand icon(s)", file=sys.stderr)

    # 4. Dedup report vs the existing on-disk skill icons (informational).
    skill_hashes: dict[str, str] = {}
    if SKILL_ICONS_DIR.exists():
        for f in SKILL_ICONS_DIR.glob("*.svg"):
            try:
                skill_hashes[hashlib.sha256(f.read_bytes()).hexdigest()] = f.name
            except Exception:
                pass
    cross_overlap = sum(1 for sha in blobs if sha in skill_hashes)

    (OUT_DIR / "path_index.json").write_text(json.dumps(path_index, indent=0, sort_keys=True), encoding="utf-8")
    (OUT_DIR / "blobs.json").write_text(json.dumps(blobs, separators=(",", ":"), sort_keys=True), encoding="utf-8")

    total_paths = len(path_index)
    unique_blobs = len(blobs)
    blobs_bytes = (OUT_DIR / "blobs.json").stat().st_size
    meta = {
        "source_account": "SFCOGSOPS-SNOWHOUSE_AWS_US_WEST_2",
        "connection": args.connection,
        "generated": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "providers": providers,
        "map_entries": len(catalog_map),
        "catalog_paths": total_paths,
        "unique_blobs": unique_blobs,
        "intra_catalog_dups_collapsed": total_paths - unique_blobs,
        "cross_set_overlap_with_skill_icons": cross_overlap,
        "undecodable_skipped": skipped,
        "brand_icons_merged": brand_merged,
        "blobs_json_mb": round(blobs_bytes / 1024 / 1024, 2),
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))

    if args.with_vocab:
        try:
            from build_icons_vocab import build_vocab  # type: ignore
        except Exception:
            sys.path.insert(0, str(SCRIPT_DIR))
            from build_icons_vocab import build_vocab  # type: ignore
        build_vocab(args.connection, args.warehouse, OUT_DIR, path_index)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
