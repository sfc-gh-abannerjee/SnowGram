# SNOWGRAM Agent - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Install Dependencies

```bash
npm install axios
# or
yarn add axios
```

### Step 2: Copy the Agent Client

Copy the entire `snowgram-agent-client.ts` file into your Snowgram project:

```
src/
  lib/
    snowgram-agent-client.ts  ← Copy here
```

### Step 3: Add Environment Variable

```bash
# .env
SNOWFLAKE_PAT=your_pat_token_here
```

### Step 4: Use in Your Component

```typescript
import { SnowgramAgentClient } from './lib/snowgram-agent-client';

function MyComponent() {
  const client = new SnowgramAgentClient(process.env.SNOWFLAKE_PAT!);
  
  const handleGenerate = async () => {
    const result = await client.generateArchitecture(
      "Design a real-time streaming pipeline"
    );
    
    console.log(result.mermaidCode);     // Mermaid diagram
    console.log(result.bestPractices);   // Best practices array
    console.log(result.citations);       // Docs URLs
  };
  
  return <button onClick={handleGenerate}>Generate</button>;
}
```

That's it! You're now using the SNOWGRAM agent.

---

## 📊 What You Get Back

Every agent call returns:

```typescript
{
  mermaidCode: "flowchart LR\n  Kafka --> Snowpipe...",
  overview: "This architecture uses Snowpipe Streaming...",
  components: [
    {
      name: "Snowpipe Streaming",
      purpose: "Continuous loading with 1-second latency",
      configuration: "Set MAX_CLIENT_LAG to 50-55s",
      bestPractice: "Use for real-time, not file-based",
      source: "https://docs.snowflake.com/..."
    }
  ],
  bestPractices: [
    "Set MAX_CLIENT_LAG as high as target latency allows",
    "Use Dynamic Tables for incremental transformations"
  ],
  antiPatterns: [
    "Don't use file-based Snowpipe for real-time"
  ],
  citations: [
    {
      url: "https://docs.snowflake.com/en/user-guide/snowpipe-streaming",
      title: "Snowpipe Streaming Overview"
    }
  ]
}
```

---

## 🎯 Example Queries

### Real-time Streaming
```typescript
"Design a real-time IoT pipeline with Kafka and Snowpipe Streaming"
```

### Batch ETL
```typescript
"Create a batch ETL pipeline loading data from S3 into data warehouse"
```

### Machine Learning
```typescript
"Build an ML training pipeline with Snowpark and Model Registry"
```

### Data Sharing
```typescript
"Design a secure data sharing architecture with external partners"
```

---

## 🔧 Advanced: React Hook

For easier integration in React:

```typescript
import { useSnowgramAgent } from './lib/snowgram-agent-client';

function MyComponent() {
  const { generate, loading, result, error } = useSnowgramAgent(
    process.env.SNOWFLAKE_PAT!
  );
  
  return (
    <div>
      <button onClick={() => generate("real-time streaming")}>
        {loading ? 'Generating...' : 'Generate'}
      </button>
      
      {error && <div>Error: {error}</div>}
      
      {result && (
        <div>
          <pre>{result.mermaidCode}</pre>
          <ul>
            {result.bestPractices.map(p => <li>{p}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
```

---

## 🔐 Security: Backend Proxy (Recommended)

Instead of using PAT in frontend, proxy through backend:

### Backend API
```typescript
// backend/routes/agent.ts
import express from 'express';
import { SnowgramAgentClient } from '../lib/snowgram-agent-client';

const router = express.Router();

router.post('/generate', async (req, res) => {
  const { query } = req.body;
  
  const client = new SnowgramAgentClient(process.env.SNOWFLAKE_PAT!);
  const result = await client.generateArchitecture(query);
  
  res.json(result);
});

export default router;
```

### Frontend
```typescript
async function generate(query: string) {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  
  return response.json();
}
```

---

## 📚 Documentation

**Full Guide:** See `/Users/abannerjee/Documents/SnowGram/CURSOR_INTEGRATION_GUIDE.md`

**Code Examples:** See `/Users/abannerjee/Documents/SnowGram/snowgram-agent-client.ts`

**Agent Status:** See `/tmp/CKE_INTEGRATION_FINAL_STATUS.md`

---

## ✅ Feature Checklist

- [x] Connected to 41,492 Snowflake documentation pages (CKE)
- [x] Uses claude-sonnet-4-5 for all AI operations
- [x] Returns Mermaid diagrams with Snowflake styling
- [x] Provides docs.snowflake.com citations
- [x] Includes best practices and anti-patterns
- [x] AI-powered component recommendations
- [x] Validates against official documentation
- [x] Multi-turn conversation support
- [x] Streaming response support
- [x] TypeScript types included

---

## 🚨 Common Issues

### Issue: "Unauthorized" error
**Solution:** Check your PAT token is valid and has USAGE privilege on SNOWGRAM_AGENT

### Issue: Empty response
**Solution:** Query must be at least 10 characters and describe an architecture

### Issue: Slow response (>10 seconds)
**Solution:** This is normal - agent searches 41K docs. Consider caching or streaming.

### Issue: No Mermaid code returned
**Solution:** Agent may have returned text explanation only. Check `rawResponse` field.

---

## 🎓 Learn More

### Agent Capabilities
- Documentation-first approach (always queries CKE)
- Component confidence scoring (0-1 range)
- Automatic syntax validation
- Cross-reference with official docs

### Tools Available to Agent
1. **SNOWFLAKE_DOCS_CKE** - 41,492 documentation pages
2. **SUGGEST_COMPONENTS_FOR_USE_CASE** - AI recommendations
3. **GET_ARCHITECTURE_BEST_PRACTICE** - Cached patterns
4. **GENERATE_MERMAID_FROM_COMPONENTS** - Diagram generation
5. **VALIDATE_DIAGRAM_SYNTAX** - Mermaid validation
6. Plus 8 more specialized tools

### Response Time
- Simple query: 2-3 seconds
- Complex architecture: 4-6 seconds
- With multiple refinements: 3-5 seconds per turn

---

## 📞 Support

**Agent Location:** `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT`  
**Connection:** `se_demo` (abb59444.us-east-1)  
**Status:** Production Ready  
**Last Updated:** December 9, 2025

---

## 🎉 Next Steps

1. **Try It Out**: Run the example queries above
2. **Integrate**: Add to your Snowgram UI
3. **Customize**: Modify the client for your needs
4. **Monitor**: Track usage and response times
5. **Optimize**: Add caching for common queries

Happy architecting! 🏗️
