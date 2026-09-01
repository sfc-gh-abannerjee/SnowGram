# Changelog

All notable changes to SnowGram will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Track 1: Layout Engine / CoCo Skill] - 2026-09-01

### Fixed
- Found the actual root cause of the crossings flagged in part 3 below,
  by extracting exact geometry from a live-agent HTML output, confirming
  a real crossing, then adding a temporary debug print directly in
  `route.mjs` to capture the exact obstacles/excludeIds/path at the
  moment the offending edge was computed. That showed
  `routeShortestOrthogonal` itself already returning a safe path (e.g.
  y=203.5, clear of the obstacle) -- but the edge's *final* emitted `d`
  used a different, unsafe value (y=193.5, inside the obstacle). Something
  between the search and the output was mutating an already-correct path.
  Traced to two leftover pieces of pre-gridroute.mjs code in `route.mjs`
  that neither the earlier channel-walk rewrite nor the gridroute.mjs
  rewrite had removed:
  1. `spineThroughChain` -- a shortcut for edges with a pack.mjs
     "dummy-node chain" (inserted for rank-spanning edges) that drew a
     straight sweep through the chain's lane with *zero* obstacle
     checking, gated ahead of the gridroute.mjs call so it could still
     fire for some edges.
  2. A post-hoc "repair pass" that ran on every edge's path *after*
     gridroute.mjs, re-scanning for crossings and nudging one endpoint of
     an offending segment sideways by a fixed clearance -- without
     verifying that shift didn't put the segment (or the neighboring one
     sharing that point) into a *new* obstacle. This is what actually
     mutated the confirmed-safe gridroute.mjs output into an unsafe one.
  Removed both entirely (deleted ~300 lines of now-dead code:
  `spineThroughChain`, `snapToGap`, `verticalSegmentClear`, the unused
  `routeOrthogonal`, and the repair-pass loop) rather than patching them,
  since gridroute.mjs's Dijkstra search already guarantees every path is
  obstacle-free by construction -- there is nothing left for either of
  these to legitimately do. Verified: full local test suite still passes
  (0 crossings across all fixtures), the exact reconstructed topology that
  produced the reported crossing now returns the safe path unmodified,
  and a fresh live-agent run's HTML was re-extracted and checked
  coordinate-by-coordinate (0 crossings, 0 unexplained overlaps).

## [Track 1: Layout Engine / CoCo Skill] - 2026-08-31 (part 3)

### Added
- Added a usage-penalty mechanism to `gridroute.mjs` (`registerPathUsage`,
  `reuseCount`, `REUSE_PENALTY`): each edge's chosen path is recorded into
  a shared list, and later edges' cost function adds a penalty for fine-
  grained search steps that run along an already-claimed segment. This
  fixes a real, confirmed bug: several distinct edges converging on the
  same target (e.g. three source systems all feeding one transform node)
  found the mathematically-identical shortest path independently and
  rendered as visually indistinguishable overlapping lines for a long
  shared stretch, not just at the shared target's entry point. An earlier
  attempt at this (a post-hoc nudge that shifted individual waypoints)
  was reverted the same day for breaking orthogonality; this version
  influences the search itself so every emitted path is still guaranteed
  shortest-and-obstacle-free, just with parallel routes preferring
  distinct lanes when a comparably-short alternative exists.

