# Cortex Code Guide for SnowGram

A comprehensive guide for working with SnowGram using Cortex Code CLI, following Anthropic and Snowflake best practices.

## Documentation Structure

SnowGram follows the **progressive disclosure** pattern recommended by Anthropic:

```
CLAUDE.md (root)           <- Concise, ~60 lines, loaded every session
  ├── Quick reference
  ├── Essential commands  
  ├── Critical gotchas
  └── Pointers to detailed docs

.cortex/MEMORY.md          <- Project context, grows over time
  ├── Snowflake resources
  ├── Architecture overview
  ├── Agent configuration
  └── Recent changes

.cortex/skills/            <- Domain knowledge, loaded on demand
  ├── snowgram-agent/      <- Agent management
  └── snowgram-architect/  <- Diagram generation

docs/                      <- Deep dives, referenced by path
  ├── AI_POWERED_DIAGRAM_ARCHITECTURE.md
  └── CORTEX_CODE_GUIDE.md (this file)
```

## Working with SnowGram

### Session Setup

```bash
# Start Cortex Code in SnowGram directory
cd /Users/abannerjee/Documents/SnowGram
cortex -c se_demo
```

### Common Workflows

#### 1. Generate Architecture Diagram

Use the `snowgram-architect` skill:
```
> $snowgram-architect Create a medallion architecture diagram
```

Or directly via SQL:
```sql
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('MEDALLION_LAKEHOUSE');
```

#### 2. Debug Agent Issues

Use the `snowgram-agent` skill:
```
> $snowgram-agent Debug why agent isn't showing Mermaid code
```

#### 3. Update Agent Configuration

```sql
-- Check current config
DESCRIBE AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;

-- Recreate (cannot ALTER AGENT_SPEC)
DROP AGENT IF EXISTS SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;
CREATE OR REPLACE AGENT ... FROM SPECIFICATION $$ ... $$;
```

## Agent Architecture

### Tool Priority System

The SnowGram agent uses a prioritized tool selection system:

```
PRIORITY 1: Templates (COMPOSE_DIAGRAM_FROM_TEMPLATE)
  └── For: Complete reference architectures
  └── Returns: Full Mermaid diagram with subgraphs and styling

PRIORITY 2: Patterns (COMPOSE_DIAGRAM_FROM_PATTERN)
  └── For: Specific data flow patterns
  └── Returns: Focused Mermaid for single flows

PRIORITY 3: Search (SEARCH_COMPONENT_BLOCKS_JSON)
  └── For: Custom diagrams when no template matches
  └── Returns: JSON array of matching components

PRIORITY 4: Documentation (snowflake_docs, arch_patterns)
  └── For: Best practices and syntax reference
  └── Returns: Search results from Cortex Search
```

### Critical Configuration

The agent spec must include these elements to work correctly:

**1. System Instructions:**
```yaml
instructions:
  system: |
    CRITICAL OUTPUT REQUIREMENT:
    When any tool returns Mermaid code, you MUST include that EXACT code 
    in your response inside a mermaid code block.
```

**2. Tool Descriptions:**
```yaml
tools:
  - tool_spec:
      description: |
        CRITICAL: After calling this tool, you MUST include the returned 
        Mermaid code VERBATIM in your response inside a ```mermaid code block.
```

**3. Response Instructions:**
```yaml
instructions:
  response: |
    NEVER skip the Mermaid code section. 
    NEVER say 'Diagram updated' without showing the actual code.
