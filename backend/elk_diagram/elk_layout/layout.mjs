#!/usr/bin/env node
/**
 * ELK layout engine for Snowflake architecture diagrams.
 * Takes a graph JSON on stdin (or from file arg), outputs layouted JSON with
 * node positions and edge waypoints to stdout.
 */
import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

// Read input from file arg or stdin
let input = '';
const args = process.argv.slice(2);

if (args.length > 0) {
  const fs = await import('fs');
  input = fs.readFileSync(args[0], 'utf-8');
} else {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  input = Buffer.concat(chunks).toString('utf-8');
}

const graph = JSON.parse(input);

try {
  const result = await elk.layout(graph);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('ELK layout error:', err.message);
  process.exit(1);
}
