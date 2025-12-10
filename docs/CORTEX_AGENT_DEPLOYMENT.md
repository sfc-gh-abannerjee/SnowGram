# Cortex Agent Deployment Guide for SnowGram

> **Comprehensive guide for deploying Cortex Agents in Snowflake**  
> Researched from official Snowflake documentation via `snowflake-docs` MCP server  
> Last Updated: November 14, 2025

## 📋 Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Access Control & Permissions](#access-control--permissions)
4. [Agent Architecture](#agent-architecture)
5. [Deployment Methods](#deployment-methods)
6. [Configuration Specification](#configuration-specification)
7. [Integration with SnowGram](#integration-with-snowgram)
8. [Thread Management](#thread-management)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

---

## Overview

**Cortex Agents** orchestrate across both structured and unstructured data sources to deliver insights. They plan tasks, use tools to execute these tasks, and generate responses.

### Key Capabilities

- **Multi-Tool Orchestration**: Combines Cortex Analyst (structured data), Cortex Search (unstructured data), and custom tools
- **LLM-Powered Planning**: Uses Claude Sonnet 4 or GPT-5 for intelligent task decomposition
- **Thread Management**: Maintains conversation context server-side
- **RBAC Integration**: Inherits Snowflake's role-based access control
- **REST API Access**: Deploy once, consume from any application

### SnowGram Use Case

In SnowGram, the Cortex Agent will:
1. Query semantic models to find relevant component blocks (`modular_component_catalog`)
2. Search reference templates for similar patterns (`CORTEX_SEARCH` on documentation)
3. Compose Mermaid code by stitching together pre-built blocks
4. Generate explanations and handle iterative refinements

**Source**: [Cortex Agents Documentation](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)

---

## Prerequisites

### Account Requirements

- Snowflake account with Cortex AI enabled (available in all public cloud regions as of Nov 2025)
- **Minimum Snowflake Version**: Enterprise Edition or higher
- **Regions**: AWS, Azure, GCP (all public cloud deployments)

### Required Snowflake Objects

Before deploying a Cortex Agent, ensure you have:

1. **Database & Schema**: Where the agent object will reside
2. **Warehouse**: For executing Cortex Analyst queries (not required for Cortex Search)
3. **Semantic Models/Views**: For Cortex Analyst tool
4. **Cortex Search Services**: For unstructured data retrieval
5. **Custom Tools (Optional)**: For specialized functionality (e.g., Mermaid generation)

### User Setup

Each user interacting with the agent must:
- Have a **default role** set (`ALTER USER <user> SET DEFAULT_ROLE = <role>`)
- Have a **default warehouse** set (`ALTER USER <user> SET DEFAULT_WAREHOUSE = <warehouse>`)
- Be granted **USAGE** on the agent object

**Source**: [Configure and Interact with Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents/configure-and-interact)

---

## Access Control & Permissions

### Required Privileges for Agent Creation

| Privilege | Object | Notes |
|-----------|--------|-------|
| `CREATE AGENT` | Schema | Required to create the Cortex Agent |
| `USAGE` | Cortex Search Service | Required to run Cortex Search services in the agent |
| `USAGE` | Database, Schema, Table | Required for objects referenced in Cortex Analyst semantic models |

### Required Privileges for Agent Usage

| Privilege | Object | Notes |
|-----------|--------|-------|
| `USAGE` | Agent | Required to query the agent and generate responses |
| `MODIFY` | Agent | Required to update the agent configuration |
| `MONITOR` | Agent | Required to view threads, logs, and traces |
| `OWNERSHIP` | Agent | Full control over the agent (automatically granted to creator role) |

### Example: Grant Setup for SnowGram

```sql
-- Create a role for SnowGram agent users
CREATE ROLE IF NOT EXISTS SNOWGRAM_AGENT_USER_ROLE;

-- Grant schema privileges
GRANT CREATE AGENT ON SCHEMA SNOWGRAM_DB.AGENTS TO ROLE SYSADMIN;

-- Grant usage on semantic views (Cortex Analyst)
GRANT USAGE ON DATABASE SNOWGRAM_DB TO ROLE SNOWGRAM_AGENT_USER_ROLE;
GRANT USAGE ON SCHEMA SNOWGRAM_DB.SEMANTICS TO ROLE SNOWGRAM_AGENT_USER_ROLE;
GRANT SELECT ON ALL VIEWS IN SCHEMA SNOWGRAM_DB.SEMANTICS TO ROLE SNOWGRAM_AGENT_USER_ROLE;

-- Grant usage on Cortex Search services
GRANT USAGE ON CORTEX SEARCH SERVICE SNOWGRAM_DB.KNOWLEDGE.SNOWFLAKE_DOCS_SEARCH 
  TO ROLE SNOWGRAM_AGENT_USER_ROLE;

-- Grant warehouse usage
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE SNOWGRAM_AGENT_USER_ROLE;

-- Grant agent usage to end users
GRANT USAGE ON AGENT SNOWGRAM_DB.AGENTS.DIAGRAM_ASSISTANT_AGENT 
  TO ROLE SNOWGRAM_AGENT_USER_ROLE;

-- Grant role to service user
GRANT ROLE SNOWGRAM_AGENT_USER_ROLE TO USER SVC_CURSOR;
```

**Source**: [CREATE AGENT Privileges](https://docs.snowflake.com/en/sql-reference/sql/create-agent#access-control-requirements)

---

## Agent Architecture

### Agentic Workflow

```text
┌─────────────────────────────────────────────────────────────┐
│                      User Question                          │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Cortex Agent (Claude Sonnet 4)                 │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Planning   │→ │ Tool Use     │→ │  Reflection  │    │
│  │   (LLM)      │  │ (Execution)  │  │  (Evaluate)  │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│         │                  │                  │            │
│         └──────────────────┴──────────────────┘            │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Cortex Analyst  │ │ Cortex Search   │ │  Custom Tools   │
│                 │ │                 │ │                 │
│ Semantic Models │ │ RAG over Docs   │ │ Mermaid Gen     │
│ SQL Generation  │ │ Vector Search   │ │ Validation      │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                   │                   │
         └───────────────────┴───────────────────┘
                             │
                             ▼
                   ┌─────────────────┐
                   │   Response      │
                   │   to User       │
                   └─────────────────┘
```

### Tool Types

1. **Cortex Analyst**: Natural language to SQL over semantic models
   - Tool name: `cortex_analyst_tool`
   - Requires: Semantic view or semantic model file
   - Executes: SQL queries in specified warehouse

2. **Cortex Search**: Semantic search over unstructured data
   - Tool name: `cortex_search_tool`
   - Requires: Cortex Search service
   - Executes: Vector similarity search with filters

3. **Custom Tools**: User-defined functions or procedures
   - Tool name: User-defined
   - Requires: Warehouse for execution
   - Executes: SQL functions, Python UDFs, etc.

**Source**: [Cortex Agent Concepts](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents/overview#cortex-agent-concepts)

---

## Deployment Methods

### Method 1: SQL (CREATE AGENT)

**Best for**: Production deployments, version control, CI/CD pipelines

#### Syntax

```sql
CREATE [ OR REPLACE ] AGENT [ IF NOT EXISTS ] <name>
  [ COMMENT = '<comment>' ]
  [ PROFILE = '<profile_object>' ]
  FROM SPECIFICATION
  $$
  <specification_object>
  $$;
```

#### Example: SnowGram Diagram Assistant Agent

```sql
CREATE OR REPLACE AGENT SNOWGRAM_DB.AGENTS.DIAGRAM_ASSISTANT_AGENT
  COMMENT = 'AI agent for generating Snowflake architecture diagrams'
  FROM SPECIFICATION
  $$
  {
    "instructions": {
      "response": "You are a Snowflake architecture expert helping Solution Engineers create diagrams. Always suggest modular component blocks first, then compose them into patterns.",
      "orchestration": "When asked to create a diagram: 1) Query modular_component_catalog for relevant blocks, 2) Search reference templates for similar patterns, 3) Generate Mermaid code, 4) Explain components used.",
      "system": "You have access to Cortex Analyst for querying component catalogs and Cortex Search for Snowflake documentation. Use these tools intelligently.",
      "sample_questions": [
        "Create a real-time Kafka to Snowflake pipeline",
        "Show me an RBAC security pattern",
        "Generate a batch data warehouse architecture"
      ]
    },
    "models": {
      "orchestration": "auto"
    },
    "orchestration": {
      "max_duration_seconds": 120,
      "max_tokens": 50000
    },
    "tools": [
      {
        "tool_spec": {
          "type": "cortex_analyst_tool",
          "name": "component_catalog_query",
          "description": "Query the modular component catalog to find blocks, patterns, and templates"
        }
      },
      {
        "tool_spec": {
          "type": "cortex_search_tool",
          "name": "snowflake_docs_search",
          "description": "Search Snowflake documentation for best practices and syntax"
        }
      },
      {
        "tool_spec": {
          "type": "custom_tool",
          "name": "mermaid_generator",
          "description": "Generate Mermaid diagram code from component blocks"
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
      },
      "mermaid_generator": {
        "warehouse": "COMPUTE_WH",
        "function": "SNOWGRAM_DB.CORE.GENERATE_MERMAID_FROM_BLOCKS"
      }
    }
  }
  $$;
```

#### Specification Object Keys

| Key | Type | Description |
|-----|------|-------------|
| `instructions` | `AgentInstructions` | Instructions for response, orchestration, system, and sample questions |
| `models` | `ModelConfig` | Orchestration model (use `"auto"` for best quality) |
| `orchestration` | `OrchestrationConfig` | Budget constraints (max duration, tokens) |
| `tools` | `array of Tool` | List of tools available to the agent |
| `tool_resources` | `object` | Resources (semantic views, search services, warehouses) for each tool |

**Source**: [CREATE AGENT Syntax](https://docs.snowflake.com/en/sql-reference/sql/create-agent)

---

### Method 2: REST API

**Best for**: Programmatic creation, dynamic configuration, external orchestration

#### Create Agent Endpoint

```http
POST /api/v2/databases/{database}/schemas/{schema}/agents
```

#### Example: Python Request

```python
import requests
import os

SNOWFLAKE_ACCOUNT_URL = os.environ['SNOWFLAKE_ACCOUNT_URL']
PAT = os.environ['SNOWFLAKE_PAT']  # Personal Access Token

url = f"{SNOWFLAKE_ACCOUNT_URL}/api/v2/databases/SNOWGRAM_DB/schemas/AGENTS/agents"

headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': f'Bearer {PAT}',
    'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT'
}

payload = {
    "name": "DIAGRAM_ASSISTANT_AGENT",
    "comment": "AI agent for generating Snowflake architecture diagrams",
    "specification": {
        "instructions": {
            "response": "You are a Snowflake architecture expert...",
            "orchestration": "When asked to create a diagram...",
            "system": "You have access to Cortex Analyst...",
            "sample_questions": [
                "Create a real-time Kafka to Snowflake pipeline"
            ]
        },
        "models": {
            "orchestration": "auto"
        },
        "tools": [
            {
                "tool_spec": {
                    "type": "cortex_analyst_tool",
                    "name": "component_catalog_query",
                    "description": "Query the modular component catalog"
                }
            }
        ],
        "tool_resources": {
            "component_catalog_query": {
                "semantic_view": "SNOWGRAM_DB.SEMANTICS.MODULAR_COMPONENT_VIEW",
                "warehouse": "COMPUTE_WH",
                "timeout_seconds": 60
            }
        }
    }
}

response = requests.post(url, headers=headers, json=payload)
print(response.json())
```

**Source**: [Cortex Agents REST API](https://docs.snowflake.com/en/developer-guide/snowflake-cortex/cortex-agents-rest-api)

---

### Method 3: Snowsight UI (Admin Console)

**Best for**: Exploratory development, non-technical users, quick prototyping

#### Steps

1. Navigate to **AI & ML** > **Cortex Agents** in Snowsight
2. Click **+ Agent**
3. Enter agent name and description
4. Add sample questions
5. Configure tools:
   - **Cortex Analyst**: Select semantic view, warehouse
   - **Cortex Search**: Select search service, configure filters
   - **Custom Tools**: Define function reference
6. Click **Create Agent**

**Note**: For SnowGram, prefer SQL or REST API methods for version control and reproducibility.

**Source**: [Configure and Interact with Agents - Snowsight UI](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents/configure-and-interact#method-1-snowsight-ui)

---

## Configuration Specification

### Instructions Object

```json
{
  "instructions": {
    "response": "How the agent should format and deliver responses",
    "orchestration": "How the agent should plan and use tools",
    "system": "Background context about the agent's role and capabilities",
    "sample_questions": ["Example question 1", "Example question 2"]
  }
}
```

#### Best Practices for Instructions

- **Response**: Define tone, format, and level of detail
- **Orchestration**: Provide a step-by-step workflow (e.g., "1) Query catalog, 2) Search docs, 3) Generate code")
- **System**: Give context about data sources and tools available
- **Sample Questions**: Provide 3-5 representative examples to guide users

---

### Models Configuration

```json
{
  "models": {
    "orchestration": "auto"
  }
}
```

#### Available Models

| Model | Use Case |
|-------|----------|
| `auto` | **Recommended** - Automatically selects highest quality model |
| `claude-sonnet-4-5` | Latest Claude model (highest quality) |
| `claude-4-sonnet` | Previous generation Claude |
| `openai-gpt-5` | Latest GPT model |
| `openai-gpt-4-1` | Previous generation GPT |

**Recommendation**: Use `"auto"` to always get the best available model.

**Source**: [Cortex Agent Models](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents/overview#models)

---

### Orchestration Configuration

```json
{
  "orchestration": {
    "max_duration_seconds": 120,
    "max_tokens": 50000
  }
}
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_duration_seconds` | 120 | Maximum time for agent to execute (including all tool calls) |
| `max_tokens` | 50000 | Maximum tokens for agent's working context |

---

### Tool Resources

#### Cortex Analyst Tool Resources

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

| Parameter | Required | Description |
|-----------|----------|-------------|
| `semantic_view` | Yes | Fully qualified name of semantic view (or use `semantic_model_file` for stage path) |
| `warehouse` | Yes | Warehouse to execute SQL queries |
| `timeout_seconds` | No | Query timeout (default: 60) |

#### Cortex Search Tool Resources

```json
{
  "tool_resources": {
    "<tool_name>": {
      "cortex_search_service": "DB.SCHEMA.SERVICE_NAME",
      "columns": ["chunk", "metadata"],
      "max_results": 5,
      "filter": {"category": "documentation"}
    }
  }
}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `cortex_search_service` | Yes | Fully qualified name of Cortex Search service |
| `columns` | No | Columns to return (default: all) |
| `max_results` | No | Maximum results per search (default: 10) |
| `filter` | No | Metadata filters for search |

**Source**: [Tool Resources Configuration](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents/configure-and-interact#add-tools)

---

## Integration with SnowGram

### Backend Integration (FastAPI)

#### 1. Create Agent Connection Utility

```python
# backend/agent/cortex_agent_client.py

import os
import requests
from typing import Dict, Any, Generator
import json

class CortexAgentClient:
    """Client for interacting with Snowflake Cortex Agent API"""
    
    def __init__(self, account_url: str, pat_token: str):
        self.account_url = account_url.rstrip('/')
        self.headers = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',  # For streaming responses
            'Authorization': f'Bearer {pat_token}',
            'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT'
        }
    
    def run_agent(
        self,
        database: str,
        schema: str,
        agent_name: str,
        user_message: str,
        thread_id: int = None
    ) -> Generator[Dict[str, Any], None, None]:
        """
        Execute agent with streaming responses (server-sent events)
        
        Args:
            database: Database containing agent
            schema: Schema containing agent
            agent_name: Name of agent
            user_message: User's natural language question
            thread_id: Optional thread ID for conversation context
            
        Yields:
            Parsed event dictionaries from server-sent events stream
        """
        url = f"{self.account_url}/api/v2/databases/{database}/schemas/{schema}/agent/run"
        
        payload = {
            "agent": agent_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": user_message
                        }
                    ]
                }
            ]
        }
        
        if thread_id:
            payload["thread_id"] = thread_id
        
        with requests.post(url, headers=self.headers, json=payload, stream=True) as response:
            response.raise_for_status()
            
            for line in response.iter_lines():
                if line:
                    line_str = line.decode('utf-8')
                    
                    # Parse server-sent events format
                    if line_str.startswith('data: '):
                        data_str = line_str[6:]  # Remove 'data: ' prefix
                        
                        if data_str.strip() == '[DONE]':
                            break
                        
                        try:
                            event_data = json.loads(data_str)
                            yield event_data
                        except json.JSONDecodeError:
                            continue
```

#### 2. FastAPI WebSocket Endpoint

```python
# backend/api/websocket.py

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.agent.cortex_agent_client import CortexAgentClient
import os

router = APIRouter()

agent_client = CortexAgentClient(
    account_url=os.environ['SNOWFLAKE_ACCOUNT_URL'],
    pat_token=os.environ['SNOWFLAKE_PAT']
)

@router.websocket("/ws/agent")
async def agent_websocket(websocket: WebSocket):
    """WebSocket endpoint for real-time agent chat"""
    await websocket.accept()
    
    thread_id = None  # Initialize conversation thread
    
    try:
        while True:
            # Receive message from frontend
            data = await websocket.receive_json()
            user_message = data.get('message')
            
            if not user_message:
                continue
            
            # Stream agent responses
            for event in agent_client.run_agent(
                database="SNOWGRAM_DB",
                schema="AGENTS",
                agent_name="DIAGRAM_ASSISTANT_AGENT",
                user_message=user_message,
                thread_id=thread_id
            ):
                # Extract thread ID from first event
                if 'thread_id' in event and not thread_id:
                    thread_id = event['thread_id']
                
                # Send event to frontend
                await websocket.send_json({
                    'type': event.get('type'),
                    'content': event.get('content'),
                    'metadata': event.get('metadata')
                })
    
    except WebSocketDisconnect:
        print(f"Client disconnected")
```

**Source**: [Cortex Agents Run API](https://docs.snowflake.com/en/developer-guide/snowflake-cortex/cortex-agents-rest-api/run-api)

---

### Frontend Integration (React + WebSocket)

#### Agent Chat Component

```typescript
// frontend/src/components/AgentChat.tsx

import React, { useState, useEffect, useRef } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  metadata?: any;
}

export function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Connect to WebSocket
    const ws = new WebSocket('ws://localhost:8000/ws/agent');
    
    ws.onopen = () => {
      setIsConnected(true);
      console.log('Connected to agent');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // Append assistant response
      if (data.type === 'message_content') {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: data.content,
            metadata: data.metadata
          }
        ]);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log('Disconnected from agent');
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, []);

  const sendMessage = () => {
    if (!inputValue.trim() || !wsRef.current) return;

    // Add user message to UI
    setMessages(prev => [
      ...prev,
      { role: 'user', content: inputValue }
    ]);

    // Send to agent
    wsRef.current.send(JSON.stringify({ message: inputValue }));

    setInputValue('');
  };

  return (
    <div className="agent-chat">
      <div className="messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            {msg.content}
          </div>
        ))}
      </div>
      
      <div className="input-area">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && sendMessage()}
          placeholder="Ask me to create a diagram..."
          disabled={!isConnected}
        />
        <button onClick={sendMessage} disabled={!isConnected}>
          Send
        </button>
      </div>
      
      <div className="status">
        {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
      </div>
    </div>
  );
}
```

---

## Thread Management

**Threads** persist conversation context server-side, so the client doesn't need to maintain history.

### Create Thread

```http
POST /api/v2/databases/{database}/schemas/{schema}/threads
```

```python
def create_thread(self) -> int:
    """Create a new conversation thread"""
    url = f"{self.account_url}/api/v2/databases/SNOWGRAM_DB/schemas/AGENTS/threads"
    
    response = requests.post(url, headers=self.headers)
    response.raise_for_status()
    
    thread_data = response.json()
    return thread_data['thread_id']
