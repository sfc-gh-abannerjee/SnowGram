---
name: snowgram-architect
description: "**[REQUIRED]** Generate Snowflake architecture diagrams using natural language. Use for: architecture diagram, visualize pipeline, medallion architecture, data flow diagram, snowgram, draw architecture. DO NOT attempt to create architecture diagrams manually - invoke this skill first."
---

# SnowGram Architecture Diagrams

Generate professional Snowflake architecture diagrams via the SnowGram Cortex Agent with 14 pre-built reference templates.

## When to Load

Load this skill when user wants to:
- Create a Snowflake architecture diagram
- Visualize a data pipeline or medallion architecture
- Draw streaming, batch, or hybrid ingestion patterns
- Generate a data flow diagram with Snowflake components

## Prerequisites

- Snowflake connection: `se_demo` (or active connection)
- Agent: `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT` must exist
- Frontend (optional): http://localhost:3002 for interactive viewing

## Workflow

```
User Request
    ↓
Step 1: Match to Template
    ↓
Step 2: Generate Diagram via Agent
    ↓
Step 3: Verify Output Includes Mermaid Code
    ↓
Complete
```

### Step 1: Match to Template

**Goal:** Identify which of the 14 templates best matches the user's request.

**Template Selection Guide:**

| User Request Keywords | Template ID |
|-----------------------|-------------|
| medallion, bronze/silver/gold, lakehouse | `MEDALLION_LAKEHOUSE` |
| streaming, kafka, real-time | `STREAMING_DATA_STACK` |
| security, SIEM, log analytics | `SECURITY_ANALYTICS` |
| customer 360, CDP | `CUSTOMER_360` |
| ML, machine learning, features | `ML_FEATURE_ENGINEERING` |
| batch, ETL, data warehouse | `BATCH_DATA_WAREHOUSE` |
| IoT, sensor, edge | `REALTIME_IOT_PIPELINE` |
| governance, masking, RLS | `DATA_GOVERNANCE_COMPLIANCE` |
| embedded, dashboard, app analytics | `EMBEDDED_ANALYTICS` |
| data mesh, multi-cloud | `MULTI_CLOUD_DATA_MESH` |
| serverless, lambda, functions | `SERVERLESS_DATA_STACK` |
| financial, transactions, fraud | `REALTIME_FINANCIAL_TRANSACTIONS` |
| iceberg, hybrid cloud | `HYBRID_CLOUD_LAKEHOUSE` |
| snowflake-only medallion | `MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY` |

### Step 2: Generate Diagram via Agent

**Direct SQL Test (bypasses agent):**
```sql
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('TEMPLATE_ID');
```

**Via Cortex Agent:**
Use `mcp__mcp-server-snowflake__cortex_analyst`:
```
service_name: snowgram_agent
semantic_model: SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT
query: "Create a [architecture type] architecture diagram"
```

**Example Prompts:**

| Pattern | Prompt |
|---------|--------|
| Medallion | "Create a medallion architecture diagram with Kafka ingestion" |
| Streaming | "Build a real-time streaming pipeline with Kafka and Dynamic Tables" |
| Security | "Generate a security analytics architecture for log ingestion" |
| Customer 360 | "Design a customer 360 platform with ML predictions" |

### Step 3: Verify Output Includes Mermaid Code

**CRITICAL CHECKPOINT**: After agent returns, verify the response includes actual Mermaid code.

**Expected Response Structure:**
1. Brief acknowledgment (1 sentence)
2. **Mermaid code block** (MUST be present)
3. Component summary (bullets)
4. Best practices (bullets)

**If Mermaid code is missing:**
- Agent responded with "Diagram updated. Review the canvas." without code
- This means the agent tool description needs updating
- See `snowgram-agent` skill for fix instructions

**If response is correct:**
- Mermaid code is visible in a code block
- User can copy/paste or view in frontend
- Skill complete

## Template Reference (14 Templates)

### Data Pipelines
| Template | Description | Key Components |
|----------|-------------|----------------|
| `MEDALLION_LAKEHOUSE` | Bronze/Silver/Gold | External sources, Dynamic Tables, dedicated WH |
| `MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY` | Snowflake-native | Tasks, Streams, no external dependencies |
| `STREAMING_DATA_STACK` | Real-time ingestion | Kafka Connector, Snowpipe Streaming, Dynamic Tables |
| `BATCH_DATA_WAREHOUSE` | Traditional ETL | Star schema, warehouse isolation |

### Analytics & ML
| Template | Description | Key Components |
|----------|-------------|----------------|
| `SECURITY_ANALYTICS` | SIEM/Log analytics | Multi-cloud logs, SOS, Time Travel forensics |
| `CUSTOMER_360` | CDP platform | Native Apps, Secure Data Sharing, Cortex ML |
| `ML_FEATURE_ENGINEERING` | ML pipelines | Model Registry, Cortex Functions, SPCS |
| `EMBEDDED_ANALYTICS` | In-app dashboards | Hybrid Tables, Multi-Cluster WH |

### Architecture Patterns
| Template | Description | Key Components |
|----------|-------------|----------------|
| `REALTIME_IOT_PIPELINE` | IoT streaming | Edge software, MQTT, rules engine |
| `MULTI_CLOUD_DATA_MESH` | Federated data | Database Roles, cross-region sharing |
| `SERVERLESS_DATA_STACK` | Minimal infra | Lambda/Functions, Hybrid Tables |
| `REALTIME_FINANCIAL_TRANSACTIONS` | High-volume txns | Fraud detection, compliance workflows |

### Hybrid & Governance
| Template | Description | Key Components |
|----------|-------------|----------------|
| `HYBRID_CLOUD_LAKEHOUSE` | Open table formats | Iceberg, External Catalog (Glue/Polaris) |
| `DATA_GOVERNANCE_COMPLIANCE` | Data protection | Masking policies, RLS, IS_ROLE_IN_SESSION |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| No Mermaid code in response | Agent tool description missing output requirement | Update tool description - see snowgram-agent skill |
| Wrong template selected | Keywords not matched | Explicitly mention template ID in prompt |
| Layout issues | Frontend rendering | Check frontend at localhost:3002 |
| Works via direct agent test but not in app | Frontend prompt override | Check `frontend/src/lib/snowgram-agent-client.ts` - the `SNOWGRAM_SYSTEM_PROMPT` must include explicit instructions to output Mermaid code verbatim |

## Output

- Agent returns complete Mermaid diagram code
- Frontend (if running): Interactive diagram at http://localhost:3002
- Export options: Copy Mermaid, render in any Mermaid viewer

## Stopping Points

- After Step 1 if no template matches (ask user to clarify)
- After Step 2 for user to review generated diagram
- After Step 3 if Mermaid code is missing (needs agent fix)