```

### Why These Matter

Without explicit output instructions, Claude will:
- Acknowledge the tool call completed
- Say "Diagram updated. Review the canvas."
- NOT include the actual Mermaid code

This happens because Claude's base behavior is to summarize tool results rather than output them verbatim.

## Template Development

### Adding a New Template

1. **Create the Mermaid code:**
```sql
-- Test your Mermaid syntax
SELECT SNOWGRAM_DB.CORE.VALIDATE_MERMAID_SYNTAX('
flowchart LR
    subgraph sources["External"]
        s1["Source"]
    end
    subgraph snowflake["Snowflake"]
        d1["Dest"]
    end
    s1 --> d1
');
```

2. **Insert into templates table:**
```sql
INSERT INTO SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES 
  (TEMPLATE_ID, TEMPLATE_NAME, DESCRIPTION, MERMAID_CODE, BEST_PRACTICES)
SELECT
  'MY_NEW_TEMPLATE',
  'My New Architecture',
  'Description of what this template represents',
  'flowchart LR ...',
  ARRAY_CONSTRUCT(
    'Best practice 1: Use dedicated warehouses',
    'Best practice 2: Enable Search Optimization Service'
  );
```

3. **Update agent orchestration instructions:**
Add the new template to the list in the agent spec.

4. **Recreate the agent:**
```sql
DROP AGENT IF EXISTS SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;
CREATE OR REPLACE AGENT ... FROM SPECIFICATION $$ ... $$;
```

### Template Best Practices

Based on Snowflake reference architectures:

| Pattern | Best Practice |
|---------|---------------|
| Dynamic Tables | Use `TARGET_LAG` appropriately, dedicated warehouse |
| Snowpipe Streaming | Tune `MAX_CLIENT_LAG` (default 1 second may be too aggressive) |
| Hybrid Tables | Use for low-latency point lookups, CTAS for bulk loading |
| Search Optimization Service | Enable for log analytics with LIKE queries |
| Masking Policies | Use `IS_ROLE_IN_SESSION()` not `CURRENT_ROLE()` |
| Iceberg Tables | Use External Catalog for multi-engine interoperability |

## Testing

### Unit Tests
```bash
cd backend/tests/agent
python run_tests.py           # Smoke tests (~2 min)
python run_tests.py --all     # Full suite (~13 min)
```

### Manual Testing
```sql
-- Test each template
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('MEDALLION_LAKEHOUSE');
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('STREAMING_DATA_STACK');
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('SECURITY_ANALYTICS');
-- ... repeat for all 14 templates
```

### Agent Testing
Use the Snowsight Chat interface or Cortex Code:
```
> Ask the agent to create a medallion architecture diagram
> Verify the response includes actual Mermaid code
> Verify the code is syntactically valid
```

## Troubleshooting

### Common Issues

#### Agent Returns "Diagram Updated" Without Code

**Symptom:** Agent calls tool successfully but response is just acknowledgment.

**Diagnosis:**
```sql
DESCRIBE AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;
-- Check agent_spec JSON for tool description
```

**Fix:** Update tool description to include explicit output requirement.

#### UDTF Cannot Be Called

**Symptom:** Error when agent tries to call `SEARCH_COMPONENT_BLOCKS`.

**Cause:** Cortex Agents only support scalar UDFs, not table functions.

**Fix:** Use the JSON wrapper:
```sql
-- Wrapper UDF that returns JSON
SELECT SNOWGRAM_DB.CORE.SEARCH_COMPONENT_BLOCKS_JSON('kafka');
```

#### Agent Spec Not Updating

**Symptom:** Changed spec but agent behavior unchanged.

**Cause:** `ALTER AGENT SET AGENT_SPEC` is not supported.

**Fix:** Must DROP and CREATE OR REPLACE:
```sql
DROP AGENT IF EXISTS SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;
CREATE OR REPLACE AGENT ... FROM SPECIFICATION $$ ... $$;
```

### Diagnosing Agent Output Issues

When the agent isn't producing expected output, use this systematic approach to isolate the problem.

#### 1. Testing Agent Directly

Use the `agent-optimization` skill's test script to bypass the frontend and test the agent via API:

```bash
uv run --project /path/to/bundled_skills/agent_optimization \
  python .../scripts/test_agent.py \
  --agent-name SNOWGRAM_AGENT \
  --question "Create a medallion architecture diagram" \
  --database SNOWGRAM_DB --schema AGENTS \
  --connection se_demo \
  --output-file test_output.json
```

This sends a request directly to the Cortex Agent API, eliminating frontend variables.

#### 2. Interpreting Results

| API Test Result | Frontend Behavior | Root Cause Location |
|-----------------|-------------------|---------------------|
| Works correctly | Works correctly | No issue |
| Works correctly | Broken | Frontend prompt override |
| Broken | Broken | Agent configuration |

- **If agent works via API but not frontend** → The issue is in the frontend's prompt override. The frontend may be sending its own system prompt that conflicts with the agent's configured instructions.

- **If agent doesn't work via API** → The issue is in the agent configuration itself (tool descriptions, system instructions, or response instructions).

#### 3. Common Fix Locations

**Agent Configuration Issues:**
- Cannot use `ALTER AGENT SET AGENT_SPEC` - must `DROP` and `CREATE OR REPLACE`
- Check tool descriptions include explicit output requirements
- Verify system instructions tell agent to output Mermaid code verbatim

```sql
-- View current agent spec
DESCRIBE AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;

-- Recreate with fixed spec
DROP AGENT IF EXISTS SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT;
CREATE OR REPLACE AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT FROM SPECIFICATION $$ ... $$;
```

**Frontend Prompt Override:**
- Check `frontend/src/lib/snowgram-agent-client.ts`
- Look for `SNOWGRAM_SYSTEM_PROMPT` constant
- This prompt is sent with every request and can override agent-configured behavior
- Ensure frontend prompt aligns with agent's expected behavior

## Best Practices for Cortex Code Users

### 1. Use Skills for Domain Tasks

Instead of remembering complex SQL:
```
> $snowgram-agent Debug agent output issues
```

### 2. Keep CLAUDE.md Concise

- Root CLAUDE.md: < 60 lines
- Only universally applicable info
- Use pointers to detailed docs

### 3. Use .cortex/MEMORY.md for Context

- Growing project knowledge
- Recent changes log
- Resource references

### 4. Test Before Assuming

Always verify tool behavior:
```sql
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('SECURITY_ANALYTICS');
```

### 5. Document Gotchas

When you discover an issue, add it to:
- CLAUDE.md (if critical and brief)
- .cortex/MEMORY.md (for context)
- Relevant skill (for domain-specific)

## Resources

- [Anthropic Claude Code Best Practices](https://code.claude.com/docs/en/best-practices)
- [Snowflake Cortex Code CLI](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-code-cli)
- [Cortex Agents Documentation](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)
