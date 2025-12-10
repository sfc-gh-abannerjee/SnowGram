-- =====================================================
-- Create SnowGram Cortex Agent
-- =====================================================
-- Purpose: Set up Cortex Agent for natural language diagram generation
-- Model: Claude Sonnet 4 (best for complex reasoning)
-- Tools: Custom UDFs/SPs + Cortex Analyst + Cortex Search
-- =====================================================

USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;
USE ROLE SVC_CURSOR_ROLE;
USE WAREHOUSE COMPUTE_WH;

-- =====================================================
-- Step 1: Verify Custom Tools Exist
-- =====================================================

-- List all custom functions/procedures that will be used as tools
SHOW USER FUNCTIONS IN SCHEMA SNOWGRAM_DB.CORE;
SHOW PROCEDURES IN SCHEMA SNOWGRAM_DB.CORE;

-- =====================================================
-- Step 2: Create Cortex Agent
-- =====================================================

CREATE OR REPLACE CORTEX AGENT SNOWGRAM_AGENT
  -- Use Claude Sonnet 4 for best reasoning capabilities
  MODEL = 'claude-4-sonnet'
  
  -- System prompt optimized for diagram generation
  SYSTEM_PROMPT = $$You are SnowGram, an expert Snowflake architecture diagram generator. Your role is to help users create professional, accurate Snowflake architecture diagrams using Mermaid syntax.

## Your Capabilities

You have access to:
1. **Component Library**: 52+ pre-built Snowflake components (blocks, patterns, templates)
2. **Custom Tools**: Functions to generate, validate, and optimize Mermaid diagrams
3. **Semantic Models**: Query component catalogs and relationships
4. **Documentation**: Search Snowflake documentation for best practices

## Your Approach

When a user requests a diagram:

1. **Understand the requirement**: Ask clarifying questions if needed (use case, complexity, specific components)

2. **Reuse existing components**: Always prioritize using pre-built blocks, patterns, or templates from the component library. Search the component catalog first using semantic models.

3. **Generate diagram**: Use custom tools to create valid Mermaid code:
   - Use GENERATE_MERMAID_FROM_COMPONENTS for custom compositions
   - Use COMPOSE_DIAGRAM_FROM_PATTERN for common patterns
   - Use COMPOSE_DIAGRAM_FROM_TEMPLATE for full architectures

4. **Validate syntax**: Always validate Mermaid syntax before returning

5. **Explain your work**: Provide a brief explanation of:
   - What components were used
   - Why this architecture fits their needs
   - Any best practices applied

## Diagram Guidelines

- Use Mermaid flowchart syntax (LR, TD, BT, or RL orientation)
- Keep diagrams clear and readable (6-12 nodes ideal)
- Use descriptive labels for nodes and connections
- Apply Snowflake styling (blue/purple theme)
- Include data flow directions (arrows with labels)
- Group related components when possible

## Example Queries You Can Handle

- "Create a real-time IoT pipeline with Kafka"
- "Show me an enterprise data warehouse with S3 ingestion"
- "Build a multi-cloud data mesh architecture"
- "Design a financial transactions pipeline"
- "Create a machine learning feature pipeline"

## Your Tone

Professional, helpful, and technically accurate. Focus on creating production-ready diagrams that follow Snowflake best practices.
$$
  
  -- Register custom tools (UDFs and Stored Procedures)
  TOOLS = (
    -- Diagram generation tools
    FUNCTION SNOWGRAM_DB.CORE.GENERATE_MERMAID_FROM_COMPONENTS,
    FUNCTION SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_PATTERN,
    FUNCTION SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE,
    FUNCTION SNOWGRAM_DB.CORE.VALIDATE_MERMAID_SYNTAX,
    FUNCTION SNOWGRAM_DB.CORE.OPTIMIZE_DIAGRAM_LAYOUT,
    FUNCTION SNOWGRAM_DB.CORE.SUGGEST_SNOWFLAKE_ICONS,
    
    -- Component search tools
    FUNCTION SNOWGRAM_DB.CORE.SEARCH_COMPONENT_BLOCKS,
    FUNCTION SNOWGRAM_DB.CORE.GET_PATTERN_BLOCKS,
    FUNCTION SNOWGRAM_DB.CORE.MERGE_DIAGRAMS
  )
  
  -- Connect to Cortex Search service for documentation
  CORTEX_SEARCH_SERVICES = (
    SNOWFLAKE_DOCS_SEARCH
  )
  
  COMMENT = 'SnowGram Cortex Agent for natural language diagram generation';

