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
| `STREAMING_DATA_STACK` | kafka, streaming, real-time | Kafka Connector + Dynamic Tables |
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

### 4. Debug Agent Output Issues

**Symptom**: Agent says "Diagram updated. Review the canvas." without showing code.

**Root Cause**: Tool description missing explicit output requirement.

**Fix**: Update tool description to include:
```
CRITICAL: You MUST include the returned Mermaid code VERBATIM 
in your response inside a ```mermaid code block.
```

### 5. Test Component Search

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
