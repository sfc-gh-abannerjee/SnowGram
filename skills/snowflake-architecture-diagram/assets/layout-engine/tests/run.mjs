// tests/run.mjs — pure-Node test harness (no browser).
//   node tests/run.mjs
//
// Verifies: determinism, geometry validity, and the routing invariant
// (no edge segment crosses a non-endpoint node card) — the same property
// the viewer commits cared about ("0 card crossings").

import { layout } from '../index.mjs';
import { assessQuality } from '../quality.mjs';

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); failures++; }
}

// ── fixtures ──
const medallionGraph = {
  nodes: [
    { id: 's3', label: 'AWS S3', detail: 'Data lake', componentType: 's3', zone: 'External Sources' },
    { id: 'kafka', label: 'Kafka', detail: 'Event stream', componentType: 'kafka', zone: 'External Sources' },
    { id: 'pipe', label: 'Snowpipe', detail: 'Auto-ingest', componentType: 'pipe', zone: 'Ingestion' },
    { id: 'bronze', label: 'Bronze Tables', detail: 'Raw VARIANT', componentType: 'table', zone: 'Bronze Layer' },
    { id: 'stream', label: 'Bronze Stream', detail: 'CDC', componentType: 'stream', zone: 'Bronze Layer' },
    { id: 'silver', label: 'Silver Tables', detail: 'Cleaned & conformed', componentType: 'dynamic_table', zone: 'Silver Layer' },
    { id: 'gold', label: 'Gold Tables', detail: 'Business aggregates', componentType: 'dynamic_table', zone: 'Gold Layer' },
    { id: 'bi', label: 'BI Platform', detail: 'Dashboards', componentType: 'bi_tool', zone: 'Consumption' },
  ],
  edges: [
    { from: 's3', to: 'pipe' }, { from: 'kafka', to: 'pipe' },
    { from: 'pipe', to: 'bronze' }, { from: 'bronze', to: 'stream' },
    { from: 'stream', to: 'silver' }, { from: 'silver', to: 'gold' },
    { from: 'gold', to: 'bi' },
  ],
};

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
const fanGraph = {
  nodes: [
    { id: 'src1', label: 'Source A', componentType: 's3', zone: 'Sources' },
    { id: 'src2', label: 'Source B', componentType: 'kafka', zone: 'Sources' },
    { id: 'proc1', label: 'Transform 1', componentType: 'task', zone: 'Processing' },
    { id: 'proc2', label: 'Transform 2', componentType: 'task', zone: 'Processing' },
    { id: 'proc3', label: 'Transform 3', componentType: 'task', zone: 'Processing' },
    { id: 'sink1', label: 'Gold A', componentType: 'dynamic_table', zone: 'Serving' },
    { id: 'sink2', label: 'Gold B', componentType: 'dynamic_table', zone: 'Serving' },
  ],
  edges: [
    { from: 'src1', to: 'proc1' }, { from: 'src1', to: 'proc2' }, { from: 'src1', to: 'proc3' },
    { from: 'src2', to: 'proc1' }, { from: 'src2', to: 'proc2' },
    { from: 'proc1', to: 'sink1' }, { from: 'proc2', to: 'sink1' }, { from: 'proc3', to: 'sink2' },
    { from: 'src1', to: 'sink2' }, // skip-zone edge
  ],
};

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
const wideChainGraph = {
  nodes: [
    { id: 'synapse', label: 'Azure Synapse', componentType: 'azure_synapse', zone: 'Apex Azure Sources' },
    { id: 'azsql', label: 'Azure SQL', componentType: 'azure_sql', zone: 'Apex Azure Sources' },
    { id: 'blob', label: 'Azure Blob', componentType: 'azure_blob_storage', zone: 'Apex Azure Sources' },
    { id: 'dbt', label: 'dbt', componentType: 'dbt', zone: 'Apex Transform' },
    { id: 'adf', label: 'Azure Data Factory', componentType: 'azure_data_factory', zone: 'Apex Ingestion' },
    { id: 'pl', label: 'Azure Private Link', componentType: 'azure_private_link', zone: 'Private Connectivity' },
    { id: 'arcadia', label: 'Arcadia Health', componentType: 'snowflake_account', zone: 'External Snowflake Provider' },
    { id: 'pipe', label: 'Snowpipe', componentType: 'snowpipe', zone: 'Ingest' },
    { id: 'bronze', label: 'Bronze', componentType: 'dynamic_table', zone: 'Medallion' },
    { id: 'silver', label: 'Silver', componentType: 'dynamic_table', zone: 'Medallion' },
    { id: 'gold', label: 'Gold', componentType: 'dynamic_table', zone: 'Medallion' },
    { id: 'wh', label: 'Warehouse', componentType: 'warehouse', zone: 'Compute' },
    { id: 'gov', label: 'Horizon Governance', componentType: 'governance', zone: 'Compute' },
    { id: 'share', label: 'Secure Data Sharing', componentType: 'secure_view', zone: 'Sharing' },
    { id: 'cortex', label: 'Cortex Cowork', componentType: 'cortex', zone: 'Apps' },
    { id: 'streamlit', label: 'Streamlit/React', componentType: 'streamlit', zone: 'Apps' },
    { id: 'analysts', label: 'Apex Analysts', componentType: 'user', zone: 'Consumers' },
    { id: 'pbi', label: 'Power BI (legacy)', componentType: 'power_bi', zone: 'Consumers' },
  ],
  edges: [
    { from: 'synapse', to: 'adf' }, { from: 'azsql', to: 'adf' }, { from: 'blob', to: 'adf' },
    { from: 'dbt', to: 'adf' }, { from: 'adf', to: 'pl' }, { from: 'pl', to: 'pipe' },
    { from: 'arcadia', to: 'share' }, { from: 'pipe', to: 'bronze' }, { from: 'bronze', to: 'silver' },
    { from: 'silver', to: 'gold' }, { from: 'share', to: 'gold' }, { from: 'gold', to: 'wh' },
    { from: 'wh', to: 'gov' }, { from: 'wh', to: 'cortex' }, { from: 'cortex', to: 'streamlit' },
    { from: 'streamlit', to: 'analysts' }, { from: 'pl', to: 'pbi' },
  ],
};
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
const nestedContainerGraph = {
  nodes: [
    { id: 'kinesis', label: 'Kinesis', category: 'onprem', zone: 'AWS Ingestion' },
    { id: 'lambda', label: 'AWS Lambda', category: 'onprem', zone: 'AWS Ingestion' },
    { id: 'glue', label: 'AWS Glue', category: 'onprem', zone: 'AWS Processing' },
    { id: 'emr', label: 'EMR', category: 'onprem', zone: 'AWS Processing' },
    { id: 'pipe', label: 'Snowpipe', componentType: 'pipe', zone: 'Ingest' },
    { id: 'bronze', label: 'Bronze', componentType: 'dynamic_table', zone: 'Medallion' },
    { id: 'bi', label: 'BI Tool', componentType: 'bi_tool', zone: 'Consumption' },
  ],
  edges: [
    { from: 'kinesis', to: 'lambda' }, { from: 'lambda', to: 'glue' }, { from: 'glue', to: 'emr' },
    { from: 'emr', to: 'pipe' }, { from: 'pipe', to: 'bronze' }, { from: 'bronze', to: 'bi' },
  ],
  containers: [
    { id: 'aws_account', label: 'AWS Account', container_ids: ['aws_vpc'] },
    { id: 'aws_vpc', label: 'AWS VPC', zone_names: ['AWS Ingestion', 'AWS Processing'] },
  ],
};
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

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
