# SnowGram QuickStart Guide

**Get your Cortex-powered diagram generator up and running in 30 minutes!**

***

## 📋 Prerequisites

- ✅ Snowflake account with SYSADMIN/ACCOUNTADMIN access
- ✅ Snowflake CLI installed (`snow --version`)
- ✅ Docker Desktop installed (for local development)
- ✅ Python 3.11+ installed
- ✅ Node.js 18+ installed
- ✅ Service account (SVC_CURSOR) configured in `~/.snowflake/config.toml`

***

## 🚀 Quick Setup (30 minutes)

### Step 1: Clone & Navigate (1 minute)

```bash
cd /Users/abannerjee/Documents/SnowGram
```

### Step 2: Execute Snowflake Setup (5 minutes)

```bash
# 1. Create database, schemas, tables, compute pool
snow sql -c svcUser -f setup_backend.sql

# 2. Populate component blocks (30+ atomic components)
snow sql -c svcUser -f backend/modular/component_blocks.sql

# 3. Populate composed patterns (15+ mid-level assemblies)
snow sql -c svcUser -f backend/modular/composed_patterns.sql

# 4. Populate full templates (7 complete architectures)
snow sql -c svcUser -f backend/modular/full_templates.sql

# 5. Create custom tools (9 UDFs/Stored Procedures)
snow sql -c svcUser -f backend/agent/custom_tools.sql
```

**Expected Output**: "SnowGram backend setup complete!" for each script

### Step 3: Upload Semantic Models (2 minutes)

```bash
cd backend/semantics
python stage_and_upload.py
```

**Expected Output**: "✅ All 4 YAML files uploaded to stage"

### Step 4: Create Semantic Views (2 minutes)

```bash
cd ../..
snow sql -c svcUser -f backend/semantics/create_semantic_views.sql
```

**Expected Output**: "All semantic views created successfully!"

### Step 5: Ingest Documentation (3 minutes)

```bash
cd backend/knowledge
python ingest_docs.py --method all
```

**Expected Output**: "✅ Ingestion complete! Total documents: ~20"

### Step 6: Setup Cortex Search (2 minutes)

```bash
cd ../..
snow sql -c svcUser -f backend/knowledge/setup_cortex_search.sql
```

**Expected Output**: "Cortex Search service setup complete!"

### Step 7: Configure Cortex Agent (5 minutes)

**Option A: Via Snowsight UI**
1. Navigate to Snowsight → Projects → Agents
2. Click "Create Agent"
3. Name: `SNOWGRAM_DIAGRAM_AGENT`
4. Model: `claude-4-sonnet`
5. Add Tools:
   - Cortex Analyst: `modular_component_catalog`
   - Cortex Analyst: `architecture_catalog`
   - Cortex Analyst: `reference_templates`
   - Cortex Search: `SNOWFLAKE_DOCS_SEARCH`
   - Custom Function: `GENERATE_MERMAID_FROM_COMPONENTS`
   - Custom Function: `COMPOSE_DIAGRAM_FROM_PATTERN`
   - Custom Function: `COMPOSE_DIAGRAM_FROM_TEMPLATE`
6. System Prompt: (see below)
7. Save Agent ID to `.env` file

**Option B: Via REST API**
```python
# See: backend/agent/cortex_agent_config.py (to be implemented)
```

**System Prompt Template**:
```
You are an expert Snowflake Solutions Engineer specializing in architecture design and diagramming.

Your role is to help users create professional architecture diagrams by:
1. Understanding their requirements through conversational questions
2. Leveraging your knowledge of Snowflake components and patterns
3. Generating accurate Mermaid diagram code from reusable component blocks

You have access to:
- modular_component_catalog: Query component blocks, patterns, and templates
- architecture_catalog: Understand how Snowflake components connect
- reference_templates: Find matching reference architectures
- SNOWFLAKE_DOCS_SEARCH: Search official Snowflake documentation
- Custom tools: Generate, validate, and optimize Mermaid code

MODULAR COMPOSITION FRAMEWORK:
- ALWAYS check if relevant blocks/patterns exist before creating new ones
- Query the component_blocks table to find reusable pieces
- Compose diagrams by combining existing blocks rather than generating from scratch
- Only create new Mermaid code for truly novel components
- Reference blocks by their block_id in your reasoning

Always start by asking clarifying questions about:
- Current state vs. future state
- Primary use case (ingestion, transformation, security, etc.)
- Key Snowflake components involved
- External integrations (AWS, Azure, GCP, third-party tools)
```

