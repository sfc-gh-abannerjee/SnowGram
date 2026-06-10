# SnowGram Layout Engine

A standalone, **DOM-free** "layout math" module extracted from the SnowGram
viewer (`assets/viewer/index.html`). Feed it a graph and it returns node
coordinates and orthogonal edge paths — render them however you like
(SVG, Canvas, ReactFlow, a Streamlit component, etc.).

Author: Abhinav Bannerjee

## Why

The viewer computed all geometry by measuring rendered DOM
(`getBoundingClientRect`). This module reproduces the same pipeline
analytically so it runs **headless** (Node, a browser without a live DOM,
or a Snowflake JS UDF) and emits pure coordinates. Use it to drive
diagrams produced by a Cortex Agent in any account.

## Install / import

Zero dependencies, ES modules:

```js
import { layout } from './index.mjs';
```

## Input (both formats accepted)

**1. Graph metadata JSON** — what the SnowGram agent emits in its
"Graph Metadata (JSON)" block:

```js
layout({
  nodes: [
    { id: 's3', label: 'AWS S3', componentType: 's3', zone: 'External Sources', detail: 'Data lake' },
    { id: 'pipe', label: 'Snowpipe', componentType: 'pipe', zone: 'Ingestion' },
    { id: 'bronze', label: 'Bronze Tables', componentType: 'table', zone: 'Bronze Layer' },
  ],
  edges: [ { from: 's3', to: 'pipe' }, { from: 'pipe', to: 'bronze' } ],
  // zones optional — derived from node.zone when omitted
});
```

Edge keys may be `{from,to}` or `{source,target}`. Node grouping comes from
`zone` (or `boundary`). Category (boundary tinting / inside-vs-outside the
Snowflake Data Cloud) comes from `category`, else inferred from
`componentType`/`boundary`.

**2. Mermaid flowchart** — same string the agent emits in its ` ```mermaid `
block:

```js
layout({ mermaid: 'flowchart LR\n  subgraph Sources\n    A[API]\n  end\n  A --> B' });
// or just: layout('flowchart LR ...')
```

`subgraph` → zone, `classDef`/`class` → category.

## Output

```js
{
  nodes: [{ id, label, zone, x, y, w, h }],         // top-left origin
  edges: [{ from, to, points: [[x,y]...], d: "M...", markerId }],
  zones: [{ name, x, y, w, h, category }],
  platformBoundary: { x, y, w, h } | null,          // Snowflake Data Cloud box
  width, height,
}
```

`d` is a ready-to-use SVG path string; `points` is the same path as an array
if you want to render with something else. `markerId` is one of
`arrowhead` / `arrowhead-left` / `arrowhead-right` (direction-locked).

## Options

```js
layout(input, {
  measureText: (text, fontPx) => widthPx,  // pixel-accurate sizing (see below)
  cardWidth: 160,                          // override node card width
  consolidate: true,                       // merge "Ingestion AWS"+"...Azure" zones
  consolidate_sub_groups: false,           // render merged zones as sub-columns
});
```

## Determinism & fidelity

- **Deterministic:** same input → identical output across runs (verified in
  tests). No randomness, no DOM, no timing.
- **Fidelity caveat:** node sizing uses an average-glyph-width heuristic to
  estimate text wrapping, so coordinates are **close but not pixel-identical**
  to the browser viewer. For exact parity, inject a real text measurer:

  ```js
  // browser
  const ctx = document.createElement('canvas').getContext('2d');
  layout(input, { measureText: (t, px) => { ctx.font = px + 'px sans-serif'; return ctx.measureText(t).width; } });
  ```

## What it ports (and what it doesn't)

Ported faithfully from the viewer:
- zone consolidation (CSP qualifier merging)
- zone rank/column assignment (longest-path DAG, cycle breaking, orphan
  pull-in, same-rank de-collision)
- platform-boundary wrapping + dynamic inter-zone gap (bridge density)
- the full edge router: H-V-H / V-H-V, U-shape obstacle detours, bridged
  H-V-H-V-H fan-out/fan-in routes, inter-row channels, rail clearance, and
  V-H crossing "line jumps".

Not included (presentation, not layout): colors, icons, fonts, hover
interactions, export. Icons don't affect geometry (cards reserve a fixed
icon box), so they're intentionally out of scope.

## Cortex Agent integration

The engine ships as a **Snowflake JavaScript scalar UDF custom tool** —
the documented way to give a Cortex Agent custom logic (Cortex Agents docs:
"Custom tools built from stored procedures and UDFs"). A scalar UDF that
returns a JSON string is the best-practice shape: deterministic, reusable,
governed by Snowflake privileges, and consistent with the other
`SNOWGRAM_DB.CORE.*` tool functions (no Python sandbox or extra deps needed).

**1. Build + deploy the UDF**

```bash
node build_udf.mjs          # bundles *.mjs -> deploy/LAYOUT_DIAGRAM.sql
```
Then run `deploy/LAYOUT_DIAGRAM.sql` on the target account. It creates
`SNOWGRAM_DB.CORE.LAYOUT_DIAGRAM(GRAPH_JSON VARCHAR) RETURNS VARCHAR`.
The SQL is generated from the `.mjs` modules (single source of truth) — edit
the modules and re-run the build, never hand-edit the SQL.

**2. Register it as an agent tool** (add to the agent spec):

```yaml
tools:
  - tool_spec:
      type: generic
      name: LAYOUT_DIAGRAM
      description: |
        Computes deterministic node positions and orthogonal edge paths for an
        architecture diagram. Pass the Graph Metadata JSON you produced
        (nodes + edges) as a JSON string. Returns JSON with positioned nodes
        ({id,x,y,w,h}), edge paths ({from,to,d,points}), zones, and canvas
        size. Call AFTER producing the graph to get render-ready coordinates.
      input_schema:
        type: object
        properties:
          GRAPH_JSON:
            description: JSON string of {nodes:[{id,label,componentType,boundary}], edges:[{from,to}]} OR a mermaid string.
            type: string
        required:
          - GRAPH_JSON

