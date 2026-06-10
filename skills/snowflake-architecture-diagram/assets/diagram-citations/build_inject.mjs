// build_inject.mjs — bundle citations.css + citations.js into a single
// inlinable HTML snippet for embedding into a standalone diagram file.
//
//   node build_inject.mjs   ->  writes inject-citations.html
//
// The snippet auto-renders on load: it reads citation data from
// window.__DIAGRAM_CITATIONS or a <script type="application/json"
// data-diagram-citations> tag and appends a "Documentation" panel below the
// diagram. Single source of truth — edit citations.css/.js and re-run.
// Author: Abhinav Bannerjee

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'citations.css'), 'utf8');
const js = readFileSync(join(here, 'citations.js'), 'utf8');

const snippet = `<!-- ============================================================
     SnowGram diagram citations ("Documentation" panel below the diagram)
     Generated from citations.css + citations.js by build_inject.mjs.
     Inline before </body>. Provide citation data either as:
       <script type="application/json" data-diagram-citations>
         [{"url":"...","title":"...","excerpt":"..."}]
       </script>
     or window.__DIAGRAM_CITATIONS = [...]. Author: Abhinav Bannerjee
     ============================================================ -->
<style>
${css}
</style>
<script>
${js}
</script>
<script>
  (window.SnowGramCitations || {}).autoRenderOnReady &&
    window.SnowGramCitations.autoRenderOnReady();
</script>
<!-- ===================== end SnowGram citations ===================== -->
`;

const out = join(here, 'inject-citations.html');
writeFileSync(out, snippet);
console.log('WROTE', out, '(' + snippet.length + ' bytes)');
