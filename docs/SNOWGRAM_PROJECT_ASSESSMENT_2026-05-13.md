# SnowGram Project State Assessment

**Date**: 2026-05-12
**Assessor**: Cortex Code (team-workflow plan agent)
**Repo**: `sfc-gh-abannerjee/SnowGram` (private, GitHub)
**Branch**: `main` @ `ecc9e32`

---

## Executive Summary

SnowGram is a Snowflake architecture diagram generator combining a **Cortex Agent** backend (deployed to `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT`) with a **Next.js 15 + ReactFlow** frontend. The project is actively developed by a single contributor (Abhinav Bannerjee, 120 commits), with 39 commits in May 2026 alone — nearly all focused on a standalone `snowflake-architecture-diagram` CoCo skill that renders diagrams via an HTML viewer with SVG connectors and topology-driven zone layouts.

**Current state**: The project deliberately maintains two independent entry points — a **dual-track design**:
1. **CoCo Skill** (`skills/snowflake-architecture-diagram/`) — a standalone, local-only generation path for users who cannot or prefer not to deploy a Snowflake agent. Flow: CoCo skill → `flow_builder.py` → state JSON → HTML viewer. No Cortex Agent involved; everything runs client-side.
2. **SnowGram Agent + GUI** (Next.js + ReactFlow frontend backed by `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT`) — the Snowflake-deployed path that powers the interactive GUI. Cortex Agent + tools + semantic views server-side; ReactFlow + ELK.js client-side.

The Snowflake backend (agent, functions, semantic view, templates) is stable and deployed. The two tracks are deliberately separate and share no layout code — they serve different user populations. A third, exploratory renderer (`backend/elk_diagram/`, matplotlib-based) exists but has unclear ownership and is entirely uncommitted.

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                    DUAL-TRACK USER ENTRY POINTS                       │
│                                                                       │
│  ┌─────────────────────────┐       ┌────────────────────────────┐     │
│  │  Track 2: SnowGram GUI  │       │  Track 1: CoCo Skill       │     │
│  │  Next.js Frontend        │       │  (No Snowflake Agent)       │     │
│  │  localhost:3002           │       │  snowflake-architecture-    │     │
│  │  ReactFlow canvas         │       │  diagram/                   │     │
│  └───────────┬──────────────┘       └──────────────┬──────────────┘     │
│              │                                      │                    │
│              │ REST API (SSE)                       │ Python composer     │
│              ▼                                      ▼                    │
│  ┌───────────────────────┐          ┌───────────────────────────┐       │
│  │  Cortex Agent REST     │          │  flow_builder.py +         │       │
│  │  /api/v2/cortex/       │          │  component_blocks.json     │       │
│  │  agent:run              │          │  → state JSON → HTML       │       │
│  └───────────┬────────────┘          │     viewer (client-side)   │       │
│              │                       └───────────────────────────┘       │
│              ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │                    SNOWGRAM_DB (Snowflake)                    │       │
│  │                    [Used by Track 2 only]                     │       │
│  │                                                               │       │
│  │  AGENTS.SNOWGRAM_AGENT   ← claude-sonnet-4-5, 6 tools        │       │
│  │  CORE.COMPONENT_MAP_SV   ← semantic view (202 synonyms)      │       │
│  │  CORE.SUGGEST_COMPONENTS_JSON  ← AI component recommender     │       │
│  │  CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE  ← 14 templates           │       │
│  │  CORE.VALIDATE_MERMAID_SYNTAX  ← Python UDF                   │       │
│  │  KNOWLEDGE.SNOWFLAKE_DOCS_SEARCH  ← Cortex Search (15 docs)  │       │
│  └──────────────────────────────────────────────────────────────┘       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack & Dependencies

### Frontend (`frontend/`)
| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js | ^15.1.0 |
| UI | React + ReactFlow | ^18.2.0 / ^11.11.0 |
| Layout engine | ELK.js | ^0.11.0 |
| Diagram parsing | Mermaid | ^11.0.0 |
| Component kit | MUI Material | ^7.3.8 |
| State | Zustand (persist middleware) | ^4.5.0 |
| Bundler | Next.js built-in (Turbopack) | — |
| Tests | Vitest | ^4.0.18 |
| TypeScript | ^5.3.3 | — |
| Styling | CSS Modules + Emotion/styled-components | — |

