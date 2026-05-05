"""
Mermaid composer — Python port of SNOWGRAM_DB.CORE.GENERATE_MERMAID_FROM_COMPONENTS.

Mirrors the deployed SQL UDF logic (captured at
assets/functions/GENERATE_MERMAID_FROM_COMPONENTS.sql) byte-for-byte over
the snapshotted COMPONENT_BLOCKS payload, so the standalone mode of the
skill produces output identical to what the deployed SnowGram agent
would emit for the same block_ids list.

Inputs:
  block_ids   : list[str]  — ordered list of BLOCK_ID strings
  connections : Any        — currently unused by the deployed UDF; the
                             function builds connections by INPUT ORDER
                             (LAG over input_position). Accepted for
                             signature parity.

Output:
  Mermaid `flowchart LR` text.

Reference SQL behaviour (faithful translation):
  1. Resolve each BLOCK_ID against COMPONENT_BLOCKS rows. Unknown ids
     are silently skipped (matches the JOIN's INNER semantics).
  2. Map BLOCK_CATEGORY -> style class via the case table.
  3. For each row's MERMAID_CODE:
        - If it already has a `:::` suffix, replace with the new style.
        - Else append `:::style_class`.
  4. Extract node_id via REGEXP_SUBSTR pattern `^[A-Za-z_][A-Za-z0-9_]*`.
  5. Build sequential edges: previous node_id --> current node_id (in
     input order). The first row has no incoming edge.
  6. Emit `flowchart LR`, indented node lines (input order), indented
     edge lines (input order, skipping NULL from_node), then a fixed
     `%% Styling` block with classDef definitions in fixed order.
  7. Concatenate with `\\n`.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable, Optional

# --------------------------------------------------------------------------- #
# Defaults — match the deployed UDF exactly
# --------------------------------------------------------------------------- #
DEFAULT_STYLE = "snowflakeStyle"

CATEGORY_TO_STYLE = {
    "bronze": "bronzeStyle",
    "silver": "silverStyle",
    "gold": "goldStyle",
    "external": "awsStyle",
    "bi": "biStyle",
    "compute": "warehouseStyle",
    "security": "secureStyle",
    "transformation": "transformStyle",
}

# Order matters — matches the SQL UNION ALL sequence (line_order 2001..2009)
STYLE_DEFINITIONS: list[tuple[str, str]] = [
    ("snowflakeStyle", "fill:#29B5E8,stroke:#fff,stroke-width:2px,color:#fff"),
    ("awsStyle",       "fill:#FF9900,stroke:#232F3E,stroke-width:2px,color:#fff"),
    ("bronzeStyle",    "fill:#CD7F32,stroke:#fff,stroke-width:2px,color:#fff"),
    ("silverStyle",    "fill:#C0C0C0,stroke:#333,stroke-width:2px,color:#333"),
    ("goldStyle",      "fill:#FFD700,stroke:#333,stroke-width:2px,color:#333"),
    ("warehouseStyle", "fill:#0066CC,stroke:#fff,stroke-width:2px,color:#fff"),
    ("secureStyle",    "fill:#4ECDC4,stroke:#fff,stroke-width:2px,color:#fff"),
    ("biStyle",        "fill:#E97627,stroke:#fff,stroke-width:2px,color:#fff"),
    ("transformStyle", "fill:#7B68EE,stroke:#fff,stroke-width:2px,color:#fff"),
]

# Mirrors REGEXP_SUBSTR(MERMAID_CODE, '^[A-Za-z_][A-Za-z0-9_]*')
_NODE_ID_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*")

# Strip any existing `:::style` suffix and replace with target style.
# SQL: REGEXP_REPLACE(MERMAID_CODE, ':::.*$', ':::' || style_class)
_STYLE_SUFFIX_RE = re.compile(r":::.*$")


# --------------------------------------------------------------------------- #
# Block index loader
# --------------------------------------------------------------------------- #
DEFAULT_BLOCKS_PATH = (
    Path(__file__).resolve().parent.parent / "component_blocks.json"
)


def load_blocks(path: Optional[Path] = None) -> dict[str, dict[str, Any]]:
    """Load the snapshotted COMPONENT_BLOCKS, keyed by BLOCK_ID."""
    p = Path(path) if path else DEFAULT_BLOCKS_PATH
    rows = json.loads(p.read_text(encoding="utf-8"))
    return {row["BLOCK_ID"]: row for row in rows if row.get("BLOCK_ID")}


# --------------------------------------------------------------------------- #
# Core composer
# --------------------------------------------------------------------------- #
def _style_for(category: Optional[str]) -> str:
    if not category:
        return DEFAULT_STYLE
    return CATEGORY_TO_STYLE.get(category.lower(), DEFAULT_STYLE)


def _restyle(mermaid_code: str, style_class: str) -> str:
    """Re-apply the chosen style class, replacing any existing `:::xxx` suffix."""
    if ":::" in mermaid_code:
        return _STYLE_SUFFIX_RE.sub(f":::{style_class}", mermaid_code)
    return f"{mermaid_code}:::{style_class}"


def _node_id_from(mermaid_code: str) -> Optional[str]:
    m = _NODE_ID_RE.match(mermaid_code)
    return m.group(0) if m else None


def compose(
    block_ids: Iterable[str],
    connections: Any = None,  # noqa: ARG001 — signature parity with SQL UDF
    *,
    blocks: Optional[dict[str, dict[str, Any]]] = None,
) -> str:
    """
    Build a Mermaid `flowchart LR` from an ordered list of BLOCK_IDs.

    Matches the deployed UDF behavior: unknown block_ids are silently
    skipped (INNER JOIN semantics); edges follow input order.
    """
    if blocks is None:
        blocks = load_blocks()

    # Filter to known blocks while preserving input order (mirrors INNER JOIN).
    resolved: list[dict[str, Any]] = []
    for bid in block_ids:
        row = blocks.get(bid)
        if row is None:
            continue
        category = row.get("BLOCK_CATEGORY")
        style = _style_for(category)
        styled_code = _restyle(row["MERMAID_CODE"], style)
        node_id = _node_id_from(styled_code)
        if not node_id:
            # Unparseable Mermaid line — skip; the SQL would emit nothing
            # useful for connections without a node id.
            continue
        resolved.append(
            {
                "block_id": bid,
                "category": category,
                "style": style,
                "node_id": node_id,
                "styled_code": styled_code,
            }
        )

    # Build output in the same line_order as the SQL:
    #   0           : flowchart LR
    #   100..       : node lines (input order)
    #   1000..      : edge lines (input order, skipping first row)
    #   2000..2009  : styling block
    lines: list[str] = ["flowchart LR"]

    for r in resolved:
        lines.append(f"    {r['styled_code']}")

    for i, r in enumerate(resolved):
        if i == 0:
            continue
        prev = resolved[i - 1]
        lines.append(f"    {prev['node_id']} --> {r['node_id']}")

    lines.append("    %% Styling")
    for cls, body in STYLE_DEFINITIONS:
        lines.append(f"    classDef {cls} {body}")

    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Convenience CLI for ad-hoc use
# --------------------------------------------------------------------------- #
def _main() -> int:
    import argparse
    import sys

    ap = argparse.ArgumentParser(description="Compose Mermaid from BLOCK_IDs (offline).")
    ap.add_argument("block_ids", nargs="+", help="Ordered list of BLOCK_IDs")
    ap.add_argument("--blocks", type=Path, default=None, help="Override component_blocks.json path")
    args = ap.parse_args()

    blocks = load_blocks(args.blocks)
    print(compose(args.block_ids, blocks=blocks))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
