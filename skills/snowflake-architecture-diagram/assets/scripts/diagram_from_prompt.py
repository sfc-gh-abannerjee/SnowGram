#!/usr/bin/env python3
"""
One-shot prompt → self-contained HTML renderer.

Hides the full pipeline (intent_router → baseline state build → knowledge-pack
overlay → prompt customization → static render) behind a single command so
the agent driving the skill can produce a high-quality diagram in one call.

The output HTML embeds the bundled viewer (custom orthogonal connector
routing, line jumps, hover-traceable connections, zone categorization,
baked-in Snowflake icons) — the same renderer the live viewer uses for the
rich-state path.

Routing semantics (per the skill's design rule — templates are FALLBACKS):
    1. route_v2 picks: "template" | "from_scratch" | "compose".
    2. Template path requires score ≥ 2 distinct keyword matches AND no tie.
       Otherwise we route to from_scratch and use flow_builder.build_flow_from_docs
       to compose a fresh rich-state diagram informed by SnowflakeProductDocs.
    3. A knowledge_pack (produced by CoCo from cortex search docs + SME skills)
       can be passed via --knowledge-pack to inject best-practice component
       overrides, doc citations, and best-practice notes into the result.
    4. State is then run through state_customizer to apply prompt-driven
       additions (Tableau, Kafka source, masking policies, etc.).

Usage:
    python3 diagram_from_prompt.py "<prompt>" --out diagram.html
    python3 diagram_from_prompt.py "<prompt>" --out diagram.html --title "Custom Title"
    python3 diagram_from_prompt.py "<prompt>" --out diagram.html --knowledge-pack /tmp/kp.json
    python3 diagram_from_prompt.py "<prompt>" --out -          # stdout
    python3 diagram_from_prompt.py "<prompt>" --out diagram.html --legacy-router
    python3 diagram_from_prompt.py "<prompt>" --out diagram.html --prefer-template

Exit codes:
    0  success
    2  invalid args / missing template body
    3  render_static.py failed
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional

SKILL_DIR = Path(__file__).resolve().parent.parent.parent
TEMPLATES = SKILL_DIR / "assets" / "templates"
COMPOSER = SKILL_DIR / "assets" / "composer"
RENDER_STATIC = SKILL_DIR / "assets" / "scripts" / "render_static.py"


def _load_module(name: str, path: Path):
    spec_mod = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec_mod)
    spec_mod.loader.exec_module(mod)
    return mod


def _load_template_rich_state(template_id: str) -> Optional[dict[str, Any]]:
    """Return the template's RICH_STATE block if authored, else None."""
    path = TEMPLATES / f"{template_id}.json"
    if not path.exists():
        return None
    row = json.loads(path.read_text(encoding="utf-8"))
    return row.get("RICH_STATE")


def _load_template_mermaid(template_id: str) -> tuple[str, str]:
    """Return (mermaid_code, template_name) for the given template id."""
    path = TEMPLATES / f"{template_id}.json"
    if not path.exists():
        sys.exit(f"ERROR: template {template_id}.json not found at {path}")
    row = json.loads(path.read_text(encoding="utf-8"))
    mermaid = row.get("FULL_MERMAID_CODE") or row.get("full_mermaid_code") or ""
    name = row.get("TEMPLATE_NAME") or row.get("template_name") or template_id
    return mermaid, name


def _infer_title_from_prompt(prompt: str, max_len: int = 80) -> Optional[str]:
    """Best-effort title extraction from the user's prompt — first clause, capitalized."""
    if not prompt:
        return None
    cleaned = re.sub(r"\s+", " ", prompt.strip())
    # Prefer text before the first ':' or '.' or ','.
    for sep in (":", ".", ","):
        if sep in cleaned:
            cleaned = cleaned.split(sep, 1)[0].strip()
            break
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rsplit(" ", 1)[0] + "…"
    if not cleaned:
        return None
    return cleaned[0].upper() + cleaned[1:]


def _build_template_state(template_id: str, prompt_title: Optional[str]) -> dict[str, Any]:
    """Load a template's RICH_STATE, or fall back to its Mermaid blob if unauthored."""
    rich = _load_template_rich_state(template_id)
    if rich:
        state = json.loads(json.dumps(rich))  # deep copy
        if prompt_title:
            state["title"] = prompt_title
        state["source"] = f"standalone:template:{template_id}"
        return state

    # Last-resort fallback: emit Mermaid-only state. The viewer will use its
    # default Mermaid renderer (no custom routing). Should rarely fire after
    # build_rich_states.py has been run.
    mermaid, name = _load_template_mermaid(template_id)
    if not mermaid:
        sys.exit(f"ERROR: template {template_id} has neither RICH_STATE nor FULL_MERMAID_CODE")
    return {
        "mermaid": mermaid,
        "title": prompt_title or name,
        "source": f"standalone:template:{template_id}",
        "citations": [],
    }


