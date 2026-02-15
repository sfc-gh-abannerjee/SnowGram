# AI-Powered Dynamic Diagram Generation Architecture

## Implementation Status: ✅ Phase 4 Complete - Production Ready

### Phase 4: Production Hardening (2026-02-15)
- [x] **17 frontend bugs fixed** - Stale closures, race conditions, SVG export
- [x] **8 npm vulnerabilities resolved** - All HIGH severity eliminated
- [x] **Dependency upgrades** - Next.js 15, mermaid 11, ESLint 9
- [x] **Dead code removal** - ~400 LOC removed
- [x] **Documentation** - CHANGELOG, BUG_AUDIT, DEPENDENCIES docs added

### Phase 3: Truly Dynamic Architecture
- [x] **AI-powered entity extraction** - No hardcoded external source patterns
- [x] **Dynamic component matching** - Matches against COMPONENTS table automatically
- [x] **Web search integration** - WEB_SEARCH UDF for external tool documentation
- [x] **Expanded learning cache** - 131+ components in KNOWN_COMPONENT_CLASSIFICATIONS
- [x] **Enhanced agent instructions** - Exact component naming, linear layout rules

### Phase 2: Completed
- [x] Created CLASSIFY_COMPONENT UDF using CORTEX.COMPLETE
- [x] Added ELK.js package to frontend
- [x] Created elkLayout.ts with layered layout algorithm
- [x] Agent returns flowStage/flowStageOrder metadata in every node
- [x] End-to-end testing with test harness

### Pending
- [ ] Performance monitoring for LLM latency
- [ ] Auto-learning feedback loop from production usage

---

## Overview

SnowGram is a **truly dynamic** architecture diagram generator. The key principle: **No hardcoded patterns** for external sources or component recognition.

## Architecture Evolution

### ❌ Old Approach (Hardcoded)
```sql
-- Anti-pattern: Hardcoded external source detection
CASE WHEN LOWER(user_description) LIKE '%kafka%' THEN TRUE END AS wants_kafka
CASE WHEN LOWER(user_description) LIKE '%s3%' THEN TRUE END AS wants_s3
-- Every new source required code changes!
```

### ✅ New Approach (AI-Powered Dynamic)
```
User Request → AI Entity Extraction → Dynamic COMPONENTS Matching
                     ↓
              ["kafka", "s3"]
                     ↓
              SELECT * FROM COMPONENTS WHERE type_category = 'external'
              AND (name LIKE '%kafka%' OR name LIKE '%s3%')
```

**Adding a new external source = just add a row to COMPONENTS table**

## Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 1: AI-POWERED ENTITY EXTRACTION & COMPONENT SUGGESTION          │
│  - SUGGEST_COMPONENTS_FOR_USE_CASE UDF                                 │
│  - AI extracts external sources mentioned by user                      │
│  - Dynamic matching against COMPONENTS table (no hardcoding!)          │
│  - Returns: component_id, component_name, confidence_score, reasoning  │
└─────────────────────────────────────────────────────────────────────────┘
                                     ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 2: CORTEX AGENT (Enhanced)                                       │
│  - Uses SUGGEST_COMPONENTS_FOR_USE_CASE as primary tool                │
│  - WEB_SEARCH for external tool documentation                          │
│  - SNOWFLAKE_DOCS_CKE for official Snowflake docs                      │
│  - Returns ReactFlow-ready JSON with exact component names             │
└─────────────────────────────────────────────────────────────────────────┘
                                     ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 3: ELK.js LAYOUT ENGINE (Frontend)                               │
│  - Uses flowStageOrder for automatic layered layout                    │
│  - Orthogonal edge routing                                             │
│  - Clean left-to-right data flow                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

## Dynamic Entity Extraction

The `SUGGEST_COMPONENTS_FOR_USE_CASE` UDF uses AI to extract external sources:

```sql
-- Step 1: AI extracts entities from user request
SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-sonnet-4-5',
  'Extract external sources from: "Build medallion with kafka and S3"
   Return JSON array: ["kafka", "s3"]'
) AS extracted_sources;

-- Step 2: Dynamic matching against COMPONENTS table
SELECT * FROM COMPONENTS c
WHERE c.type_category = 'external'
AND EXISTS (
  SELECT 1 FROM LATERAL FLATTEN(extracted_sources) f
  WHERE LOWER(c.component_name) LIKE '%' || f.value || '%'
);
```

## Flow Stages (Data Pipeline Layers)

