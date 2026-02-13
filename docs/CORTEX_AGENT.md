# Cortex Agent Guide

> **Complete guide for deploying and using Cortex Agents in SnowGram**  
> Last updated: 2026-02-13

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Overview](#overview)
3. [Prerequisites](#prerequisites)
4. [Deployment](#deployment)
5. [Configuration](#configuration)
6. [API Reference](#api-reference)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Quick Reference

### Create Agent (SQL)

```sql
CREATE OR REPLACE AGENT SNOWGRAM_DB.AGENTS.DIAGRAM_ASSISTANT_AGENT
  COMMENT = 'Diagram generation agent'
  FROM SPECIFICATION $$
  {
    "instructions": {
      "response": "You help create architecture diagrams",
      "orchestration": "Query component catalog, then generate Mermaid code",
      "system": "You have access to Cortex Analyst and Cortex Search"
    },
    "models": { "orchestration": "auto" },
    "tools": [
      { "tool_spec": { "type": "cortex_analyst_tool", "name": "catalog_query", "description": "Query component catalog" } }
    ],
    "tool_resources": {
      "catalog_query": { "semantic_view": "SNOWGRAM_DB.SEMANTICS.COMPONENT_VIEW", "warehouse": "COMPUTE_WH" }
    }
  }
  $$;
```

### Grant Permissions

```sql
GRANT USAGE ON AGENT SNOWGRAM_DB.AGENTS.DIAGRAM_ASSISTANT_AGENT TO ROLE SNOWGRAM_AGENT_USER_ROLE;
```

### Common Commands

| Command | Purpose |
|---------|---------|
| `SHOW AGENTS IN SCHEMA db.schema` | List agents |
| `DESCRIBE AGENT db.schema.agent` | View agent details |
| `DROP AGENT IF EXISTS db.schema.agent` | Delete agent |

### Required Privileges Checklist

**For Creation:**
- [ ] `CREATE AGENT` on schema
- [ ] `USAGE` on Cortex Search services
- [ ] `USAGE` on semantic model objects
- [ ] `USAGE` on warehouses

**For Usage:**
- [ ] `USAGE` on agent
- [ ] User has default role set
- [ ] User has default warehouse set

---

## Overview

**Cortex Agents** orchestrate across structured and unstructured data to deliver insights. They plan tasks, use tools, and generate responses.

### Architecture

```
User Query
    ↓
Cortex Agent (Claude Sonnet 4 / GPT-5)
    ├─→ Cortex Analyst (structured data via semantic models)
    ├─→ Cortex Search (unstructured data via RAG)
    └─→ Custom Tools (UDFs/procedures)
    ↓
Response to User
```

### Tool Types

| Tool | Purpose | Configuration |
|------|---------|---------------|
| `cortex_analyst_tool` | Query structured data | Semantic view + warehouse |
| `cortex_search_tool` | Search unstructured data | Search service + columns |
| `custom_tool` | Execute custom logic | Function + warehouse |

---

## Prerequisites

### Account Requirements

- Snowflake Enterprise Edition or higher
- Cortex AI enabled (all public cloud regions)
- AWS, Azure, or GCP deployment

### Required Objects

1. **Database & Schema** for agent
2. **Warehouse** for Cortex Analyst queries
3. **Semantic Models/Views** for structured data
4. **Cortex Search Services** for unstructured data
5. **Custom Functions** (optional)

### User Setup

```sql
-- Set default role and warehouse
ALTER USER <user> SET DEFAULT_ROLE = SNOWGRAM_AGENT_USER_ROLE;
ALTER USER <user> SET DEFAULT_WAREHOUSE = COMPUTE_WH;
```

---

## Deployment

### Method 1: SQL (Recommended)

```sql
CREATE OR REPLACE AGENT SNOWGRAM_DB.AGENTS.DIAGRAM_ASSISTANT_AGENT
  COMMENT = 'AI agent for generating Snowflake architecture diagrams'
  FROM SPECIFICATION $$
  {
    "instructions": {
      "response": "You are a Snowflake architecture expert helping create diagrams.",
      "orchestration": "1) Query component catalog, 2) Search docs, 3) Generate Mermaid code",
      "system": "You have access to Cortex Analyst and Cortex Search.",
      "sample_questions": [
        "Create a real-time Kafka to Snowflake pipeline",
        "Show me an RBAC security pattern"
      ]
    },
    "models": { "orchestration": "auto" },
    "orchestration": { "max_duration_seconds": 120, "max_tokens": 50000 },
    "tools": [
      {
        "tool_spec": {
          "type": "cortex_analyst_tool",
          "name": "component_catalog_query",
          "description": "Query the modular component catalog"
        }
      },
      {
        "tool_spec": {
          "type": "cortex_search_tool",
          "name": "snowflake_docs_search",
          "description": "Search Snowflake documentation"
        }
      }
    ],
    "tool_resources": {
      "component_catalog_query": {
        "semantic_view": "SNOWGRAM_DB.SEMANTICS.MODULAR_COMPONENT_VIEW",
        "warehouse": "COMPUTE_WH",
        "timeout_seconds": 60
      },
      "snowflake_docs_search": {
        "cortex_search_service": "SNOWGRAM_DB.KNOWLEDGE.SNOWFLAKE_DOCS_SEARCH",
        "columns": ["chunk", "category", "url"],
        "max_results": 5
      }
    }
  }
  $$;
```

### Method 2: REST API

```python
import requests

url = f"{SNOWFLAKE_ACCOUNT_URL}/api/v2/databases/SNOWGRAM_DB/schemas/AGENTS/agents"
headers = {
    'Authorization': f'Bearer {PAT}',
    'Content-Type': 'application/json'
}
payload = {
    "name": "DIAGRAM_ASSISTANT_AGENT",
    "specification": { ... }  # Same as SQL spec
}

response = requests.post(url, headers=headers, json=payload)
```

### Method 3: Snowsight UI

1. Navigate to **AI & ML** > **Cortex Agents**
2. Click **+ Agent**
3. Configure tools and instructions
4. Click **Create Agent**

---

## Configuration

### Instructions Object

```json
{
  "instructions": {
    "response": "How to format and deliver responses",
    "orchestration": "How to plan and use tools (step-by-step)",
    "system": "Background context about role and capabilities",
    "sample_questions": ["Example 1", "Example 2"]
  }
}
```

### Models Configuration

```json
{
  "models": {
    "orchestration": "auto"  // Recommended - auto-selects best model
  }
}
```

| Model | Use Case |
|-------|----------|
| `auto` | **Recommended** - highest quality |
| `claude-sonnet-4-5` | Latest Claude |
| `openai-gpt-5` | Latest GPT |

### Orchestration Configuration

```json
{
  "orchestration": {
    "max_duration_seconds": 120,  // Increase to 300 for complex workflows
    "max_tokens": 50000
  }
}
```

### Tool Resources

**Cortex Analyst:**
```json
{
  "tool_resources": {
    "<tool_name>": {
      "semantic_view": "DB.SCHEMA.VIEW_NAME",
      "warehouse": "WAREHOUSE_NAME",
      "timeout_seconds": 60
    }
  }
}
```

**Cortex Search:**
```json
{
  "tool_resources": {
    "<tool_name>": {
      "cortex_search_service": "DB.SCHEMA.SERVICE_NAME",
      "columns": ["chunk", "metadata"],
      "max_results": 5,
      "filter": {"category": "docs"}
    }
  }
}
```

**Custom Tool:**
```json
{
  "tool_resources": {
    "<tool_name>": {
      "warehouse": "WAREHOUSE_NAME",
      "function": "DB.SCHEMA.FUNCTION_NAME"
    }
  }
}
```

---

## API Reference

### Agent Management

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v2/databases/{db}/schemas/{schema}/agents` | Create agent |
| GET | `/api/v2/databases/{db}/schemas/{schema}/agents` | List agents |
| GET | `/api/v2/databases/{db}/schemas/{schema}/agents/{name}` | Get details |
| PUT | `/api/v2/databases/{db}/schemas/{schema}/agents/{name}` | Update |
| DELETE | `/api/v2/databases/{db}/schemas/{schema}/agents/{name}` | Delete |

### Agent Execution

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v2/databases/{db}/schemas/{schema}/agent/run` | Run (streaming) |

### Thread Management

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v2/databases/{db}/schemas/{schema}/threads` | Create thread |
| GET | `/api/v2/databases/{db}/schemas/{schema}/threads/{id}/messages` | List messages |

### Python Client Example

```python
import requests
import json

class CortexAgentClient:
    def __init__(self, account_url: str, pat_token: str):
        self.account_url = account_url.rstrip('/')
        self.headers = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'Authorization': f'Bearer {pat_token}'
        }
    
    def run_agent(self, database, schema, agent_name, message, thread_id=None):
        url = f"{self.account_url}/api/v2/databases/{database}/schemas/{schema}/agent/run"
        payload = {
            "agent": agent_name,
            "messages": [{"role": "user", "content": [{"type": "text", "text": message}]}]
        }
        if thread_id:
            payload["thread_id"] = thread_id
        
        with requests.post(url, headers=self.headers, json=payload, stream=True) as response:
            for line in response.iter_lines():
                if line and line.decode('utf-8').startswith('data: '):
                    data = line.decode('utf-8')[6:]
                    if data.strip() != '[DONE]':
                        yield json.loads(data)
```

---

## Best Practices

### 1. Model Selection

✅ Always use `"orchestration": "auto"` for best quality

### 2. Instructions

✅ Be specific about workflow steps
✅ Include 3-5 sample questions
✅ Define expected response format

### 3. Warehouse Sizing

| Use Case | Size |
|----------|------|
| Simple queries | S, M |
| Complex joins | L, XL |
| High concurrency | Multi-cluster |

### 4. Security

```sql
-- Use service accounts with minimal privileges
CREATE USER IF NOT EXISTS SVC_SNOWGRAM_AGENT
  TYPE = SERVICE
  DEFAULT_ROLE = SNOWGRAM_AGENT_USER_ROLE
  DEFAULT_WAREHOUSE = COMPUTE_WH;
```

### 5. Observability

```sql
-- Query agent logs
SELECT * FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_LOGS
WHERE AGENT_NAME = 'DIAGRAM_ASSISTANT_AGENT'
ORDER BY TIMESTAMP DESC LIMIT 100;
```

---

## Troubleshooting

### "Insufficient privileges to create agent"

```sql
GRANT CREATE AGENT ON SCHEMA SNOWGRAM_DB.AGENTS TO ROLE SYSADMIN;
```

### "Warehouse not found"

```sql
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE SNOWGRAM_AGENT_USER_ROLE;
```

### "Cortex Search service not found"

```sql
SHOW CORTEX SEARCH SERVICES IN SCHEMA SNOWGRAM_DB.KNOWLEDGE;
GRANT USAGE ON CORTEX SEARCH SERVICE ... TO ROLE SNOWGRAM_AGENT_USER_ROLE;
```

### "Agent times out"

```json
{ "orchestration": { "max_duration_seconds": 300 } }
```

### "Low quality responses"

1. ✅ Instructions specific?
2. ✅ Sample questions representative?
3. ✅ Semantic models have synonyms?
4. ✅ Using `"auto"` for model?

---

## SnowGram Setup

### 1. Create Schemas

```sql
CREATE DATABASE IF NOT EXISTS SNOWGRAM_DB;
CREATE SCHEMA IF NOT EXISTS SNOWGRAM_DB.AGENTS;
CREATE SCHEMA IF NOT EXISTS SNOWGRAM_DB.SEMANTICS;
CREATE SCHEMA IF NOT EXISTS SNOWGRAM_DB.KNOWLEDGE;
```

### 2. Create Role

```sql
CREATE ROLE IF NOT EXISTS SNOWGRAM_AGENT_USER_ROLE;
GRANT USAGE ON DATABASE SNOWGRAM_DB TO ROLE SNOWGRAM_AGENT_USER_ROLE;
GRANT USAGE ON ALL SCHEMAS IN DATABASE SNOWGRAM_DB TO ROLE SNOWGRAM_AGENT_USER_ROLE;
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE SNOWGRAM_AGENT_USER_ROLE;
```

### 3. Create Service Account

```sql
CREATE USER IF NOT EXISTS SVC_SNOWGRAM_AGENT
  TYPE = SERVICE
  DEFAULT_ROLE = SNOWGRAM_AGENT_USER_ROLE
  DEFAULT_WAREHOUSE = COMPUTE_WH;
GRANT ROLE SNOWGRAM_AGENT_USER_ROLE TO USER SVC_SNOWGRAM_AGENT;
```

---

## Resources

- [Cortex Agents Overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [CREATE AGENT Reference](https://docs.snowflake.com/en/sql-reference/sql/create-agent)
- [REST API Reference](https://docs.snowflake.com/en/developer-guide/snowflake-cortex/cortex-agents-rest-api)
- [Monitoring Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents/monitoring)

---

*Last updated: 2026-02-13*
