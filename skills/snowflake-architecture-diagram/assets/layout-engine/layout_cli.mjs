// layout_cli.mjs — local stand-in for the deployed LAYOUT_DIAGRAM UDF.
//
// Reads a model JSON (the same {nodes, edges[, nodeStyle]} graph the agent
// passes to LAYOUT_DIAGRAM) from a file argument or stdin, runs the canonical
// layout() engine, and prints the layout JSON to stdout. This is how the local
// render path (scripts/render_local.py) obtains geometry identical to the
// agent's, by running the SAME engine source the UDF is bundled from.
//
// Usage:
//   node layout_cli.mjs model.json            # narrow (svg/drawio/mmd geometry)
//   node layout_cli.mjs model.json --wide     # wide (icon-left HTML geometry)
//   cat model.json | node layout_cli.mjs -    # stdin
//
// nodeStyle can also be set inside the model JSON; --wide is a convenience that
// forces it on.
import { readFileSync } from 'node:fs';
import { layout } from './index.mjs';

function readInput(pathArg) {
  if (!pathArg || pathArg === '-') return readFileSync(0, 'utf-8');
  return readFileSync(pathArg, 'utf-8');
}

try {
  const args = process.argv.slice(2);
  const wide = args.includes('--wide');
  const pathArg = args.find(a => a !== '--wide');
  const model = JSON.parse(readInput(pathArg));
  if (wide) model.nodeStyle = 'wide';
  const out = layout(model, {});
  process.stdout.write(JSON.stringify(out));
} catch (err) {
  process.stdout.write(JSON.stringify({ error: String(err && err.message || err) }));
  process.exit(1);
}
