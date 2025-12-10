# Cortex Agent Quick Reference

> **Fast lookup for common Cortex Agent operations**  
> For detailed explanations, see [CORTEX_AGENT_DEPLOYMENT.md](./CORTEX_AGENT_DEPLOYMENT.md)

---

## 🚀 Quick Start Commands

### Create Agent (SQL)

```sql
CREATE OR REPLACE AGENT SNOWGRAM_DB.AGENTS.DIAGRAM_ASSISTANT_AGENT
  COMMENT = 'Diagram generation agent'
  FROM SPECIFICATION
  $$
  {
    "instructions": {
      "response": "You help create architecture diagrams",
      "orchestration": "Query component catalog, then generate Mermaid code",
      "system": "You have access to Cortex Analyst and Cortex Search"
    },
    "models": {
      "orchestration": "auto"
    },
    "tools": [
      {
        "tool_spec": {
          "type": "cortex_analyst_tool",
          "name": "catalog_query",
          "description": "Query component catalog"
        }
      }
    ],
    "tool_resources": {
      "catalog_query": {
        "semantic_view": "SNOWGRAM_DB.SEMANTICS.COMPONENT_VIEW",
        "warehouse": "COMPUTE_WH"
      }
    }
  }
  $$;
```

### Grant Permissions

```sql
-- Grant usage to role
GRANT USAGE ON AGENT SNOWGRAM_DB.AGENTS.DIAGRAM_ASSISTANT_AGENT 
  TO ROLE SNOWGRAM_AGENT_USER_ROLE;

-- Grant to user
GRANT ROLE SNOWGRAM_AGENT_USER_ROLE TO USER SVC_CURSOR;
```

### Query Agent (Python)

```python
import requests

url = f"{SNOWFLAKE_ACCOUNT_URL}/api/v2/databases/SNOWGRAM_DB/schemas/AGENTS/agent/run"
headers = {
    'Authorization': f'Bearer {PAT}',
    'Content-Type': 'application/json'
}
payload = {
    "agent": "DIAGRAM_ASSISTANT_AGENT",
    "messages": [
        {
            "role": "user",
            "content": [{"type": "text", "text": "Create a Kafka pipeline"}]
        }
    ]
}

response = requests.post(url, headers=headers, json=payload, stream=True)
for line in response.iter_lines():
    print(line.decode('utf-8'))
```

---

## 📋 Required Privileges Checklist

### Agent Creation
- [ ] `CREATE AGENT` on schema
- [ ] `USAGE` on Cortex Search services
- [ ] `USAGE` on databases/schemas/tables in semantic models
- [ ] `USAGE` on warehouses

### Agent Usage
- [ ] `USAGE` on agent
- [ ] User has default role set
- [ ] User has default warehouse set

### Agent Monitoring
- [ ] `MONITOR` on agent
- [ ] `CORTEX_USER` database role
- [ ] `AI_OBSERVABILITY_EVENTS_LOOKUP` application role

---

## 🛠️ Tool Configuration Patterns

### Cortex Analyst Tool

```json
{
  "tool_spec": {
    "type": "cortex_analyst_tool",
    "name": "my_analyst",
    "description": "Query structured data"
  }
}

// Tool Resources
{
  "my_analyst": {
    "semantic_view": "DB.SCHEMA.VIEW_NAME",
    "warehouse": "COMPUTE_WH",
    "timeout_seconds": 60
  }
}
```

### Cortex Search Tool

```json
{
  "tool_spec": {
    "type": "cortex_search_tool",
    "name": "my_search",
    "description": "Search unstructured data"
  }
}

// Tool Resources
{
  "my_search": {
    "cortex_search_service": "DB.SCHEMA.SERVICE_NAME",
    "columns": ["chunk", "metadata"],
    "max_results": 5,
    "filter": {"category": "docs"}
  }
}
```

### Custom Tool

```json
{
  "tool_spec": {
    "type": "custom_tool",
    "name": "my_function",
    "description": "Execute custom logic"
  }
}

// Tool Resources
{
  "my_function": {
    "warehouse": "COMPUTE_WH",
    "function": "DB.SCHEMA.FUNCTION_NAME"
  }
}
```

---

## 🔍 Common SQL Commands

### Show Agents

```sql
SHOW AGENTS IN SCHEMA SNOWGRAM_DB.AGENTS;
```

### Describe Agent

```sql
DESCRIBE AGENT SNOWGRAM_DB.AGENTS.DIAGRAM_ASSISTANT_AGENT;
```

### Drop Agent

```sql
DROP AGENT IF EXISTS SNOWGRAM_DB.AGENTS.DIAGRAM_ASSISTANT_AGENT;
```

### Query Agent Logs

```sql
SELECT * 
FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_LOGS
WHERE AGENT_NAME = 'DIAGRAM_ASSISTANT_AGENT'
  AND TIMESTAMP > DATEADD(hour, -24, CURRENT_TIMESTAMP())
ORDER BY TIMESTAMP DESC;
```

---

## 🧵 Thread Management

### Create Thread

```http
POST /api/v2/databases/{db}/schemas/{schema}/threads
```

```python
response = requests.post(
    f"{base_url}/threads",
    headers={'Authorization': f'Bearer {PAT}'}
)
thread_id = response.json()['thread_id']
```

### Use Thread

```python
payload = {
    "agent": "DIAGRAM_ASSISTANT_AGENT",
    "thread_id": thread_id,  # Pass thread ID
    "messages": [...]
}
```

### List Messages in Thread

```http
GET /api/v2/databases/{db}/schemas/{schema}/threads/{thread_id}/messages
```

---

## 🐛 Troubleshooting Checklist

### Agent Won't Create
1. Check `CREATE AGENT` privilege on schema
2. Verify all referenced objects exist (semantic views, search services)
3. Validate JSON syntax in specification
4. Check warehouse exists and is accessible

