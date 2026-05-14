---
name: snowflake-architecture-diagram-standalone
description: "Standalone mode: generate Snowflake architecture diagrams with no Snowflake connection required. Default path is from-scratch composition informed by SnowflakeProductDocs and SME-skill consultation; the 14 bundled templates are FALLBACKS used only when a prompt cleanly matches a known reference architecture."
parent_skill: snowflake-architecture-diagram
---

# Standalone mode

Generate exportable Snowflake architecture diagrams without needing a deployed SnowGram agent or any Snowflake connection. The default path composes a fresh diagram from `flow_builder` informed by `cortex search docs` and Snowflake-expert SME skills. The 14 bundled reference-architecture templates serve as fallbacks for prompts that cleanly match a known pattern (e.g. "medallion lakehouse with bronze/silver/gold").

**Design rule** (enforced by the rule store):
> Templates are FALLBACKS, not the default generation path. Generate from-scratch (rich-state authoring) when the prompt does not closely match a known template pattern. Only fall back to a template when the prompt's intent maps cleanly onto one of the 14 reference architectures, AND in that case still apply prompt-driven customizations rather than emitting the template verbatim.

## Path resolution (do this once)

This sub-skill uses `$SKILL_DIR/...` paths. Resolve them by sourcing the canonical helper:

```bash
source "<SKILL_BASE_DIR>/assets/scripts/skill_paths.sh"
# Sets $SKILL_DIR, $TEMPLATES_DIR, $COMPOSER_DIR, $VIEWER_DIR, $SCRIPTS_DIR, $STATE_FILE.
```

For Python helpers, import `assets/scripts/skill_paths.py` analogously. The parent SKILL.md shows the importlib pattern.

## Workflow

### Step 1 — Gather domain knowledge (PRIMARY, not optional)

Quality of the rendered diagram depends on having current Snowflake best-practice context BEFORE composition. Skip this step ONLY for trivial / one-off requests; for any production-quality diagram, do all three sub-steps.

#### 1a. Detect pipeline type

```bash
PIPELINE_TYPE=$(python3 "$COMPOSER_DIR/intent_router.py" --detect-type "<user prompt>" | python3 -c "import sys,json;print(json.load(sys.stdin)['pipeline_type'])")
```

`PIPELINE_TYPE` is one of: `medallion | streaming | iot | batch | security | generic`.

#### 1b. Run targeted documentation queries

```bash
python3 "$COMPOSER_DIR/intent_router.py" --queries-for "$PIPELINE_TYPE"
# → 3 queries to feed cortex search docs
```

Then run each:

```bash
cortex search docs "<query 1>"
cortex search docs "<query 2>"
cortex search docs "<query 3>"
```

Collect URLs + titles + relevant excerpts.

#### 1c. Invoke Snowflake-expert SME skills

Always invoke `snowflake-best-practices`. Then invoke 1–2 type-specific skills based on `PIPELINE_TYPE`:

| pipeline_type | Type-specific skills (max 2) |
|---|---|
| medallion / batch | `dynamic-tables`, `dbt-projects-on-snowflake` |
| streaming / iot | `snowpipe-streaming`, `dynamic-tables` |
| security / governance | `data-governance`, `network-security` |
| ml / customer_360 | `machine-learning`, `cortex-ai-function-studio` |
| iceberg / hybrid | `iceberg` |
| serverless | `deploy-to-spcs` |
| financial / fraud | `snowpipe-streaming`, `dynamic-tables` |
| analytics_embedded | `snowflake-apps`, `snowflake-notebooks` |
| generic | `snowflake-best-practices` only |

Invoke each via the Skill tool. Read each skill's recommendations.

#### 1d. Synthesize the knowledge pack

Write the gathered guidance into `/tmp/kp_<run-id>.json` matching this schema:

```jsonc
{
  "pipeline_type": "medallion",
  "doc_citations": [
    {"url": "https://docs.snowflake.com/...", "title": "...", "excerpt": "..."}
  ],
  "best_practice_directives": [
    "Prefer Dynamic Tables over Streams+Tasks for declarative refresh",
    "TARGET_LAG = DOWNSTREAM for chained DTs",
    "Separate WH per workload (load / transform / BI)"
  ],
  "component_overrides": {
    "ingestion": "SNOWPIPE_STREAMING",
    "transformation": "DYNAMIC_TABLE",
    "serving": "DYNAMIC_TABLE"
  },
  "annotations": [
    {"object_type": "DYNAMIC_TABLE", "note": "TARGET_LAG = DOWNSTREAM"}
  ]
}
```

Valid `component_overrides` keys: `source | ingestion | raw_storage | transformation | curated_storage | serving | consumption | security`.

✋ **STOP**: confirm the knowledge pack with the user (or briefly summarize what you gathered) before rendering. This catches misinterpretation early and is much cheaper than re-rendering.

### Step 2 — Render

A single command does the rest: routing → baseline state → knowledge-pack overlay → prompt customization → self-contained HTML.

