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

SnowGram uses a **template-first architecture** with 14 pre-built reference architectures. The agent selects the appropriate template and returns complete Mermaid diagrams.

**Critical Principle**: Agent MUST output returned Mermaid code verbatim - never summarize or acknowledge without showing the actual diagram.

## Quick Reference

| Resource | Location |
|----------|----------|
| Agent | `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT` |
| Connection | `se_demo` |
| Model | `claude-sonnet-4-5` |
| Templates Table | `SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES` |

## Template IDs (14 Total)

| Template ID | Keywords | Description |
|-------------|----------|-------------|
| `MEDALLION_LAKEHOUSE` | medallion, bronze/silver/gold, lakehouse | External sources + medallion |
| `MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY` | snowflake medallion, native medallion | Pure Snowflake medallion |
| `STREAMING_DATA_STACK` | kafka, streaming, real-time, kinesis, pubsub | 4 ingestion paths: Kafka, CSP Streaming, Batch/Files, Native App Connector |
| `SECURITY_ANALYTICS` | SIEM, log, security, analytics | Log ingestion + SOS |
| `CUSTOMER_360` | customer 360, CDP, customer data | Native Apps + ML predictions |
| `ML_FEATURE_ENGINEERING` | ML, machine learning, feature | Model Registry + Cortex |
| `BATCH_DATA_WAREHOUSE` | batch, ETL, warehouse | Star schema + warehouse isolation |
| `REALTIME_IOT_PIPELINE` | IoT, sensor, edge | Edge software + MQTT |
| `DATA_GOVERNANCE_COMPLIANCE` | governance, masking, RLS | Policies + IS_ROLE_IN_SESSION |
| `EMBEDDED_ANALYTICS` | embedded, dashboard, app | Hybrid Tables + Multi-Cluster |
| `MULTI_CLOUD_DATA_MESH` | data mesh, multi-cloud | Database Roles + cross-region |
| `SERVERLESS_DATA_STACK` | serverless, lambda, functions | API Gateway + Hybrid Tables |
| `REALTIME_FINANCIAL_TRANSACTIONS` | financial, transactions, fraud | High-volume + compliance |
| `HYBRID_CLOUD_LAKEHOUSE` | iceberg, hybrid, catalog | External catalog (Glue/Polaris) |

## Common Tasks

### 1. Test the Agent

```sql
-- Test template retrieval
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('MEDALLION_LAKEHOUSE');

-- Test pattern retrieval
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_PATTERN('KAFKA_STREAMING_INGESTION');

-- Test component search (JSON wrapper)
SELECT SNOWGRAM_DB.CORE.SEARCH_COMPONENT_BLOCKS_JSON('kafka');

-- Describe current agent
DESCRIBE AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;
```

### 2. Update Agent Configuration

**IMPORTANT**: Cannot use `ALTER AGENT SET AGENT_SPEC`. Must DROP and recreate.

```sql
-- 1. Drop existing agent
DROP AGENT IF EXISTS SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;

-- 2. Create with new spec
CREATE OR REPLACE AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT
  COMMENT = 'SnowGram Architecture Diagram Agent'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-5

orchestration:
  budget:
    seconds: 300
    tokens: 64000

instructions:
  system: |
    You are SnowGram, an expert Snowflake architect.
    
    CRITICAL OUTPUT REQUIREMENT:
    When any tool returns Mermaid code, you MUST include that EXACT code 
    in your response inside a mermaid code block. Never summarize or omit.
  
  orchestration: |
    ## Tool Selection Priority
    PRIORITY 1: Templates → COMPOSE_DIAGRAM_FROM_TEMPLATE
    PRIORITY 2: Patterns → COMPOSE_DIAGRAM_FROM_PATTERN
    PRIORITY 3: Custom → SEARCH_COMPONENT_BLOCKS + manual build
  
  response: |
    ## MANDATORY Response Structure
    1. Brief acknowledgment (1 sentence)
    2. Mermaid code block (COMPLETE code from tool)
    3. Component summary (4-6 bullets)
    4. Best practices (2-3 bullets)
    
    NEVER say 'Diagram updated' without showing the actual code.

tools:
  - tool_spec:
      type: generic
      name: COMPOSE_DIAGRAM_FROM_TEMPLATE
      description: |
        Returns complete Mermaid diagram for architecture templates.
        CRITICAL: Include returned Mermaid code VERBATIM in response.
        Template IDs: MEDALLION_LAKEHOUSE, STREAMING_DATA_STACK, SECURITY_ANALYTICS, etc.
      input_schema:
        type: object
        properties:
          TEMPLATE_ID_PARAM:
            type: string
            description: Template ID from ARCHITECTURE_TEMPLATES table
        required: [TEMPLATE_ID_PARAM]

tool_resources:
  COMPOSE_DIAGRAM_FROM_TEMPLATE:
    type: function
    execution_environment:
      type: warehouse
      warehouse: COMPUTE_WH
    identifier: SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE
$$;
```

