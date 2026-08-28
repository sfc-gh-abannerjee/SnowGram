# Changelog

All notable changes to SnowGram will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Track 1: Layout Engine / CoCo Skill] - 2026-08-28

Track 1 (`skills/snowflake-architecture-diagram/`) doesn't carry its own
version number yet, so this entry is dated rather than versioned. Covers a
multi-session effort improving layout/render quality plus, separately,
today's fixes for reported clutter/crowding/bad-routing issues.

### Added
- Row-wrapping: bounds canvas aspect ratio instead of growing width
  unboundedly (`4711b8f`).
- `quality.mjs`: generic, style-agnostic layout-quality validator (aspect
  ratio, card crossings, packing density) attached to every `layout()`
  result (`a243789`).
- A Layout Quality Gate wired into the live `TEMP.ABANNERJEE.SNOWGRAM_AGENT`
  orchestration instructions -- reads `quality.ok`/`quality.issues`, retries
  once with adjusted hints, and discloses rather than hides an unresolved
  defect (agent spec change, not a git commit).
- Recursive nested containers: an optional `containers` field on the model
  for arbitrary-depth grouping boxes (e.g. "AWS VPC" inside "AWS Account"),
  with collision/cycle guardrails (`797aa30`), rendered in SVG/draw.io/HTML
  in `snowgram-eng`.
- `assets/scripts/review_harness.py`: reusable, offline (unless `--live`)
  visual review harness -- renders every `tests/fixtures/*.json` scenario
  through the real layout + render pipeline, screenshots each, and folds in
  `tests/run.mjs`'s output into a generated `REVIEW.md` (`006c5cb`).
- A Visual Verification Gate (`.cortex/hooks.json` + `AGENTS.md` + a
  project-scoped enforced rule): never declare a layout/render change done
  without the user's explicit visual sign-off on the regenerated review
  package.

### Fixed
- Intra-zone chain edges could get reordered out of sequence by the
  cross-zone Sugiyama sweep (e.g. Bronze/Gold/Silver instead of
  Bronze/Silver/Gold), making a connector visually loop backward. Fixed by
  making intra-zone edges a hard ordering constraint (`9a8efc7`).
- Greedy first-fit row-wrap could leave a lone small zone stranded in a
  mostly-empty trailing row whenever an earlier row was dominated by one
  much bigger unit (e.g. the whole platform-boundary block). Replaced with
  a balanced partition (same row count, evenly distributed) plus centering
  any row narrower than the widest (`9a8efc7`).
- The router's rail/detour selection only validated candidate paths against
  obstacles within an edge's own original vertical span, so a detour
  extending past that span (routine once row-wrapping puts rank-adjacent
  zones on different physical rows) could still cut through cards outside
  it. Added a global safety-net pass in `route()` that re-validates every
  edge's final path against the real obstacle set and locally repairs
  anything still crossing, regardless of which routing branch produced it
  (`9a8efc7`). Verified against the live agent: a real Apex Health request
  went from "2 minor unresolved crossings" to "zero card crossings."
- `snow sql -f`/`-q` silently corrupts `&&` to `&` in JS/Python UDF bodies
  unless `--enable-templating NONE` is passed (`1f583c2`) -- documented in
  `assets/layout-engine/deploy/AGENT_INTEGRATION_RUNBOOK.md`.

## [1.1.0] - 2026-02-15

### Added
- Accessibility improvements (aria-labels for search, chat input, buttons)
- npm overrides for transitive dependency security fixes
- Debug logging utility that only logs in development mode
- Parse abort controller to prevent race conditions in diagram generation

### Changed
- Upgraded Next.js from 14.1.0 to 15.5.12
- Upgraded mermaid from 10.8.0 to 11.12.2
- Upgraded ESLint from 8.x to 9.39.2
- Upgraded @typescript-eslint packages from 6.x to 8.55.0
- Upgraded @excalidraw/mermaid-to-excalidraw from 0.2.0 to 2.0.0
- Removed deprecated `swcMinify` option from next.config.js (now default in Next.js 15)

### Fixed
- **17 bugs** related to node stacking, boundaries, connections, and layout
- **9 ESLint warnings** (type safety and hook dependencies)
- **Security**: Removed client-side PAT exposure vulnerability
- **Security**: Fixed DOMPurify XSS vulnerabilities (upgraded to 3.3.1)
- **Security**: Fixed Next.js DoS vulnerabilities (CVE)
- **Security**: Fixed glob CLI injection via eslint-config-next 15
- **Security**: Fixed lodash-es prototype pollution via npm override to 4.17.23
- Stale closure bugs in `onConnect` and `onDrop` callbacks
- Array mutation violations in `ensureMedallionCompleteness`
- Race condition in `parseMermaidAndCreateDiagram`
- Invalid SVG export (now queries full SVG element)
- Duplicate node picks in layout algorithms
- Missing Kafka boundary support in `normalizeBoundaryType` and `enforceAccountBoundaries`

### Removed
- Unused `api/snowgram.ts` file (~203 LOC)
- Unused `layoutMedallion` function (~133 LOC)
- Duplicate `hexToRgb` utility functions (consolidated 4→1)
- 6 unused exports from snowgram-agent-client
- Dead code: `calculateNodeSize` function, `allCollapsed` variable

### Security
- Eliminated all 7 HIGH severity npm vulnerabilities
- Reduced total vulnerabilities from 8 to 0-2 (moderate only)

## [1.0.0] - 2026-02-01

### Added
- Initial release of SnowGram
- Cortex Agent integration with Claude Sonnet 4
- Excalidraw-based diagram editor
- Mermaid-to-Excalidraw conversion
- Component library with pre-built blocks and patterns
- SPCS deployment support