**Notable**: Both `@emotion` and `styled-components` are listed as dependencies — two competing CSS-in-JS solutions. MUI uses Emotion; `styled-components` appears unused or legacy.

### Backend (`backend/`)
| Layer | Technology |
|-------|-----------|
| API Framework | FastAPI + Uvicorn |
| Snowflake | snowflake-connector-python |
| Agent client | Custom REST client (`cortex_agent_client.py`) |
| ELK renderer | matplotlib + PIL (Python, `elk_diagram/`) |
| Tests | pytest + custom convergence loops |
| Python | 3.11 (venv, 693 MB) |

### CoCo Skill (`skills/snowflake-architecture-diagram/`)
| Layer | Technology |
|-------|-----------|
| Intent router | Python (`intent_router.py`) |
| Composer | Python (`composer.py`, `flow_builder.py`) |
| Viewer | Standalone HTML + vanilla JS |
| Icons | 200+ official Snowflake SVG icons |
| Tests | pytest (golden-file pattern) + persona regression harness |
| Templates | 14 JSON files mirroring Snowflake templates |

### Snowflake Objects
| Object | Count | Notes |
|--------|-------|-------|
| UDFs/UDTFs | 22 | 5 table functions wrapped as scalar JSON for agent compatibility |
| Agent | 1 | `SNOWGRAM_AGENT`, claude-sonnet-4-5, 90s budget |
| Semantic View | 1 | `COMPONENT_MAP_SV` (202 synonyms) |
| Cortex Search | 1 | `SNOWFLAKE_DOCS_SEARCH` (15 docs, arctic-embed-m-v1.5) |
| Tables | 24 | 14 with data; 10 empty (AGENT_LOGS, SESSIONS, etc.) |
| Templates | 14 | Full end-to-end architecture patterns |

---

## Git State

### Activity
| Period | Commits |
|--------|---------|
| Total | 120 |
| Since 2026-01-01 | 63 |
| Since 2026-03-01 | 40 |
| Since 2026-05-01 | 39 (all in last 12 days) |

**Single contributor**: Abhinav Bannerjee (all 120 commits).

### Recent Focus (last 30 commits)
All 30 most recent commits are prefixed `feat(skills):` or `fix(skills):` — they target the standalone CoCo skill viewer, not the Next.js frontend. Topics:
- Topology-driven zone layout with connector deconfliction
- SVG connector arrows (orthogonal routing, animated dashes)
- Responsive grid layout + per-component doc links
- Icon scaling, arrow direction fixes
- Smart zone naming (medallion label normalization)
- Inter/intra-zone spacing tuning

### Branches
| Branch | State |
|--------|-------|
| `main` | Active, HEAD at `ecc9e32` |
| `2025-11-14-25bj-WYvAi` | Stale worktree, pinned at `86357a5` |
| `feat-cortex-agent-ui-YHdzT` | Stale worktree, pinned at `86357a5` |

Both non-main branches are attached to cursor worktrees at `/Users/abannerjee/.cursor/worktrees/SnowGram/` and appear abandoned (both at the same commit from ~6 months ago).

### Uncommitted Changes (32 files modified, 13 untracked)

**Modified files** (2005 insertions, 143 deletions):

| Area | Files | Nature |
|------|-------|--------|
| Frontend core | `App.tsx`, `App.module.css`, `CustomNode.tsx`, `CustomNode.module.css` | Layout/styling changes |
| Frontend lib | `elkLayout.ts`, `layoutUtils.ts`, `mermaidToReactFlow.ts` | Layout algorithm updates |
| Frontend build | `tsconfig.tsbuildinfo` | Auto-generated |
| Backend tests | `unified_convergence_loop.py`, `eval_passes.py`, `skill_triggers.py` | Test infrastructure updates |
| Backend ELK | `generate_arch_diagram_elk.py` + icon PNGs (12 files) | ELK renderer + icons |
| CoCo skill | `flow_builder.py`, persona test outputs (JSON/HTML/PNG) | Skill updates |
| CoCo debug | `.ralph/guardrails.md`, `.ralph/progress.md` | Debug session state |

