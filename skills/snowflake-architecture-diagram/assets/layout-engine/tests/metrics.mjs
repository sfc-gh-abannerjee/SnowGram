// tests/metrics.mjs — objective connector-quality metrics over engine output.
//   node tests/metrics.mjs
//
// Phase-0 baseline harness for the connector-routing rework. Computes, per
// fixture, the metrics that the layered-drawing phases should improve:
//   logical_inversions  zone-aware Sugiyama crossing count (the refine oracle)
//   crossing_edge_pairs  pairs of edges whose POLYLINE segments truly cross
//                        (uses `points`, not `d`, so router line-jumps don't hide them)
//   total_bends          real direction changes (cross-product), not collinear pts
//   bus_stagger          spread of convergence/divergence elbows at fan-in/out
//                        (0 = one clean trunk; large = staggered)
//   multi_zone_edges     edges spanning >1 zone-rank (the long-bus risk)
//
// Routing depends on card geometry, so we measure with nodeStyle:'wide' to match
// the deployed HTML viewer (the surface we are fixing).

import { layout } from '../index.mjs';

// ---- fixtures (id -> zone derived from node.zone; explicit category to match render) ----
const stress19 = {
  nodeStyle: 'wide',
  nodes: [
    { id: 's3', label: 'AWS S3 Data Lake', componentType: 'aws s3', zone: 'Sources', category: 'onprem' },
    { id: 'kafka', label: 'Kafka Stream', componentType: 'kafka', zone: 'Sources', category: 'onprem' },
    { id: 'blob', label: 'Azure Blob Storage', componentType: 'azure blob storage', zone: 'Sources', category: 'onprem' },
    { id: 'pg', label: 'Postgres OLTP', componentType: 'postgresql', zone: 'Sources', category: 'onprem' },
    { id: 'pipe', label: 'Snowpipe Streaming', componentType: 'snowpipe', zone: 'Ingest', category: 'bridge' },
    { id: 'stage', label: 'External Stage', componentType: 'stage', zone: 'Ingest', category: 'snow' },
    { id: 'bronze', label: 'Bronze DT', componentType: 'dynamic table', zone: 'Transform', category: 'snow' },
    { id: 'silver', label: 'Silver DT', componentType: 'dynamic table', zone: 'Transform', category: 'snow' },
    { id: 'gold', label: 'Gold DT', componentType: 'dynamic table', zone: 'Transform', category: 'snow' },
    { id: 'strm', label: 'CDC Stream', componentType: 'stream', zone: 'Transform', category: 'snow' },
    { id: 'task', label: 'Enrich Task', componentType: 'task', zone: 'Transform', category: 'snow' },
    { id: 'feat', label: 'Feature Store', componentType: 'snowpark', zone: 'AI / ML', category: 'snow' },
    { id: 'train', label: 'ML Training', componentType: 'snowflake ml', zone: 'AI / ML', category: 'snow' },
    { id: 'analyst', label: 'Cortex Analyst', componentType: 'cortex', zone: 'AI / ML', category: 'snow' },
    { id: 'agent', label: 'Agent', componentType: 'agent', zone: 'AI / ML', category: 'outcome' },
    { id: 'gov', label: 'Tag Masking + RAP', componentType: 'governance', zone: 'Governance', category: 'snow' },
    { id: 'tableau', label: 'Tableau', componentType: 'tableau', zone: 'Consume', category: 'outcome' },
    { id: 'app', label: 'Streamlit App', componentType: 'streamlit', zone: 'Consume', category: 'outcome' },
    { id: 'rev', label: 'Reverse ETL to Salesforce', componentType: 'saas', zone: 'Consume', category: 'outcome' },
  ],
  edges: [
    { from: 's3', to: 'pipe' }, { from: 'kafka', to: 'pipe' }, { from: 'blob', to: 'stage' }, { from: 'pg', to: 'strm' },
    { from: 'pipe', to: 'bronze' }, { from: 'stage', to: 'bronze' }, { from: 'bronze', to: 'silver' }, { from: 'silver', to: 'gold' },
    { from: 'strm', to: 'task' }, { from: 'task', to: 'silver' }, { from: 'gold', to: 'feat' }, { from: 'feat', to: 'train' },
    { from: 'gold', to: 'analyst' }, { from: 'analyst', to: 'agent' }, { from: 'train', to: 'agent' }, { from: 'gold', to: 'gov' },
    { from: 'gold', to: 'tableau' }, { from: 'gold', to: 'app' }, { from: 'agent', to: 'app' }, { from: 'analyst', to: 'rev' },
  ],
};