```

### Use Thread in Agent Run

```python
payload = {
    "agent": "DIAGRAM_ASSISTANT_AGENT",
    "thread_id": thread_id,  # Reference existing thread
    "messages": [
        {
            "role": "user",
            "content": [{"type": "text", "text": "Refine the diagram"}]
        }
    ]
}
```

### Benefits of Threads

- **Context Preservation**: Agent remembers previous questions and answers
- **Multi-Turn Conversations**: Natural back-and-forth refinement
- **Server-Side Storage**: No need to send full conversation history on every request
- **Performance**: Reduces payload size and latency

**Source**: [Use Threads with Cortex Agent REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents/use-threads)

---

## Best Practices

### 1. Model Selection

✅ **Use `"auto"` for orchestration model**
- Automatically selects highest quality model
- Quality improves as new models are released
- No need to update agent configuration

```json
{
  "models": {
    "orchestration": "auto"
  }
}
```

### 2. Warehouse Sizing

✅ **Right-size warehouses for Cortex Analyst queries**
- Small warehouses (S, M) for semantic model queries over small datasets
- Large warehouses (L, XL) for complex joins or large fact tables
- Use multi-cluster warehouses for high concurrency

### 3. Error Handling

✅ **Implement retry logic for transient failures**

```python
import time
from requests.exceptions import HTTPError

