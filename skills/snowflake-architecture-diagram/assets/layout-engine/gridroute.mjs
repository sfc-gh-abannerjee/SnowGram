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

// Minimum length for the segment directly touching a port, so the final
// approach reads as a clean, perpendicular run into the arrowhead instead
// of an awkward last-instant hook. Found 2026-09-09: the visibility grid's
// lines come purely from OBSTACLE edges (plus the ports themselves), so
// nothing stops two unrelated obstacles' clearance zones from coincidentally
// landing a turn just a few px from a port -- the search only knows total
// path cost, not "how far is the last hop." Real case: a path threading
// around an unrelated node's clearance zone happened to land its elbow
// only 8px from the target's own edge.
const MIN_STUB = 20;

// Slides a too-short first/last segment's shared elbow (and the segment
// before it, so that one stays straight too) further back along the
// corridor, re-validated against `active` so it can never introduce a new
// crossing -- see MIN_STUB above. Only safe when there are at least 3
// segments on that end (4 points) to absorb the shift without moving the
// FIXED source/target port itself; a direct 2-point line or a single-elbow
// 3-point path is left untouched (in practice neither tends to need it --
// the coincidental near-miss above only arises from routing around several
// obstacles' clearance zones, which needs multiple turns to happen at all).
function extendShortStubs(pts, active, margin) {
  if (pts.length < 4) return pts;
  const out = pts.map(p => p.slice());
  function segOk(x1, y1, x2, y2) {
    for (let i = 0; i < active.length; i++) {
      if (segmentBlockedByRect(x1, y1, x2, y2, active[i], margin)) return false;
    }
    return true;
  }
  function tryExtend(at, toward) {
    const port = out[at];
    const elbow = out[at + toward];
    const corridorFar = out[at + 2 * toward];
    const anchor = out[at + 3 * toward];
    const len = Math.abs(port[0] - elbow[0]) + Math.abs(port[1] - elbow[1]);
    if (len >= MIN_STUB) return;
    const axis = Math.abs(port[1] - elbow[1]) < 0.5 ? 0 : 1; // the short segment's own varying axis
    const dir = elbow[axis] > port[axis] ? 1 : -1;
    const delta = dir * (MIN_STUB - len);
    const newElbow = elbow.slice(); newElbow[axis] += delta;
    const newCorridorFar = corridorFar.slice(); newCorridorFar[axis] += delta;
    if (segOk(anchor[0], anchor[1], newCorridorFar[0], newCorridorFar[1]) &&
        segOk(newCorridorFar[0], newCorridorFar[1], newElbow[0], newElbow[1]) &&
        segOk(newElbow[0], newElbow[1], port[0], port[1])) {
      out[at + toward] = newElbow;
      out[at + 2 * toward] = newCorridorFar;
    }
    // else: no safe extension here -- leave the short stub as-is rather
    // than risk a crossing. Still geometrically valid, just not ideal.
  }
  tryExtend(0, 1);
  tryExtend(out.length - 1, -1);
  return out;
}

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
  const stubbed = extendShortStubs(out, active, margin);
  // Attach which side of each rect the winning path actually used, so a
  // caller routing several edges that share this src/tgt can bias
  // subsequent calls (via portBias) toward the same side -- keeps a fan-
  // in/fan-out cluster entering/exiting through one consistent side
  // instead of each edge independently picking whichever port tied on
  // cost. Arrays are objects in JS, so this doesn't change the return
  // type for existing callers that only index into it.
  const firstPort = pts.length ? pts[0] : null;
  const lastPort = pts.length ? pts[pts.length - 1] : null;
  stubbed.srcSide = sideOf(srcRect, firstPort);
  stubbed.tgtSide = sideOf(tgtRect, lastPort);
  return stubbed;
}

function sideOf(rect, point) {
  const [x, y] = point;
  if (Math.abs(y - rect.top) < 0.5) return 'top';
  if (Math.abs(y - rect.bottom) < 0.5) return 'bottom';
  if (Math.abs(x - rect.left) < 0.5) return 'left';
  if (Math.abs(x - rect.right) < 0.5) return 'right';
  return null;
}
