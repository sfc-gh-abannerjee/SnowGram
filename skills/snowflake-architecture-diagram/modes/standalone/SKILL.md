---
name: snowflake-architecture-diagram-standalone
description: "Standalone mode: generate Snowflake architecture diagrams with no Snowflake connection required. Uses bundled templates + local Mermaid composer + cortex search docs for citations."
parent_skill: snowflake-architecture-diagram
---

# Standalone mode

Generate exportable Snowflake architecture diagrams without needing a deployed SnowGram agent or any Snowflake connection. Uses 14 bundled templates + a Python composer that mirrors the deployed Mermaid generation logic byte-for-byte.

## Path resolution (do this once)

This sub-skill uses `$SKILL_DIR/...` paths. Resolve them by sourcing the canonical helper. The absolute path to that helper is `<SKILL_BASE_DIR>/assets/scripts/skill_paths.sh`, where `<SKILL_BASE_DIR>` is the path the skill loader prints as `Base directory for this skill:` when this skill is loaded (or the path returned by `cortex skill list` for `snowflake-architecture-diagram`).

```bash
source "<SKILL_BASE_DIR>/assets/scripts/skill_paths.sh"
# Now: $SKILL_DIR, $TEMPLATES_DIR, $COMPOSER_DIR, $VIEWER_DIR, $SCRIPTS_DIR,
#      $STATE_FILE are all set. See the parent SKILL.md for the full table.
```

For Python helpers, import `assets/scripts/skill_paths.py` analogously. The parent SKILL.md shows the importlib pattern.

## Workflow

### Step 1: Match prompt to a template OR resolve via docs

**Goal:** decide whether the user wants a canned reference architecture, a custom component list, or a docs-driven pipeline resolution.

**Preferred path — docs-driven resolution (recommended for new diagrams):**

```bash
python3 "$COMPOSER_DIR/intent_router.py" --docs "<user's prompt verbatim>"
```

This queries SnowflakeProductDocs to determine current best-practice components for the pipeline type (medallion, streaming, IoT, batch, security). Returns a pipeline spec with Dynamic Tables for transformation/serving layers by default — aligned with Snowflake's latest guidance.

```jsonc
{"type": "docs_driven", "pipeline_type": "medallion",
 "spec": [{"stage": "source", "object_type": "S3", "label": "Cloud Storage", ...}, ...],
 "confidence": 0.8, "rationale": "..."}
```

**Alternative — legacy routing via the intent router (backward-compatible):**

```bash
python3 "$COMPOSER_DIR/intent_router.py" "<user's prompt verbatim>"
```

The router returns one of two decisions as JSON:

```jsonc
// Single-template path (clear, single-source prompt)
{"type": "template", "template_id": "MEDALLION_LAKEHOUSE", "confidence": 0.6, "rationale": "..."}

// Compose path (multi-source or ambiguous prompt)
{"type": "compose", "block_ids": ["S3_BUCKET_BLOCK", "KAFKA_CONNECTOR_BLOCK", ...],
 "confidence": 0.66, "rationale": "...", "covered_terms": [...]}
```

The router automatically detects multi-source prompts (e.g. "S3 and Kafka", "Snowpipe and Iceberg") and falls into compose mode because no single canned template covers multiple source classes. It also handles all unambiguous single-template prompts. Use this in preference to manual keyword matching — it produces the right routing for prompts the keyword table alone would mis-fit.

**Manual fallback — keyword routing table (only if the router is unavailable):**

| Keywords (any) | Template ID |
|---|---|
| medallion, bronze/silver/gold (with Kafka/S3/external) | `MEDALLION_LAKEHOUSE` |
| medallion, snowflake-only, no external | `MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY` |
| streaming, kafka, dynamic tables, real-time | `STREAMING_DATA_STACK` |
| security, SIEM, log analytics | `SECURITY_ANALYTICS` |
| customer 360, CDP | `CUSTOMER_360` |
| ML, machine learning, features, model registry | `ML_FEATURE_ENGINEERING` |
| batch, ETL, data warehouse, star schema | `BATCH_DATA_WAREHOUSE` |
| IoT, sensor, edge, MQTT | `REALTIME_IOT_PIPELINE` |
| governance, masking, RLS | `DATA_GOVERNANCE_COMPLIANCE` |
| embedded, dashboard analytics, hybrid tables | `EMBEDDED_ANALYTICS` |
| data mesh, multi-cloud federated | `MULTI_CLOUD_DATA_MESH` |
| serverless, lambda, functions | `SERVERLESS_DATA_STACK` |
| financial, fraud, transactions | `REALTIME_FINANCIAL_TRANSACTIONS` |
| iceberg, hybrid cloud, external catalog | `HYBRID_CLOUD_LAKEHOUSE` |

