import type { NextApiRequest, NextApiResponse } from 'next';
import { SnowgramAgentClient } from '../../../src/lib/snowgram-agent-client';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
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
      return res.status(500).json({ error: 'Server PAT not configured' });
    }

    const client = new SnowgramAgentClient(pat);
    // Pass thread info for conversation continuity
    const result = await client.generateArchitecture(query, threadId, parentMessageId);

    res.status(200).json({
      mermaidCode: result.mermaidCode,
      spec: result.spec,
      overview: result.overview,
      bestPractices: result.bestPractices,
      antiPatterns: result.antiPatterns,
      components: result.components,
      rawResponse: result.rawResponse,
      // Return thread info for frontend to persist
      threadId: result.threadId,
      messageId: result.messageId,
    });
  } catch (error) {
    console.error('Agent proxy error:', error);
    res.status(500).json({ error: 'Agent proxy failed' });
  }
}