### Investigated (no code change -- see notes)
- Re-audited "the routing hasn't improved" feedback by extracting the
  exact node/zone/edge geometry straight from live-agent-produced HTML
  (not eyeballing screenshots) and re-running the crossing check with
  proper per-edge exclusions. Found and fixed a real bug in my OWN
  analysis script along the way (zone/boundary/container rects need the
  same `+46` SVG-viewBox offset as edge path points; comparing them
  unadjusted manufactured several false-positive "crossings" that don't
  actually exist, including the original "Partner Data" one raised in
  the request). After that fix, two live-agent runs still each showed 1-2
  segments passing through an unrelated zone. Extensive direct
  verification -- calling the deployed `LAYOUT_DIAGRAM` UDF over SQL with
  reconstructed and exact-extracted topologies, and calling
  `gridroute.mjs` directly in Node with the literal rects and edge order
  pulled from the "buggy" HTML, including with `pathUsage` accumulated in
  the same order the agent's edges appear -- could not reproduce either
  flagged crossing; every direct test came back with `cardCrossings: 0`
  and a safe path. Confirmed the deployed function body byte-for-byte
  contains the current `reuseCount`/`REUSE_PENALTY`/
  `routeShortestOrthogonal` code (via `GET_DDL`), and confirmed the
  renderer emits plain `M`/`L` paths with no corner-rounding or other
  post-processing that could shift a safe path after the fact. Net: the
  router is extensively verified correct against every topology tested
  directly; the 2 remaining flagged instances could not be reproduced
  outside the exact live-agent call path, so there may still be a subtle
  discrepancy specific to how the agent's own request differs from every
  reconstruction attempted -- flagged rather than claimed fixed.

## [Track 1: Layout Engine / CoCo Skill] - 2026-08-31 (part 2)

### Added
- Replaced the channel-walk router (added earlier the same day) with a
  genuinely different approach: `gridroute.mjs`, a visibility-grid +
  Dijkstra shortest-path router with a per-turn cost penalty. The
  channel-walk router still guessed a path shape from zone/scope
  structure and needed a growing pile of special cases (lane spread,
  exit-stub direction, multi-level walk-ups) to avoid touching obstacles
  it wasn't told about explicitly. This router instead builds a
  visibility grid from every obstacle's left/right/top/bottom edges,
  and finds the minimum-cost path (Manhattan distance + a fixed penalty
  per 90-degree turn) through it. A segment that would cross a
  non-excluded obstacle's interior is simply not a move that exists in
  the search graph -- "never touch a component you aren't connecting
  to" is a property of the search space, not a rule checked afterward.
  Node/zone/container/boundary rects all become one flat obstacle list;
  per edge, the only per-call state is which rects the two endpoints are
  allowed to sit inside (their own zone plus its container/boundary
  ancestry, reusing the existing `zoneScope`/`containerScope` maps).
  Removed `channelPath`/`pathWithinScope`/`exitStub`/`findClearVerticalX`/
  `nodeizeChannelPath` and the whole scope-walking machinery entirely --
  route.mjs no longer needs to know about zones/containers/scopes at all,
  only about rects.
- Wired the new module into `build_udf.mjs`'s bundle order (it was missing
  entirely on the first attempt, so the UDF's smoke test caught the
  bundled body diverging from a direct `layout()` call before it ever
  reached Snowflake).

### Fixed
- Found and fixed two real bugs while dogfooding the new router against
  every fixture (verified this time via a full crossing-detector scan,
  not eyeballing a screenshot): (1) double-bookkeeping in the Dijkstra
  loop -- `dist` was set directly AND passed through a `push()` helper
  that re-checked `dist` and always found the value already matching
  exactly, so it silently dropped every neighbor expansion and the search
  terminated after only the seed states. (2) the obstacle list was built
  from `nodeRects[].name`, a field that doesn't exist on node rects
  (they use `.id`) -- every node obstacle collapsed to the literal id
  `"node:undefined"`, which then matched every edge's own exclusion set,
  so node-level obstacle avoidance was silently disabled for every edge
  in every diagram. Caught by a fixture (`row_wrap_stress`) where a
  shortest path happened to pass directly through an un-avoided sibling
  node; both bugs were root-caused by writing a script that reproduces
  the exact crossing (source/target ids, the crossing segment, the rect
  it crosses) rather than re-guessing from a screenshot.
- Fixed the review harness's arrow-separator regex a second time (a
  different run used an em dash where a prior fix only covered `->` and
  `→`) by widening the match to any short run of non-alphanumeric
  characters instead of enumerating specific glyphs, so the next
  variant doesn't need another patch.