```bash
python3 "$SCRIPTS_DIR/diagram_from_prompt.py" \
    "<user prompt verbatim>" \
    --knowledge-pack /tmp/kp_<run-id>.json \
    --out <user-requested-path>.html
```

Add `--title "<override>"` to force a custom title. Add `--no-docs` to skip live `cortex search docs` enrichment in the from-scratch path (use cached/default specs only — much faster but less authoritative).

The output is a self-contained ~3 MB HTML with the bundled viewer (custom orthogonal connector routing, line jumps, hover-traceable connections, zone categorization legend), all Snowflake icons baked as data URIs, and the rich state JSON embedded. No server, no internet required to view.

### Step 3 — (Optional) Live viewer for iteration

If the user says "show me / open the viewer / let me iterate live":

```bash
# Write state.json into the viewer's expected location
cat > "$STATE_FILE" <<EOF
$(diagram_from_prompt.py "<prompt>" --out - --knowledge-pack /tmp/kp.json | grep -oE '"state":[[:space:]]*\{.*\}' | sed 's/^"state":[[:space:]]*//')
EOF

# Or extract the state JSON another way that's convenient.
# Then launch:
"$SCRIPTS_DIR/launch_viewer.sh"
```

The viewer opens at `http://localhost:<port>/`. User can download `.mmd`, `.svg`, `.png` from the viewer header.

## How `diagram_from_prompt.py` decides the path

| Decision | Trigger | What gets rendered |
|---|---|---|
| `template` | Prompt scores ≥ 2 distinct keyword phrases for one template AND no tie | Template's `RICH_STATE` field, then knowledge-pack overlay, then prompt customizations |
| `from_scratch` | Default — when no template scores ≥ 2 | `flow_builder.build_flow_from_docs()` produces fresh `{nodes, edges, zones}` for the detected pipeline_type, then overlay + customizations |
| `compose` | Multi-source prompt (≥ 2 source classes) AND compose plan has ≥ 4 components | `flow_builder.build_flow_from_block_ids()` from the router-supplied list |

Templates are NEVER emitted verbatim. Even on the template path, the knowledge pack and the prompt customizer get to add/swap nodes (e.g., user mentions "Tableau" → consumption swaps to Tableau; user mentions "Kafka" → Kafka source added; user mentions "PII / masking" → masking + RLS policy nodes added if missing).

## Iteration

If the user wants to refine ("add Kafka before Bronze", "swap to a different template"):

- **Template swap**: re-run with `--prefer-template` to bias toward template path, or add the template's keyword phrases to the prompt
- **Add components**: just include them in the prompt — the customizer will add them
- **Best-practice overrides**: edit the `knowledge_pack.json`'s `component_overrides` and re-render
- **Swap mode**: route to `connected-cli` if the user wants conversational refinement

## Tools

| Tool | Used for |
|---|---|
| `python3 $SCRIPTS_DIR/diagram_from_prompt.py "<prompt>" --out <out.html>` | **One-shot prompt → HTML.** Default tool. |
| `python3 $COMPOSER_DIR/intent_router.py --detect-type "<prompt>"` | Pipeline-type detection (Step 1a) |
| `python3 $COMPOSER_DIR/intent_router.py --queries-for <type>` | Docs queries to feed `cortex search docs` (Step 1b) |
| `cortex search docs "<query>"` | Documentation enrichment (Step 1b) |
| Skill tool → `snowflake-best-practices` + 1–2 type-specific | SME consultation (Step 1c) |
| `$TEMPLATES_DIR/<id>.json` | 14 reference architectures (with `RICH_STATE` field) |
| `python3 $COMPOSER_DIR/composer.py` | Lower-level Mermaid composer from BLOCK_IDs (rarely needed directly) |
| `python3 $SCRIPTS_DIR/render_static.py --state <s.json> --out <out.html>` | Render an existing state.json (lower-level than `diagram_from_prompt.py`) |
| `$SCRIPTS_DIR/launch_viewer.sh` | Spawn live viewer + open browser |
| `$SCRIPTS_DIR/stop_viewer.sh` | Stop viewer |

## Stopping points

- ✋ After Step 1d: confirm knowledge pack with user
- ✋ After Step 2 (render): user reviews the HTML
- ✋ Before iteration: confirm direction (refine in place, swap, escape to connected mode)

## Output

- Self-contained `.html` (~3 MB): ships the bundled viewer + state + icons; works offline, no server
- Or browser tab at `http://localhost:<port>/` if launched live
- Downloadable artifacts via header buttons: `.mmd`, `.svg`, `.png`
- Citations panel showing `cortex search docs`-sourced URLs
- Zone categorization legend (External / Ingestion / Snowflake / Business Outcome)

## Stale snapshot warning

If `$SKILL_DIR/assets/_snapshot_meta.json` is older than 30 days OR the `source_sql_sha256` no longer matches the SQL files in the SnowGram repo, surface a one-line warning:

> Snapshot is N days old. Run `python3 $SCRIPTS_DIR/snapshot.py -c <connection>` to refresh.

Continue rendering anyway.
