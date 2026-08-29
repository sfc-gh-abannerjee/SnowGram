// route.mjs — DOM-free port of the viewer's renderConnectors edge router.
// Consumes the packed geometry (rects) and returns, per edge:
//   { source, target, points:[[x,y]...], d:"M..." , markerId }
//
// All routing functions are faithful ports of assets/viewer/index.html
// (routeOrthogonal / detourH / bridgedRoute / bridgeCollides / snapToGap /
// row-channel + rail-clearance checks / V-H crossing bumps). The only
// change is that geometry comes from `packed` instead of getBoundingClientRect,
// and paths are returned as data instead of drawn as SVG.

export function route(model, packed, opts = {}) {
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

  // ── Grid-channel routing ──────────────────────────────────────────
  // pack.mjs's wrapUnits() gives every scope (outer canvas, inside the
  // platform boundary, inside each container) a globally row-band-aligned
  // grid: row r spans the SAME y-range for every item in that scope, by
  // construction. That means the gap between two row-bands is a
  // horizontal line clear of every slot in the scope, and the gap between
  // two adjacent slots in the same row is a vertical line clear of every
  // other row. Routing zone-to-zone by walking those channels is correct
  // by construction, so it replaces the old approach of guessing a path
  // and reactively detecting/dodging whatever it crosses.
  const channels = packed.channels;
  const zoneScopeMap = packed.zoneScope || {};
  const containerScopeMap = packed.containerScope || {};
  const slotMidX = (sl) => (sl.left + sl.right) / 2;

  function gridOf(scopeId) {
    if (!channels) return null;
    return scopeId === 'outer' ? channels.outer : (channels.scopes && channels.scopes[scopeId]);
  }
  function slotIn(grid, name) {
    return grid && grid.slots.find(sl => sl.name === name);
  }
  function resolveEndpoint(zoneName) {
    const scopeId = zoneScopeMap[zoneName];
    if (!scopeId) return null;
    const grid = gridOf(scopeId);
    const slot = slotIn(grid, zoneName);
    return slot ? { scopeId, grid, slot } : null;
  }
  function boxSlotOfScope(scopeId, inScope) {
    const grid = gridOf(inScope);
    const name = scopeId === 'boundary' ? 'boundary' : scopeId;
    return slotIn(grid, name);
  }
  function ancestorChain(scopeId) {
    const chain = [scopeId];
    let cur = scopeId;
    while (cur !== 'outer' && containerScopeMap[cur] != null) { cur = containerScopeMap[cur]; chain.push(cur); }
    if (chain[chain.length - 1] !== 'outer') chain.push('outer');
    return chain;
  }

  // Find an X clear of every slot whose row falls inside [loY, hiY],
  // nearest to preferredX, within this grid's own horizontal extent.
  function findClearVerticalX(grid, loY, hiY, preferredX, excludeNames) {
    if (!grid.slots.length) return preferredX;
    const boundsMin = Math.min.apply(null, grid.slots.map(s => s.left)) - 30;
    const boundsMax = Math.max.apply(null, grid.slots.map(s => s.right)) + 30;
    const blockers = [];
    grid.slots.forEach(sl => {
      if (excludeNames.indexOf(sl.name) !== -1) return;
      if (sl.bottom <= loY + 1 || sl.top >= hiY - 1) return;
      blockers.push([Math.max(boundsMin, sl.left - 6), Math.min(boundsMax, sl.right + 6)]);
    });
    blockers.sort((a, b) => a[0] - b[0]);
    const merged = [];
    blockers.forEach(b => {
      if (merged.length && b[0] <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b[1]);
      else merged.push(b.slice());
    });
    const cands = [];
    let prevRight = boundsMin;
    merged.forEach(b => { if (b[0] - prevRight > 8) cands.push({ lo: prevRight, hi: b[0] }); prevRight = Math.max(prevRight, b[1]); });
    if (boundsMax - prevRight > 8) cands.push({ lo: prevRight, hi: boundsMax });
    if (!cands.length) return preferredX;
    let best = null, bestD = Infinity;
    cands.forEach(g => {
      const x = Math.max(g.lo + 4, Math.min(preferredX, g.hi - 4));
      const d = Math.abs(x - preferredX);
      if (d < bestD) { bestD = d; best = x; }
    });
    return best;
  }

  // Path between two slots that live in the SAME scope grid. Optional
  // lane offset (0-based index, count) spreads multiple parallel edges
  // between the same pair of slots so they don't perfectly overlap.
  function pathWithinScope(grid, a, b, lane) {
    lane = lane || { idx: 0, count: 1 };
    if (a.rowIdx === b.rowIdx) {
      const top = Math.max(a.top, b.top), bot = Math.min(a.bottom, b.bottom);
      const baseY = (top + bot) / 2;
      const spread = (bot - top > 10) ? (bot - top - 8) : 0;
      const y = spread ? (top + 4 + spread * (lane.idx + 1) / (lane.count + 1)) : baseY;
      const goingRight = slotMidX(a) < slotMidX(b);
      return [[goingRight ? a.right : a.left, y], [goingRight ? b.left : b.right, y]];
    }
    const goingDown = a.rowIdx < b.rowIdx;
    const rowBottom = (r) => grid.rowYOffset[r] + grid.rowHeights[r];
    const rowTop = (r) => grid.rowYOffset[r];
    const y1 = goingDown ? rowBottom(a.rowIdx) : rowTop(a.rowIdx);
    const y2 = goingDown ? rowTop(b.rowIdx) : rowBottom(b.rowIdx);
    const loRow = Math.min(a.rowIdx, b.rowIdx), hiRow = Math.max(a.rowIdx, b.rowIdx);
    const fromX = slotMidX(a), toX = slotMidX(b);
    let travelX = toX;
    if (hiRow - loRow > 1) {
      const skipLoY = goingDown ? rowBottom(loRow) : rowTop(hiRow);
      const skipHiY = goingDown ? rowTop(hiRow) : rowBottom(loRow);
      travelX = findClearVerticalX(grid, Math.min(skipLoY, skipHiY), Math.max(skipLoY, skipHiY), toX, [a.name, b.name]);
    }
    if (lane.count > 1) {
      const spread = 10 * (lane.count - 1);
      travelX += -spread / 2 + spread * lane.idx / (lane.count - 1 || 1);
    }
    const pts = [[fromX, goingDown ? a.bottom : a.top]];
    if (Math.abs(y1 - pts[0][1]) > 0.5) pts.push([fromX, y1]);
    if (Math.abs(travelX - fromX) > 0.5) pts.push([travelX, y1]);
    if (Math.abs(y2 - y1) > 0.5) pts.push([travelX, y2]);
    if (Math.abs(travelX - toX) > 0.5) pts.push([toX, y2]);
    const lastY = goingDown ? b.top : b.bottom;
    if (Math.abs(lastY - (pts[pts.length - 1][1])) > 0.5) pts.push([toX, lastY]);
    return pts;
  }

  // Stub from a slot nested inside `grid` (a container/boundary's inner
  // scope) out to the box's own wall, biased toward `towardPoint` (the
  // point the rest of the path connects to one level up).
  function exitStub(grid, slot, towardPoint) {
    const numRows = grid.rowHeights.length;
    const boxTop = grid.rowYOffset[0] || 0;
    const boxBottom = (grid.rowYOffset[numRows - 1] || 0) + (grid.rowHeights[numRows - 1] || 0);
    const boxLeft = Math.min.apply(null, grid.slots.map(s => s.left));
    const boxRight = Math.max.apply(null, grid.slots.map(s => s.right));
    const twx = towardPoint[0], twy = towardPoint[1];

    // The target sits roughly at this box's own height -> exit sideways
    // (left/right wall) rather than through top/bottom. Row boundaries
    // are clear across the FULL grid width by construction, so exit the
    // slot to its own nearer row boundary, then travel along that clear
    // line straight to the box's edge.
    if (twy >= boxTop - 2 && twy <= boxBottom + 2) {
      const goingLeft = twx < (boxLeft + boxRight) / 2;
      const rowTop = grid.rowYOffset[slot.rowIdx];
      const rowBot = grid.rowYOffset[slot.rowIdx] + grid.rowHeights[slot.rowIdx];
      const useBottom = (slot.bottom - rowTop) <= (rowBot - slot.top);
      const laneY = useBottom ? rowBot : rowTop;
      const edgeX = goingLeft ? boxLeft : boxRight;
      const sx = slotMidX(slot);
      const pts = [[sx, useBottom ? slot.bottom : slot.top]];
      if (Math.abs(laneY - pts[0][1]) > 0.5) pts.push([sx, laneY]);
      pts.push([edgeX, laneY]);
      return pts;
    }

    const goingUp = twy < (boxTop + boxBottom) / 2;
    const edgeY = goingUp ? boxTop : boxBottom;
    const loRow = goingUp ? 0 : slot.rowIdx + 1;
    const hiRow = goingUp ? slot.rowIdx - 1 : numRows - 1;
    const sx = slotMidX(slot);
    let travelX = sx; // no corridor to search -> exit straight, no jog
    if (hiRow >= loRow) {
      travelX = findClearVerticalX(grid, grid.rowYOffset[loRow], grid.rowYOffset[hiRow] + grid.rowHeights[hiRow], towardPoint[0], [slot.name]);
    }
    const nearEdgeY = goingUp ? grid.rowYOffset[slot.rowIdx] : grid.rowYOffset[slot.rowIdx] + grid.rowHeights[slot.rowIdx];
    const pts = [[sx, goingUp ? slot.top : slot.bottom]];
    if (Math.abs(nearEdgeY - pts[0][1]) > 0.5) pts.push([sx, nearEdgeY]);
    if (Math.abs(travelX - sx) > 0.5) pts.push([travelX, nearEdgeY]);
    if (Math.abs(edgeY - nearEdgeY) > 0.5) pts.push([travelX, edgeY]);
    return pts;
  }

  // Full zone-to-zone path, walking up to the lowest common ancestor
  // scope when the two zones sit in different containers/boundary.
  // Returns null (caller falls back to the legacy router) when either
  // zone has no recorded scope -- e.g. a fixture built before channel
  // metadata existed, or a future zone kind this doesn't yet cover.
  function channelPath(fromZoneName, toZoneName, lane) {
    if (!channels) return null;
    const A = resolveEndpoint(fromZoneName), B = resolveEndpoint(toZoneName);
    if (!A || !B) return null;
    if (A.scopeId === B.scopeId) return pathWithinScope(A.grid, A.slot, B.slot, lane);

    const chainA = ancestorChain(A.scopeId), chainB = ancestorChain(B.scopeId);
    let lca = null, aIdx = -1, bIdx = -1;
    for (let i = 0; i < chainA.length; i++) {
      const j = chainB.indexOf(chainA[i]);
      if (j !== -1) { lca = chainA[i]; aIdx = i; bIdx = j; break; }
    }
    if (lca == null) return null;

    // Walk ONE side up from its own scope to the LCA, one level at a
    // time -- each level exits through its own box's wall toward that
    // box's position one level up, so a target nested two-plus levels
    // below the LCA (e.g. zone -> container -> boundary -> outer) gets a
    // separate stub through EVERY wall it's actually behind, not just
    // the outermost one.
    function walkUp(chain, idx, endpoint, targetPoint) {
      let pts = [];
      let curScope = chain[0], curGrid = endpoint.grid, curSlot = endpoint.slot;
      for (let level = 0; level < idx; level++) {
        const parentScope = chain[level + 1];
        const parentGrid = gridOf(parentScope);
        const boxName = curScope === 'boundary' ? 'boundary' : curScope;
        const boxSlotInParent = parentGrid && slotIn(parentGrid, boxName);
        if (!parentGrid || !boxSlotInParent) return null;
        pts = pts.concat(exitStub(curGrid, curSlot, targetPoint));
        curScope = parentScope; curGrid = parentGrid; curSlot = boxSlotInParent;
      }
      return { pts, slot: curSlot, grid: curGrid };
    }

    const bAnchor = [slotMidX(B.slot), (B.slot.top + B.slot.bottom) / 2];
    const aAnchor = [slotMidX(A.slot), (A.slot.top + A.slot.bottom) / 2];
    const upA = walkUp(chainA, aIdx, A, bAnchor);
    const upB = walkUp(chainB, bIdx, B, aAnchor);
    if (!upA || !upB) return null;

    const midPts = pathWithinScope(gridOf(lca), upA.slot, upB.slot, lane);
    const suffix = upB.pts.length ? upB.pts.slice().reverse() : [];
    return upA.pts.concat(midPts, suffix);
  }
  const laneCounts = {};

  // Adapt a ZONE-level channel path (endpoints on the zone's own
  // boundary) to the actual NODE cards the edge connects, by re-anchoring
  // the first/last waypoint to the node's own edge in whichever axis the
  // adjoining segment travels.
  function nodeizeChannelPath(zonePts, sNode, tNode) {
    if (!zonePts || zonePts.length < 2) return null;
    const sx = (sNode.left + sNode.right) / 2, sy = cy(sNode);
    const tx = (tNode.left + tNode.right) / 2, ty = cy(tNode);
    const n = zonePts.length;

    const fdx = zonePts[1][0] - zonePts[0][0], fdy = zonePts[1][1] - zonePts[0][1];
    const srcAxis = Math.abs(fdy) >= Math.abs(fdx) ? 0 : 1; // 0=x, 1=y
    const srcOldVal = zonePts[0][srcAxis];
    let srcEnd = 0;
    while (srcEnd < n && Math.abs(zonePts[srcEnd][srcAxis] - srcOldVal) < 0.5) srcEnd++;

    const ldx = zonePts[n - 1][0] - zonePts[n - 2][0], ldy = zonePts[n - 1][1] - zonePts[n - 2][1];
    const tgtAxis = Math.abs(ldy) >= Math.abs(ldx) ? 0 : 1;
    const tgtOldVal = zonePts[n - 1][tgtAxis];
    let tgtStart = n - 1;
    while (tgtStart >= 0 && Math.abs(zonePts[tgtStart][tgtAxis] - tgtOldVal) < 0.5) tgtStart--;
    tgtStart++;

    const start = srcAxis === 0 ? [sx, fdy >= 0 ? sNode.bottom : sNode.top] : [fdx >= 0 ? sNode.right : sNode.left, sy];
    const end = tgtAxis === 0 ? [tx, ldy >= 0 ? tNode.top : tNode.bottom] : [ldx >= 0 ? tNode.left : tNode.right, ty];

    if (srcEnd > tgtStart) {
      // The whole zone-level path is one uniform run in the shared axis
      // (a direct same-row/same-column jog with no intermediate turn),
      // so there's no natural breakpoint between "belongs to source" and
      // "belongs to target" -- insert one at the channel's own midpoint.
      if (srcAxis === 0) {
        const laneY = (zonePts[0][1] + zonePts[n - 1][1]) / 2;
        return [start, [sx, laneY], [tx, laneY], end];
      }
      const laneX = (zonePts[0][0] + zonePts[n - 1][0]) / 2;
      return [start, [laneX, sy], [laneX, ty], end];
    }

    const pts = zonePts.map(p => p.slice());
    for (let i = 0; i < srcEnd; i++) pts[i][srcAxis] = srcAxis === 0 ? sx : sy;
    for (let i = tgtStart; i < n; i++) pts[i][tgtAxis] = tgtAxis === 0 ? tx : ty;
    return [start].concat(pts, [end]);
  }

  // Drop consecutive duplicate/collinear points so tiny near-zero-length
  // stubs introduced by nodeizeChannelPath don't leave visual artifacts.
  function dedupCollinear(pts) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const prev = out[out.length - 1];
      if (Math.abs(p[0] - prev[0]) < 0.5 && Math.abs(p[1] - prev[1]) < 0.5) continue;
      if (out.length >= 2) {
        const p0 = out[out.length - 2];
        const collinearH = Math.abs(prev[1] - p0[1]) < 0.5 && Math.abs(p[1] - p0[1]) < 0.5;
        const collinearV = Math.abs(prev[0] - p0[0]) < 0.5 && Math.abs(p[0] - p0[0]) < 0.5;
        if (collinearH || collinearV) { out[out.length - 1] = p; continue; }
      }
      out.push(p);
    }
    return out;
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
      // Cross-zone: walk the channel grid (see channelPath above) instead
      // of guessing a shape and reactively dodging what it crosses.
      const laneKey = [s.zoneName, t.zoneName].sort().join('|');
      if (!laneCounts[laneKey]) laneCounts[laneKey] = 0;
      const laneIdx = laneCounts[laneKey]++;
      const zonePts = channelPath(s.zoneName, t.zoneName, { idx: laneIdx, count: 1 });
      const nodePts = zonePts && nodeizeChannelPath(zonePts, s, t);
      if (nodePts) {
        d = pointsToD(dedupCollinear(nodePts));
      } else {
        // Fallback for anything channelPath doesn't cover yet (e.g. a
        // zone missing from packed.channels): keep the old best-effort
        // H-V-H router rather than failing to draw the edge at all.
        const edgeMargin = 12;
        const x1 = (s.left + s.right) / 2, x2 = (t.left + t.right) / 2;
        const fx1 = x1 < x2 ? s.right + edgeMargin : s.left - edgeMargin;
        const fx2 = x1 < x2 ? t.left - edgeMargin : t.right + edgeMargin;
        const fTrackX = snapToGap((fx1 + fx2) / 2, fx1, fx2);
        d = pointsToD(routeOrthogonal(fx1, cy(s), fx2, cy(t), fTrackX, edge.source, edge.target));
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
