---
name: snowgram-architect
description: "**[REQUIRED]** Generate Snowflake architecture diagrams using natural language. Use for: architecture diagram, visualize pipeline, medallion architecture, data flow diagram, snowgram, draw architecture. DO NOT attempt to create architecture diagrams manually - invoke this skill first."
---

# SnowGram Architecture Diagrams

Generate professional Snowflake architecture diagrams via the SnowGram Cortex Agent.

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
Step 1: Clarify Architecture Intent
    ↓
Step 2: Generate Diagram via Agent
    ↓
Step 3: Review & Iterate
    ↓
Complete
```

### Step 1: Clarify Architecture Intent

**Goal:** Understand what the user wants to visualize.

**Ask** user (if not clear from request):
```
What architecture would you like to visualize?

1. Medallion Architecture (Bronze/Silver/Gold layers)
2. Real-Time Streaming Pipeline
3. Batch Ingestion Pipeline
4. Data Sharing / Mesh Architecture
5. Custom (describe your architecture)
```

**Gather:**
- Data sources (Kafka, S3, APIs, databases)
- Processing patterns (CDC, tasks, dynamic tables)
- Consumption layer (dashboards, sharing, APIs)

### Step 2: Generate Diagram via Agent

**Tool:** Use `mcp__mcp-server-snowflake__cortex_analyst`

**Invocation:**
```
service_name: snowgram_agent
semantic_model: SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT
query: [user's architecture description - refined]
```

**Prompt Engineering Tips:**
- Be specific: "Kafka → Snowpipe Streaming → Bronze → Silver → Gold"
- Name components clearly: Use `bronze_layer`, `silver_layer`, `cdc_stream`, `transform_task`
- Avoid ambiguous terms: Say "CDC Stream" not "Kafka Stream" for Snowflake streams
- Include consumption: "serving analytics dashboards via Tableau"

**Example Prompts:**

| Pattern | Prompt |
|---------|--------|
| Medallion | "Build a medallion architecture ingesting from Kafka with Snowpipe Streaming into bronze/silver/gold layers, serving Tableau dashboards" |
| Streaming | "Create a real-time pipeline: Confluent Kafka → Snowpipe Streaming → Dynamic Tables → Analytics Views → Warehouse" |
| Batch | "Design batch ingestion from S3 with Snowpipe, transforming through bronze/silver/gold with Tasks" |
| Multi-source | "Show data flowing from Kafka and S3 into a unified medallion architecture" |

### Step 3: Review & Iterate

**MANDATORY STOPPING POINT**: After agent returns, present results to user.

```
The diagram has been generated. Please review:

1. Are components correctly placed?
2. Are boundaries correct (Snowflake vs external)?
3. Do you need to adjust or regenerate?
```

**If issues:**
- Wrong boundary → Rename component to avoid keyword collision
- Wrong icon → Use standard naming (bronze_layer, silver_layer, etc.)
- Missing component → Add to prompt and regenerate

**If approved:** Skill complete.

## Component Reference

### Supported Components

| Stage | Components | Keywords |
|-------|------------|----------|
| 0: Sources | Kafka, S3, Azure, GCP, APIs | `kafka`, `s3`, `azure`, `gcs`, `api` |
| 1: Ingest | Snowpipe, Snowpipe Streaming | `snowpipe`, `snowpipe_streaming` |
| 2: Raw | Bronze Layer | `bronze`, `bronze_layer` |
| 3: Transform | Streams, Tasks, Dynamic Tables | `cdc`, `task`, `dynamic_table` |
| 3.5: Clean | Silver Layer | `silver`, `silver_layer` |
| 4: Curated | Gold Layer | `gold`, `gold_layer` |
| 5: Serve | Views, Warehouse | `view`, `warehouse` |
| 6: Consume | BI Tools, Apps, Sharing | `tableau`, `streamlit`, `share` |

### Boundary Keywords

| Boundary | Triggers |
|----------|----------|
| Snowflake | `bronze`, `silver`, `gold`, `task`, `cdc`, `snowpipe`, `warehouse` |
| Kafka | `kafka`, `confluent`, `kinesis`, `event_hub` |
| AWS | `s3`, `aws` |
| Azure | `azure`, `adls`, `blob` |
| GCP | `gcp`, `gcs`, `bigquery` |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Component in wrong boundary | Label matches wrong provider keyword | Rename: "CDC Stream" not "Kafka Stream" |
| Wrong icon | Non-standard naming | Use: `bronze_layer`, `silver_layer`, `gold_layer` |
| Layout issues | Component naming | Use descriptive labels matching flow stages |

## Output

- Agent returns component definitions with connections
- Frontend (if running): Interactive React Flow diagram at http://localhost:3002
- Export options: Mermaid markdown, PNG/SVG screenshot

## Stopping Points

- After Step 1 if architecture intent is unclear
- After Step 2 for user to review generated diagram
- After any iteration for approval before regenerating
