# Runbook: Make SnowGram HTML Diagrams Interactive

Self-contained interactivity layer — **motion** (animated flowing connectors)
and **component highlighting** (hover a node or connector to light up the
related parts) — extracted from the SnowGram viewer. Drop this folder next to
any rendered diagram and wire it up; no build step, no dependencies.

Author: Abhinav Bannerjee

## Files (everything needed is in this folder)

| File | Role |
|------|------|
| `interactivity.css` | motion (`@keyframes connector-flow`) + highlight styles + themable CSS vars |
| `interactivity.js` | `attachDiagramInteractivity(container, svg)` — hover wiring, returns a `detach()` |
| `demo.html` | standalone, openable proof (hover cards / connectors) |
| `README.md` | this runbook |

## What it does

- **Motion:** each `.connector-path` is a dashed line whose dashes animate
  toward the target (`connector-flow`). Paused for `prefers-reduced-motion`.
- **Connector hover:** highlights that connector (accent color, solid,
  thicker) and both endpoint cards.
- **Node hover:** marks the node *primary* (distinct color) and highlights
  every connector touching it plus those connectors' far endpoints.

## Required class / attribute contract

The JS and CSS operate on this structure (exactly what the SnowGram renderer
and the `layout-engine` output produce):

- A **container** element holding the node cards.
- Node cards: `<div class="flow-node" data-node-id="<id>">…</div>`
- An **`<svg>`** holding the connectors. Each edge is:
  ```html
  <g class="connector-group" data-source-id="<srcId>" data-target-id="<tgtId>">
    <path class="connector-hit"  d="<path d>"/>   <!-- wide invisible hit area -->
    <path class="connector-path" d="<path d>"/>   <!-- visible animated line  -->
  </g>
  ```
- `data-source-id` / `data-target-id` on each group must match the
  `data-node-id` of the cards they connect — that's how hover cross-highlights.

## Steps to apply

1. **Include the CSS** in the page `<head>`:
   ```html
   <link rel="stylesheet" href="interactivity.css">
   ```
2. **Include the JS** (after the diagram markup, or before and call on load):
   ```html
   <script src="interactivity.js"></script>
   ```
3. **Attach after the diagram is in the DOM:**
   ```js
   const detach = attachDiagramInteractivity(containerEl, connectorsSvgEl);
   ```
   - `containerEl` = the element containing the `.flow-node` cards.
   - `connectorsSvgEl` = the `<svg>` containing the `.connector-group`s.
4. **On re-render** (e.g. you recompute layout/resize), call `detach()` first,
   rebuild the SVG/cards, then `attachDiagramInteractivity(...)` again. This
   avoids duplicate listeners.

## Pairing with the layout engine

If you generate geometry with `../layout-engine` (`layout()` →
`{ nodes:[{id,x,y,w,h}], edges:[{from,to,d}] }`):
- render each node as `<div class="flow-node" data-node-id={id}>` positioned at
  `(x,y)`,
- render each edge as a `.connector-group` with `data-source-id={from}`,
  `data-target-id={to}`, a `.connector-hit` and a `.connector-path` both using
  the edge's `d`,
- then call `attachDiagramInteractivity(container, svg)`.

The layout engine produces the geometry; this layer adds the motion + hover
behavior on top.

## Theming

Override the CSS variables (on `:root` or any ancestor):
```css
:root {
  --connector-color: #8aa0b4;  /* idle line */
  --accent:          #6cb9ff;  /* connected/highlighted */
  --primary-hover:   #ffb454;  /* the hovered element */
}
```

## Verify

Open `demo.html` in a browser. You should see three dashed connectors with
flowing dashes; hovering any card or connector highlights the related cards
and lines.
