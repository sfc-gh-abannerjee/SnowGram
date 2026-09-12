#!/usr/bin/env python3
"""Regression guard for the self-hiding type-eyebrow rule (_type_echoes).

A node card shows its canonical component type as an "eyebrow" under the title,
but hides it when the type merely repeats the label (e.g. "Bronze Dynamic Table"
+ "DYNAMIC TABLE"). The decision is _type_echoes(component_type, label): the type
is an echo when its normalized text appears as a whole-word phrase inside the
label. This test pins that behavior so a future edit to the predicate (or the
_norm it depends on) fails loudly instead of silently over/under-hiding types.

The same rule is mirrored in JS (sgTypeEcho) for the live/edit path and in the
Present-mode caption (which skips an sg-echo type) -- keep those in sync if you
change the cases here.

Run: python3 test_type_echoes.py   (exit 0 = pass, 1 = fail)
Offline/deterministic: imports the vendored render_diagram_generated.py, no Snowflake.
"""
from __future__ import annotations
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GENERATED = HERE / "render_diagram_generated.py"

# (component_type, label, expected_is_echo)
CASES = [
    # --- ECHO: type adds no new words beyond the label -> hidden ---
    ("azure synapse", "Azure Synapse", True),          # exact
    ("azure sql", "Azure SQL", True),
    ("azure blob storage", "Azure Blob Storage", True),
    ("snowpipe", "Snowpipe", True),
    ("dbt", "dbt", True),
    ("dynamic table", "Bronze Dynamic Table", True),    # type is a phrase in a richer label
    ("dynamic table", "Silver Dynamic Table", True),
    ("dynamic table", "Gold Dynamic Table", True),
    ("power bi", "Power BI (Legacy)", True),            # punctuation in label
    ("streamlit", "Streamlit / React App", True),
    ("cortex", "Cortex Cowork", True),
    ("azure synapse", "Azure Synapse Analytics", True),

    # --- NOT an echo: type contributes info the label doesn't state -> shown ---
    ("governance", "Snowflake Horizon", False),
    ("snowflake account", "Arcadia Health (Snowflake)", False),  # "snowflake" alone != "snowflake account"
    ("dynamic table", "Bronze", False),                          # label doesn't name the type
    ("azure synapse", "Synapse", False),                         # type adds "azure"

    # --- whole-word safety: a type token inside a longer word is NOT a match ---
    ("sql", "MySQL Source", False),                              # "sql" must not match inside "mysql"
    ("table", "Constable Register", False),                      # "table" must not match inside "constable"

    # --- degenerate ---
    ("", "Whatever", False),                                     # no type -> never an echo
    ("dynamic table", "", False),
]


def main() -> int:
    if not GENERATED.exists():
        print(f"FAIL: {GENERATED} not found (run build_render.py first)")
        return 1
    spec = importlib.util.spec_from_file_location("rdg", GENERATED)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    if not hasattr(m, "_type_echoes"):
        print("FAIL: render_diagram_generated.py has no _type_echoes (rebuild needed?)")
        return 1

    fails = 0
    for ct, lb, exp in CASES:
        got = m._type_echoes(ct, lb)
        if got != exp:
            fails += 1
            print(f"  FAIL _type_echoes({ct!r}, {lb!r}) = {got}, expected {exp}")
    print(f"type-echo rule: {len(CASES)} cases | {fails} failing")
    print("TYPE ECHO OK" if fails == 0 else "TYPE ECHO FAILED")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
