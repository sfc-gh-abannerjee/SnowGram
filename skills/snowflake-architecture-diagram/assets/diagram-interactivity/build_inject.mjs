// build_inject.mjs — bundle interactivity.css + interactivity.js into a
// single inlinable HTML snippet the agent's HTML generator can concatenate
// into a standalone diagram file (which cannot reference external assets).
//
//   node build_inject.mjs   ->  writes inject-snippet.html
//
// The snippet is self-contained and auto-attaches on DOMContentLoaded:
// drop it anywhere before </body> in generated HTML that follows the class
// contract (see AGENT_INTEGRATION_RUNBOOK.md). Single source of truth — edit
// interactivity.css / interactivity.js and re-run this.
//
// Author: Abhinav Bannerjee

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'interactivity.css'), 'utf8');
const js = readFileSync(join(here, 'interactivity.js'), 'utf8');

const snippet = `<!-- ============================================================
     SnowGram diagram interactivity (motion + component highlighting)
     Generated from interactivity.css + interactivity.js by build_inject.mjs.
     Inline this block before </body> in a standalone diagram HTML file.
     Requires the class/attribute contract in AGENT_INTEGRATION_RUNBOOK.md.
     Author: Abhinav Bannerjee
     ============================================================ -->
<style>
${css}
</style>
<script>
${js}
</script>
<script>
  /* auto-wire on load: finds the connectors <svg> + node container and binds
     hover motion/highlighting. Override targets with [data-connectors-svg]
     and [data-diagram-root] if auto-detection picks the wrong elements. */
  (window.SnowGramInteractivity || {}).autoAttachOnReady &&
    window.SnowGramInteractivity.autoAttachOnReady();
</script>
<!-- ===================== end SnowGram interactivity ===================== -->
`;

const out = join(here, 'inject-snippet.html');
writeFileSync(out, snippet);
console.log('WROTE', out, '(' + snippet.length + ' bytes)');
