// build_udf.mjs — bundles the ESM layout engine into a single Snowflake
// JavaScript scalar UDF and writes deploy/LAYOUT_DIAGRAM.sql.
//
//   node build_udf.mjs
//
// The engine modules stay the single source of truth; this concatenates
// them (stripping import/export) into one UDF body so there is no code
// duplication. A Node smoke-test evaluates the bundled body and compares
// its output to the live layout() to guarantee the bundle is faithful.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { layout } from './index.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// dependency order: constants -> measure -> model -> pack -> route -> index
const ORDER = ['constants.mjs', 'measure.mjs', 'model.mjs', 'pack.mjs', 'route.mjs', 'index.mjs'];

function stripModule(src) {
  return src
    .split('\n')
    .filter(l => !/^\s*import\s/.test(l))                 // drop import lines
    .filter(l => !/^\s*export\s*\{[^}]*\}\s*from\s/.test(l)) // drop re-export-from
    .filter(l => !/^\s*export\s+default\b/.test(l))        // drop default export
    .map(l => l.replace(/^(\s*)export\s+(function|const|class|let|var)\b/, '$1$2')) // strip leading export
    .join('\n');
}

const body = ORDER.map(f => {
  const src = readFileSync(join(here, f), 'utf8');
  return `// ===== ${f} =====\n${stripModule(src)}`;
}).join('\n\n');

const udfBody = `${body}

// ===== UDF entry point =====
// GRAPH_JSON: a JSON string of { nodes, edges, zones? } OR a mermaid string.
// Returns a JSON string: { nodes, edges, zones, platformBoundary, width, height }.
var __input;
try {
  __input = JSON.parse(GRAPH_JSON);
} catch (e) {
  // not JSON -> treat as a mermaid string
  __input = GRAPH_JSON;
}
try {
  return JSON.stringify(layout(__input, {}));
} catch (e) {
  return JSON.stringify({ error: String((e && e.message) || e) });
}
`;

const sql = `-- =====================================================================
-- SNOWGRAM_DB.CORE.LAYOUT_DIAGRAM  (Cortex Agent custom tool)
-- =====================================================================
-- AUTO-GENERATED from assets/layout-engine/*.mjs by build_udf.mjs.
-- DO NOT EDIT BY HAND — edit the .mjs modules and re-run the build.
-- Author: Abhinav Bannerjee
--
-- Scalar JavaScript UDF the Cortex Agent calls as a custom tool. Accepts
-- the agent's emitted Graph Metadata JSON (or a mermaid string) and returns
-- positioned nodes + orthogonal edge paths as a JSON string.
--
-- Agents support scalar UDFs as custom tools; this returns VARCHAR (JSON)
-- so the agent receives a single string value (consistent with the other
-- SNOWGRAM_DB.CORE.* tool functions).
-- =====================================================================

CREATE OR REPLACE FUNCTION SNOWGRAM_DB.CORE.LAYOUT_DIAGRAM(GRAPH_JSON VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Deterministic diagram layout engine: graph (nodes/edges or mermaid) -> positioned nodes + orthogonal edge paths as JSON. Cortex Agent custom tool.'
AS $$
${udfBody}$$;
`;

mkdirSync(join(here, 'deploy'), { recursive: true });
const outPath = join(here, 'deploy', 'LAYOUT_DIAGRAM.sql');
writeFileSync(outPath, sql);
console.log('WROTE', outPath, '(' + sql.length + ' bytes)');

// ── smoke test: evaluate the bundled body in Node and compare to layout() ──
const fixture = {
  nodes: [
    { id: 's3', label: 'AWS S3', componentType: 's3', zone: 'External Sources' },
    { id: 'pipe', label: 'Snowpipe', componentType: 'pipe', zone: 'Ingestion' },
    { id: 'bronze', label: 'Bronze Tables', componentType: 'table', zone: 'Bronze Layer' },
    { id: 'silver', label: 'Silver Tables', componentType: 'dynamic_table', zone: 'Silver Layer' },
    { id: 'bi', label: 'BI Platform', componentType: 'bi_tool', zone: 'Consumption' },
  ],
  edges: [{ from: 's3', to: 'pipe' }, { from: 'pipe', to: 'bronze' }, { from: 'bronze', to: 'silver' }, { from: 'silver', to: 'bi' }],
};

// Wrap the bundled body as a function with GRAPH_JSON in scope (mimics the UDF).
const fn = new Function('GRAPH_JSON', udfBody);
const bundledOut = fn(JSON.stringify(fixture));
const directOut = JSON.stringify(layout(fixture, {}));
if (bundledOut === directOut) {
  console.log('SMOKE TEST OK — bundled UDF body matches layout() exactly');
} else {
  console.error('SMOKE TEST FAILED — bundle diverges from layout()');
  process.exitCode = 1;
}
