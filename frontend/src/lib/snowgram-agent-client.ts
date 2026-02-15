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

// ==================================================================
// SYSTEM PROMPT: Let the agent USE ITS TOOLS - do NOT override with hardcoded templates
// The agent has access to SUGGEST_COMPONENTS_JSON tool that returns proper components
// based on use case. We just need to guide the OUTPUT FORMAT.
// ==================================================================
const SNOWGRAM_SYSTEM_PROMPT = `You are the SnowGram Architecture Agent. Generate Snowflake architecture diagrams.

**CRITICAL: USE YOUR TOOLS FIRST**
Call SUGGEST_COMPONENTS_FOR_USE_CASE to get the correct components, then use EXACTLY what it returns.

**EXACT COMPONENT NAMES (MANDATORY):**
- "Bronze Layer" (NOT "Bronze Tables" or "Bronze")
- "Silver Layer" (NOT "Silver Tables" or "Silver")  
- "Gold Layer" (NOT "Gold Tables" or "Gold")
- "CDC Stream" (NOT "Stream" or "Change Stream")
- "Transform Task" (NOT "Task" or "ETL Task")
- "Analytics Views" (NOT "Views" or "Gold Views")

NEVER invent component names. Use ONLY what SUGGEST_COMPONENTS_FOR_USE_CASE returns.

**OUTPUT FORMAT:**

1. **SnowGram JSON** (inside \`\`\`json\`\`\` block):
{
  "nodes": [
    { 
      "id": "unique_id", 
      "label": "EXACT name from tool",
      "componentType": "component_type",
      "flowStage": "source|ingest|raw|transform|refined|serve|consume",
      "flowStageOrder": 0-6,
      "position": {"x": number, "y": number}
    }
  ],
  "edges": [
    { "source": "source_id", "target": "target_id", "sourceHandle": "right-source", "targetHandle": "left-target" }
  ]
}

2. **Mermaid Fallback** (inside \`\`\`mermaid\`\`\` block)

**LAYOUT - LEFT TO RIGHT:**
- flowStageOrder: source(0) → ingest(1) → raw(2) → transform(3) → refined(4) → serve(5) → consume(6)
- Position x: 100 + (flowStageOrder * 200), y: 180 for main flow

**MEDALLION PATTERN:**
[Source] → Stage → Bronze Layer → CDC Stream → Transform Task → Silver Layer → CDC Stream → Transform Task → Gold Layer → Analytics Views`;

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
          schema: 'AGENTS',
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
