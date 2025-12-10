// ==================================================================
// SNOWGRAM Agent - Quick Reference Implementation
// ==================================================================
// Copy this code directly into your Snowgram application
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

export interface AgentResponse {
  mermaidCode: string;
  overview: string;
  components: ComponentInfo[];
  bestPractices: string[];
  antiPatterns: string[];
  citations: Citation[];
  rawResponse: string;
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
// 2. Agent Client (Core Implementation)
// ==================================================================

export class SnowgramAgentClient {
  private baseUrl = 'https://abb59444.us-east-1.snowflakecomputing.com';
  private agentPath = '/api/v2/databases/SNOWGRAM_DB/schemas/AGENTS/agents/SNOWGRAM_AGENT:run';
  
  constructor(private pat: string) {}
  
  /**
   * Generate architecture diagram from natural language query
   * Returns parsed response with diagram, best practices, and citations
   */
  async generateArchitecture(query: string): Promise<AgentResponse> {
    const response = await fetch(`${this.baseUrl}${this.agentPath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.pat}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        thread_id: 0,
        parent_message_id: 0,
        messages: [{
          role: "user",
          content: [{ type: "text", text: query }]
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Agent request failed: ${response.statusText}`);
    }

    // Parse SSE stream
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

  /**
   * Parse agent response into structured format
   */
  private parseResponse(rawResponse: string): AgentResponse {
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
      rawResponse
    };
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
    const response = await fetch(`${this.baseUrl}${this.agentPath}`, {
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
// 3. React Hooks (Easy Integration)
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
// 4. Example Queries for Testing
// ==================================================================

export const EXAMPLE_QUERIES = [
  {
    category: "Real-time Streaming",
    examples: [
      "Design a real-time IoT data pipeline with Kafka and Snowpipe Streaming",
      "Create a CDC pipeline using Streams and Tasks",
      "Build a streaming analytics platform with sub-second latency"
    ]
  },
  {
    category: "Batch Processing",
    examples: [
      "Design a batch ETL pipeline loading data from S3 into data warehouse",
      "Create a nightly data processing workflow with incremental loads",
      "Build a data lake architecture with Iceberg tables"
    ]
  },
  {
    category: "Machine Learning",
    examples: [
      "Design an ML training pipeline with Snowpark and Model Registry",
      "Create a feature engineering pipeline for real-time predictions",
      "Build an ML inference architecture using UDFs"
    ]
  },
  {
    category: "Data Sharing",
    examples: [
      "Design a secure data sharing architecture with external partners",
      "Create a data marketplace listing with reader accounts",
      "Build a data mesh with cross-account sharing"
    ]
  }
];

// ==================================================================
// 5. Utilities (Mermaid rendering, download helpers)
// ==================================================================

export async function renderMermaidToSvg(mermaidCode: string): Promise<string> {
  const mermaid = await import('mermaid');
  const { svg } = await mermaid.render('snowgram-mermaid', mermaidCode);
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

// ==================================================================
// 8. Testing Utilities
// ==================================================================

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


