-- =====================================================================
-- SNOWGRAM_DB.CORE.LAYOUT_DIAGRAM  (Cortex Agent custom tool)
-- =====================================================================
-- AUTO-GENERATED from assets/layout-engine/*.mjs by build_udf.mjs.
-- DO NOT EDIT BY HAND — edit the .mjs modules and re-run the build.
-- Author: Abhinav Bannerjee
--
-- Scalar JavaScript UDF the Cortex Agent calls as a custom tool. Accepts
-- the agent's emitted Graph Metadata JSON (or a mermaid string) and returns
-- positioned nodes + orthogonal edge paths as a JSON string.
--
-- Agents support scalar UDFs as custom tools; this returns VARCHAR (JSON)
-- so the agent receives a single string value (consistent with the other
-- SNOWGRAM_DB.CORE.* tool functions).
-- =====================================================================

CREATE OR REPLACE FUNCTION SNOWGRAM_DB.CORE.LAYOUT_DIAGRAM(GRAPH_JSON VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Deterministic diagram layout engine: graph (nodes/edges or mermaid) -> positioned nodes + orthogonal edge paths as JSON. Cortex Agent custom tool.'
AS $$
// ===== constants.mjs =====
// constants.mjs — geometry constants extracted from the viewer CSS.
//
// These mirror the `.zone .flow-node`, `.zone-*`, `.rank-column`,
// `.platform-boundary` and `.arch-layout` rules in
// assets/viewer/index.html (the <style> block). They drive the
// DOM-free deterministic geometry model in pack.mjs, replacing the
// browser layout the original engine measured via getBoundingClientRect.
//
// NOTE: pixel-exact parity with the browser viewer is NOT guaranteed —
// text wrapping is approximated (see measure.mjs). Coordinates are
// internally consistent and deterministic, which is what the routing
// math needs.

const CARD = {
  // .zone .flow-node — padding: 16px 12px 14px
  padTop: 16,
  padRight: 12,
  padBottom: 14,
  padLeft: 12,
  // Effective track width of a card inside a zone column. The viewer uses
  // minmax(140px,1fr)/minmax(150px,1fr) + min-content; 160 is a stable
  // representative width that keeps labels off the icon.
  width: 160,
  // .icon — clamp(28,60%,44) box + margin-bottom 6
  iconBox: 44,
  iconMarginBottom: 6,
  // .label — font ~12.5px, line-height ~1.25, margin-bottom 2
  labelFont: 12.5,
  labelLineHeight: 1.25,
  labelMarginBottom: 2,
  // .detail — font ~10.5px, line-height 1.4
  detailFont: 10.5,
  detailLineHeight: 1.4,
};

// CARD_WIDE — icon-left (wide) card geometry. The icon sits BESIDE the text
// (not stacked above it), so card height is pad + max(icon, text) + pad rather
// than pad + icon + text + pad. Tuned to match the renderer's `.nodes-wide`
// CSS (icon-size 26 + icon-pad 6 -> 38px content box; node padding 8). Keep
// these in sync with render_diagram's _THEME_CSS .nodes-wide rules so the
// rendered card fills the engine-sized box (see plan Phase 3).
const CARD_WIDE = {
  padTop: 8,
  padRight: 12,
  padBottom: 8,
  padLeft: 12,
  width: 160,            // same column width as narrow; wrapWidth subtracts icon+gap
  iconBox: 38,           // rendered fn-ico content box (--icon-size 26 + --icon-pad 6)
  iconGap: 10,           // horizontal gap between icon and text
  labelFont: 12.5,
  labelLineHeight: 1.2,
  labelMarginBottom: 1,
  detailFont: 10,
  detailLineHeight: 1.3,
};

const ZONE = {
  border: 1.5,
  stripe: 4, // .zone-stripe height
  headerMinHeight: 68, // .zone-header min-height
  bodyPad: 20, // .zone-body padding
  rowGap: 18, // vertical gap between cards stacked in a zone column
  subColGap: 20, // .sub-group-col grid column gap
  fanoutColGap: 24, // intra-zone fan-out column gap
  subColMinWidth: 150,
  fanoutColMinWidth: 140,
};

const LAYOUT = {
  outerColGap: 72, // .arch-layout gap (between non-boundary columns)
  rankColGap: 20, // .rank-column vertical gap (multi-zone column)
  // dynamic inner-grid gap inside the platform boundary
  dynGapBase: 48,
  dynGapStep: 14,
  dynGapCap: 96,
  // .platform-boundary border:2 dashed; padding:28px 24px 64px
  boundaryBorder: 2,
  boundaryPadTop: 28,
  boundaryPadSide: 24,
  boundaryPadBottom: 64,
  // outside-boundary columns get paddingTop:30 to align zone tops with
  // the boundary's border+padding inset.
  outsidePadTop: 30,
  // ── row-wrapping (Phase 1) ──
  // When the running row width would exceed this, wrap remaining placement
  // units (outside columns, and the whole platform-boundary block) onto a
  // new row instead of growing the canvas unboundedly to the right. Keeps
  // the canvas a sane 2D shape regardless of node/zone count. Override via
  // opts.maxCanvasWidth.
  maxCanvasWidth: 1600,
  rowWrapGap: 56,
  // ── nested containers (Phase 2) ──
  // Arbitrary user-defined grouping boxes (e.g. "AWS VPC", "On-Prem Data
  // Center") that wrap a set of zones and/or other containers, recursively.
  // Deliberately separate from the boundary* constants above so a render
  // engine can style them distinctly (e.g. dashed vs. solid, different
  // color) without affecting the Snowflake platform boundary itself.
  containerBorder: 2,
  containerHeaderH: 22, // reserved label-stripe height (render engine draws the name here)
  containerPadTop: 14,
  containerPadSide: 18,
  containerPadBottom: 18,
};

// Categories considered INSIDE the Snowflake Data Cloud boundary.
const SNOW_CATEGORIES = { snow: 1, outcome: 1, bridge: 1 };

// Zone-consolidation qualifier whitelist (see renderFlow consolidation pass).
const QUALIFIERS = {
  aws: 1, azure: 1, gcp: 1, oci: 1,
  east: 1, west: 1, us: 1, eu: 1, apac: 1,
  primary: 1, secondary: 1, dr: 1,
};


// ===== measure.mjs =====
// measure.mjs — deterministic, DOM-free text + node sizing.
//
// The original engine let the browser lay out each card and read sizes
// back via getBoundingClientRect. Here we compute card width/height
// analytically from the CSS constants in constants.mjs.
//
// Text width is approximated with an average-glyph-width heuristic by
// default. For pixel-accurate sizing in a browser (or node-canvas),
// inject a `measureText(text, fontPx) -> widthPx` function via opts.
//
// Wrapping mirrors the CSS `word-break: break-word; overflow-wrap:
// anywhere` — i.e. text wraps at the content width regardless of word
// boundaries, so line count is ceil(totalGlyphWidth / wrapWidth).


// Average glyph width as a fraction of font size for the UI font stack.
// Tuned to a mid value for a typical sans-serif; close enough for line
// counts without a real text metric.
const AVG_GLYPH_RATIO = 0.52;

function defaultMeasureText(text, fontPx) {
  if (!text) return 0;
  return String(text).length * fontPx * AVG_GLYPH_RATIO;
}

// Number of wrapped lines for `text` at `fontPx` within `wrapWidth`.
function lineCount(text, fontPx, wrapWidth, measureText) {
  if (!text) return 0;
  const w = measureText(text, fontPx);
  if (w <= wrapWidth) return 1;
  return Math.max(1, Math.ceil(w / wrapWidth));
}

// Compute { w, h } for a single node card given its label + detail.
function measureNode(node, opts = {}) {
  const measureText = opts.measureText || defaultMeasureText;
  if (opts.nodeStyle === 'wide') return measureNodeWide(node, opts, measureText);

  const w = opts.cardWidth || CARD.width;
  const wrapWidth = w - CARD.padLeft - CARD.padRight;

  const labelLineH = CARD.labelFont * CARD.labelLineHeight;
  const detailLineH = CARD.detailFont * CARD.detailLineHeight;

  const labelLines = lineCount(node.label, CARD.labelFont, wrapWidth, measureText);
  const detailLines = lineCount(node.detail, CARD.detailFont, wrapWidth, measureText);

  const iconH = CARD.iconBox + CARD.iconMarginBottom;
  const labelH = labelLines * labelLineH + (labelLines ? CARD.labelMarginBottom : 0);
  const detailH = detailLines * detailLineH;

  const h = CARD.padTop + iconH + labelH + detailH + CARD.padBottom;
  return { w, h: Math.round(h) };
}

// Wide (icon-left) card: icon sits BESIDE the text, so height is
// pad + max(icon, label+detail) + pad — not the stacked sum. The text column
// is the card width minus the icon, gap, and side padding.
function measureNodeWide(node, opts, measureText) {
  const C = CARD_WIDE;
  const w = opts.cardWidth || C.width;
  const wrapWidth = w - C.padLeft - C.padRight - C.iconBox - C.iconGap;

  const labelLineH = C.labelFont * C.labelLineHeight;
  const detailLineH = C.detailFont * C.detailLineHeight;

  const labelLines = lineCount(node.label, C.labelFont, wrapWidth, measureText);
  const detailLines = lineCount(node.detail, C.detailFont, wrapWidth, measureText);

  const labelH = labelLines * labelLineH + (labelLines && detailLines ? C.labelMarginBottom : 0);
  const detailH = detailLines * detailLineH;
  const textH = labelH + detailH;

  const h = C.padTop + Math.max(C.iconBox, textH) + C.padBottom;
  return { w, h: Math.round(h) };
}


// ===== model.mjs =====
// model.mjs — input front-ends. Both accepted:
//   1. Graph metadata JSON: { nodes:[{id,label,componentType?,boundary?,
//      zone?,category?,detail?}], edges:[{from,to}|{source,target}], zones?,
//      containers?:[{id,label,zone_names?,node_ids?,container_ids?}] }
//   2. Mermaid flowchart string: { mermaid: "flowchart LR ..." }
//
// Both normalize to the internal model the layout consumes:
//   { nodes:[{id,label,detail,category,zone}], edges:[{source,target}],
//     zones:[{name,category,node_ids}], containers:[{id,label,zone_names,
//     node_ids,container_ids}], consolidate, consolidate_sub_groups }
//
// `containers` (Phase 2) are optional, arbitrary-depth grouping boxes (e.g.
// "AWS VPC", "On-Prem Data Center") layered ON TOP of zones: a container
// declares which zones (by name) and/or which OTHER containers (by id, for
// nesting) it wraps. They do not replace zones -- pack.mjs resolves the
// actual geometry; this layer only carries the declared membership through
// unchanged, dropping anything malformed rather than throwing.
//
// Geometry note: node `icon` does NOT affect layout (the card always
// reserves a fixed icon box height), so icon resolution is intentionally
// omitted here — only `category` (boundary tinting / snow-vs-external)
// and `zone` (grouping) matter to the math.

const CATEGORY_BY_TYPE = {
  // external (outside the Snowflake boundary)
  s3: 'onprem', kafka: 'onprem', kinesis: 'onprem', azure_blob: 'onprem',
  gcs: 'onprem', api: 'onprem', saas: 'onprem', external: 'onprem',
  oltp: 'onprem', database: 'onprem', bi_tool: 'outcome',
  // bridge (Snowflake-managed ingestion)
  pipe: 'bridge', snowpipe: 'bridge', openflow: 'bridge', connector: 'bridge',
  // snow (native)
  table: 'snow', dynamic_table: 'snow', view: 'snow', stream: 'snow',
  task: 'snow', warehouse: 'snow', stage: 'snow', schema: 'snow',
  cortex: 'snow', snowpark: 'snow', iceberg: 'snow',
  // outcome (native consumers)
  dashboard: 'outcome', app: 'outcome', agent: 'outcome', notebook: 'outcome',
};

function categoryFrom(node) {
  if (node.category) return node.category;
  const t = String(node.componentType || node.object_type || '').toLowerCase();
  if (CATEGORY_BY_TYPE[t]) return CATEGORY_BY_TYPE[t];
  // boundary hint: 'external'/'outside' -> onprem; default snow
  const b = String(node.boundary || '').toLowerCase();
  if (b.includes('external') || b.includes('outside') || b.includes('source')) return 'onprem';
  return 'snow';
}

// Ensure zones exist and node_ids are populated (mirrors the viewer's
// defensive backfill).
function normalize(model) {
  const nodes = (model.nodes || []).map(n => ({
    id: n.id,
    label: n.label != null ? n.label : n.id,
    detail: n.detail || '',
    category: categoryFrom(n),
    zone: n.zone || n.boundary || 'Main',
  }));
  const edges = (model.edges || []).map(e => ({
    source: e.source != null ? e.source : e.from,
    target: e.target != null ? e.target : e.to,
  })).filter(e => e.source != null && e.target != null);

  let zones = Array.isArray(model.zones) && model.zones.length
    ? model.zones.map(z => ({
        name: z.name,
        category: z.category,
        node_ids: Array.isArray(z.node_ids) ? z.node_ids.slice() : null,
        sub_groups: z.sub_groups || null,
      }))
    : null;

  if (!zones) {
    // Derive zones from node.zone, preserving first-seen order.
    const order = [];
    const byZone = {};
    nodes.forEach(n => {
      if (!byZone[n.zone]) { byZone[n.zone] = []; order.push(n.zone); }
      byZone[n.zone].push(n.id);
    });
    zones = order.map(name => ({
      name,
      category: nodes.find(n => n.zone === name).category,
      node_ids: byZone[name],
      sub_groups: null,
    }));
  } else {
    // backfill node_ids + category
    zones.forEach(z => {
      if (!z.node_ids || !z.node_ids.length) {
        z.node_ids = nodes.filter(n => n.zone === z.name).map(n => n.id);
      }
      if (!z.category) {
        const first = nodes.find(n => z.node_ids.includes(n.id));
        z.category = first ? first.category : 'snow';
      }
    });
  }

  const nodeIdSet = {}; nodes.forEach(n => { nodeIdSet[n.id] = true; });
  const containers = Array.isArray(model.containers)
    ? model.containers
        .filter(c => c && c.id != null)
        .map(c => ({
          id: String(c.id),
          label: c.label != null ? c.label : String(c.id),
          zone_names: Array.isArray(c.zone_names) ? c.zone_names.slice() : [],
          node_ids: Array.isArray(c.node_ids) ? c.node_ids.filter(id => nodeIdSet[id]) : [],
          container_ids: Array.isArray(c.container_ids) ? c.container_ids.map(String) : [],
        }))
    : [];

  return {
    nodes, edges, zones, containers,
    consolidate: model.consolidate !== false,
    consolidate_sub_groups: model.consolidate_sub_groups === true,
    nodeStyle: model.nodeStyle || null,
  };
}

function fromGraphJSON(model) {
  return normalize(model);
}

// Minimal mermaid flowchart parser. Handles:
//   - node decls: A[Label]  A("Label")  A{Label}  A[("Label")]
//   - edges: A --> B   A -->|label| B   A --- B
//   - subgraph NAME ... end  -> zone grouping
//   - classDef NAME ...; class A,B NAME -> category (sf/snow/etc.)
function fromMermaid(src) {
  const lines = String(src || '').split('\n');
  const nodes = {};
  const edges = [];
  const order = [];
  const zoneStack = [];
  const nodeZone = {};
  const classOf = {};
  const classCategory = {};

  const declRe = /([A-Za-z0-9_]+)\s*(?:\[\(?"?(.*?)"?\)?\]|\("?(.*?)"?\)|\{"?(.*?)"?\})/;
  const edgeRe = /([A-Za-z0-9_]+)\s*(?:--|==|-\.)>?(?:\|([^|]*)\|)?\s*-?-?>?\s*([A-Za-z0-9_]+)/;

  function ensure(id, label) {
    if (!nodes[id]) { nodes[id] = { id, label: label || id, detail: '' }; order.push(id); }
    else if (label) nodes[id].label = label;
    if (zoneStack.length) nodeZone[id] = zoneStack[zoneStack.length - 1];
  }

  for (let raw of lines) {
    const line = raw.trim();
    if (!line || /^(flowchart|graph)\b/i.test(line)) continue;

    let m;
    if (/^subgraph\b/i.test(line)) {
      // subgraph Id [Title]  OR  subgraph Title
      const sm = line.match(/^subgraph\s+(?:[A-Za-z0-9_]+\s*\[\s*"?(.*?)"?\s*\]|"?(.*?)"?)\s*$/i);
      const name = (sm && (sm[1] || sm[2])) ? (sm[1] || sm[2]) : ('Zone ' + (zoneStack.length + 1));
      zoneStack.push(name.trim());
      continue;
    }
    if (/^end$/i.test(line)) { zoneStack.pop(); continue; }
    if (/^classDef\b/i.test(line)) {
      const cm = line.match(/^classDef\s+([A-Za-z0-9_]+)/i);
      if (cm) classCategory[cm[1]] = inferCategory(cm[1], line);
      continue;
    }
    if (/^class\b/i.test(line)) {
      const cm = line.match(/^class\s+([^ ]+)\s+([A-Za-z0-9_]+)/i);
      if (cm) cm[1].split(',').forEach(id => { classOf[id.trim()] = cm[2]; });
      continue;
    }

    // edge line (may also declare both endpoints with labels)
    if ((m = line.match(edgeRe)) && /-|=|>/.test(line)) {
      const a = line.match(new RegExp('^\\s*' + declRe.source));
      // declare endpoints with any inline labels
      const parts = line.split(/--+>?|==+>?|-\.->?/);
      // fall through to generic: capture both ids + their labels via declRe scan
    }

    // Generic: find all node declarations on the line
    let scan = line;
    let dm;
    const declGlobal = new RegExp(declRe.source, 'g');
    while ((dm = declGlobal.exec(scan)) !== null) {
      const id = dm[1];
      const label = dm[2] || dm[3] || dm[4] || '';
      ensure(id, label);
    }

    // Edge endpoints
    const em = line.match(edgeRe);
    if (em && (line.includes('>') || line.includes('---'))) {
      const s = em[1], t = em[3];
      ensure(s);
      ensure(t);
      if (s && t && s !== t) edges.push({ source: s, target: t });
    }
  }

  const nodeArr = order.map(id => {
    const cls = classOf[id];
    const category = cls && classCategory[cls] ? classCategory[cls] : 'snow';
    return {
      id,
      label: nodes[id].label,
      detail: '',
      category,
      zone: nodeZone[id] || 'Main',
    };
  });

  return normalize({ nodes: nodeArr, edges });
}

function inferCategory(className, line) {
  const c = (className + ' ' + line).toLowerCase();
  if (/onprem|external|source|kafka|s3/.test(c)) return 'onprem';
  if (/bridge|pipe|openflow/.test(c)) return 'bridge';
  if (/outcome|bi|dashboard|consum/.test(c)) return 'outcome';
  return 'snow';
}

// Dispatch on input shape.
function toModel(input) {
  if (input == null) throw new Error('layout: input is required');
  if (typeof input === 'string') return fromMermaid(input);
  if (input.mermaid && !(input.nodes && input.nodes.length)) return fromMermaid(input.mermaid);
  return fromGraphJSON(input);
}


// ===== pack.mjs =====
// pack.mjs — DOM-free geometry. Ports the viewer's zone consolidation +
// zone-rank/column DAG + intra-zone column/row assignment, then computes
// deterministic rects to feed the router (replacing getBoundingClientRect).
//
// Output (all coords relative to the diagram-card content origin):
//   {
//     nodeRects: [{id, zoneName, subColIdx, col, rowIdx, left,right,top,bottom}],
//     nodeRectsById, zoneRects: [{name, left,right,top,bottom}],
//     subColRects: [{parentZoneName, nodeIds, left,right,top,bottom}],
//     zoneGaps: [{left,right,center}],
//     platformBoundary: {left,right,top,bottom}|null,
//     rank: {zoneName->rankIdx}, width, height
//   }


// Reduce-based max (avoids spread-in-call, which some Snowflake JS UDF
// engine versions reject when this module is bundled into a UDF).
function maxOf(arr, seed) {
  let m = (seed === undefined ? -Infinity : seed);
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}

// ── Generic row-wrap primitive (Phase 1) ──
// Greedily packs a list of {width,height} items, in order, into rows: a new
// row starts whenever the running row width would exceed maxWidth (never on
// the FIRST item of a row, so one oversized item still makes progress
// instead of looping forever). Mutates each item with .rowIdx/.xInRow and
// returns row Y-offsets + overall size. Used at TWO levels: the outer
// placement (outside columns + the whole platform-boundary block as one
// atomic unit) and, recursively, for the zones packed WITHIN the boundary
// — so a diagram with many nodes all inside one Snowflake account wraps
// just as well as one with many external zones. This is deliberately
// style-agnostic: it only bounds aspect ratio/width, never dictates a
// particular visual arrangement.
function wrapUnits(items, maxWidth, colGap, rowGap) {
  const cap = balancedWrapCap(items, maxWidth, colGap);
  let rowX = 0, rowIdx = 0;
  const rowHeights = [];
  items.forEach(u => {
    if (rowX > 0 && rowX + u.width > cap) { rowIdx++; rowX = 0; }
    u.rowIdx = rowIdx;
    u.xInRow = rowX;
    rowX += u.width + colGap;
    if (rowHeights[rowIdx] === undefined || u.height > rowHeights[rowIdx]) rowHeights[rowIdx] = u.height;
  });
  const rowYOffset = [];
  let acc = 0;
  for (let r = 0; r < rowHeights.length; r++) { rowYOffset[r] = acc; acc += (rowHeights[r] || 0) + rowGap; }
  let totalWidth = 0;
  items.forEach(u => { const right = u.xInRow + u.width; if (right > totalWidth) totalWidth = right; });
  // Center any row narrower than the widest one -- otherwise a row left with
  // just one small trailing item (because a much bigger unit, e.g. the whole
  // platform-boundary block, already filled most of the row before it) reads
  // as an accidental leftover stranded in empty space rather than a
  // deliberate, balanced arrangement.
  const rowContentWidth = [];
  items.forEach(u => { const right = u.xInRow + u.width; if (!(rowContentWidth[u.rowIdx] > right)) rowContentWidth[u.rowIdx] = right; });
  items.forEach(u => { u.xInRow += (totalWidth - rowContentWidth[u.rowIdx]) / 2; });
  const totalHeight = rowHeights.length ? acc - rowGap : 0;
  return { rowYOffset, totalWidth, totalHeight, numRows: rowHeights.length };
}

// balanced-partition cap: same number of rows a naive greedy-at-maxWidth
// wrap would need, but the SMALLEST per-row width cap that still achieves
// that row count -- avoids the classic first-fit flaw where the trailing
// row ends up with just one item stranded in a sea of empty space, by
// distributing content as evenly as possible across all rows instead.
function balancedWrapCap(items, maxWidth, colGap) {
  const widths = items.map(u => u.width);
  const n = widths.length;
  if (!n) return maxWidth;
  function rowsNeeded(cap) {
    let rows = 1, cur = widths[0];
    for (let i = 1; i < n; i++) {
      const add = widths[i] + colGap;
      if (cur > 0 && cur + add > cap) { rows++; cur = widths[i]; } else { cur += add; }
    }
    return rows;
  }
  const maxItemWidth = Math.max.apply(null, widths);
  const hi0 = Math.max(maxWidth, maxItemWidth);
  const targetRows = rowsNeeded(hi0);
  let lo = maxItemWidth, hi = hi0;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (rowsNeeded(mid) <= targetRows) hi = mid; else lo = mid + 1;
  }
  return lo;
}

// ── Nested containers (Phase 2) ──────────────────────────────────────
// A container is a generalized, USER-declared version of the ONE hardcoded
// platform boundary above: it sweeps a contiguous rank-column RANGE into one
// atomic, internally row-wrapped box. Membership is declared (zone_names /
// node_ids on the container, resolved against the PRE-consolidation zone
// list so renamed/merged zones still resolve), the swept RANGE is derived
// from that membership (+ nested child container ranges), and -- exactly
// like the platform boundary already does for non-snow zones caught between
// snowStart/snowEnd -- any OTHER zone whose rank falls inside that range is
// absorbed into the box too, so a real zone can never silently disappear
// just because a container declaration was ambiguous or incomplete.
//
// Guardrail: if two containers (or a container and the platform boundary)
// would claim overlapping rank ranges, the later one is simply not drawn as
// a box (its zones fall back to plain rendering) rather than producing
// corrupted/overlapping geometry. Same for cycles in container_ids: only the
// first-declared parent wins, so containers always form a proper tree.
//
// Returns per-zone container membership (immediate + full ancestor chain,
// for route.mjs's crossing-avoidance) and a memoized `buildUnit(id)` that
// recursively computes chrome + wrapUnits(children) bottom-up, mirroring the
// platformBoundary's own zonesInBoundary/innerWrap pattern one level deeper.
function buildContainerLayout(rawContainers, preConsolidationZones, zones, rank, zoneSize, maxCanvasWidth) {
  const empty = {
    defs: {}, rangeCache: {}, topLevelIds: [],
    acceptAgainst: () => [],
    resolveZoneContainerId: () => ({}),
    makeBuildUnit: () => () => null,
    chainOf: () => [],
  };
  if (!Array.isArray(rawContainers) || !rawContainers.length) return empty;

  const zoneNodeIdsPre = {};
  preConsolidationZones.forEach(z => { zoneNodeIdsPre[z.name] = z.node_ids || []; });

  const defs = {};
  rawContainers.forEach(c => {
    if (!c || c.id == null) return;
    const seedIds = new Set(c.node_ids || []);
    (c.zone_names || []).forEach(zn => (zoneNodeIdsPre[zn] || []).forEach(id => seedIds.add(id)));
    defs[c.id] = { id: c.id, label: c.label || c.id, seedIds, childIds: (c.container_ids || []).filter(cid => cid !== c.id), parentId: null };
  });
  // Link parents (first-declared wins), then break any cycles so the
  // container graph is always a proper tree.
  Object.keys(defs).forEach(pid => {
    defs[pid].childIds.forEach(cid => { if (defs[cid] && defs[cid].parentId == null) defs[cid].parentId = pid; });
  });
  Object.keys(defs).forEach(id => {
    const seen = {}; let cur = id;
    while (defs[cur] && defs[cur].parentId != null) {
      if (seen[cur]) { defs[cur].parentId = null; break; }
      seen[cur] = true; cur = defs[cur].parentId;
    }
  });

  // Which POST-consolidation zone is a "seed" of which container (majority
  // of its node_ids overlap that container's declared seed ids).
  const seedZoneContainer = {};
  zones.forEach(z => {
    const ids = z.node_ids || []; if (!ids.length) return;
    let best = null, bestScore = 0;
    Object.keys(defs).forEach(cid => {
      let score = 0; ids.forEach(id => { if (defs[cid].seedIds.has(id)) score++; });
      if (score > 0 && score >= ids.length / 2 && score > bestScore) { best = cid; bestScore = score; }
    });
    if (best) seedZoneContainer[z.name] = best;
  });

  // Rank range per container = min/max rank of its own seed zones, unioned
  // with (recursively) its declared children's ranges.
  const rangeCache = {};
  function rangeOf(id, guard) {
    if (rangeCache[id] !== undefined) return rangeCache[id];
    guard = guard || {};
    if (guard[id]) return (rangeCache[id] = null);
    guard[id] = true;
    let lo = Infinity, hi = -Infinity;
    zones.forEach(z => { if (seedZoneContainer[z.name] === id) { const r = rank[z.name]; if (r < lo) lo = r; if (r > hi) hi = r; } });
    (defs[id].childIds || []).forEach(cid => {
      if (!defs[cid] || defs[cid].parentId !== id) return;
      const sub = rangeOf(cid, guard);
      if (sub) { if (sub.lo < lo) lo = sub.lo; if (sub.hi > hi) hi = sub.hi; }
    });
    return (rangeCache[id] = (lo === Infinity ? null : { lo, hi }));
  }
  Object.keys(defs).forEach(id => rangeOf(id));

  // Accept top-level containers in rank order, skipping any that collide
  // with an already-claimed range (the platform boundary claims its own
  // range first -- it is set up by the caller before this point, but we
  // don't know snowStart/snowEnd here, so the caller passes it in via the
  // `claimed` seed below).
  const topLevelIds = Object.keys(defs).filter(id => defs[id].parentId == null && rangeCache[id]);
  topLevelIds.sort((a, b) => rangeCache[a].lo - rangeCache[b].lo);

  function acceptAgainst(claimedRanges) {
    const claimed = claimedRanges.slice();
    const accepted = [];
    topLevelIds.forEach(id => {
      const r = rangeCache[id];
      const collide = claimed.some(c => !(r.hi < c.lo || r.lo > c.hi));
      if (collide) return;
      claimed.push(r);
      accepted.push(id);
    });
    return accepted;
  }

  // zone -> innermost accepted container id (narrowest range containing it)
  function resolveZoneContainerId(accepted) {
    const zoneContainerId = {};
    function subtreeIds(id) {
      const out = [id];
      (defs[id].childIds || []).forEach(cid => { if (defs[cid] && defs[cid].parentId === id) out.push.apply(out, subtreeIds(cid)); });
      return out;
    }
    accepted.forEach(id => {
      const tree = subtreeIds(id); // DFS: id itself first, then children/descendants
      const topRange = rangeCache[id];
      zones.forEach(z => {
        const r = rank[z.name];
        if (r < topRange.lo || r > topRange.hi) return;
        // Narrowest range wins; on an exact tie (e.g. a pure-wrapper parent
        // whose range is entirely inherited from one child) the LATER
        // (deeper, since DFS visits parent before child) tree member wins
        // -- so a zone always resolves to its most specific container.
        let bestId = id, bestSpan = Infinity;
        tree.forEach(cid => {
          const cr = rangeCache[cid]; if (!cr) return;
          if (r >= cr.lo && r <= cr.hi) { const span = cr.hi - cr.lo; if (span <= bestSpan) { bestSpan = span; bestId = cid; } }
        });
        zoneContainerId[z.name] = bestId;
      });
    });
    return zoneContainerId;
  }

  function chainOf(id) {
    const chain = []; let cur = id;
    const seen = {};
    while (cur != null && defs[cur] && !seen[cur]) { chain.push(cur); seen[cur] = true; cur = defs[cur].parentId; }
    return chain;
  }

  const unitCache = {};
  function makeBuildUnit(zoneContainerId) {
    return function buildUnit(id) {
      if (unitCache[id] !== undefined) return unitCache[id];
      const directZones = zones.filter(z => zoneContainerId[z.name] === id).sort((a, b) => rank[a.name] - rank[b.name]);
      const childIds = (defs[id].childIds || []).filter(cid => defs[cid] && defs[cid].parentId === id);
      const items = [];
      directZones.forEach(z => { const zs = zoneSize(z); items.push({ kind: 'zone', z, zs, width: zs.width, height: zs.height, rank: rank[z.name] }); });
      childIds.forEach(cid => { const cu = buildUnit(cid); if (cu) items.push({ kind: 'container', unit: cu, width: cu.width, height: cu.height, rank: rangeCache[cid] ? rangeCache[cid].lo : 0 }); });
      if (!items.length) return (unitCache[id] = null);
      items.sort((a, b) => a.rank - b.rank);
      const chromeW = 2 * (LAYOUT.containerBorder + LAYOUT.containerPadSide);
      const chromeH = 2 * LAYOUT.containerBorder + LAYOUT.containerHeaderH + LAYOUT.containerPadTop + LAYOUT.containerPadBottom;
      const innerMaxWidth = Math.max(maxCanvasWidth - chromeW, CARD.width);
      const innerWrap = wrapUnits(items, innerMaxWidth, LAYOUT.outerColGap, LAYOUT.rowWrapGap);
      const unit = {
        id, label: defs[id].label, parentId: defs[id].parentId,
        width: chromeW + innerWrap.totalWidth, height: chromeH + innerWrap.totalHeight,
        items, innerWrap,
      };
      unitCache[id] = unit;
      return unit;
    };
  }

  return { defs, rangeCache, topLevelIds, acceptAgainst, resolveZoneContainerId, makeBuildUnit, chainOf };
}

// ── Zone consolidation (port of renderFlow lines ~816-934) ──────────
function consolidateZones(zones, nodesById, edges, opts) {
  if (opts.consolidate === false || zones.length <= 1) return zones;
  const tokenize = (name) => String(name || '').trim().split(/[\s\-_/]+/).filter(Boolean);
  const isQual = (t) => QUALIFIERS[t.toLowerCase()] === 1;
  const mergeable = (a, b) => {
    if (a.category !== b.category) return false;
    if ((a.node_ids || []).length > 4 || (b.node_ids || []).length > 4) return false;
    const ta = tokenize(a.name), tb = tokenize(b.name);
    if (!ta.length || !tb.length) return false;
    if (ta[0].toLowerCase() !== tb[0].toLowerCase()) return false;
    let k = 0;
    while (k < ta.length && k < tb.length && ta[k].toLowerCase() === tb[k].toLowerCase()) k++;
    if (k === 0) return false;
    for (let i = k; i < ta.length; i++) if (!isQual(ta[i])) return false;
    for (let j = k; j < tb.length; j++) if (!isQual(tb[j])) return false;
    if (ta.length === k && tb.length === k) return false;
    return true;
  };

  const out = [];
  let i = 0;
  while (i < zones.length) {
    const group = [zones[i]];
    let j = i + 1;
    while (j < zones.length && mergeable(group[group.length - 1], zones[j])) { group.push(zones[j]); j++; }
    if (group.length === 1) { out.push(zones[i]); }
    else {
      const gt = group.map(g => tokenize(g.name));
      let prefixLen = gt[0].length;
      for (let p = 1; p < gt.length; p++) {
        let k2 = 0;
        while (k2 < prefixLen && k2 < gt[p].length && gt[0][k2].toLowerCase() === gt[p][k2].toLowerCase()) k2++;
        prefixLen = Math.min(prefixLen, k2);
      }
      const prefixName = gt[0].slice(0, prefixLen).join(' ');
      const subGroups = group.map((g, gi) => {
        const toks = gt[gi].slice(prefixLen);
        return { label: toks.length ? toks.join(' ').toUpperCase() : (g.name || 'DEFAULT'), node_ids: (g.node_ids || []).slice() };
      });
      const allIds = [];
      subGroups.forEach(sg => sg.node_ids.forEach(id => allIds.push(id)));
      const useSub = opts.consolidate_sub_groups === true;
      out.push({ name: prefixName, category: group[0].category, node_ids: allIds, sub_groups: useSub ? subGroups : null });
      group.forEach(g => (g.node_ids || []).forEach(id => { if (nodesById[id]) nodesById[id].zone = prefixName; }));
    }
    i = j;
  }
  return out.length !== zones.length ? out : zones;
}

// ── Zone rank/column assignment (port of renderFlow lines ~942-1081) ──
function assignRanks(zones, edges) {
  const nodeToZone = {};
  zones.forEach(z => (z.node_ids || []).forEach(id => { nodeToZone[id] = z.name; }));
  const names = zones.map(z => z.name);
  const order = {}; names.forEach((n, i) => { order[n] = i; });
  const succ = {}; names.forEach(n => { succ[n] = []; });
  edges.forEach(e => {
    const sz = nodeToZone[e.source], tz = nodeToZone[e.target];
    if (!sz || !tz || sz === tz) return;
    if (order[tz] <= order[sz]) return;
    if (succ[sz].indexOf(tz) === -1) succ[sz].push(tz);
  });
  const rank = {}; names.forEach(n => { rank[n] = 0; });
  let changed = true, safety = 0;
  while (changed && safety < 50) {
    changed = false; safety++;
    names.forEach(src => succ[src].forEach(tgt => {
      if (rank[tgt] < rank[src] + 1) { rank[tgt] = rank[src] + 1; changed = true; }
    }));
  }
  // orphan source pull-in (snow-category only)
  const cat = {}; zones.forEach(z => { cat[z.name] = z.category; });
  const hasPred = {}; names.forEach(n => { hasPred[n] = false; });
  names.forEach(src => succ[src].forEach(tgt => { hasPred[tgt] = true; }));
  names.forEach(n => {
    if (hasPred[n] || rank[n] !== 0 || cat[n] !== 'snow') return;
    let minTgt = Infinity;
    edges.forEach(e => {
      const sz = nodeToZone[e.source], tz = nodeToZone[e.target];
      if (sz !== n || !tz || tz === n) return;
      if (rank[tz] !== undefined && rank[tz] < minTgt) minTgt = rank[tz];
    });
    if (minTgt === Infinity) return;
    const pulled = minTgt - 1;
    if (pulled > 0) rank[n] = pulled;
  });
  changed = true; safety = 0;
  while (changed && safety < 10) {
    changed = false; safety++;
    names.forEach(src => succ[src].forEach(tgt => {
      if (rank[tgt] < rank[src] + 1) { rank[tgt] = rank[src] + 1; changed = true; }
    }));
  }
  names.forEach(n => { if (rank[n] > names.length - 1) rank[n] = names.length - 1; });
  // de-collide same-rank zones into unique columns
  const sorted = names.slice().sort((a, b) => (rank[a] !== rank[b]) ? rank[a] - rank[b] : order[a] - order[b]);
  sorted.forEach((n, idx) => { rank[n] = idx; });
  return rank;
}

// ── Intra-zone column + row assignment (port of buildZoneEl ~1149-1227) ──
function intraLayout(zone, edges) {
  const ids = zone.node_ids || [];
  const set = {}; ids.forEach(id => { set[id] = true; });
  const intra = edges.filter(e => set[e.source] && set[e.target]);
  const outDeg = {};
  intra.forEach(e => { outDeg[e.source] = (outDeg[e.source] || 0) + 1; });
  const hasFanout = Object.keys(outDeg).some(k => outDeg[k] >= 2);
  const col = {}; ids.forEach(id => { col[id] = 0; });
  if (hasFanout) {
    let it = ids.length + 2, changed = true;
    while (changed && it-- > 0) {
      changed = false;
      intra.forEach(e => { if (col[e.source] + 1 > col[e.target]) { col[e.target] = col[e.source] + 1; changed = true; } });
    }
  }
  let maxCol = 0; ids.forEach(id => { if (col[id] > maxCol) maxCol = col[id]; });
  const rowsPerCol = {}, rowIdx = {};
  ids.forEach(id => { const c = col[id]; if (rowsPerCol[c] === undefined) rowsPerCol[c] = 0; rowIdx[id] = rowsPerCol[c]++; });
  return { col, rowIdx, maxCol, hasFanout };
}

// ── Cross-zone row ordering (Sugiyama crossing reduction) ──
// Each zone is its own layer (assignRanks gives unique ranks). Within a zone
// (and within each intra-zone column), reorder nodes vertically by the median
// row of their neighbors in adjacent zones, swept down then up, a few passes.
// This is the deterministic, global version of the manual "reorder a zone"
// lever — it removes most cross-zone edge crossings. Sub-group zones keep their
// explicit order (their columns ARE the grouping).
function orderRowsAcrossZones(zones, zoneInfo, rank, edges, isDummy) {
  const zoneOf = {};
  zones.forEach(z => (z.node_ids || []).forEach(id => { zoneOf[id] = z.name; }));
  const nbrPrev = {}, nbrNext = {};
  edges.forEach(e => {
    const sz = zoneOf[e.source], tz = zoneOf[e.target];
    if (!sz || !tz || sz === tz) return;
    const sr = rank[sz], tr = rank[tz];
    if (sr == null || tr == null) return;
    if (sr < tr) { (nbrNext[e.source] = nbrNext[e.source] || []).push(e.target); (nbrPrev[e.target] = nbrPrev[e.target] || []).push(e.source); }
    else if (sr > tr) { (nbrPrev[e.source] = nbrPrev[e.source] || []).push(e.target); (nbrNext[e.target] = nbrNext[e.target] || []).push(e.source); }
  });
  const rowOf = (id) => { const zi = zoneInfo[zoneOf[id]]; return zi ? (zi.rowIdx[id] || 0) : null; };
  function median(ids) {
    const rows = ids.map(rowOf).filter(v => v != null).sort((a, b) => a - b);
    if (!rows.length) return null;
    const m = rows.length;
    return m % 2 ? rows[(m - 1) / 2] : (rows[m / 2 - 1] + rows[m / 2]) / 2;
  }
  // Intra-zone chain edges (e.g. Bronze -> Silver -> Gold, all one zone/
  // column) are a HARD ordering constraint: cross-zone median alignment
  // below is a soft preference and must never flip a node above something
  // that feeds it, or the connector visually loops backward.
  const zoneOf2 = zoneOf;
  const precedesWithinZone = {}; // zoneName -> Set("sourceId|targetId")
  edges.forEach(e => {
    const sz = zoneOf2[e.source], tz = zoneOf2[e.target];
    if (sz && sz === tz) (precedesWithinZone[sz] = precedesWithinZone[sz] || new Set()).add(e.source + '|' + e.target);
  });
  function constrainedOrder(items, precedesSet) {
    // items already carry a "desired" row (median-based); this performs the
    // smallest possible topological repair -- among items with no
    // unplaced intra-zone predecessor, pick the one with the lowest desired
    // row, exactly reproducing a plain sort when there are no constraints.
    const remaining = items.slice();
    const placed = [];
    const placedIds = new Set();
    while (remaining.length) {
      let bestIdx = -1;
      for (let i = 0; i < remaining.length; i++) {
        const blocked = remaining.some((other, j) => j !== i && precedesSet.has(other.id + '|' + remaining[i].id));
        if (blocked) continue;
        if (bestIdx === -1 || remaining[i].desired < remaining[bestIdx].desired) bestIdx = i;
      }
      if (bestIdx === -1) bestIdx = 0; // cycle guard (shouldn't occur for a DAG): never hang
      placed.push(remaining[bestIdx]);
      placedIds.add(remaining[bestIdx].id);
      remaining.splice(bestIdx, 1);
    }
    return placed;
  }
  function reorderZone(z, dir) {
    const zi = zoneInfo[z.name];
    if (!zi || zi.subGroups) return;               // sub-group zones keep explicit order
    const precedesSet = precedesWithinZone[z.name] || new Set();
    const byCol = {};
    (z.node_ids || []).forEach(id => { if (isDummy && isDummy[id]) return; const c = zi.col[id] || 0; (byCol[c] = byCol[c] || []).push(id); });
    Object.keys(byCol).forEach(c => {
      const ids = byCol[c];
      if (ids.length < 2) return;
      const nbrMap = dir < 0 ? nbrPrev : nbrNext;
      const items = ids.map(id => ({ id, b: median(nbrMap[id] || []), orig: zi.rowIdx[id] || 0 }));
      // nodes without a neighbor on this side stay at their current row (fallback to orig);
      // stable tie-break by original row keeps determinism.
      items.sort((p, q) => { const pb = p.b == null ? p.orig : p.b, qb = q.b == null ? q.orig : q.b; return pb !== qb ? pb - qb : p.orig - q.orig; });
      const ranked = items.map((it, i) => ({ id: it.id, desired: i }));
      const fixed = precedesSet.size ? constrainedOrder(ranked, precedesSet) : ranked;
      fixed.forEach((it, i) => { zi.rowIdx[it.id] = i; });
    });
  }
  const byRank = zones.slice().sort((a, b) => rank[a.name] - rank[b.name]);
  for (let it = 0; it < 4; it++) {
    const down = it % 2 === 0;
    const seq = down ? byRank : byRank.slice().reverse();
    seq.forEach(z => reorderZone(z, down ? -1 : 1));
  }
}

function pack(model, opts = {}) {
  const nodesById = {};
  model.nodes.forEach(n => { nodesById[n.id] = n; });
  let zones = consolidateZones(model.zones, nodesById, model.edges, model);
  // refresh node_ids after consolidation
  zones.forEach(z => { if (!z.node_ids) z.node_ids = model.nodes.filter(n => n.zone === z.name).map(n => n.id); });

  const rank = assignRanks(zones, model.edges);

  // ── Phase 2: virtual (dummy) nodes for edges spanning >1 zone-rank ──
  // Reserve a thin lane in each intermediate zone so the long edge routes as a
  // straight spine instead of a deep detour. Dummies are INTERNAL: they shape
  // placement + ordering + routing, then get stripped from the output (RENDER
  // never sees them).
  const DUMMY_W = 10, DUMMY_H = 8;
  const isDummy = {};
  const dummyZone = {};       // dummyId -> zone name
  const edgeChains = {};      // edgeIndex -> [dummyId,...] in src->tgt order
  const orderingEdges = [];   // decomposed edge list (unused for ordering; kept for clarity)
  {
    const nodeZone = {};
    zones.forEach(z => (z.node_ids || []).forEach(id => { nodeZone[id] = z.name; }));
    const zoneByRank = {};
    zones.forEach(z => { zoneByRank[rank[z.name]] = z; });
    let dseq = 0;
    model.edges.forEach((e, ei) => {
      const zs = nodeZone[e.source], zt = nodeZone[e.target];
      if (!zs || !zt || zs === zt) { orderingEdges.push({ source: e.source, target: e.target }); return; }
      const rs = rank[zs], rt = rank[zt];
      if (rs == null || rt == null || Math.abs(rs - rt) <= 1) { orderingEdges.push({ source: e.source, target: e.target }); return; }
      const dir = rs < rt ? 1 : -1;
      const chain = [];
      let prev = e.source;
      for (let r = rs + dir; r !== rt; r += dir) {
        const Z = zoneByRank[r];
        if (!Z || Z.sub_groups) continue;          // skip sub-group zones (keep explicit order)
        const did = '__dummy_' + (dseq++) + '_' + r;
        (Z.node_ids = Z.node_ids || []).push(did);
        nodeZone[did] = Z.name;
        isDummy[did] = true;
        dummyZone[did] = Z.name;
        orderingEdges.push({ source: prev, target: did });
        prev = did;
        chain.push(did);
      }
      orderingEdges.push({ source: prev, target: e.target });
      if (chain.length) edgeChains[ei] = chain;
    });
  }

  const colCount = maxOf(zones.map(z => rank[z.name])) + 1;
  const columns = []; for (let r = 0; r < colCount; r++) columns.push([]);
  zones.forEach(z => columns[rank[z.name]].push(z));

  // measure nodes (+ thin size for dummy lane reservations)
  const size = {};
  model.nodes.forEach(n => { size[n.id] = measureNode(n, opts); });
  Object.keys(isDummy).forEach(did => { size[did] = { w: DUMMY_W, h: DUMMY_H }; });

  // intra-zone layout per zone + sub-group handling
  const zoneInfo = {};
  zones.forEach(z => {
    if (Array.isArray(z.sub_groups) && z.sub_groups.length > 1) {
      // each sub-group is its own column; rows within
      const col = {}, rowIdx = {}, subColOf = {};
      z.sub_groups.forEach((sg, sgi) => {
        (sg.node_ids || []).forEach((id, ri) => { col[id] = sgi; rowIdx[id] = ri; subColOf[id] = sgi; });
      });
      zoneInfo[z.name] = { col, rowIdx, maxCol: z.sub_groups.length - 1, hasFanout: true, subGroups: z.sub_groups, subColOf };
    } else {
      const il = intraLayout(z, model.edges);
      zoneInfo[z.name] = { col: il.col, rowIdx: il.rowIdx, maxCol: il.maxCol, hasFanout: il.hasFanout, subGroups: null, subColOf: {} };
    }
  });

  // ── cross-zone crossing reduction: reorder rows within zones by neighbor
  // median (Sugiyama sweep) before row bands are measured ──
  orderRowsAcrossZones(zones, zoneInfo, rank, model.edges, isDummy);

  // ── Phase 2: align each dummy chain onto ONE shared row so the long edge
  // routes as a straight spine. Prefer the source's own row when it is clear of
  // real nodes through every zone the chain crosses (shallow + straight); else
  // drop into a fresh lane row below the real content (a tidy parallel bus). ──
  {
    const realZoneOf = {};
    zones.forEach(z => (z.node_ids || []).forEach(id => { if (!isDummy[id]) realZoneOf[id] = z.name; }));
    const rowOfReal = (id) => { const zn = realZoneOf[id]; const zi = zn ? zoneInfo[zn] : null; return zi ? (zi.rowIdx[id] || 0) : 0; };
    const realRows = {};   // zoneName -> Set(occupied rowIdx)
    zones.forEach(z => {
      const zi = zoneInfo[z.name]; const s = new Set();
      (z.node_ids || []).forEach(id => { if (!isDummy[id]) s.add(zi.rowIdx[id] || 0); });
      realRows[z.name] = s;
    });
    let realMaxRow = 0;
    Object.values(realRows).forEach(s => s.forEach(r => { if (r > realMaxRow) realMaxRow = r; }));
    let nextLane = realMaxRow + 1;
    const chainKeys = Object.keys(edgeChains).map(Number).sort((a, b) => {
      const ra = rowOfReal(model.edges[a].source), rb = rowOfReal(model.edges[b].source);
      if (ra !== rb) return ra - rb;
      return a - b;
    });
    // Phase 3 bus-merging: deep chains that share a source share ONE lane, so
    // they run as a single trunk and split only at each target's climb.
    const laneBySource = {};
    chainKeys.forEach(ei => {
      const chain = edgeChains[ei], e = model.edges[ei];
      const sRow = rowOfReal(e.source);
      const zonesCrossed = chain.map(did => dummyZone[did]);
      const clear = zonesCrossed.every(zn => !realRows[zn].has(sRow));
      let laneRow;
      if (clear) laneRow = sRow;
      else if (laneBySource[e.source] != null) laneRow = laneBySource[e.source];
      else { laneRow = nextLane++; laneBySource[e.source] = laneRow; }
      chain.forEach(did => { zoneInfo[dummyZone[did]].rowIdx[did] = laneRow; });
      zonesCrossed.forEach(zn => realRows[zn].add(laneRow));
    });
  }

  // ── global row-band heights (alignRowsAcrossZones) ──
  // Row band r height = max card height of any node at rowIdx r anywhere.
  const rowBand = {};
  zones.forEach(z => {
    const zi = zoneInfo[z.name]; if (!zi) return;
    (z.node_ids || []).forEach(id => {
      const r = zi.rowIdx[id] || 0;
      const h = (size[id] ? size[id].h : 0);
      if (!rowBand[r] || h > rowBand[r]) rowBand[r] = h;
    });
  });

  // deepest row across ALL nodes incl. dummy lanes. Zone BOXES ignore lane rows
  // (they stay compact); the platform boundary extends to cover the lane channel
  // that sits below the zone boxes.
  let globalMaxRow = 0;
  zones.forEach(z => { const zi = zoneInfo[z.name]; if (!zi) return; (z.node_ids || []).forEach(id => { const r = zi.rowIdx[id] || 0; if (r > globalMaxRow) globalMaxRow = r; }); });

  // card width per zone column: sub/fanout use narrower min width
  function cardWidth(zi) {
    if (zi.subGroups) return Math.max(ZONE.subColMinWidth, CARD.width);
    if (zi.hasFanout && zi.maxCol >= 1) return Math.max(ZONE.fanoutColMinWidth, CARD.width);
    return CARD.width;
  }
  function colGap(zi) {
    if (zi.subGroups) return ZONE.subColGap;
    if (zi.hasFanout && zi.maxCol >= 1) return ZONE.fanoutColGap;
    return 0;
  }

  // zone dimensions
  function zoneSize(z) {
    const zi = zoneInfo[z.name];
    const ncols = zi.maxCol + 1;
    const cw = cardWidth(zi), cg = colGap(zi);
    const bodyW = ncols * cw + (ncols - 1) * cg;
    const width = bodyW + ZONE.bodyPad * 2 + ZONE.border * 2;
    // rows present = distinct rowIdx of REAL nodes (dummy lanes do NOT inflate
    // the zone box; they live in the boundary channel below).
    let maxRow = 0;
    (z.node_ids || []).forEach(id => { if (isDummy[id]) return; const r = zi.rowIdx[id] || 0; if (r > maxRow) maxRow = r; });
    let bodyH = 0;
    for (let r = 0; r <= maxRow; r++) bodyH += (rowBand[r] || 0) + (r > 0 ? ZONE.rowGap : 0);
    const height = ZONE.border + ZONE.stripe + ZONE.headerMinHeight + ZONE.bodyPad * 2 + bodyH;
    return { width, height, ncols, cw, cg, maxRow };
  }

  // ── horizontal placement of columns with boundary wrapping ──
  const snowColIdx = {};
  columns.forEach((col, ci) => col.forEach(z => { if (SNOW_CATEGORIES[z.category]) snowColIdx[ci] = true; }));
  const snowCols = Object.keys(snowColIdx).map(Number).sort((a, b) => a - b);
  const snowStart = snowCols.length ? snowCols[0] : -1;
  const snowEnd = snowCols.length ? snowCols[snowCols.length - 1] : -1;
  const hasBoundary = snowStart >= 0;

  const maxCanvasWidth = (opts && opts.maxCanvasWidth) || LAYOUT.maxCanvasWidth;

  // ── nested containers (Phase 2): resolve declared membership against the
  // platform boundary's claimed range, then build recursive units for
  // whichever top-level containers don't collide with it or each other. ──
  const containerLayout = buildContainerLayout(model.containers, model.zones, zones, rank, zoneSize, maxCanvasWidth);
  const acceptedContainerIds = containerLayout.acceptAgainst(hasBoundary ? [{ lo: snowStart, hi: snowEnd }] : []);
  const zoneContainerId = containerLayout.resolveZoneContainerId(acceptedContainerIds);
  const buildContainerUnit = containerLayout.makeBuildUnit(zoneContainerId);
  const containerRangeByStartCi = {};
  acceptedContainerIds.forEach(id => { containerRangeByStartCi[containerLayout.rangeCache[id].lo] = id; });

  // dynamic inner gap (bridge density) — port of lines ~1256-1328
  const nodeZoneMap = {};
  model.nodes.forEach(n => { nodeZoneMap[n.id] = n.zone; });
  const preFanOut = {}, preFanIn = {};
  model.edges.forEach(e => { preFanOut[e.source] = (preFanOut[e.source] || 0) + 1; preFanIn[e.target] = (preFanIn[e.target] || 0) + 1; });
  const perGap = {};
  model.edges.forEach(e => {
    if ((preFanOut[e.source] || 0) <= 1 || (preFanIn[e.target] || 0) <= 1) return;
    const sz = nodeZoneMap[e.source], tz = nodeZoneMap[e.target];
    if (!sz || !tz || sz === tz) return;
    const sr = rank[sz], tr = rank[tz];
    if (sr == null || tr == null) return;
    const lo = Math.min(sr, tr), hi = Math.max(sr, tr);
    for (let g = lo; g < hi; g++) perGap[g] = (perGap[g] || 0) + 1;
  });
  const maxGap = Object.keys(perGap).reduce((m, g) => Math.max(m, perGap[g]), 0);
  const dynInnerGap = Math.min(LAYOUT.dynGapCap, LAYOUT.dynGapBase + LAYOUT.dynGapStep * Math.max(0, maxGap - 1));

  const outsideZoneTop = hasBoundary ? LAYOUT.outsidePadTop : 0;

  // ── Phase 1a: build placement UNITS in original left-to-right order ──
  // A unit is either one outside column (its zones placed side-by-side, as
  // before), atomically the WHOLE platform-boundary block (all snow columns
  // snowStart..snowEnd, itself internally row-wrapped — see below), or an
  // accepted top-level container's own recursive box. Units carry their own
  // width/height so a row-wrap pass (1b) can decide, per unit, whether it
  // still fits the current row or must start a new one — instead of one
  // ever-growing x.
  const units = [];
  for (let ci = 0; ci < columns.length; ci++) {
    if (!columns[ci].length) continue;
    if (containerRangeByStartCi[ci] != null) {
      const cid = containerRangeByStartCi[ci];
      const cu = buildContainerUnit(cid);
      if (cu) {
        units.push({ kind: 'containerBox', width: cu.width, height: cu.height, unit: cu });
        ci = containerLayout.rangeCache[cid].hi;
        continue;
      }
    }
    if (hasBoundary && ci === snowStart) {
      const boundaryChromeW = 2 * (LAYOUT.boundaryBorder + LAYOUT.boundaryPadSide);
      const innerMaxWidth = Math.max(maxCanvasWidth - boundaryChromeW, CARD.width);
      const zonesInBoundary = [];

      for (let sci = snowStart; sci <= snowEnd; sci++) {
        columns[sci].forEach(z => { const zs = zoneSize(z); zonesInBoundary.push({ z, zs, width: zs.width, height: zs.height }); });
      }
      const innerWrap = wrapUnits(zonesInBoundary, innerMaxWidth, dynInnerGap, LAYOUT.rowWrapGap);
      const width = boundaryChromeW + innerWrap.totalWidth;
      const height = LAYOUT.boundaryBorder + LAYOUT.boundaryPadTop + innerWrap.totalHeight + LAYOUT.boundaryPadBottom + LAYOUT.boundaryBorder;
      units.push({ kind: 'boundary', width, height, zonesInBoundary, innerWrap });
      ci = snowEnd; // skip the snow columns we just measured
      continue;
    }
    let colW = 0;
    let colH = 0;
    const zonesInCol = [];
    columns[ci].forEach(z => {
      const zs = zoneSize(z);
      zonesInCol.push({ z, zs });
      colW += zs.width + LAYOUT.outerColGap;
      if (zs.height > colH) colH = zs.height;
    });
    colW -= LAYOUT.outerColGap;
    units.push({ kind: 'outside', width: colW, height: colH, zonesInCol });
  }

  // ── Phase 1b: greedy row-wrap of the outer units ──
  const outerWrap = wrapUnits(units, maxCanvasWidth, LAYOUT.outerColGap, LAYOUT.rowWrapGap);

  // ── Phase 1c: actual placement using each unit's row/x/y (outer), and,
  // for the boundary unit, its own inner row/x/y on top of that. ──
  const zoneRects = [];
  const placedByZone = {};
  const containerRects = [];
  let boundaryLeft = null, boundaryRight = null, boundaryTop = null, boundaryBottom = null;

  // Recursive: places every (zone | nested container) item inside a
  // container unit, mirroring the boundary's own zonesInBoundary placement
  // one level deeper. Pushes exactly one containerRects entry per box.
  function placeContainerUnit(unit, x, y) {
    const innerOriginX = x + LAYOUT.containerBorder + LAYOUT.containerPadSide;
    const innerOriginY = y + LAYOUT.containerBorder + LAYOUT.containerHeaderH + LAYOUT.containerPadTop;
    unit.items.forEach(item => {
      const left = innerOriginX + item.xInRow;
      const top = innerOriginY + (unit.innerWrap.rowYOffset[item.rowIdx] || 0);
      if (item.kind === 'zone') {
        const zs = item.zs;
        zoneRects.push({ name: item.z.name, left, right: left + zs.width, top, bottom: top + zs.height });
        placedByZone[item.z.name] = { left, top, zs };
      } else {
        placeContainerUnit(item.unit, left, top);
      }
    });
    containerRects.push({ id: unit.id, label: unit.label, parentId: unit.parentId, left: x, top: y, right: x + unit.width, bottom: y + unit.height });
  }

  units.forEach(u => {
    const rowTop = outerWrap.rowYOffset[u.rowIdx] || 0;
    if (u.kind === 'containerBox') {
      placeContainerUnit(u.unit, u.xInRow, rowTop);
    } else if (u.kind === 'boundary') {
      boundaryLeft = u.xInRow;
      boundaryTop = rowTop;
      boundaryRight = u.xInRow + u.width;
      boundaryBottom = rowTop + u.height;
      const innerOriginX = u.xInRow + LAYOUT.boundaryBorder + LAYOUT.boundaryPadSide;
      const innerOriginY = rowTop + LAYOUT.boundaryBorder + LAYOUT.boundaryPadTop;
      u.zonesInBoundary.forEach(item => {
        const left = innerOriginX + item.xInRow;
        const top = innerOriginY + (u.innerWrap.rowYOffset[item.rowIdx] || 0);
        const zs = item.zs;
        zoneRects.push({ name: item.z.name, left, right: left + zs.width, top, bottom: top + zs.height });
        placedByZone[item.z.name] = { left, top, zs };
      });
    } else {
      let ix = u.xInRow;
      const top = rowTop + outsideZoneTop;
      u.zonesInCol.forEach(function (item) {
        const z = item.z, zs = item.zs;
        const left = ix;
        zoneRects.push({ name: z.name, left, right: left + zs.width, top, bottom: top + zs.height });
        placedByZone[z.name] = { left, top, zs };
        ix += zs.width + LAYOUT.outerColGap;
      });
    }
  });

  const platformBoundary = hasBoundary ? {
    left: boundaryLeft, right: boundaryRight, top: boundaryTop, bottom: boundaryBottom,
  } : null;

  // ── place node cards within each zone ──
  const nodeRects = [];
  const subColRects = [];
  const subColIndexByNode = {};
  zones.forEach(z => {
    const p = placedByZone[z.name]; if (!p) return;
    const zi = zoneInfo[z.name];
    const containerChain = zoneContainerId[z.name] != null ? containerLayout.chainOf(zoneContainerId[z.name]) : [];
    const { cw, cg } = p.zs;
    const bodyLeft = p.left + ZONE.border + ZONE.bodyPad;
    const bodyTop = p.top + ZONE.border + ZONE.stripe + ZONE.headerMinHeight + ZONE.bodyPad;
    // y offset per row band
    const rowTop = {};
    let acc = 0;
    // global row table (covers real rows + dummy lane rows below the box)
    for (let r = 0; r <= globalMaxRow; r++) { rowTop[r] = bodyTop + acc; acc += (rowBand[r] || 0) + ZONE.rowGap; }

    const subAccum = {}; // subColIdx -> rect accumulator
    (z.node_ids || []).forEach(id => {
      const c = zi.col[id] || 0;
      const r = zi.rowIdx[id] || 0;
      const bandH = (rowBand[r] || (size[id] ? size[id].h : 0));
      let left = bodyLeft + c * (cw + cg);
      let right = left + cw;
      if (isDummy[id]) { const mid = left + cw / 2; left = mid - DUMMY_W / 2; right = mid + DUMMY_W / 2; }
      const top = rowTop[r];
      const rect = { id, zoneName: z.name, col: c, rowIdx: r, dummy: !!isDummy[id], left, right, top, bottom: top + bandH, containerChain };
      nodeRects.push(rect);
      if (zi.subGroups) {
        const sidx = zi.subColOf[id];
        subColIndexByNode[id] = sidx;
        if (!subAccum[sidx]) subAccum[sidx] = { parentZoneName: z.name, nodeIds: [], left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
        const a = subAccum[sidx];
        a.nodeIds.push(id);
        a.left = Math.min(a.left, rect.left); a.right = Math.max(a.right, rect.right);
        a.top = Math.min(a.top, rect.top); a.bottom = Math.max(a.bottom, rect.bottom);
      }
    });
    Object.keys(subAccum).forEach(k => { subColRects.push(subAccum[k]); });
  });

  // subColIdx onto nodeRects, indexing into subColRects
  const subColRectIndexByNode = {};
  subColRects.forEach((sc, idx) => sc.nodeIds.forEach(id => { subColRectIndexByNode[id] = idx; }));
  nodeRects.forEach(nr => { nr.subColIdx = subColRectIndexByNode[nr.id]; });

  const nodeRectsById = {};
  nodeRects.forEach(nr => { nodeRectsById[nr.id] = nr; });

  // zone gaps (sorted by left)
  const sortedZR = zoneRects.slice().sort((a, b) => a.left - b.left);
  const zoneGaps = [];
  for (let i = 0; i < sortedZR.length - 1; i++) {
    const lz = sortedZR[i], rz = sortedZR[i + 1];
    if (rz.left > lz.right) zoneGaps.push({ left: lz.right, right: rz.left, center: (lz.right + rz.left) / 2 });
  }

  // extend the platform boundary to enclose the dummy-lane bus channel that
  // sits below the (now compact) zone boxes -- only for dummy nodes that
  // actually live in an inside-the-boundary zone (row-wrap can place other
  // dummy lanes, e.g. in an outside column, on a completely different row).
  if (platformBoundary) {
    const insideZoneNames = {};
    units.forEach(u => { if (u.kind === 'boundary') u.zonesInBoundary.forEach(function (item) { insideZoneNames[item.z.name] = true; }); });
    let deepest = 0;
    nodeRects.forEach(nr => { if (nr.dummy && insideZoneNames[nr.zoneName] && nr.bottom > deepest) deepest = nr.bottom; });
    const need = deepest + LAYOUT.boundaryPadBottom + LAYOUT.boundaryBorder;
    if (deepest > 0 && need > platformBoundary.bottom) platformBoundary.bottom = need;
  }

  const width = maxOf(zoneRects.concat(containerRects).map(z => z.right), platformBoundary ? platformBoundary.right : 0);
  const height = maxOf(zoneRects.concat(containerRects).map(z => z.bottom), platformBoundary ? platformBoundary.bottom : 0);

  return {
    zones, rank, columns,
    nodeRects, nodeRectsById, zoneRects, subColRects, zoneGaps,
    platformBoundary, snowStart, snowEnd,
    containers: containerRects,
    edgeChains, isDummy,
    width, height,
  };
}


// ===== route.mjs =====
// route.mjs — DOM-free port of the viewer's renderConnectors edge router.
// Consumes the packed geometry (rects) and returns, per edge:
//   { source, target, points:[[x,y]...], d:"M..." , markerId }
//
// All routing functions are faithful ports of assets/viewer/index.html
// (routeOrthogonal / detourH / bridgedRoute / bridgeCollides / snapToGap /
// row-channel + rail-clearance checks / V-H crossing bumps). The only
// change is that geometry comes from `packed` instead of getBoundingClientRect,
// and paths are returned as data instead of drawn as SVG.

function route(model, packed, opts = {}) {
  const edges = model.edges || [];
  const { nodeRects, nodeRectsById, zoneRects, subColRects, zoneGaps, platformBoundary, edgeChains, containers } = packed;
  if (!edges.length) return [];

  const nodeIdToZoneName = {}; nodeRects.forEach(nr => { nodeIdToZoneName[nr.id] = nr.zoneName; });
  const nodeIdToSubColIdx = {}; nodeRects.forEach(nr => { if (nr.subColIdx != null) nodeIdToSubColIdx[nr.id] = nr.subColIdx; });
  const zoneRectByName = {}; zoneRects.forEach(z => { zoneRectByName[z.name] = z; });
  // Phase 2: nested containers -- a node's full ancestor chain (immediate
  // container up through the outermost one), so an edge starting/ending
  // inside a container is never blocked by that container's OWN wall, only
  // by OTHER, unrelated container boxes it happens to pass near.
  const nodeIdToContainerChain = {};
  nodeRects.forEach(nr => { nodeIdToContainerChain[nr.id] = nr.containerChain || []; });
  const containerRects = containers || [];

  // ── snapToGap ──
  function snapToGap(trackX, x1, x2) {
    let inside = false;
    for (const zr of zoneRects) { if (trackX > zr.left + 2 && trackX < zr.right - 2) { inside = true; break; } }
    if (!inside) return trackX;
    const loX = Math.min(x1, x2), hiX = Math.max(x1, x2);
    const cands = zoneGaps.filter(g => g.center >= loX - 4 && g.center <= hiX + 4);
    if (!cands.length) return trackX;
    let best = cands[0], bd = Math.abs(cands[0].center - trackX);
    for (let k = 1; k < cands.length; k++) { const d = Math.abs(cands[k].center - trackX); if (d < bd) { best = cands[k]; bd = d; } }
    return best.center;
  }

  // Used by the "vertical V-H-V" branch below (edges whose zones are
  // primarily separated vertically -- routine once row-wrapping puts
  // rank-adjacent zones on different physical rows): checks a candidate
  // vertical leg at a fixed X for any zone/card/container obstacle in its
  // way, so that branch can fall back to the fully obstacle-aware
  // routeOrthogonal instead of sailing straight through something.
  function verticalSegmentClear(x, ya, yb, excludeZoneNames, excludeCardIds, excludeContainerChain) {
    const loY = Math.min(ya, yb), hiY = Math.max(ya, yb);
    for (const zr of zoneRects) {
      if (excludeZoneNames.indexOf(zr.name) !== -1) continue;
      if (x <= zr.left + 2 || x >= zr.right - 2) continue;
      if (zr.bottom < loY + 2 || zr.top > hiY - 2) continue;
      return false;
    }
    for (const nr of nodeRects) {
      if (excludeCardIds.indexOf(nr.id) !== -1) continue;
      if (x <= nr.left + 2 || x >= nr.right - 2) continue;
      if (nr.bottom < loY + 2 || nr.top > hiY - 2) continue;
      return false;
    }
    for (const cr of containerRects) {
      if (excludeContainerChain.indexOf(cr.id) !== -1) continue;
      if (x <= cr.left + 2 || x >= cr.right - 2) continue;
      if (cr.bottom < loY + 2 || cr.top > hiY - 2) continue;
      return false;
    }
    return true;
  }

  function pointsToD(pts) {
    if (!pts.length) return '';
    let s = 'M' + pts[0][0] + ',' + pts[0][1];
    for (let i = 1; i < pts.length; i++) s += ' L' + pts[i][0] + ',' + pts[i][1];
    return s;
  }

  // Phase 2: route a layer-spanning edge as a straight orthogonal spine in its
  // reserved lane. Drop into the inter-zone GAP just outside the source (clear
  // of cards), traverse at the lane y (a reserved/clear row), then climb in the
  // gap just before the target. Never runs horizontally at a card's row inside
  // an intermediate zone, so it cannot cross a card.
  function spineThroughChain(s, t, rects) {
    const sCx = (s.left + s.right) / 2, tCx = (t.left + t.right) / 2;
    const goingRight = tCx >= sCx;
    const laneY = (rects[0].top + rects[0].bottom) / 2;
    const sy = (s.top + s.bottom) / 2, ty = (t.top + t.bottom) / 2;
    const sx = goingRight ? s.right : s.left;
    const ex = goingRight ? t.left : t.right;
    const firstD = rects[0], lastD = rects[rects.length - 1];
    const dropX = goingRight ? (s.right + firstD.left) / 2 : (s.left + firstD.right) / 2;
    const climbX = goingRight ? (lastD.right + t.left) / 2 : (lastD.left + t.right) / 2;
    const pts = [[sx, sy]];
    if (Math.abs(dropX - sx) > 0.5) pts.push([dropX, sy]);
    pts.push([dropX, laneY]);
    pts.push([climbX, laneY]);
    pts.push([climbX, ty]);
    pts.push([ex, ty]);
    return pts;
  }

  // ── routeOrthogonal (cross-zone obstacle-aware) ──
  function routeOrthogonal(x1, y1, x2, y2, trackX, srcId, tgtId) {
    const srcZoneName = nodeIdToZoneName[srcId] || '';
    const tgtZoneName = nodeIdToZoneName[tgtId] || '';
    const srcSubIdx = nodeIdToSubColIdx[srcId];
    const tgtSubIdx = nodeIdToSubColIdx[tgtId];
    // Phase 2: containers the edge legitimately starts/ends inside (its own
    // wall and every ancestor's wall) never count as obstacles for this edge.
    const srcChain = nodeIdToContainerChain[srcId] || [];
    const tgtChain = nodeIdToContainerChain[tgtId] || [];
    function containerHitsOn(loX, hiX, y) {
      const hits = [];
      for (const cr of containerRects) {
        if (srcChain.indexOf(cr.id) !== -1 || tgtChain.indexOf(cr.id) !== -1) continue;
        if (y <= cr.top + 2 || y >= cr.bottom - 2) continue;
        if (cr.right < loX + 2 || cr.left > hiX - 2) continue;
        hits.push(cr);
      }
      return hits;
    }

    function zonesOnH(xa, xb, y) {
      const loX = Math.min(xa, xb), hiX = Math.max(xa, xb);
      const hits = [];
      for (const zr of zoneRects) {
        if (zr.name === srcZoneName || zr.name === tgtZoneName) continue;
        if (y <= zr.top + 2 || y >= zr.bottom - 2) continue;
        if (zr.right < loX + 2 || zr.left > hiX - 2) continue;
        hits.push(zr);
      }
      for (let s = 0; s < subColRects.length; s++) {
        if (s === srcSubIdx || s === tgtSubIdx) continue;
        const sc = subColRects[s];
        if (y <= sc.top + 2 || y >= sc.bottom - 2) continue;
        if (sc.right < loX + 2 || sc.left > hiX - 2) continue;
        hits.push(sc);
      }
      containerHitsOn(loX, hiX, y).forEach(cr => hits.push(cr));
      return hits;
    }
    function cardsOnH(xa, xb, y) {
      const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
      const hits = [];
      for (const nr of nodeRects) {
        if (nr.id === srcId || nr.id === tgtId) continue;
        if (y <= nr.top + 2 || y >= nr.bottom - 2) continue;
        if (nr.right < lo + 2 || nr.left > hi - 2) continue;
        hits.push(nr);
      }
      return hits;
    }

    const zHits1 = zonesOnH(x1, trackX, y1);
    const zHits2 = zonesOnH(trackX, x2, y2);
    const cHits1 = cardsOnH(x1, trackX, y1);
    const cHits2 = cardsOnH(trackX, x2, y2);

    // Thorough obstacle scan across the FULL rectangle spanned by the path
    // (not just narrow slices at y1/y2) -- this is what actually protects
    // the long vertical middle leg of an H-V-H path. The zHits/cHits checks
    // above only see obstacles exactly at the two endpoints' heights, so a
    // long vertical run (e.g. between two very different wrapped rows) with
    // clear ends but something in the middle used to sail straight through
    // it undetected.
    const goingRight = (x2 > x1);
    const loX = Math.min(x1, x2), hiX = Math.max(x1, x2);
    const pathTopBand = Math.min(y1, y2), pathBotBand = Math.max(y1, y2);
    const allZoneHits = [];
    for (const zr2 of zoneRects) {
      if (zr2.name === srcZoneName || zr2.name === tgtZoneName) continue;
      if (zr2.right < loX + 2 || zr2.left > hiX - 2) continue;
      const overlaps = !(zr2.bottom < pathTopBand || zr2.top > pathBotBand);
      const e1 = zr2.top < y1 && zr2.bottom > y1, e2 = zr2.top < y2 && zr2.bottom > y2;
      if (!overlaps && !e1 && !e2) continue;
      allZoneHits.push(zr2);
    }
    for (let sci = 0; sci < subColRects.length; sci++) {
      if (sci === srcSubIdx || sci === tgtSubIdx) continue;
      const sc2 = subColRects[sci];
      if (sc2.right < loX + 2 || sc2.left > hiX - 2) continue;
      const o = !(sc2.bottom < pathTopBand || sc2.top > pathBotBand);
      const e1 = sc2.top < y1 && sc2.bottom > y1, e2 = sc2.top < y2 && sc2.bottom > y2;
      if (!o && !e1 && !e2) continue;
      allZoneHits.push(sc2);
    }
    for (const cr3 of containerRects) {
      if (srcChain.indexOf(cr3.id) !== -1 || tgtChain.indexOf(cr3.id) !== -1) continue;
      if (cr3.right < loX + 2 || cr3.left > hiX - 2) continue;
      const o = !(cr3.bottom < pathTopBand || cr3.top > pathBotBand);
      const e1 = cr3.top < y1 && cr3.bottom > y1, e2 = cr3.top < y2 && cr3.bottom > y2;
      if (!o && !e1 && !e2) continue;
      allZoneHits.push(cr3);
    }
    // Individual cards too (defense in depth beyond their enclosing zone
    // rect -- e.g. a card whose own zone rect happens to sit right at the
    // band edge and got excluded by the +/-2px tolerance above).
    const allCardHits = [];
    for (const nr of nodeRects) {
      if (nr.id === srcId || nr.id === tgtId) continue;
      if (nr.right < loX + 2 || nr.left > hiX - 2) continue;
      const o = !(nr.bottom < pathTopBand || nr.top > pathBotBand);
      const e1 = nr.top < y1 && nr.bottom > y1, e2 = nr.top < y2 && nr.bottom > y2;
      if (!o && !e1 && !e2) continue;
      allCardHits.push(nr);
    }

    if (!allZoneHits.length && !allCardHits.length) {
      return [[x1, y1], [trackX, y1], [trackX, y2], [x2, y2]];
    }
    allCardHits.forEach(c => { if (allZoneHits.indexOf(c) < 0) allZoneHits.push(c); });
    if (!allZoneHits.length) {
      zHits1.forEach(z => allZoneHits.push(z));
      zHits2.forEach(z => { if (allZoneHits.indexOf(z) < 0) allZoneHits.push(z); });
    }
    if (!allZoneHits.length) {
      cHits1.concat(cHits2).forEach(c => { if (allZoneHits.indexOf(c) < 0) allZoneHits.push(c); });
    }

    const clearance = 24;

    let minTop = allZoneHits[0].top, maxBottom = allZoneHits[0].bottom;
    for (let j = 1; j < allZoneHits.length; j++) { if (allZoneHits[j].top < minTop) minTop = allZoneHits[j].top; if (allZoneHits[j].bottom > maxBottom) maxBottom = allZoneHits[j].bottom; }
    const aboveY = minTop - clearance, belowY = maxBottom + clearance;

    function buildRowChannels() {
      if (!nodeRects.length) return [];
      const rows = nodeRects.map(nr => ({ top: nr.top, bottom: nr.bottom, cy: (nr.top + nr.bottom) / 2 }));
      rows.sort((a, b) => a.cy - b.cy);
      const clusters = [];
      rows.forEach(r => {
        if (!clusters.length || (r.cy - clusters[clusters.length - 1].cy > 20)) clusters.push({ top: r.top, bottom: r.bottom, cy: r.cy });
        else { const last = clusters[clusters.length - 1]; if (r.top < last.top) last.top = r.top; if (r.bottom > last.bottom) last.bottom = r.bottom; last.cy = (last.top + last.bottom) / 2; }
      });
      const channels = [];
      for (let ci = 0; ci < clusters.length - 1; ci++) { const top = clusters[ci].bottom, bot = clusters[ci + 1].top; if (bot - top >= 12) channels.push((top + bot) / 2); }
      return channels;
    }
    const rowChannels = buildRowChannels();

    function railClearOfZones(railY) {
      if (zonesOnH(loX, hiX, railY).length !== 0) return false;
      const pad = 12;
      for (const nr of nodeRects) {
        if (nr.id === srcId || nr.id === tgtId) continue;
        if (nr.right < loX + 2 || nr.left > hiX - 2) continue;
        if (railY > nr.top - pad && railY < nr.bottom + pad) return false;
      }
      return true;
    }
    function railClearOfCards(railY) {
      for (const nr of nodeRects) {
        if (nr.id === srcId || nr.id === tgtId) continue;
        if (railY <= nr.top + 2 || railY >= nr.bottom - 2) continue;
        if (nr.right < loX + 2 || nr.left > hiX - 2) continue;
        return false;
      }
      return true;
    }
    function railInsideBoundary(railY) {
      if (!platformBoundary) return true;
      return railY > platformBoundary.top + 8 && railY < platformBoundary.bottom - 8;
    }

    let detourY;
    const refY = (y1 + y2) / 2;
    const belowOK = belowY > 0 && railClearOfZones(belowY) && railInsideBoundary(belowY);
    const aboveOK = aboveY > 0 && railClearOfZones(aboveY) && railInsideBoundary(aboveY);
    if (belowOK && aboveOK) detourY = (Math.abs(belowY - refY) <= Math.abs(aboveY - refY)) ? belowY : aboveY;
    else if (belowOK) detourY = belowY;
    else if (aboveOK) detourY = aboveY;
    else {
      let bestY = null, bestD = Infinity;
      for (const ry of rowChannels) { if (!railClearOfCards(ry)) continue; const d = Math.abs(ry - refY); if (d < bestD) { bestD = d; bestY = ry; } }
      if (bestY !== null) detourY = bestY;
      else { detourY = belowY; for (let step = 1; step <= 8 && !railClearOfZones(detourY); step++) detourY = maxBottom + clearance + step * 28; }
    }

    const clearanceX = 12;
    let obsLeft = Infinity, obsRight = -Infinity;
    for (const z of allZoneHits) { if (z.left < obsLeft) obsLeft = z.left; if (z.right > obsRight) obsRight = z.right; }
    const vYTop = Math.min(y1, y2, detourY), vYBot = Math.max(y1, y2, detourY);
    for (const nc of nodeRects) {
      if (nc.id === srcId || nc.id === tgtId) continue;
      if (nc.bottom < vYTop || nc.top > vYBot) continue;
      if (goingRight) { if (nc.right <= x1 || nc.left >= x2) continue; } else { if (nc.left >= x1 || nc.right <= x2) continue; }
      if (nc.left < obsLeft) obsLeft = nc.left; if (nc.right > obsRight) obsRight = nc.right;
    }
    const stubMin = 2;
    const tgtRect = nodeRectsById[tgtId];
    let tgtSqueezed = false;
    if (tgtRect) tgtSqueezed = goingRight ? (x2 - obsRight) < (stubMin + clearanceX) : (obsLeft - x2) < (stubMin + clearanceX);
    let enterX, exitX;
    if (goingRight) {
      enterX = Math.max(x1 + stubMin, Math.min(x1 + 28, obsLeft - clearanceX));
      exitX = tgtSqueezed ? (tgtRect.left + tgtRect.right) / 2 : Math.min(x2 - stubMin, Math.max(x2 - 28, obsRight + clearanceX));
      if (enterX > exitX) { enterX = x1 + stubMin; exitX = tgtSqueezed ? exitX : x2 - stubMin; }
    } else {
      enterX = Math.min(x1 - stubMin, Math.max(x1 - 28, obsRight + clearanceX));
      exitX = tgtSqueezed ? (tgtRect.left + tgtRect.right) / 2 : Math.max(x2 + stubMin, Math.min(x2 + 28, obsLeft - clearanceX));
      if (enterX < exitX) { enterX = x1 - stubMin; exitX = tgtSqueezed ? exitX : x2 + stubMin; }
    }
    if (tgtSqueezed && tgtRect) {
      const endY = (detourY < y2) ? tgtRect.top : tgtRect.bottom;
      return [[x1, y1], [enterX, y1], [enterX, detourY], [exitX, detourY], [exitX, endY]];
    }
    return [[x1, y1], [enterX, y1], [enterX, detourY], [exitX, detourY], [exitX, y2], [x2, y2]];
  }

  // ── helpers reading packed rects ──
  const cy = (nr) => (nr.top + nr.bottom) / 2;

  // ── Pre-pass: gap/V-track/H-track allocation ──
  const gapEdges = {}, gapIndex = {}, gapKey = {}, gapCounts = {};
  const vGapEdges = {}, vGapIndex = {}, vGapKey = {}, vGapCounts = {};
  const nodeOutCount = {}, nodeOutIdx = {}, nodeInCount = {}, nodeInIdx = {};
  edges.forEach((edge, idx) => {
    const s = nodeRectsById[edge.source], t = nodeRectsById[edge.target];
    if (!s || !t) return;
    const sz = s.zoneName, tz = t.zoneName;
    if (sz === tz) {
      // still count fan-out/in for intra? viewer counts only cross-zone for tracks
    }
    if (sz && tz && sz !== tz) {
      const key = sz + '|' + tz;
      const srcCy = cy(s), tgtCy = cy(t);
      (gapEdges[key] = gapEdges[key] || []).push({ idx, avgY: (srcCy + tgtCy) / 2 });
      gapKey[idx] = key;
      const rowDiff = Math.abs(s.rowIdx - t.rowIdx);
      if (rowDiff >= 1) {
        (vGapEdges[key] = vGapEdges[key] || []).push({ idx, avgY: (srcCy + tgtCy) / 2, srcY: srcCy, tgtY: tgtCy });
        vGapKey[idx] = key;
      }
    }
    nodeOutIdx[idx] = (nodeOutCount[edge.source] = (nodeOutCount[edge.source] || 0));
    nodeOutCount[edge.source]++;
    nodeInIdx[idx] = (nodeInCount[edge.target] = (nodeInCount[edge.target] || 0));
    nodeInCount[edge.target]++;
  });
  Object.keys(gapEdges).forEach(key => { const g = gapEdges[key]; g.sort((a, b) => a.avgY - b.avgY); gapCounts[key] = g.length; g.forEach((it, i) => { gapIndex[it.idx] = i; }); });
  Object.keys(vGapEdges).forEach(key => {
    const g = vGapEdges[key]; const Y = 30;
    g.sort((a, b) => { if (Math.abs(a.tgtY - b.srcY) < Y) return 1; if (Math.abs(a.srcY - b.tgtY) < Y) return -1; return a.avgY - b.avgY; });
    vGapCounts[key] = g.length; g.forEach((it, i) => { vGapIndex[it.idx] = i; });
  });

  const hTrackKey = {}, hTrackIndex = {}, hTrackCounts = {}, hTrackEdges = {};
  edges.forEach((edge, idx) => {
    if ((nodeOutCount[edge.source] || 0) <= 1 || (nodeInCount[edge.target] || 0) <= 1) return;
    const s = nodeRectsById[edge.source], t = nodeRectsById[edge.target];
    if (!s || !t || s.zoneName === t.zoneName) return;
    const key = s.zoneName + '|' + t.zoneName;
    (hTrackEdges[key] = hTrackEdges[key] || []).push({ idx, srcY: cy(s), tgtY: cy(t) });
    hTrackKey[idx] = key;
  });
  Object.keys(hTrackEdges).forEach(key => { const g = hTrackEdges[key]; g.sort((a, b) => (a.srcY - b.srcY) || (a.tgtY - b.tgtY)); hTrackCounts[key] = g.length; g.forEach((it, i) => { hTrackIndex[it.idx] = i; }); });

  // ── main per-edge routing ──
  const collected = [];
  edges.forEach((edge, edgeIdx) => {
    const s = nodeRectsById[edge.source], t = nodeRectsById[edge.target];
    if (!s || !t) return;
    const chain = edgeChains && edgeChains[edgeIdx];
    if (chain && chain.length) {
      const rects = chain.map(id => nodeRectsById[id]).filter(Boolean);
      // The dummy-chain spine assumes source, dummies, and target all sit on
      // one shared lane row within a SINGLE row of zones. Row-wrap can place
      // the dummies' zones on a different wrap-row than the source/target
      // (rank-adjacency and wrap-row are independent), which would draw the
      // spine's straight sweep through an unrelated row's cards. Guard: only
      // trust the spine when its lane sits plausibly between source and
      // target vertically; otherwise fall through to the general
      // obstacle-aware router below.
      if (rects.length) {
        const laneY = (rects[0].top + rects[0].bottom) / 2;
        const sy = cy(s), ty = cy(t);
        const tol = Math.max(s.bottom - s.top, t.bottom - t.top);
        const laneOnPath = laneY >= Math.min(sy, ty) - tol && laneY <= Math.max(sy, ty) + tol;
        if (laneOnPath) {
          const d = pointsToD(spineThroughChain(s, t, rects));
          collected.push({ source: edge.source, target: edge.target, d, markerId: 'arrowhead' });
          return;
        }
      }
    }
    const sameZone = s.zoneName === t.zoneName;
    let x1, y1, x2, y2, d;
    let arrowDir = 'right', useFixedArrow = false;

    if (sameZone) {
      const srcCol = s.col || 0, tgtCol = t.col || 0;
      if (srcCol !== tgtCol) {
        const dirRight = tgtCol > srcCol;
        if (dirRight) { x1 = s.right; x2 = t.left; } else { x1 = s.left; x2 = t.right; }
        y1 = cy(s); y2 = cy(t);
        let midX;
        if (dirRight) { midX = x1 + 28 + (edgeIdx % 4) * 5; if (midX > x2 - 18) midX = x2 - 18; }
        else { midX = x1 - 28 - (edgeIdx % 4) * 5; if (midX < x2 + 18) midX = x2 + 18; }
        d = (Math.abs(y2 - y1) < 1) ? ('M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2)
          : ('M' + x1 + ',' + y1 + ' L' + midX + ',' + y1 + ' L' + midX + ',' + y2 + ' L' + x2 + ',' + y2);
        useFixedArrow = true; arrowDir = dirRight ? 'right' : 'left';
      } else {
        // same sub-column vertical
        const srcRow = s.rowIdx, tgtRow = t.rowIdx;
        const rowGap = Math.abs(tgtRow - srcRow) || 1;
        const goingDown = tgtRow > srcRow || (tgtRow === srcRow && t.top > s.top);
        x1 = (s.left + s.right) / 2; x2 = (t.left + t.right) / 2;
        if (goingDown) { y1 = s.bottom; y2 = t.top; } else { y1 = s.top; y2 = t.bottom; }
        if (rowGap <= 1) {
          const hasReverse = edges.some(e2 => e2.source === edge.target && e2.target === edge.source);
          if (hasReverse) { const lane = goingDown ? -10 : 10; x1 += lane; x2 += lane; }
          d = 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2;
        } else {
          const sideOffset = 14 + (edgeIdx % 3) * 6;
          const sideX = s.right + sideOffset;
          const stubBendY = goingDown ? y1 + 14 : y1 - 14;
          const tgtRightEdge = t.right, tgtCenterY = cy(t);
          d = 'M' + x1 + ',' + y1 + ' L' + x1 + ',' + stubBendY + ' L' + sideX + ',' + stubBendY + ' L' + sideX + ',' + tgtCenterY + ' L' + tgtRightEdge + ',' + tgtCenterY;
          useFixedArrow = true; arrowDir = 'left';
        }
      }
    } else {
      const sz = zoneRectByName[s.zoneName], tz = zoneRectByName[t.zoneName];
      const srcNodeCy = cy(s), tgtNodeCy = cy(t);
      const srcZoneCx = (sz.left + sz.right) / 2, tgtZoneCx = (tz.left + tz.right) / 2;
      const horizontalGap = (tz.left > sz.right) || (sz.left > tz.right);
      const verticalGap = (tz.top > sz.bottom) || (sz.top > tz.bottom);
      // Diagonal case (row-wrap can place two zones on different wrap-rows
      // AND different columns): both gaps are real, so prefer whichever
      // corridor is actually clear/wider rather than defaulting to
      // horizontal, which used to sweep straight through an unrelated row's
      // cards when the vertical wrap-gutter was the safe path.
      const useHorizontal = (horizontalGap && verticalGap)
        ? (Math.abs(tgtZoneCx - srcZoneCx) >= Math.abs(tgtNodeCy - srcNodeCy))
        : (horizontalGap || (!verticalGap && Math.abs(tgtZoneCx - srcZoneCx) > 20));
      const edgeMargin = 8;

      if (useHorizontal) {
        const dx = tgtZoneCx - srcZoneCx;
        if (dx >= 0) { x1 = s.right + edgeMargin; x2 = t.left - edgeMargin; } else { x1 = s.left - edgeMargin; x2 = t.right + edgeMargin; }
        y1 = srcNodeCy; y2 = tgtNodeCy;
        if (dx >= 0 && x2 <= x1) x2 = x1 + 16;
        if (dx < 0 && x2 >= x1) x2 = x1 - 16;
        arrowDir = dx >= 0 ? 'right' : 'left';
        const rowDiff = Math.abs(s.rowIdx - t.rowIdx);
        const tgtFanIn = nodeInCount[edge.target] || 1;
        const fanInStubX = dx >= 0 ? (x2 - 24) : (x2 + 24);
        const srcFanOut = nodeOutCount[edge.source] || 1;
        const fanOutStubX = dx >= 0 ? (x1 + 24) : (x1 - 24);

        let candidateMidY;
        {
          const hKey = hTrackKey[edgeIdx];
          const hTotal = hKey ? (hTrackCounts[hKey] || 1) : 1;
          const hIdx = hTrackIndex[edgeIdx] !== undefined ? hTrackIndex[edgeIdx] : 0;
          if (hTotal > 1) { const bt = Math.min(y1, y2) + 16, bb = Math.max(y1, y2) - 16; candidateMidY = (bb > bt) ? bt + (bb - bt) * (hIdx + 1) / (hTotal + 1) : (y1 + y2) / 2; }
          else candidateMidY = (y1 + y2) / 2;
        }
        function bridgeCollides(stubSrc, stubTgt, midY) {
          const lo = Math.min(stubSrc, stubTgt), hi = Math.max(stubSrc, stubTgt);
          const hHalo = 8, vHalo = 12;
          const vTopSrc = Math.min(y1, midY), vBotSrc = Math.max(y1, midY);
          const vTopTgt = Math.min(y2, midY), vBotTgt = Math.max(y2, midY);
          for (const nr of nodeRects) {
            if (nr.id === edge.source || nr.id === edge.target) continue;
            if (nr.right >= lo + 2 && nr.left <= hi - 2 && midY > nr.top - hHalo && midY < nr.bottom + hHalo) return true;
            if (stubSrc > nr.left - vHalo && stubSrc < nr.right + vHalo && vBotSrc > nr.top + 2 && vTopSrc < nr.bottom - 2) return true;
            if (stubTgt > nr.left - vHalo && stubTgt < nr.right + vHalo && vBotTgt > nr.top + 2 && vTopTgt < nr.bottom - 2) return true;
          }
          return false;
        }
        function bridgedRoute(bx1, by1, bx2, by2, stubSrc, stubTgt) {
          let midY;
          const hKey = hTrackKey[edgeIdx];
          const hTotal = hKey ? (hTrackCounts[hKey] || 1) : 1;
          const hIdx = hTrackIndex[edgeIdx] !== undefined ? hTrackIndex[edgeIdx] : 0;
          if (hTotal > 1) { const bt = Math.min(by1, by2) + 16, bb = Math.max(by1, by2) - 16; midY = (bb > bt) ? bt + (bb - bt) * (hIdx + 1) / (hTotal + 1) : (by1 + by2) / 2; }
          else midY = (by1 + by2) / 2;
          return 'M' + bx1 + ',' + by1 + ' L' + stubSrc + ',' + by1 + ' L' + stubSrc + ',' + midY + ' L' + stubTgt + ',' + midY + ' L' + stubTgt + ',' + by2 + ' L' + bx2 + ',' + by2;
        }
        const useBridged = (srcFanOut > 1 && tgtFanIn > 1 && Math.abs(fanOutStubX - fanInStubX) > 8 && !bridgeCollides(fanOutStubX, fanInStubX, candidateMidY));

        if (rowDiff === 0 && Math.abs(y1 - y2) < 1) {
          d = pointsToD(routeOrthogonal(x1, y1, x2, y2, (x1 + x2) / 2, edge.source, edge.target));
        } else if (useBridged) {
          d = bridgedRoute(x1, y1, x2, y2, fanOutStubX, fanInStubX);
        } else if (rowDiff === 0) {
          let stubX;
          if (tgtFanIn > 1) stubX = fanInStubX; else if (srcFanOut > 1) stubX = fanOutStubX; else stubX = snapToGap((x1 + x2) / 2, x1, x2);
          d = pointsToD(routeOrthogonal(x1, y1, x2, y2, stubX, edge.source, edge.target));
        } else {
          const vKey = vGapKey[edgeIdx];
          const vTotal = vKey ? (vGapCounts[vKey] || 1) : 1;
          const vIdx = vGapIndex[edgeIdx] !== undefined ? vGapIndex[edgeIdx] : 0;
          const minX = Math.min(x1, x2) + 4, maxX = Math.max(x1, x2) - 4;
          let stubX;
          if (tgtFanIn > 1) stubX = fanInStubX;
          else if (srcFanOut > 1) stubX = fanOutStubX;
          else if (maxX > minX) { stubX = minX + (maxX - minX) * (vIdx + 1) / (vTotal + 1); stubX = snapToGap(stubX, x1, x2); }
          else stubX = (x1 + x2) / 2;
          d = pointsToD(routeOrthogonal(x1, y1, x2, y2, stubX, edge.source, edge.target));
        }
      } else {
        // vertical V-H-V
        const dy = tgtNodeCy - srcNodeCy;
        if (dy >= 0) { y1 = s.bottom + edgeMargin; y2 = t.top - edgeMargin; } else { y1 = s.top - edgeMargin; y2 = t.bottom + edgeMargin; }
        x1 = (s.left + s.right) / 2; x2 = (t.left + t.right) / 2;
        if (dy >= 0 && y2 <= y1) y2 = y1 + 16;
        if (dy < 0 && y2 >= y1) y2 = y1 - 16;
        const vGapTop = (dy >= 0 ? sz.bottom : tz.bottom);
        const vGapBot = (dy >= 0 ? tz.top : sz.top);
        const vGapHeight = vGapBot - vGapTop;
        const eKey = gapKey[edgeIdx];
        const total = eKey ? (gapCounts[eKey] || 1) : 1;
        const idx = gapIndex[edgeIdx] !== undefined ? gapIndex[edgeIdx] : 0;
        const turnY = vGapTop + vGapHeight * (idx + 1) / (total + 1);
        const srcChainV = nodeIdToContainerChain[edge.source] || [];
        const tgtChainV = nodeIdToContainerChain[edge.target] || [];
        const legAClear = verticalSegmentClear(x1, y1, turnY, [s.zoneName], [edge.source, edge.target], srcChainV);
        const legBClear = verticalSegmentClear(x2, turnY, y2, [t.zoneName], [edge.source, edge.target], tgtChainV);
        if (legAClear && legBClear) {
          d = 'M' + x1 + ',' + y1 + ' L' + x1 + ',' + turnY + ' L' + x2 + ',' + turnY + ' L' + x2 + ',' + y2;
        } else {
          // A vertical leg here would cut through something (typically a
          // zone/card left behind on a different wrapped row) -- fall back
          // to the fully obstacle-aware H-V-H router instead.
          const fx1 = x1 < x2 ? s.right + edgeMargin : s.left - edgeMargin;
          const fx2 = x1 < x2 ? t.left - edgeMargin : t.right + edgeMargin;
          const fy1 = cy(s), fy2 = cy(t);
          const fTrackX = snapToGap((fx1 + fx2) / 2, fx1, fx2);
          d = pointsToD(routeOrthogonal(fx1, fy1, fx2, fy2, fTrackX, edge.source, edge.target));
        }
      }
    }

    const markerId = useFixedArrow ? (arrowDir === 'left' ? 'arrowhead-left' : 'arrowhead-right') : 'arrowhead';
    collected.push({ source: edge.source, target: edge.target, d, markerId });
  });

  // ── V-H crossing bumps + final path ──
  function parsePath(d) {
    const pts = [];
    d.split(/[ML]\s*/).forEach(seg => { seg = seg.trim(); if (!seg) return; const p = seg.split(','); if (p.length === 2) pts.push([parseFloat(p[0]), parseFloat(p[1])]); });
    return pts;
  }
  collected.forEach(p => { p.points = parsePath(p.d); p.bumps = []; });

  // ── Final safety net: repair any card/zone/container crossing left by
  // whichever branch produced this edge's path. The branches above each
  // make LOCAL decisions (rail selection, chain spines, zone-center
  // shortcuts, etc.) checked against only the obstacle set THAT branch
  // happened to consider -- e.g. a chosen detour row can be clear of
  // everything within the edge's original y-range yet still cut through a
  // card that lives further out once the detour extends past it. This pass
  // re-validates every segment against the actual, global obstacle set and
  // nudges just the offending segment sideways, regardless of which branch
  // produced it. Bounded passes: never loops forever, and if a segment truly
  // can't be resolved it's left as-is (assessQuality/the Layout Quality Gate
  // is the backstop that discloses this rather than hiding it).
  function segCrossesRect(x1, y1, x2, y2, rect) {
    const lo = { x: Math.min(x1, x2), y: Math.min(y1, y2) };
    const hi = { x: Math.max(x1, x2), y: Math.max(y1, y2) };
    return !(hi.x <= rect.left + 1 || lo.x >= rect.right - 1 || hi.y <= rect.top + 1 || lo.y >= rect.bottom - 1);
  }
  const REPAIR_CLEARANCE = 10;
  for (let pass = 0; pass < 4; pass++) {
    let fixedAny = false;
    collected.forEach(item => {
      const srcId = item.source, tgtId = item.target;
      const srcZoneName = nodeIdToZoneName[srcId] || '';
      const tgtZoneName = nodeIdToZoneName[tgtId] || '';
      const srcChainR = nodeIdToContainerChain[srcId] || [];
      const tgtChainR = nodeIdToContainerChain[tgtId] || [];
      const pts = item.points;
      for (let si = 0; si < pts.length - 1; si++) {
        const x1s = pts[si][0], y1s = pts[si][1], x2s = pts[si + 1][0], y2s = pts[si + 1][1];
        const vertical = Math.abs(x1s - x2s) < 0.5 && Math.abs(y1s - y2s) >= 0.5;
        const horizontal = Math.abs(y1s - y2s) < 0.5 && Math.abs(x1s - x2s) >= 0.5;
        if (!vertical && !horizontal) continue;
        let hit = null;
        for (const nr of nodeRects) {
          if (nr.id === srcId || nr.id === tgtId) continue;
          if (segCrossesRect(x1s, y1s, x2s, y2s, nr)) { hit = nr; break; }
        }
        if (!hit) {
          for (const zr of zoneRects) {
            if (zr.name === srcZoneName || zr.name === tgtZoneName) continue;
            if (segCrossesRect(x1s, y1s, x2s, y2s, zr)) { hit = zr; break; }
          }
        }
        if (!hit) {
          for (const cr of containerRects) {
            if (srcChainR.indexOf(cr.id) !== -1 || tgtChainR.indexOf(cr.id) !== -1) continue;
            if (segCrossesRect(x1s, y1s, x2s, y2s, cr)) { hit = cr; break; }
          }
        }
        if (!hit) continue;
        if (vertical) {
          const shiftLeft = hit.left - REPAIR_CLEARANCE, shiftRight = hit.right + REPAIR_CLEARANCE;
          const newX = Math.abs(shiftLeft - x1s) <= Math.abs(shiftRight - x1s) ? shiftLeft : shiftRight;
          pts[si][0] = newX; pts[si + 1][0] = newX;
        } else {
          const shiftUp = hit.top - REPAIR_CLEARANCE, shiftDown = hit.bottom + REPAIR_CLEARANCE;
          const newY = Math.abs(shiftUp - y1s) <= Math.abs(shiftDown - y1s) ? shiftUp : shiftDown;
          pts[si][1] = newY; pts[si + 1][1] = newY;
        }
        fixedAny = true;
      }
    });
    if (!fixedAny) break;
  }

  for (let i = 0; i < collected.length; i++) {
    const A = collected[i];
    for (let sa = 0; sa < A.points.length - 1; sa++) {
      const a1 = A.points[sa], a2 = A.points[sa + 1];
      if (Math.abs(a1[0] - a2[0]) > 0.5) continue;
      const vx = a1[0], vyMin = Math.min(a1[1], a2[1]), vyMax = Math.max(a1[1], a2[1]);
      for (let j = 0; j < collected.length; j++) {
        if (j === i) continue;
        const B = collected[j];
        for (let sb = 0; sb < B.points.length - 1; sb++) {
          const b1 = B.points[sb], b2 = B.points[sb + 1];
          if (Math.abs(b1[1] - b2[1]) > 0.5) continue;
          const hy = b1[1], hxMin = Math.min(b1[0], b2[0]), hxMax = Math.max(b1[0], b2[0]);
          if (vx > hxMin + 1 && vx < hxMax - 1 && hy > vyMin + 1 && hy < vyMax - 1) A.bumps.push({ segIdx: sa, y: hy });
        }
      }
    }
  }
  function buildPathD(points, bumps) {
    let d = 'M' + points[0][0] + ',' + points[0][1];
    const r = 5;
    for (let s = 0; s < points.length - 1; s++) {
      const p1 = points[s], p2 = points[s + 1];
      let segBumps = bumps.filter(b => b.segIdx === s).map(b => b.y);
      if (Math.abs(p1[0] - p2[0]) < 0.5 && segBumps.length > 0) {
        const goingDown = p2[1] > p1[1];
        segBumps.sort((a, b) => goingDown ? a - b : b - a);
        const dedup = [];
        for (let bi = 0; bi < segBumps.length; bi++) if (!dedup.length || Math.abs(segBumps[bi] - dedup[dedup.length - 1]) > r * 2) dedup.push(segBumps[bi]);
        segBumps = dedup;
        const x = p1[0], sweep = goingDown ? 1 : 0;
        segBumps.forEach(by => { const bY = goingDown ? by - r : by + r; const aY = goingDown ? by + r : by - r; d += ' L' + x + ',' + bY; d += ' A' + r + ',' + r + ' 0 0 ' + sweep + ' ' + x + ',' + aY; });
        d += ' L' + p2[0] + ',' + p2[1];
      } else d += ' L' + p2[0] + ',' + p2[1];
    }
    return d;
  }
  collected.forEach(p => { p.d = buildPathD(p.points, p.bumps); });

  return collected.map(p => ({ source: p.source, target: p.target, points: p.points, d: p.d, markerId: p.markerId }));
}


