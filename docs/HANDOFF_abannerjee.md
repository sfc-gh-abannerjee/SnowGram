# Handoff — abannerjee

**Last updated**: 2026-09-11 · **Scope**: Track 1 + the deployed `SNOWGRAM_AGENT` (Track 2 orchestration)
**Last commit**: latest on `main` (see `git log -1`) — local `main` is many commits ahead of
`origin/main`, none pushed (true across sessions; push only when the user asks).

> This is a fast-orientation pointer, not a history. Full detail lives in `CHANGELOG.md`.
> Read every `docs/HANDOFF_*.md` present at session start — not just this one — but only
> ever write/rewrite **this** file. Never edit or delete another author's handoff.

## Current state
- Deployed + verified consistent with local source: `TEMP.ABANNERJEE.{RENDER_DIAGRAM,
  LAYOUT_DIAGRAM,GENERATE_DIAGRAM_ARTIFACTS}` and `SNOWGRAM_AGENT` (published). Connection
  `snowhouse`; DDL needs `USE WAREHOUSE SE_WH;` in the same payload.
- Edit the deployed agent ONLY via the `agent-studio` skill (agent-read → agent-write →
  agent-save → agent-publish); the workspace spec lives at `cortex_project/SNOWGRAM_AGENT.agent.yaml`.
- `node tests/run.mjs` passes (incl. the new data-sharing topology regression). Offline
  render (`render_local.py`, needs `DYLD_LIBRARY_PATH=/opt/homebrew/lib`) and a `--live`
  run both verified this session.
- Uncommitted: only pre-existing drift (`.cursor/rules*`, `*.bak_*` snapshots) — leave alone.
- `review-runs/` is gitignored, regenerate-on-demand.

## What just shipped (this thread)
1. Killed offline↔online **category drift**: `_category` is now icon-independent + a shared
   `resolve_category()` (explicit-first) used by both pipelines. Same input → identical layout.
2. Added the **edge-style legend** to the interactive HTML renderer (was SVG-only).
3. Fixed **oversized arrowheads** swallowing L-turns: all markers → `markerUnits="userSpaceOnUse"`.
4. **Data-sharing topology root fix** (the big one): added a canonical Secure Data Sharing
   rule to the live `SNOWGRAM_AGENT` orchestration (provider = external account OUTSIDE the
   boundary; share = ONE direct zero-copy `data_share` edge, no intermediate node), taught
   the classifier a `snowflake account` provider → `onprem`, enriched the `SECURE_DATA_SHARING`
   row in `PATTERN_CATALOG`, corrected the reference fixture + added a `tests/run.mjs` regression.

## Immediate next step (IN PROGRESS — icon root fix)
Icons are wrong for **Azure SQL**, **Azure Private Link**, and **data sharing / provider**.
Root cause (confirmed): the single-source curated map `TEMP.ABANNERJEE.COMPONENT_ICON_MAP`
(exported verbatim to `assets/render/icons_generated/catalog_map.json` by `build_icons.py`)
is MISSING entries for these → both pipelines fall to semantic `ICON_SEARCH`/fuzzy, which
silently pick wrong icons. TWO gap types: (A) icon exists but uncurated (data sharing →
`sno-icon-sharing-collaboration-blue.svg` / `sno-icon-industry-provider-blue.svg`);
(B) icon absent from the 356-icon vendored catalog entirely (Azure SQL, Azure Private Link —
`azure/network/` is empty, `azure/database/` has only data-factory+oracle).
Plan (approved): (1) FIRST check `ICON_CATALOG` table + the `snowgram-eng` repo for a larger
icon set before external sourcing (user says we sourced thousands originally — the 356 is a
"lean baseline"); (2) curate `COMPONENT_ICON_MAP` for the missing components; (3) re-export via
`build_icons.py`; (4) add a curation-coverage safeguard test (every template/fixture
component_type must resolve via the curated map, fail loudly); (5) verify offline+online.

## Gotchas
- weasyprint offline: `DYLD_LIBRARY_PATH=/opt/homebrew/lib python3 ...`.
- Never hand-copy `_category`/edge logic into `render_local.py` — import `shared_rules.py`
  (re-extract via `assets/render/extract_shared_rules.py`, which `review_harness.py` auto-runs).
- `generate_artifacts.dev.sql` / `render_diagram.dev.sql` use `$$...$$`; `sql_execute` directly.
- `git checkout -- <file>` reverts ALL uncommitted changes to that file — bit me once. Remove
  single lines manually instead.
- Visual Verification Gate + Commit Wrap-Up Gate are hook-enforced (`.cortex/hooks.json`).