### Agent Won't Run
1. Verify user has `USAGE` on agent
2. Check user has default role set: `SHOW PARAMETERS LIKE 'DEFAULT_ROLE' IN USER <user>`
3. Check user has default warehouse set: `SHOW PARAMETERS LIKE 'DEFAULT_WAREHOUSE' IN USER <user>`
4. Verify PAT token is valid and not expired

### Poor Quality Responses
1. Review instructions - are they specific?
2. Check if using `"orchestration": "auto"` for model
3. Test semantic models directly with Cortex Analyst
4. Add sample questions to guide behavior

### Timeout Errors
1. Increase `max_duration_seconds` in orchestration config
2. Optimize semantic model queries
3. Use larger warehouse for Cortex Analyst
4. Check if Cortex Search service is responsive

---

## 📚 Key Configuration Defaults

| Parameter | Default | Recommendation |
|-----------|---------|----------------|
| `orchestration.max_duration_seconds` | 120 | Use 300 for complex workflows |
| `orchestration.max_tokens` | 50000 | Keep default |
| `models.orchestration` | N/A | Always set to `"auto"` |
| `tool_resources.timeout_seconds` | 60 | Increase for slow queries |
| `tool_resources.max_results` | 10 | Reduce to 3-5 for focused results |

---

## 🔗 API Endpoints

### Agent Management

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v2/databases/{db}/schemas/{schema}/agents` | Create agent |
| GET | `/api/v2/databases/{db}/schemas/{schema}/agents` | List agents |
| GET | `/api/v2/databases/{db}/schemas/{schema}/agents/{name}` | Get agent details |
| PUT | `/api/v2/databases/{db}/schemas/{schema}/agents/{name}` | Update agent |
| DELETE | `/api/v2/databases/{db}/schemas/{schema}/agents/{name}` | Delete agent |

### Agent Execution

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v2/databases/{db}/schemas/{schema}/agent/run` | Run agent (streaming) |

### Thread Management

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v2/databases/{db}/schemas/{schema}/threads` | Create thread |
| GET | `/api/v2/databases/{db}/schemas/{schema}/threads/{id}/messages` | List messages |

---

## 💡 Best Practices Summary

1. ✅ **Always use `"auto"` for model selection** - Gets best quality automatically
2. ✅ **Use threads for multi-turn conversations** - Maintains context server-side
3. ✅ **Grant minimal privileges** - Use service accounts with only required access
4. ✅ **Monitor agent logs** - Query `SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_LOGS`
5. ✅ **Test tools independently** - Verify Cortex Analyst and Search work before composing
6. ✅ **Provide clear instructions** - Be specific about workflow and expected behavior
7. ✅ **Add sample questions** - Guide users with 3-5 representative examples
8. ✅ **Version control agent specs** - Store JSON specs in Git for reproducibility

---

## 🎯 SnowGram-Specific Setup

### 1. Databases and Schemas

```sql
CREATE DATABASE IF NOT EXISTS SNOWGRAM_DB;
CREATE SCHEMA IF NOT EXISTS SNOWGRAM_DB.AGENTS;
CREATE SCHEMA IF NOT EXISTS SNOWGRAM_DB.SEMANTICS;
CREATE SCHEMA IF NOT EXISTS SNOWGRAM_DB.KNOWLEDGE;
```

### 2. Service Account

```sql
CREATE USER IF NOT EXISTS SVC_SNOWGRAM_AGENT
  TYPE = SERVICE
  DEFAULT_ROLE = SNOWGRAM_AGENT_USER_ROLE
  DEFAULT_WAREHOUSE = COMPUTE_WH;
```

### 3. Role Hierarchy

```sql
CREATE ROLE IF NOT EXISTS SNOWGRAM_AGENT_USER_ROLE;

GRANT USAGE ON DATABASE SNOWGRAM_DB TO ROLE SNOWGRAM_AGENT_USER_ROLE;
GRANT USAGE ON ALL SCHEMAS IN DATABASE SNOWGRAM_DB TO ROLE SNOWGRAM_AGENT_USER_ROLE;
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE SNOWGRAM_AGENT_USER_ROLE;

GRANT ROLE SNOWGRAM_AGENT_USER_ROLE TO USER SVC_SNOWGRAM_AGENT;
```

### 4. Agent Dependencies

```sql
-- Semantic view for Cortex Analyst
CREATE OR REPLACE VIEW SNOWGRAM_DB.SEMANTICS.MODULAR_COMPONENT_VIEW AS
SELECT * FROM SNOWGRAM_DB.CORE.MODULAR_COMPONENT_CATALOG;

-- Cortex Search service for docs
CREATE CORTEX SEARCH SERVICE SNOWGRAM_DB.KNOWLEDGE.SNOWFLAKE_DOCS_SEARCH
  ON chunk
  WAREHOUSE = COMPUTE_WH
  TARGET_LAG = '1 hour'
  AS (
    SELECT chunk, category, url, metadata
    FROM SNOWGRAM_DB.KNOWLEDGE.DOCUMENTATION_CHUNKS
  );
```

---

## 📞 Support Resources

- **Full Deployment Guide**: [CORTEX_AGENT_DEPLOYMENT.md](./CORTEX_AGENT_DEPLOYMENT.md)
- **Snowflake Docs**: [docs.snowflake.com/cortex-agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- **REST API Reference**: [docs.snowflake.com/cortex-agents-rest-api](https://docs.snowflake.com/en/developer-guide/snowflake-cortex/cortex-agents-rest-api)

---

**Quick Reference Compiled By**: Cursor Agent  
**Source**: `snowflake-docs` MCP Server  
**Last Updated**: November 14, 2025