**Untracked files**:
- `backend/elk_diagram/ARCHITECTURE.md`, `PLAN.md`, `README.md` — docs for new ELK pipeline
- `backend/elk_diagram/elk_layout/graph.json`, `layouted.json` — ELK intermediate files
- `backend/elk_diagram/output/` — rendered diagram outputs
- `backend/tests/.ralph/best_mermaid.mmd`, `best_score.txt` — convergence loop artifacts
- `frontend/public/icons/` (2 new icons), `frontend/src/lib/textMeasure.ts` — new utility

---

## Frontend State

### Core Application (`frontend/src/App.tsx` — 4,792 lines)
This is a **monolithic God Component** that handles:
- ReactFlow canvas rendering with custom node types
- Agent query submission and SSE streaming
- Mermaid-to-ReactFlow conversion pipeline
- ELK layout orchestration
- Chat panel UI
- Multi-tab integration (Zustand store)
- Export functionality (PNG/SVG)
- Theme toggling

**Risk**: At ~4,800 lines, this file is the single biggest maintenance risk in the project. Any change here risks regressions across all features.

### Layout Pipeline
```
User Query → Agent → JSON/Mermaid response
                         │
                         ▼
              mermaidToReactFlow.ts (791 lines)
                 Parse Mermaid → nodes/edges
                         │
                         ▼
              graphNormalize.ts (238 lines)
                 Normalize node/edge structure
                         │
                         ▼
              elkLayout.ts (1,093 lines)
                 ELK.js hierarchical layout
                         │
                         ▼
              ReactFlow canvas render
```

### Multi-Tab System
Implemented via Zustand store (`diagramTabsStore.ts`, 307 lines) with persistence middleware. Each tab stores nodes, edges, viewport, and per-tab conversation context (`threadId` + `lastMessageId`). Storage adapter (`storageAdapter.ts`) detects environment:
- Desktop → `localStorage`
- SPCS → API backend
- Native App → `window.__SNOWFLAKE_NATIVE_APP__`

### Agent Client (`snowgram-agent-client.ts`, 435 lines)
Directly calls Cortex Agent REST API (`/api/v2/cortex/agent:run`) with a **hardcoded system prompt override** (`SNOWGRAM_SYSTEM_PROMPT`) that overrides the agent spec's instructions. This is documented as Gotcha #2 in `CLAUDE.md`. The client handles both SSE streaming and JSON fallback responses.

### Custom Node Types
- `CustomNode.tsx` — Standard Snowflake component node with icon + label
- `ShapeNode.tsx` — Geometric shape nodes
- `StickyNoteNode.tsx` — Annotation nodes
- `TextBoxNode.tsx` — Text overlay nodes

### Test Coverage
18 test files in `frontend/src/lib/__tests__/` covering:
- Color utilities, icon resolution, layout utilities
- Mermaid parsing and export
- Graph normalization
- Lane pipeline integration
- ELK layout utilities

---

## Backend + Snowflake State

### FastAPI Application (`backend/api/main.py`)
Endpoints:
- `GET /health` — Snowflake connection health
- `WS /ws/chat` — WebSocket for agent conversation (**stub: echoes messages, TODO**)
- `POST /api/diagram/generate` — Diagram generation (via routes)
- `POST /api/diagram/save` / `GET /api/diagram/load/{id}` — Persistence
- Icon management endpoints

**Note**: The WebSocket endpoint at line 158 is a **non-functional stub** — it echoes messages with `"Echo: {content}"` and has a `# TODO: Call Cortex Agent via REST API` comment. The frontend bypasses this entirely by calling the Cortex Agent REST API directly from `snowgram-agent-client.ts`.

### Agent Spec (`agent_spec_v5.yaml`, 240 lines)
- **Model**: `claude-sonnet-4-5`
- **Budget**: 90 seconds, 40,000 tokens
- **Tools**: 6 tools configured
  - `SNOWFLAKE_DOCS_CKE` (Cortex Search)
  - `WEB_SEARCH` (DuckDuckGo via external access integration `DDG_ACCESS`)
  - `SUGGEST_COMPONENTS_FOR_USE_CASE` (scalar UDF wrapper)
  - `GET_ARCHITECTURE_BEST_PRACTICE` (table function)
  - `GENERATE_MERMAID_FROM_COMPONENTS` (scalar UDF)
  - `VALIDATE_DIAGRAM_SYNTAX` (Python UDF)
- **Output**: Dual format — JSON spec (nodes+edges) + Mermaid fallback
- **Key constraint**: Agent instructions say "focus on topology, not layout" — the frontend handles positioning

