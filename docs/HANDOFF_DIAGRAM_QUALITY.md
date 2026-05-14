# Handoff: SnowGram Diagram Quality Improvement

**Date**: 2026-05-14
**Branch**: `feat/assessment-followups-tier-1-and-2` (24+ commits ahead of `origin/main`, pushed)
**PR**: https://github.com/sfc-gh-abannerjee/SnowGram/pull/1
**Connection**: `se_demo`
**Agent**: `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT` (confirmed deployed, claude-opus-4-6, 300s/64K, 8 tools)

---

## What Was Accomplished (2026-05-14 Session)

### Architectural Refactor: Unified DiagramSpec Pipeline

After exploring the dual-path rendering pipeline (Mermaid parser path vs JSON spec path), determined that ~60% of pipeline code (~1,600 lines) was working around Mermaid as the intermediate representation. State-of-the-art for AI-generated diagrams is structured JSON, not text-based DSLs.

Implemented a phased migration that introduces a canonical `DiagramSpec` intermediate representation while preserving all existing exports (.mmd, .json, .svg, .png) and the Mermaid path as a fallback.

| Commit | What | Phase |
|---|---|---|
| `64f3545` | Define DiagramSpec canonical type | Foundation |
| `7f0bb8c` | unifiedLayout consuming DiagramSpec | Foundation |
| `b60c72b` | Edge label capture (C9 fix) + parseMermaidToSpec() bridge | Adapter |

### Decision: Defer DB-side template migration

The plan included adding a `json_spec` VARIANT column to `ARCHITECTURE_TEMPLATES` so templates would return pre-converted DiagramSpec. **Decided to defer** because:

- Frontend `parseMermaidToSpec()` does the same conversion at render time
- Single conversion per template load (negligible perf overhead)
- Avoids a Snowflake DDL migration we'd have to maintain
- Same end state, less surface area
- Can add later as an optimization if profiling shows parse cost matters

**Net effect**: All 14 templates work via Mermaid → parseMermaidToSpec → unifiedLayout, no DB changes needed.

### Cutover Strategy: Feature-flag both paths

App.tsx will ship with both paths active. The new DiagramSpec path is gated behind a feature flag (env var or config). This allows:
- A/B comparison against the existing Mermaid pipeline
- Quick rollback if regressions surface
- Phased cleanup of the legacy 200-line badge repositioning block once the new path is validated

---

## Original 2026-05-13 Work (preserved)

### Assessment & Tier 1 Cleanup (complete)
- Captured deployed agent spec → `backend/agent/agent_spec_deployed.yaml`; deprecated v4/v5
- Documented dual-track design in CLAUDE.md + AGENTS.md
- Refreshed CI (fixed workflow_dispatch trigger, added security-audit job with npm audit + pip-audit)
- Triaged 38 uncommitted files into 8 logical commits
- Backed up 13 stashes as patches in `.cortex/stash_backups/2026-05-13/`; dropped all
- Removed `backend/elk_diagram/`; salvaged icons + research docs

### Phase A — Quick Wins (complete)
- **A2** (`8bec726`): Synced frontend `SNOWGRAM_SYSTEM_PROMPT` with deployed spec — added BI/analytics keyword, COMPOSE_DIAGRAM_FROM_PATTERN as Priority 2, aligned `parseResponse()` to Section 1-5 headers with backward compat
- **A3** (`8efd63b`): Unified node width constants via canonical `NODE_DIMENSIONS` in `textMeasure.ts`; replaced 4 divergent hard-coded values across `elkLayout.ts` and `layoutUtils.ts`
- **A1** (partial): Baseline capture started; `eval_baseline.py` and `T1_mermaid.txt` exist in `.cortex/baselines/` but full 6-pass eval was not completed

---

## Estimated Baseline (from exploration, not measured end-to-end)

