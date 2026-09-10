// tests/run.mjs — pure-Node test harness (no browser).
//   node tests/run.mjs
//
// Verifies: determinism, geometry validity, and the routing invariant
// (no edge segment crosses a non-endpoint node card) — the same property
// the viewer commits cared about ("0 card crossings").

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { layout } from '../index.mjs';
import { assessQuality } from '../quality.mjs';
import { route } from '../route.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
// Fixtures live in tests/fixtures/*.json -- the SAME files
// assets/scripts/review_harness.py reads to render visual review artifacts,
// so the numeric test suite and the visual review package can never drift
// apart from each other.
function fixture(name) { return JSON.parse(readFileSync(join(FIXTURES, name + '.json'), 'utf-8')); }

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); failures++; }
}

// ── fixtures ──
const medallionGraph = fixture('medallion');

const mermaidFixture = `flowchart LR
  subgraph Sources
    A[API Source]
    B[SaaS App]
  end
  subgraph Snowflake
    C[Raw Tables]
    D[Analytics Views]
  end
  A --> C
  B --> C
  C --> D
  classDef ext onprem
  class A,B ext`;

function run(name, input) {
  console.log('\n# ' + name);
  const a = layout(input);
  const b = layout(input);

  check('determinism (identical JSON across runs)', JSON.stringify(a) === JSON.stringify(b));
  check('all nodes have finite geometry', a.nodes.every(n => [n.x, n.y, n.w, n.h].every(Number.isFinite) && n.w > 0 && n.h > 0));
  check('all edges have >=2 points and a d string', a.edges.every(e => e.points.length >= 2 && typeof e.d === 'string' && e.d.startsWith('M')));
  check('positive canvas size', a.width > 0 && a.height > 0);

  // boundary contains snow/outcome/bridge zones
  if (a.platformBoundary) {
    const pb = a.platformBoundary;
    const inside = a.zones.filter(z => ['snow', 'outcome', 'bridge'].includes(z.category));
    const allIn = inside.every(z => z.x >= pb.x - 1 && z.x + z.w <= pb.x + pb.w + 1 && z.y >= pb.y - 1 && z.y + z.h <= pb.y + pb.h + 1);
    check('snow/bridge/outcome zones inside platform boundary', allIn);
  }

  // Generic quality gate (Phase 4a) -- same assessQuality() a live caller
  // (e.g. GENERATE_DIAGRAM_ARTIFACTS) would see on result.quality. Covers:
  // 0 card crossings (the viewer's original routing invariant), bounded
  // aspect ratio (the exact 16:1/unbounded-width pathology measured against
  // the live agent), and packing density (mostly-empty canvas).
  const q = a.quality || assessQuality(a);
  check('quality gate passes (crossings/aspect/density)', q.ok, JSON.stringify(q.issues));
  console.log(`  info nodes=${a.nodes.length} edges=${a.edges.length} size=${a.width}x${a.height} boundary=${!!a.platformBoundary} quality=${JSON.stringify(q.metrics)}`);
}

// fan-out + fan-in across zones → exercises bridged H-V-H-V-H routing
const fanGraph = fixture('fanout_finin');

run('medallion (graph JSON)', medallionGraph);
run('mermaid flowchart', mermaidFixture);
run('mermaid via {mermaid}', { mermaid: mermaidFixture });
run('fan-out/fan-in + skip-zone (bridged routing)', fanGraph);

// ── wide (icon-left) card style ──
// Same graph, nodeStyle:'wide' rides in the model JSON. All structural
// invariants must still hold, AND wide cards must be meaningfully shorter
// than their narrow equivalents (the whole point of the wide geometry).
const medallionWide = { ...medallionGraph, nodeStyle: 'wide' };
run('medallion WIDE (nodeStyle in model)', medallionWide);

