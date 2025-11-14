-- =====================================================
-- Semantic Views Creation Script
-- =====================================================
-- Purpose: Create semantic views for natural language querying
-- Note: Requires semantic models to be staged first
-- =====================================================

USE DATABASE SNOWGRAM_DB;
USE SCHEMA SEMANTICS;
USE ROLE SYSADMIN;

-- =====================================================
-- 1. Modular Component Catalog Semantic View
-- =====================================================

-- This view enables queries like:
-- "Find blocks related to Kafka ingestion"
-- "Show me patterns for data transformation"
-- "Which templates include RBAC security?"

CREATE OR REPLACE SEMANTIC VIEW modular_component_catalog
  TABLES (
    blocks AS SNOWGRAM_DB.CORE.COMPONENT_BLOCKS PRIMARY KEY (block_id),
    patterns AS SNOWGRAM_DB.CORE.COMPOSED_PATTERNS PRIMARY KEY (pattern_id),
    templates AS SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES PRIMARY KEY (template_id),
    pattern_blocks AS SNOWGRAM_DB.CORE.PATTERN_BLOCK_RELATIONSHIPS PRIMARY KEY (pattern_id, block_id),
    template_patterns AS SNOWGRAM_DB.CORE.TEMPLATE_PATTERN_RELATIONSHIPS PRIMARY KEY (template_id, pattern_id)
  )
  RELATIONSHIPS (
    pattern_blocks (block_id) REFERENCES blocks (block_id),
    pattern_blocks (pattern_id) REFERENCES patterns (pattern_id),
    template_patterns (pattern_id) REFERENCES patterns (pattern_id),
    template_patterns (template_id) REFERENCES templates (template_id)
  )
  DIMENSIONS (
    -- Block dimensions
    blocks.block_name,
    blocks.block_category,
    blocks.complexity AS block_complexity,
    blocks.description AS block_description,
    
    -- Pattern dimensions
    patterns.pattern_name,
    patterns.use_case AS pattern_use_case,
    patterns.complexity AS pattern_complexity,
    
    -- Template dimensions
    templates.template_name,
    templates.use_case_category,
    templates.industry
  )
  METRICS (
    -- Block metrics
    total_blocks AS COUNT(DISTINCT blocks.block_id),
    avg_block_reuse AS AVG(blocks.reuse_count),
    
    -- Pattern metrics
    total_patterns AS COUNT(DISTINCT patterns.pattern_id),
    avg_blocks_per_pattern AS AVG(ARRAY_SIZE(patterns.component_blocks)),
    
    -- Template metrics
    total_templates AS COUNT(DISTINCT templates.template_id),
    avg_template_usage AS AVG(templates.times_used)
  );

COMMENT ON SEMANTIC VIEW modular_component_catalog IS 
  'Semantic view for querying modular diagram components: blocks, patterns, and templates. Supports natural language queries about architecture components.';

-- =====================================================
-- 2. Architecture Component Catalog Semantic View
-- =====================================================

-- This view enables queries like:
-- "What components are needed for Kafka ingestion?"
-- "Show me all compute components"
-- "How does a Stream connect to other components?"

CREATE OR REPLACE SEMANTIC VIEW architecture_catalog
  TABLES (
    components AS SNOWGRAM_DB.CORE.COMPONENTS PRIMARY KEY (component_id),
    component_types AS SNOWGRAM_DB.CORE.COMPONENT_TYPES PRIMARY KEY (type_id),
    connections AS SNOWGRAM_DB.CORE.COMPONENT_CONNECTIONS PRIMARY KEY (connection_id)
  )
  RELATIONSHIPS (
    components (type_category) REFERENCES component_types (category_name),
    connections (source_component_id) REFERENCES components (component_id),
    connections (target_component_id) REFERENCES components (component_id)
  )
  DIMENSIONS (
    components.component_name,
    components.component_type,
    component_types.category_name,
    connections.connection_type,
    components.description AS component_description
  )
  METRICS (
    component_count AS COUNT(DISTINCT components.component_id),
    connection_count AS COUNT(DISTINCT connections.connection_id),
    components_per_category AS COUNT(DISTINCT components.component_id) / COUNT(DISTINCT component_types.type_id)
  );

COMMENT ON SEMANTIC VIEW architecture_catalog IS 
  'Semantic view for Snowflake architecture components and their connections. Supports queries about component relationships and types.';

-- =====================================================
-- 3. Reference Architecture Templates Semantic View
-- =====================================================

-- This view enables queries like:
-- "Find templates for real-time analytics"
-- "Show me templates suitable for financial services"
-- "What are the most popular templates?"

CREATE OR REPLACE SEMANTIC VIEW reference_templates
  TABLES (
    templates AS SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES PRIMARY KEY (template_id)
  )
  DIMENSIONS (
    templates.template_name,
    templates.use_case_category,
    templates.industry,
    templates.description,
    templates.created_at
  )
  METRICS (
    template_usage AS SUM(templates.times_used),
    avg_generation_time AS AVG(templates.avg_generation_time_ms),
    pattern_count AS AVG(ARRAY_SIZE(templates.composed_patterns)),
    total_available_templates AS COUNT(DISTINCT templates.template_id)
  );

