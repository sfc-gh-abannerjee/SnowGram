# Runbook: Add a Documentation/Citations Panel Below an Agent's Diagrams

Goal for **CoCo**: make a Cortex agent that already produces HTML diagrams
attach the **docs it gathered** as a "Documentation" panel **below the
diagram** — matching how the SnowGram skill/viewer does it.

Make **no assumptions** about the agent's internals. The whole feature reduces
to one data contract plus an inlinable render snippet.

Author: Abhinav Bannerjee

## The contract (this is the whole feature)

A citation is:
```json
{ "url": "https://docs.snowflake.com/...", "title": "Snowpipe", "excerpt": "short description" }
```
The renderer consumes an **array of these**. Everything the agent gathers must
end up in that array; the panel renders it below the diagram. `excerpt` is
optional.

## How the skill does it (reference flow)

1. **Gather** — docs are resolved per component and attached to each node as
   `doc_url` (via `docs_resolver` / canonical-URL maps / a knowledge pack's
   `doc_citations`).
2. **Collapse** — `flow_builder.build_citations(nodes)` dedupes by `doc_url`
   and emits `{ url, title: label, excerpt: detail }`; pack `doc_citations`
   are appended. Result: a top-level `state.citations` array.
3. **Render** — the viewer's `renderCitations(state.citations)` fills a
   `.citations` → `#citations-list` panel that sits **after** the diagram card.

This folder packages steps 2–3 as drop-in, dependency-free code.

## Files (everything is in this folder)

| File | Role |
|------|------|
| `inject-citations.html` | inlinable `<style>`+`<script>` that **auto-renders** the panel below the diagram |
| `citations.css` / `citations.js` | source (`buildCitations`, `renderCitations`, auto-render) |
| `build_inject.mjs` | regenerates `inject-citations.html` from source |
| `demo.html` | standalone proof |
| `README.md` (this) | the contract + runbook |

## Steps for CoCo

### 1. Discover where the agent emits HTML (don't assume)
Same as other runbooks: is the HTML built by a custom tool (UDF / stored proc
/ code-execution) or emitted directly from the agent's response instructions?
`DESCRIBE AGENT …` and inspect. That artifact is what you edit.

### 2. Make the agent gather docs into the contract
Wherever the agent already gets documentation (e.g. the `snowflake_docs` /
`arch_patterns` Cortex Search tools, or per-node `doc_url`s), normalize the
results to the citation array `[{url, title, excerpt}]`. Two ways:
- **From search hits:** map each hit → `{ url: source_url, title: document_title, excerpt: chunk_summary }`, dedupe by `url`.
- **From nodes with `doc_url`:** call `SnowGramCitations.buildCitations(nodes)`
  (client-side) to derive the array.

### 3. Emit the data + inline the snippet in the generated HTML
In the generated diagram HTML, before `</body>`:
1. Emit the citation data as a JSON script tag (or set the global):
   ```html
   <script type="application/json" data-diagram-citations>
     [{"url":"…","title":"…","excerpt":"…"}]
   </script>
   ```
   (or `<script>window.__DIAGRAM_CITATIONS = [ … ];</script>`)
2. **Inline the contents of `inject-citations.html`.**

On load the snippet reads that data and appends a `.citations`
("Documentation") panel **below** the element marked `[data-diagram-root]`
(or `.diagram-card`, else end of body) — no hand-written render code needed.

Per generator type:
- **UDF / stored procedure / code-execution:** embed (or stage-read) the
  snippet, append it + the JSON data tag to the HTML it returns.
- **Model emits HTML from instructions:** add to `instructions.response` the
  requirement to (a) include the gathered docs as a `data-diagram-citations`
  JSON tag and (b) inline this snippet before `</body>`.

### 4. Edit the agent to make it permanent (in place, no drop)
```sql
DESCRIBE AGENT <DB>.<SCHEMA>.<AGENT>;          -- capture + back up the live spec
ALTER AGENT <DB>.<SCHEMA>.<AGENT>
  MODIFY LIVE VERSION SET SPECIFICATION = $$ <merged spec> $$;
```
Change scope depends on §1 (tool edited vs instructions updated).

### 5. Verify
Generate a diagram, open the HTML: a "Documentation" section appears below the
diagram, one linked entry per gathered doc, with optional excerpts. No docs
gathered → the panel simply doesn't appear (auto-render no-ops when there's no
data).

## Caveats
- **Inline only** — a downloadable HTML can't `<link>`/`<script src>` to these
  files; embed the snippet.
- **Dedupe** — collapse repeated URLs (the skill dedupes by `doc_url`); the
  panel renders whatever array you give it.
- **Placement** — mark the diagram wrapper `data-diagram-root` for exact
  placement; otherwise the panel attaches after `.diagram-card` or at body end.
- **Composes with the siblings** — `../diagram-interactivity` (motion +
  highlighting) and `../layout-engine` (geometry) are independent; inline any
  combination of their snippets.
