# Handoff — abannerjee

**Last updated**: 2026-09-10 · **Scope**: Track 1 only (`skills/snowflake-architecture-diagram/`)
**Last commit**: `e787844` — local `main` is **44 commits ahead of `origin/main`**, none
pushed (this has been true across several sessions; push only when the user asks).

> This is a fast-orientation pointer, not a history. Full detail lives in `CHANGELOG.md`.
> Read every `docs/HANDOFF_*.md` present at session start — not just this one — but only
> ever write/rewrite **this** file. Never edit or delete another author's handoff.

## Current state
- Deployed and verified consistent with local source: `TEMP.ABANNERJEE.RENDER_DIAGRAM`,
  `TEMP.ABANNERJEE.LAYOUT_DIAGRAM`, `TEMP.ABANNERJEE.GENERATE_DIAGRAM_ARTIFACTS` (Snowflake
  connection: `snowhouse`; DDL needs `USE WAREHOUSE SE_WH;` in the same payload).
- `node tests/run.mjs` (layout-engine) and `python3 review_harness.py` (all 5 fixtures +
  `--live`) both pass clean as of the last commit.
- Uncommitted in the tree right now: only pre-existing drift unrelated to this thread —
  `.cursor/rules` deletion / `.cursor/rules.md` untracked, and several `*.mjs.bak_*` /
  `LAYOUT_DIAGRAM.sql.bak_*` snapshot files. Don't clean these up without checking with the
  user first; they predate this session.
- `review-runs/` is gitignored, regenerate-on-demand — never expect it to exist fresh.

## What just shipped (this thread)
1. **Eliminated a confirmed drift** between the offline (`render_local.py`) and online
   (deployed `GENERATE_DIAGRAM_ARTIFACTS`) pipelines' category/edge-label logic. Root fix:
   extracted the shared `_category()`/`_build_edges()` block from
   `generate_artifacts.dev.sql` into vendored `assets/render/shared_rules.py`
   (`extract_shared_rules.py`, sha256-stamped + smoke-tested), imported directly by
   `render_local.py`. `review_harness.py` re-runs the extraction every run; `render_local.py`
   independently warns if the vendored copy goes stale.
2. Added missing edge labels/styles to `tests/fixtures/apex_health_privatelink_stub.json`
   (was a data gap, not a code bug).
3. Split `review-runs/<run-id>/` into `offline/` and `online/` subfolders; fixed `--live`'s
   link extraction (real agent response format is plain-text bullets, not markdown links —
   the old regex silently matched nothing) and generalized it to every format, not just HTML.

## Gotchas specific to this area
- **weasyprint on macOS**: `pip install weasyprint` alone fails (`cannot load library
  'libgobject-2.0-0'`) even after `brew install pango`. Always run with
  `DYLD_LIBRARY_PATH=/opt/homebrew/lib python3 review_harness.py ...`.
- **Never hand-copy `_category()`/edge logic into `render_local.py` again** — import
  `assets/render/shared_rules.py` instead. If you touch `generate_artifacts.dev.sql`'s
  `SHARED_MODEL_RULES_BEGIN`/`_END` block, re-run `extract_shared_rules.py` (or just run
  `review_harness.py`, which does it automatically) before trusting any offline render.
- **`git checkout -- <file>` reverts ALL uncommitted changes to that file**, not just a
  targeted recent line — bit me once this session (wiped an entire uncommitted refactor
  while trying to undo one test-marker line). To undo a small addition, remove just that
  line manually, or commit safe intermediate states more often.
- `generate_artifacts.dev.sql` and `render_diagram.dev.sql` use `$$...$$` dollar-quoting for
  deploy (not single-quote escaping) — `sql_execute` these directly, no manual escaping.
- The **Visual Verification Gate** and **Commit Wrap-Up Gate** in `AGENTS.md` are real,
  hook-enforced (`.cortex/hooks.json`) — don't declare a layout/render change done without
  the user's explicit visual sign-off, and don't leave a commit's ctx/docs half unresolved.

## Immediate next step
None pending — all three asks from this thread (subfolders, edge labels, drift prevention)
are shipped and verified end to end, including a real `--live` agent run. If you're picking
this up cold: re-run `python3 review_harness.py` once to reconfirm nothing drifted since.
