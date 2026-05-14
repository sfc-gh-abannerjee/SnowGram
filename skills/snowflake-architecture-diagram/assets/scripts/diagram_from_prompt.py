#!/usr/bin/env python3
"""
One-shot prompt → self-contained HTML renderer.

Hides the multi-step pipeline (intent_router → template lookup →
state.json composition → render_static) behind a single command so
that a coding agent driving the skill can produce a diagram in one
call instead of orchestrating four. The output HTML embeds the
bundled viewer (custom orthogonal connector routing, line jumps,
hover-traceable connections, baked-in Snowflake icons) — the same
output the live viewer would produce.

Usage:
    python3 diagram_from_prompt.py "<user prompt>" --out diagram.html
    python3 diagram_from_prompt.py "<user prompt>" --out -          # stdout
    python3 diagram_from_prompt.py "<user prompt>" --out diagram.html --title "Custom Title"

Exit codes:
    0  success
    1  no template matched the prompt with reasonable confidence
    2  template found but Mermaid body empty or missing
    3  render_static.py failed
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent.parent
TEMPLATES = SKILL_DIR / "assets" / "templates"
INTENT_ROUTER = SKILL_DIR / "assets" / "composer" / "intent_router.py"
RENDER_STATIC = SKILL_DIR / "assets" / "scripts" / "render_static.py"


def route(prompt: str) -> dict:
    """Call the intent router and return its decision dict."""
    out = subprocess.check_output(
        [sys.executable, str(INTENT_ROUTER), prompt],
        encoding="utf-8",
    )
    return json.loads(out)


def load_template_mermaid(template_id: str) -> tuple[str, str]:
    """Return (mermaid_code, template_name) for the given template id."""
    path = TEMPLATES / f"{template_id}.json"
    if not path.exists():
        sys.exit(f"ERROR: template {template_id}.json not found at {path}")
    row = json.loads(path.read_text(encoding="utf-8"))
    mermaid = row.get("FULL_MERMAID_CODE") or row.get("full_mermaid_code") or ""
    name = row.get("TEMPLATE_NAME") or row.get("template_name") or template_id
    return mermaid, name


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Render a Snowflake architecture diagram from a natural-language prompt"
    )
    ap.add_argument("prompt", help="Natural-language description of the architecture")
    ap.add_argument("--out", required=True, help="Output HTML path, or '-' for stdout")
    ap.add_argument("--title", help="Optional override for the diagram title")
    args = ap.parse_args(argv)

    decision = route(args.prompt)
    if decision.get("type") != "template":
        # Compose-from-blocks path — defer for now (template path covers
        # the 14 reference architectures which is the common case).
        sys.exit(
            "ERROR: prompt did not resolve to a template; use the composer "
            "manually for compose-from-blocks. Decision: " + json.dumps(decision)
        )

    template_id = decision["template_id"]
    mermaid, name = load_template_mermaid(template_id)
    if not mermaid:
        sys.exit(f"ERROR: template {template_id} has no Mermaid body (exit 2)")

    state = {
        "mermaid": mermaid,
        "title": args.title or name,
        "source": f"standalone:template:{template_id}",
        "citations": [],
    }

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    ) as tf:
        json.dump(state, tf)
        state_path = tf.name

    try:
        rc = subprocess.call(
            [sys.executable, str(RENDER_STATIC), "--state", state_path, "--out", args.out]
        )
        return rc if rc == 0 else 3
    finally:
        Path(state_path).unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