def _build_from_scratch_state(prompt: str, pipeline_type: str, *, use_docs: bool = True) -> dict[str, Any]:
    """Use the docs-driven flow_builder to compose a fresh rich state."""
    flow_builder = _load_module("flow_builder", COMPOSER / "flow_builder.py")
    # flow_builder.build_flow_from_docs lives in the package import; load deps
    # via the same module loader so docs_resolver resolves cleanly.
    docs_resolver = _load_module("docs_resolver", COMPOSER / "docs_resolver.py")
    spec = docs_resolver.resolve_pipeline(prompt, pipeline_type=pipeline_type, use_docs=use_docs)
    # Tag the spec entries with their stage so the customizer / pack can target them.
    flow = flow_builder._spec_to_flow(spec)
    # Inject `stage` and `object_type` into nodes (spec_to_flow doesn't currently).
    spec_by_label = {s.get("label"): s for s in spec}
    for node in flow.get("nodes", []):
        s = spec_by_label.get(node["label"])
        if s:
            node["stage"] = s.get("stage")
            node["object_type"] = s.get("object_type")
    return {
        "title": _infer_title_from_prompt(prompt) or pipeline_type.replace("_", " ").title() + " Pipeline",
        "source": f"standalone:from_scratch:{pipeline_type}",
        "nodes": flow["nodes"],
        "edges": flow["edges"],
        "zones": flow["zones"],
        "citations": [
            {"url": n["doc_url"], "title": n["label"], "excerpt": n.get("detail", "")}
            for n in flow["nodes"]
            if n.get("doc_url")
        ],
    }


def _build_compose_state(block_ids: list[str], prompt: str) -> dict[str, Any]:
    """Compose state from explicit BLOCK_IDs (multi-source freeform path)."""
    flow_builder = _load_module("flow_builder", COMPOSER / "flow_builder.py")
    flow = flow_builder.build_flow_from_block_ids(block_ids)
    return {
        "title": _infer_title_from_prompt(prompt) or "Composed Architecture",
        "source": "standalone:compose",
        "nodes": flow["nodes"],
        "edges": flow["edges"],
        "zones": flow["zones"],
        "citations": [
            {"url": n["doc_url"], "title": n["label"], "excerpt": n.get("detail", "")}
            for n in flow.get("nodes", [])
            if n.get("doc_url")
        ],
    }


def _render(state: dict[str, Any], out: str) -> int:
    """Write state to a temp file, pipe through render_static.py, return exit code."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    ) as tf:
        json.dump(state, tf)
        state_path = tf.name
    try:
        rc = subprocess.call(
            [sys.executable, str(RENDER_STATIC), "--state", state_path, "--out", out]
        )
        return rc if rc == 0 else 3
    finally:
        Path(state_path).unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Render a Snowflake architecture diagram from a natural-language prompt."
    )
    ap.add_argument("prompt", help="Natural-language description of the architecture")
    ap.add_argument("--out", required=True, help="Output HTML path, or '-' for stdout")
    ap.add_argument("--title", help="Optional override for the diagram title")
    ap.add_argument("--knowledge-pack", help="Path to a knowledge_pack.json (CoCo-supplied SME context)")
    ap.add_argument("--prefer-template", action="store_true",
                    help="Bias routing toward the template path even at low confidence (legacy compat)")
    ap.add_argument("--legacy-router", action="store_true",
                    help="Use the legacy intent_router.route() instead of route_v2")
    ap.add_argument("--no-docs", action="store_true",
                    help="Skip live cortex search docs enrichment in the from_scratch path (use cached/default specs only)")
    args = ap.parse_args(argv)

    intent_router = _load_module("intent_router", COMPOSER / "intent_router.py")
    knowledge_pack_mod = _load_module("knowledge_pack", COMPOSER / "knowledge_pack.py")
    state_customizer = _load_module("state_customizer", COMPOSER / "state_customizer.py")

    pack = knowledge_pack_mod.load_pack(args.knowledge_pack) if args.knowledge_pack else {}

    # Routing.
    if args.legacy_router:
        decision = intent_router.route(args.prompt)
    else:
        decision = intent_router.route_v2(
            args.prompt,
            knowledge_pack=pack if pack else None,
            template_threshold=1 if args.prefer_template else intent_router.DEFAULT_TEMPLATE_THRESHOLD,
        )

    title_override = args.title  # ONLY explicit --title overrides; prompt-inferred title
                                  # is reserved for from_scratch / compose paths where
                                  # there's no authored template name to anchor the title.

    # Baseline state.
    decision_type = decision.get("type")
    if decision_type == "template":
        state = _build_template_state(decision["template_id"], title_override)
    elif decision_type == "from_scratch":
        state = _build_from_scratch_state(
            args.prompt, decision["pipeline_type"], use_docs=not args.no_docs
        )
        if title_override:
            state["title"] = title_override
    elif decision_type == "compose":
        state = _build_compose_state(decision["block_ids"], args.prompt)
        if title_override:
            state["title"] = title_override
    elif decision_type == "docs_driven":
        # Legacy `--docs` decision shape — handle gracefully.
        flow_builder = _load_module("flow_builder", COMPOSER / "flow_builder.py")
        flow = flow_builder._spec_to_flow(decision["spec"])
        state = {
            "title": title_override or decision["pipeline_type"].replace("_", " ").title() + " Pipeline",
            "source": "standalone:docs_driven",
            "nodes": flow["nodes"],
            "edges": flow["edges"],
            "zones": flow["zones"],
        }
    else:
        sys.exit(f"ERROR: unsupported decision type: {decision_type!r}")

    # Apply knowledge pack (best-practice overrides + citations + bp_notes).
    if pack:
        state = knowledge_pack_mod.apply_pack(state, pack)

    # Apply prompt-driven customizations (Tableau swap, missing sources, security overlays).
    state = state_customizer.customize(state, args.prompt)

    # Annotate with the routing decision for traceability.
    state.setdefault("routing", {}).update({
        "type": decision_type,
        "rationale": decision.get("rationale"),
        "confidence": decision.get("confidence"),
    })

    return _render(state, args.out)


if __name__ == "__main__":
    sys.exit(main())