const medallion8 = {
  nodeStyle: 'wide',
  nodes: [
    { id: 's3', label: 'AWS S3', componentType: 's3', zone: 'External Sources' },
    { id: 'kafka', label: 'Kafka', componentType: 'kafka', zone: 'External Sources' },
    { id: 'pipe', label: 'Snowpipe', componentType: 'pipe', zone: 'Ingestion' },
    { id: 'bronze', label: 'Bronze', componentType: 'table', zone: 'Bronze' },
    { id: 'stream', label: 'Stream', componentType: 'stream', zone: 'Bronze' },
    { id: 'silver', label: 'Silver', componentType: 'dynamic_table', zone: 'Silver' },
    { id: 'gold', label: 'Gold', componentType: 'dynamic_table', zone: 'Gold' },
    { id: 'bi', label: 'BI', componentType: 'bi_tool', zone: 'Consumption' },
  ],
  edges: [
    { from: 's3', to: 'pipe' }, { from: 'kafka', to: 'pipe' }, { from: 'pipe', to: 'bronze' },
    { from: 'bronze', to: 'stream' }, { from: 'stream', to: 'silver' }, { from: 'silver', to: 'gold' }, { from: 'gold', to: 'bi' },
  ],
};

// ---- metric helpers ----
const cx = n => n.x + n.w / 2;
const cyc = n => n.y + n.h / 2;

function zoneMapOf(fixture) {
  const m = {};
  fixture.nodes.forEach(n => { m[n.id] = n.zone; });
  return m;
}

function logicalInversions(edges, byId, zone) {
  let inv = 0;
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const a = edges[i], b = edges[j];
    const as = byId[a.source], at = byId[a.target], bs = byId[b.source], bt = byId[b.target];
    if (!as || !at || !bs || !bt) continue;
    if (a.source === b.source || a.target === b.target) continue;
    if (zone[a.source] !== zone[b.source] || zone[a.target] !== zone[b.target]) continue;
    if (zone[a.source] === zone[a.target]) continue; // cross-zone only
    const dsrc = cyc(as) - cyc(bs), dtgt = cyc(at) - cyc(bt);
    if (dsrc * dtgt < 0) inv++;
  }
  return inv;
}

function segProperIntersect(p1, p2, p3, p4) {
  function o(a, b, c) { const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return v > 1e-9 ? 1 : (v < -1e-9 ? -1 : 0); }
  const o1 = o(p1, p2, p3), o2 = o(p1, p2, p4), o3 = o(p3, p4, p1), o4 = o(p3, p4, p2);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

function crossingEdgePairs(outEdges) {
  let pairs = 0;
  for (let i = 0; i < outEdges.length; i++) for (let j = i + 1; j < outEdges.length; j++) {
    const A = outEdges[i].points, B = outEdges[j].points;
    if (outEdges[i].from === outEdges[j].from || outEdges[i].to === outEdges[j].to ||
        outEdges[i].from === outEdges[j].to || outEdges[i].to === outEdges[j].from) continue;
    let crossed = false;
    for (let a = 0; a < A.length - 1 && !crossed; a++) for (let b = 0; b < B.length - 1 && !crossed; b++) {
      if (segProperIntersect(A[a], A[a + 1], B[b], B[b + 1])) crossed = true;
    }
    if (crossed) pairs++;
  }
  return pairs;
}

function bendCount(pts) {
  let n = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ax = pts[i][0] - pts[i - 1][0], ay = pts[i][1] - pts[i - 1][1];
    const bx = pts[i + 1][0] - pts[i][0], by = pts[i + 1][1] - pts[i][1];
    if ((Math.abs(ax) < 1e-9 && Math.abs(ay) < 1e-9) || (Math.abs(bx) < 1e-9 && Math.abs(by) < 1e-9)) continue;
    const cross = ax * by - ay * bx, dot = ax * bx + ay * by;
    if (Math.abs(cross) > 1e-6 || dot < 0) n++;
  }
  return n;
}