def run_agent_with_retry(client, message, max_retries=3):
    for attempt in range(max_retries):
        try:
            return list(client.run_agent(...))
        except HTTPError as e:
            if e.response.status_code >= 500 and attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # Exponential backoff
                continue
            raise
```

### 4. Semantic Model Optimization

✅ **Design semantic models for agent queries**
- Use clear, descriptive column names
- Add synonyms for business terms
- Include sample questions in semantic model YAML
- Test queries manually before deploying agent

### 5. Cortex Search Configuration

✅ **Configure filters for efficient search**

```json
{
  "tool_resources": {
    "docs_search": {
      "cortex_search_service": "SNOWGRAM_DB.KNOWLEDGE.SNOWFLAKE_DOCS_SEARCH",
      "columns": ["chunk", "category", "url"],
      "max_results": 5,
      "filter": {
        "category": "cortex"  // Pre-filter to relevant docs
      }
    }
  }
}
```

### 6. Observability

✅ **Enable logging and monitoring**

```sql
-- Grant MONITOR privilege to view logs
GRANT MONITOR ON AGENT SNOWGRAM_DB.AGENTS.DIAGRAM_ASSISTANT_AGENT 
  TO ROLE SNOWGRAM_AGENT_USER_ROLE;

-- Query agent logs
SELECT * 
FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_LOGS
WHERE AGENT_NAME = 'DIAGRAM_ASSISTANT_AGENT'
ORDER BY TIMESTAMP DESC
LIMIT 100;
```

**Required Roles for Monitoring**:
- `CORTEX_USER` database role
- `AI_OBSERVABILITY_EVENTS_LOOKUP` application role

**Source**: [Access Control and Permissions for Logs](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents/monitoring#access-control-and-permissions)

### 7. Security

✅ **Use service accounts with minimal privileges**

```sql
-- Create service account for SnowGram
CREATE USER IF NOT EXISTS SVC_SNOWGRAM_AGENT
  TYPE = SERVICE
  DEFAULT_ROLE = SNOWGRAM_AGENT_USER_ROLE
  DEFAULT_WAREHOUSE = COMPUTE_WH;

