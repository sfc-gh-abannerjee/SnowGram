# Runbook: Add the Layout Engine to the Cortex Agent (Snowsight Workspace)

Drop-in instructions for **Cortex Code running in a Snowsight Workspace** to
add the SnowGram layout engine to an **existing**
`SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT`. The agent already exists — this **updates
it in place** (no drop / recreate). Every step begins with a *check*; only act
when the check shows the object is missing or out of date. Idempotent.

This runbook assumes **this folder is the workspace root** — i.e. you uploaded
the `layout-engine/` folder and opened it in the Workspace. All file paths are
relative to that root. No file outside this folder is needed; the agent's
current configuration is read live with `DESCRIBE AGENT`.

Runtime notes for Snowsight:
- You are already bound to one account — there is no connection to switch.
- Steps are **pure SQL** plus reading two local files (`deploy/LAYOUT_DIAGRAM.sql`,
  `deploy/AGENT_TOOL_SNIPPET.yaml`). No `node`, no CLI, no shell.
- `CREATE FUNCTION` and `ALTER AGENT` are **mutating** — if autonomy/approval
  gating is on, Cortex Code may pause for confirmation. Approve to proceed.

Author: Abhinav Bannerjee

---

## 0. Confirm context

```sql
SELECT CURRENT_ACCOUNT() AS account, CURRENT_ROLE() AS role, CURRENT_WAREHOUSE() AS wh;
```
Confirm `account` is the **target** account and `role` is the role you intend
to deploy with. Working values used below:
- UDF location: `SNOWGRAM_DB.CORE`
- Agent: `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT`
- Warehouse for the tool: `COMPUTE_WH` (substitute if different)

Files in this folder:
- `deploy/LAYOUT_DIAGRAM.sql` — the UDF
- `deploy/AGENT_TOOL_SNIPPET.yaml` — the tool delta to merge into the live spec
- `README.md` — contract + rationale
- `build_udf.mjs`, `*.mjs` — only if regenerating the UDF (needs Node; **not**
  required here since the SQL is pre-generated)

---

## 1. Privilege preflight (fail fast before mutating)

```sql
-- Objects present?
SHOW DATABASES LIKE 'SNOWGRAM_DB';
SHOW SCHEMAS  LIKE 'CORE' IN DATABASE SNOWGRAM_DB;
SHOW WAREHOUSES LIKE 'COMPUTE_WH';
SHOW AGENTS LIKE 'SNOWGRAM_AGENT' IN SCHEMA SNOWGRAM_DB.AGENTS;

-- Grants the current role holds on the objects we mutate:
SHOW GRANTS ON SCHEMA SNOWGRAM_DB.CORE;                         -- need CREATE FUNCTION (or OWNERSHIP)
SHOW GRANTS ON AGENT  SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;        -- need MODIFY or OWNERSHIP
SHOW GRANTS TO ROLE IDENTIFIER(CURRENT_ROLE());                 -- need USAGE on DB/schema + warehouse
```

| Requirement | Why |
|---|---|
| `CREATE FUNCTION` on `SNOWGRAM_DB.CORE` (or OWNERSHIP) | deploy the UDF (§2) |
| `MODIFY` or `OWNERSHIP` on the agent | update the spec (§5) |
| `USAGE` on `SNOWGRAM_DB`, `CORE`, `AGENTS`, and the warehouse | run everything |
| `COMPUTE_WH` exists + can resume | UDF execution_environment |

If any object/privilege is missing, **stop** and report it — do not start
mutating with a partial setup. If `SNOWGRAM_AGENT` is missing, this runbook
does not apply (it assumes the agent exists).

---

## 2. Deploy the UDF (only if missing or stale)

Check:
```sql
SHOW USER FUNCTIONS LIKE 'LAYOUT_DIAGRAM' IN SCHEMA SNOWGRAM_DB.CORE;
```
If absent: open `deploy/LAYOUT_DIAGRAM.sql`, read its single
`CREATE OR REPLACE FUNCTION SNOWGRAM_DB.CORE.LAYOUT_DIAGRAM(...)` statement, and
execute it.

### 2b. Verify it compiles AND runs
```sql
SELECT SNOWGRAM_DB.CORE.LAYOUT_DIAGRAM(
  '{"nodes":[{"id":"a","label":"S3","componentType":"s3","zone":"Sources"},
             {"id":"b","label":"Bronze","componentType":"table","zone":"Bronze Layer"}],
    "edges":[{"from":"a","to":"b"}]}'
);
```
Expect JSON with `nodes:[{x,y,w,h}]`, `edges:[{from,to,d,points}]`, `zones`,
`width`, `height`. If it returns `{"error":...}` or won't compile, **stop** and
report — the bundled JS hit a Snowflake JS-engine limitation. Do not touch the
agent until this returns valid layout JSON.

---

## 3. Capture the agent's CURRENT live spec (base + backup)

In-place update **replaces the entire spec** (omitted fields are dropped), so
start from the live spec and merge into it.

```sql
DESCRIBE AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;
```
Save the `agent_spec` value to a local file in this folder, e.g.
`deploy/_agent_live.json` (the editable base) and copy it to
`deploy/_agent_backup.json` (the rollback artifact).

---

## 4. Merge the tool into the captured live spec

Open `deploy/AGENT_TOOL_SNIPPET.yaml`. **First check** whether the live spec
already has `LAYOUT_DIAGRAM` under `tools` / `tool_resources` — if present and
correct, skip to §6.

Otherwise merge the snippet's three pieces into the captured live spec:
1. `tools_entry` → append to the spec's `tools:` array.
2. `tool_resources_entry` → add the `LAYOUT_DIAGRAM` key under `tool_resources:`.
3. `orchestration_instruction` → append the sentence to
   `instructions.orchestration` (so the agent actually calls the tool).

Keep every other field unchanged — the merged document must be the **complete**
spec, not just the delta.

---

## 5. Update the agent IN PLACE (no drop / recreate)

```sql
ALTER AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT
  MODIFY LIVE VERSION SET SPECIFICATION =
$$
<full merged spec from §4 — YAML or JSON>
$$;
```
- Spec may be YAML or JSON; max 100,000 bytes.
- It **completely replaces** the prior spec — that's why §4 merges into the
  full live spec.
- Do **not** `DROP` the agent (that loses grants and history).

---

## 6. Verify end-to-end

```sql
DESCRIBE AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;   -- LAYOUT_DIAGRAM now in tools + tool_resources
```
Send a test prompt (e.g. *"Create a medallion lakehouse"*) and confirm the
trace shows a `LAYOUT_DIAGRAM` tool call and the response includes positioned
layout JSON (`nodes` with `x/y`, `edges` with `d`).

---

## 7. Rollback (in place)

```sql
ALTER AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT
  MODIFY LIVE VERSION SET SPECIFICATION =
$$
<spec from deploy/_agent_backup.json>
$$;
```
The UDF is harmless to leave deployed; drop only if required:
`DROP FUNCTION IF EXISTS SNOWGRAM_DB.CORE.LAYOUT_DIAGRAM(VARCHAR);`

---

## Ordering (critical)

Deploy + verify the UDF (**§2**) **before** updating the agent (**§5**) — the
spec references `SNOWGRAM_DB.CORE.LAYOUT_DIAGRAM`, so the function must exist
first.
