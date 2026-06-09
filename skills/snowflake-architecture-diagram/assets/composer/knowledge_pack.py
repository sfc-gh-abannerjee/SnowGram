"""
Knowledge pack — apply CoCo-gathered domain expertise to a baseline diagram state.

The standalone skill's workflow (modes/standalone/SKILL.md) instructs CoCo to
gather domain knowledge BEFORE rendering: it runs `cortex search docs` for the
detected pipeline type and invokes Snowflake-expert SME skills (always
`snowflake-best-practices`, plus 1–2 type-specific skills like
`dynamic-tables`, `snowpipe-streaming`, `iceberg`, `data-governance`,
`machine-learning`). CoCo then summarizes the gathered guidance into a
structured JSON file conforming to the schema below.

This module reads that file and applies it as edits to a baseline state:
  - swap object_type / icon / label / detail / doc_url for any node whose
    `stage` matches a `component_overrides` key
  - append `doc_citations` to `state["citations"]`
  - attach per-object_type `annotations` to the matching node
  - append `best_practice_directives` to `state["bp_notes"]`

Schema (validated by `validate_pack`):

    {
      "pipeline_type": "medallion" | "streaming" | ...,
      "doc_citations": [
        {"url": "...", "title": "...", "excerpt": "..."}
      ],
      "best_practice_directives": ["...", "..."],
      "component_overrides": {
        "<stage>": "<OBJECT_TYPE>",
        ...
      },
      "annotations": [
        {"object_type": "...", "note": "..."}
      ]
    }

Both inputs and outputs use the viewer's rich-state format
({title, nodes, edges, zones, citations, bp_notes, ...}).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

_HERE = Path(__file__).resolve().parent
_ASSETS = _HERE.parent
_ICON_MANIFEST_PATH = _ASSETS / "icon_manifest.json"

_VALID_STAGES = {
    "source",
    "ingestion",
    "raw_storage",
    "transformation",
    "curated_storage",
    "serving",
    "consumption",
    "security",
}

_CANONICAL_DOC_URLS: dict[str, str] = {
    "TABLE": "https://docs.snowflake.com/en/sql-reference/sql/create-table",
    "DYNAMIC_TABLE": "https://docs.snowflake.com/en/user-guide/dynamic-tables-about",
    "STREAM": "https://docs.snowflake.com/en/user-guide/streams-intro",
    "TASK": "https://docs.snowflake.com/en/user-guide/tasks-intro",
    "PIPE": "https://docs.snowflake.com/en/user-guide/data-load-snowpipe-intro",
    "SNOWPIPE_STREAMING": "https://docs.snowflake.com/en/user-guide/snowpipe-streaming/data-load-snowpipe-streaming-overview",
    "STAGE": "https://docs.snowflake.com/en/sql-reference/sql/create-stage",
    "VIEW": "https://docs.snowflake.com/en/sql-reference/sql/create-view",
    "SECURE_VIEW": "https://docs.snowflake.com/en/user-guide/views-secure",
    "MATERIALIZED_VIEW": "https://docs.snowflake.com/en/user-guide/views-materialized",
    "WAREHOUSE": "https://docs.snowflake.com/en/user-guide/warehouses-overview",
    "MASKING_POLICY": "https://docs.snowflake.com/en/user-guide/security-column-ddm-intro",
    "ROW_ACCESS_POLICY": "https://docs.snowflake.com/en/user-guide/security-row-intro",
    "ICEBERG_TABLE": "https://docs.snowflake.com/en/user-guide/tables-iceberg",
    "HYBRID_TABLE": "https://docs.snowflake.com/en/user-guide/tables-hybrid",
    "EXTERNAL_FUNCTION": "https://docs.snowflake.com/en/sql-reference/sql/create-external-function",
}

_icon_manifest_cache: Optional[dict[str, Any]] = None


def _load_icon_manifest() -> dict[str, Any]:
    global _icon_manifest_cache
    if _icon_manifest_cache is None:
        if _ICON_MANIFEST_PATH.exists():
            _icon_manifest_cache = json.loads(
                _ICON_MANIFEST_PATH.read_text(encoding="utf-8")
            )
        else:
            _icon_manifest_cache = {}
    return _icon_manifest_cache


_OBJECT_TYPE_ALIASES: dict[str, str] = {
    # Map natural names to canonical icon manifest keys.
    "SNOWPIPE": "PIPE",
    "SNOWPIPE_STREAMING": "PIPE",
    "STREAMS_AND_TASKS": "STREAM",
    "DT": "DYNAMIC_TABLE",
    "DYNAMIC_TABLES": "DYNAMIC_TABLE",
    "BI_TOOL": "BI_TOOL",
    "TABLEAU": "BI_TOOL",
    "POWER_BI": "BI_TOOL",
    "POWERBI": "BI_TOOL",
    "LOOKER": "BI_TOOL",
}


def _resolve_icon_key(object_type: str) -> str:
    """Map an object_type to its icon-manifest lookup key."""
    if not object_type:
        return ""
    canonical = object_type.upper()
    return _OBJECT_TYPE_ALIASES.get(canonical, canonical)


def _icon_for(object_type: str) -> tuple[str, str]:
    manifest = _load_icon_manifest()
    key = _resolve_icon_key(object_type)
    entry = manifest.get(key)
    if entry and isinstance(entry, dict) and "icon" in entry:
        return entry["icon"], entry["category"]
    ext = manifest.get("_external_systems", {}).get(key)
    if ext:
        return ext["icon"], ext["category"]
    cons = manifest.get("_consumption", {}).get(key)
    if cons:
        return cons["icon"], cons["category"]
    fb = manifest.get("_fallback", {"icon": "Snowflake_ICON_Architecture.svg", "category": "snow"})
    return fb["icon"], fb["category"]


def _stage_for_node(node: dict[str, Any]) -> Optional[str]:
    """
    Reverse-map a node back to a pipeline stage so component_overrides can
    target it. We use the node's `stage` field if present; otherwise we infer
    from `category` + zone hints.
    """
    if "stage" in node and isinstance(node["stage"], str):
        return node["stage"]
    cat = (node.get("category") or "").lower()
    zone = (node.get("zone") or "").lower()
    label = (node.get("label") or "").lower()

    if cat == "onprem":
        return "source"
    if cat == "bridge":
        return "ingestion"
    if cat == "outcome":
        return "consumption"
    # snow category — disambiguate by zone
    if "raw" in zone or "bronze" in zone or "landing" in zone:
        return "raw_storage"
    if "curated" in zone or "silver" in zone:
        return "curated_storage"
    if "serving" in zone or "gold" in zone or "mart" in zone:
        return "serving"
    if "security" in zone or "governance" in zone or "policy" in label:
        return "security"
    return "transformation"


def validate_pack(pack: dict[str, Any]) -> list[str]:
    """
    Validate a knowledge pack. Returns a list of error strings (empty on success).
    Pack fields are all optional — a partial pack is allowed.
    """
    errs: list[str] = []
    if not isinstance(pack, dict):
        return ["pack is not a dict"]

    for k in ("pipeline_type",):
        if k in pack and not isinstance(pack[k], str):
            errs.append(f"{k!r} must be a string")

    if "doc_citations" in pack:
        if not isinstance(pack["doc_citations"], list):
            errs.append("doc_citations must be a list")
        else:
            for i, c in enumerate(pack["doc_citations"]):
                if not isinstance(c, dict):
                    errs.append(f"doc_citations[{i}] is not a dict")
                elif "url" not in c:
                    errs.append(f"doc_citations[{i}] missing 'url'")

    if "best_practice_directives" in pack:
        if not isinstance(pack["best_practice_directives"], list):
            errs.append("best_practice_directives must be a list")
        else:
            for i, d in enumerate(pack["best_practice_directives"]):
                if not isinstance(d, str):
                    errs.append(f"best_practice_directives[{i}] must be a string")

    if "component_overrides" in pack:
        if not isinstance(pack["component_overrides"], dict):
            errs.append("component_overrides must be a dict")
        else:
            for stage, obj_type in pack["component_overrides"].items():
                if stage not in _VALID_STAGES:
                    errs.append(
                        f"component_overrides[{stage!r}] not in valid stages "
                        f"{sorted(_VALID_STAGES)}"
                    )
                if not isinstance(obj_type, str):
                    errs.append(f"component_overrides[{stage!r}] must be a string")

    if "annotations" in pack:
        if not isinstance(pack["annotations"], list):
            errs.append("annotations must be a list")
        else:
            for i, a in enumerate(pack["annotations"]):
                if not isinstance(a, dict):
                    errs.append(f"annotations[{i}] is not a dict")
                elif "object_type" not in a or "note" not in a:
                    errs.append(f"annotations[{i}] needs 'object_type' and 'note'")

    return errs


def _humanize(object_type: str) -> str:
    """DYNAMIC_TABLE -> 'Dynamic Table', SNOWPIPE_STREAMING -> 'Snowpipe Streaming'."""
    return " ".join(part.capitalize() for part in object_type.split("_"))


def apply_pack(state: dict[str, Any], pack: Optional[dict[str, Any]]) -> dict[str, Any]:
    """
    Apply a knowledge pack to a baseline state. Mutates `state` in place AND
    returns it (so callers can chain). `pack=None` is a no-op.
    """
    if not pack:
        return state

    errs = validate_pack(pack)
    if errs:
        # Don't crash the pipeline on a malformed pack — surface the errors as
        # bp_notes so they appear next to the diagram, then drop bad fields.
        state.setdefault("bp_notes", []).extend(
            f"[knowledge-pack warning] {e}" for e in errs
        )

    # 1. Component overrides — swap matching nodes' object_type / icon / docs.
    overrides = pack.get("component_overrides") or {}
    if isinstance(overrides, dict):
        for node in state.get("nodes") or []:
            stage = _stage_for_node(node)
            if not stage or stage not in overrides:
                continue
            new_object_type = overrides[stage]
            if not isinstance(new_object_type, str):
                continue
            icon, category = _icon_for(new_object_type)
            node["object_type"] = new_object_type
            node["icon"] = icon
            # Only refresh category for snow-side stages — leave external sources
            # and consumption nodes unchanged so we don't move them between zones.
            if stage in {"raw_storage", "transformation", "curated_storage", "serving", "security"}:
                node["category"] = category
            # Refresh label/detail when they look like the previous default.
            new_label = _humanize(new_object_type)
            if not node.get("label") or _looks_default(node.get("label", ""), node.get("object_type", "")):
                node["label"] = new_label
            new_doc = _CANONICAL_DOC_URLS.get(new_object_type)
            if new_doc:
                node["doc_url"] = new_doc

    # 2. Citations — append, dedupe by URL.
    cites = pack.get("doc_citations") or []
    if cites:
        existing = state.setdefault("citations", [])
        existing_urls = {c.get("url") for c in existing if isinstance(c, dict)}
        for c in cites:
            if isinstance(c, dict) and c.get("url") not in existing_urls:
                existing.append(c)
                existing_urls.add(c.get("url"))

    # 3. Annotations — attach to matching nodes by object_type.
    anns = pack.get("annotations") or []
    if anns:
        nodes = state.get("nodes") or []
        for ann in anns:
            if not isinstance(ann, dict):
                continue
            ot = ann.get("object_type")
            note = ann.get("note")
            if not ot or not note:
                continue
            for node in nodes:
                if (node.get("object_type") or "").upper() == ot.upper():
                    node.setdefault("annotations", []).append(note)

    # 4. Best-practice directives — append to a top-level list, dedupe.
    bps = pack.get("best_practice_directives") or []
    if bps:
        notes = state.setdefault("bp_notes", [])
        for d in bps:
            if isinstance(d, str) and d not in notes:
                notes.append(d)

    # 5. Track which pack was applied for traceability.
    if pack.get("pipeline_type"):
        state.setdefault("knowledge_pack", {})["pipeline_type"] = pack["pipeline_type"]

    return state


def _looks_default(label: str, object_type: str) -> bool:
    """Heuristic: is this label the auto-generated default for its object type?"""
    if not label or not object_type:
        return False
    a = re.sub(r"[^a-z0-9]+", "", label.lower())
    b = re.sub(r"[^a-z0-9]+", "", object_type.lower())
    return a == b


def load_pack(path: str | Path) -> dict[str, Any]:
    """Load a knowledge pack from disk. Empty/missing path returns an empty dict."""
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


# --------------------------------------------------------------------------- #
# Disk cache for knowledge packs.
#
# Knowledge gathering (cortex search docs + SME skill invocations) is
# expensive. Cache the synthesized pack keyed by sha256(pipeline_type + prompt)
# under ~/.cache/snowflake-architecture-diagram/. The cache is user-scoped
# (NOT inside the skill bundle) since it's runtime-specific and shouldn't ship
# with the skill itself.
# --------------------------------------------------------------------------- #
import hashlib
import os
import time

_CACHE_DIR = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "snowflake-architecture-diagram"
_CACHE_TTL_SECONDS = 86400  # 24 hours


def _cache_key(pipeline_type: str, prompt: str) -> str:
    h = hashlib.sha256(f"{pipeline_type}|{prompt[:200]}".encode("utf-8")).hexdigest()[:16]
    return f"kp_{pipeline_type}_{h}"


def cache_path_for(pipeline_type: str, prompt: str) -> Path:
    """Return the cache path for a pipeline_type+prompt combination."""
    return _CACHE_DIR / f"{_cache_key(pipeline_type, prompt)}.json"


def get_cached(pipeline_type: str, prompt: str) -> Optional[dict[str, Any]]:
    """Return a cached knowledge pack if fresh; else None."""
    p = cache_path_for(pipeline_type, prompt)
    if not p.exists():
        return None
    try:
        if (time.time() - p.stat().st_mtime) > _CACHE_TTL_SECONDS:
            return None
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def set_cached(pipeline_type: str, prompt: str, pack: dict[str, Any]) -> Path:
    """Persist a knowledge pack to the on-disk cache. Returns the file path."""
    p = cache_path_for(pipeline_type, prompt)
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(pack, indent=2), encoding="utf-8")
    except OSError:
        pass
    return p
