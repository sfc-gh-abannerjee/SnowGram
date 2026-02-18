# SnowGram

Snowflake architecture diagram generator using Cortex Agents with 14 pre-built reference architecture templates.

## Quick Reference

| Key | Value |
|-----|-------|
| Connection | `se_demo` |
| Database | `SNOWGRAM_DB` |
| Agent | `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT` |
| Model | `claude-sonnet-4-5` |
| Warehouse | `COMPUTE_WH` |
| Frontend | Next.js 15 at `localhost:3002` |

## Commands

```bash
# Test agent
cd backend/tests/agent && python run_tests.py

# Frontend dev
cd frontend && npm run dev

# Test template output
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('MEDALLION_LAKEHOUSE');

# Recreate agent (after spec changes)
DROP AGENT IF EXISTS SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;
CREATE OR REPLACE AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT FROM SPECIFICATION $$ ... $$;
```

## Templates (14 Total)

| Template ID | Use Case |
|-------------|----------|
| `MEDALLION_LAKEHOUSE` | Bronze/Silver/Gold with external sources |
| `MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY` | Snowflake-native medallion |
| `STREAMING_DATA_STACK` | Kafka Connector, Dynamic Tables |
| `SECURITY_ANALYTICS` | SIEM/log analytics with SOS |
| `CUSTOMER_360` | CDP with ML predictions |
| `ML_FEATURE_ENGINEERING` | Model Registry, Cortex, SPCS |
| `BATCH_DATA_WAREHOUSE` | Traditional star schema ETL |
| `REALTIME_IOT_PIPELINE` | Edge software, MQTT, rules engine |
| `DATA_GOVERNANCE_COMPLIANCE` | Masking, RLS policies |
| `EMBEDDED_ANALYTICS` | Hybrid Tables, Multi-Cluster WH |
| `MULTI_CLOUD_DATA_MESH` | Cross-cloud federated |
| `SERVERLESS_DATA_STACK` | Lambda/Functions, API Gateway |
| `REALTIME_FINANCIAL_TRANSACTIONS` | High-volume transaction processing |
| `HYBRID_CLOUD_LAKEHOUSE` | Iceberg, external catalog |

## Gotchas

1. **Agent tool output** - Tool descriptions MUST tell agent to include returned Mermaid code verbatim in response. Without this, agent says "Diagram updated" without showing code.

2. **Frontend prompt override** - `frontend/src/lib/snowgram-agent-client.ts` sends its own `SNOWGRAM_SYSTEM_PROMPT` that can override agent-configured instructions. If agent works via direct API but not frontend, check this file.

3. **UDTFs + Cortex Agents** - Agents only support scalar UDFs. Wrap table functions in JSON-returning scalar UDFs.

4. **Agent recreation** - Cannot `ALTER AGENT SET AGENT_SPEC`. Must `DROP` and `CREATE OR REPLACE`.

5. **INSERT with ARRAY_CONSTRUCT** - Use `SELECT ... FROM VALUES` not `INSERT INTO ... VALUES` for arrays.

## Multi-Tab Architecture

SnowGram supports Lucidchart-style multi-tab diagrams with cross-environment persistence.

### Key Files

| File | Purpose |
|------|---------|
| `frontend/src/store/diagramTabsStore.ts` | Zustand store with persist middleware |
| `frontend/src/lib/storageAdapter.ts` | Storage abstraction (localStorage/API/Native App) |
| `frontend/src/components/TabBar.tsx` | Tab bar UI component |

### State Management Pattern

```
TabBar.tsx ←→ useDiagramTabsStore (Zustand) ←→ StorageAdapter
                                                    │
                    ┌───────────────────────────────┼───────────────────────┐
                    ▼                               ▼                       ▼
              localStorage                    Backend API            Native App API
              (Desktop)                        (SPCS)               (Consumer Account)
```

### Tab State Interface

```typescript
interface DiagramTab {
  id: string;
  name: string;
  nodes: Node[];          // ReactFlow nodes
  edges: Edge[];          // ReactFlow edges
  viewport: { x, y, zoom }; // Canvas viewport state
  threadId: number | null;  // Per-tab conversation context
  lastModified: string;
  isDirty: boolean;
}
```

### Environment Detection

- **Desktop**: `localStorage` (default)
- **SPCS**: Hostname contains `.snowflakecomputing.app` or `NEXT_PUBLIC_STORAGE_MODE=spcs`
- **Native App**: `window.__SNOWFLAKE_NATIVE_APP__ === true`

### Gotchas (Multi-Tab)

1. **Viewport sync** - Always save viewport via `reactFlowInstance.getViewport()` before tab switch
2. **Debounced updates** - State sync to Zustand is debounced (300ms) to avoid performance issues during drag
3. **Per-tab chat** - Each tab has its own `threadId` for conversation continuity with the agent

## Detailed Docs

- Architecture: `docs/AI_POWERED_DIAGRAM_ARCHITECTURE.md`
- Agent setup: `backend/agent/AGENT_SETUP_GUIDE.md`
- Bug fixes: `frontend/BUG_AUDIT.md`
- Dependencies: `frontend/DEPENDENCIES.md`
- Cortex Code guide: `docs/CORTEX_CODE_GUIDE.md`