console.log('\n# wide vs narrow card height');
const narrowMaxH = Math.max(...layout(medallionGraph).nodes.map(n => n.h));
const wideMaxH = Math.max(...layout(medallionWide).nodes.map(n => n.h));
check('wide cards shorter than narrow (<= 0.75x)', wideMaxH <= narrowMaxH * 0.75,
  `narrowMaxH=${narrowMaxH} wideMaxH=${wideMaxH}`);
check('wide cards still positive height', wideMaxH > 0);
console.log(`  info narrowMaxH=${narrowMaxH} wideMaxH=${wideMaxH} ratio=${(wideMaxH / narrowMaxH).toFixed(2)}`);

// ── row-wrap stress fixture (Phase 1) ──
// Mirrors the exact shape that produced an unbounded, ~16:1 layout from the
// live agent (9 zones, mostly single-column, chained left-to-right): 4
// outside source/transform zones -> a platform boundary with 5 inside zones
// -> 2 outside consumer zones. Without row-wrap this is 9 columns wide with
// nothing to bound it; with it, later columns should wrap onto new rows.
// Kept deliberately free of intra-zone fan-out (a separate, pre-existing
// router limitation tracked independently — see KNOWN_GAPS.md) so this
// isolates row-wrap behavior specifically.
const wideChainGraph = fixture('row_wrap_stress');
run('row-wrap stress (Apex-Health-scale, 18 nodes / 9 zones)', wideChainGraph);
{
  const r = layout(wideChainGraph);
  check('row-wrap actually engaged (>1 row, i.e. height grew beyond a single row)', r.height > 700, 'height=' + r.height);
  check('row-wrap kept width near the cap (not 9 unbounded columns)', r.width <= 1900, 'width=' + r.width);
  console.log(`  info width=${r.width} height=${r.height} aspect=${Math.max(r.width / r.height, r.height / r.width).toFixed(2)}`);
}

// ── nested containers (Phase 2) ──
// "AWS Account" (top-level, no zones of its own) wraps a child container
// "AWS VPC" (which wraps two real zones). Exercises: recursive bottom-up
// sizing, a pure-wrapper container with no direct zone membership, and
// route.mjs's container-boundary crossing avoidance (the ingestion chain
// runs entirely inside the nested boxes before ever reaching the platform
// boundary).
const nestedContainerGraph = fixture('nested_containers');
run('nested containers (AWS Account > AWS VPC > 2 zones)', nestedContainerGraph);
{
  const r = layout(nestedContainerGraph);
  const byId = {}; r.containers.forEach(c => { byId[c.id] = c; });
  check('both containers present', r.containers.length === 2, JSON.stringify(r.containers.map(c => c.id)));
  const acct = byId['aws_account'], vpc = byId['aws_vpc'];
  check('AWS VPC is a child of AWS Account', !!acct && !!vpc && vpc.parentId === 'aws_account');
  check('AWS Account has no parent (top-level)', !!acct && acct.parentId == null);
  if (acct && vpc) {
    const nested = vpc.x >= acct.x && vpc.y >= acct.y && vpc.x + vpc.w <= acct.x + acct.w + 1 && vpc.y + vpc.h <= acct.y + acct.h + 1;
    check('AWS VPC rect nested fully inside AWS Account rect', nested, JSON.stringify({ acct, vpc }));
  }
  const ingestionZones = r.zones.filter(z => z.name === 'AWS Ingestion' || z.name === 'AWS Processing');
  check('both AWS zones resolved', ingestionZones.length === 2, JSON.stringify(r.zones.map(z => z.name)));
  if (vpc) {
    const allInVpc = ingestionZones.every(z => z.x >= vpc.x - 1 && z.y >= vpc.y - 1 && z.x + z.w <= vpc.x + vpc.w + 1 && z.y + z.h <= vpc.y + vpc.h + 1);
    check('AWS Ingestion/Processing zones sit inside AWS VPC rect', allInVpc);
  }
  if (acct && r.platformBoundary) {
    const overlap = !(acct.x + acct.w < r.platformBoundary.x || acct.x > r.platformBoundary.x + r.platformBoundary.w);
    check('AWS Account container does not overlap the platform boundary', !overlap);
  }
}

