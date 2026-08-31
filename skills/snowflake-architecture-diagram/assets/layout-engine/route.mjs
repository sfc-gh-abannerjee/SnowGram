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

import { routeShortestOrthogonal } from './gridroute.mjs';

export function route(model, packed, opts = {}) {
  const edges = model.edges || [];
  const { nodeRects, nodeRectsById, zoneRects, subColRects, zoneGaps, platformBoundary, edgeChains, containers, width, height } = packed;
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
  const pairTotalCounts = {};
  edges.forEach(edge => {
    const s = nodeRectsById[edge.source], t = nodeRectsById[edge.target];
    if (!s || !t || s.zoneName === t.zoneName) return;
    const key = [s.zoneName, t.zoneName].sort().join('|');
    pairTotalCounts[key] = (pairTotalCounts[key] || 0) + 1;
  });

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
    const laneKey = [s.zoneName, t.zoneName].sort().join('|');
    if (!laneCounts[laneKey]) laneCounts[laneKey] = 0;
    const laneIdx = laneCounts[laneKey]++;
    const totalForPair = pairTotalCounts[laneKey] || 1;

    const excludeIds = new Set([
      ...exclusionsFor(s.id, s.zoneName),
      ...exclusionsFor(t.id, t.zoneName),
    ]);
    let path = routeShortestOrthogonal(obstacles, s, t, excludeIds, canvasBounds);
    if (!path) {
      // Should only happen if a diagram genuinely has no clear route (e.g.
      // fully enclosed with no gap) -- fall back to a direct line rather
      // than dropping the edge.
      path = [[(s.left + s.right) / 2, cy(s)], [(t.left + t.right) / 2, cy(t)]];
    }
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
  for (let pass = 0; pass < 6; pass++) {
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
        // Collect EVERY obstacle crossed by this segment, not just the
        // first -- shifting past a single one at a time can oscillate
        // forever between two overlapping-but-offset obstacles (avoid A,
        // land on B; avoid B, land back on A) without ever reaching a
        // position clear of the whole cluster.
        const hits = [];
        for (const nr of nodeRects) {
          if (nr.id === srcId || nr.id === tgtId) continue;
          if (segCrossesRect(x1s, y1s, x2s, y2s, nr)) hits.push(nr);
        }
        for (const zr of zoneRects) {
          if (zr.name === srcZoneName || zr.name === tgtZoneName) continue;
          if (segCrossesRect(x1s, y1s, x2s, y2s, zr)) hits.push(zr);
        }
        for (const cr of containerRects) {
          if (srcChainR.indexOf(cr.id) !== -1 || tgtChainR.indexOf(cr.id) !== -1) continue;
          if (segCrossesRect(x1s, y1s, x2s, y2s, cr)) hits.push(cr);
        }
        if (!hits.length) continue;
        if (vertical) {
          const clusterLeft = Math.min.apply(null, hits.map(h => h.left));
          const clusterRight = Math.max.apply(null, hits.map(h => h.right));
          const shiftLeft = clusterLeft - REPAIR_CLEARANCE, shiftRight = clusterRight + REPAIR_CLEARANCE;
          const newX = Math.abs(shiftLeft - x1s) <= Math.abs(shiftRight - x1s) ? shiftLeft : shiftRight;
          pts[si][0] = newX; pts[si + 1][0] = newX;
        } else {
          const clusterTop = Math.min.apply(null, hits.map(h => h.top));
          const clusterBottom = Math.max.apply(null, hits.map(h => h.bottom));
          const shiftUp = clusterTop - REPAIR_CLEARANCE, shiftDown = clusterBottom + REPAIR_CLEARANCE;
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
