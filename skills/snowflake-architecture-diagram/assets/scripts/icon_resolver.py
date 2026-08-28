#!/usr/bin/env python3
"""
icon_resolver.py - hybrid, offline-first icon resolution at SnowGram-agent parity.

Resolution order (first hit wins), mirroring the agent's MAP -> SEARCH design but
layered for offline use:

  1. catalog_map.json   curated COMPONENT_ICON_MAP (type-key then label-key) -> path
  1b. keyword           a token (>=4 chars) of type/label that equals a map key  -> path
  2. vocab_resolved.json build-time ICON_SEARCH winners (+ overrides)        -> path
  3. live ICON_SEARCH   (only if online + connection) top-1 path, then cached
  4. fuzzy              token overlap of (type+label) vs vendored path tokens -> path
  -> path is mapped to a data URI via path_index.json + blobs.json (content store)
  5. None               caller falls back to the legacy icon_manifest.json

All of 1/2/4 are fully offline once build_icons.py has run. Step 3 needs Snowflake
but caches results (resolved_cache.json) so a type is only ever resolved online once.

Public API:
  resolve(component_type, label, *, online=False, connection="snowhouse") -> data_uri | None
"""
from __future__ import annotations

import json
import re
import subprocess
from functools import lru_cache
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent          # assets/scripts
GEN_DIR = SCRIPT_DIR.parent / "render" / "icons_generated"  # assets/render/icons_generated
CACHE_PATH = GEN_DIR / "resolved_cache.json"

SEARCH_SERVICE = "TEMP.ABANNERJEE.ICON_SEARCH"
CATALOG_TABLE = "TEMP.ABANNERJEE.ICON_CATALOG"

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


@lru_cache(maxsize=1)
def _load() -> dict:
    def _j(name: str) -> dict:
        p = GEN_DIR / name
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    return {
        "map": _j("catalog_map.json"),
        "vocab": _j("vocab_resolved.json"),
        "path_index": _j("path_index.json"),
        "blobs": _j("blobs.json"),
    }


def _cache() -> dict:
    if CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _cache_write(cache: dict) -> None:
    try:
        GEN_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps(cache, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    except Exception:
        pass


def _uri_for_path(path: str | None) -> str | None:
    if not path:
        return None
    data = _load()
    sha = data["path_index"].get(path)
    if sha:
        return data["blobs"].get(sha)
    return None


def _tokens(*parts: str) -> set[str]:
    toks: set[str] = set()
    for p in parts:
        toks.update(_TOKEN_RE.findall(_norm(p)))
    return toks


def _fuzzy_path(component_type: str, label: str) -> str | None:
    """Best token-overlap match of (type+label) against vendored path tokens."""
    want = _tokens(component_type, label)
    if not want:
        return None
    best_path, best_score = None, 0
    for path in _load()["path_index"]:
        # weight the last path segment (the icon name) most
        name = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        ptoks = _tokens(path.replace("/", " "), name)
        score = len(want & ptoks)
        # small bonus when a want-token is a substring of the icon name
        if any(w in name for w in want if len(w) >= 4):
            score += 1
        if score > best_score:
            best_path, best_score = path, score
    return best_path if best_score > 0 else None


def _snow_search(query: str, connection: str) -> str | None:
    payload = json.dumps({"query": query, "columns": ["RELATIVE_PATH"], "limit": 1})
    sql = (
        f"SELECT PARSE_JSON(SNOWFLAKE.CORTEX.SEARCH_PREVIEW('{SEARCH_SERVICE}', "
        f"'{payload}')):results[0]:RELATIVE_PATH::string AS P"
    )
    try:
        res = subprocess.run(["snow", "sql", "-c", connection, "--format", "json", "-q", sql],
                             capture_output=True, text=True)
        if res.returncode != 0 or not res.stdout.strip():
            return None
        rows = json.loads(res.stdout.strip())
        return rows[0].get("P") if rows and rows[0].get("P") else None
    except Exception:
        return None


def _snow_data_uri(path: str, connection: str) -> str | None:
    safe = path.replace("'", "''")
    sql = f"SELECT SVG_BASE64_DATA_URI AS U FROM {CATALOG_TABLE} WHERE RELATIVE_PATH='{safe}' LIMIT 1"
    try:
        res = subprocess.run(["snow", "sql", "-c", connection, "--format", "json", "-q", sql],
                             capture_output=True, text=True)
        if res.returncode != 0 or not res.stdout.strip():
            return None
        rows = json.loads(res.stdout.strip())
        return rows[0].get("U") if rows else None
    except Exception:
        return None


def resolve(component_type: str, label: str, *, online: bool = False, connection: str = "snowhouse") -> str | None:
    """Return an SVG data URI for (component_type, label), or None to fall back."""
    data = _load()
    ctype, lbl = _norm(component_type), _norm(label)

    # 1. curated map: type then label
    for key in (ctype, lbl):
        if key and key in data["map"]:
            uri = _uri_for_path(data["map"][key])
            if uri:
                return uri

    # 1b. map by keyword: a token (>=4 chars) of type/label that exactly equals a
    #     curated map key. Offline stand-in for the agent's ICON_SEARCH finding a
    #     brand named in a prose label; lets a brand beat a generic type, e.g.
    #     "Reverse ETL to Salesforce"/SAAS -> salesforce (not the generic saas icon).
    #     Runs AFTER exact type/label (well-typed nodes already resolved) and
    #     BEFORE vocab (so the brand wins over a generic type's vocab entry).
    mp = data["map"]
    for tok in sorted(_tokens(ctype, lbl), key=lambda t: (-len(t), t)):
        if len(tok) >= 4 and tok in mp:
            uri = _uri_for_path(mp[tok])
            if uri:
                return uri

    # 2. pre-resolved vocab: type then label
    for key in (ctype, lbl):
        if key and key in data["vocab"]:
            uri = _uri_for_path(data["vocab"][key])
            if uri:
                return uri

    # 3. live ICON_SEARCH, persisted to a runtime overlay (resolved_cache.json,
    #    type|label -> data URI). The vendored build baseline stays immutable;
    #    the overlay self-curates so a novel type is only fetched online once.
    cache_key = f"{ctype}|{lbl}"
    cache = _cache()
    if cache_key in cache:
        return cache[cache_key]
    if online:
        query = lbl or ctype.replace("_", " ")
        path = _snow_search(query, connection)
        uri = None
        if path:
            uri = _uri_for_path(path) or _snow_data_uri(path, connection)
        if uri:
            cache[cache_key] = uri
            _cache_write(cache)
            return uri

    # 4. fuzzy over vendored paths
    uri = _uri_for_path(_fuzzy_path(ctype, lbl))
    if uri:
        return uri

    # 5. caller falls back to legacy manifest
    return None
