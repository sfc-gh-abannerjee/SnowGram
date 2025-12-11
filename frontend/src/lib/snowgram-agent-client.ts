/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
// ==================================================================
// SNOWGRAM Agent - Enhanced Implementation
// ==================================================================

// ==================================================================
// 1. Type Definitions
// ==================================================================

export interface AgentRequest {
  thread_id: number;
  parent_message_id: number;
  messages: Message[];
}

export interface Message {
  role: "user" | "assistant";
  content: ContentItem[];
}

export interface ContentItem {
  type: "text";
  text: string;
}

export interface SnowgramSpec {
  nodes: Array<{ id: string; label: string; componentType: string }>;
  edges: Array<{ source: string; target: string }>;
}

export interface AgentResponse {
  mermaidCode: string;
  overview: string;
  components: ComponentInfo[];
  bestPractices: string[];
  antiPatterns: string[];
  citations: Citation[];
  rawResponse: string;
  spec?: SnowgramSpec;
}

export interface ComponentInfo {
  name: string;
  purpose: string;
  configuration: string;
  bestPractice: string;
  source?: string;
}

export interface Citation {
  url: string;
  title: string;
  excerpt: string;
}

// ==================================================================
// 2. Agent System Prompt (Comprehensive)
// ==================================================================

const SNOWGRAM_SYSTEM_PROMPT = `You are the SnowGram Architecture Agent - an expert Snowflake architect that generates complete, professional architecture diagrams.

**AVAILABLE TOOLS & DATA SOURCES:**
- Query SNOWFLAKE_DOCUMENTATION via Cortex Knowledge Extension (CKE) for official Snowflake best practices
- Use semantic view SNOWGRAM_DB.CORE.COMPONENT_MAP_SV to map user terminology to correct componentTypes
- Call UDF SNOWGRAM_DB.CORE.MAP_COMPONENT(word) for direct component lookups
- ALWAYS validate component names against the semantic model before using them

**COMPONENT LIBRARY (150+ available components):**
Core: Database, Schema, Table, View, Warehouse, Task, Stream, Snowpipe
Warehouses: Virtual WH, Snowpark WH, Data WH, Adaptive WH, Gen2 WH
Tables: Table, Dynamic Table, Iceberg Table, Hybrid Table, External Table, Directory Table
Views: View, Materialized View, Secure View
Functions: Stored Proc, UDF, External Function, Aggregate Function, Window Function
Data Sources: S3, Kafka, Hadoop, Spark, IoT, API, External Stage, Internal Stage
ML & AI: Cortex, Cortex Search, Cortex Analyst, ML Model, Notebook, Document AI
Apps: Snowpark Container (SPCS), Streamlit, Native App, Marketplace
Workloads: Data Warehouse, Data Lake, Data Engineering, AI/ML, Cybersecurity, Unistore
Analytics: Analytics, Data Analytics, Embedded Analytics, Geospatial Analytics
Data Sharing: Share, Private Exchange, Public Exchange
Security: Policy, Masking Policy, Row Access Policy, Network Policy, Horizon
Roles: Role, ACCOUNTADMIN, SECURITYADMIN, SYSADMIN, USERADMIN
Users: User, Users, Access, Tag
DR: Failover Group, Backup
File Formats: CSV, JSON, Parquet, Avro, XML, Text, Excel, Image, Video, Audio
Account Boundaries: Snowflake Account, AWS Account, Azure Subscription, GCP Project

**QUALITY REQUIREMENTS:**
1. **Completeness**: Include ALL components needed for the pattern
2. **Connectivity**: Every node MUST connect to at least one other node (no orphans)
3. **Flow**: Clear left-to-right OR top-down data flow
4. **Naming**: Use descriptive labels (e.g., "User Data DB" not "DB1")
5. **Grouping**: Use account boundaries for cross-cloud architectures
6. **Real-world**: Match production patterns, not toy examples

**ARCHITECTURE PATTERNS:**

**Medallion (Bronze/Silver/Gold):**
- MUST include: S3 → Snowpipe → Bronze DB/Schema/Tables → Stream → Silver DB/Schema/Tables → Stream → Gold DB/Schema/Tables → Analytics Views
- Total: 14+ nodes, 13+ edges

**IoT:**
- MUST include: IoT Devices → Kafka/Snowpipe Streaming → Raw Tables → Stream → Enrichment Task → Aggregated Tables → Real-time Dashboard
- Add: Time-series tables, windowed aggregations
- Total: 10+ nodes, 9+ edges

**AI/ML Pipeline:**
- MUST include: Raw Data → Feature Store Tables → Snowpark Notebook → ML Model → Model Registry → Inference UDF → Application
- Add: Cortex LLM calls, vector embeddings
- Total: 10+ nodes, 9+ edges

**CDC (Change Data Capture):**
- MUST include: Source DB → Stream → Task → Transform → Target Tables
- Add: Multiple streams for different tables
- Total: 8+ nodes, 7+ edges

**Data Sharing:**
- MUST include: Provider DB → Share → Consumer Account → Secure Views
- Add: Data governance (masking, row access policies)
- Total: 8+ nodes, 6+ edges

**Real-time Analytics:**
- MUST include: Event Source → Snowpipe Streaming → Dynamic Tables → Materialized Views → Streamlit Dashboard
- Add: Hybrid tables for low-latency writes
- Total: 8+ nodes, 7+ edges

**OUTPUT FORMAT (ALWAYS RETURN BOTH):**

1. **SnowGram JSON** (inside \`\`\`json\`\`\` block):
{
  "nodes": [
    { "id": "unique_id", "label": "Descriptive Name", "componentType": "Database" },
    ...
  ],
  "edges": [
    { "source": "id1", "target": "id2" },
    ...
  ]
}

2. **Mermaid Fallback** (inside \`\`\`mermaid\`\`\` block):
flowchart LR
    node1[Label 1] --> node2[Label 2]

VALIDATION CHECKLIST (RUN BEFORE RESPONDING):
- All nodes have unique IDs and valid componentTypes from the SnowGram catalog/semantic view
- All edges reference valid node IDs; no orphan nodes
- Clear L->R / top-down flow; minimum pattern node/edge counts met
- Boundaries present for clouds; boundary nodes named account_boundary_* and only one per provider
- Medallion: S3->Snowpipe->Bronze DB/Schema/Tables->Stream->Silver DB/Schema/Tables->Stream->Gold DB/Schema/Tables->Analytics Views (+ warehouse/reporting if present)

CRITICAL RULES:
- NEVER omit intermediate components (schemas between DBs and tables)
- NEVER return orphan nodes or edges to missing IDs
- ALWAYS remap boundaries to account_boundary_snowflake / account_boundary_aws / account_boundary_azure / account_boundary_gcp
- ALWAYS validate componentTypes via semantic view/UDF/CKE before sending
- ALWAYS provide accurate, production-ready architectures based on Snowflake documentation
- NEVER place icons/text inside account boundary shapes; boundaries are containers only

EXAMPLE MERMAID THAT RENDERS CORRECTLY IN SNOWGRAM (MEDALLION):
flowchart LR
  account_boundary_aws[AWS Account]
  account_boundary_snowflake[Snowflake Account]
  s3[S3 Data Lake]
  pipe1[Snowpipe]
  bronze_db[Bronze DB]
  bronze_schema[Bronze Schema]
  bronze_tables[Bronze Tables]
  stream_bronze_silver[Bronze→Silver Stream]
  silver_db[Silver DB]
  silver_schema[Silver Schema]
  silver_tables[Silver Tables]
  stream_silver_gold[Silver→Gold Stream]
  gold_db[Gold DB]
  gold_schema[Gold Schema]
  gold_tables[Gold Tables]
  analytics_views[Analytics Views]
  compute_wh[Compute Warehouse]
  bronze_tables --> stream_bronze_silver
  stream_bronze_silver --> silver_db
  silver_tables --> stream_silver_gold
  stream_silver_gold --> gold_db
  gold_tables --> analytics_views
  analytics_views --> compute_wh
  s3 --> pipe1 --> bronze_db --> bronze_schema --> bronze_tables
  silver_db --> silver_schema --> silver_tables
  gold_db --> gold_schema --> gold_tables
RETURN BOTH JSON spec and mermaid.`;