### 3. Add New Template

```sql
INSERT INTO SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES 
  (TEMPLATE_ID, TEMPLATE_NAME, DESCRIPTION, MERMAID_CODE, BEST_PRACTICES)
SELECT
  'NEW_TEMPLATE_ID',
  'New Template Name',
  'Description of the architecture',
  'flowchart LR
    subgraph sources["External Sources"]
        source1["Source 1"]
    end
    subgraph snowflake["Snowflake"]
        dest1["Destination"]
    end
    source1 --> dest1',
  ARRAY_CONSTRUCT('Best practice 1', 'Best practice 2');
```

### 4. Update Template from PDF Reference Architecture

When updating templates to match official Snowflake Reference Architecture PDFs, follow this workflow:

**Step 1: Extract content from PDF**
```python
# Use PyMuPDF (fitz) to read PDF content
import fitz
doc = fitz.open("/path/to/reference-architecture.pdf")
for page_num, page in enumerate(doc):
    text = page.get_text()
    # Extract images if needed
    for img_index, img in enumerate(page.get_images()):
        # Save image for visual reference
```

**Step 2: Understand the ARCHITECTURE_TEMPLATES table schema**

| Column | Type | Purpose |
|--------|------|---------|
| `TEMPLATE_ID` | VARCHAR (PK) | Unique identifier (e.g., `STREAMING_DATA_STACK`) |
| `TEMPLATE_NAME` | VARCHAR | Human-readable name |
| `DESCRIPTION` | VARCHAR | **Detailed description matching PDF exactly** - includes all paths/options |
| `COMPOSED_PATTERNS` | ARRAY | Array of component pattern IDs included in template |
| `FULL_MERMAID_CODE` | VARCHAR | **Complete Mermaid diagram code** - this is what the agent returns |
| `USE_CASE_CATEGORY` | VARCHAR | Category for filtering |
| `INDUSTRY` | VARCHAR | Industry vertical |
| `TIMES_USED` | NUMBER | Usage analytics |

**Step 3: Update BOTH description AND Mermaid code**

**CRITICAL**: The `COMPOSE_DIAGRAM_FROM_TEMPLATE` function returns the `FULL_MERMAID_CODE` column directly. If you only update `DESCRIPTION`, the agent will still return the old diagram.

```sql
UPDATE SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES
SET 
    -- Update description to match PDF exactly (all paths/options)
    DESCRIPTION = 'Streaming Data Stack Reference Architecture with 4 ingestion paths:
(1a) Kafka Path: Producer App → Kafka → Snowflake Connector for Kafka → Staging Table.
(1b) CSP Streaming Path: Producer App → Kinesis/Event Hubs/Pub/Sub → Compute (Java SDK) → Snowpipe Streaming → Staging Table.
(1c) Batch/Files Path: Producer App → S3/Azure Blob/GCS → Snowpipe Auto-Ingest → Staging Table.
(1d) Native App Connector Path: Industry Sources → Native App Connector from Marketplace → Staging Table.
All paths converge to: Staging Table → Streams & Tasks → Dynamic Tables → Snowpark/SPCS → Analytics',
    
    -- Update Mermaid code to visualize ALL paths from the PDF
    FULL_MERMAID_CODE = 'flowchart LR
    subgraph path_1a["Path 1a: Kafka"]
        kafka["Apache Kafka"]
        kafka_connector["Snowflake Connector for Kafka"]
    end
    subgraph path_1b["Path 1b: CSP Streaming"]
        kinesis["Amazon Kinesis"]
        csp_compute["Compute (Java SDK)"]
        snowpipe_streaming["Snowpipe Streaming"]
    end
    %% ... complete Mermaid for all paths
    ',
    
    -- Update patterns array to include all components
    COMPOSED_PATTERNS = ARRAY_CONSTRUCT(
        'kafka', 'snowflake_connector_for_kafka',
        'amazon_kinesis', 'snowpipe_streaming',
        'amazon_s3', 'snowpipe_auto_ingest',
        'native_app_connector',
        'staging_table', 'streams', 'tasks', 'dynamic_tables'
    ),
    
    UPDATED_AT = CURRENT_TIMESTAMP()
WHERE TEMPLATE_ID = 'STREAMING_DATA_STACK';
```

**Step 4: Test the updated template**
```sql
-- Verify the function returns the NEW Mermaid code
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('STREAMING_DATA_STACK');
```

**Best Practices for PDF-to-Template Updates:**

1. **One master template per reference architecture** - Don't create separate templates for each path/option. Include ALL variations in one comprehensive template.

2. **Description should be exhaustive** - List every path, option, and component from the PDF. Use numbered paths (1a, 1b, 1c, 1d) to match PDF labeling.

3. **Mermaid code must visualize everything** - Use subgraphs to group related components by path. Include comments (`%%`) to label each path.

