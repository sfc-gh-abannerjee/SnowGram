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
  threadId?: number;  // Return thread ID for conversation persistence
  messageId?: number; // Return message ID for follow-up messages
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

// ==================================================================
// AGENTIC SYSTEM PROMPT: 
// Agent is responsible for TOPOLOGY (what components, how they connect)
// Frontend is responsible for LAYOUT (where to place them visually)
// Agent uses CKE/tools to determine component boundaries
// ==================================================================
const SNOWGRAM_SYSTEM_PROMPT = `You are the SnowGram Architecture Agent. Generate Snowflake architecture diagrams based on user requests.

**YOUR ROLE: TOPOLOGY, NOT LAYOUT**
You decide WHAT components exist and HOW they connect. The frontend handles WHERE to place them.
- Focus on generating correct nodes and edges
- The frontend will compute visual positions from edge relationships
- You do NOT need to calculate flowStageOrder - the frontend derives it from edges

**USE YOUR TOOLS FOR COMPONENT KNOWLEDGE**
1. Call SUGGEST_COMPONENTS_FOR_USE_CASE to get correct components for the user's pattern
2. Use SNOWFLAKE_DOCS_SEARCH to determine if a component is internal or external to Snowflake

**BOUNDARY DETERMINATION (use CKE if unsure):**
- Snowflake-managed services (Snowpipe, Streams, Tasks, Tables, Stages) → boundary: "snowflake"
- External data sources (Kafka, S3, Azure Blob, GCS) → boundary: "kafka" | "aws" | "azure" | "gcp"
- When unsure, search Snowflake docs: "Is [component] a Snowflake service?"

**OUTPUT FORMAT:**

Return a JSON spec inside a \`\`\`json\`\`\` block:
{
  "nodes": [
    { 
      "id": "unique_snake_case_id", 
      "label": "Human Readable Name",
      "componentType": "sf_component_type or ext_type",
      "boundary": "snowflake" | "kafka" | "aws" | "azure" | "gcp"
    }
  ],
  "edges": [
    { "source": "upstream_node_id", "target": "downstream_node_id" }
  ]
}

**CONVERSATIONAL ITERATION:**
- Users can request changes: "Add a CDC stream after Gold", "Remove the Bronze layer", "Connect Kafka directly to Silver"
- Update the topology (nodes/edges) accordingly
- The frontend will automatically re-layout based on the new edge relationships

**EDGE DIRECTION = DATA FLOW:**
Edges represent data flow direction. source → target means data flows FROM source TO target.
Example: { "source": "bronze", "target": "cdc_stream" } means data flows from Bronze to CDC Stream.

**COMPONENT TYPES:**
- External: ext_kafka, ext_s3, ext_azure_blob, ext_gcs
- Ingestion: sf_snowpipe, sf_snowpipe_streaming, sf_external_stage
- Processing: sf_cdc_stream, sf_transform_task, sf_stored_procedure
- Storage: sf_bronze_layer, sf_silver_layer, sf_gold_layer, sf_table
- Serving: sf_analytics_views, sf_materialized_view, sf_data_share
- Compute: sf_warehouse

**CRITICAL - MERMAID OUTPUT REQUIREMENT:**
When your tools (COMPOSE_DIAGRAM_FROM_TEMPLATE, COMPOSE_DIAGRAM_FROM_PATTERN, etc.) return Mermaid code, you MUST include that code VERBATIM in your response inside a \`\`\`mermaid\`\`\` block.
- Do NOT summarize or paraphrase the Mermaid code
- Do NOT say "Diagram updated" or "Here's your diagram" without the actual code
- ALWAYS copy the full Mermaid flowchart/diagram syntax from the tool result into your response
- The user needs to see the complete Mermaid code to render the diagram`;


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
   * 
   * @param query - The user's natural language request
   * @param existingThreadId - Optional thread ID for conversation continuity
   * @param parentMessageId - Optional parent message ID for follow-up messages
   */
  async generateArchitecture(
    query: string, 
    existingThreadId?: number, 
    parentMessageId?: number
  ): Promise<AgentResponse> {
    const headers = {
      'Authorization': `Bearer ${this.pat}`,
      'Content-Type': 'application/json',
    };

    // 1) Create a thread only if we don't have an existing one
    let thread_id = existingThreadId;
    
    if (!thread_id) {
      const threadResp = await fetch(`${this.baseUrl}${this.threadsPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });

      if (!threadResp.ok) {
        const errText = await threadResp.text();
        throw new Error(`Thread create failed: ${threadResp.status} ${threadResp.statusText} ${errText}`);
      }

      const threadData = await threadResp.json();
      thread_id = threadData.thread_id;
      console.log('[SnowgramAgent] Created new thread:', thread_id);
    } else {
      console.log('[SnowgramAgent] Reusing existing thread:', thread_id, 'parent_message_id:', parentMessageId);
    }

    // 2) Run the agent with enhanced prompt
    const enforcedPrompt = `${SNOWGRAM_SYSTEM_PROMPT}

**USER REQUEST:**
${query}

**INSTRUCTIONS:**
1. Generate the architecture the user asked for - do not assume a specific pattern unless they specify one
2. Ensure every node connects to at least one other node via edges
3. Use proper componentType values (sf_* for Snowflake, ext_* for external)
4. Include boundary field for each node (determines which account boundary contains it)
5. Return JSON spec inside a \`\`\`json\`\`\` block

Respond to the user's request directly. If they ask for changes to an existing diagram, update the topology accordingly.`;

    const runResp = await fetch(`${this.baseUrl}${this.runPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent: {
          name: 'SNOWGRAM_AGENT',
          database: 'SNOWGRAM_DB',
          schema: 'AGENTS',
        },
        thread_id,
        parent_message_id: parentMessageId || 0,  // Use provided parent or start fresh
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

    // Parse response and add thread info for conversation persistence
    const parsed = this.parseResponse(agentText || '');
    return {
      ...parsed,
      threadId: thread_id,
      // TODO: Extract messageId from response when available for proper threading
    };
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
        // Debug: Log node positions to verify they're being extracted
        const nodesWithPositions = parsed.nodes.filter((n: any) => n.position?.x !== undefined);
        console.log('[SnowgramAgent] Extracted spec:', { 
          nodeCount: parsed.nodes.length, 
          edgeCount: parsed.edges.length,
          nodesWithPositions: nodesWithPositions.length,
          sampleNode: parsed.nodes[0] // Log first node to verify structure
        });
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