COMMENT ON SEMANTIC VIEW reference_templates IS 
  'Semantic view for reference architecture templates. Supports queries about template usage, complexity, and industry fit.';

-- =====================================================
-- 4. User Diagram Catalog Semantic View
-- =====================================================

-- This view enables queries like:
-- "Show me all my diagrams"
-- "Find diagrams that use Snowpipe"
-- "Show me diagrams created last week"

CREATE OR REPLACE SEMANTIC VIEW user_diagram_catalog
  TABLES (
    diagrams AS SNOWGRAM_DB.CORE.USER_DIAGRAMS PRIMARY KEY (diagram_id)
  )
  DIMENSIONS (
    diagrams.diagram_name,
    diagrams.user_id,
    diagrams.diagram_type,
    diagrams.project_name,
    diagrams.created_timestamp,
    diagrams.updated_timestamp,
    diagrams.is_public
  )
  METRICS (
    total_diagrams AS COUNT(DISTINCT diagrams.diagram_id),
    avg_components_per_diagram AS AVG(ARRAY_SIZE(diagrams.component_ids_used)),
    diagrams_per_user AS COUNT(DISTINCT diagrams.diagram_id) / COUNT(DISTINCT diagrams.user_id)
  );

COMMENT ON SEMANTIC VIEW user_diagram_catalog IS 
  'Semantic view for user-created diagrams. Supports queries about diagram history, components used, and project organization.';

-- =====================================================
-- 5. Agent Performance Metrics Semantic View
-- =====================================================

-- This view enables queries like:
-- "What's the average diagram generation time?"
-- "Show me agent success rate by day"
-- "Which semantic models are queried most often?"

CREATE OR REPLACE SEMANTIC VIEW agent_performance_metrics
  TABLES (
    agent_logs AS SNOWGRAM_DB.CORE.AGENT_LOGS PRIMARY KEY (log_id)
  )
  DIMENSIONS (
    DATE(agent_logs.timestamp) AS query_date,
    agent_logs.success AS query_success,
    agent_logs.session_id
  )
  METRICS (
    total_queries AS COUNT(DISTINCT agent_logs.log_id),
    successful_queries AS SUM(CASE WHEN agent_logs.success THEN 1 ELSE 0 END),
    success_rate AS SUM(CASE WHEN agent_logs.success THEN 1 ELSE 0 END) / COUNT(*),
    avg_generation_time AS AVG(agent_logs.generation_time_ms),
    p95_generation_time AS PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY agent_logs.generation_time_ms),
    unique_sessions AS COUNT(DISTINCT agent_logs.session_id)
  );

COMMENT ON SEMANTIC VIEW agent_performance_metrics IS 
  'Semantic view for monitoring Cortex Agent performance. Tracks query success rates, generation times, and usage patterns.';

-- =====================================================
-- Grant permissions
-- =====================================================

-- Grant usage on semantic views to application role
GRANT USAGE ON SEMANTIC VIEW modular_component_catalog TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON SEMANTIC VIEW architecture_catalog TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON SEMANTIC VIEW reference_templates TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON SEMANTIC VIEW user_diagram_catalog TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON SEMANTIC VIEW agent_performance_metrics TO ROLE SNOWGRAM_APP_ROLE;

-- =====================================================
-- Test queries to validate semantic views
-- =====================================================

-- Test modular_component_catalog
SELECT 'Testing modular_component_catalog...' AS test;
SELECT * FROM SEMANTIC_VIEW(
    modular_component_catalog
    DIMENSIONS blocks.block_name, blocks.block_category
    METRICS total_blocks
)
LIMIT 5;

-- Test architecture_catalog  
SELECT 'Testing architecture_catalog...' AS test;
SELECT * FROM SEMANTIC_VIEW(
    architecture_catalog
    DIMENSIONS components.component_name, component_types.category_name
    METRICS component_count
)
LIMIT 5;

-- Test reference_templates
SELECT 'Testing reference_templates...' AS test;
SELECT * FROM SEMANTIC_VIEW(
    reference_templates
    DIMENSIONS templates.template_name, templates.use_case_category
    METRICS total_available_templates
)
LIMIT 5;

-- Test user_diagram_catalog
SELECT 'Testing user_diagram_catalog...' AS test;
SELECT * FROM SEMANTIC_VIEW(
    user_diagram_catalog
    DIMENSIONS diagrams.diagram_type
    METRICS total_diagrams
);

-- Test agent_performance_metrics
SELECT 'Testing agent_performance_metrics...' AS test;
SELECT * FROM SEMANTIC_VIEW(
    agent_performance_metrics
    METRICS total_queries, success_rate
);

SELECT 'All semantic views created and tested successfully!' AS status;