### Snowflake Object Health

| Object | Status | Notes |
|--------|--------|-------|
| `SNOWGRAM_AGENT` | Deployed | Created 2026-02-17, on ACCOUNTADMIN |
| `COMPONENT_MAP_SV` | Active | 202 synonyms, AI extension enabled |
| `SNOWFLAKE_DOCS_SEARCH` | Active/Active | 15 rows, incremental refresh, arctic-embed-m-v1.5 |
| `COMPONENT_SYNONYMS` | 202 rows | Core synonym table backing SV |
| `ARCHITECTURE_TEMPLATES` | 14 rows | All 14 templates present |
| `COMPONENT_BLOCKS` | 42 rows | Building blocks for custom diagrams |
| `KNOWN_COMPONENT_CLASSIFICATIONS` | 131 rows | AI classification cache |
| `COMPONENTS` | 20 rows | Master component catalog |

**Empty tables** (likely unused or planned):
- `AGENT_LOGS` (0 rows), `SESSIONS` (0 rows), `USER_DIAGRAMS` (0 rows)
- `ARCHITECTURE_PATTERNS` (0 rows), `PATTERN_BLOCK_RELATIONSHIPS` (0 rows)
- Several NULL-row-count tables (views or recently created)

### ELK Diagram Renderer (`backend/elk_diagram/`, 891 lines)
A separate Python-based rendering pipeline:
```
Graph spec → ELK (Node.js subprocess) → positioned JSON → matplotlib PNG
```
Uses custom Snowflake icon PNGs, group colorings, and tiered edge styling. This is an exploratory, uncommitted server-side rendering path whose relationship to the two intentional tracks (CoCo skill and SnowGram GUI) is unclear.

### Test Infrastructure
| Test System | File | Lines | Purpose |
|------------|------|-------|---------|
| Agent test harness | `backend/tests/agent/run_tests.py` | ~200 | YAML-driven agent test runner |
| Test cases | `backend/tests/agent/test_cases.yaml` | 709 | 30+ test cases with validations |
| Unified convergence loop | `backend/tests/unified_convergence_loop.py` | 1,467 | Autonomous improvement loop |
| Visual eval passes | `backend/tests/visual/eval_passes.py` | 1,669 | 6-pass visual evaluation |
| Visual convergence | `backend/tests/visual/convergence_loop.py` | 565 | Visual feedback loop |
| Ralph loop | `backend/tests/visual/ralph_loop.py` | 570 | Named convergence variant |

The `AGENTS.md` describes an autonomous improvement loop with 6-pass evaluation (Components 25%, Connections 20%, Structure 15%, Layout 15%, Styling 15%, Badges 10%) and a decision tree for root cause analysis.

### CI/CD
GitHub Actions workflow (`.github/workflows/ci.yml`):
- Frontend: checkout → Node 20 → `npm ci` → type-check → lint → build
- Backend: (configuration present but not read in detail)
- Docker build workflow also present (`.github/workflows/docker-build.yml`)

### Docker
Multi-stage Dockerfile (`docker/Dockerfile`):
1. Frontend build (Node 18 Alpine)
2. Backend build (Python)
3. Production image
Plus `docker-compose.yml`, `nginx.conf`, `supervisord.conf`

---

## Risks & Gotchas

### Critical

1. **32 uncommitted files with 2005 insertions** — This is a significant amount of work-in-progress that could be lost. Includes changes across frontend, backend, skill, and tests.

2. **App.tsx is 4,792 lines** — Monolithic God Component. Any change risks cross-feature regressions. Should be decomposed into smaller components (canvas, chat panel, toolbar, etc.).

3. **Backend WebSocket is a stub** (`backend/api/main.py:158-200`) — The `/ws/chat` endpoint echoes messages. The frontend works around this by calling the Cortex Agent REST API directly from the client, meaning auth tokens (PAT) are exposed in the browser.

4. **System prompt override** (`frontend/src/lib/snowgram-agent-client.ts:67-118`) — The frontend sends its own `SNOWGRAM_SYSTEM_PROMPT` that overrides the agent spec instructions. Changes to `agent_spec_v5.yaml` may have no effect when using the frontend.