| Order | Stage     | Description                          | Examples                           |
|-------|-----------|--------------------------------------|------------------------------------|
| 0     | source    | External data origins                | Kafka, S3, Azure Blob, APIs       |
| 1     | ingest    | Data ingestion mechanisms            | Snowpipe, Fivetran, Airbyte       |
| 2     | raw       | Raw/landing data storage             | Bronze Layer                       |
| 3     | transform | Data transformation                  | CDC Stream, Transform Task, Silver Layer |
| 4     | refined   | Business-ready data                  | Gold Layer                         |
| 5     | serve     | Data serving layer                   | Analytics Views, Warehouse        |
| 6     | consume   | Data consumption                     | PowerBI, Tableau, Looker          |

## Key UDFs

### SUGGEST_COMPONENTS_FOR_USE_CASE

```sql
SELECT * FROM TABLE(SNOWGRAM_DB.CORE.SUGGEST_COMPONENTS_FOR_USE_CASE(
  'medallion architecture connected to kafka stream'
));
-- Returns: Kafka, Bronze Layer, CDC Stream, Transform Task, Silver Layer, Gold Layer, etc.
-- S3 is NOT returned because user didn't mention it (dynamic filtering!)
```

### WEB_SEARCH (External Tool Documentation)

```sql
SELECT * FROM TABLE(SNOWGRAM_DB.CORE.WEB_SEARCH('dbt medallion architecture best practices'));
-- Returns: title, snippet, url from DuckDuckGo
```

### CLASSIFY_AND_CACHE (Auto-Learning)

```sql
SELECT SNOWGRAM_DB.CORE.CLASSIFY_AND_CACHE('Databricks');
-- Classifies the component AND adds to KNOWN_COMPONENT_CLASSIFICATIONS cache
```

## Agent Instructions - Key Sections

### Component Naming (Critical)
```yaml
**CRITICAL - USE EXACT COMPONENT NAMES:**
Use ONLY these exact names from SUGGEST_COMPONENTS_FOR_USE_CASE:
- "Bronze Layer" (NOT "Bronze Tables" or "Bronze")
- "Silver Layer" (NOT "Silver Tables" or "Silver")  
- "Gold Layer" (NOT "Gold Tables" or "Gold")
- "CDC Stream" (NOT "Stream" or "Change Stream")

NEVER create component names that don't exist in SUGGEST_COMPONENTS_FOR_USE_CASE output.
```

### External Source Handling
```yaml
**EXTERNAL SOURCES:**
Only include external sources that user EXPLICITLY mentions:
- "kafka" → Use "Kafka" component (NOT S3)
- "s3" or "aws" → Use "AWS S3" component
- "azure" → Use "Azure Blob" component

Do NOT substitute one external source for another.
```

## Database Schema

### COMPONENTS Table (Core Definitions)
| Column | Type | Description |
|--------|------|-------------|
| component_id | VARCHAR | Unique ID (e.g., ext_kafka) |
| component_name | VARCHAR | Display name (e.g., Kafka) |
| component_type | VARCHAR | Type (e.g., KAFKA_TOPIC) |
| type_category | VARCHAR | Category (external, medallion, storage) |
| description | VARCHAR | Component description |

### KNOWN_COMPONENT_CLASSIFICATIONS (Learning Cache)
| Column | Type | Description |
|--------|------|-------------|
| user_term | VARCHAR | User input term |
| component_type | VARCHAR | Resolved component type |
| classification | VARIANT | Full AI classification result |

## Testing

### Test Component Suggestions
```sql
-- Should include Kafka, exclude S3
SELECT COMPONENT_ID, COMPONENT_NAME 
FROM TABLE(SNOWGRAM_DB.CORE.SUGGEST_COMPONENTS_FOR_USE_CASE('medallion with kafka'));

-- Should include both
SELECT COMPONENT_ID, COMPONENT_NAME 
FROM TABLE(SNOWGRAM_DB.CORE.SUGGEST_COMPONENTS_FOR_USE_CASE('pipeline from S3 and Kafka'));

-- Should include neither
SELECT COMPONENT_ID, COMPONENT_NAME 
FROM TABLE(SNOWGRAM_DB.CORE.SUGGEST_COMPONENTS_FOR_USE_CASE('simple medallion'));
```

### Test Harness
```bash
cd backend/tests/agent
python run_tests.py           # Smoke tests (~2 min)
python run_tests.py --all     # Full suite (~13 min)
```

## Success Criteria

1. **Dynamic External Sources**: Any source in COMPONENTS table works without code changes
2. **Exact Component Names**: Agent uses names from SUGGEST_COMPONENTS, not hallucinated variants
3. **Linear Layout**: Clean left-to-right flow using flowStageOrder
4. **No Source Substitution**: Kafka request shows Kafka, not S3
5. **Auto-Learning**: New components can be classified and cached automatically

## Files Reference

| File | Purpose |
|------|---------|
| `agent_spec_v4.yam                                                                                                                                                                                                                                                                                                                           