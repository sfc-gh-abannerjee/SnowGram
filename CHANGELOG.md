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
- A Commit Wrap-Up Gate (`.cortex/hooks.json` + `AGENTS.md` + a
  project-scoped enforced rule): a `Stop` hook that gives the existing,
  deliberately non-blocking `ctx-tracker-reminder.sh` actual teeth for this
  repo -- blocks ending the turn after a commit until the ctx tracker is
  reconciled and living docs are either updated or explicitly acknowledged
  as not applicable.
- Containers can now adopt the Snowflake platform boundary itself as one of
  their children (`include_platform_boundary` on a container) -- e.g. a
  "Microsoft Azure" container correctly nesting "Snowflake Data Cloud"
  inside it for a Snowflake-on-Azure deployment, alongside the customer's
  own same-cloud resources as siblings, instead of treating the account and
  its host cloud as unrelated sibling boxes (`2229d8d`).

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
- A bridge/outcome-category zone with a lower topological rank than a
  legitimate onprem zone let the platform boundary's column-range sweep
  engulf the onprem zone too -- concretely, "Apex Azure Sources" rendered
  INSIDE "Snowflake Data Cloud" (backwards: Snowflake runs on Azure, not
  the reverse). Fixed with a category-bucketed rank re-sort (onprem <
  snow/bridge < outcome) in `assignRanks` (`29c76cb`). Also generalized
  `model.mjs`'s category inference (a fixed, always-incomplete type
  enumeration) into a vendor-prefix heuristic (`azure_*`/`aws_*`/`gcp_*` ->
  onprem) and fixed BI tools (Power BI/Tableau/etc.) being misclassified
  as `outcome` (boundary-triggering) instead of `onprem` (`d7e70bb`).
- `assets/scripts/review_harness.py`'s local render pipeline
  (`render_local.py`) read `component_type` (snake_case) but
  `tests/fixtures/*.json` uses `componentType` (camelCase) -- every node's
  type silently read as empty, defaulting everything to `snow` and masking
  the two fixes above in local testing. Accept both field names; also
  synced `render_local.py`'s separate `_category()` heuristic (a port of
  the live `GENERATE_DIAGRAM_ARTIFACTS` proc's own copy) with the same
  fixes (`1ff35e9`). **Open follow-up**: the live proc almost certainly has
  the identical category bug for real Azure/AWS/GCP-sourced diagrams --
  not yet fixed/redeployed there.
- Azure/AWS Private Link was categorized as `bridge` (Snowflake-native
  ingestion), sweeping it inside the Snowflake boundary despite being
  network plumbing, not a Snowflake object. Removed the override so it
  falls through to the generic vendor-prefix `onprem` rule like any other
  cloud-vendor-owned service (`71127b2`).
- A container adopting the platform boundary (see Added, above) exposed a
  routing bug: zones embedded via the boundary sub-unit never got the
  adopting container's id in their `route.mjs` container-chain, so an edge
  between two such zones treated the container's own rect as a real
  obstacle and detoured wildly around it (observed: a path running from
  x=-10 to x=1560, off both edges of the canvas). Fixed by attributing the
  adopter's chain to those zones for routing purposes (`2229d8d`).
- The route-repair safety net (added earlier this session) could oscillate
  forever between two overlapping-but-offset obstacles -- shift past one,
  land on the other, shift back. Fixed by collecting every obstacle a
  segment crosses per pass and shifting past the union of their bounds,
  clearing the whole cluster in one move (`40cfff6`).
- `review_harness.py`'s live-agent download-link regex required exactly one
  character between `HTML (interactive)` and the markdown link, but the
  agent sometimes writes a literal `->` (two ASCII chars) instead of a
  single arrow glyph, silently failing artifact recovery (no PNG, no error
  surfaced beyond a line in `REVIEW.md`). Widened to accept `->`, `→`, or
  `-` (git-tracked fix, no commit hash yet -- pending).
- Confirmed and fixed the live proc bug flagged as an open follow-up above:
  `TEMP.ABANNERJEE.GENERATE_DIAGRAM_ARTIFACTS`'s own `_category()` copy had
  the identical component-type field-name and BI-tool-classification bugs
  as `render_local.py`; redeployed with the same fix (live proc change, no
  git commit -- this file lives outside the repo).
- The deeper root cause of BI tools rendering inside the account boundary
  wasn't the code-level `_category()` heuristic (a fallback) but the
  authoritative `TEMP.ABANNERJEE.COMPONENT_RESOLVER` catalog table queried
  by the agent's `component_resolver` tool *before* any heuristic runs --
  it classified `tableau`/`powerbi`/`power bi`/`looker`/`salesforce` as
  `outcome` (boundary-triggering), same as native tools like `streamlit`.
  Reclassified those 7 rows to `onprem` (live data fix, no git commit).
- The agent's own orchestration instructions still gave the same stale
  examples (`"outcome: reads data FROM Snowflake (Tableau, Power BI,
  Looker...)"`), and had no rule preventing it from placing a native
  consumption surface (e.g. Streamlit) and an external one (e.g. Power BI)
  in the same zone/layer -- since a zone is swept to one side of the
  boundary as a whole, any such mix renders one of the two on the wrong
  side. Corrected the stale examples and added an explicit "ZONE/LAYER
  MIXING" rule; republished as `TEMP.ABANNERJEE.SNOWGRAM_AGENT`
  `VERSION$12` and set as `DEFAULT_VERSION` (agent spec change, no commit).
  Verified live: Power BI now renders in its own "Legacy External BI" zone
  outside the boundary, split from "Apex Analyst Consumers" (Streamlit)
  inside it.

### Known gaps (not yet fixed)
- `include_platform_boundary` (containers adopting the platform boundary,
  see Added above) is fully implemented in the layout engine but **not
  reachable from the live agent**: `GENERATE_DIAGRAM_ARTIFACTS`'s Cortex
  Agent tool schema (`input_schema.properties`) only declares
  `NODES`/`EDGES`/`TITLE`/`EXPORT_NAME`/`DOC_JSON` -- there is no
  `CONTAINERS` parameter, so the agent has no mechanism to pass container
  data through even with updated instructions. Extending the live
  procedure's signature and the tool schema to add `CONTAINERS` is a
  materially larger, riskier change than anything else in this entry and
  needs an explicit decision before being attempted.
- The router's reactive obstacle-detection-and-repair architecture (global
  safety-net pass in `route.mjs`) keeps finding new edge cases by
  construction. A background-agent prototype (`/tmp/snowgram_grid_prototype/`,
  not part of this repo) validated a grid-channel routing alternative with
  zero crossings by construction on `row_wrap_stress.json`, using the
  globally-aligned row-band invariant `pack.mjs` already approximates.
  Recommended path: (1) `pack.mjs`-only PR exposing `channelCols`/
  `channelRows` on the layout result (pure addition, no behavior change),
  then (2) a `route.mjs` rewrite replacing the ~400-line branch-per-shape +
  repair-pass approach with a ~200-line channel-walk. Not started.

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
