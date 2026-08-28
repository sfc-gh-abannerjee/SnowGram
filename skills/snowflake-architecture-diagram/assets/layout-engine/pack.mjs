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

import { CARD, ZONE, LAYOUT, SNOW_CATEGORIES, QUALIFIERS } from './constants.mjs';
import { measureNode } from './measure.mjs';

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

export function pack(model, opts = {}) {
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
