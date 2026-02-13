# AI-Powered Dynamic Diagram Generation Architecture

## Implementation Status: ✅ Phase 1 Complete

### Completed
- [x] Created CLASSIFY_COMPONENT UDF using AI_COMPLETE
- [x] Added ELK.js package to frontend
- [x] Created elkLayout.ts with layered layout algorithm
- [x] Integrated ELK into App.tsx parseMermaidAndCreateDiagram
- [x] Fixed pickHandle logic (magnitude comparison vs absolute threshold)
- [x] Build passes successfully

### Pending
- [ ] Update agent instructions to call CLASSIFY_COMPONENT for unknown components
- [ ] Add flowStage metadata to agent response
- [ ] End-to-end testing with real prompts
- [ ] Optimize AI classification latency (caching)

---

## Overview

This document describes the architecture for making SnowGram intelligently handle ANY tool, service, or component mentioned by users - without requiring code changes or manual registry updates.

## Problem Statement

The current SnowGram implementation has fundamental limitations:
1. **Hardcoded component positions** - Medallion layout expects specific IDs (bronze_db, silver_db)
2. **Limited tool support** - Only Tableau and Streamlit are handled; PowerBI, Looker, etc. fail
3. **Discards unknown components** - "Extras" are thrown away as hallucinations
4. **Pixel-based edge handles** - Creates diagonal/kinked edges

**FDE Requirement**: Handle ANY component dynamically for diverse customer demos.

## Solution Architecture

### Three-Layer Approach

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 1: AI-POWERED COMPONENT CLASSIFICATION (Snowflake UDF)          │
│  - Uses AI_COMPLETE with structured output                              │
│  - Classifies ANY component into data flow stages                       │
│  - Returns: flowStage, flowStageOrder, flowTier, suggestedIcon         │
└─────────────────────────────────────────────────────────────────────────┘
                                     ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 2: CORTEX AGENT (Enhanced)                                       │
│  - Extracts component mentions from user prompt                         │
│  - Calls CLASSIFY_COMPONENT for each unknown component                  │
│  - Returns nodes with enriched metadata                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                     ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 3: ELK.js LAYOUT ENGINE (Frontend)                               │
│  - Professional graph layout algorithm                                   │
│  - Uses flowStage as layer assignment                                   │
│  - Automatic edge routing and port (handle) assignment                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Classification

### Flow Stages (Data Pipeline Layers)

| Order | Stage     | Description                          | Examples                           |
|-------|-----------|--------------------------------------|------------------------------------|
| 0     | source    | External data origins                | Kafka, S3, Azure Blob, APIs       |
| 1     | ingest    | Data ingestion mechanisms            | Snowpipe, Fivetran, Airbyte       |
| 2     | raw       | Raw/landing data storage             | Bronze tables, landing schemas     |
| 3     | transform | Data transformation                  | Silver layer, dbt, Spark          |
| 4     | refined   | Business-ready data                  | Gold layer, data marts            |
| 5     | serve     | Data serving layer                   | Warehouses, views, APIs           |
| 6     | consume   | Data consumption                     | PowerBI, Tableau, Looker, apps    |

### Flow Tiers

| Tier      | Description                    | Examples                          |
|-----------|--------------------------------|-----------------------------------|
| external  | Outside Snowflake              | S3, Kafka, PowerBI                |
| snowflake | Native Snowflake components    | Tables, Streams, Warehouses       |
| hybrid    | Operates across boundaries     | Snowpipe, external functions      |

## Implementation Details

### 1. Snowflake UDF: CLASSIFY_COMPONENT