4. **Use consistent styling** - Apply colors to differentiate paths:
   ```
   style path_1a fill:#E3F2FD,stroke:#2196F3
   style path_1b fill:#F3E5F5,stroke:#9C27B0
   style path_1c fill:#E8F5E9,stroke:#4CAF50
   ```

5. **Verify convergence points** - Most reference architectures have multiple ingestion paths that converge to common downstream processing. Ensure all paths connect to the staging/landing zone.

### 5. Debug Agent Output Issues

**Symptom**: Agent says "Diagram updated. Review the canvas." without showing code.

**Root Cause**: Tool description missing explicit output requirement.

**Fix**: Update tool description to include:
```
CRITICAL: You MUST include the returned Mermaid code VERBATIM 
in your response inside a ```mermaid code block.
```

### 6. Test Component Search

```sql
-- The JSON wrapper (required because agents can't call UDTFs)
SELECT SNOWGRAM_DB.CORE.SEARCH_COMPONENT_BLOCKS_JSON('streaming');

-- The underlying UDTF
SELECT * FROM TABLE(SNOWGRAM_DB.CORE.SEARCH_COMPONENT_BLOCKS('streaming'));
```

## Key UDFs

| UDF | Returns | Usage |
|-----|---------|-------|
| `COMPOSE_DIAGRAM_FROM_TEMPLATE(id)` | VARCHAR (Mermaid) | Primary tool for diagrams |
| `COMPOSE_DIAGRAM_FROM_PATTERN(id)` | VARCHAR (Mermaid) | Specific data flow patterns |
| `SEARCH_COMPONENT_BLOCKS_JSON(keyword)` | VARCHAR (JSON) | Component search (scalar wrapper) |
| `VALIDATE_MERMAID_SYNTAX(code)` | VARCHAR | Validates Mermaid syntax |

## Frontend Integration

The SnowGram frontend at `frontend/src/lib/snowgram-agent-client.ts` sends its own `SNOWGRAM_SYSTEM_PROMPT` when calling the agent API. This prompt can **override** agent-configured instructions from the agent spec.

**Key implications:**
1. If the agent works via direct API/SQL testing but not through the frontend, the issue is likely in the frontend's prompt
2. The frontend prompt must include the same critical output requirements as the agent spec
3. Updates to agent behavior may require changes in **both** the agent spec AND the frontend prompt

**Required frontend prompt section:**
```
CRITICAL - MERMAID OUTPUT REQUIREMENT:
When any tool returns Mermaid diagram code, you MUST include that EXACT code 
verbatim in your response inside a ```mermaid code block. 
NEVER summarize, acknowledge, or describe the diagram without showing the actual code.
```

## Troubleshooting

### Issue: Agent works via API but not frontend

**Symptoms:**
- Direct SQL test (`SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE(...)`) works
- Agent responds correctly via `cortex analyst` or direct API calls
- Frontend shows "Diagram updated" or similar without actual Mermaid code

**Cause:** The frontend's `SNOWGRAM_SYSTEM_PROMPT` in `snowgram-agent-client.ts` overrides agent-configured instructions.

**Fix:**
1. Open `frontend/src/lib/snowgram-agent-client.ts`
2. Find the `SNOWGRAM_SYSTEM_PROMPT` constant
3. Add the "CRITICAL - MERMAID OUTPUT REQUIREMENT" section
4. Rebuild and test the frontend

### Issue: Agent doesn't show Mermaid code

**Symptoms:**
- Agent responds "Diagram updated. Review the canvas for the architecture."
- Tool call succeeds but code not included in response

**Fix:**
1. Check tool description includes "output code verbatim" requirement
2. Check response instructions prohibit acknowledgment without code
3. Recreate agent with updated spec

### Issue: Template not found

**Symptoms:**
- Agent can't find template
- Returns "No template matches your request"

**Fix:**
```sql
-- Check available templates
SELECT TEMPLATE_ID, TEMPLATE_NAME FROM SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES;

-- Verify specific template exists
SELECT * FROM SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES 
WHERE TEMPLATE_ID = 'YOUR_TEMPLATE_ID';
```

### Issue: UDTF call fails

**Symptoms:**
- Error: "Function cannot be called with these arguments"
- Agent tries to call table function as scalar

**Fix:**
Use the JSON wrapper instead:
```sql
-- Wrong (UDTF)
SELECT SNOWGRAM_DB.CORE.SEARCH_COMPONENT_BLOCKS('kafka');

-- Correct (scalar wrapper)
SELECT SNOWGRAM_DB.CORE.SEARCH_COMPONENT_BLOCKS_JSON('kafka');
```

## Testing

```bash
cd backend/tests/agent
python run_tests.py                    # Smoke (~2 min)
python run_tests.py --cached --all     # Instant validation
python run_tests.py --all --report     # Full suite (~13 min)
```