-- Grant only required privileges
GRANT ROLE SNOWGRAM_AGENT_USER_ROLE TO USER SVC_SNOWGRAM_AGENT;

-- Generate Personal Access Token for API authentication
-- (Done via Snowsight UI or SnowSQL)
```

---

## Troubleshooting

### Issue: "Insufficient privileges to create agent"

**Solution**: Ensure role has `CREATE AGENT` on schema

```sql
GRANT CREATE AGENT ON SCHEMA SNOWGRAM_DB.AGENTS TO ROLE SYSADMIN;
```

---

### Issue: "Warehouse not found or insufficient privileges"

**Solution**: Grant `USAGE` on warehouse used in tool resources

```sql
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE SNOWGRAM_AGENT_USER_ROLE;
```

---

### Issue: "Cortex Search service not found"

**Solution**: Verify service exists and grant `USAGE`

```sql
-- Check if service exists
SHOW CORTEX SEARCH SERVICES IN SCHEMA SNOWGRAM_DB.KNOWLEDGE;

-- Grant usage
GRANT USAGE ON CORTEX SEARCH SERVICE SNOWGRAM_DB.KNOWLEDGE.SNOWFLAKE_DOCS_SEARCH
  TO ROLE SNOWGRAM_AGENT_USER_ROLE;
