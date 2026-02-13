# SnowGram Project

SnowGram is a Snowflake architecture diagram generator using Cortex Agents.

## Architecture

- **Backend**: Snowflake (SNOWGRAM_DB, connection: `se_demo`)
- **Frontend**: React + TypeScript + React Flow + ELK.js (`/frontend`)
- **Agent**: `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT`

## Agent Tools

| Tool | Purpose |
|------|---------|
| `map_component` | Look up known Snowflake components |
| `classify_component` | AI-classify unknown components via CLASSIFY_COMPONENT UDF |
| `cortex_search` | Search documentation/best practices |

## flowStage System

Agent returns layout metadata for ELK.js:
- `source` (0) → `ingest` (1) → `raw` (2) → `transform` (3) → `refined` (4) → `serve` (5) → `consume` (6)

Frontend: `frontend/src/lib/elkLayout.ts` uses `flowStageOrder` for automatic layout.

## Testing

```bash
cd backend/tests/agent

# Quick smoke tests (~2 min) - DEFAULT
python run_tests.py

# Instant validation with cached responses
python run_tests.py --cached --all

# Test specific category
python run_tests.py -c flowstage   # flowstage|tools|e2e|smoke|core

# Re-run only failed tests
python run_tests.py --failed

# Full suite (~13 min)
python run_tests.py --all --report

# List all tests
python run_tests.py --list
```

### Test Categories
- `smoke` (3 tests, ~2 min) - Run frequently during development
- `flowstage` (2 tests) - ELK.js layout metadata validation
- `tools` (4 tests) - Agent tool coverage
- `e2e` (2 tests) - Full integration

### Development Workflow
1. **Validation logic changes** → `--cached --all` (instant)
2. **Agent changes** → smoke tests, then category
3. **Before commit** → `--all --report`
4. **Fix failures** → `--failed`

## Key Files

| File | Purpose |
|------|---------|
| `backend/tests/agent/run_tests.py` | Test harness |
| `backend/tests/agent/test_cases.yaml` | Test definitions |
| `frontend/src/lib/elkLayout.ts` | ELK.js automatic layout |
| `frontend/src/App.tsx` | Main React app |
