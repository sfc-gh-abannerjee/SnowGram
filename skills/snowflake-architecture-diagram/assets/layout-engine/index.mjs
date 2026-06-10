// index.mjs — public API for the SnowGram layout engine.
//
//   import { layout } from './index.mjs';
//   const result = layout(input, opts);
//
// input: either
//   - a mermaid string, OR
//   - { mermaid: "flowchart LR ..." }, OR
//   - { nodes:[{id,label,componentType?,boundary?,zone?,category?,detail?}],
//       edges:[{from,to}|{source,target}], zones? }
//
// opts:
//   - measureText(text, fontPx) -> widthPx   (optional; pixel-accurate sizing)
//   - cardWidth                              (optional; override card width)
//   - consolidate / consolidate_sub_groups   (zone consolidation toggles)
//
// returns:
//   {
//     nodes: [{ id, label, zone, x, y, w, h }],
//     edges: [{ from, to, points:[[x,y]...], d:"M...", markerId }],
//     zones: [{ name, x, y, w, h, category }],
//     platformBoundary: { x, y, w, h } | null,
//     width, height
//   }

import { toModel } from './model.mjs';
import { pack } from './pack.mjs';
import { route } from './route.mjs';

export function layout(input, opts = {}) {
  const model = toModel(input);
  // pass consolidation toggles through to the model if given in opts
  if (opts.consolidate === false) model.consolidate = false;
  if (opts.consolidate_sub_groups === true) model.consolidate_sub_groups = true;

  const packed = pack(model, opts);
  const edges = route(model, packed, opts);

  const zoneByName = {};
  packed.zoneRects.forEach(z => { zoneByName[z.name] = z; });
  const zoneCategory = {};
  packed.zones.forEach(z => { zoneCategory[z.name] = z.category; });

  return {
    nodes: packed.nodeRects.map(n => ({
      id: n.id,
      zone: n.zoneName,
      x: n.left, y: n.top, w: n.right - n.left, h: n.bottom - n.top,
    })),
    edges: edges.map(e => ({ from: e.source, to: e.target, points: e.points, d: e.d, markerId: e.markerId })),
    zones: packed.zoneRects.map(z => ({
      name: z.name, x: z.left, y: z.top, w: z.right - z.left, h: z.bottom - z.top,
      category: zoneCategory[z.name],
    })),
    platformBoundary: packed.platformBoundary ? {
      x: packed.platformBoundary.left, y: packed.platformBoundary.top,
      w: packed.platformBoundary.right - packed.platformBoundary.left,
      h: packed.platformBoundary.bottom - packed.platformBoundary.top,
    } : null,
    width: packed.width, height: packed.height,
  };
}

export { toModel, fromGraphJSON, fromMermaid } from './model.mjs';
export default layout;