| Prompt | Components | Connections | Structure | Layout | Styling | Badges | **Total** |
|---|---|---|---|---|---|---|---|
| T1 Medallion+CDC | 80 | 85 | 85 | 80 | 75 | **0** | 68% |
| T2 Streaming | 90 | 85 | 75 | **55** | 85 | 70 | 78% |
| T3 BI Analytics | 85 | 90 | 90 | 75 | 70 | **0** | 72% |
| T4 IoT | 85 | 80 | 80 | 75 | **65** | **0** | 67% |
| **Avg** | 85 | 85 | 82 | 71 | 74 | **18** | **71%** |

**Target**: ≥95% weighted total per prompt; no individual pass below 80%.

---

## What Remains — Phases B, C, D

### Phase B — Semantic & Template Routing (Snowflake-side DML)

**Table**: `SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS`
**Columns**: `SYNONYM`, `COMPONENT_TYPE`, `WEIGHT`, `COMMENT` (NOT `TERM`/`MAPPED_NAME`)

| Step | What | SQL target |
|---|---|---|
| B4 | Expand synonyms for 13 templates (only MEDALLION_LAKEHOUSE has synonyms today) | INSERT INTO COMPONENT_SYNONYMS |
| B5 | Resolve `kafka` conflict: `Kafka` (w=1) vs `ext_kafka` (w=100) | DELETE or UPDATE weight |
| B6 | Fix template label drift: `stream_b["Stream<br/>Bronze CDC"]` → eval expects `"CDC Stream"` | UPDATE ARCHITECTURE_TEMPLATES |
| B7 | (Only if A+B+C insufficient) Modify agent orchestration instructions; requires DROP+CREATE agent | ALTER/CREATE AGENT |

**Template table**: `SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES` (column `full_mermaid_code`, key `template_id`)
**14 templates**: MEDALLION_LAKEHOUSE, MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY, STREAMING_DATA_STACK, SECURITY_ANALYTICS, CUSTOMER_360, ML_FEATURE_ENGINEERING, BATCH_DATA_WAREHOUSE, REALTIME_IOT_PIPELINE, DATA_GOVERNANCE_COMPLIANCE, EMBEDDED_ANALYTICS, MULTI_CLOUD_DATA_MESH, SERVERLESS_DATA_STACK, REALTIME_FINANCIAL_TRANSACTIONS, HYBRID_CLOUD_LAKEHOUSE

**Note**: No BI_ANALYTICS template exists. T3 ("Design BI analytics architecture") should map to EMBEDDED_ANALYTICS or BATCH_DATA_WAREHOUSE.

### Phase C — Frontend Layout Quality

| Step | What | File |
|---|---|---|
| C8 | Wire `analyzeLaneStructure()` into `layoutWithLanes` (dead code at line ~887) | `frontend/src/lib/elkLayout.ts` |
| C9 | Fix edge label drop: `-->|label|` syntax parsed but discarded; node ID limited to `[\w-]+` | `frontend/src/lib/mermaidToReactFlow.ts` |
| C10 | Apply backward-edge cycle detection to `layoutWithLanes` (currently only in `layoutWithELK`) | `frontend/src/lib/elkLayout.ts` |

### Phase D — Convergence

Re-run 6-pass eval after each phase; iterate on lowest-scoring (prompt × pass) cell until ≥95%.

---

## Key Root Causes (explored + validated)

1. **Frontend prompt override** (`snowgram-agent-client.ts:67-118`) — FIXED in Phase A2
2. **parseResponse() header mismatch** — FIXED in Phase A2 (backward compat)
3. **4 divergent width constants** — FIXED in Phase A3
4. **Only 1/14 templates has synonym routing** — Phase B
5. **`kafka` synonym conflict** — Phase B
6. **Template label drift (stream_b vs CDC Stream)** — Phase B
7. **`analyzeLaneStructure()` is dead code** — Phase C
8. **Edge labels dropped by parser** — Phase C
9. **`layoutWithLanes` lacks edge-awareness / backward-edge detection** — Phase C
10. **No BI_ANALYTICS template** — addressed by keyword routing in A2 (maps to EMBEDDED_ANALYTICS)