```

---

### Issue: "Agent times out on complex queries"

**Solution**: Increase `max_duration_seconds` in orchestration config

```json
{
  "orchestration": {
    "max_duration_seconds": 300  // Increase from 120 to 300
  }
}
```

---

### Issue: "Agent responses are low quality"

**Checklist**:
1. ✅ Instructions are clear and specific?
2. ✅ Sample questions cover representative use cases?
3. ✅ Semantic models have synonyms for business terms?
4. ✅ Using `"auto"` for model selection?

**Example Improvement**:

```json
// ❌ Vague instruction
"instructions": {
  "response": "Help users with diagrams"
}

// ✅ Specific instruction
"instructions": {
  "response": "Generate Mermaid diagrams by first querying the component catalog for relevant blocks, then composing them with proper syntax. Always explain which components you used and why."
}
```

---

## Additional Resources

### Official Documentation

- [Cortex Agents Overview](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
- [CREATE AGENT Reference](https://docs.snowflake.com/en/sql-reference/sql/create-agent)
- [Cortex Agents REST API](https://docs.snowflake.com/en/developer-guide/snowflake-cortex/cortex-agents-rest-api)
- [Configure and Interact with Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents/configure-and-interact)
- [Use Threads with REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents/use-threads)
- [Monitoring Cortex Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents/monitoring)

### Related SnowGram Documentation

- `setup_backend.sql` - Database schema and initial setup
- `backend/agent/` - Agent configuration and client code
- `backend/semantics/` - Semantic models for Cortex Analyst
- `backend/knowledge/` - Cortex Search service setup

---

## Next Steps for SnowGram

1. ✅ Review this deployment guide
2. ⏭️ Create semantic models for component catalog (`backend/semantics/modular_component_model.yaml`)
3. ⏭️ Set up Cortex Search service for Snowflake docs (`backend/knowledge/setup_cortex_search.sql`)
4. ⏭️ Deploy agent with SQL or REST API (`backend/agent/deploy_agent.sql`)
5. ⏭️ Integrate agent client in FastAPI backend (`backend/api/websocket.py`)
6. ⏭️ Build React chat component for frontend (`frontend/src/components/AgentChat.tsx`)
7. ⏭️ Test end-to-end: User asks question → Agent generates diagram → Render in Excalidraw

---

**Document Researched By**: Cursor Agent via `snowflake-docs` MCP Server  
**MCP Server**: `snowhouse-mcp` (accessing `CORTEX_KNOWLEDGE_EXTENSION_SNOWFLAKE_DOCUMENTATION.SHARED.CKE_SNOWFLAKE_DOCS_SERVICE`)  
**Connection**: `svcUser` (SVC_CURSOR service account)  
**Date**: November 14, 2025

**All information sourced from official Snowflake documentation at docs.snowflake.com**