// ── mixed-category zone detection (found 2026-09-09) ──
// A live "showcase" diagram mixed a data-share consumer (category 'onprem',
// via icon-search fallback) and a Streamlit dashboard (category 'outcome')
// into the same "Consume" layer. The zone's rendered category came from
// whichever node was declared FIRST, silently sweeping the Streamlit card
// outside the platform boundary -- a real semantic bug assessQuality()
// could never catch since it only sees geometry, not category. This proves
// the new checkCategoryConsistency() check (merged into result.quality)
// actually catches that exact shape, both when it's present AND absent.
{
  const mixedGraph = {
    nodes: [
      { id: 'share', label: 'Arcadia Health', componentType: 'data share consumer', category: 'onprem', zone: 'Consume' },
      { id: 'dash', label: 'Executive Dashboard', componentType: 'streamlit', category: 'outcome', zone: 'Consume' },
      { id: 'gold', label: 'Gold', componentType: 'dynamic table', zone: 'Pipeline' },
    ],
    edges: [{ source: 'gold', target: 'dash' }, { source: 'gold', target: 'share' }],
  };
  const r = layout(mixedGraph);
  console.log('\n# mixed-category zone (regression: Streamlit swept outside boundary)');
  check('quality gate FAILS on a mixed-category zone (discriminating power)', r.quality.ok === false);
  check('flagged issue names the mixed zone', r.quality.issues.some(i => i.code === 'MIXED_CATEGORY_ZONE' && i.detail.includes('Consume')),
    JSON.stringify(r.quality.issues));

  // and the inverse: splitting into separate zones (the actual fix applied
  // to the live showcase) must clear the flag -- proves the check isn't
  // just permanently red, i.e. it has real discriminating power both ways.
  const splitGraph = {
    nodes: [
      { id: 'share', label: 'Arcadia Health', componentType: 'data share consumer', category: 'onprem', zone: 'Partner Share' },
      { id: 'dash', label: 'Executive Dashboard', componentType: 'streamlit', category: 'outcome', zone: 'Consume' },
      { id: 'gold', label: 'Gold', componentType: 'dynamic table', zone: 'Pipeline' },
    ],
    edges: [{ source: 'gold', target: 'dash' }, { source: 'gold', target: 'share' }],
  };
  const r2 = layout(splitGraph);
  check('quality gate PASSES once the zones are split by category', r2.quality.ok === true, JSON.stringify(r2.quality.issues));
}

// ── fan-in port-CONSISTENCY invariant (the original motivating case,
// commit 981bbd4: "Make fan-in/fan-out portBias a hard constraint") ──
// Explicitly asserts the actual invariant the hard-constraint mechanism
// exists for, not just "quality gate passes": proc1 and proc2 both feed
// sink1 from the same rough direction (Processing -> Serving, a clean
// left-to-right zone gap) and must arrive on the SAME side of sink1 (same
// final x-coordinate), not split across two sides with overlapping
// arrowheads. This is the regression the 2026-09-09 direction-scoping fix
// (below) must NOT break.
{
  console.log('\n# fan-in port consistency (regression: must still hold post direction-scoping)');
  const r = layout(fixture('fanout_finin'));
  const toSink1 = r.edges.filter(e => e.to === 'sink1');
  check('sink1 has exactly 2 incoming edges in this fixture', toSink1.length === 2, JSON.stringify(toSink1.map(e => e.from)));
  if (toSink1.length === 2) {
    const lastX = e => e.points[e.points.length - 1][0];
    check('proc1->sink1 and proc2->sink1 arrive on the same side (same entry x)',
      Math.abs(lastX(toSink1[0]) - lastX(toSink1[1])) < 0.5,
      JSON.stringify(toSink1.map(e => ({ from: e.from, points: e.points }))));
  }
}

