# Changelog

All notable changes to SnowGram will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Track 1: Layout Engine / Renderer] - 2026-09-10 (self-card re-entry, arrowhead spacing, title overflow)

### Fixed
- **A connector re-entered its own source card past the exit port**: Azure
  Data Factory -> Azure Private Link exited ADF from its TOP port, then its
  very next move traveled 24px straight back DOWN -- both axes still
  inside ADF's own card bounds -- before finally turning right. Root cause,
  found via exact-geometry debugging (temporary cost-instrumentation on the
  real fixture, not a screenshot guess): `routeShortestOrthogonal`'s port
  search seeds each candidate port's cost from its Manhattan distance to
  the card's own CENTER, which favors a 'top' exit (49.5) over 'right'
  (82.3) for this asymmetric wide card regardless of what happens next --
  and reconciling ADF's icon-anchored right-port Y against Private Link's
  icon-anchored left-port Y (a ~23px mismatch between two differently
  shaped cards) needed 2 turns either way, so the cost model genuinely
  preferred the 1-turn 'top' path even though it doubles back through the
  source's own footprint. Visually this meant half the connector's stroke
  width poked through the card's own top border as a small tick mark (95%
  of the segment was correctly hidden behind the opaque card, drawn after
  the connector layer -- only the exact starting pixel, sitting ON the
  border, spilled a hairline above it). Fixed in `gridroute.mjs`'s
  `segBlocked`: block any move segment that continues past either
  endpoint's own port into that rect's interior, using the same
  `segmentBlockedByRect` check already used for every other obstacle
  (grazing the boundary, where a port legitimately sits, stays legal; a
  move that goes further in does not). The search now exits ADF from its
  right edge directly and reconciles the Y-mismatch in the open gap between
  the two cards instead of through either one.
- **Fan-in arrowhead markers merged into one blob**: 3 sibling edges
  sharing a target side (Azure Synapse/SQL/Blob -> dbt) were spaced only
  14px apart (`PORT_SLOT_SPACING`) -- enough to keep the LINES from
  overlapping, but not their ARROWHEAD MARKERS, whose rendered footprint
  (`markerHeight=9` with `markerUnits="strokeWidth"`) is up to
  `9*2.2=19.8px` for the widest connector category. The 3 markers visually
  merged into a single zigzag blob right at dbt's card edge (found via a
  zoomed screenshot). Two compounding causes, both fixed: (1) widened
  `PORT_SLOT_SPACING` from 14 to 22px in `route.mjs`. (2) That alone wasn't
  enough -- `offsetPortOn`'s left/right-port clamp capped the *achievable*
  offset at just ~15px regardless, because it anchors fan-out range to the
  icon's own half-height (a deliberate guard, added earlier, against a
  fanned-out port sliding onto label text sitting BELOW the icon on a
  NARROW/stacked card). That guard doesn't apply to WIDE (icon-left) cards,
  whose text column sits BESIDE the icon, not below it -- the entire icon
  edge is text-free top-to-bottom there. Added a `wide` flag (set by
  `measureNodeWide` in `measure.mjs`, threaded through `pack.mjs`'s node
  rects) so wide cards get the same generous card-half-height-based range
  top/bottom ports already use, while narrow cards keep the tighter
  icon-only clamp. Verified the achieved spacing is now the full requested
  22px (was silently clamped to ~15px before), clearing the worst-case
  19.8px marker footprint with margin.
- **Card title text overflowing its own card border**: "Bronze Dynamic
  Table" (and similarly "Silver Dynamic Table", "Arcadia Health
  (Snowflake)") rendered with "Bronze Dynamic" on one line visibly
  spilling past the card's own rounded border in the static SVG/PNG/PDF
  export. Root cause: the Python word-wrap heuristic in `_svg()`
  (`render_diagram.dev.sql`) assumed 5.8px/char at the 11.5px bold title
  font (~0.50 of font size) to decide where to break lines -- narrower
  than `measure.mjs`'s own already-tuned 0.58 ratio, which was bumped up
  from 0.52 for this exact same under-count failure mode against
  bold/uppercase text (see the 2026-09-09 entry). "Bronze Dynamic" (14
  chars) measured as fitting a 91px slot at the old ratio but didn't at the
  real rendered width. Fixed by using the same 0.58 ratio for the width
  used to decide line breaks (`avail_w / (11.5 * 0.58)`); "Bronze Dynamic
  Table" now correctly wraps to 3 lines ("Bronze"/"Dynamic"/"Table")
  instead of 2, fitting cleanly within the card. Verified across every
  card in the real 16-node model via a fresh render (no other card came
  close to overflowing at the corrected ratio).
