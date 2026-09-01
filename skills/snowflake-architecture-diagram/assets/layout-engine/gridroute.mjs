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
export function registerPathUsage(usage, path) {
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
  const midX = (rect.left + rect.right) / 2, midY = (rect.top + rect.bottom) / 2;
  return [
    { x: midX, y: rect.top, dir: 1, side: 'top' },
    { x: midX, y: rect.bottom, dir: 1, side: 'bottom' },
    { x: rect.left, y: midY, dir: 0, side: 'left' },
    { x: rect.right, y: midY, dir: 0, side: 'right' },
  ];
}

const CLEARANCE = 10; // px of standoff a path must keep from an unrelated obstacle's edge

/**
 * @param {{left,top,right,bottom,id}[]} obstacles - every rect that could block a path
 * @param {{left,top,right,bottom}} srcRect - the source node's own rect
 * @param {{left,top,right,bottom}} tgtRect - the target node's own rect
 * @param {Set<string>} excludeIds - obstacle ids the endpoints are allowed to sit inside
 * @param {{minX,minY,maxX,maxY}} bounds - canvas extent (fallback grid lines)
 * @returns {[number,number][]|null} waypoints, or null if no path exists (shouldn't happen on a bounded canvas)
 */
export function routeShortestOrthogonal(obstacles, srcRect, tgtRect, excludeIds, bounds, margin = 3, usage = null, portBias = null) {
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
    const forced = srcPorts.filter(p => p.side === portBias.srcSide);
    if (forced.length) srcPorts = forced;
  }
  if (portBias && portBias.tgtSide) {
    const forced = tgtPorts.filter(p => p.side === portBias.tgtSide);
    if (forced.length) tgtPorts = forced;
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

  const targetStates = new Map(); // key -> {x,y,cost}
  tgtPorts.forEach(p => {
    const extra = Math.abs(p.x - (tgtRect.left + tgtRect.right) / 2) + Math.abs(p.y - (tgtRect.top + tgtRect.bottom) / 2);
    targetStates.set(key(xi(p.x), yi(p.y), p.dir), { x: p.x, y: p.y, extra });
    targetStates.set(key(xi(p.x), yi(p.y), 1 - p.dir), { x: p.x, y: p.y, extra });
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

  // Prepend/append the true node-center-to-port stub (the seed cost
  // already accounted for it; this just materializes the waypoint).
  const srcCenter = [(srcRect.left + srcRect.right) / 2, (srcRect.top + srcRect.bottom) / 2];
  const tgtCenter = [(tgtRect.left + tgtRect.right) / 2, (tgtRect.top + tgtRect.bottom) / 2];
  const full = [srcCenter].concat(pts, [tgtCenter]);

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
  const firstPort = pts.length ? pts[0] : tgtCenter;
  const lastPort = pts.length ? pts[pts.length - 1] : srcCenter;
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