// ── direction-scoped port bias (found 2026-09-09 via a live Apex Health
// render) ──
// "Azure Private Link" has two OUTGOING edges: one to Snowpipe, positioned
// far down-and-left (a genuinely different rough direction), and one to
// Power BI, its immediate right-side neighbor in the same row. The
// (pre-fix) global-per-node port-consistency mechanism forced BOTH onto
// whichever side Snowpipe's edge claimed first, dragging the Power BI
// edge's path back through Private Link's own card to reach a side it
// never needed. Verified directly against route.mjs with the REAL
// coordinates pulled from the live-agent render that showed the bug
// (review-runs/20260909-170927), bypassing pack.mjs's automatic
// zone/column placement so this test can never silently stop exercising
// the bug just because some unrelated future layout change repositions
// these nodes differently.
{
  console.log('\n# direction-scoped port bias (regression: gateway node with incompatible-direction fan-out)');
  const rectsById = {
    adf:         { id: 'adf', left: 20.5, top: 147.5, right: 180.5, bottom: 246.5, zoneName: 'z_adf', rowIdx: 0 },
    privatelink: { id: 'privatelink', left: 928.5, top: 147.5, right: 1088.5, bottom: 246.5, zoneName: 'z_pl', rowIdx: 0 },
    powerbi:     { id: 'powerbi', left: 1203.5, top: 147.5, right: 1363.5, bottom: 246.5, zoneName: 'z_pbi', rowIdx: 0 },
    pipe:        { id: 'pipe', left: 360.5, top: 676.0, right: 520.5, bottom: 775.0, zoneName: 'z_pipe', rowIdx: 3 },
    gold:        { id: 'gold', left: 946.5, top: 895.0, right: 1106.5, bottom: 989.0, zoneName: 'z_gold', rowIdx: 4 },
  };
  const nodeRects = Object.values(rectsById);
  const zoneRects = nodeRects.map(n => ({ name: n.zoneName, left: n.left - 10, top: n.top - 30, right: n.right + 10, bottom: n.bottom + 10 }));
  const zoneScope = {}; nodeRects.forEach(n => { zoneScope[n.zoneName] = 'outer'; });
  const packed = {
    nodeRects, nodeRectsById: rectsById, zoneRects,
    platformBoundary: null, containers: [],
    width: 1500, height: 1100,
    zoneScope, containerScope: {},
  };
  const model = {
    edges: [
      { source: 'adf', target: 'privatelink' },
      { source: 'privatelink', target: 'pipe' },
      { source: 'gold', target: 'privatelink' },
      { source: 'privatelink', target: 'powerbi' },
    ],
  };
  const edges = route(model, packed);
  const toPipe = edges.find(e => e.source === 'privatelink' && e.target === 'pipe');
  const toPowerbi = edges.find(e => e.source === 'privatelink' && e.target === 'powerbi');
  check('both edges resolved', !!toPipe && !!toPowerbi);
  if (toPipe && toPowerbi) {
    check('privatelink->powerbi is a direct 2-point path (no forced detour)',
      toPowerbi.points.length === 2, JSON.stringify(toPowerbi.points));
    check('privatelink->powerbi never re-enters its own source card (all points at/outside its right edge)',
      toPowerbi.points.every(p => p[0] >= rectsById.privatelink.right - 0.5), JSON.stringify(toPowerbi.points));
    // The two edges must NOT share an exit side -- that sharing is
    // precisely what caused the bug (both forced onto Snowpipe's side).
    const exitSide = pts => Math.abs(pts[0][0] - rectsById.privatelink.left) < 1 ? 'left'
      : Math.abs(pts[0][0] - rectsById.privatelink.right) < 1 ? 'right'
      : Math.abs(pts[0][1] - rectsById.privatelink.top) < 1 ? 'top' : 'bottom';
    check('privatelink->pipe and privatelink->powerbi use DIFFERENT exit sides',
      exitSide(toPipe.points) !== exitSide(toPowerbi.points),
      'pipe exit=' + exitSide(toPipe.points) + ' powerbi exit=' + exitSide(toPowerbi.points));
  }
}