- Added 2 new regression tests to `tests/run.mjs` for the self-card
  re-entry and fan-in arrowhead spacing fixes, using the same real
  16-node/18-edge `apex_health_privatelink_stub` fixture as the existing
  min-stub/hug-clearance tests.

### Investigated, not reproduced
- **"Private Link has no background/container"**: checked the "Private
  Connectivity" zone (containing the `Azure Private Link` gateway node)
  across the static SVG, PNG, and interactive HTML outputs for the real
  16-node model, both before and after this session's fixes -- all three
  show a normal zone background box (`_pal()`'s `onprem` fill `#EEF1F5`
  with a visible `#9AA4B2` border), matching every sibling zone
  (`Azure Sources`, `Legacy BI`, etc.). Did not reproduce with this
  fixture; may be specific to a different model/category combination not
  covered here -- flagged back to the user rather than guessing at a fix
  without a reproducible case.

## [Track 1: Layout Engine / CoCo Skill] - 2026-09-10 (minimum port-approach stub)

### Fixed
- **Razor-thin final approach segment into a port**: gridroute.mjs's
  visibility grid only ever contains lines derived from obstacle edges (plus
  the ports themselves), so nothing stops two unrelated obstacles' clearance
  zones from coincidentally landing a path's last turn just a few px from a
  port -- the Dijkstra search only knows total path cost, never "how far is
  the last hop." Found via a live render (same Private Link -> Snowpipe edge
  as the 2026-09-09 direction-scoping fix): a path threading around Azure
  Data Factory's own clearance-inflated edge happened to land its elbow only
  8px from Snowpipe's own port, visually reading as an awkward last-instant
  hook right at the arrowhead, and forcing the path into a needlessly tight
  corridor alongside the platform boundary for longer than necessary. Fixed
  with `extendShortStubs()` in `gridroute.mjs`: a post-process step that,
  when a path's first or last segment is under `MIN_STUB` (20px), slides the
  shared elbow (and the segment before it, so that one stays straight too)
  further back along the corridor -- re-validated against the same obstacle
  list so it can never introduce a new crossing. Only applies when there are
  at least 3 segments on that end (4 points) to absorb the shift without
  moving the FIXED source/target port itself; a direct 2-point line or a
  single-elbow 3-point path is left untouched.
  Considered and rejected a soft cost-penalty alternative (discouraging, in
  the Dijkstra search itself, any move landing too close to a port) --
  correct in spirit with the existing TURN_PENALTY/REUSE_PENALTY cost model,
  but riskier: modifying the shared cost function could ripple into OTHER
  edges' routing decisions across the whole diagram (costs and `pathUsage`
  are shared/global), whereas a post-process geometric nudge only ever
  touches the one already-completed, already-obstacle-free path it's
  applied to. Verified against the REAL 16-node/18-edge model pulled from
  the live-agent trace that showed the bug (not a reduced repro -- a
  minimal 2-3 edge version was tried first and didn't reproduce the bug at
  all, since this specific corridor only forms as a side effect of all 18
  edges' combined obstacle/lane pressure): final segment goes from 8px to
  exactly 20px, `git stash`-verified to fail without the fix and pass with
  it, plus a fresh live render (regenerated with the real captured model,
  bypassing agent non-determinism) showing a clean, adequately-spaced
  arrival with visible daylight from the platform boundary.
- **`extendShortStubs()` itself relocated the hugging problem it was meant
  to fix**: the fix above always slid a too-short stub all the way to
  `MIN_STUB`, checking only that the shift didn't CROSS an active obstacle
  -- but the only obstacle-free direction to slide into was, in the exact
  live case above, a narrow ~13.5px gap between Azure Data Factory's
  clearance zone and Snowpipe's own "Ingestion" zone boundary (excluded
  from crossing-avoidance entirely, since it's the edge's own destination
  zone). Reaching the full 20px landed the corridor 1.5px from that zone's
  border -- visually indistinguishable from running along it, i.e. the same
  "hugging a boundary" defect, just moved to a different boundary. Caught
  by the user pointing at a fresh render, not by the (insufficiently
  strict) regression test added for the first fix, which only checked
  absolute stub length. Fixed by adding a second, softer `HUG_CLEARANCE`
  (8px) check in `extendShortStubs`/`maxSafeSlide`: caps how far the slide
  can go before it would come within 8px of ANY rect's edge -- including
  ones excluded as active obstacles for this edge -- accepting a shorter
  (but hug-free) stub when the available room is tighter than `MIN_STUB`
  itself, rather than always reaching the full target at any visual cost.
  Also fixed a bug in the first pass at this check: it computed "distance
  to the near edge" unconditionally, which is wrong once the corridor's
  current position is already PAST that near edge (exactly Ingestion's
  case -- the corridor was already inside the zone's own span, so the
  relevant edge to watch is the FAR one, not the near one); using the near
  edge produced a large negative "available room" and collapsed the slide
  to ~0, silently undoing the whole fix. Verified against the same real
  16-node/18-edge model: the corridor now settles at 13.5px of stub length
  (up from 8px, short of the full 20px target because the room genuinely
  isn't there) while maintaining exactly `HUG_CLEARANCE` from Ingestion's
  boundary; confirmed via a hi-DPI (3x) Playwright screenshot showing clear
  visual daylight between the connector and the zone border where they
  previously nearly touched, and a programmatic scan of all 18 connector
  paths in the regenerated render finding zero remaining sub-6px/60px+
  hugging segments against any zone or the platform boundary.

## [Track 2: Renderer / Icon Resolution] - 2026-09-10 (data-share icon, marker size, render_diagram.dev.sql escaping fragility)

### Fixed
- **"Data share"/"Inbound Share" resolved to the wrong (Azure) icon**:
  `MAP_ICON_PATH('data share', 'Inbound Share')` returned NULL -- no curated
  `COMPONENT`/`COMPONENT_SYNONYM` entry existed for "data share" under either
  key -- so `_resolve()` fell through to `SNOWFLAKE.CORTEX.SEARCH_PREVIEW`
  against `ICON_SEARCH`, which matched and returned an Azure icon
  (`azure/storage/data-share-invitations.svg`) for a native Snowflake Secure
  Data Sharing object. Fixed by inserting a canonical `COMPONENT` row
  (`component_type='data share'` -> `sno-icon-sharing-collaboration-blue.svg`)
  plus 7 `COMPONENT_SYNONYM` rows (`secure data sharing`, `data sharing`,
  `inbound share`, `outbound share`, `secure share`, `share`, `zero-copy
  share`). Verified `MAP_ICON_PATH` now resolves deterministically without
  reaching Cortex Search, and a fresh render shows the correct Snowflake
  icon.
- **Disproportionately large arrowhead on `data_share` connectors**: that
  category's marker was uniquely sized 10x10 with `refX=8` against a
  `stroke-width: 2.2` line (reach-back = `refX * strokeWidth` = 17.6px),
  vs every other category's 9x9/`refX=7`/1.3px-stroke standard (9.1px
  reach-back). Combined with the `HUG_CLEARANCE` fix above capping some
  approach stubs to as little as 13.5px, a 17.6px marker necessarily spilled
  back past the elbow, reading as oversized/disconnected from the line it
  terminates. Fixed by standardizing `data_share`'s marker geometry
  (`ah-data_share`/`ah-data_share-start` in the static SVG renderer,
  `ah-dshare`/`ah-dshare-start` in the interactive HTML renderer) to the same
  9x9/`refX=7` shape used everywhere else, while deliberately leaving the
  thicker 2.2px stroke-width unchanged (a legitimate emphasis choice,
  independent of the marker's own proportion bug).
- **Icon-path fix silently changed `share_in`'s account-boundary category**:
  `_category()` in `generate_artifacts.dev.sql` had a fallback rule
  (`if pth and not pth.startswith('sno-icon'): return 'onprem'`) that used a
  node's *resolved icon path* as an implicit signal for boundary placement.
  Fixing the icon (Azure path -> `sno-icon-*` path) would have silently
  changed `share_in`'s category from `onprem` to the unrelated default
  `snow`, with nothing to signal the change. Added an explicit rule instead:
  `data share`/`secure data sharing`/`inbound share`/`outbound share`/
  `secure share` -> `bridge`, matching the same semantic pattern already
  used for Snowpipe/Openflow (a construct that straddles the account
  boundary rather than sitting purely inside or outside it). Verified via a
  fresh regeneration that this produced no adverse layout change (the
  platform-boundary rectangle's position/size and all quality metrics were
  identical before/after) while making the classification correct on its own
  terms, independent of which icon happens to resolve.
- **`render_diagram.dev.sql` not directly re-deployable, with a latent
  pre-existing bug**: the file's legacy convention -- the whole Python UDF
  body wrapped in a single-quote-delimited SQL string (`AS '...'`), with
  every internal Python `'` doubled (`''`) for SQL purposes -- is extremely
  fragile: it silently breaks the moment any future edit adds an
  unescaped English contraction/apostrophe to a comment or string. Found
  the file already contained exactly this bug in a pre-existing comment
  ("...offset from the box's own top..."), confirmed via testing the *exact
  unmodified git-committed original* through both `snow sql -f` and the
  `sql_execute` tool and getting the identical `unexpected 's'` compilation
  error -- i.e. this function had been undeployable-as-committed for some
  time, never caught because it was never redeployed since that comment was
  added. Fixed durably by converting the file to `$$...$$` delimiting
  (needs zero internal escaping, matching the robust convention already
  used by `LAYOUT_DIAGRAM.sql`/`build_udf.mjs`): unescaped only the
  SQL-level `''` -> `'` doubling (left every Python-level `\"` untouched --
  those are genuine Python string escapes, e.g. for double-quoted strings
  building HTML attributes, not an SQL artifact), validated the result via
  `ast.parse()`, and deployed successfully. `build_render.py`'s
  `_extract_body()` was updated in lockstep to extract from the new `AS
  $$...$$` convention; `render_diagram_generated.py` and the
  `diagram-interactivity/chrome/*` assets were rebuilt from the corrected
  source and pass `node tests/run.mjs` with no regressions. Note:
  byte-comparing `GET_DDL`'s echo of the deployed function against the
  local source is NOT a reliable verification method here -- confirmed via
  an isolated test that `GET_DDL` always re-escapes backslashes for its own
  single-quote-based redisplay convention regardless of how the function
  was actually created (a `$$`-created function with one literal `\` in a
  Python string echoes back with 4 backslashes, not 1) -- functional
  verification (fresh regeneration + visual inspection of the actual
  rendered output) is the reliable signal.

- **"Line breaks" in connector lines, PNG/PDF only**: the interactive HTML
  never renders edge labels as visible text at all (`edge_labels` is only
  used there to help classify connector category), so the earlier
  "investigated, no bug found" conclusion for that surface stands. But the
  static SVG renderer (`_svg()`, feeding the `png`/`pdf`/`svg` export
  formats) DOES draw each edge's label as text with a white halo for
  readability over a busy line: `<text ... fill="#5b6770" ...
  paint-order="stroke" stroke="#ffffff" stroke-width="3">`. Chromium
  renders this exactly as intended (dark gray text, subtle white glow) --
  confirmed by opening the raw `.svg` output directly in a browser. But the
  `png`/`pdf` export path runs through weasyprint (`_svg_to_pdf_png`),
  which does not support the `paint-order` CSS property and falls back to
  the SVG spec's default order (stroke painted AFTER/ON TOP of fill) --
  so the white halo completely covered the dark text, leaving a solid
  white blob sitting on top of the connector line at every labeled edge.
  That blob is exactly what reads as a "disconnected"/"broken" line
  segment in a PNG or PDF export. Root-caused after the user clarified
  ("it's the text labels showing up as white on a white background") while
  doing a side-by-side quality pass across all 6 export formats
  (html/svg/png/pdf/drawio/mmd) -- the drawio/mermaid label mechanisms are
  unrelated (draw.io renders its own label chrome natively) and were
  unaffected. Fixed by replacing the single paint-order-dependent `<text>`
  with two separate elements in document order -- a stroke-only (white,
  `fill="none"`) halo painted first, then a fill-only (dark, no stroke)
  copy painted second/on top -- which produces the identical visual result
  in every renderer (browser or weasyprint) since document order, unlike
  `paint-order`, is not an optional CSS feature. Verified via a fresh
  regeneration against the real model: the PNG and the PDF (rasterized via
  `pdf2image`) both now show every one of the 13 labeled edges
  ("orchestrated load", "private ingest", "Secure Data Sharing", etc.) as
  legible dark text with a clean white halo, no blobs.

## [Track 1: Layout Engine / CoCo Skill] - 2026-09-09 (Apex Health end-to-end regression pass)

### Fixed
- **Card-height regression from a dropped `componentType` field**: `normalize()`
  in `model.mjs` built each node as `{id, label, detail, category, zone, style}`,
  silently dropping `componentType` before it ever reached `measureNode()`/
  `measureNodeWide()`. The rendered `.fn-sub` category badge line was therefore
  invisible to card-height math even though it always renders -- any card with
  a `detail` line clipped its last line of text by 7-14px (found via Playwright
  `scrollHeight` vs `clientHeight` measurement, not screenshots). Fixed by
  carrying `componentType` through normalization and correcting the flex-gap
  math in both card-measurement functions (one gap was double-counted, another
  never counted), plus biasing the glyph-width heuristic (0.52 -> 0.58) after
  measuring that it undercounted wrapped lines for semi-bold titles and
  letter-spaced uppercase sub-labels.
- **Zone category misassignment when the caller relies on the JS heuristic**:
  `categoryFrom()`'s vendor-prefix regex and `CATEGORY_BY_TYPE` map only match
  underscore-separated tokens (`azure_synapse`, `dynamic_table`); a caller using
  human-readable, space-separated `componentType` strings (`"azure synapse"`)
  gets no match and silently defaults to `'snow'` (inside the boundary). Added
  `checkCategoryConsistency()` (`quality.mjs`) as a permanent, non-geometric
  quality-gate check: flags a zone when a member node's own category disagrees
  with the zone's rendered category's boundary side, naming the exact zone and
  node so this class of bug fails loudly instead of silently misplacing a zone.
- **Connector routing hidden/misaimed arrowheads**: `gridroute.mjs` ports now
  anchor to a card's icon center (`iconCenterY`/`iconHalfHeight`) instead of the
  card's raw geometric midpoint -- a fan-out offset was landing directly on
  label text once cards could be taller than their natural content height.
  Arrival at a port is now constrained to that port's own axis (a left/right
  port must be reached by a horizontal final segment), since accepting the
  perpendicular direction let a marker's triangle point along a card's edge
  instead of into it, or spill sideways into the (opaque, painted-on-top) card
  where it's invisible. Removed the old "stub into the rect's center" step
  entirely, since it now does the opposite of what it was for: with opaque
  cards, extending the path past the true port moves the arrowhead from the
  visible gap between cards to a point hidden under the card.
- **Boundary/container subtitle overlapping the first zone's border**: widened
  the title-strip routing obstacles and reserved additional vertical space
  (`pack.mjs`) for a two-line boundary or container label, so a subtitle (e.g.
  "Region: East US 2 - HIPAA / Business Critical") no longer visually overlaps
  the zone it sits above.
- **Fan-out port bias forced onto an incompatible direction**: the
  `srcSideUsed`/`tgtSideUsed` hard-constraint mechanism (see 2026-09-01 entry
  below) was keyed by node ID only, so once ANY edge from a node claimed a
  side, ALL of that node's other edges were forced onto the SAME side
  regardless of where their actual target sat. Found via a live render:
  "Azure Private Link"'s edge to a far-away Snowpipe claimed its bottom side;
  its second edge, to an adjacent Power BI card, was then forced onto that
  same bottom side too, routing it back up through its own card's interior to
  reach a height it never needed to leave from. Fixed in `route.mjs` by
  adding `roughDirection()` -- buckets each edge into one of 4 compass
  directions using ZONE bounding-box comparison (clean axis-aligned
  non-overlap first, zone-center dx/dy fallback, node-center dx/dy fallback
  only for same-zone edges) -- and re-keying the bias maps by `nodeId +
  '|' + direction` instead of bare `nodeId`, so consistency is only forced
  within a compatible direction bucket. Zone-level (not node-center)
  comparison was a deliberate, validated choice: checked against the ORIGINAL
  motivating fan-in case (Synapse/SQL/Blob -> dbt) and found individual
  node-center dx/dy ratios there as fragile as 1.27x for one of the three
  edges, whereas the zones themselves have a clean, stable 72px gap. Verified
  three ways: (1) a hand-built `packed` object using the REAL coordinates
  pulled from the live render that showed the bug now routes
  privatelink->powerbi as a direct 2-point line that never re-enters its own
  card; (2) two new permanent regression tests in `tests/run.mjs` -- one
  reproducing this exact scenario (asserts the two edges now use different
  exit sides), one re-asserting the original fan-in case's same-side
  consistency still holds (checked by `git stash`-ing the fix and confirming
  both fail/pass appropriately); (3) a fresh live-agent re-render showing no
  recurrence of the pattern anywhere in the diagram. A tightened
  `quality.mjs` `CARD_CROSSING` check (only exempting the segment immediately
  adjacent to an edge's own endpoint, not every segment) was tried as an
  independent detection mechanism for this bug class, but reverted: a
  legitimate 2-segment departure/arrival "elbow" (leave one side, short jog
  still inside the box's own footprint, turn toward the target) is
  geometrically IDENTICAL to this bug at the segment level, and the tightened
  check false-positived on 3 pre-existing, visually-correct fixtures. This bug
  class is only reliably distinguishable at the routing level (is the chosen
  side consistent with the target's actual direction?), not by pattern-
  matching rendered segment geometry after the fact.

### Fixed (deployment tooling)
- **`snow sql -f` silently corrupts `&&` to `&` in JS/Python UDF bodies**:
  already documented 2026-08-28 in `deploy/AGENT_INTEGRATION_RUNBOOK.md`, and
  re-triggered 2026-09-09 by a `LAYOUT_DIAGRAM` deploy that forgot the
  documented flag -- `snow sql -f`/`-q` performs client-side legacy SnowSQL
  variable substitution by default (`--enable-templating` defaults to
  `LEGACY,STANDARD`), which treats `&&` as an *escaped single ampersand* and
  collapses it to `&` (bitwise AND, non-short-circuiting) before the statement
  reaches Snowflake. `CREATE OR REPLACE FUNCTION` still succeeds with no
  error; the corruption only surfaces at CALL time as `TypeError: Cannot read
  properties of undefined (reading 'length')` on the first `x && x.length`-
  shaped guard evaluated, for ANY input including trivial ones -- which
  briefly looked exactly like a regression from the route.mjs fix above until
  isolated by comparing the pre-fix and post-fix bundles side by side (both
  failed identically) and diffing `&&`/`&` counts between the local source and
  `GET_DDL` output (86 `&&` locally vs. 0 `&&`/86 `&` deployed). Fixed by
  redeploying with `--enable-templating NONE`. Added
  `deploy/deploy_layout_diagram.sh` -- the only supported way to deploy this
  function via the CLI going forward -- which always passes the flag and
  self-verifies via a post-deploy `GET_DDL` `&&`-count check, so this can't
  silently recur just because a human forgot a flag documented in a file they
  didn't happen to read that session.

### Changed
- **RENDER_DIAGRAM/GENERATE_DIAGRAM_ARTIFACTS source moved into this repo**:
  both function bodies previously lived only in `snowgram-eng` (a separate
  GitHub org/account), now kept frozen as a parked reference copy while active
  work continues here. Copied byte-identical into
  `assets/render/source/*.dev.sql`; `build_render.py`'s default `--src` now
  points there. A rebuild from the new location was diffed against the
  previous build and confirmed identical (only header comments differ).
- **Visual-verification gate promoted from project-local to global**: the
  `.cortex/hooks.json` gate in this repo only loads when a session's CWD is
  inside this repo tree, so a session rooted elsewhere that still edits/deploys
  this repo's code via absolute paths never triggered it. The same enforcement
  now also lives at `~/.snowflake/cortex/hooks/snowgram_visual_gate.py`,
  registered globally and scoped per `session_id` so it can never affect an
  unrelated session (proven via `--self-test`, including the specific case of
  one session's armed gate not blocking a different session's `Stop` event).
- `review_harness.py`'s live-agent HTML-link regex expected a specific label
  format that didn't match the agent's actual response text, so every `--live`
  run reported "Could not find an HTML download link" regardless of whether one
  existed. Narrowed the regex to match the link text directly.

## [Track 1: Layout Engine / CoCo Skill] - 2026-09-01 (part 4: connector routing readability)

### Fixed
- **Fan-in port collapse**: when several sibling edges shared a target's side
  (via the existing hard port-bias constraint), they all landed on the exact
  same port point and shared the same final approach segment, so 3+ separate
  connections rendered as ONE visible line with ONE arrowhead -- found by
  direct SVG path-data inspection (Azure Synapse/SQL/Blob -> dbt in the
  apex-health live render all ended at the identical (x,y)). Fixed with two
  changes in `gridroute.mjs`/`route.mjs`: (1) each additional edge sharing a
  (node, side) now gets an alternating fan-out offset (`nextSlotOffset`,
  +-14px increments) along that side instead of reusing the exact midpoint;
  (2) the node-center "stub" segment appended after the real routed path
  (previously always the rect's raw geometric center) now stays aligned with
  the actual port's off-axis coordinate, or a nonzero offset produced a
  diagonal (non-orthogonal) jog back to center. Also fixed an off-by-one in
  the new slot counter (the 2nd edge into a shared port was getting offset 0,
  colliding with the 1st edge's own unbiased port). Verified via direct SVG
  path-data diffing (4 distinct, purely-orthogonal endpoints where there used
  to be 1) and a Playwright render of the raw `.svg` (not the interactive
  HTML, whose separate wide-layout pass isn't pixel-comparable) showing 3-4
  visibly distinct arrows into a fan-in target.
- **Zone ordering ignored real graph topology for a subset of edges**:
  `assignRanks` in `pack.mjs` decided which zone-to-zone edges counted as
  "forward" (for its longest-path layering) purely from each zone's raw
  DECLARATION ORDER in the input model (`order[tz] <= order[sz]`), not from
  the actual edge graph. A zone declared early but whose only real edge
  arrives from a zone declared much later (e.g. a Governance zone declared
  right after Ingestion, fed only by a Warehouse zone declared near the end)
  had that edge silently treated as a back-edge and never got pulled to its
  correct position -- forcing that edge to travel backward across the entire
  diagram. Replaced the declaration-order filter with a real graph
  reachability check: an edge is now only excluded if adding it would close
  an actual cycle in the zone graph. Verified on the live apex-health
  scenario: Governance moved from a stranded early column into its correct
  topological position immediately after Warehouse, with a short local edge.
- **Row-wrap always restarted left-to-right on every new row**: `wrapUnits`
  (used for both the outer zone/container wrap and the platform-boundary's
  internal zone wrap) filled each wrapped row start-to-finish in the same
  direction, so an edge crossing from the END of one row to the logical
  START of the next had to travel the full canvas width -- flagged directly
  from a live-agent render as "an unintuitive jumble of connection lines."
  Fixed by making the wrap boustrophedon (snake): every ODD row now lays out
  its items in mirrored (reversed) order, so the item continuing the flow
  right after the last item of the row above lands in the same column,
  directly below it, instead of at the opposite edge. Verified via a
  controlled A/B test that replayed the EXACT node/edge model captured from
  a live-agent trace through the fixed engine: `Bronze -> Silver` and
  `Governance -> Gold` both became short vertical hops instead of full-width
  backward jumps. Also verified on a second, independently-generated
  live-agent scenario (multi-cloud security analytics, 9 zones / 2 rows)
  with different topology, confirming the fix generalizes.
- Found (not yet fixed) while validating the snake fix: zones are bucketed
  by category (onprem < snow/bridge < outcome) and an `outcome`-category
  zone always sorts to the very last position regardless of its actual
  topological rank. A zone that connects DIRECTLY to an outcome zone from
  the MIDDLE of the pipeline (e.g. Gold Layer -> Snowsight, with Alerts /
  Incident Search / Anomaly Detection all sitting topologically between
  them) still produces a long cross-diagram edge, since the outcome zone is
  forced to the end no matter which of its several predecessors is
  numerically closest. Tracked as a follow-up; not addressed in this pass.

## [Track 1: Layout Engine / CoCo Skill] - 2026-09-01 (Phase 5: PDF/PNG export)

### Added
- `GENERATE_DIAGRAM_ARTIFACTS` now produces `.pdf` and `.png` alongside the
  existing `.mmd`/`.drawio.xml`/`.svg`/`.html` (six formats total). Approach,
  confirmed via a real feasibility spike (not assumed): reuse the existing
  `.svg` deliverable, wrap it in a minimal HTML shell with an `@page` rule
  sized to the SVG's own width/height (weasyprint defaults to A4 otherwise,
  which clips/scales a wide architecture diagram), render PDF via
  `weasyprint`, then rasterize that PDF to PNG via `pdf2image`/`poppler`.
  All four packages are in the standard Snowflake Anaconda channel; the
  whole pipeline runs inside the Python stored-proc sandbox with no browser
  subprocess, no external network, no EXTERNAL_ACCESS_INTEGRATION.
  `GENERATE_TEMPLATE_ARTIFACTS` inherits this for free (it's a thin wrapper
  that calls `GENERATE_DIAGRAM_ARTIFACTS` internally) -- verified directly,
  not assumed.
- Spike findings worth keeping: feeding weasyprint the FULL interactive HTML
  fails (`RecursionError` in weasyprint's CSS `var()` resolver -- our
  CSS-custom-property theming/animation isn't supported), so PDF/PNG must be
  derived from the plain `.svg` output instead, which has no CSS variables.
  weasyprint 62.x also no longer exposes `Document.write_png()` (removed);
  PDF->PNG via `pdf2image`/poppler is the working path. Deploying any
  `weasyprint`-`PACKAGES` proc also requires explicitly listing
  `snowflake-snowpark-python` in `PACKAGES` or it fails to deploy with a
  misleading `ModuleNotFoundError: No module named 'snowflake'`.
- Updated the `SNOWGRAM_AGENT` spec (Section 4 response template, Step 5
  orchestration note, and both `GENERATE_DIAGRAM_ARTIFACTS` /
  `GENERATE_TEMPLATE_ARTIFACTS` tool descriptions, including their DOC_JSON
  parameter descriptions) from "four portable formats" to "six", with PDF/PNG
  listed. Deployed via `ALTER AGENT ... MODIFY LIVE VERSION SET
  SPECIFICATION`, then `ALTER AGENT ... COMMIT` + `SET DEFAULT_VERSION` --
  confirmed the CLI's `agent-save` alone does NOT move DEFAULT_VERSION (the
  describe output still showed the old spec after agent-save reported
  success), matching the previously-documented publish/default-version gap.
  Verified end-to-end on a fresh live-agent run: the agent's actual response
  now lists working PDF and PNG download links.

### Fixed
- Found and fixed a stale-source bug in `_svg()`: the LOCAL canonical
  `render_diagram.dev.sql` and its `render_diagram_generated.py` mirror
  (used offline by `render_local.py`/`review_harness.py` for fast testing
  without a Snowflake round trip) had a double-escaped XML declaration join
  (`'<?xml ...?>\\n'`), producing a literal two-character `\n` instead of a
  real newline -- visible as stray text at the top of any locally-rendered
  `.svg`. Verified via direct `CALL TEMP.ABANNERJEE.RENDER_DIAGRAM(...)`
  that the LIVE deployed UDF was unaffected (already emits a real newline),
  so this was a local-file/live drift in the opposite direction from usual --
  no live redeploy was needed. Fixed the canonical source anyway so local
  testing matches live; `render_diagram_generated.py` re-synced via
  `build_render.py`.
- `generate_artifacts.dev.sql` had drifted from the live deployed procedure
  (missing the `CONTAINERS` parameter added in an earlier session's
  live-only edit). Re-synced from a fresh `GET_DDL` fetch of the live 6-arg
  version before adding PDF/PNG, so the local source and live object match
  again.

## [Track 1: Layout Engine / CoCo Skill] - 2026-09-01 (part 3)

### Fixed
- The port-consistency fix from part 2 was insufficient, and my validation
  didn't catch it -- caught by the user zooming into the actual rendered
  image, not by anything I checked. Audit of what happened: I verified
  "same final entry pixel" and "0 crossings" on the deployed output, but
  never checked that sibling fan-in edges took a *consistent-shaped* route
  to get there. A soft `PORT_BIAS` cost penalty (+50) on the non-preferred
  side is exactly the kind of thing that passes a coordinate-level check
  (all 3 edges DID converge on the same final point) while still looking
  wrong -- for a card far enough from its siblings, the raw distance
  saved by using its geometrically-closer side exceeded the penalty, so
  it won anyway. Traced with a direct replay of the exact 3-edge sequence
  against the real deployed geometry, which is what actually surfaced it
  (`azsql->dbt` and `blob->dbt` computed different tgtSide values despite
  the bias). Fixed by making `portBias` a hard constraint instead of a
  cost nudge: `routeShortestOrthogonal` now filters `srcPorts`/`tgtPorts`
  down to just the requested side when a bias is given, rather than
  leaving all 4 ports in play with a penalty on 3 of them. Removed the
  now-dead `PORT_BIAS` constant and the bias-cost lines in port seeding.
  Lesson for future validation: "shares an endpoint" and "0 obstacle
  crossings" are necessary but not sufficient checks for a fan cluster --
  also need to compare the actual route *shape* (turn sequence) each
  sibling took, or just look at the rendered image closely rather than
  trusting an aggregate coordinate check.

## [Track 1: Layout Engine / CoCo Skill] - 2026-09-01 (part 2)

### Fixed
- Two style issues flagged from a fresh live-agent review, both real:
  1. **Inconsistent fan-in/fan-out port sides.** 3 sources feeding one
     target independently picked whichever port tied on shortest-path
     cost, so 2 entered dbt's left edge and 1 entered its bottom edge --
     technically correct routing, but visually inconsistent. Added port
     `side` labels + an optional `portBias` to `routeShortestOrthogonal`
     (a cost penalty on non-preferred sides), and in `route.mjs` track
     which side each node's first edge used (`srcSideUsed`/`tgtSideUsed`,
     scored separately since a node's fan-out side and fan-in side are
     independent) and bias every later edge sharing that node toward it.
  2. **Paths hugging an unrelated zone/container's wall.** Confirmed
     first, then genuinely mis-fixed: my first attempt raised the
     `segmentBlockedByRect` `margin` (3 -> 14), which actually makes
     hugging *more* permissive -- margin only defines how far a segment
     may sit inside an obstacle's edge and still count as "on the
     boundary, not blocked"; a bigger margin tolerates deeper intrusion,
     the opposite of the ask. Reverted margin to 3. The real fix:
     inflate every *active* (non-excluded) obstacle's rect by a fixed
     `CLEARANCE` (10px) before it's used for blocking and grid-line
     generation, so a path must keep visible standoff from anything it
     isn't connecting to. The exclusion filter runs first, so an
     endpoint's own zone/container chain is never inflated and can still
     be hugged exactly where it needs to be (its own boundary).
  Verified: full local suite still 0 crossings across all fixtures; a
  fresh live-agent run (genuinely different topology -- 17 nodes, 5
  top-row zones -- so not a cached/repeat response) checked
  coordinate-by-coordinate came back 0 crossings, and the fan-in cluster
  and container walls are visibly cleaner in the rendered PNG.

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