tool_resources:
  LAYOUT_DIAGRAM:
    type: function
    identifier: SNOWGRAM_DB.CORE.LAYOUT_DIAGRAM
    execution_environment:
      type: warehouse
      warehouse: COMPUTE_WH
```

**Why a UDF tool (not the code-execution sandbox):** the agent's Python
code-execution tool is single-session and non-deterministic to reproduce; a
registered UDF gives a stable, versioned, privilege-governed contract the
agent calls the same way every time — which matches the diagram pipeline's
determinism goal.

**Engine compatibility:** the bundle is restricted to JS the Snowflake UDF
engine accepts (no spread-in-call, no object spread, no optional chaining).
The build's Node smoke-test confirms the bundled body produces byte-identical
output to `layout()`. NOTE: `CREATE FUNCTION` compilation could not be
verified against the source account in this environment (write-guard); run
the generated SQL once on the target to confirm, then `SELECT
SNOWGRAM_DB.CORE.LAYOUT_DIAGRAM('{"nodes":[...],"edges":[...]}')`.

## Test

```bash
node tests/run.mjs
```

Checks determinism, geometry validity, platform-boundary containment, and
the **0 card-crossings** routing invariant across medallion, mermaid, and a
fan-out/fan-in + skip-zone stress fixture.

## Files

| File | Role |
|------|------|
| `index.mjs` | public `layout()` API |
| `model.mjs` | mermaid + graph-JSON front-ends → internal model |
| `measure.mjs` | deterministic node sizing (text heuristic + hook) |
| `pack.mjs` | zone consolidation, ranks/columns, rect geometry, row alignment |
| `route.mjs` | DOM-free port of the orthogonal/bridged edge router |
| `constants.mjs` | sizing constants from the viewer CSS |
| `tests/run.mjs` | headless test harness |
| `build_udf.mjs` | bundles the modules into the Cortex Agent UDF + smoke-tests it |
| `deploy/LAYOUT_DIAGRAM.sql` | generated `LANGUAGE JAVASCRIPT` scalar UDF (agent custom tool) |
