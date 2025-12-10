# Cortex Agents Reference for SnowGram

> **Quick reference for implementing Cortex Agents in SnowGram**  
> Source: Snowflake Documentation via MCP Server (Nov 14, 2025)

## 🎯 What You Need to Know

Cortex Agents (GA Nov 2025) orchestrate across:
- **Cortex Analyst** - Natural language to SQL over semantic models
- **Cortex Search** - RAG over unstructured documentation
- **Custom Tools** - User-defined functions

### SnowGram Use Case
Agent queries component catalogs → searches docs → generates Mermaid diagrams

---

## 🚀 Quick Deployment

### 1. Create Agent (SQL)

```sql
CREATE OR REPLACE AGENT SNOWGRAM_DB.AGENTS.DIAGRAM_ASSISTANT_AGENT
  COMMENT = 'Diagram generation agent'
  FROM SPECIFICATION
  $$
  {
    "instructions": {
      "response": "You help create Snowflake architecture diagrams",
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
      },
      {
        "tool_spec": {
          "type": "cortex_search_tool",
          "name": "docs_search",
          "description": "Search Snowflake docs"
        }
      }
    ],
    "tool_resources": {
      "catalog_query": {
        "semantic_view": "SNOWGRAM_DB.SEMANTICS.MODULAR_COMPONENT_VIEW",
        "warehouse": "COMPUTE_WH",
        "timeout_seconds": 60
      },
      "docs_search": {
        "cortex_search_service": "SNOWGRAM_DB.KNOWLEDGE.SNOWFLAKE_DOCS_SEARCH",
        "columns": ["chunk", "category", "url"],
        "max_results": 5
      }
    }
  }
  $$;
```

### 2. Grant Permissions

```sql
GRANT USAGE ON AGENT SNOWGRAM_DB.AGENTS.DIAGRAM_ASSISTANT_AGENT 
  TO ROLE SVC_CURSOR_ROLE;
```

### 3. Python Client

```python
import requests

url = f"{SNOWFLAKE_ACCOUNT_URL}/api/v2/databases/SNOWGRAM_DB/schemas/AGENTS/agent/run"
headers = {
    'Authorization': f'Bearer {PAT}',
    'Content-Type': 'application/json'
}
payload = {
    "agent": "DIAGRAM_ASSISTANT_AGENT",
    "messages": [{"role": "user", "content": [{"type": "text", "text": "Create diagram"}]}]
}

with requests.post(url, headers=headers, json=payload, stream=True) as response:
    for line in response.iter_lines():
        print(line.decode('utf-8'))
```

---

## 🔑 Required Privileges

**Creation**:
- `CREATE AGENT` on schema
- `USAGE` on Cortex Search services
- `USAGE` on databases/schemas/tables in semantic models
- `USAGE` on warehouses

**Usage**:
- `USAGE` on agent
- User has default role set
- User has default warehouse set

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

---

## 🧵 Thread Management

```python
# Create thread for conversation context
response = requests.post(f"{base_url}/threads", headers={'Authorization': f'Bearer {PAT}'})
thread_id = response.json()['thread_id']

# Use thread in subsequent calls
payload = {
    "agent": "DIAGRAM_ASSISTANT_AGENT",
    "thread_id": thread_id,
    "messages": [...]
}
```

---

## 📊 Best Practices

1. ✅ **Always use `"orchestration": "auto"`** - Gets best model automatically
2. ✅ **Use threads for multi-turn conversations** - Context maintained server-side
3. ✅ **Provide clear instructions** - Be specific about workflow and expected behavior
4. ✅ **Add sample questions** - Guide users with 3-5 representative examples
5. ✅ **Test tools independently** - Verify Cortex Analyst and Search work first

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Insufficient privileges" | `GRANT CREATE AGENT ON SCHEMA TO ROLE` |
| "Warehouse not found" | `ALTER USER SET DEFAULT_WAREHOUSE` |
| "Agent times out" | Increase `max_duration_seconds` to 300 |
| "Poor quality responses" | Review instructions, add sample questions |

---

## 📚 Implementation Files

**For detailed docs, see**:
- `docs/CORTEX_AGENT_DEPLOYMENT.md` - Full guide (12,000+ words)
- `docs/CORTEX_AGENT_QUICK_REFERENCE.md` - Command cheat sheet

**Official Snowflake Docs**:
- [Cortex Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [CREATE AGENT](https://docs.snowflake.com/en/sql-reference/sql/create-agent)
- [REST API](https://docs.snowflake.com/en/developer-guide/snowflake-cortex/cortex-agents-rest-api)

---

**Researched**: Nov 14, 2025 via `snowflake-docs` MCP Server
