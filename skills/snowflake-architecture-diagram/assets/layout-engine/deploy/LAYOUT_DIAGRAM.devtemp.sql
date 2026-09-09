-- =====================================================================
-- TEMP.ABANNERJEE.LAYOUT_DIAGRAM  (Cortex Agent custom tool)
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

CREATE OR REPLACE FUNCTION TEMP.ABANNERJEE.LAYOUT_DIAGRAM(GRAPH_JSON VARCHAR)
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
  // Icon's own vertical center, as an offset from the card's top edge --
  // fixed regardless of label length, since the icon always sits first
  // with the label/detail stacked below it. Routing uses this (rather than
  // the card's raw geometric center) to anchor left/right connector ports,
  // so they land on the icon's graphic instead of drifting into the label
  // text as labels get longer/wrap to more lines (found via direct SVG
  // coordinate measurement: a fan-out port offset pushed a connector's
  // terminal stub to land within 3px of a card's own label text, visually
  // striking through it).
  //
  // NOTE: this intentionally uses the hardcoded `+8` icon-top offset that
  // the vendored static-SVG renderer (_svg() in render_diagram_generated.py,
  // `iy = Y(y) + 8`) actually draws with -- NOT CARD.padTop (16). The two
  // constants describe different things: CARD.padTop is the interactive
  // HTML viewer's CSS padding (mirrored here for card *height* sizing),
  // while the static SVG export's icon placement is a separate, simpler
  // hand-rolled absolute offset that does not read CARD.padTop at all. Using
  // padTop here would anchor ports 8px below where the icon is actually
  // drawn, right back into the label row this fix exists to avoid.
  const iconCenterY = 8 + CARD.iconBox / 2;
  return { w, h: Math.round(h), iconCenterY, iconHalfHeight: CARD.iconBox / 2 };
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
  // Icon sits centered within the max(iconBox, textH) content band, so its
  // own vertical center coincides with that band's center -- see the narrow
  // measureNode's iconCenterY comment for why routing needs this.
  const iconCenterY = C.padTop + Math.max(C.iconBox, textH) / 2;
  return { w, h: Math.round(h), iconCenterY, iconHalfHeight: C.iconBox / 2 };
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
  dbt: 'onprem', airflow: 'onprem', fivetran: 'onprem', matillion: 'onprem',
  informatica: 'onprem', talend: 'onprem',
  // bridge (Snowflake-managed ingestion / connectivity)
  pipe: 'bridge', snowpipe: 'bridge', openflow: 'bridge', connector: 'bridge',
  secure_view: 'bridge',
  // snow (native)
  table: 'snow', dynamic_table: 'snow', view: 'snow', stream: 'snow',
  task: 'snow', warehouse: 'snow', stage: 'snow', schema: 'snow',
  cortex: 'snow', snowpark: 'snow', iceberg: 'snow', governance: 'snow',
  // outcome (native consumers)
  dashboard: 'outcome', app: 'outcome', agent: 'outcome', notebook: 'outcome',
  streamlit: 'outcome', user: 'outcome',
};