// ===== quality.mjs =====
// quality.mjs — generic, style-agnostic layout-quality checks computed
// purely from packed/routed geometry (no rendering required). Deliberately
// does NOT dictate any particular visual arrangement -- it only flags
// objectively bad geometry (unbounded aspect ratio, connector/card
// crossings, mostly-empty canvas), so any clean layout shape passes.
//
// Used by: (1) tests/run.mjs as reusable invariants instead of duplicated
// logic, (2) index.mjs, which attaches the result to every layout() call so
// a caller (e.g. the GENERATE_DIAGRAM_ARTIFACTS proc) can inspect it with no
// extra SVG round-trip, and (3), eventually, the live agent's Layout Quality
// Gate to decide whether to retry with adjusted zone/layer/consolidation
// hints (see docs/AGENT_TOOL_SNIPPET.yaml — Phase 4b, not this file).

// segment vs rect-interior crossing (with tolerance) — same definition the
// test suite already used for "0 card crossings".
function segCrossesRect(p1, p2, r, tol = 2) {
  const x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
  const L = r.x + tol, R = r.x + r.w - tol, T = r.y + tol, B = r.y + r.h - tol;
  if (R <= L || B <= T) return false;
  if (Math.abs(x1 - x2) < 0.5) { // vertical
    const x = x1; if (x <= L || x >= R) return false;
    const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    return lo < B && hi > T;
  }
  if (Math.abs(y1 - y2) < 0.5) { // horizontal
    const y = y1; if (y <= T || y >= B) return false;
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    return lo < R && hi > L;
  }
  return false; // diagonal (arcs) — ignore, matches the test suite's tolerance
}

