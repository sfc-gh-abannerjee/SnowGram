import type { NextApiRequest, NextApiResponse } from 'next';

// System prompt is defined in the agent itself - we just need to pass the user query
// The agent has ORCHESTRATION_INSTRUCTIONS that tell it when to use tools

export const config = {
  api: {
    responseLimit: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query, threadId, parentMessageId } = req.body as {
    query?: string;
    threadId?: number;
    parentMessageId?: number;
  };

  if (!query || query.length < 5) {
    return res.status(400).json({ error: 'Query must be at least 5 characters' });
  }

  const pat = process.env.SNOWFLAKE_PAT || process.env.SE_DEMO_PAT;
  if (!pat) {
    console.error('[Stream API] No PAT configured');
    return res.status(500).json({ error: 'Server PAT not configured' });
  }
  console.log('[Stream API] PAT found, length:', pat.length);

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const baseUrl = 'https://abb59444.us-east-1.snowflakecomputing.com';
  const headers = {
    'Authorization': `Bearer ${pat}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1) Create or reuse thread
    let thread_id = threadId;
    
    if (!thread_id) {
      console.log('[Stream API] Creating new thread...');
      const threadResp = await fetch(`${baseUrl}/api/v2/cortex/threads`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });

      if (!threadResp.ok) {
        const errText = await threadResp.text();
        console.error('[Stream API] Thread creation failed:', threadResp.status, errText);
        res.write(`data: ${JSON.stringify({ type: 'error', error: `Thread create failed: ${errText}` })}\n\n`);
        res.end();
        return;
      }

      const threadData = await threadResp.json();
      thread_id = threadData.thread_id;
      console.log('[Stream API] Thread created:', thread_id);
    }

    // Send thread ID immediately
    res.write(`data: ${JSON.stringify({ type: 'thread', threadId: thread_id })}\n\n`);

    // 2) Run the agent - let the agent's built-in instructions guide it
    // The agent has ORCHESTRATION_INSTRUCTIONS that tell it when to use tools
    // We add output format hints but let the agent use its tools
    const userMessage = `${query}

**CRITICAL - MERMAID OUTPUT REQUIREMENT:**
When your tools (COMPOSE_DIAGRAM_FROM_TEMPLATE, COMPOSE_DIAGRAM_FROM_PATTERN, etc.) return Mermaid code, you MUST include that code VERBATIM in your response inside a \`\`\`mermaid\`\`\` code block.
- Do NOT summarize or paraphrase the Mermaid code
- Do NOT say "Diagram updated" or "Here's your diagram" without the actual code
- ALWAYS copy the FULL Mermaid flowchart/diagram syntax from the tool result into your response
- The user needs to see the complete Mermaid code to render the diagram

ADDITIONAL OUTPUT FORMAT:
- Include a JSON code block with nodes and edges arrays
- Each node needs: id, label, componentType (sf_* for Snowflake, ext_* for external), boundary
- boundary values: "snowflake" for Snowflake services, "aws"/"azure"/"gcp"/"kafka" only if explicitly mentioned
- Connect every node to at least one other node via edges`;

    console.log('[Stream API] Running agent with query:', query.slice(0, 100));
    // Use the correct endpoint for agent objects: /api/v2/databases/{db}/schemas/{schema}/agents/{name}:run
    const runResp = await fetch(`${baseUrl}/api/v2/databases/SNOWGRAM_DB/schemas/AGENTS/agents/SNOWGRAM_AGENT:run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        thread_id,
        parent_message_id: parentMessageId || 0,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: userMessage }],
          },
        ],
        // Let the agent decide which tools to use based on its instructions
        // Available tools: snowflake_docs, arch_patterns, component_resolver, 
        // COMPOSE_DIAGRAM_FROM_TEMPLATE, COMPOSE_DIAGRAM_FROM_PATTERN, etc.
      }),
    });

    console.log('[Stream API] Agent response status:', runResp.status);
    if (!runResp.ok) {
      const errText = await runResp.text();
      console.error('[Stream API] Agent failed:', runResp.status, errText);
      res.write(`data: ${JSON.stringify({ type: 'error', error: `Agent failed: ${errText}` })}\n\n`);
      res.end();
      return;
    }

    const contentType = runResp.headers.get('content-type') || '';
    let fullText = '';

    if (contentType.includes('text/event-stream')) {
      // Stream SSE from Snowflake to client
      // New format uses: event: <type>\ndata: <json>\n\n
      const reader = runResp.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = ''; // Buffer for incomplete SSE lines across chunks
      let currentEvent = ''; // Track the current event type

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        // Use stream: true to handle multi-byte characters split across chunks
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // Process complete lines only, keep incomplete line in buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep last incomplete line in buffer

        for (const line of lines) {
          // Track event type for next data line
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
            // Log all event types for comprehensive debugging
            console.log('[SSE] Event:', currentEvent);
            continue;
          }
          
          // Log error events with full payload
          if (currentEvent === 'error') {
            console.error('[SSE] ERROR payload:', line);
          }
          
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          
          try {
            const data = JSON.parse(payload);
            
            // Handle different event types from Snowflake's new SSE format
            if (currentEvent === 'response.text.delta' || currentEvent === 'response.text') {
              const text = data?.text || '';
              if (text && currentEvent === 'response.text.delta') {
                // Only stream deltas, not the final response.text (which is a duplicate)
                fullText += text;
                res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
              }
            } else if (currentEvent === 'response.thinking.delta' || currentEvent === 'response.thinking') {
              // Stream thinking process to client (extended thinking from Claude models)
              const text = data?.text || '';
              if (text) {
                console.log('[SSE] Thinking event:', currentEvent, text.slice(0, 50));
                res.write(`data: ${JSON.stringify({ type: 'thinking', text })}\n\n`);
              }
            } else if (currentEvent === 'response.tool_use') {
              // Stream tool use (when agent calls a tool) to client
              // Per Cortex Agent API docs: event type is 'response.tool_use'
              console.log('[SSE] Tool use event:', JSON.stringify(data).slice(0, 200));
              res.write(`data: ${JSON.stringify({ type: 'tool_use', tool: data })}\n\n`);
            } else if (currentEvent === 'response.tool_result') {
              // Stream tool results to client - includes search results, etc.
              console.log('[SSE] Tool result event:', JSON.stringify(data).slice(0, 500));
              res.write(`data: ${JSON.stringify({ type: 'tool_result', result: data })}\n\n`);
              
              // Also send a status update so user knows search completed
              const toolName = data.name || 'search';
              res.write(`data: ${JSON.stringify({ type: 'status', message: `${toolName} completed` })}\n\n`);
            } else if (data?.tool_calls || data?.tool_use) {
              // Legacy/alternative tool call format (some agents send tool_use in data)
              console.log('[SSE] Legacy tool event:', JSON.stringify(data).slice(0, 200));
              res.write(`data: ${JSON.stringify({ type: 'tool_use', tool: data.tool_use || data })}\n\n`);
            } else if (currentEvent === 'metadata' && data?.metadata?.message_id) {
              // Could track message IDs if needed
            } else {
              // Fallback: try to extract text from any format
              const text = data?.text || data?.data || '';
              if (text) {
                fullText += text;
                res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
              }
            }
            
            currentEvent = ''; // Reset after processing data
          } catch {
            // Non-JSON payload, treat as text
            if (payload !== '[DONE]') {
              fullText += payload;
              res.write(`data: ${JSON.stringify({ type: 'chunk', text: payload })}\n\n`);
            }
          }
        }
      }
      
      // Flush any remaining buffered content
      if (buffer.trim()) {
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (payload && payload !== '[DONE]') {
              try {
                const data = JSON.parse(payload);
                const text = data?.text || data?.data || '';
                if (text) {
                  fullText += text;
                  res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
                }
              } catch {
                fullText += payload;
                res.write(`data: ${JSON.stringify({ type: 'chunk', text: payload })}\n\n`);
              }
            }
          }
        }
      }
    } else {
      // JSON response fallback
      const runJson = await runResp.json();
      const messages = runJson?.messages || [];
      const agentMsg = messages.find((m: any) => m.role === 'agent');
      fullText = agentMsg?.content?.find((c: any) => c.type === 'text')?.text || '';
      
      // Send the full response as one chunk
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: fullText })}\n\n`);
    }

    // Send completion with full text for parsing
    res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Stream failed' })}\n\n`);
    res.end();
  }
}