function categoryFrom(node) {
  if (node.category) return node.category;
  const t = String(node.componentType || node.object_type || '').toLowerCase();
  if (CATEGORY_BY_TYPE[t]) return CATEGORY_BY_TYPE[t];
  // boundary hint: 'external'/'outside' -> onprem; default snow
  const b = String(node.boundary || '').toLowerCase();
  if (b.includes('external') || b.includes('outside') || b.includes('source')) return 'onprem';
  // Generic vendor-prefix heuristic: any non-Snowflake cloud vendor's OWN
  // service (azure_*, aws_*, gcp_*, google_*) is virtually always outside
  // the Snowflake account boundary even when explicit metadata is missing
  // -- e.g. azure_synapse, azure_data_factory, aws_glue, gcp_dataflow.
  // This intentionally also covers azure_private_link/aws_privatelink:
  // that's network plumbing, not a Snowflake object -- 'bridge' above is
  // reserved for actual Snowflake-native ingestion services (Snowpipe).
  if (/^(azure|aws|gcp|google)_/.test(t)) return 'onprem';
  // Third-party BI/reporting tools are external consumers -- NOT the same
  // as a native Snowflake-served surface (Streamlit, Cortex agent), which
  // is what 'outcome' otherwise means (boundary-triggering, i.e. inside
  // the account). Power BI/Tableau/etc. sit outside it.
  if (/(power_?bi|tableau|looker|qlik|sigma)/.test(t)) return 'onprem';
  // A DIFFERENT/external Snowflake account (e.g. an inbound share
  // provider) is not part of THIS account's boundary either.
  if (t === 'snowflake_account') return 'onprem';
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
          subtitle: c.subtitle != null ? String(c.subtitle) : null,
          color: c.color != null ? String(c.color) : null,
          zone_names: Array.isArray(c.zone_names) ? c.zone_names.slice() : [],
          node_ids: Array.isArray(c.node_ids) ? c.node_ids.filter(id => nodeIdSet[id]) : [],
          container_ids: Array.isArray(c.container_ids) ? c.container_ids.map(String) : [],
          // A container can wrap the Snowflake platform boundary itself as
          // one of its children -- e.g. a "Microsoft Azure" container for a
          // Snowflake-on-Azure deployment, alongside the customer's own
          // same-cloud resources. At most one container should set this;
          // pack.mjs defensively ignores extras rather than erroring.
          include_platform_boundary: c.include_platform_boundary === true,
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
  // Boustrophedon (snake) reflow: mirror the left-right order of every ODD
  // row, so the item that continues the flow right after the last item of
  // the row above lands directly below it (a short vertical hop) instead
  // of restarting at the far-left edge of a fresh row. A strict
  // reading-order wrap forces any edge crossing a row boundary near the
  // END of one row to travel the full canvas width to reach the START of
  // the next -- this is exactly the "unintuitive jumble of connection
  // lines" a real SE/SA would never draw, flagged from a live-agent
  // render (the item ending row 1 on the far right had to connect all the
  // way back to the item starting row 2 on the far left).
  const byRow = {};
  items.forEach(u => { (byRow[u.rowIdx] = byRow[u.rowIdx] || []).push(u); });
  Object.keys(byRow).forEach(key => {
    if (Number(key) % 2 === 0) return; // even rows (0, 2, ...) keep left-to-right
    const reversed = byRow[key].slice().reverse();
    let x = 0;
    reversed.forEach(u => { u.xInRow = x; x += u.width + colGap; });
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
  return { rowYOffset, rowHeights, totalWidth, totalHeight, numRows: rowHeights.length };
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

// Refines the WITHIN-ROW order of a wrapUnits() result for zone-wrapping
// items (each item has a `.z.name`), by directly minimizing total weighted
// cross-row edge distance (sum, over every pair of zones in ADJACENT rows
// connected by >=1 real edge, of |sequence-index difference| * edge count).
// This REPLACES an earlier median/barycenter-heuristic version: verified by
// direct cost comparison (see CHANGELOG) that the median heuristic can
// converge to a WORSE arrangement than the simple "reverse every odd row"
// snake pattern already baked into wrapUnits, because each zone chasing
// its own median independently doesn't minimize the row's actual total
// edge length when neighbors compete for the same position -- median
// minimizes a different, per-item objective, not the sum we actually care
// about. Exhaustively tries every permutation for a row (rows are small --
// typically well under MAX_EXHAUSTIVE items -- so this is cheap and exact,
// not a heuristic approximation) with a greedy adjacent-swap fallback for
// unusually large rows. Only reorders WITHIN each row -- never moves an
// item to a different row -- so it can't break the bucket-contiguity the
// platform boundary depends on (see assignRanks' bucketOf comment).
function refineZoneRowOrderByEdgeLength(innerWrap, zonesInBoundary, edges, colGap) {
  if (innerWrap.numRows < 2) return; // nothing to align across rows

  const zoneOfNode = {};
  zonesInBoundary.forEach(item => (item.z.node_ids || []).forEach(id => { zoneOfNode[id] = item.z.name; }));
  const edgeWeight = {}; // "zoneA\u0000zoneB" (a<b) -> count of direct edges between them
  edges.forEach(e => {
    const sz = zoneOfNode[e.source], tz = zoneOfNode[e.target];
    if (!sz || !tz || sz === tz) return;
    const key = sz < tz ? sz + '\u0000' + tz : tz + '\u0000' + sz;
    edgeWeight[key] = (edgeWeight[key] || 0) + 1;
  });
  function weightBetween(a, b) {
    const key = a < b ? a + '\u0000' + b : b + '\u0000' + a;
    return edgeWeight[key] || 0;
  }

  const byRow = {};
  zonesInBoundary.forEach(item => { (byRow[item.rowIdx] = byRow[item.rowIdx] || []).push(item); });
  const rowKeys = Object.keys(byRow).map(Number).sort((a, b) => a - b);

  const posOf = {}; // zoneName -> current sequence index within its row
  rowKeys.forEach(r => byRow[r].forEach((item, i) => { posOf[item.z.name] = i; }));

  // Cost of placing `order` (a candidate arrangement of row r's items) given
  // the CURRENT (already-decided) positions of rows r-1 and r+1.
  function rowCost(r, order) {
    let total = 0;
    order.forEach((item, i) => {
      [r - 1, r + 1].forEach(nr => {
        if (!byRow[nr]) return;
        byRow[nr].forEach(other => {
          const w = weightBetween(item.z.name, other.z.name);
          if (w) total += w * Math.abs(i - posOf[other.z.name]);
        });
      });
    });
    return total;
  }

  function permutations(arr) {
    if (arr.length <= 1) return [arr];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      permutations(rest).forEach(p => out.push([arr[i]].concat(p)));
    }
    return out;
  }

  const MAX_EXHAUSTIVE = 7; // 7! = 5040 candidates -- negligible cost, always exact

  for (let pass = 0; pass < 6; pass++) {
    let anyChange = false;
    const passRows = pass % 2 === 0 ? rowKeys : rowKeys.slice().reverse();
    passRows.forEach(r => {
      let row = byRow[r];
      if (row.length < 2) return;
      if (row.length <= MAX_EXHAUSTIVE) {
        let best = row, bestCost = rowCost(r, row);
        permutations(row).forEach(perm => {
          const c = rowCost(r, perm);
          if (c < bestCost) { bestCost = c; best = perm; }
        });
        if (best !== row) { byRow[r] = row = best; anyChange = true; }
      } else {
        // Greedy adjacent-swap local search: cheap, not guaranteed globally
        // optimal, but converges quickly and only runs for unusually wide
        // rows where exhaustive search would be too slow.
        let improved = true;
        while (improved) {
          improved = false;
          for (let i = 0; i < row.length - 1; i++) {
            const swapped = row.slice();
            const tmp = swapped[i]; swapped[i] = swapped[i + 1]; swapped[i + 1] = tmp;
            if (rowCost(r, swapped) < rowCost(r, row)) { row = swapped; improved = true; anyChange = true; }
          }
        }
        byRow[r] = row;
      }
      row.forEach((item, i) => { posOf[item.z.name] = i; });
    });
    if (!anyChange) break;
  }

  // Recompute xInRow per row from the refined order (row membership,
  // heights and Y-offsets are all untouched -- only intra-row sequence
  // changed), then re-center each row exactly as wrapUnits itself does.
  rowKeys.forEach(r => { let x = 0; byRow[r].forEach(item => { item.xInRow = x; x += item.width + colGap; }); });
  const rowContentWidth = [];
  zonesInBoundary.forEach(item => { const right = item.xInRow + item.width; if (!(rowContentWidth[item.rowIdx] > right)) rowContentWidth[item.rowIdx] = right; });
  zonesInBoundary.forEach(item => { item.xInRow += (innerWrap.totalWidth - rowContentWidth[item.rowIdx]) / 2; });
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
function buildContainerLayout(rawContainers, preConsolidationZones, zones, rank, zoneSize, maxCanvasWidth, hasBoundary, snowStart, snowEnd) {
  const empty = {
    defs: {}, rangeCache: {}, topLevelIds: [], boundaryAdopterId: null,
    acceptAgainst: () => [],
    resolveZoneContainerId: () => ({}),
    makeBuildUnit: () => () => null,
    chainOf: () => [],
  };
  if (!Array.isArray(rawContainers) || !rawContainers.length) return empty;

  const zoneNodeIdsPre = {};
  preConsolidationZones.forEach(z => { zoneNodeIdsPre[z.name] = z.node_ids || []; });

  const defs = {};
  // At most one container may adopt the platform boundary (e.g. a
  // "Microsoft Azure" container wrapping a Snowflake-on-Azure deployment,
  // alongside the customer's own same-cloud resources) -- first-declared
  // wins if more than one is marked, so this can never be ambiguous.
  let boundaryAdopterId = null;
  rawContainers.forEach(c => {
    if (!c || c.id == null) return;
    const seedIds = new Set(c.node_ids || []);
    (c.zone_names || []).forEach(zn => (zoneNodeIdsPre[zn] || []).forEach(id => seedIds.add(id)));
    defs[c.id] = { id: c.id, label: c.label || c.id, subtitle: c.subtitle || null, color: c.color || null, seedIds, childIds: (c.container_ids || []).filter(cid => cid !== c.id), parentId: null };
    if (c.include_platform_boundary === true && hasBoundary && boundaryAdopterId == null) boundaryAdopterId = c.id;
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
  // with (recursively) its declared children's ranges, and -- for the one
  // boundary-adopting container, if any -- the platform boundary's own
  // [snowStart, snowEnd] range too.
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
    if (id === boundaryAdopterId) { if (snowStart < lo) lo = snowStart; if (snowEnd > hi) hi = snowEnd; }
    return (rangeCache[id] = (lo === Infinity ? null : { lo, hi }));
  }
  Object.keys(defs).forEach(id => rangeOf(id));

  // Accept top-level containers in rank order, skipping any that collide
  // with an already-claimed range. The platform boundary's own range is
  // pre-claimed by the caller UNLESS a container is adopting it (in which
  // case that container's own range -- which already unions in the
  // boundary's range above -- claims it instead, and no separate top-level
  // boundary unit gets built).
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
        // A boundary-adopting container's own snow-range zones are handled
        // via the embedded boundary sub-unit, not as loose direct members.
        if (id === boundaryAdopterId && r >= snowStart && r <= snowEnd) return;
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
  function makeBuildUnit(zoneContainerId, boundaryUnit) {
    return function buildUnit(id) {
      if (unitCache[id] !== undefined) return unitCache[id];
      const directZones = zones.filter(z => zoneContainerId[z.name] === id).sort((a, b) => rank[a.name] - rank[b.name]);
      const childIds = (defs[id].childIds || []).filter(cid => defs[cid] && defs[cid].parentId === id);
      const items = [];
      directZones.forEach(z => { const zs = zoneSize(z); items.push({ kind: 'zone', z, zs, width: zs.width, height: zs.height, rank: rank[z.name] }); });
      childIds.forEach(cid => { const cu = buildUnit(cid); if (cu) items.push({ kind: 'container', unit: cu, width: cu.width, height: cu.height, rank: rangeCache[cid] ? rangeCache[cid].lo : 0 }); });
      if (id === boundaryAdopterId && boundaryUnit) items.push({ kind: 'boundary', unit: boundaryUnit, width: boundaryUnit.width, height: boundaryUnit.height, rank: snowStart });
      if (!items.length) return (unitCache[id] = null);
      items.sort((a, b) => a.rank - b.rank);
      const chromeW = 2 * (LAYOUT.containerBorder + LAYOUT.containerPadSide);
      const chromeH = 2 * LAYOUT.containerBorder + LAYOUT.containerHeaderH + LAYOUT.containerPadTop + LAYOUT.containerPadBottom;
      const innerMaxWidth = Math.max(maxCanvasWidth - chromeW, CARD.width);
      const innerWrap = wrapUnits(items, innerMaxWidth, LAYOUT.outerColGap, LAYOUT.rowWrapGap);
      const unit = {
        id, label: defs[id].label, subtitle: defs[id].subtitle, color: defs[id].color, parentId: defs[id].parentId,
        width: chromeW + innerWrap.totalWidth, height: chromeH + innerWrap.totalHeight,
        items, innerWrap,
      };
      unitCache[id] = unit;
      return unit;
    };
  }

  return { defs, rangeCache, topLevelIds, boundaryAdopterId, acceptAgainst, resolveZoneContainerId, makeBuildUnit, chainOf };
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
  const order = {}; names.forEach((n, i) => { order[n] = i; }); // tie-break only, no longer used to filter edges
  const succ = {}; names.forEach(n => { succ[n] = []; });

  // Collect all zone-level edges (deduped pairs), in declaration order.
  const zoneEdges = [];
  const seenPair = new Set();
  edges.forEach(e => {
    const sz = nodeToZone[e.source], tz = nodeToZone[e.target];
    if (!sz || !tz || sz === tz) return;
    const key = sz + '\u0000' + tz;
    if (seenPair.has(key)) return;
    seenPair.add(key);
    zoneEdges.push([sz, tz]);
  });

  // Add each zone-level edge unless it would introduce an actual cycle in
  // the zone graph -- that is the correct definition of a topological
  // "back edge" for layering purposes, NOT whichever zone happened to be
  // declared earlier in the input model. The previous check (order[tz] <=
  // order[sz]) used the model's raw zone-declaration order as a proxy for
  // "forward", which silently drops a perfectly acyclic edge whenever its
  // target zone happens to be declared earlier than its source (e.g. a
  // "Governance" zone declared right after "Ingestion" but whose only
  // real edge is FROM a "Warehouse" zone declared much later in the flow).
  // That zone then never gets pulled to its correct rank and its edge has
  // to travel backward across the whole diagram to reach it -- exactly
  // the readability problem flagged from a live-agent render (Warehouse
  // -> Governance cutting back across every other zone). A real
  // reachability check accepts that edge (no cycle exists) and correctly
  // ranks Governance right after Warehouse instead.
  function reachable(from, to) {
    if (from === to) return true;
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === to) return true;
      (succ[cur] || []).forEach(n => { if (!seen.has(n)) { seen.add(n); queue.push(n); } });
    }
    return false;
  }
  zoneEdges.forEach(([sz, tz]) => {
    if (reachable(tz, sz)) return; // would close a cycle -- a genuine back-edge, skip
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
  // de-collide same-rank zones into unique columns -- but FIRST bucket by
  // category (onprem < snow/bridge < outcome) so a bridge/outcome zone
  // that happens to have a lower topological rank than some onprem zone
  // (e.g. an inbound share arriving early in the chain) can never end up
  // sandwiched between two onprem zones. The platform boundary is drawn by
  // sweeping every column between the first and last snow-category column
  // (pack()'s hasBoundary/snowStart/snowEnd) -- without this bucketing, an
  // onprem zone caught in that numeric range visually ends up INSIDE the
  // Snowflake boundary despite being external, which is architecturally
  // backwards. Rank order (the flow's actual read order) still breaks ties
  // within each bucket.
  function bucketOf(name) {
    const c = cat[name];
    if (c === 'onprem') return 0;
    if (c === 'outcome') return 2;
    return 1; // snow / bridge / anything unrecognized
  }
  const sorted = names.slice().sort((a, b) => {
    const ba = bucketOf(a), bb = bucketOf(b);
    if (ba !== bb) return ba - bb;
    return (rank[a] !== rank[b]) ? rank[a] - rank[b] : order[a] - order[b];
  });
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
  // whichever top-level containers don't collide with it or each other.
  // One container may instead ADOPT the boundary (include_platform_boundary)
  // -- e.g. a "Microsoft Azure" container for a Snowflake-on-Azure
  // deployment -- in which case its own range already covers the
  // boundary's, so the boundary is NOT separately pre-claimed. ──
  const containerLayout = buildContainerLayout(model.containers, model.zones, zones, rank, zoneSize, maxCanvasWidth, hasBoundary, snowStart, snowEnd);
  const boundaryAdopted = containerLayout.boundaryAdopterId != null;
  const acceptedContainerIds = containerLayout.acceptAgainst((hasBoundary && !boundaryAdopted) ? [{ lo: snowStart, hi: snowEnd }] : []);
  const zoneContainerId = containerLayout.resolveZoneContainerId(acceptedContainerIds);
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

  // Build the platform-boundary unit ONCE, unconditionally, regardless of
  // whether it ends up as a standalone top-level unit (the common case) or
  // embedded as a child inside the one adopting container (Snowflake-on-
  // <cloud> deployments) -- both paths need the identical zonesInBoundary/
  // innerWrap geometry, just placed at a different origin later.
  function buildBoundaryUnit() {
    if (!hasBoundary) return null;
    const boundaryChromeW = 2 * (LAYOUT.boundaryBorder + LAYOUT.boundaryPadSide);
    const innerMaxWidth = Math.max(maxCanvasWidth - boundaryChromeW, CARD.width);
    const zonesInBoundary = [];
    for (let sci = snowStart; sci <= snowEnd; sci++) {
      columns[sci].forEach(z => { const zs = zoneSize(z); zonesInBoundary.push({ z, zs, width: zs.width, height: zs.height }); });
    }
    const innerWrap = wrapUnits(zonesInBoundary, innerMaxWidth, dynInnerGap, LAYOUT.rowWrapGap);
    refineZoneRowOrderByEdgeLength(innerWrap, zonesInBoundary, model.edges, dynInnerGap);
    const width = boundaryChromeW + innerWrap.totalWidth;
    const height = LAYOUT.boundaryBorder + LAYOUT.boundaryPadTop + innerWrap.totalHeight + LAYOUT.boundaryPadBottom + LAYOUT.boundaryBorder;
    return { width, height, zonesInBoundary, innerWrap };
  }
  const boundaryUnit = buildBoundaryUnit();
  const buildContainerUnit = containerLayout.makeBuildUnit(zoneContainerId, boundaryAdopted ? boundaryUnit : null);

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
    if (hasBoundary && !boundaryAdopted && ci === snowStart) {
      units.push({ kind: 'boundary', width: boundaryUnit.width, height: boundaryUnit.height, zonesInBoundary: boundaryUnit.zonesInBoundary, innerWrap: boundaryUnit.innerWrap });
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

  // ── Channel geometry (grid-aligned routing) ──────────────────────
  // Every wrapUnits() call already produces a globally row-band-aligned
  // grid (rowYOffset/rowHeights shared by every item in that wrap, by
  // construction -- see wrapUnits). We record each such grid as a
  // "scope" (outer canvas, inside the platform boundary, inside each
  // container) with the placed slot rects for its immediate children,
  // so route.mjs can walk clear channels between slots instead of
  // reactively detecting and dodging obstacles after the fact.
  const channels = { outer: { rowYOffset: outerWrap.rowYOffset, rowHeights: outerWrap.rowHeights, slots: [] }, scopes: {} };
  const zoneScope = {};      // zoneName -> scope id ('outer' | 'boundary' | containerId)
  const containerScope = {}; // containerId -> scope id of the box's own parent scope

  // Shared by both the top-level units.forEach loop (standalone boundary,
  // the common case) and placeContainerUnit (boundary embedded as a child
  // of an adopting container, e.g. "Microsoft Azure" wrapping a
  // Snowflake-on-Azure deployment) -- identical geometry, different origin.
  function placeBoundaryUnit(u, x, y) {
    boundaryLeft = x;
    boundaryTop = y;
    boundaryRight = x + u.width;
    boundaryBottom = y + u.height;
    const innerOriginX = x + LAYOUT.boundaryBorder + LAYOUT.boundaryPadSide;
    const innerOriginY = y + LAYOUT.boundaryBorder + LAYOUT.boundaryPadTop;
    const scope = { rowYOffset: u.innerWrap.rowYOffset.map(ry => ry + innerOriginY), rowHeights: u.innerWrap.rowHeights, slots: [] };
    channels.scopes.boundary = scope;
    u.zonesInBoundary.forEach(item => {
      const left = innerOriginX + item.xInRow;
      const top = innerOriginY + (u.innerWrap.rowYOffset[item.rowIdx] || 0);
      const zs = item.zs;
      zoneRects.push({ name: item.z.name, left, right: left + zs.width, top, bottom: top + zs.height });
      placedByZone[item.z.name] = { left, top, zs };
      zoneScope[item.z.name] = 'boundary';
      scope.slots.push({ rowIdx: item.rowIdx, left, right: left + zs.width, top, bottom: top + zs.height, name: item.z.name });
    });
  }

  // Recursive: places every (zone | nested container | embedded boundary)
  // item inside a container unit, mirroring the boundary's own
  // zonesInBoundary placement one level deeper. Pushes exactly one
  // containerRects entry per box.
  function placeContainerUnit(unit, x, y) {
    const innerOriginX = x + LAYOUT.containerBorder + LAYOUT.containerPadSide;
    const innerOriginY = y + LAYOUT.containerBorder + LAYOUT.containerHeaderH + LAYOUT.containerPadTop;
    const scope = { rowYOffset: unit.innerWrap.rowYOffset.map(ry => ry + innerOriginY), rowHeights: unit.innerWrap.rowHeights, slots: [] };
    channels.scopes[unit.id] = scope;
    unit.items.forEach(item => {
      const left = innerOriginX + item.xInRow;
      const top = innerOriginY + (unit.innerWrap.rowYOffset[item.rowIdx] || 0);
      if (item.kind === 'zone') {
        const zs = item.zs;
        zoneRects.push({ name: item.z.name, left, right: left + zs.width, top, bottom: top + zs.height });
        placedByZone[item.z.name] = { left, top, zs };
        zoneScope[item.z.name] = unit.id;
        scope.slots.push({ rowIdx: item.rowIdx, left, right: left + zs.width, top, bottom: top + zs.height, name: item.z.name });
      } else if (item.kind === 'boundary') {
        placeBoundaryUnit(item.unit, left, top);
        containerScope.boundary = unit.id;
        scope.slots.push({ rowIdx: item.rowIdx, left, right: left + item.unit.width, top, bottom: top + item.unit.height, name: 'boundary' });
      } else {
        placeContainerUnit(item.unit, left, top);
        containerScope[item.unit.id] = unit.id;
        scope.slots.push({ rowIdx: item.rowIdx, left, right: left + item.unit.width, top, bottom: top + item.unit.height, name: item.unit.id });
      }
    });
    containerRects.push({ id: unit.id, label: unit.label, subtitle: unit.subtitle || null, color: unit.color || null, parentId: unit.parentId, left: x, top: y, right: x + unit.width, bottom: y + unit.height });
  }

  units.forEach(u => {
    const rowTop = outerWrap.rowYOffset[u.rowIdx] || 0;
    if (u.kind === 'containerBox') {
      placeContainerUnit(u.unit, u.xInRow, rowTop);
      containerScope[u.unit.id] = 'outer';
      channels.outer.slots.push({ rowIdx: u.rowIdx, left: u.xInRow, right: u.xInRow + u.width, top: rowTop, bottom: rowTop + u.height, name: u.unit.id });
    } else if (u.kind === 'boundary') {
      placeBoundaryUnit(u, u.xInRow, rowTop);
      containerScope.boundary = 'outer';
      channels.outer.slots.push({ rowIdx: u.rowIdx, left: u.xInRow, right: u.xInRow + u.width, top: rowTop, bottom: rowTop + u.height, name: 'boundary' });
    } else {
      let ix = u.xInRow;
      const top = rowTop + outsideZoneTop;
      u.zonesInCol.forEach(function (item) {
        const z = item.z, zs = item.zs;
        const left = ix;
        zoneRects.push({ name: z.name, left, right: left + zs.width, top, bottom: top + zs.height });
        placedByZone[z.name] = { left, top, zs };
        zoneScope[z.name] = 'outer';
        channels.outer.slots.push({ rowIdx: u.rowIdx, left, right: left + zs.width, top, bottom: top + zs.height, name: z.name });
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
    // A zone embedded inside the platform boundary (which is itself nested
    // inside the one adopting container, if any -- e.g. "Microsoft Azure"
    // wrapping a Snowflake-on-Azure deployment) never gets a zoneContainerId
    // entry of its own (it's placed via the boundary sub-unit, not swept in
    // as a loose item) -- but for route.mjs's obstacle-exclusion purposes it
    // IS nested inside that container, and must say so, or every edge
    // between two such zones treats the container's own rect as a real
    // obstacle and detours wildly around it.
    let effectiveContainerId = zoneContainerId[z.name];
    if (effectiveContainerId == null && boundaryAdopted && rank[z.name] >= snowStart && rank[z.name] <= snowEnd) {
      effectiveContainerId = containerLayout.boundaryAdopterId;
    }
    const containerChain = effectiveContainerId != null ? containerLayout.chainOf(effectiveContainerId) : [];
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
      // Real card nodes (not dummies/zones) carry the icon's absolute
      // vertical center so the router can anchor left/right ports there
      // instead of the raw rect midpoint -- see measure.mjs's iconCenterY.
      if (!isDummy[id] && size[id] && size[id].iconCenterY != null) {
        rect.iconCenterY = top + size[id].iconCenterY;
        rect.iconHalfHeight = size[id].iconHalfHeight;
      }
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
    channels, zoneScope, containerScope,
  };
}


// ===== gridroute.mjs =====
// gridroute.mjs — deterministic, obstacle-optimal orthogonal edge routing.
//
// Replaces heuristic path-guessing with an actual algorithm: build a
// visibility grid from every obstacle's left/right/top/bottom edges, then
// find the minimum-cost path (Manhattan distance + a penalty per turn)
// through that grid via Dijkstra. A segment that would pass through the
// STRICT INTERIOR of a non-excluded obstacle is simply not a valid edge in
// the search graph, so the router mathematically cannot produce a path
// that crosses a component it isn't connecting to -- it isn't a rule being
// checked after the fact, it's a constraint on which moves exist at all.
//
// This intentionally has NO knowledge of zones/containers/scopes -- it
// only sees a flat list of obstacle rects plus an exclusion set per edge
// (rects the two endpoints are allowed to sit inside/pass through, e.g.
// their own zone and container/boundary ancestry). That keeps it reusable
// and easy to verify in isolation.

const TURN_PENALTY = 60; // px-equivalent cost per 90-degree turn
const REUSE_PENALTY = 24; // extra cost per prior edge's segment a step runs along

// Record a computed path's segments into a shared usage list (an array of
// {x1,y1,x2,y2}) so subsequent calls to routeShortestOrthogonal can
// penalize a fine-grained search step that runs along an already-used
// segment, nudging equally-short parallel edges into separate lanes
// instead of all collapsing onto the identical line.
function registerPathUsage(usage, path) {
  for (let i = 0; i < path.length - 1; i++) {
    usage.push({ x1: path[i][0], y1: path[i][1], x2: path[i + 1][0], y2: path[i + 1][1] });
  }
}

// How many already-used segments the fine-grained step (x,y)-(nx,ny) runs
// along (collinear and within bounds), for the reuse penalty.
function reuseCount(x, y, nx, ny, usage) {
  if (!usage || !usage.length) return 0;
  let count = 0;
  const horizontal = Math.abs(y - ny) < 0.5;
  for (let i = 0; i < usage.length; i++) {
    const s = usage[i];
    if (horizontal) {
      if (Math.abs(s.y1 - s.y2) >= 0.5 || Math.abs(y - s.y1) >= 0.5) continue;
      const lo = Math.min(x, nx), hi = Math.max(x, nx);
      const slo = Math.min(s.x1, s.x2), shi = Math.max(s.x1, s.x2);
      if (lo >= slo - 0.5 && hi <= shi + 0.5) count++;
    } else {
      if (Math.abs(s.x1 - s.x2) >= 0.5 || Math.abs(x - s.x1) >= 0.5) continue;
      const lo = Math.min(y, ny), hi = Math.max(y, ny);
      const slo = Math.min(s.y1, s.y2), shi = Math.max(s.y1, s.y2);
      if (lo >= slo - 0.5 && hi <= shi + 0.5) count++;
    }
  }
  return count;
}


function rectsOverlap1D(lo1, hi1, lo2, hi2, margin) {
  return hi1 > lo2 + margin && lo1 < hi2 - margin;
}

// Is the axis-aligned segment (x1,y1)-(x2,y2) blocked by `rect`? margin
// keeps a segment running exactly ALONG a rect's own edge legal (hugging
// a wall is fine; cutting through the interior is not).
function segmentBlockedByRect(x1, y1, x2, y2, rect, margin) {
  if (y1 === y2) {
    if (y1 <= rect.top + margin || y1 >= rect.bottom - margin) return false;
    return rectsOverlap1D(Math.min(x1, x2), Math.max(x1, x2), rect.left, rect.right, margin);
  }
  if (x1 <= rect.left + margin || x1 >= rect.right - margin) return false;
  return rectsOverlap1D(Math.min(y1, y2), Math.max(y1, y2), rect.top, rect.bottom, margin);
}

function buildAxis(values, lo, hi) {
  const set = new Set([lo, hi]);
  values.forEach(v => set.add(v));
  return Array.from(set).sort((a, b) => a - b);
}

function insertSorted(arr, v) {
  let i = 0;
  while (i < arr.length && arr[i] < v) i++;
  if (arr[i] !== v) arr.splice(i, 0, v);
  return arr.indexOf(v);
}

// Ports: the up-to-4 candidate attachment points on a rect's own boundary
// (midpoints of each side), each tagged with the outward direction so the
// search can charge a turn if the first real move doesn't continue that
// way, and a `side` label ('top'|'bottom'|'left'|'right') so callers can
// bias the search toward a specific side (a hard restriction, not a cost
// nudge -- see the srcPorts/tgtPorts filtering in routeShortestOrthogonal)
// -- used to keep several edges that share a target/source
// entering/exiting through the same side instead of each independently
// picking whichever port is marginally cheapest.
function portsOf(rect) {
  const midX = (rect.left + rect.right) / 2;
  // Left/right ports anchor to the card's icon (fixed near the top,
  // regardless of label length) rather than the raw geometric center --
  // see offsetPortOn's comment for why the plain center is unsafe.
  const sideY = rect.iconCenterY != null ? rect.iconCenterY : (rect.top + rect.bottom) / 2;
  return [
    { x: midX, y: rect.top, dir: 1, side: 'top' },
    { x: midX, y: rect.bottom, dir: 1, side: 'bottom' },
    { x: rect.left, y: sideY, dir: 0, side: 'left' },
    { x: rect.right, y: sideY, dir: 0, side: 'right' },
  ];
}

// Builds ONE port point on a specific side of `rect`, shifted `offset` px
// along that side from its midpoint (clamped so it can't slide past the
// rounded corners). Used so several edges biased to the SAME side of the
// same node don't all collapse onto the identical pixel port -- without
// this, 3 sibling edges sharing a target side/point also share their final
// approach segment and render as one visible line with one arrowhead,
// hiding that 3 separate connections exist (found via direct visual
// inspection of a fixture render + the live-agent apex-health SVG, both
// showing identical duplicate final segments into a fan-in target).
function offsetPortOn(rect, side, offset) {
  const CORNER_MARGIN = 8;
  if (side === 'top' || side === 'bottom') {
    const half = Math.max(0, (rect.right - rect.left) / 2 - CORNER_MARGIN);
    const dx = Math.max(-half, Math.min(half, offset));
    const midX = (rect.left + rect.right) / 2;
    return { x: midX + dx, y: side === 'top' ? rect.top : rect.bottom, dir: 1, side };
  }
  // Left/right ports fan out around the ICON's center, not the card's raw
  // geometric center -- for a short (1-line) label, the card's own midpoint
  // already sits near the icon's bottom edge, so even a small positive
  // offset on top of it pushed a connector past the icon and directly onto
  // the label text below (found via exact SVG coordinate measurement: a
  // fan-out offset landed a port within 3px of a card's own label baseline,
  // visibly striking through it). Clamping to the icon's own half-height
  // (instead of half the card's full height) keeps every fanned-out port on
  // the icon's graphic, where it can never collide with text.
  const ICON_MARGIN = 4;
  const halfRange = rect.iconHalfHeight != null
    ? Math.max(0, rect.iconHalfHeight - ICON_MARGIN)
    : Math.max(0, (rect.bottom - rect.top) / 2 - CORNER_MARGIN);
  const dy = Math.max(-halfRange, Math.min(halfRange, offset));
  const midY = rect.iconCenterY != null ? rect.iconCenterY : (rect.top + rect.bottom) / 2;
  return { x: side === 'left' ? rect.left : rect.right, y: midY + dy, dir: 0, side };
}

const CLEARANCE = 14; // px of standoff a path must keep from an unrelated obstacle's edge
// (inter-zone dynGapBase=48, so 2*14=28px inflated width still leaves a 20px corridor)

/**
 * @param {{left,top,right,bottom,id}[]} obstacles - every rect that could block a path
 * @param {{left,top,right,bottom}} srcRect - the source node's own rect
 * @param {{left,top,right,bottom}} tgtRect - the target node's own rect
 * @param {Set<string>} excludeIds - obstacle ids the endpoints are allowed to sit inside
 * @param {{minX,minY,maxX,maxY}} bounds - canvas extent (fallback grid lines)
 * @returns {[number,number][]|null} waypoints, or null if no path exists (shouldn't happen on a bounded canvas)
 */
function routeShortestOrthogonal(obstacles, srcRect, tgtRect, excludeIds, bounds, margin = 3, usage = null, portBias = null) {
  // Inflate every obstacle the path is NOT allowed to touch by a fixed
  // clearance before it's used for blocking/grid-line generation, so a
  // path keeps visible breathing room from a zone/container/card it
  // isn't connecting to instead of just barely legally grazing its edge
  // (margin above only controls "on the boundary is legal", it says
  // nothing about preferring more distance). The endpoints' own
  // zone/container chain is excluded from `obstacles` entirely (never
  // reaches this filter), so hugging THAT boundary exactly is unaffected.
  const active = obstacles.filter(o => !excludeIds.has(o.id)).map(o => ({
    id: o.id,
    left: o.left - CLEARANCE, top: o.top - CLEARANCE,
    right: o.right + CLEARANCE, bottom: o.bottom + CLEARANCE,
  }));

  const xs = [];
  const ys = [];
  active.forEach(o => { xs.push(o.left, o.right); ys.push(o.top, o.bottom); });
  const X = buildAxis(xs, bounds.minX, bounds.maxX);
  const Y = buildAxis(ys, bounds.minY, bounds.maxY);

  let srcPorts = portsOf(srcRect);
  let tgtPorts = portsOf(tgtRect);
  // A fan-in/fan-out bias is a HARD constraint, not a soft cost nudge: a
  // penalty small enough to still let a genuinely-closer alternate side
  // win for an outlying member of the cluster (observed: a fixed +50
  // penalty was overridden by a ~150px distance saving for a card far
  // from its siblings) defeats the entire point, which is visual
  // consistency across the whole cluster regardless of any one member's
  // exact position. Restrict to just the requested side when given.
  if (portBias && portBias.srcSide) {
    srcPorts = [offsetPortOn(srcRect, portBias.srcSide, portBias.srcOffset || 0)];
  }
  if (portBias && portBias.tgtSide) {
    tgtPorts = [offsetPortOn(tgtRect, portBias.tgtSide, portBias.tgtOffset || 0)];
  }
  srcPorts.concat(tgtPorts).forEach(p => { insertSorted(X, p.x); insertSorted(Y, p.y); });

  const xi = x => X.indexOf(x);
  const yi = y => Y.indexOf(y);

  function segBlocked(x1, y1, x2, y2) {
    for (let i = 0; i < active.length; i++) {
      if (segmentBlockedByRect(x1, y1, x2, y2, active[i], margin)) return true;
    }
    return false;
  }

  // Dijkstra over (grid point, last-move direction) states, small array
  // priority queue (grids here are tens of points, not thousands).
  const dist = new Map();
  const prevKey = new Map();
  const prevPoint = new Map();
  const pq = [];

  function key(xI, yI, dir) { return xI + ',' + yI + ',' + dir; }
  function push(cost, xI, yI, dir) {
    const k = key(xI, yI, dir);
    if (dist.has(k) && dist.get(k) <= cost) return;
    dist.set(k, cost);
    pq.push([cost, xI, yI, dir]);
  }

  const seedSources = [];
  srcPorts.forEach(p => {
    const d0 = Math.abs(p.x - (srcRect.left + srcRect.right) / 2) + Math.abs(p.y - (srcRect.top + srcRect.bottom) / 2);
    seedSources.push({ xI: xi(p.x), yI: yi(p.y), dir: p.dir, cost: d0, x: p.x, y: p.y });
  });
  seedSources.forEach(s => {
    const k = key(s.xI, s.yI, s.dir);
    prevKey.set(k, null);
    prevPoint.set(k, [s.x, s.y]);
    push(s.cost, s.xI, s.yI, s.dir);
  });

  // Only accept arrival at a port moving along ITS OWN natural axis (a
  // top/bottom port, dir:1, must be reached by a vertical move; a
  // left/right port, dir:0, by a horizontal one). Accepting the
  // perpendicular direction too (as this used to, via `1 - p.dir`) let the
  // search end a path AT a left/right port's pixel by arriving from
  // straight above/below instead of from the side -- geometrically legal,
  // but the marker orientation and edge-approach direction then have
  // NOTHING to do with the face the port is actually on. Two visible
  // symptoms, both found by direct comparison against the live agent's own
  // render (not a synthetic test payload): (1) an arrowhead whose triangle
  // points along the card's edge instead of into it, so it doesn't visibly
  // "aim at" anything; (2) since the marker's width straddles the path
  // perpendicular to its direction, a marker on a vertical final segment
  // ending at a LEFT-edge port has half its triangle spill sideways INTO
  // the card, where the opaque card painted on top hides it -- reproducing
  // the same hidden-arrowhead symptom the stubInto() removal (above) was
  // meant to fix for good. Forcing same-axis arrival costs at most one
  // extra TURN_PENALTY (the search simply detours a bit or picks a
  // different one of the rect's 4 candidate ports instead), which is the
  // correct trade: pay a small routing cost for a visually correct
  // approach, rather than a free but wrong-looking one.
  const targetStates = new Map(); // key -> {x,y,cost}
  tgtPorts.forEach(p => {
    const extra = Math.abs(p.x - (tgtRect.left + tgtRect.right) / 2) + Math.abs(p.y - (tgtRect.top + tgtRect.bottom) / 2);
    targetStates.set(key(xi(p.x), yi(p.y), p.dir), { x: p.x, y: p.y, extra });
  });

  let best = null, bestCost = Infinity;
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [cost, xI, yI, dir] = pq.shift();
    const k = key(xI, yI, dir);
    if (dist.get(k) < cost) continue;
    if (targetStates.has(k)) {
      const t = targetStates.get(k);
      const total = cost + t.extra;
      if (total < bestCost) { bestCost = total; best = k; }
    }
    if (bestCost < cost) break; // nothing left in the queue can beat the best found

    const x = X[xI], y = Y[yI];
    const moves = [];
    if (xI > 0) moves.push([xI - 1, yI, 0]);
    if (xI < X.length - 1) moves.push([xI + 1, yI, 0]);
    if (yI > 0) moves.push([xI, yI - 1, 1]);
    if (yI < Y.length - 1) moves.push([xI, yI + 1, 1]);

    for (const [nxI, nyI, ndir] of moves) {
      const nx = X[nxI], ny = Y[nyI];
      if (segBlocked(x, y, nx, ny)) continue;
      const segLen = Math.abs(nx - x) + Math.abs(ny - y);
      const turnCost = (dir !== ndir) ? TURN_PENALTY : 0;
      const reusePenalty = reuseCount(x, y, nx, ny, usage) * REUSE_PENALTY;
      const ncost = cost + segLen + turnCost + reusePenalty;
      const nk = key(nxI, nyI, ndir);
      if (!dist.has(nk) || dist.get(nk) > ncost) {
        prevKey.set(nk, k);
        prevPoint.set(nk, [nx, ny]);
        dist.set(nk, ncost);
        pq.push([ncost, nxI, nyI, ndir]);
      }
    }
  }

  if (best == null) return null;

  const pts = [];
  let cur = best;
  while (cur != null) {
    pts.push(prevPoint.get(cur));
    cur = prevKey.get(cur);
  }
  pts.reverse();

  // The path already starts/ends exactly at the computed port (pts[0] /
  // pts[pts.length-1] ARE the port coordinates the A* search targeted --
  // see portsOf/offsetPortOn above). An earlier version of this function
  // additionally plunged a synthetic "stub" segment past the port into
  // each rect's own interior, so the wire (and its end-of-line arrowhead)
  // would be hidden under a borderless, floating icon that had no card
  // outline to visually terminate against. Now that cards render as
  // opaque, bordered boxes painted ON TOP of the connector layer, that
  // plunge does the opposite of what is wanted: the arrowhead marker sits
  // at the path's LAST point, so extending past the true edge moves the
  // marker from the visible gap between cards to a point *inside* the
  // opaque card -- where it is invisible, along with most of the final
  // segment (found via direct visual review: after switching to opaque
  // cards, essentially no arrowheads were visible anywhere in the
  // diagram, because every straight final approach collapsed, via
  // collinear-point reduction, down to just this now-hidden stub point).
  // Ending the path exactly at the port keeps the arrowhead visible right
  // at the card boundary -- which is also literally what "connect to the
  // edge of the card" means.
  const full = pts;


  // Drop redundant collinear waypoints (three or more consecutive points
  // on the same line collapse to the endpoints).
  const out = [full[0]];
  for (let i = 1; i < full.length; i++) {
    const p = full[i];
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      const collinear = (Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - p[0]) < 0.5) ||
                         (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - p[1]) < 0.5);
      if (collinear) { out[out.length - 1] = p; continue; }
    }
    if (Math.abs(p[0] - out[out.length - 1][0]) < 0.5 && Math.abs(p[1] - out[out.length - 1][1]) < 0.5) continue;
    out.push(p);
  }
  // Attach which side of each rect the winning path actually used, so a
  // caller routing several edges that share this src/tgt can bias
  // subsequent calls (via portBias) toward the same side -- keeps a fan-
  // in/fan-out cluster entering/exiting through one consistent side
  // instead of each edge independently picking whichever port tied on
  // cost. Arrays are objects in JS, so this doesn't change the return
  // type for existing callers that only index into it.
  const firstPort = pts.length ? pts[0] : null;
  const lastPort = pts.length ? pts[pts.length - 1] : null;
  out.srcSide = sideOf(srcRect, firstPort);
  out.tgtSide = sideOf(tgtRect, lastPort);
  return out;
}

function sideOf(rect, point) {
  const [x, y] = point;
  if (Math.abs(y - rect.top) < 0.5) return 'top';
  if (Math.abs(y - rect.bottom) < 0.5) return 'bottom';
  if (Math.abs(x - rect.left) < 0.5) return 'left';
  if (Math.abs(x - rect.right) < 0.5) return 'right';
  return null;
}


// ===== route.mjs =====
// route.mjs — DOM-free port of the viewer's renderConnectors edge router.
// Consumes the packed geometry (rects) and returns, per edge:
//   { source, target, points:[[x,y]...], d:"M..." , markerId }
//
// Edge paths are computed by gridroute.mjs: a visibility grid built from
// every obstacle's edges, searched with Dijkstra (Manhattan distance + a
// turn penalty) so a path is the actual shortest orthogonal route and
// mathematically cannot cross a component it isn't excluded for -- that's
// a property of which moves exist in the search graph, not a check run
// after the fact.


function route(model, packed, opts = {}) {
  const edges = model.edges || [];
  const { nodeRects, nodeRectsById, zoneRects, platformBoundary, containers, width, height } = packed;
  if (!edges.length) return [];

  function pointsToD(pts) {
    if (!pts.length) return '';
    let s = 'M' + pts[0][0] + ',' + pts[0][1];
    for (let i = 1; i < pts.length; i++) s += ' L' + pts[i][0] + ',' + pts[i][1];
    return s;
  }

  // ── helpers reading packed rects ──
  const cy = (nr) => (nr.top + nr.bottom) / 2;

  // ── Obstacle-based shortest-path routing ────────────────────────
  // gridroute.mjs finds the actual shortest orthogonal path between two
  // rects via a visibility-grid Dijkstra search, given a flat obstacle
  // list and which of those obstacles the two endpoints are allowed to
  // sit inside (their own zone, and its container/boundary ancestry).
  // A path that would cross a non-excluded obstacle simply isn't a move
  // the search can make, so "never touch a component you're not
  // connecting to" is a property of the search graph, not a rule checked
  // after the fact.
  const zoneScopeMap = packed.zoneScope || {};
  const containerScopeMap = packed.containerScope || {};

  function ancestorChain(scopeId) {
    const chain = [scopeId];
    let cur = scopeId;
    while (cur !== 'outer' && containerScopeMap[cur] != null) { cur = containerScopeMap[cur]; chain.push(cur); }
    if (chain[chain.length - 1] !== 'outer') chain.push('outer');
    return chain;
  }

  const obstacles = [];
  nodeRects.forEach(nr => obstacles.push({ id: 'node:' + nr.id, left: nr.left, top: nr.top, right: nr.right, bottom: nr.bottom }));
  zoneRects.forEach(zr => obstacles.push({ id: 'zone:' + zr.name, left: zr.left, top: zr.top, right: zr.right, bottom: zr.bottom }));
  (containers || []).forEach(c => obstacles.push({ id: 'container:' + c.id, left: c.left, top: c.top, right: c.right, bottom: c.bottom }));
  if (platformBoundary) obstacles.push({ id: 'boundary', left: platformBoundary.left, top: platformBoundary.top, right: platformBoundary.right, bottom: platformBoundary.bottom });

  // Zone/container/boundary title text sits in the top-left corner of each
  // box (see render_diagram_generated.py's own node_boxes list, built for
  // the SAME reason but only to keep EDGE LABEL text off a title -- there
  // was no equivalent for the connector LINE itself). A title id is never
  // added to any edge's excludeIds (exclusionsFor only ever emits
  // 'node:'/'zone:'/'container:'/'boundary' ids), so unlike the box's own
  // rect -- which an edge legitimately starting/ending inside it must be
  // allowed to sit inside -- these strips are hard obstacles for EVERY
  // edge, including ones whose own zone/container this is. Found via
  // direct visual review of a live render: a skip-zone bridge line
  // legally cut straight across "Ingestion"'s title band, because the
  // container it belonged to (an ancestor of both endpoints) excluded its
  // whole rect from that edge's obstacle set, and nothing else stood in
  // for just the label text.
  const charW = { zone: 7.8, container: 6.8 };
  zoneRects.forEach(zr => {
    const nameW = String(zr.name || '').length * charW.zone;
    obstacles.push({ id: 'zonetitle:' + zr.name, left: zr.left + 8, top: zr.top + 6, right: zr.left + 8 + nameW, bottom: zr.top + 28 });
  });
  (containers || []).forEach(c => {
    const nameW = String(c.label || c.id || '').length * charW.container;
    obstacles.push({ id: 'containertitle:' + c.id, left: c.left + 8, top: c.top + 4, right: c.left + 8 + nameW, bottom: c.top + 22 });
  });
  if (platformBoundary) {
    const nameW = 'Snowflake Data Cloud'.length * charW.container;
    obstacles.push({ id: 'boundarytitle', left: platformBoundary.left + 12, top: platformBoundary.top + 8, right: platformBoundary.left + 12 + nameW, bottom: platformBoundary.top + 24 });
  }

  const canvasBounds = { minX: -40, minY: -40, maxX: (width || 2000) + 40, maxY: (height || 2000) + 40 };

  // Every obstacle a node's own position is legitimately inside: its own
  // node rect (excluded by the caller separately), its zone, and every
  // container/boundary that zone is nested in.
  function exclusionsFor(nodeName, zoneName) {
    const ex = new Set(['node:' + nodeName, 'zone:' + zoneName]);
    const scopeId = zoneScopeMap[zoneName];
    if (scopeId != null) {
      ancestorChain(scopeId).forEach(s => { if (s !== 'outer') ex.add(s === 'boundary' ? 'boundary' : 'container:' + s); });
    }
    return ex;
  }

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

  // Total edges sharing each unordered zone-pair, so parallel edges
  // between the same two zones (different node pairs) get nudged apart
  // on their turn segments instead of landing exactly on top of a
  // shortest path some other edge already claimed.
  const laneCounts = {};
  // Segments already claimed by earlier edges this pass, so later edges
  // between a different node pair prefer a fresh lane over exactly
  // overlapping one when a comparably-short alternative exists (see
  // registerPathUsage / reuseCount in gridroute.mjs).
  const pathUsage = [];
  const pairTotalCounts = {};
  edges.forEach(edge => {
    const s = nodeRectsById[edge.source], t = nodeRectsById[edge.target];
    if (!s || !t || s.zoneName === t.zoneName) return;
    const key = [s.zoneName, t.zoneName].sort().join('|');
    pairTotalCounts[key] = (pairTotalCounts[key] || 0) + 1;
  });

  // Fan-in/fan-out port consistency: once one edge picks a side to
  // exit/enter a given node, later edges sharing that SAME node (as
  // source, or as target, tracked separately since a node's fan-out side
  // and fan-in side are independent) are biased toward the same side
  // instead of each independently landing on whichever port ties on
  // cost -- e.g. 3 sources feeding one node should all enter through
  // that node's one side, not split across two different sides.
  const srcSideUsed = {};
  const tgtSideUsed = {};
  // Same-side siblings still need DISTINCT port points, or their final
  // approach segments overlap exactly and 3 separate edges render as one
  // visible line with one arrowhead (found via direct SVG path-data
  // inspection: Azure Synapse/SQL/Blob -> dbt in the apex-health live
  // render all ended at the identical (x,y) with the same trailing
  // segment). Each additional edge sharing a (node, side) gets the next
  // slot in an alternating fan-out sequence around the side's midpoint.
  const PORT_SLOT_SPACING = 14; // px between adjacent fanned-out ports
  const srcSideSlot = {};
  const tgtSideSlot = {};
  function nextSlotOffset(slotMap, key) {
    // Called only once a bias already exists for this (node, side), i.e.
    // this is at LEAST the 2nd edge sharing it -- so the sequence must
    // start at n=1 on the very first call, or that 2nd edge silently gets
    // offset 0 and collides with the 1st edge's unbiased (also-0) port.
    const n = (slotMap[key] || 0) + 1;
    slotMap[key] = n;
    const magnitude = Math.ceil(n / 2) * PORT_SLOT_SPACING;
    return (n % 2 === 1) ? magnitude : -magnitude;
  }

  // ── main per-edge routing ──
  const collected = [];
  edges.forEach((edge, edgeIdx) => {
    const s = nodeRectsById[edge.source], t = nodeRectsById[edge.target];
    if (!s || !t) return;
    // NOTE: pack.mjs's dummy-node chains (edgeChains) exist purely to
    // reserve column width during layout for edges spanning multiple
    // ranks -- they are NOT used for routing. There used to be a
    // "spineThroughChain" shortcut here that swept a straight line
    // through the chain's dummy lane with zero obstacle awareness (no
    // zone/node checks at all), which could and did cut through an
    // unrelated zone whenever that lane happened to fall inside one.
    // Every edge now goes through the same obstacle-aware
    // routeShortestOrthogonal search below, so "can't cross a component
    // it isn't connecting to" is a property of every edge, not most of
    // them.
    const sameZone = s.zoneName === t.zoneName;
    const laneKey = [s.zoneName, t.zoneName].sort().join('|');
    if (!laneCounts[laneKey]) laneCounts[laneKey] = 0;
    const laneIdx = laneCounts[laneKey]++;
    const totalForPair = pairTotalCounts[laneKey] || 1;

    const excludeIds = new Set([
      ...exclusionsFor(s.id, s.zoneName),
      ...exclusionsFor(t.id, t.zoneName),
    ]);
    const portBias = { srcSide: srcSideUsed[s.id] || null, tgtSide: tgtSideUsed[t.id] || null };
    if (portBias.srcSide) portBias.srcOffset = nextSlotOffset(srcSideSlot, s.id);
    if (portBias.tgtSide) portBias.tgtOffset = nextSlotOffset(tgtSideSlot, t.id);
    let path = routeShortestOrthogonal(obstacles, s, t, excludeIds, canvasBounds, 3, pathUsage, portBias);
    if (!path) {
      // Should only happen if a diagram genuinely has no clear route (e.g.
      // fully enclosed with no gap) -- fall back to a direct line rather
      // than dropping the edge.
      path = [[(s.left + s.right) / 2, cy(s)], [(t.left + t.right) / 2, cy(t)]];
    }
    if (path.srcSide && !srcSideUsed[s.id]) srcSideUsed[s.id] = path.srcSide;
    if (path.tgtSide && !tgtSideUsed[t.id]) tgtSideUsed[t.id] = path.tgtSide;
    registerPathUsage(pathUsage, path);
    const d = pointsToD(path);
    const markerId = 'arrowhead';
    collected.push({ source: edge.source, target: edge.target, d, markerId });
  });

  // ── V-H crossing bumps + final path ──
  function parsePath(d) {
    const pts = [];
    d.split(/[ML]\s*/).forEach(seg => { seg = seg.trim(); if (!seg) return; const p = seg.split(','); if (p.length === 2) pts.push([parseFloat(p[0]), parseFloat(p[1])]); });
    return pts;
  }
  collected.forEach(p => { p.points = parsePath(p.d); p.bumps = []; });

  // NOTE: there used to be a post-hoc "repair pass" here that re-scanned
  // every segment against the obstacle set and nudged any crossing one
  // sideways by a fixed clearance. It predates gridroute.mjs, from when
  // routing was done by several heuristic branches that each only checked
  // a local subset of obstacles. It's not just redundant now -- it's
  // actively harmful: nudging one endpoint of a segment without
  // necessarily re-validating what that shift does to the *adjacent*
  // segment sharing that point could turn an already-obstacle-free
  // gridroute.mjs path into one that crosses something. gridroute.mjs's
  // Dijkstra search already guarantees every emitted path is obstacle-free
  // by construction -- a blocked segment is never a candidate move in the
  // first place -- so there is nothing left here that needs repairing.

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
//     nodes: [{ id, label, detail, zone, x, y, w, h }],
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

  // Build a lookup for metadata the layout engine uses internally but that
  // nodeRects don't carry (detail), so it can be threaded into the output.
  const nodeDetail = {};
  (model.nodes || []).forEach(n => { if (n.detail) nodeDetail[n.id] = n.detail; });

  const result = {
    nodes: packed.nodeRects.filter(n => !n.dummy).map(n => ({
      id: n.id,
      zone: n.zoneName,
      x: n.left, y: n.top, w: n.right - n.left, h: n.bottom - n.top,
      ...(nodeDetail[n.id] ? { detail: nodeDetail[n.id] } : {}),
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
      id: c.id, label: c.label, subtitle: c.subtitle || null, color: c.color || null, parentId: c.parentId,
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
