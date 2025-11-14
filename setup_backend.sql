-- =====================================================
-- SnowGram Backend Setup Script
-- =====================================================
-- Purpose: Create all Snowflake objects for SnowGram
-- Connection: svcUser (service account, no MFA)
-- Version: 1.0
-- Date: 2025-11-07
-- =====================================================

-- Use SYSADMIN role for object creation
USE ROLE SYSADMIN;

-- =====================================================
-- 1. DATABASE & SCHEMAS
-- =====================================================

-- Create main database
CREATE DATABASE IF NOT EXISTS SNOWGRAM_DB
    COMMENT = 'SnowGram Cortex-powered diagram generation application';

USE DATABASE SNOWGRAM_DB;

-- Create schemas
CREATE SCHEMA IF NOT EXISTS CORE
    COMMENT = 'Core tables: component blocks, patterns, templates, user diagrams';

CREATE SCHEMA IF NOT EXISTS AGENTS
    COMMENT = 'Cortex Agent configurations and metadata';

CREATE SCHEMA IF NOT EXISTS SEMANTICS
    COMMENT = 'Semantic models and views for natural language querying';

CREATE SCHEMA IF NOT EXISTS KNOWLEDGE
    COMMENT = 'Documentation, reference architectures, and Cortex Search service';

-- =====================================================
-- 2. WAREHOUSES
-- =====================================================

-- Create compute warehouse for app operations
CREATE WAREHOUSE IF NOT EXISTS SNOWGRAM_WH
    WITH WAREHOUSE_SIZE = 'X-SMALL'
    AUTO_SUSPEND = 60
    AUTO_RESUME = TRUE
    INITIALLY_SUSPENDED = TRUE
    COMMENT = 'Warehouse for SnowGram application queries';

-- =====================================================
-- 3. CORE SCHEMA TABLES (Modular Framework)
-- =====================================================

USE SCHEMA CORE;

-- Tier 1: Atomic Component Blocks (Lego pieces)
CREATE TABLE IF NOT EXISTS COMPONENT_BLOCKS (
    block_id VARCHAR PRIMARY KEY,
    block_name VARCHAR NOT NULL,
    block_category VARCHAR NOT NULL,  -- ingestion, transformation, security, output, compute
    mermaid_code TEXT NOT NULL,       -- Reusable Mermaid snippet
    description TEXT,
    input_connectors ARRAY,           -- What can connect TO this block
    output_connectors ARRAY,          -- What this block can connect TO
    snowflake_components ARRAY,       -- Which Snowflake objects involved
    complexity VARCHAR,                -- simple, medium, complex
    reuse_count INTEGER DEFAULT 0,
    created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
    -- Note: CHECK constraints removed (not supported in Snowflake)
    -- Validation handled in application layer
);

-- Tier 2: Composed Patterns from blocks
CREATE TABLE IF NOT EXISTS COMPOSED_PATTERNS (
    pattern_id VARCHAR PRIMARY KEY,
    pattern_name VARCHAR NOT NULL,
    description TEXT,
    component_blocks ARRAY NOT NULL,  -- Array of block_ids that make up this pattern
    mermaid_template TEXT NOT NULL,   -- How blocks are connected in Mermaid
    use_case VARCHAR,
    complexity VARCHAR,
    reuse_count INTEGER DEFAULT 0,
    created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
    -- Note: CHECK constraints removed (not supported in Snowflake)
);