### Verified
- Full local fixture suite (`row_wrap_stress`, `medallion`,
  `nested_containers`, `fanout_finin`) re-rendered and visually reviewed:
  every edge is a clean, minimal-turn orthogonal path; parallel edges
  between the same zone pair separate naturally (their true shortest
  paths differ slightly since the specific node positions differ) without
  needing an explicit lane-nudge pass, which was tried and reverted after
  it mutated individual waypoints without their neighbors, producing
  diagonal segments -- removed in favor of correctness over cosmetic
  lane spacing.
- Live re-test (Apex Health, "Snowflake on Azure" prompt) after
  redeploying `LAYOUT_DIAGRAM`: Microsoft Azure correctly wraps Azure
  Sources/Transformations/Orchestration/Legacy Consumers and the nested
  Snowflake Data Cloud boundary; every connector inside and across the
  boundary is a short, minimal-turn, non-crossing orthogonal path.

## [Track 1: Layout Engine / CoCo Skill] - 2026-08-31

### Fixed
- The channel router's lane spread never activated: every call site passed
  a hardcoded `{ idx, count: 1 }`, so `pathWithinScope`'s and
  `nodeizeChannelPath`'s lane-offset logic was always inert (`count > 1`
  never true). Multiple edges between the same zone pair (different node
  pairs) all computed the identical shared travel X/Y and visually
  overlapped or crossed each other in the open channel between zones,
  even though each individual path was orthogonal. Fixed by pre-counting
  edges per unordered zone-pair before the main loop and passing the real
  count through; parallel edges now spread into distinct, non-overlapping
  lanes. Reproduced and verified against a small synthetic 3-source/
  2-target fixture before and after.
- `include_platform_boundary` containers computed correct geometry (via
  `LAYOUT_DIAGRAM`) but never rendered visually through the live
  pipeline: `TEMP.ABANNERJEE.RENDER_DIAGRAM` (a separately deployed UDF)
  was last created 2026-06-22 and had never been redeployed since
  container-drawing support was added to the canonical
  `render_diagram.dev.sql` source -- confirmed via `SHOW FUNCTIONS`
  (`created_on`) and a direct diff against the synced local copy.
  Redeployed `RENDER_DIAGRAM` from the current canonical source; verified
  live end-to-end (`CALL GENERATE_DIAGRAM_ARTIFACTS(...)` with a
  `CONTAINERS` payload) that the container box now actually draws,
  wrapping the platform boundary as one of its children.