function busStagger(outEdges) {
  // For each fan-in target / fan-out source, spread of the convergence x — the
  // x where edges make their turn toward the node. The layout flows left->right,
  // so cleanly-merged edges share one trunk x (stagger 0); a staggered fan turns
  // at different x's. y-spread is expected (tree structure), so it is NOT counted.
  const inByT = {}, outByS = {};
  outEdges.forEach(e => {
    const pts = e.points; if (pts.length < 2) return;
    (inByT[e.to] = inByT[e.to] || []).push(pts[pts.length - 2]);   // elbow before target
    (outByS[e.from] = outByS[e.from] || []).push(pts[1]);          // elbow after source
  });
  let s = 0;
  [inByT, outByS].forEach(grp => Object.values(grp).forEach(elbows => {
    if (elbows.length < 2) return;
    const xs = elbows.map(p => p[0]);
    s += (Math.max(...xs) - Math.min(...xs));
  }));
  return Math.round(s);
}

function zoneRankOf(outNodes, zone) {
  const zx = {};
  outNodes.forEach(n => { const z = zone[n.id]; if (z == null) return; const x = n.x; if (zx[z] === undefined || x < zx[z]) zx[z] = x; });
  const order = Object.keys(zx).sort((a, b) => zx[a] - zx[b]);
  const rank = {}; order.forEach((z, i) => { rank[z] = i; });
  return rank;
}

function multiZoneEdges(edges, zone, rank) {
  let c = 0;
  edges.forEach(e => { const a = rank[zone[e.source]], b = rank[zone[e.target]]; if (a != null && b != null && Math.abs(a - b) > 1) c++; });
  return c;
}

function measure(name, fixture) {
  const out = layout(fixture);
  const byId = {}; out.nodes.forEach(n => { byId[n.id] = n; });
  const zone = zoneMapOf(fixture);
  const rank = zoneRankOf(out.nodes, zone);
  const m = {
    logical_inversions: logicalInversions(fixture.edges.map(e => ({ source: e.from, target: e.to })), byId, zone),
    crossing_edge_pairs: crossingEdgePairs(out.edges),
    total_bends: out.edges.reduce((s, e) => s + bendCount(e.points), 0),
    bus_stagger: busStagger(out.edges),
    multi_zone_edges: multiZoneEdges(fixture.edges.map(e => ({ source: e.from, target: e.to })), zone, rank),
  };
  // determinism check
  const out2 = layout(fixture);
  const deterministic = JSON.stringify(out2.edges) === JSON.stringify(out.edges) && JSON.stringify(out2.nodes) === JSON.stringify(out.nodes);
  return { name, nodes: out.nodes.length, edges: out.edges.length, deterministic, ...m };
}

const fixtures = [['stress19', stress19], ['medallion8', medallion8]];
const rows = fixtures.map(([n, f]) => measure(n, f));
console.log('\nConnector-quality metrics (nodeStyle: wide) — lower is better for all but determinism\n');
const cols = ['name', 'nodes', 'edges', 'logical_inversions', 'crossing_edge_pairs', 'total_bends', 'bus_stagger', 'multi_zone_edges', 'deterministic'];
console.log(cols.join('\t'));
rows.forEach(r => console.log(cols.map(c => r[c]).join('\t')));
console.log('');
