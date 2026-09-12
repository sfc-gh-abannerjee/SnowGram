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
4. **Data-sharing topology root fix**: canonical Secure Data Sharing rule added to the live
   `SNOWGRAM_AGENT` orchestration (provider = external account OUTSIDE the boundary; share =
   ONE direct zero-copy `data_share` edge, no intermediate node), classifier + `PATTERN_CATALOG`
   + fixture + `tests/run.mjs` regression.
5. **Icon accuracy root fix**: curated missing components in `COMPONENT_ICON_MAP`
   (Azure SQL / Private Link / provider), separator-insensitive key match in `MAP_ICON_PATH`
   (online) + `icon_resolver.py` (offline), lean re-export, + `test_icon_coverage.py`.
6. **Self-hiding type eyebrow**: card type line hides when it echoes the title
   (`_type_echoes` = whole-word containment), always emitted + live `sgTypeEcho` +
   Customize toggle "Repeat type label…" (`body.sg-show-types`) + present-caption fix.
   Guards: `assets/render/test_type_echoes.py` (Python predicate) and
   `assets/render/test_eyebrow_ui.py` (Playwright: JS + caption paths, skips w/o browser).
7. **Review harness enforces the side-by-side**: `review_harness.py` now runs live +
   an offline-vs-live side-by-side BY DEFAULT (`--offline-only` opts out with a loud
   NOT-FOR-SIGN-OFF banner; a failed side-by-side exits non-zero). `build_side_by_side`
   screenshots diagram-only regions and composites them in equal-sized cells.

## Gotchas
- weasyprint offline: `DYLD_LIBRARY_PATH=/opt/homebrew/lib python3 ...`.
- Never hand-copy `_category`/edge logic into `render_local.py` — import `shared_rules.py`
  (re-extract via `assets/render/extract_shared_rules.py`, which `review_harness.py` auto-runs).
- `generate_artifacts.dev.sql` / `render_diagram.dev.sql` use `$$...$$`; `sql_execute` directly.
- `git checkout -- <file>` reverts ALL uncommitted changes to that file — bit me once. Remove
  single lines manually instead.
- Visual Verification Gate + Commit Wrap-Up Gate are hook-enforced (`.cortex/hooks.json`).