### Added
- Extended `GENERATE_DIAGRAM_ARTIFACTS`'s live signature from 5 to 6
  arguments, adding a `CONTAINERS` (JSON array string) parameter that
  gets forwarded into both the narrow and wide `graph_json` payloads sent
  to `LAYOUT_DIAGRAM`/`RENDER_DIAGRAM` -- closing the gap flagged in the
  prior entry (the tool schema previously had no way to pass container
  data at all, so `include_platform_boundary` was unreachable from the
  live agent regardless of instructions). Required dropping the old
  5-arg procedure first (`CREATE OR REPLACE` doesn't replace a
  different-arity overload; a bare add attempt failed with "ambiguous
  PROCEDURE overloading").
- Added a `CONTAINERS` property to the agent's `GENERATE_DIAGRAM_ARTIFACTS`
  tool schema and a new orchestration section instructing the agent to
  build a container with `include_platform_boundary: true` whenever the
  user explicitly states which cloud hosts their Snowflake account, and
  to omit `CONTAINERS` entirely otherwise (never guess the cloud).
  Republished as `SNOWGRAM_AGENT` `VERSION$14`; confirmed `DEFAULT_VERSION`
  was updated to match. **Caught and fixed before publishing became live**:
  the agent's `tool_resources.GENERATE_DIAGRAM_ARTIFACTS.name` field
  pins the exact procedure overload to call by argument-type signature;
  it still said `(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR)` (the old,
  now-dropped 5-arg overload) even after adding `CONTAINERS` to the tool
  schema -- every diagram call would have failed with the new signature
  live. Updated it to the 6-arg signature before publishing.
- Live re-test (Apex Health, "Snowflake on Azure" prompt) confirms the
  full fix set end-to-end: Microsoft Azure now correctly wraps Azure
  Sources/Partner Data Share/Transform/Orchestration/Private Connectivity
  AND the nested Snowflake Data Cloud boundary as one container, matching
  the actual "Snowflake hosted on Azure" architecture -- the original,
  repeatedly-raised complaint from earlier in this project. Routing
  throughout is clean and orthogonal with no visible card crossings.

## [Track 1: Layout Engine / CoCo Skill] - 2026-08-29

### Added
- Replaced the reactive obstacle-detect-and-repair router in `route.mjs`
  with a deterministic grid-channel router. `pack.mjs`'s `wrapUnits()`
  already produces a globally row-band-aligned grid at every scope
  (outer canvas, inside the platform boundary, inside each container) --
  row *r* spans the same y-range for every item in that scope by
  construction, which makes the gap between two row-bands, and the gap
  between two adjacent slots in the same row, provably clear channels.
  New `channels`/`zoneScope`/`containerScope` fields on `pack()`'s return
  value expose this grid per scope; `route.mjs` walks it (`channelPath`,
  `pathWithinScope`, `exitStub`, `findClearVerticalX`) to route zone-to-
  zone edges by construction instead of guessing a shape and reactively
  detecting/dodging whatever it crosses. Handles same-row, different-row,
  and cross-scope edges (walking up through nested containers/boundary to
  the lowest common ancestor scope, one wall at a time). The old
  `routeOrthogonal` H/V-shape logic is kept only as a fallback for zones
  missing channel metadata. Prototyped and validated first by a
  background subagent (`/tmp/snowgram_grid_prototype/`, zero crossings by
  construction on `row_wrap_stress.json`) per the plan in this file's
  prior entry's "Known gaps" section, then implemented directly against
  the production pack.mjs/route.mjs geometry (which uses variable-width
  row-wrapped units, not the prototype's strict rank-column grid).

### Fixed
- Found and fixed four bugs surfaced by dogfooding the new router against
  every existing fixture plus a live Apex Health re-test: (1) channel
  scopes stored `rowYOffset` in each container's LOCAL coordinate frame
  while `slots` used absolute canvas coordinates, so different-row edges
  inside a nested container computed channel Y at the wrong place --
  fixed by storing absolute row offsets. (2) The cross-scope walk-up only
  exited through the immediate parent, silently skipping intermediate
  levels for a zone nested two-plus levels below the common ancestor
  (zone -> container -> boundary -> outer) -- fixed by walking the chain
  one level at a time, exiting through every wall actually in the way.
  (3) `exitStub`'s directional reference was the current box's own
  center (meaningless for choosing a direction -- it's always the box
  you're already inside), not the real far-endpoint -- fixed by passing
  the actual destination point through the whole walk. (4) Re-anchoring
  a zone-level path's endpoints to their real node positions could leave
  two points disagreeing on the shared axis and draw a diagonal line
  through open space; fixed to replace the whole contiguous run of
  matching points, or insert an explicit jog when the entire zone-level
  path is one uniform segment with no natural breakpoint. Also added
  horizontal (left/right wall) exits to `exitStub`, which only supported
  vertical (top/bottom) exits -- needed whenever a container/boundary
  sits in the same row as the zone it's connecting to, a common case.

### Known gaps (not yet fixed)
- `include_platform_boundary` is still not reachable from the live agent
  (no `CONTAINERS` parameter on `GENERATE_DIAGRAM_ARTIFACTS`'s tool
  schema) -- unchanged from the prior entry, not attempted this pass.
- One fixture (`medallion`) still produces a slightly indirect (though
  fully orthogonal, non-crossing) path for an edge entering a nested
  container from a sibling outer-level container, going around a corner
  rather than a shorter route. Cosmetic, not a correctness bug.

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
