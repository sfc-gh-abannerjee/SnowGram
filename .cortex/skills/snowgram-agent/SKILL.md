---
name: snowgram-agent
description: |
  Manage and optimize the SnowGram Cortex Agent for architecture diagram generation.
  Use when: debugging agent responses, updating agent configuration, adding new components,
  testing diagram generation, or optimizing the dynamic component system.
  Triggers: snowgram, diagram agent, component mapping, agent spec, suggest components
---

# SnowGram Agent Management

## Overview

SnowGram is a **truly dynamic** Snowflake architecture diagram generator. Key principle: **No hardcoded patterns** - the system uses AI entity extraction to match user requests against the COMPONENTS table dynamically.

## Quick Reference

| Resource | Location |
|----------|----------|
| Agent | `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT` |
| Connection | `se_demo` |
| Agent Spec | `agent_spec_v4.yaml` |
| Components Table | `SNOWGRAM_DB.CORE.COMPONENTS` |
| Learning Cache | `SNOWGRAM_DB.CORE.KNOWN_COMPONENT_CLASSIFICATIONS` |

## Common Tasks

### 1. Test the Agent

```sql
-- Test component suggestions
SELECT * FROM TABLE(SNOWGRAM_DB.CORE.SUGGEST_COMPONENTS_FOR_USE_CASE('medallion architecture connected to kafka'));

-- Test web search
SELECT * FROM TABLE(SNOWGRAM_DB.CORE.WEB_SEARCH('dbt medallion architecture'));

-- Test entity extraction (internal check)
SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-sonnet-4-5', 
  'Extract external sources from: "Build S3 to Kafka pipeline". Return JSON array.');
```

### 2. Add New External Source

**No code changes needed!** Just add a row to COMPONENTS:

```sql
CALL SNOWGRAM_DB.CORE.ADD_KNOWN_COMPONENT(
  'ext_new_source',           -- component_id
  'New Source Name',          -- component_name  
  'EXTERNAL_SOURCE',          -- component_type
  'external',                 -- type_category
  'Description of the source' -- description
);
```

The AI entity extraction will automatically recognize it.

### 3. Update Agent Instructions

1. Edit `agent_spec_v4.yaml`
2. Convert to JSON: `python3 -c "import yaml, json; y=yaml.safe_load(open('agent_spec_v4.yaml')); json.dump(y, open('agent_spec_v4.json','w'), indent=2)"`
3. Deploy:
```bash
uv run --project <agent-optimization-skill-path> python <agent-optimization-skill-path>/scripts/create_or_alter_agent.py alter \
  --agent-name SNOWGRAM_AGENT \
  --config-file agent_spec_v4.json \
  --database SNOWGRAM_DB --schema AGENTS \
  --connection se_demo
```

### 4. Debug Component Matching Issues

```sql
-- Check what's in COMPONENTS
SELECT * FROM SNOWGRAM_DB.CORE.COMPONENTS WHERE type_category = 'external';

-- Check learning cache
SELECT * FROM SNOWGRAM_DB.CORE.KNOWN_COMPONENT_CLASSIFICATIONS 
WHERE LOWER(user_term) LIKE '%kafka%';

-- Test AI entity extraction
SELECT TRY_PARSE_JSON(
  REGEXP_REPLACE(
    SNOWFLAKE.CORTEX.COMPLETE('claude-sonnet-4-5',
      'Extract external sources from: "your test request". Return JSON array only.'
    ), '```json|```', ''
  )
) AS extracted;
```

## Dynamic Architecture Explained

```
User: "medallion with kafka"
         ↓
AI Entity Extraction: ["kafka"]
         ↓
Dynamic Match: SELECT * FROM COMPONENTS WHERE type_category='external'
               AND (name LIKE '%kafka%' OR id LIKE '%kafka%')
         ↓
Result: ext_kafka component included
```

**Why this matters:** Adding Databricks, Fivetran, or any new source = just add to COMPONENTS table. No UDF code changes.

## Key UDFs

| UDF | SQL |
|-----|-----|
| Suggest Components | `SELECT * FROM TABLE(SNOWGRAM_DB.CORE.SUGGEST_COMPONENTS_FOR_USE_CASE('request'))` |
| Web Search | `SELECT * FROM TABLE(SNOWGRAM_DB.CORE.WEB_SEARCH('query'))` |
| Classify & Cache | `SELECT SNOWGRAM_DB.CORE.CLASSIFY_AND_CACHE('component name')` |
| Map Component | `SELECT SNOWGRAM_DB.CORE.MAP_COMPONENT('word')` |

## flowStageOrder Reference

| Stage | Order | Components |
|-------|-------|------------|
| source | 0 | Kafka, S3, Azure Blob, GCS |
| ingest | 1 | Snowpipe, Fivetran, Airbyte |
| raw | 2 | Bronze Layer |
| transform | 3 | CDC Stream, Transform Task, Silver Layer |
| refined | 4 | Gold Layer |
| serve | 5 | Analytics Views, Warehouse |
| consume | 6 | Tableau, PowerBI, Looker |

## Troubleshooting

### Issue: External source not recognized
1. Check COMPONENTS table has the source
2. Verify component_id or component_name contains the keyword
3. Test AI extraction with that keyword

### Issue: Wrong component names in output
1. Check agent instructions have "USE EXACT COMPONENT NAMES" section
2. Verify SUGGEST_COMPONENTS returns correct names
3. Agent may be hallucinating - strengthen instructions

### Issue: Non-linear layout
1. Check flowStageOrder values in component definitions
2. Verify agent includes flowStageOrder in output
3. Check frontend ELK.js layout code

## Testing

```bash
cd backend/tests/agent
python run_tests.py           # Smoke tests
python run_tests.py --all     # Full suite
python run_tests.py --failed  # Re-run failures
```
