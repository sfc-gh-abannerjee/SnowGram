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

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);