---

## Critical Files

| File | What it does | Phase |
|---|---|---|
| `frontend/src/lib/snowgram-agent-client.ts` | System prompt override + response parser | A2 ✓ |
| `frontend/src/lib/textMeasure.ts` | NODE_DIMENSIONS canonical constants | A3 ✓ |
| `frontend/src/lib/elkLayout.ts` | Both layout paths (ELK + lanes); dead `analyzeLaneStructure` | C8, C10 |
| `frontend/src/lib/mermaidToReactFlow.ts` | Mermaid parser; edge label regex | C9 |
| `frontend/src/lib/layoutUtils.ts` | Boundary/spacing utilities | A3 ✓ |
| `backend/agent/agent_spec_deployed.yaml` | Deployed agent spec (source of truth) | B7 if needed |
| `backend/tests/agent/run_tests.py` | 1019-line YAML-driven eval harness | Verification |
| `backend/tests/visual/eval_passes.py` | 6-pass scoring (Components/Connections/Structure/Layout/Styling/Badges) | Verification |
| `SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS` | 202 rows; synonym→component_type routing | B4, B5 |
| `SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES` | 14 template Mermaid code | B6 |

---

## Commands to Continue

```bash
# Orient
cd /Users/abannerjee/Documents/SnowGram
git log --oneline origin/main..HEAD
git status

# Run the eval harness (requires Snowflake creds)
python3 backend/tests/agent/run_tests.py --report

# Type-check frontend
cd frontend && npx tsc --noEmit

# Check synonyms
# (use sql_execute on connection se_demo)
SELECT SYNONYM, COMPONENT_TYPE, WEIGHT FROM SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS ORDER BY COMPONENT_TYPE, WEIGHT DESC;

# Check template output
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('MEDALLION_LAKEHOUSE');

# Push updates to PR
git push origin feat/assessment-followups-tier-1-and-2
```

---

## Gotchas & Guardrails

1. **Agent redeployment** requires `DROP AGENT ... CREATE OR REPLACE AGENT ...` — cannot ALTER. Backup is `backend/agent/agent_spec_deployed.yaml`. Only do this in Phase B7 if scores remain below target after B4-B6+C8-C10.
2. **COMPONENT_SYNONYMS columns** are `SYNONYM`, `COMPONENT_TYPE`, `WEIGHT`, `COMMENT` — plan drafts incorrectly used `TERM`/`MAPPED_NAME`.
3. **Template table** is `ARCHITECTURE_TEMPLATES` — plan drafts incorrectly said `COMPOSED_TEMPLATES`.
4. **STREAMING_DATA_STACK template** has 23 invisible spacer subgraphs (not 40 as some notes say).
5. **GitHub secrets** (`SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_PASSWORD`) are NOT configured — agent-tests CI job skips until added.
6. **Remaining uncommitted**: `frontend/tsconfig.tsbuildinfo` (gitignored, harmless), persona test PNGs (skill test outputs), `skills/.../docs_cache.json` (modified docs cache).

---

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Dual-track (skill vs GUI) | Intentional, preserve both | User clarified |
| `backend/elk_diagram/` | Dropped, icons salvaged | Unreferenced one-off demo |
| Agent spec source of truth | Deployed agent (not v4/v5 YAML) | v5 is stale; deployed = production |
| BI Analytics routing | Map to EMBEDDED_ANALYTICS via keyword table | No BI_ANALYTICS template exists |
| Align parseResponse or spec? | Aligned frontend to match deployed spec | Less surface area, single source of truth |
| Stashes | Backed up as patches, all dropped | All were convergence-loop auto-backups |

---

## Task State

```
cortex ctx task list  # shows task-d552b9b4 in progress
cortex ctx step list -t task-d552b9b4  # shows Phase A steps done; sbbb2 still pending
```

Team `team-workflow-task-d552b9b4` is active. Next session should either resume the task or create a fresh one for Phase B.