-- =====================================================
-- Step 3: Grant Permissions
-- =====================================================

-- Grant usage on the agent to the service role
GRANT USAGE ON CORTEX AGENT SNOWGRAM_AGENT TO ROLE SVC_CURSOR_ROLE;

-- Grant usage on custom tools (if not already granted)
GRANT USAGE ON FUNCTION SNOWGRAM_DB.CORE.GENERATE_MERMAID_FROM_COMPONENTS(ARRAY, VARIANT) TO ROLE SVC_CURSOR_ROLE;
GRANT USAGE ON FUNCTION SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_PATTERN(NUMBER) TO ROLE SVC_CURSOR_ROLE;
GRANT USAGE ON FUNCTION SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE(NUMBER) TO ROLE SVC_CURSOR_ROLE;
GRANT USAGE ON FUNCTION SNOWGRAM_DB.CORE.VALIDATE_MERMAID_SYNTAX(TEXT) TO ROLE SVC_CURSOR_ROLE;
GRANT USAGE ON FUNCTION SNOWGRAM_DB.CORE.OPTIMIZE_DIAGRAM_LAYOUT(TEXT, TEXT) TO ROLE SVC_CURSOR_ROLE;
GRANT USAGE ON FUNCTION SNOWGRAM_DB.CORE.SUGGEST_SNOWFLAKE_ICONS(TEXT) TO ROLE SVC_CURSOR_ROLE;
GRANT USAGE ON FUNCTION SNOWGRAM_DB.CORE.SEARCH_COMPONENT_BLOCKS(TEXT) TO ROLE SVC_CURSOR_ROLE;
GRANT USAGE ON FUNCTION SNOWGRAM_DB.CORE.GET_PATTERN_BLOCKS(NUMBER) TO ROLE SVC_CURSOR_ROLE;
GRANT USAGE ON FUNCTION SNOWGRAM_DB.CORE.MERGE_DIAGRAMS(TEXT, TEXT) TO ROLE SVC_CURSOR_ROLE;

-- =====================================================
-- Step 4: Verify Agent Creation
-- =====================================================

-- Show agent details
SHOW CORTEX AGENTS LIKE 'SNOWGRAM_AGENT';

-- Describe agent configuration
DESC CORTEX AGENT SNOWGRAM_AGENT;

-- =====================================================
-- Quick Test (Optional)
-- =====================================================

-- Test agent with a simple query
-- SELECT SNOWFLAKE.CORTEX.COMPLETE(
--     'SNOWGRAM_AGENT',
--     'Create a simple S3 to Snowflake ingestion pipeline'
-- );

-- =====================================================
-- Notes
-- =====================================================

-- Agent Configuration:
-- - Model: claude-4-sonnet (best for complex reasoning)
-- - Tools: 9 custom functions for diagram generation
-- - Search: Snowflake documentation via Cortex Search
-- - Semantic Models: Will be queried via custom tools
--
-- Next Steps:
-- 1. Test agent with sample queries (see test_agent.sql)
-- 2. Integrate with backend API (diagrams.py)
-- 3. Refine system prompt based on testing
-- 
-- Agent Usage in SQL:
-- SELECT SNOWFLAKE.CORTEX.COMPLETE('SNOWGRAM_AGENT', 'your query here');
--
-- Agent Usage in Python (backend):
-- cursor.execute("SELECT SNOWFLAKE.CORTEX.COMPLETE('SNOWGRAM_AGENT', ?)", [user_query])

