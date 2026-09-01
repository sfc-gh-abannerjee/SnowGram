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

import { routeShortestOrthogonal, registerPathUsage } from './gridroute.mjs';

export function route(model, packed, opts = {}) {
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
