---
name: snowflake-architecture-diagram-connected-ui
description: "Connected-UI mode: hand off to the live SnowGram frontend at localhost:3002 for full conversational refinement, multi-tab, per-tab thread state."
parent_skill: snowflake-architecture-diagram
---

# Connected-UI mode

Defers to the live SnowGram Next.js frontend at `localhost:3002` (backed by the FastAPI service at `localhost:8082`) for the full ReactFlow + ELK rendering experience and multi-tab conversational refinement.

This mode does NOT spawn the lightweight viewer. The user gets pixel-identical SnowGram output, but at the cost of two running processes.

## Prerequisites

- Connected-CLI prerequisites (connection + agent reachable)
- SnowGram backend running at `http://localhost:8082`
- SnowGram frontend running at `http://localhost:3002`
- `frontend/.env.local` populated with a valid `SNOWFLAKE_PAT` for the active account
- `backend/.env` populated with connection details

## Workflow

### Step 1: Probe both servers

```bash
curl -s -o /dev/null -w "%{http_code}" --max-time 1 http://localhost:8082/health || true
curl -s -o /dev/null -w "%{http_code}" --max-time 1 http://localhost:3002/ || true
```

| Backend | Frontend | Action |
|---|---|---|
| 200 | 200 | Continue to Step 2 |
| 200 | down | Print frontend start command, stop |
| down | 200 | Print backend start command, stop |
| down | down | Print both start commands, stop |

**Do NOT auto-start servers.** They may need credentials, port adjustments, or other manual setup.

Start commands to print:

```bash
# Backend (terminal 1)
cd <repo>/backend
source venv/bin/activate
python -m api.main

# Frontend (terminal 2)
cd <repo>/frontend
npm run dev
```

**⚠️ STOP**: tell the user which servers are down and what to run, then exit. They will resume the skill once both are up.

### Step 2: Optional pre-seed via agent

If the user provided a prompt, invoke the agent once via CLI to pre-seed the canvas before opening the browser:

```bash
cortex agents run SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT "<user's prompt>"
```

Capture the response and POST it to the running backend so the frontend has a default tab populated:

```bash
curl -X POST http://localhost:8082/api/diagram/seed \
  -H "Content-Type: application/json" \
  -d '{"mermaid": "<extracted>", "title": "<short>"}'
```

If the seed endpoint is not available (older backend), skip — user can paste the prompt in the frontend chat directly.

### Step 3: Hand off to the frontend

```bash
open http://localhost:3002        # macOS
# xdg-open / start on Linux / Windows
```

Tell the user the skill is done and they should continue refinement in the browser. The frontend handles:

- Multi-tab diagrams with per-tab threadId
- Conversational refinement via the chat panel
- Native ReactFlow + ELK layout (highest visual fidelity)
- Built-in export menu

## Tools

| Tool | Used for |
|---|---|
| `curl --max-time 1 http://localhost:<port>/...` | Server probes |
| `cortex agents run SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT "<q>"` | Optional pre-seed |
| `open` / `xdg-open` / `start` | Hand off to browser |

## Stopping points

- ✋ After Step 1 if either server is down: print start commands, exit
- ✋ After Step 2 if pre-seed succeeded: confirm before opening browser
- ✋ End of Step 3: skill done, user takes over in the browser

## Output

- Browser tab at `http://localhost:3002/` with the live SnowGram UI
- Optional pre-seeded diagram in the first tab

## Failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| Both probes return down | Servers not started | Print start commands, exit (do NOT auto-start) |
| Backend up, frontend down | Frontend dev server crashed | Show frontend start command + tail of `frontend/.next/trace` if available |
| Frontend up, backend down | Backend crashed | Show backend start command + check `backend/.env` exists |
| Pre-seed POST returns 404 | Seed endpoint not implemented in this backend version | Skip pre-seed; user pastes prompt in frontend |
| 500 from agent in frontend | PAT expired in `frontend/.env.local` | Surface the exact error and instruct user to refresh PAT |

## When to choose this mode vs others

| User goal | Use |
|---|---|
| Quick exportable diagram | `standalone` |
| Single-shot agent generation | `connected-cli` |
| Iterative refinement with chat | **`connected-ui`** |
| Multi-tab editing session | **`connected-ui`** |
| Full visual fidelity | **`connected-ui`** |
| Diagram of existing data flow | `from-lineage` |