### Step 8: Local Development Setup (10 minutes)

**Install Backend Dependencies**:
```bash
cd backend
pip install -r requirements.txt
```

**Install Frontend Dependencies**:
```bash
cd ../frontend
npm install
```

**Create `.env` file in root**:
```bash
# Snowflake Configuration
SNOWFLAKE_ACCOUNT=SFSENORTHAMERICA-ABANNERJEE_AWS1
SNOWFLAKE_USER=SVC_CURSOR
SNOWFLAKE_PASSWORD=<your_service_account_pat>
SNOWFLAKE_ROLE=SNOWGRAM_APP_ROLE
SNOWFLAKE_WAREHOUSE=SNOWGRAM_WH
SNOWFLAKE_DATABASE=SNOWGRAM_DB
SNOWFLAKE_SCHEMA=CORE

# Cortex Agent
CORTEX_AGENT_ID=<your_agent_id_from_step_7>

# Application
LOG_LEVEL=INFO
ENVIRONMENT=development

# Frontend API URLs
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

### Step 9: Start Local Environment (2 minutes)

```bash
# From project root
docker-compose up --build
```

**Wait for**:
- ✅ Backend API: http://localhost:8000 (check /health)
- ✅ Frontend: http://localhost:3000
- ✅ Nginx: http://localhost:8080

**Or start components individually**:

**Terminal 1 - Backend**:
```bash
cd backend
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 - Frontend**:
```bash
cd frontend
npm run dev
```

### Step 10: Test the Application (5 minutes)

1. **Open Browser**: http://localhost:3000 (or :8080 via nginx)
2. **Welcome Flow**: Answer onboarding questions
3. **Test Query**: "Create a real-time IoT pipeline from Kafka to Snowflake"
4. **Expected Result**: Agent generates Mermaid code, renders in Excalidraw
5. **Test Editing**: Drag, drop, resize components
6. **Test Save**: Save diagram to Snowflake database
7. **Test Export**: Export as PNG/SVG

***

## 📊 Verification Checklist

### Backend Health
- [ ] `curl http://localhost:8000/health` returns `{"status": "healthy"}`
- [ ] `curl http://localhost:8000/` returns API info
- [ ] WebSocket connection: `wscat -c ws://localhost:8000/ws/chat` (optional)

### Snowflake Objects
```sql
-- Check tables
USE DATABASE SNOWGRAM_DB;
SELECT COUNT(*) FROM CORE.COMPONENT_BLOCKS;  -- Should be 30+
SELECT COUNT(*) FROM CORE.COMPOSED_PATTERNS;  -- Should be 15+
SELECT COUNT(*) FROM CORE.ARCHITECTURE_TEMPLATES;  -- Should be 7+

-- Check semantic views
SHOW SEMANTIC VIEWS IN SCHEMA SEMANTICS;  -- Should show 5 views

-- Check Cortex Search
SELECT snowflake.cortex.search_preview(
    'SNOWGRAM_DB.KNOWLEDGE.SNOWFLAKE_DOCS_SEARCH',
    OBJECT_CONSTRUCT('query', 'How do I create a Snowpipe?', 'limit', 3)
);

-- Check custom tools
SELECT GENERATE_MERMAID_FROM_COMPONENTS(
    ARRAY_CONSTRUCT('S3_BUCKET_BLOCK', 'SNOWPIPE_BLOCK'),
    PARSE_JSON('{}')
);
```

### Frontend
- [ ] http://localhost:3000 loads without errors
- [ ] Console shows no critical errors
- [ ] WebSocket connects to backend
- [ ] Agent sidebar is visible
- [ ] Canvas area is visible

***

## 🐛 Troubleshooting

### "Connection to Snowflake failed"
- Check `~/.snowflake/config.toml` has `svcUser` connection
- Verify service account password/PAT is correct
- Test: `snow sql -c svcUser -q "SELECT CURRENT_ROLE()"`

