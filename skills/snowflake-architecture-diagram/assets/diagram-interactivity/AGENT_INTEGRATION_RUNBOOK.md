# Runbook: Add Interactivity to an Agent That Already Generates HTML Diagrams

Goal for **CoCo**: take an existing Cortex agent that **already produces
HTML-based architecture diagrams** and adjust its generation process so the
HTML it emits has **motion** (animated connectors) and **component
highlighting** (hover a node/connector to light up related parts).

Make **no assumptions** about how this agent generates HTML — discover it
first, then apply the smallest change that satisfies the contract below.

Author: Abhinav Bannerjee

## The two hard requirements

A downloadable, standalone HTML file **cannot reference external CSS/JS**, and
the behavior only attaches to a specific markup shape. So adding interactivity
always means satisfying both:

1. **Inline the behavior.** The interactivity CSS+JS must be embedded *inside*
   each generated HTML file — not linked. Use `inject-snippet.html` in this
   folder (a self-contained `<style>`+`<script>` block that auto-attaches on
   load). Regenerate it with `node build_inject.mjs` if you edit the source.
2. **Emit the class/attribute contract.** The generated diagram markup must
   expose hoverable elements (next section). If the agent emits a static SVG
   or a Mermaid image, there is nothing to hover — see "If the markup doesn't
   fit."

## The contract the generated HTML must contain

- Node cards: `<div class="flow-node" data-node-id="<id>"> … </div>`
- A connectors `<svg>` (tag it `data-connectors-svg` to be explicit), with one
  group per edge:
  ```html
  <g class="connector-group" data-source-id="<srcId>" data-target-id="<tgtId>">
    <path class="connector-hit"  d="<path d>"/>   <!-- wide invisible hit area -->
    <path class="connector-path" d="<path d>"/>   <!-- visible animated line  -->
  </g>
  ```
- `data-source-id` / `data-target-id` must match node `data-node-id`s — that
  linkage is what drives cross-highlighting.
- Optional: put `data-diagram-root` on the element that wraps the cards so
  auto-attach targets it precisely.

The inlined snippet auto-detects the svg + container and binds on
`DOMContentLoaded`; with the attributes above it works with zero hand-written
JS in the generated file.

## Steps for CoCo

### 1. Discover the agent's HTML-generation path (do NOT assume)
Find *where* the HTML string is produced. Check, in order:
- the agent spec: is there a custom tool (UDF / stored procedure /
  code-execution) whose job is to return HTML? (`DESCRIBE AGENT …`; inspect
  `tools` / `tool_resources`.)
- the agent's **response/orchestration instructions**: do they tell the model
  to emit an HTML document directly?
- any code-execution script the agent runs to assemble the file.

Record which one it is — that artifact is what you edit.

### 2. Inspect the markup the agent currently emits
Generate one diagram and look at the HTML. Determine:
- Are nodes individual elements with stable ids? Are edges individual `<path>`
  / lines with known source/target?
- Or is it one opaque blob (static `<svg>` with no per-edge grouping, or a
  rendered Mermaid image)?

This decides whether you wire the contract (§3) or restructure (see "If the
markup doesn't fit").

### 3. Make the generator emit the contract + inline the snippet
Edit the discovered generator so every produced file:
- wraps each node in `<div class="flow-node" data-node-id=…>`,
- emits each edge as a `.connector-group` (with `data-source-id`/`-target-id`,
  a `.connector-hit` and a `.connector-path`),
- **concatenates the contents of `inject-snippet.html` immediately before
  `</body>`.**

Per generator type:
- **UDF / stored procedure returning HTML:** embed the snippet text in the
  function (or read it from a stage import) and append it to the HTML it
  builds; ensure its node/edge emit uses the contract classes.
- **Code-execution tool:** have the Python read `inject-snippet.html` (stage
  it or pass it in) and append before `</body>`; emit the contract markup.
- **Model emits HTML from instructions:** add the snippet to the instruction
  template and require the contract classes/attributes in the output spec.

### 4. Edit the agent to make this permanent
Update the agent in place (no drop) so the change sticks:
```sql
DESCRIBE AGENT <DB>.<SCHEMA>.<AGENT>;        -- capture current spec (backup it)
ALTER AGENT <DB>.<SCHEMA>.<AGENT>
  MODIFY LIVE VERSION SET SPECIFICATION = $$ <merged spec> $$;
```
What changes in the spec depends on §1:
- tool-generated HTML → the tool was edited in §3; the spec may be unchanged,
  or you point it at the updated tool.
- instruction-generated HTML → append the contract + "inline this block"
  requirement to `instructions.response`.

### 5. Verify
Generate a diagram, save the HTML, open it in a browser:
- connectors show flowing dashes (motion),
- hovering a connector highlights it + both endpoint cards,
- hovering a card marks it primary and lights up its incident connectors.

## If the markup doesn't fit (static SVG / Mermaid image)
Hover/motion need per-element hooks. If the agent emits a flat SVG or an image:
- preferred: switch the node/edge emit to the DOM+SVG contract above
  (optionally compute positions with the sibling `../layout-engine`), then
  inline the snippet; or
- minimal: post-process the SVG to add `class="connector-path"` +
  `data-source-id/target-id` to edge paths and `data-node-id` to node shapes
  so the snippet can bind. Without one of these, the snippet is inert.

## Caveats
- **Inline only** — never `<link>`/`<script src>` to these files in a
  downloadable HTML; they won't resolve on the recipient's machine.
- **Re-render** — if the generated page re-lays-out connectors dynamically,
  call `SnowGramInteractivity.autoAttach(document)` again after each re-render
  (the snippet binds once on load).
- **Reduced motion** — the CSS already pauses the flow animation under
  `prefers-reduced-motion`.
- **Idempotency** — inject the snippet exactly once per file; a second copy
  double-binds handlers.

## Files in this folder
| File | Role |
|------|------|
| `inject-snippet.html` | the inlinable `<style>`+`<script>` block (auto-attaches) |
| `interactivity.css` / `interactivity.js` | source for the snippet |
| `build_inject.mjs` | regenerates `inject-snippet.html` from the source |
| `demo.html` | standalone proof of the behavior |
| `README.md` | the layer's contract + theming |