// ── minimum port-approach stub (found 2026-09-09 via a live Apex Health
// render, same session as the direction-scoped fix above) ──
// The SAME "Azure Private Link" -> "Snowpipe" edge had a razor-thin ~8px
// final segment: the visibility grid's lines come purely from obstacle
// edges (here, Azure Data Factory's own clearance-inflated right edge
// landed by pure coincidence just 8px from Snowpipe's own port), and the
// search has no concept of "how far is the last hop" -- only total path
// cost. Visually this reads as an awkward last-instant hook right at the
// arrowhead. gridroute.mjs's extendShortStubs() post-processes the found
// path to push the segment directly touching a port toward MIN_STUB (20px),
// re-validated against the same obstacle list so it can never introduce a
// new crossing.
//
// The available room here (~13.5px between Azure Data Factory's clearance
// zone and Snowpipe's own "Ingestion" zone boundary) is tighter than
// MIN_STUB itself, so extendShortStubs can't reach the full 20px without
// running the corridor right up against Ingestion's own zone edge instead
// -- found 2026-09-09, same fix: an earlier version reached 20px exactly
// this way, landing the corridor only 1.5px from Ingestion's boundary
// (visually indistinguishable from running along it -- exactly the
// "hugging a boundary" defect this fix exists to remove, just relocated to
// a different boundary). extendShortStubs also caps the slide against
// HUG_CLEARANCE (8px) from any OTHER rect (even ones excluded as active
// obstacles, like the edge's own destination zone), so in a corridor this
// tight it settles for a partial, hug-free improvement (13.5px) rather
// than the full target.
//
// Uses the REAL 16-node/18-edge model pulled from the live-agent trace that
// showed the bug (review-runs/20260909-185536), run through the actual
// layout() pipeline (not a hand-built packed object) -- a reduced repro
// with only the 2-3 edges directly involved was tried first and did NOT
// reproduce the bug at all (found a completely different, already-fine
// 3-point path), because this specific corridor only forms as a side
// effect of ALL 18 edges' combined obstacle/lane pressure. Fidelity to the
// real scenario mattered more than a minimal repro here.
{
  console.log('\n# minimum port-approach stub (regression: razor-thin final segment into a port)');
  const model = fixture('apex_health_privatelink_stub');
  const r = layout(model);
  const e = r.edges.find(x => x.from === 'privatelink' && x.to === 'snowpipe');
  check('privatelink->snowpipe resolved', !!e);
  if (e) {
    const pts = e.points;
    const last = pts.length - 1;
    const finalLen = Math.abs(pts[last][0] - pts[last - 1][0]) + Math.abs(pts[last][1] - pts[last - 1][1]);
    check('final approach segment into snowpipe meaningfully longer than the original 8px stub',
      finalLen >= 12, 'finalLen=' + finalLen + ' points=' + JSON.stringify(pts));
    // Ingestion's zone rect right edge in this fixture's real geometry is
    // x=1086 -- the corridor (pts[2]/pts[3]'s shared x) must stay far
    // enough from it that the connector doesn't visually merge with the
    // zone's own border, which is the exact defect this second check
    // guards against (a prior version of the fix passed the length check
    // above while landing the corridor only 1.5px from this edge).
    const corridorX = pts[2][0];
    check('corridor does not hug Snowpipe\'s own zone boundary (>= 6px clearance)',
      (1086 - corridorX) >= 6, 'corridorX=' + corridorX + ' distanceFromIngestionEdge=' + (1086 - corridorX));
  }
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);