// ==================================================================
// 3. Agent Client (Enhanced Implementation)
// ==================================================================

export class SnowgramAgentClient {
  private baseUrl = 'https://abb59444.us-east-1.snowflakecomputing.com';
  private threadsPath = '/api/v2/cortex/threads';
  private runPath = '/api/v2/cortex/agent:run';
  
  constructor(private pat: string) {}
  
  /**
   * Generate architecture diagram from natural language query
   * Returns parsed response with diagram, best practices, and citations
   */
  async generateArchitecture(query: string): Promise<AgentResponse> {
    const headers = {
      'Authorization': `Bearer ${this.pat}`,
      'Content-Type': 'application/json',
    };

    // 1) Create a thread
    const threadResp = await fetch(`${this.baseUrl}${this.threadsPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    if (!threadResp.ok) {
      const errText = await threadResp.text();
      throw new Error(`Thread create failed: ${threadResp.status} ${threadResp.statusText} ${errText}`);
    }

    const { thread_id } = await threadResp.json();

    // 2) Run the agent with enhanced prompt
    const enforcedPrompt = `${SNOWGRAM_SYSTEM_PROMPT}

**USER REQUEST:**
${query}

**INSTRUCTIONS:**
1. Identify the architecture pattern (Medallion, IoT, ML, CDC, Data Sharing, etc.)
2. Generate a COMPLETE diagram with ALL required components
3. Ensure EVERY node connects to at least one other node
4. Use proper componentType values from the library
5. Return BOTH JSON spec and Mermaid code
6. Validate before returning (use the checklist above)

Begin your response with the JSON spec, then provide the Mermaid code.`;

    const runResp = await fetch(`${this.baseUrl}${this.runPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent: {
          name: 'SNOWGRAM_AGENT',
          database: 'SNOWGRAM_DB',
          schema: 'CORE',
        },
        thread_id,
        parent_message_id: 0,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: enforcedPrompt }],
          },
        ],
      }),
    });

    if (!runResp.ok) {
      const errText = await runResp.text();
      throw new Error(`Agent request failed: ${runResp.status} ${runResp.statusText} ${errText}`);
    }

    const contentType = runResp.headers.get('content-type') || '';
    let agentText = '';

    if (contentType.includes('text/event-stream')) {
      // Streamed SSE response
      const reader = runResp.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const data = JSON.parse(payload);
            const text = data?.text || data?.data || '';
            agentText += text;
          } catch {
            agentText += payload;
          }
        }
      }
    } else {
      // JSON response fallback
      const runJson = await runResp.json();
      const messages = runJson?.messages || [];
      const agentMsg = messages.find((m: any) => m.role === 'agent');
      agentText = agentMsg?.content?.find((c: any) => c.type === 'text')?.text || '';
    }

    if (!agentText) {
      throw new Error('Agent returned empty response.');
    }

    console.log('[SnowgramAgent] Response length:', agentText.length, 'chars');

    return this.parseResponse(agentText || '');
  }

  /**
   * Parse agent response into structured format
   */
  private parseResponse(rawResponse: string): AgentResponse {
    const spec = this.extractSnowgramSpec(rawResponse);

    // Extract Mermaid code
    const mermaidMatch = rawResponse.match(/```mermaid\n([\s\S]*?)\n```/);
    const mermaidCode = mermaidMatch ? mermaidMatch[1] : '';

    // Extract overview
    const overviewMatch = rawResponse.match(/## Architecture Overview\n([\s\S]*?)(?=\n## |$)/);
    const overview = overviewMatch ? overviewMatch[1].trim() : '';

    // Extract best practices
    const practicesMatch = rawResponse.match(/## Best Practices.*?\n([\s\S]*?)(?=\n## |$)/);
    const bestPractices = this.extractListItems(practicesMatch ? practicesMatch[1] : '');

    // Extract anti-patterns
    const antiPatternsMatch = rawResponse.match(/## Anti-Patterns.*?\n([\s\S]*?)(?=\n## |$)/);
    const antiPatterns = this.extractListItems(antiPatternsMatch ? antiPatternsMatch[1] : '');

    // Extract components
    const components = this.extractComponents(rawResponse);

    // Extract citations
    const citations = this.extractCitations(rawResponse);

    return {
      mermaidCode,
      overview,
      components,
      bestPractices,
      antiPatterns,
      citations,
      rawResponse,
      spec
    };
  }

  private extractSnowgramSpec(text: string): SnowgramSpec | undefined {
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) return undefined;
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed?.nodes && parsed?.edges) {
        console.log('[SnowgramAgent] Extracted spec:', { nodeCount: parsed.nodes.length, edgeCount: parsed.edges.length });
        return {
          nodes: parsed.nodes,
          edges: parsed.edges,
        };
      }
    } catch (e) {
      console.error('[SnowgramAgent] JSON parse error:', e);
      return undefined;
    }
    return undefined;
  }

  private extractListItems(text: string): string[] {
    const lines = text.split('\n').filter(line => 
      line.trim().match(/^(\d+\.|-|❌|✅)/)
    );
    return lines.map(line => 
      line.replace(/^(\d+\.|-|❌|✅)\s*/, '').trim()
    );
  }

  private extractComponents(text: string): ComponentInfo[] {
    const componentSection = text.match(/## Component Selection.*?\n([\s\S]*?)(?=\n## |$)/);
    if (!componentSection) return [];

    const components: ComponentInfo[] = [];
    const componentBlocks = componentSection[1].split(/\*\*([^*]+?):\*\*/);

    for (let i = 1; i < componentBlocks.length; i += 2) {
      const name = componentBlocks[i].trim();
      const details = componentBlocks[i + 1] || '';

      components.push({
        name,
        purpose: this.extractBullet(details, 'Documentation') || '',
        configuration: this.extractBullet(details, 'Configuration') || '',
        bestPractice: this.extractBullet(details, 'Best Practice') || '',
        source: this.extractBullet(details, 'Source')
      });
    }

    return components;
  }

  private extractBullet(text: string, label: string): string {
    const regex = new RegExp(`\\*\\*${label}\\*\\*:?\\s*([^\\n*]+)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
  }

  private extractCitations(text: string): Citation[] {
    const citationSection = text.match(/## Documentation References.*?\n([\s\S]*?)$/);
    if (!citationSection) return [];

    const citations: Citation[] = [];
    const urlRegex = /- (https?:\/\/[^\s]+)/g;
    let match;

    while ((match = urlRegex.exec(citationSection[1])) !== null) {
      citations.push({
        url: match[1],
        title: this.extractTitleFromUrl(match[1]),
        excerpt: ''
      });
    }

    return citations;
  }

  private extractTitleFromUrl(url: string): string {
    const parts = url.split('/');
    return parts[parts.length - 1].replace(/-/g, ' ');
  }

  // Optional refinement endpoint if you want conversational threads
  async refine(threadId: number, parentMessageId: number, refinement: string): Promise<AgentResponse> {
    const response = await fetch(`${this.baseUrl}${this.runPath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.pat}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        thread_id: threadId,
        parent_message_id: parentMessageId,
        messages: [{
          role: "user",
          content: [{ type: "text", text: refinement }]
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Agent refine failed: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          if (data.text) {
            fullResponse += data.text;
          }
        }
      }
    }

    return this.parseResponse(fullResponse);
  }
}