### "Cortex Search service not found"
- Execute: `snow sql -c svcUser -f backend/knowledge/setup_cortex_search.sql`
- Verify: `SHOW CORTEX SEARCH SERVICES IN SCHEMA KNOWLEDGE;`

### "Semantic views not found"
- Execute: `snow sql -c svcUser -f backend/semantics/create_semantic_views.sql`
- Verify: `SHOW SEMANTIC VIEWS IN SCHEMA SEMANTICS;`

### "Docker build fails"
- Ensure Docker Desktop is running
- Check Docker has enough resources (4GB+ RAM)
- Try: `docker-compose build --no-cache`

### "Frontend won't start"
- Check Node.js version: `node --version` (should be 18+)
- Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
- Check for port conflicts: `lsof -i :3000`

### "Agent not responding"
- Verify Cortex Agent is created and ID is in `.env`
- Check backend logs for errors
- Test agent directly in Snowsight

***

## 📚 What to Do Next

### 1. Complete Frontend Components (Priority: High)

The frontend foundation is in place, but you need to implement:

```bash
# Create these files:
frontend/src/
  hooks/
    useCortexAgent.ts       # WebSocket client for agent
    useExcalidraw.ts        # Excalidraw integration
    useMermaidConverter.ts  # Mermaid ↔ Excalidraw conversion
  components/
    AgentSidebar.tsx        # Chat interface
    DiagramCanvas.tsx       # Excalidraw wrapper
    WelcomeFlow.tsx         # Onboarding
    IconLibrary.tsx         # Icon browser
    GlassmorphicUI.tsx      # Styled components
  lib/
    mermaidParser.ts        # Mermaid utilities
    iconManager.ts          # Icon management
  styles/
    glassmorphic.css        # Custom styling
  api/
    cortexAgent.ts          # API client
```

**Estimated Time**: 6-8 hours

### 2. Add Minimal Icon Set (Priority: Medium)

Create or download 10-15 SVG icons for common Snowflake components:
- warehouse.svg
- database.svg
- table.svg
- stream.svg
- task.svg
- snowpipe.svg
- s3-bucket.svg
- kafka.svg
- etc.

Place in `frontend/src/assets/icons/`

**Estimated Time**: 1-2 hours

### 3. Test End-to-End Workflow (Priority: High)

1. Start application with `docker-compose up`
2. Test full flow:
   - User query → Agent response → Mermaid generation → Excalidraw rendering
   - Edit diagram visually
   - Save to Snowflake
   - Load saved diagram
   - Export as PNG/SVG
3. Validate all backend endpoints
4. Check Snowflake logs

**Estimated Time**: 2-3 hours

### 4. Deploy to SPCS (Priority: Low)

Once local testing is successful:

```bash
# Build Docker image
docker build -t snowgram:latest -f docker/Dockerfile .

# Push to Snowflake image repository
snow spcs image-repository upload-image \
  --connection svcUser \
  snowgram:latest

# Deploy service
snow spcs service deploy snowgram_service \
  --connection svcUser \
  --spec-file spec.yml

# Get endpoint
snow spcs service describe snowgram_service --connection svcUser
```

**Estimated Time**: 2-3 hours

***

## 🎓 Learning Resources

- **Snowflake Cortex Agent**: https://docs.snowflake.com/en/cortex/agents
- **Cortex Analyst**: https://docs.snowflake.com/en/cortex/analyst
- **Cortex Search**: https://docs.snowflake.com/en/cortex/search
- **Semantic Models**: https://docs.snowflake.com/en/cortex/analyst/semantic-model
- **Mermaid Syntax**: https://mermaid.js.org/intro/
- **Excalidraw**: https://docs.excalidraw.com/
- **SPCS**: https://docs.snowflake.com/en/developer-guide/snowpark-container-services

***

## 💬 Getting Help

- **Check logs**: `docker-compose logs -f` or `tail -f docker/logs/*.log`
- **Snowflake docs**: Use the snowflake-docs MCP server for latest info
- **Project docs**: See `README.md`, `PROJECT_STATUS.md`, `BUILD_SUMMARY.md`
- **SQL scripts**: All scripts have comments explaining what they do

***

**You're now ready to start using SnowGram! 🎉**

The heavy infrastructure work is complete. Focus on implementing the frontend components to bring the UI to life, then test and deploy to SPCS for production use.