-- Tier 3: Full Templates from patterns
CREATE TABLE IF NOT EXISTS ARCHITECTURE_TEMPLATES (
    template_id VARCHAR PRIMARY KEY,
    template_name VARCHAR NOT NULL,
    description TEXT,
    composed_patterns ARRAY NOT NULL,  -- Array of pattern_ids
    full_mermaid_code TEXT NOT NULL,
    use_case_category VARCHAR,
    industry VARCHAR,
    times_used INTEGER DEFAULT 0,
    avg_generation_time_ms INTEGER,    -- Performance tracking
    created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Junction table: Pattern → Block relationships
CREATE TABLE IF NOT EXISTS PATTERN_BLOCK_RELATIONSHIPS (
    pattern_id VARCHAR NOT NULL,
    block_id VARCHAR NOT NULL,
    block_order INTEGER NOT NULL,     -- Sequence in the pattern
    connection_rules VARIANT,          -- How this block connects to next
    PRIMARY KEY (pattern_id, block_id),
    FOREIGN KEY (pattern_id) REFERENCES COMPOSED_PATTERNS(pattern_id),
    FOREIGN KEY (block_id) REFERENCES COMPONENT_BLOCKS(block_id)
);

-- Junction table: Template → Pattern relationships
CREATE TABLE IF NOT EXISTS TEMPLATE_PATTERN_RELATIONSHIPS (
    template_id VARCHAR NOT NULL,
    pattern_id VARCHAR NOT NULL,
    pattern_order INTEGER NOT NULL,
    PRIMARY KEY (template_id, pattern_id),
    FOREIGN KEY (template_id) REFERENCES ARCHITECTURE_TEMPLATES(template_id),
    FOREIGN KEY (pattern_id) REFERENCES COMPOSED_PATTERNS(pattern_id)
);

-- Component metadata table
CREATE TABLE IF NOT EXISTS COMPONENTS (
    component_id VARCHAR PRIMARY KEY,
    component_name VARCHAR NOT NULL,
    component_type VARCHAR NOT NULL,   -- Warehouse, Database, Schema, Table, etc.
    type_category VARCHAR NOT NULL,    -- Compute, Storage, Data Movement, Security, etc.
    icon_url VARCHAR,                  -- Link to icon in stage
    description TEXT,
    snowflake_object_type VARCHAR,     -- Actual Snowflake DDL object type
    created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Component types taxonomy
CREATE TABLE IF NOT EXISTS COMPONENT_TYPES (
    type_id VARCHAR PRIMARY KEY,
    category_name VARCHAR NOT NULL,
    parent_category VARCHAR,
    description TEXT
);

-- Component connections (how components relate)
CREATE TABLE IF NOT EXISTS COMPONENT_CONNECTIONS (
    connection_id VARCHAR PRIMARY KEY,
    source_component_id VARCHAR NOT NULL,
    target_component_id VARCHAR NOT NULL,
    connection_type VARCHAR NOT NULL,  -- feeds_data, authenticates, processes, stores_in
    description TEXT,
    FOREIGN KEY (source_component_id) REFERENCES COMPONENTS(component_id),
    FOREIGN KEY (target_component_id) REFERENCES COMPONENTS(component_id)
);

-- Architecture patterns catalog
CREATE TABLE IF NOT EXISTS ARCHITECTURE_PATTERNS (
    pattern_id VARCHAR PRIMARY KEY,
    pattern_name VARCHAR NOT NULL,
    use_case VARCHAR,
    component_ids ARRAY,
    connection_rules VARIANT,
    description TEXT,
    created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
);

-- User diagrams table
CREATE TABLE IF NOT EXISTS USER_DIAGRAMS (
    diagram_id VARCHAR PRIMARY KEY,
    diagram_name VARCHAR NOT NULL,
    user_id VARCHAR,
    mermaid_code TEXT NOT NULL,
    excalidraw_json VARIANT,           -- Full Excalidraw state
    diagram_type VARCHAR,               -- current_state, future_state
    tags ARRAY,
    component_ids_used ARRAY,          -- Track which blocks were used
    created_timestamp TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_timestamp TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    project_name VARCHAR,
    is_public BOOLEAN DEFAULT FALSE
);

-- User sessions table
CREATE TABLE IF NOT EXISTS SESSIONS (
    session_id VARCHAR PRIMARY KEY,
    user_id VARCHAR,
    started_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    last_activity_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    agent_conversation VARIANT,        -- Full conversation history
    diagrams_created ARRAY,
    session_metadata VARIANT
);

-- Agent interaction logs
CREATE TABLE IF NOT EXISTS AGENT_LOGS (
    log_id VARCHAR PRIMARY KEY,
    session_id VARCHAR,
    timestamp TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    user_query TEXT,
    agent_response TEXT,
    tools_used ARRAY,
    semantic_models_queried ARRAY,
    blocks_retrieved ARRAY,
    generation_time_ms INTEGER,
    success BOOLEAN,
    error_message TEXT,
    FOREIGN KEY (session_id) REFERENCES SESSIONS(session_id)
);

-- =====================================================
-- 4. KNOWLEDGE SCHEMA TABLES
-- =====================================================

USE SCHEMA KNOWLEDGE;

-- Snowflake documentation table (for Cortex Search)
CREATE TABLE IF NOT EXISTS SNOWFLAKE_DOCUMENTATION (
    doc_id VARCHAR PRIMARY KEY,
    chunk TEXT NOT NULL,               -- Text chunk for search
    document_title VARCHAR NOT NULL,
    source_url VARCHAR,
    category VARCHAR NOT NULL,         -- official_docs, reference_arch, quickstart, best_practice
    doc_type VARCHAR,
    page_number INTEGER,
    section_heading VARCHAR,
    created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Reference architecture documents
CREATE TABLE IF NOT EXISTS REFERENCE_ARCHITECTURES_DOCS (
    arch_id VARCHAR PRIMARY KEY,
    title VARCHAR NOT NULL,
    description TEXT,
    full_text TEXT,
    pdf_url VARCHAR,
    industry VARCHAR,
    use_case VARCHAR,
    tags ARRAY,
    created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
);

-- =====================================================
-- 5. STAGES (for file storage)
-- =====================================================

USE SCHEMA CORE;

-- Stage for semantic model YAML files
CREATE STAGE IF NOT EXISTS SEMANTIC_MODELS_STAGE
    DIRECTORY = (ENABLE = TRUE)
    COMMENT = 'Storage for semantic model YAML files';

-- Stage for user-uploaded icons
CREATE STAGE IF NOT EXISTS ICONS_STAGE
    DIRECTORY = (ENABLE = TRUE)
    COMMENT = 'Storage for Snowflake architecture icons (SVG/PNG)';

-- Stage for diagram exports
CREATE STAGE IF NOT EXISTS DIAGRAM_EXPORTS_STAGE
    DIRECTORY = (ENABLE = TRUE)
    COMMENT = 'Storage for exported diagram files (PNG/SVG/PDF)';

-- =====================================================
-- 6. FILE FORMATS
-- =====================================================

-- JSON file format for data loading
CREATE FILE FORMAT IF NOT EXISTS JSON_FORMAT
    TYPE = 'JSON'
    COMPRESSION = 'AUTO';

-- CSV file format
CREATE FILE FORMAT IF NOT EXISTS CSV_FORMAT
    TYPE = 'CSV'
    FIELD_DELIMITER = ','
    SKIP_HEADER = 1
    NULL_IF = ('NULL', 'null', '')
    EMPTY_FIELD_AS_NULL = TRUE;

-- =====================================================
-- 7. SPCS INFRASTRUCTURE (Compute Pool & Image Repository)
-- =====================================================

-- Note: Must be run with ACCOUNTADMIN role
-- Switch to ACCOUNTADMIN for SPCS setup
USE ROLE ACCOUNTADMIN;

-- Create compute pool for SPCS
CREATE COMPUTE POOL IF NOT EXISTS SNOWGRAM_COMPUTE_POOL
    MIN_NODES = 1
    MAX_NODES = 3
    INSTANCE_FAMILY = CPU_X64_M
    AUTO_RESUME = TRUE
    AUTO_SUSPEND_SECS = 300
    COMMENT = 'Compute pool for SnowGram SPCS service';

-- Create image repository
CREATE IMAGE REPOSITORY IF NOT EXISTS SNOWGRAM_DB.CORE.SNOWGRAM_IMAGE_REPO
    COMMENT = 'Docker image repository for SnowGram containers';

-- =====================================================
-- 8. ROLES & GRANTS
-- =====================================================

-- Create application role
CREATE ROLE IF NOT EXISTS SNOWGRAM_APP_ROLE
    COMMENT = 'Role for SnowGram application with minimal required privileges';

-- Grant usage on database and schemas
GRANT USAGE ON DATABASE SNOWGRAM_DB TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON SCHEMA SNOWGRAM_DB.CORE TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON SCHEMA SNOWGRAM_DB.AGENTS TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON SCHEMA SNOWGRAM_DB.SEMANTICS TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON SCHEMA SNOWGRAM_DB.KNOWLEDGE TO ROLE SNOWGRAM_APP_ROLE;

-- Grant table privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA SNOWGRAM_DB.CORE TO ROLE SNOWGRAM_APP_ROLE;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA SNOWGRAM_DB.KNOWLEDGE TO ROLE SNOWGRAM_APP_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA SNOWGRAM_DB.SEMANTICS TO ROLE SNOWGRAM_APP_ROLE;

-- Grant future table privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON FUTURE TABLES IN SCHEMA SNOWGRAM_DB.CORE TO ROLE SNOWGRAM_APP_ROLE;
GRANT SELECT, INSERT, UPDATE, DELETE ON FUTURE TABLES IN SCHEMA SNOWGRAM_DB.KNOWLEDGE TO ROLE SNOWGRAM_APP_ROLE;

-- Grant stage privileges
GRANT READ, WRITE ON STAGE SNOWGRAM_DB.CORE.SEMANTIC_MODELS_STAGE TO ROLE SNOWGRAM_APP_ROLE;
GRANT READ, WRITE ON STAGE SNOWGRAM_DB.CORE.ICONS_STAGE TO ROLE SNOWGRAM_APP_ROLE;
GRANT READ, WRITE ON STAGE SNOWGRAM_DB.CORE.DIAGRAM_EXPORTS_STAGE TO ROLE SNOWGRAM_APP_ROLE;

-- Grant warehouse privileges
GRANT USAGE, OPERATE ON WAREHOUSE SNOWGRAM_WH TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE SNOWGRAM_APP_ROLE;  -- For Cortex operations

-- Grant compute pool privileges
GRANT USAGE, MONITOR ON COMPUTE POOL SNOWGRAM_COMPUTE_POOL TO ROLE SNOWGRAM_APP_ROLE;

-- Grant image repository privileges
GRANT READ ON IMAGE REPOSITORY SNOWGRAM_DB.CORE.SNOWGRAM_IMAGE_REPO TO ROLE SNOWGRAM_APP_ROLE;

-- Grant Cortex privileges
GRANT CREATE CORTEX SEARCH SERVICE ON SCHEMA SNOWGRAM_DB.KNOWLEDGE TO ROLE SNOWGRAM_APP_ROLE;

-- Grant role to SVC_CURSOR service user
GRANT ROLE SNOWGRAM_APP_ROLE TO ROLE SVC_CURSOR_ROLE;

-- Switch back to SYSADMIN
USE ROLE SYSADMIN;

-- =====================================================
-- 9. VIEWS FOR MONITORING
-- =====================================================

USE SCHEMA CORE;

-- View for component block usage statistics
CREATE OR REPLACE VIEW COMPONENT_BLOCK_STATS AS
SELECT 
    cb.block_id,
    cb.block_name,
    cb.block_category,
    cb.complexity,
    cb.reuse_count,
    COUNT(DISTINCT pb.pattern_id) AS used_in_patterns,
    COUNT(DISTINCT ud.diagram_id) AS used_in_diagrams
FROM COMPONENT_BLOCKS cb
LEFT JOIN PATTERN_BLOCK_RELATIONSHIPS pb ON cb.block_id = pb.block_id
LEFT JOIN USER_DIAGRAMS ud ON ARRAY_CONTAINS(cb.block_id::VARIANT, ud.component_ids_used)
GROUP BY cb.block_id, cb.block_name, cb.block_category, cb.complexity, cb.reuse_count
ORDER BY cb.reuse_count DESC;

-- View for popular templates
CREATE OR REPLACE VIEW POPULAR_TEMPLATES AS
SELECT 
    template_id,
    template_name,
    use_case_category,
    industry,
    times_used,
    avg_generation_time_ms,
    ARRAY_SIZE(composed_patterns) AS pattern_count,
    created_at
FROM ARCHITECTURE_TEMPLATES
ORDER BY times_used DESC
LIMIT 20;

-- View for agent performance metrics
CREATE OR REPLACE VIEW AGENT_PERFORMANCE_METRICS AS
SELECT 
    DATE(timestamp) AS query_date,
    COUNT(*) AS total_queries,
    SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successful_queries,
    AVG(generation_time_ms) AS avg_generation_time_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY generation_time_ms) AS p95_generation_time_ms,
    COUNT(DISTINCT session_id) AS unique_sessions
FROM AGENT_LOGS
GROUP BY DATE(timestamp)
ORDER BY query_date DESC;

-- =====================================================
-- 10. INITIAL DATA LOAD (Seed Data)
-- =====================================================

-- Seed component types
INSERT INTO COMPONENT_TYPES (type_id, category_name, description) VALUES
    ('compute', 'Compute', 'Compute resources like warehouses'),
    ('storage', 'Storage', 'Data storage objects like databases, schemas, tables'),
    ('ingestion', 'Data Movement', 'Data ingestion and pipeline components'),
    ('transformation', 'Transformation', 'Data transformation components'),
    ('security', 'Security', 'Security and access control components'),
    ('external', 'External Integration', 'External systems and integrations');

-- Seed basic Snowflake components
INSERT INTO COMPONENTS (component_id, component_name, component_type, type_category, snowflake_object_type, description) VALUES
    ('sf_warehouse', 'Warehouse', 'WAREHOUSE', 'compute', 'WAREHOUSE', 'Virtual compute cluster'),
    ('sf_database', 'Database', 'DATABASE', 'storage', 'DATABASE', 'Logical grouping of schemas'),
    ('sf_schema', 'Schema', 'SCHEMA', 'storage', 'SCHEMA', 'Logical grouping of tables'),
    ('sf_table', 'Table', 'TABLE', 'storage', 'TABLE', 'Data table'),
    ('sf_view', 'View', 'VIEW', 'storage', 'VIEW', 'Logical view over tables'),
    ('sf_stream', 'Stream', 'STREAM', 'transformation', 'STREAM', 'Change data capture stream'),
    ('sf_task', 'Task', 'TASK', 'transformation', 'TASK', 'Scheduled or triggered execution'),
    ('sf_pipe', 'Snowpipe', 'PIPE', 'ingestion', 'PIPE', 'Automated data ingestion'),
    ('sf_stage', 'Stage', 'STAGE', 'ingestion', 'STAGE', 'Data staging location'),
    ('sf_role', 'Role', 'ROLE', 'security', 'ROLE', 'Access control role'),
    ('sf_user', 'User', 'USER', 'security', 'USER', 'User account'),
    ('ext_s3', 'AWS S3', 'S3_BUCKET', 'external', NULL, 'AWS S3 bucket'),
    ('ext_kafka', 'Kafka', 'KAFKA_TOPIC', 'external', NULL, 'Apache Kafka topic'),
    ('ext_azure_blob', 'Azure Blob', 'AZURE_BLOB', 'external', NULL, 'Azure Blob Storage');

-- =====================================================
-- 11. STORED PROCEDURES (Utility Functions)
-- =====================================================

-- Procedure to increment block reuse count
CREATE OR REPLACE PROCEDURE INCREMENT_BLOCK_REUSE(block_id_param VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
BEGIN
    UPDATE COMPONENT_BLOCKS 
    SET reuse_count = reuse_count + 1,
        updated_at = CURRENT_TIMESTAMP()
    WHERE block_id = :block_id_param;
    RETURN 'Block reuse count incremented for: ' || block_id_param;
END;
$$;

-- Procedure to log agent interaction
CREATE OR REPLACE PROCEDURE LOG_AGENT_INTERACTION(
    session_id_param VARCHAR,
    user_query_param TEXT,
    agent_response_param TEXT,
    tools_used_param ARRAY,
    generation_time_ms_param INTEGER,
    success_param BOOLEAN,
    error_message_param TEXT
)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
BEGIN
    INSERT INTO AGENT_LOGS (
        log_id,
        session_id,
        user_query,
        agent_response,
        tools_used,
        generation_time_ms,
        success,
        error_message
    ) VALUES (
        UUID_STRING(),
        :session_id_param,
        :user_query_param,
        :agent_response_param,
        :tools_used_param,
        :generation_time_ms_param,
        :success_param,
        :error_message_param
    );
    RETURN 'Agent interaction logged';
END;
$$;

-- =====================================================
-- SETUP COMPLETE
-- =====================================================

SELECT 'SnowGram backend setup complete!' AS status;
SELECT 'Database: SNOWGRAM_DB created with schemas: CORE, AGENTS, SEMANTICS, KNOWLEDGE' AS info;
SELECT 'Compute pool: SNOWGRAM_COMPUTE_POOL created' AS spcs_info;
SELECT 'Image repository: SNOWGRAM_IMAGE_REPO created' AS spcs_info2;
SELECT 'Role: SNOWGRAM_APP_ROLE created with necessary privileges' AS security_info;