// Thresholds are deliberately loose defaults, not "the" correct style — they
// exist to catch objectively bad geometry (the exact 16:1/unbounded-width
// and mostly-empty-canvas pathologies measured against the live agent), not
// to enforce a particular look. Override via opts if a caller has a
// different tolerance (e.g. a deliberately airy poster layout).
const DEFAULTS = {
  maxAspectRatio: 6,
  minPackingDensity: 0.03, // total card area / canvas area
};

function assessQuality(result, opts) {
  const cfg = Object.assign({}, DEFAULTS, opts || {});
  const nodes = result.nodes || [];
  const edges = result.edges || [];
  const width = result.width || 0;
  const height = result.height || 0;
  const issues = [];

  const aspectRatio = (width > 0 && height > 0) ? Math.max(width / height, height / width) : Infinity;
  if (aspectRatio > cfg.maxAspectRatio) {
    issues.push({ code: 'ASPECT_RATIO', detail: 'aspect=' + aspectRatio.toFixed(2) + ' exceeds ' + cfg.maxAspectRatio + ' (canvas is growing unboundedly in one dimension)' });
  }

  let cardCrossings = 0;
  edges.forEach(e => {
    const pts = e.points || [];
    for (let i = 0; i < pts.length - 1; i++) {
      nodes.forEach(n => {
        if (n.id === e.from || n.id === e.to) return;
        if (segCrossesRect(pts[i], pts[i + 1], n)) cardCrossings++;
      });
    }
  });
  if (cardCrossings > 0) {
    issues.push({ code: 'CARD_CROSSING', detail: cardCrossings + ' connector segment(s) cross a non-endpoint card' });
  }

  const totalCardArea = nodes.reduce((sum, n) => sum + (n.w || 0) * (n.h || 0), 0);
  const canvasArea = width * height;
  const packingDensity = canvasArea > 0 ? totalCardArea / canvasArea : 0;
  if (canvasArea > 0 && packingDensity < cfg.minPackingDensity) {
    issues.push({ code: 'SPARSE_CANVAS', detail: 'packing density=' + (packingDensity * 100).toFixed(1) + '% below ' + (cfg.minPackingDensity * 100) + '% (canvas is mostly empty space)' });
  }

  return {
    ok: issues.length === 0,
    issues,
    metrics: { width, height, aspectRatio, cardCrossings, packingDensity },
  };
}


