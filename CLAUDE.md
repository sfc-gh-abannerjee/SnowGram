# SnowGram

Snowflake architecture diagram generator using Cortex Agents.

## Quick Reference

| Key | Value |
|-----|-------|
| Connection | `se_demo` |
| Database | `SNOWGRAM_DB` |
| Agent | `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT` |
| Warehouse | `COMPUTE_WH` |
| Spec | `agent_spec_v4.yaml` |
| Frontend | v1.1.0 (Next.js 15.5.12) |

## Commands

```bash
# Tests
cd backend/tests/agent
python run_tests.py                    # Smoke (~2 min)
python run_tests.py --cached --all     # Instant validation
python run_tests.py --all --report     # Full suite (~13 min)

# Frontend
cd frontend && npm run dev             # Port 3002
npm run build                          # Production build
npm audit                              # Check vulnerabilities (should be 0)

# Deploy agent
snow cortex agent create-spec agent_spec_v4.yaml --connection se_demo
```

## Key Files

| File | Purpose |
|------|---------|
| `agent_spec_v4.yaml` | Agent definition with tools |
| `backend/snowgram/core/suggest.py` | Component suggestion UDF |
| `frontend/src/lib/snowgram-agent-client.ts` | Cortex agent API client |
| `frontend/src/lib/elkLayout.ts` | ELK auto-layout engine |
| `frontend/src/App.tsx` | Main React app (4,600+ LOC) |
| `frontend/BUG_AUDIT.md` | Bug fixes and security audit |
| `frontend/DEPENDENCIES.md` | npm overrides documentation |
| `CHANGELOG.md` | Version history |

## Layout Rules

```
flowStageOrder: source(0) → ingest(1) → raw(2) → transform(3) → refined(4) → serve(5) → consume(6)
```

- External sources (Kafka, S3) render LEFT of Snowflake boundary
- Nodes partition by `cloudProvider`: `snowflake` vs `aws`/`kafka`

## Gotchas

1. **UDTFs + Cortex Agents** — `system_execute_sql` with `:param` binding fails silently. Wrap UDTFs in scalar UDFs returning JSON.

2. **Frontend prompts override tools** — System prompts with example diagrams cause agent to copy templates. Only specify output format, not examples.

3. **Tests pass when tools fail** — Agent falls back to training data. Add `tool_succeeded` validation to tests.

4. **Agent tool type** — Use `type: "function"` (not `cortex_tool`) for custom SQL-based tools.

5. **App.tsx stale closures** — Fixed in v1.1.0. All `useCallback` dependencies are now correct. See `frontend/BUG_AUDIT.md` for details.

6. **npm race conditions** — Never run multiple `npm install` in parallel (e.g., via background agents). Causes ENOTEMPTY errors.

## Recent Changes (v1.1.0 - 2026-02-15)

- **17 bugs fixed** - Stale closures, race conditions, SVG export, duplicate nodes
- **8 vulnerabilities → 0** - Next.js 15, mermaid 11, npm overrides
- **~400 LOC removed** - Dead code cleanup
- **Docs added** - CHANGELOG, BUG_AUDIT, DEPENDENCIES

---

**Detailed docs**: See `docs/AI_POWERED_DIAGRAM_ARCHITECTURE.md` for system design, `frontend/BUG_AUDIT.md` for bug details.
