---
name: snowflake-architecture-diagram-from-lineage
description: "From-lineage mode: reverse-engineer an architecture diagram from real Snowflake objects using cortex lineage. Works in any account — no SnowGram deploy required."
parent_skill: snowflake-architecture-diagram
---

# From-lineage mode

Generates a diagram of a real, deployed data flow by walking `cortex lineage` from a target object. Works in **any** Snowflake account because it depends on lineage metadata only — not on SnowGram-specific deployed objects.

## Use cases

- "Show me everything that feeds my dashboard table"
- "Diagram the upstream of `MY_DB.MART.SALES_DAILY`"
- "What does my fact table depend on, three hops up?"
- "Generate documentation for our actual production pipeline"

## Prerequisites

- Active `cortex` connection
- Current role has `USAGE` on the target object's database/schema
- Target object exists (table, view, materialized view, dynamic table, or stream)

## Workflow

### Step 1: Identify the target object

The user should provide a fully-qualified name (`DATABASE.SCHEMA.NAME`). If they provide a partial name, use `cortex search object "<name>"` to disambiguate:

```bash
cortex search object "<partial name>" --types table,view,dynamic_table
```

**⚠️ STOP**: confirm the chosen FQN with the user.

### Step 2: Walk the lineage tree

```bash
cortex lineage <FQN> --direction upstream --distance 5 --tree
```

Default direction is `upstream` (what feeds the object). For reverse exploration ("what consumes this?"), use `--direction downstream`. For both, run two passes.

The output is a tree of `{name, type, schema, database, distance}` nodes with parent/child relationships derived from Snowflake's ACCESS_HISTORY or query lineage.

### Step 3: Enrich each node with column metadata

For each unique node in the lineage tree, fetch column-level metadata:

```bash
cortex search table-details "<DATABASE.SCHEMA.NAME>"
```

Capture: column count, key columns, last-modified timestamp, row estimate. These become the diagram's subtitle text.

### Step 4: Map object types to canonical component types

Read `<DIR>/assets/component_synonyms.json`. For each lineage node, infer the most appropriate component type:

| Snowflake object kind | Default component type |
|---|---|
| TABLE (raw, landing) | `bronze_table` |
| TABLE (clean, intermediate) | `silver_table` |
| TABLE (curated, fact, dim) | `gold_table` |
| VIEW | `view` |
| MATERIALIZED_VIEW | `materialized_view` |
| DYNAMIC_TABLE | `dynamic_table` |
| STREAM | `cdc_stream` |
| TASK | `transform_task` |
| PIPE | `snowpipe` |
| EXTERNAL_TABLE | `iceberg_table` or `external_table` |
| FUNCTION (UDF) | `udf` |
| PROCEDURE | `stored_procedure` |
| STAGE | `external_stage` |

Refine via name heuristics: `*_BRONZE` -> `bronze_table`, `*_SILVER` -> `silver_table`, `*_GOLD`/`MART_*`/`FACT_*`/`DIM_*` -> `gold_table`. Use `<DIR>/assets/component_synonyms.json` for additional fuzzy matches.

For each component type, find the best matching `BLOCK_ID` in `<DIR>/assets/component_blocks.json`. If no exact match exists, fall back to a generic `snowflake_component` style with the object's actual name as the label.

### Step 5: Compose the diagram

Two sub-options:

**5a. Use the local composer with mapped BLOCK_IDs:**

```bash
python3 <DIR>/assets/composer/composer.py BLOCK_ID_1 BLOCK_ID_2 ...
```

This produces a styled Mermaid flowchart but loses the actual object names. Best when the user wants a **stylized** diagram.

**5b. Synthesize Mermaid directly from the lineage tree (preserves real names):**

```python
def lineage_to_mermaid(tree, table_details_by_name):
    lines = ["flowchart LR"]
    for node in tree.nodes:
        nid = sanitize_id(node.name)
        details = table_details_by_name.get(node.fqn, {})
        cols = details.get("column_count", "?")
        label = f'{node.name}<br/>{cols} cols'
        style = style_for_type(node.kind)
        lines.append(f'    {nid}[("{label}")]:::{style}')
    for edge in tree.edges:
        lines.append(f'    {sanitize_id(edge.source)} --> {sanitize_id(edge.target)}')
    lines.append("    %% Styling")
    lines.extend(STYLE_DEFINITIONS)  # reuse from composer.py
    return "\n".join(lines)
```

Best when the user wants documentation of their **actual** pipeline. This is the recommended default for from-lineage mode.

**⚠️ STOP**: confirm 5a vs 5b with the user.

### Step 6: Render

```bash
cat > <DIR>/assets/viewer/state.json <<EOF
{
  "mermaid": "<the synthesized Mermaid>",
  "title": "Lineage of <object_name>",
  "source": "from-lineage:<direction>:<distance>",
  "citations": [...]
}
EOF

<DIR>/assets/scripts/launch_viewer.sh
```

### Step 7: Iteration

- "Go further upstream" -> re-run `cortex lineage --distance 6`
- "Add downstream too" -> run both directions, merge trees
- "Hide tasks/streams" -> filter the tree by object kind before composing
- "Stylize with SnowGram colors" -> swap to 5a (composer-based)

## Tools

| Tool | Used for |
|---|---|
| `cortex search object "<q>"` | Disambiguate partial object names |
| `cortex lineage <fqn> --direction upstream --distance N --tree` | Walk lineage |
| `cortex search table-details "<fqn>"` | Per-node column metadata |
| `<DIR>/assets/component_synonyms.json` | Object-kind to component-type mapping |
| `<DIR>/assets/component_blocks.json` | BLOCK_ID lookup (when using 5a) |
| `python3 <DIR>/assets/composer/composer.py` | Compose styled Mermaid (5a) |
| Inline lineage-to-Mermaid synthesizer | Preserve real names (5b) |
| `<DIR>/assets/scripts/launch_viewer.sh` | Render |

## Stopping points

- ✋ After Step 1: confirm target FQN
- ✋ After Step 4: present mapped component types, allow user override
- ✋ After Step 5: confirm stylized vs realistic
- ✋ After Step 6: viewer launched, user reviews
- ✋ Before iteration: confirm direction (deeper, wider, filter, restyle)

## Output

- A diagram of the actual data flow with real object names (5b) or stylized SnowGram components (5a)
- Per-node subtitles showing column counts and last-modified timestamps
- Downloadable `.mmd`, `.svg`, `.png`

## Failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| `cortex lineage` returns empty | Lineage data not yet populated for this object | Confirm object has been queried recently; lineage in Snowflake requires query history |
| `cortex search table-details` errors on some nodes | Cross-database object the role can't see | Continue without details for those nodes; render with name only |
| Diagram has 50+ nodes | Distance too high | Reduce `--distance` to 2 or 3 |
| Disconnected components | Lineage gaps (e.g. external sources not tracked) | Surface as a warning; user may add sources manually via composer |
