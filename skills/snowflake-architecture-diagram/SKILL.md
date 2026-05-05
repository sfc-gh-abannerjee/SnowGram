---
name: snowflake-architecture-diagram
description: "Generate, view, and export high-quality Snowflake architecture diagrams. Works in two modes: STANDALONE (no Snowflake deployment required, uses bundled templates + local Mermaid composer) and CONNECTED (uses deployed SNOWGRAM_AGENT for full conversational generation, or reverse-engineers diagrams from live lineage). Use for: architecture diagram, snowflake architecture, medallion, lakehouse, data pipeline diagram, streaming pipeline, draw architecture, visualize pipeline, diagram my data flow, lineage diagram, snowgram."
---

# Snowflake Architecture Diagram

Generate professional Snowflake architecture diagrams with one of four modes. The skill auto-detects what is available and routes to the right sub-skill. Output is always exportable (Mermaid source, SVG, PNG) and renders in a self-contained viewer that runs locally.

## When to load

Trigger this skill when the user wants to:

- Create a Snowflake architecture diagram (medallion, streaming, IoT, security, ML, customer 360, governance, etc.)
- Visualize a real data pipeline (from lineage of an existing table)
- Export a diagram for slides, docs, or sharing
- Refine or iterate on a previously generated diagram

## Prerequisites

| Mode | Requires |
|------|----------|
| `standalone` | Python 3 + a modern browser. **No Snowflake connection needed.** |
| `connected-cli` | Active `cortex` connection + `SNOWGRAM_AGENT` deployed |
| `connected-ui` | Connected-CLI prerequisites + frontend at `localhost:3002` + backend at `localhost:8082` |
| `from-lineage` | Active `cortex` connection with lineage access (any account) |
| `bootstrap` | Active connection with privileges to deploy SnowGram into a target DB |

## Workflow

### Step 1: Mode detection

Run a 3-check probe in this exact order. Each check uses Cortex Code's built-in tooling — do not call raw SQL for detection.

```
1. cortex connections list
   → No connections? → STANDALONE_ONLY
   → At least one? Continue.

2. cortex agents list
   → SNOWGRAM_AGENT not present? → CONNECTED_NEEDS_BOOTSTRAP (offer bootstrap or fall to standalone)
   → SNOWGRAM_AGENT present? Continue.

3. cortex search object SUGGEST_COMPONENTS_FOR_USE_CASE
   → Function not visible to current role? → CONNECTED_NEEDS_GRANTS
   → Visible? → CONNECTED_CLI_READY
```

Optionally probe `localhost:3002` and `localhost:8082` (curl with 1s timeout) to detect `CONNECTED_UI_READY`.

If user explicitly asks "diagram from my table X" or mentions a fully-qualified object name, route to `from-lineage` regardless of probe result.

**⚠️ STOP**: Present detected mode(s) to the user. If multiple are available, ask which to use. Default precedence: explicit user request → `from-lineage` if a FQN was mentioned → `connected-ui` → `connected-cli` → `standalone`.

### Step 2: Load the chosen mode's sub-skill

Route to one of:

- `modes/standalone/SKILL.md` — bundled templates + local composer + viewer
- `modes/connected-cli/SKILL.md` — `cortex agents run SNOWGRAM_AGENT` + viewer
- `modes/connected-ui/SKILL.md` — verify both servers, hand off to `localhost:3002`
- `modes/from-lineage/SKILL.md` — `cortex lineage` + `cortex search table-details` → composer → viewer
- `modes/bootstrap/SKILL.md` — deploy SnowGram into a clean account, then route to `connected-cli`

### Step 3: Render

All non-handoff modes converge on the same viewer (`assets/viewer/`):

1. Mode writes `assets/viewer/state.json` with `{mermaid, title, source, citations[]}`
2. `assets/scripts/launch_viewer.sh` finds a free port (4380+), spawns `python3 -m http.server`, opens the browser
3. Viewer renders the Mermaid via vendored `mermaid.min.js` and exposes Download buttons for `.mmd`, `.svg`, `.png`

To stop the viewer: `assets/scripts/stop_viewer.sh` (reads PID file).

## Tools

This skill uses Cortex Code built-ins (no raw SQL except inside the snapshot extractor):

| Tool | Used by |
|------|---------|
| `cortex agents list / describe / run` | mode-detection, connected-cli |
| `cortex search object / table-details / docs / marketplace` | mode-detection, doc enrichment, from-lineage |
| `cortex semantic-views describe / ddl / get / query` | snapshot extractor, connected synonym lookup |
| `cortex lineage <fqn> --tree --distance N` | from-lineage |
| `cortex analyst query --view=COMPONENT_MAP_SV` | connected synonym lookup (alternative to agent) |
| `sql_execute` MCP / `snow sql` | snapshot extractor only |
| `assets/composer/composer.py` | local Mermaid composer (standalone, from-lineage) |
| `assets/scripts/launch_viewer.sh` / `stop_viewer.sh` | viewer lifecycle |

## Output

- A diagram rendered in the local viewer at `http://localhost:<port>/`
- Downloadable artifacts: `.mmd` (Mermaid source), `.svg` (vector), `.png` (raster)
- Citation drawer in viewer (when `cortex search docs` returned results)
- For `connected-ui`: a seeded diagram in the live frontend at `localhost:3002`
- For `bootstrap`: a fully deployed SnowGram instance in the target account

## Stopping points

- ✋ After mode detection (Step 1) — confirm chosen mode
- ✋ Before viewer launch — confirm template / component selection
- ✋ Before bootstrap — confirm target DB / schema / warehouse / role
- ✋ On agent response missing Mermaid — confirm fallback to standalone composer

## Visual fidelity note

The bundled lightweight viewer renders Mermaid via `mermaid.min.js` with Snowflake-aligned styling. It approximates — but does not exactly match — the live SnowGram frontend's tier-aware ReactFlow + ELK rendering. For pixel-identical output to the live frontend, use `connected-ui` mode.

## Installation

This skill lives in the SnowGram repo at `skills/snowflake-architecture-diagram/`. To make it discoverable user-globally:

```bash
./skills/snowflake-architecture-diagram/install.sh
```

This symlinks the skill into `~/.snowflake/cortex/skills/snowflake-architecture-diagram/`.

## Snapshot freshness

Bundled templates and component blocks are snapshots from a deployed SnowGram instance. To refresh against your account:

```bash
python3 ./skills/snowflake-architecture-diagram/assets/scripts/snapshot.py --connection <name>
```

Snapshot metadata is recorded at `assets/_snapshot_meta.json` (timestamp, source account, sha256 of source SQL files).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Skill not discovered | Run `install.sh`; verify symlink at `~/.snowflake/cortex/skills/` |
| Viewer port collision | `stop_viewer.sh` then re-run; launcher discovers next free port |
| Standalone synonym miss | Composer falls back to nearest match; refine prompt or list components explicitly |
| `cortex agents run` returns no Mermaid | Skill auto-falls-through to standalone composer using agent's textual hint |
| `from-lineage` finds no upstream | Confirm object FQN; lineage requires the user to have access |