```sql
CREATE OR REPLACE FUNCTION SNOWGRAM_DB.CORE.CLASSIFY_COMPONENT(component_name VARCHAR)
RETURNS OBJECT
AS
$$
SELECT AI_COMPLETE(
  model => 'claude-sonnet-4',
  prompt => 'Classify "' || component_name || '" for a data architecture diagram.
    
Determine where this component fits in a data pipeline:
- source: External data origins (Kafka, S3, databases)
- ingest: Data loading mechanisms (Snowpipe, ETL tools)
- raw: Raw data storage (bronze/landing layer)
- transform: Data transformation (silver layer, processing)
- refined: Business-ready data (gold layer, marts)
- serve: Data serving (warehouses, views)
- consume: End-user tools (BI, dashboards, reports)',
  response_format => TYPE OBJECT(
    flow_stage VARCHAR,
    flow_stage_order NUMBER,
    flow_tier VARCHAR,
    component_category VARCHAR,
    typical_upstream ARRAY(VARCHAR),
    typical_downstream ARRAY(VARCHAR),
    suggested_icon VARCHAR,
    display_color VARCHAR
  )
)
$$;
```

### 2. ELK.js Configuration

```typescript
const elkOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '200',
  'elk.layered.spacing.nodeNode': '80',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.portConstraints': 'FIXED_SIDE',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP'
};
```

### 3. Port-to-Handle Mapping

| ELK Port Side | ReactFlow Handle   |
|---------------|--------------------|
| EAST          | right-source       |
| WEST          | left-target        |
| SOUTH         | bottom-source      |
| NORTH         | top-target         |

## Testing Strategy

### Test 1: Component Classification Accuracy
```sql
-- Test various component types
SELECT CLASSIFY_COMPONENT('PowerBI');
SELECT CLASSIFY_COMPONENT('Kafka');
SELECT CLASSIFY_COMPONENT('Fivetran');
SELECT CLASSIFY_COMPONENT('dbt');
SELECT CLASSIFY_COMPONENT('ThoughtSpot');
SELECT CLASSIFY_COMPONENT('Azure Data Lake');
```

**Expected Results**:
- PowerBI: flowStage='consume', flowStageOrder=6
- Kafka: flowStage='source', flowStageOrder=0
- Fivetran: flowStage='ingest', flowStageOrder=1
- dbt: flowStage='transform', flowStageOrder=3

### Test 2: ELK Layout Quality
- Input: Medallion architecture nodes with correct flowStageOrder
- Expected: Clean left-to-right flow, no overlapping nodes

### Test 3: Edge Handle Assignment
- Verify horizontal edges use right→left handles
- Verify vertical edges use bottom→top handles
- Verify no diagonal kinks in rendered diagram

### Test 4: End-to-End Integration
User prompt: "Build a medallion architecture with Kafka ingestion and PowerBI reports"
Expected:
1. Agent extracts: Kafka, medallion components, PowerBI
2. Classification assigns: Kafka=source(0), Bronze=raw(2), PowerBI=consume(6)
3. ELK positions nodes in correct layer order
4. Rendered diagram shows clean flow with no kinks

## Files to Create/Modify

### New Files
1. `backend/sql/classify_component_udf.sql` - AI classification UDF
2. `frontend/src/lib/elkLayout.ts` - ELK.js integration

### Modified Files
1. `backend/agent/update_agent_instructions.py` - Add classification tool usage
2. `frontend/src/App.tsx` - Replace hardcoded layouts with ELK
3. `frontend/package.json` - Add elkjs dependency
4. `frontend/src/components/iconMap.ts` - Intelligent fallbacks

## Success Criteria

1. **Any BI Tool**: PowerBI, Looker, Metabase, ThoughtSpot all position correctly
2. **Any Data Source**: Kafka, Azure Blob, GCS, Fivetran all position correctly
3. **Clean Edges**: No diagonal kinks, proper orthogonal routing
4. **Zero Code Changes**: New tools work automatically via AI classification
5. **Manual Mode Preserved**: Users can still manually adjust diagrams

## Rollback Plan

If issues arise:
1. ELK.js can be disabled via feature flag
2. Fall back to existing layoutMedallionDeterministic
3. AI classification cached to reduce latency

---

*Last Updated: February 2026*
*Author: Cortex Code (FDE Architecture Session)*