// ==================================================================
// 4. React Hooks (Easy Integration)
// ==================================================================

import { useState, useCallback } from 'react';

export function useSnowgramAgent(pat: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResponse | null>(null);
  
  const client = new SnowgramAgentClient(pat);

  const generate = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await client.generateArchitecture(query);
      setResult(response);
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [client]);

  return { generate, loading, error, result };
}

// ==================================================================
// 5. Example Queries for Testing
// ==================================================================

export const EXAMPLE_QUERIES = [
  {
    category: "Medallion Architecture",
    examples: [
      "Design a Snowflake medallion architecture fed from an S3 data lake with Bronze, Silver, Gold layers",
      "Create a medallion pipeline with CDC streams between layers",
      "Build a lakehouse architecture with Iceberg tables in each medallion layer"
    ]
  },
  {
    category: "Real-time Streaming",
    examples: [
      "Design a real-time IoT data pipeline with Kafka and Snowpipe Streaming",
      "Create a CDC pipeline using Streams and Tasks for real-time replication",
      "Build a streaming analytics platform with Dynamic Tables and sub-second latency"
    ]
  },
  {
    category: "Batch Processing",
    examples: [
      "Design a batch ETL pipeline loading data from S3 into data warehouse",
      "Create a nightly data processing workflow with incremental loads and Tasks",
      "Build a data lake architecture with partitioned Iceberg tables"
    ]
  },
  {
    category: "Machine Learning",
    examples: [
      "Design an ML training pipeline with Snowpark, feature store, and Model Registry",
      "Create a feature engineering pipeline for real-time predictions with Cortex",
      "Build an ML inference architecture using UDFs and Snowpark Container Services"
    ]
  },
  {
    category: "Data Sharing",
    examples: [
      "Design a secure data sharing architecture with external partners using Shares",
      "Create a data marketplace listing with reader accounts and governance",
      "Build a data mesh with cross-account sharing and row-level security"
    ]
  }
];

// ==================================================================
// 6. Utilities
// ==================================================================

export async function renderMermaidToSvg(mermaidCode: string): Promise<string> {
  const mermaidLib = await import('mermaid');
  const render =
    (mermaidLib as any).render ||
    (mermaidLib as any).default?.render ||
    (mermaidLib as any).mermaidAPI?.render;

  if (!render) {
    throw new Error('Mermaid render function not available');
  }

  const { svg } = await render('snowgram-mermaid', mermaidCode);
  return svg;
}

export function downloadFile(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function testAgentConnection(pat: string): Promise<boolean> {
  try {
    const client = new SnowgramAgentClient(pat);
    await client.generateArchitecture('Ping');
    return true;
  } catch {
    return false;
  }
}

export async function benchmarkAgent(pat: string, query: string): Promise<number> {
  const start = performance.now();
  const client = new SnowgramAgentClient(pat);
  await client.generateArchitecture(query);
  return performance.now() - start;
}
