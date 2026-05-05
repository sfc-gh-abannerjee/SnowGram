---
name: snowflake-architecture-diagram-standalone
description: "Standalone mode: generate Snowflake architecture diagrams with no Snowflake connection required. Uses bundled templates + local Mermaid composer + cortex search docs for citations."
parent_skill: snowflake-architecture-diagram
---

# Standalone mode

Generate exportable Snowflake architecture diagrams without needing a deployed SnowGram agent or any Snowflake connection. Uses 14 bundled templates + a Python composer that mirrors the deployed Mermaid generation logic byte-for-byte.

## Workflow

### Step 1: Match prompt to a template OR collect components

**Goal:** decide whether the user wants a canned reference architecture or a custom component list.

Use this routing table on the user's prompt:

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

If the prompt matches a template strongly: load `<DIR>/assets/templates/<id>.json` and use its `FULL_MERMAID_CODE` as the diagram source.

If the prompt does NOT cleanly match a template (e.g. user lists specific components), use the **freeform composer**:

```bash
python3 <DIR>/assets/composer/composer.py <BLOCK_ID_1> <BLOCK_ID_2> ...
```

To find BLOCK_IDs: read `<DIR>/assets/component_blocks.json` (42 blocks across categories: external, ingestion, bronze, silver, gold, transformation, security, compute, bi, storage). Use `<DIR>/assets/component_synonyms.json` (202 synonyms) for fuzzy term resolution — match the user's words against the `SYNONYM` column to find the corresponding `COMPONENT_TYPE`, then map to a block.

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
cat > <DIR>/assets/viewer/state.json <<EOF
{
  "mermaid": "<the Mermaid code>",
  "title": "<template name or freeform title>",
  "source": "standalone:template:<TEMPLATE_ID>"  // or "standalone:freeform"
  "citations": [...]
}
EOF

# Launch
<DIR>/assets/scripts/launch_viewer.sh
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
| `python3 <DIR>/assets/composer/composer.py` | Compose Mermaid from BLOCK_IDs |
| `<DIR>/assets/templates/<id>.json` | Pre-built template Mermaid |
| `<DIR>/assets/component_blocks.json` | BLOCK_ID lookup |
| `<DIR>/assets/component_synonyms.json` | Term -> component_type fuzzy match |
| `cortex search docs "<query>"` | Documentation enrichment |
| `<DIR>/assets/scripts/launch_viewer.sh` | Spawn viewer + open browser |
| `<DIR>/assets/scripts/stop_viewer.sh` | Stop viewer |

## Stopping points

- ✋ After Step 1: confirm template / component list
- ✋ After Step 3: viewer launched, user reviews diagram
- ✋ Before iteration: confirm direction (refine, swap, escape to connected mode)

## Output

- Browser tab at `http://localhost:<port>/` showing the diagram
- Downloadable artifacts via header buttons: `.mmd`, `.svg`, `.png`
- Citations drawer showing relevant Snowflake documentation links

## Stale snapshot warning

If `<DIR>/assets/_snapshot_meta.json` is older than 30 days OR the `source_sql_sha256` no longer matches the SQL files in the SnowGram repo, surface a one-line warning to the user:

> Snapshot is N days old. Run `python3 <DIR>/assets/scripts/snapshot.py -c <connection>` to refresh.

Continue rendering anyway.