5. **Unclear ownership of `backend/elk_diagram/` renderer** — The dual-track design (CoCo skill + SnowGram GUI) is intentional and serves different user populations. However, a third rendering path exists in `backend/elk_diagram/` (891 lines, matplotlib-based PNG rendering via Node.js ELK subprocess). This renderer is entirely uncommitted (untracked `ARCHITECTURE.md`, `PLAN.md`, `README.md`, intermediate JSON files, and output PNGs). It is unclear whether this is being prototyped as: (a) a new server-side renderer for the GUI, (b) a rendering backend for the CoCo skill, or (c) a standalone experiment. Its uncommitted status and lack of integration with either track makes its role ambiguous.

### High

6. **Stale worktrees** — Two cursor worktrees exist (`WYvAi`, `YHdzT`) both pinned at the same old commit (`86357a5`). These consume disk space and could cause confusion.

7. **CORS wide open** (`backend/api/main.py:109-115`) — `allow_origins=["*"]` with a TODO to restrict for production.

8. **Agent runs on ACCOUNTADMIN** — The agent is owned by `ACCOUNTADMIN`. For production/sharing, it should use a dedicated role with least-privilege grants.

### Medium

9. **Low Cortex Search corpus** — `SNOWFLAKE_DOCS_SEARCH` has only 15 rows. The CKE service (`SNOWFLAKE_DOCUMENTATION.SHARED.CKE_SNOWFLAKE_DOCS_SERVICE`) is used in the agent spec instead, which has 41K+ pages.

10. **Dual CSS-in-JS** — Both `@emotion/react` + `@emotion/styled` (for MUI) and `styled-components` are dependencies. This adds ~200KB to the bundle.

11. **Empty tables** — 10+ tables with 0 rows (`AGENT_LOGS`, `SESSIONS`, `USER_DIAGRAMS`, `ARCHITECTURE_PATTERNS`, etc.) suggest planned features that were never implemented.

12. **`backend/venv` is 693 MB** — Committed to the repo via find (though gitignored). The venv includes the full Snowflake connector.

---

## Recommendations / Next Actions

### Immediate (Uncommitted Work)
1. **Commit the 32 modified files** — Group into logical commits: (a) frontend layout changes, (b) backend ELK renderer + icons, (c) test infrastructure updates, (d) CoCo skill updates.
2. **Clean up stale worktrees** — `git worktree remove` the two abandoned cursor worktrees.

### Short-Term (Architecture)
3. **Decompose App.tsx** — Extract into `<Canvas />`, `<ChatPanel />`, `<Toolbar />`, `<ExportDialog />` etc. This is the highest-impact refactor.
4. **Implement the WebSocket backend** or switch to a proper backend-proxied agent call — keeping PAT tokens in the browser is a security concern.
5. **Clarify `backend/elk_diagram/` ownership** — The dual-track design (CoCo skill for local-only use, SnowGram GUI for Snowflake-deployed use) is intentional and should be preserved. However, `backend/elk_diagram/` (matplotlib renderer) needs a decision: merge it into the CoCo skill as a server-side option, adopt it as the GUI's server renderer, or drop it. Also: document the dual-track design intent in `CLAUDE.md` and `AGENTS.md` so future contributors understand the two paths are deliberate, not accidental divergence.

### Medium-Term (Quality)
6. **Add integration tests** — The test infrastructure is extensive but appears manually run. Wire the agent test harness into CI.
7. **Restrict agent ownership** — Move from `ACCOUNTADMIN` to a dedicated `SNOWGRAM_ADMIN` role.
8. **Populate empty tables** — Either implement `AGENT_LOGS`/`SESSIONS`/`USER_DIAGRAMS` or drop the unused tables.

### Low Priority
9. Remove `styled-components` dependency if unused.
10. Clean up the `archive/` directory and consolidate documentation (many `.md` files at root level).

---

## Validation Footnotes

This report's quantitative claims (HEAD `7a16fb6`, 119 commits, 26 modified + 12 untracked files, 4,792-line `App.tsx`, deployed `claude-opus-4-6`, 16 distinct UDFs in CORE, 31 tables incl. BENCHMARK schema, 13 stashes, etc.) were spot-checked by a separate validator agent against the live filesystem and live Snowflake (`DESCRIBE AGENT`, `SHOW FUNCTIONS`, `git log/status`). Where the file contents and the deployed state disagree, both are reported.