// ===== index.mjs =====
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


function layout(input, opts = {}) {
  const model = toModel(input);
  // pass consolidation toggles through to the model if given in opts
  if (opts.consolidate === false) model.consolidate = false;
  if (opts.consolidate_sub_groups === true) model.consolidate_sub_groups = true;

  // nodeStyle ('wide' | null) may arrive via opts OR ride in the model JSON
  // (so the 1-arg UDF, which calls layout(input, {}), can still request wide
  // by setting model.nodeStyle). Thread it down to card measurement.
  const effOpts = { ...opts, nodeStyle: opts.nodeStyle || model.nodeStyle || null };

  const packed = pack(model, effOpts);
  const edges = route(model, packed, effOpts);

  const zoneByName = {};
  packed.zoneRects.forEach(z => { zoneByName[z.name] = z; });
  const zoneCategory = {};
  packed.zones.forEach(z => { zoneCategory[z.name] = z.category; });

  const result = {
    nodes: packed.nodeRects.filter(n => !n.dummy).map(n => ({
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
    // Phase 2: nested, arbitrary-depth grouping boxes (e.g. "AWS VPC"). Each
    // entry's parentId links it to its enclosing container (null if
    // top-level), so a render engine can draw outer boxes before inner ones.
    containers: (packed.containers || []).map(c => ({
      id: c.id, label: c.label, parentId: c.parentId,
      x: c.left, y: c.top, w: c.right - c.left, h: c.bottom - c.top,
    })),
    width: packed.width, height: packed.height,
  };
  // Generic, style-agnostic geometry quality check (Phase 4a) -- free to
  // compute here since all the geometry already exists; lets a caller (e.g.
  // GENERATE_DIAGRAM_ARTIFACTS) inspect result.quality without an extra SVG
  // round-trip, and is the same check tests/run.mjs uses as an invariant.
  result.quality = assessQuality(result, opts.qualityOpts);
  return result;
}



// ===== UDF entry point =====
// GRAPH_JSON: a JSON string of { nodes, edges, zones? } OR a mermaid string.
// Returns a JSON string: { nodes, edges, zones, platformBoundary, width, height }.
var __input;
try {
  __input = JSON.parse(GRAPH_JSON);
} catch (e) {
  // not JSON -> treat as a mermaid string
  __input = GRAPH_JSON;
}
try {
  return JSON.stringify(layout(__input, {}));
} catch (e) {
  return JSON.stringify({ error: String((e && e.message) || e), stack: (e && e.stack) ? String(e.stack) : null });
}
$$;
