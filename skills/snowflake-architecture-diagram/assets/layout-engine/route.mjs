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
  const { nodeRects, nodeRectsById, zoneRects, subColRects, zoneGaps, platformBoundary } = packed;
  if (!edges.length) return [];

  const nodeIdToZoneName = {}; nodeRects.forEach(nr => { nodeIdToZoneName[nr.id] = nr.zoneName; });
  const nodeIdToSubColIdx = {}; nodeRects.forEach(nr => { if (nr.subColIdx != null) nodeIdToSubColIdx[nr.id] = nr.subColIdx; });
  const zoneRectByName = {}; zoneRects.forEach(z => { zoneRectByName[z.name] = z; });

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

  function pointsToD(pts) {
    if (!pts.length) return '';
    let s = 'M' + pts[0][0] + ',' + pts[0][1];
    for (let i = 1; i < pts.length; i++) s += ' L' + pts[i][0] + ',' + pts[i][1];
    return s;
  }

  // ── routeOrthogonal (cross-zone obstacle-aware) ──
  function routeOrthogonal(x1, y1, x2, y2, trackX, srcId, tgtId) {
    const srcZoneName = nodeIdToZoneName[srcId] || '';
    const tgtZoneName = nodeIdToZoneName[tgtId] || '';
    const srcSubIdx = nodeIdToSubColIdx[srcId];
    const tgtSubIdx = nodeIdToSubColIdx[tgtId];

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
    if (!zHits1.length && !zHits2.length && !cHits1.length && !cHits2.length) {
      return [[x1, y1], [trackX, y1], [trackX, y2], [x2, y2]];
    }

    const goingRight = (x2 > x1);
    const loX = Math.min(x1, x2), hiX = Math.max(x1, x2);
    const allZoneHits = [];
    const pathTopBand = Math.min(y1, y2), pathBotBand = Math.max(y1, y2);
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
      const useHorizontal = horizontalGap || (!verticalGap && Math.abs(tgtZoneCx - srcZoneCx) > 20);
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
        d = 'M' + x1 + ',' + y1 + ' L' + x1 + ',' + turnY + ' L' + x2 + ',' + turnY + ' L' + x2 + ',' + y2;
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
