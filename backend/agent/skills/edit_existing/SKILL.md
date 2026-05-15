---
name: edit_existing_diagram
description: |
  Surgical edit of an existing canvas diagram. Invoked when the user's
  request modifies a diagram already present in the conversation — adding
  components, removing components, renaming, replacing, reconnecting edges,
  or restructuring sections — instead of generating a brand-new architecture
  from a template.

  TRIGGER (invoke this skill when ALL hold):
  - The prompt contains a current-canvas mermaid block (the frontend includes
    one in `enrichedPrompt` whenever the canvas is non-empty).
  - The user's natural-language request describes a modification to that
    canvas, not a request for a different / new architecture. Edit verbs:
    add / append / include / introduce / insert; remove / delete / drop /
    strip / get rid of; rename / relabel / call it; replace / swap /
    substitute / change to; move / reorder; connect / disconnect / link /
    unlink; merge / split; simplify / minimize; expand / extend / extend
    with; keep / preserve / leave / lock; reroute / redirect; group / un-group.

  SKIP (do NOT invoke; let the normal Section 1-5 + tool path run) when:
  - The current canvas is empty (first turn in the thread).
  - The user names a different reference template ("now make it a
    Medallion Lakehouse", "switch to Customer 360"). Treat that as a fresh
    generation, not an edit.
  - The user asks a knowledge question without a modification verb
    ("what's the difference between Snowpipe and Snowpipe Streaming?").
---

# Edit existing diagram (surgical, layout-preserving)

This skill instructs the agent to edit a diagram in place by mutating
the current-canvas mermaid the user is looking at, instead of regenerating
from a template tool. The frontend re-renders from your output, so the
edit becomes the canvas. Keeping the unchanged content byte-identical is
how we avoid clobbering the user's prior manual edits and the agent's
prior decisions.

## Hard rules

1. **Do NOT call `COMPOSE_DIAGRAM_FROM_TEMPLATE` or
   `COMPOSE_DIAGRAM_FROM_PATTERN` when this skill is active.** Those tools
   produce a fresh diagram and would overwrite the user's existing one.
   Use `SEARCH_COMPONENT_BLOCKS` only if the edit needs new components
   the canvas doesn't have. Use `VALIDATE_MERMAID_SYNTAX` after assembling
   the edited mermaid.

2. **Start from the current-canvas mermaid in the prompt.** Treat it as
   the source of truth. Apply the user's requested change(s), preserving
   every other line VERBATIM — same node IDs, same labels (typo and all),
   same edge directions, same subgraph structure, same class definitions,
   same styling. Do not "improve" or "clean up" anything the user didn't
   ask you to.

3. **Preserve node IDs.** When replacing or renaming a node's *label*,
   keep the existing *id* unchanged so the frontend can match it across
   the diff. The frontend's auto-expand and history-snapshot logic keys
   on indices and IDs.

4. **Match the canonical response structure.** Even for edits, emit:
   - Section 1: Architecture Overview (1 sentence describing what the
     diagram shows AFTER the edit — short, do not re-describe the whole
     architecture)
   - Section 2: Component Summary (only the components the user added,
     removed, or modified — not the full table)
   - Section 3: Best Practices (skip if the edit doesn't introduce new
     practices; just write "No new best practices — see prior message.")
   - Section 4: Diagram — "Here is your updated diagram:" + ```mermaid```
     (the FULL edited diagram, not a diff) + Graph Metadata JSON
   - Section 5: Stats — node/edge counts of the EDITED diagram

5. **Multi-edit batching.** If the user asks for multiple changes in one
   turn ("delete X and add Y and rename Z"), apply them all in a single
   response. Don't split across turns.

## Worked examples

### Example A — Remove a path

**User**: "Remove the Kinesis ingestion path"

**Current canvas (in prompt)** includes lanes 1a (Kafka), 1b (Kinesis),
1c (Batch), 1d (Native) with edges from each into Snowpipe Streaming.

**Your response — Section 4 mermaid**: emit the full canvas mermaid with:
- The `subgraph path_1b[...]` block deleted
- The `kinesis -->|"Streaming"| compute` and `compute -->|"Streaming"|
  snowpipe_streaming` edges deleted
- The `prod_app -->|"Streaming"| kinesis` edge deleted
- The `badge_1b ~~~ path_1b` line deleted
- The `badge_1b([...]):::laneBadge` declaration deleted
- Every other line preserved byte-identical

**Your response — JSON**: same nodes/edges, with the kinesis-related
entries removed. Don't reorder the rest.

### Example B — Rename a node

**User**: "Rename Producer App to Web App"

**Edit**: change every occurrence of the label `"Producer App"` (display
text) but leave the id `prod_app` unchanged. In the JSON, update the
`label` field but keep the `id`.

### Example C — Replace a component

**User**: "Replace Snowpipe with Snowpipe Streaming for the S3 path"

**Edit**: in the relevant subgraph and edges, swap the node id
`snowpipe` → `snowpipe_streaming` ONLY for the S3 lane. If the diagram
already has a separate `snowpipe_streaming` node, redirect the S3 edges
to it and delete the `snowpipe` node only if no other edges reference
it.

### Example D — Add a component

**User**: "Add Cortex Search consuming the Gold tables"

**Edit**:
- Add `cortex_search["Cortex Search Service"]` inside the appropriate
  Snowflake subgraph (if there's a Section 5 / consumption subgraph,
  put it there).
- Add an edge: `gold_tables -->|"Index"| cortex_search`
- Add corresponding JSON entry: `{"id":"cortex_search","label":"Cortex
  Search Service","componentType":"sf_cortex_search","boundary":"snowflake"}`
- Add the edge JSON: `{"from":"gold_tables","to":"cortex_search","label":"Index"}`

## Edge cases

- **User asks for an impossible / nonsensical edit** (e.g. "remove
  Snowflake Account"): respond conversationally, explain why, suggest
  alternatives. Do not emit Sections 1-5 or a mermaid block.
- **User's edit affects multiple sections** (e.g. "remove all batch
  paths" — touches lane 1c subgraph + multiple edges + the section 2
  snowpipe node): apply all changes coherently in one response. If a
  side-effect would orphan a section header / badge, remove that too.
- **User asks something ambiguous** ("clean it up"): ask one clarifying
  question; do NOT guess. Do not emit Sections 1-5 in that turn.

## Why the canvas-preservation matters

The frontend's `parseMermaidAndCreateDiagram` re-runs ELK layout on every
render, so manually-dragged positions are lost on each agent response.
Preserving every unchanged line means the diff is small, ELK's deterministic
layout produces a similar result, and the user's mental map is preserved.
Re-generating from scratch — even with the same template — produces a
visibly different diagram and confuses the user.
