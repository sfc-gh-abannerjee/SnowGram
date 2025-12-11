# Environment Configuration

## Snowflake Cortex Agent Integration

The AI diagram generation feature requires a Snowflake Personal Access Token (PAT) to communicate with the Cortex Agent.

### Setup Instructions

1. **Create `.env.local` file** in the `frontend` directory:

```bash
# In frontend/.env.local
SNOWFLAKE_PAT=your_pat_token_here
```

2. **Source of PAT**: The PAT is stored in `~/.snowflake/config.toml` under the `se_demo` connection.

3. **Security Notes**:
   - `.env.local` is gitignored and will never be committed
   - The PAT is only used server-side in Next.js API routes
   - Never expose the PAT in client-side code

### How It Works

- **Backend Proxy** (`pages/api/agent/generate.ts`): Uses `SNOWFLAKE_PAT` from `.env.local` to call the Cortex Agent
- **Frontend** (`src/App.tsx`): Calls the backend proxy at `/api/agent/generate` (no PAT in browser)
- **Fallback**: For development, can optionally set `NEXT_PUBLIC_SNOWFLAKE_PAT` to call agent directly from frontend

### Testing the Integration

1. Start the dev server:
```bash
npm run dev
```

2. Click "Generate with AI" in the app
3. Enter a prompt (e.g., "Design a real-time streaming pipeline")
4. The agent will generate a Mermaid diagram and convert it to ReactFlow nodes

### Troubleshooting

- **"Snowflake PAT not configured"**: Ensure `.env.local` exists with valid `SNOWFLAKE_PAT`
- **"Failed to generate diagram"**: Check console for detailed error messages
- **404 errors**: Verify the agent exists at `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT`

### Related Files

- `frontend/.env.local` - Contains the PAT (not committed)
- `frontend/pages/api/agent/generate.ts` - Backend proxy
- `frontend/src/lib/snowgram-agent-client.ts` - Agent client
- `frontend/src/lib/mermaidToReactFlow.ts` - Mermaid parser