If the prompt matches a template strongly: load `$SKILL_DIR/assets/templates/<id>.json` and use its `FULL_MERMAID_CODE` as the diagram source.

If the prompt does NOT cleanly match a template (e.g. user lists specific components), use the **freeform composer**:

```bash
python3 $SKILL_DIR/assets/composer/composer.py <BLOCK_ID_1> <BLOCK_ID_2> ...
```

To find BLOCK_IDs: read `$SKILL_DIR/assets/component_blocks.json` (42 blocks across categories: external, ingestion, bronze, silver, gold, transformation, security, compute, bi, storage). Use `$SKILL_DIR/assets/component_synonyms.json` (202 synonyms) for fuzzy term resolution — match the user's words against the `SYNONYM` column to find the corresponding `COMPONENT_TYPE`, then map to a block.

**⚠️ STOP**: confirm the chosen template OR component list with the user before rendering.

### Step 2: Enrich with documentation citations

Run `cortex search docs` for each major component or pattern in the diagram. This works without a Snowflake connection and adds value to standalone mode:

```bash
cortex search docs "snowpipe streaming best practices"
cortex search docs "dynamic tables refresh"
cortex search docs "iceberg external catalog"
```

Collect up to 5 citations as `[{url, title, excerpt}]` objects.

### Step 3: Write state.json + launch viewer

```bash
# Write state.json
cat > $SKILL_DIR/assets/viewer/state.json <<EOF
{
  "mermaid": "<the Mermaid code>",
  "title": "<template name or freeform title>",
  "source": "standalone:template:<TEMPLATE_ID>"  // or "standalone:freeform"
  "citations": [...]
}
EOF

# Launch
$SKILL_DIR/assets/scripts/launch_viewer.sh
```

The viewer opens at `http://localhost:<port>/`. User can download `.mmd`, `.svg`, `.png`.

### Step 4: Iteration

If the user wants to refine ("add Kafka before Bronze", "swap to a different template"):

- **Template swap**: re-run from Step 1 with new template
- **Add/remove components**: re-run composer with modified BLOCK_ID list
- **Swap mode**: route to `connected-cli` if user wants conversational refinement

Always rewrite `state.json` and reload the viewer (the user can refresh the browser tab — no need to relaunch the server).

## Tools

| Tool | Used for |
|---|---|
| `python3 $SKILL_DIR/assets/composer/composer.py` | Compose Mermaid from BLOCK_IDs |
| `$SKILL_DIR/assets/templates/<id>.json` | Pre-built template Mermaid |
| `$SKILL_DIR/assets/component_blocks.json` | BLOCK_ID lookup |
| `$SKILL_DIR/assets/component_synonyms.json` | Term -> component_type fuzzy match |
| `cortex search docs "<query>"` | Documentation enrichment |
| `$SKILL_DIR/assets/scripts/launch_viewer.sh` | Spawn viewer + open browser |
| `$SKILL_DIR/assets/scripts/stop_viewer.sh` | Stop viewer |

## Stopping points

- ✋ After Step 1: confirm template / component list
- ✋ After Step 3: viewer launched, user reviews diagram
- ✋ Before iteration: confirm direction (refine, swap, escape to connected mode)

## Output

- Browser tab at `http://localhost:<port>/` showing the diagram
- Downloadable artifacts via header buttons: `.mmd`, `.svg`, `.png`
- Citations drawer showing relevant Snowflake documentation links

## Stale snapshot warning

If `$SKILL_DIR/assets/_snapshot_meta.json` is older than 30 days OR the `source_sql_sha256` no longer matches the SQL files in the SnowGram repo, surface a one-line warning to the user:

> Snapshot is N days old. Run `python3 $SKILL_DIR/assets/scripts/snapshot.py -c <connection>` to refresh.

Continue rendering anyway.
