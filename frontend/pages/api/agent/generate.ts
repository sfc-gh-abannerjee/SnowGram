import type { NextApiRequest, NextApiResponse } from 'next';
import { SnowgramAgentClient } from '../../../src/lib/snowgram-agent-client';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { query } = req.body as { query?: string };
    if (!query || query.length < 5) {
      return res.status(400).json({ error: 'Query must be at least 5 characters' });
    }

    const pat = process.env.SNOWFLAKE_PAT || process.env.SE_DEMO_PAT;
    if (!pat) {
      return res.status(500).json({ error: 'Server PAT not configured' });
    }

    const client = new SnowgramAgentClient(pat);
    const result = await client.generateArchitecture(query);

    res.status(200).json({ mermaidCode: result.mermaidCode });
  } catch (error) {
    console.error('Agent proxy error:', error);
    res.status(500).json({ error: 'Agent proxy failed' });
  }
}

