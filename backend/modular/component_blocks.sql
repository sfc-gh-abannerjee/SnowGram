-- =====================================================
-- Component Blocks: Atomic Lego Pieces
-- =====================================================
-- Purpose: INSERT statements for all atomic component blocks
-- These are reusable, pre-built diagram chunks
-- =====================================================

USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

-- =====================================================
-- INGESTION BLOCKS
-- =====================================================

-- AWS S3 Bucket Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'S3_BUCKET_BLOCK',
    'AWS S3 Bucket',
    'ingestion',
    'S3[("AWS S3<br/>Bucket")]:::awsStyle',
    'AWS S3 bucket for raw data storage',
    NULL,
    ARRAY_CONSTRUCT('external_stage', 'snowpipe'),
    ARRAY_CONSTRUCT('EXTERNAL_STAGE'),
    'simple'
);

-- External Stage Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'EXTERNAL_STAGE_BLOCK',
    'Snowflake External Stage',
    'ingestion',
    'STAGE[("External Stage<br/>@stage_name")]:::snowflakeStyle',
    'Snowflake external stage with cloud storage credentials',
    ARRAY_CONSTRUCT('s3_bucket', 'azure_blob', 'gcs_bucket'),
    ARRAY_CONSTRUCT('snowpipe', 'copy_into', 'table'),
    ARRAY_CONSTRUCT('STAGE', 'STORAGE_INTEGRATION'),
    'simple'
);

-- Snowpipe Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'SNOWPIPE_BLOCK',
    'Snowpipe Auto-Ingestion',
    'ingestion',
    'PIPE[("Snowpipe<br/>Auto-Ingest")]:::snowflakeStyle',
    'Automated continuous data ingestion',
    ARRAY_CONSTRUCT('external_stage'),
    ARRAY_CONSTRUCT('table'),
    ARRAY_CONSTRUCT('PIPE', 'NOTIFICATION_INTEGRATION'),
    'medium'
);

-- Snowpipe Streaming Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'SNOWPIPE_STREAMING_BLOCK',
    'Snowpipe Streaming',
    'ingestion',
    'PIPE_STREAMING[("Snowpipe<br/>Streaming")]:::snowflakeStyle',
    'Real-time streaming ingestion via Snowpipe Streaming API',
    ARRAY_CONSTRUCT('kafka', 'kinesis', 'pubsub'),
    ARRAY_CONSTRUCT('table'),
    ARRAY_CONSTRUCT('SNOWPIPE_STREAMING'),
    'complex'
);

-- Kafka Connector Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'KAFKA_CONNECTOR_BLOCK',
    'Kafka Topic',
    'external',
    'KAFKA[("Kafka Topic<br/>Real-Time")]:::kafkaStyle',
    'Apache Kafka topic for streaming data',
    NULL,
    ARRAY_CONSTRUCT('snowpipe_streaming', 'kafka_connector'),
    NULL,
    'simple'
);

-- Azure Blob Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'AZURE_BLOB_BLOCK',
    'Azure Blob Storage',
    'external',
    'AZURE[("Azure Blob<br/>Storage")]:::azureStyle',
    'Azure Blob Storage container',
    NULL,
    ARRAY_CONSTRUCT('external_stage', 'snowpipe'),
    ARRAY_CONSTRUCT('EXTERNAL_STAGE'),
    'simple'
);

-- GCS Bucket Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'GCS_BUCKET_BLOCK',
    'Google Cloud Storage',
    'external',
    'GCS[("GCS Bucket<br/>Storage")]:::gcpStyle',
    'Google Cloud Storage bucket',
    NULL,
    ARRAY_CONSTRUCT('external_stage', 'snowpipe'),
    ARRAY_CONSTRUCT('EXTERNAL_STAGE'),
    'simple'
);

-- =====================================================
-- STORAGE BLOCKS
-- =====================================================

-- Database Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'DATABASE_BLOCK',
    'Database',
    'storage',
    'DB[("Database<br/>DB_NAME")]:::snowflakeStyle',
    'Snowflake database container',
    NULL,
    ARRAY_CONSTRUCT('schema'),
    ARRAY_CONSTRUCT('DATABASE'),
    'simple'
);

-- Schema Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'SCHEMA_BLOCK',
    'Schema',
    'storage',
    'SCHEMA[("Schema<br/>SCHEMA_NAME")]:::snowflakeStyle',
    'Snowflake schema for organizing tables',
    ARRAY_CONSTRUCT('database'),
    ARRAY_CONSTRUCT('table', 'view', 'stream'),
    ARRAY_CONSTRUCT('SCHEMA'),
    'simple'
);

-- Table Block (Raw)
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'TABLE_RAW_BLOCK',
    'Raw Table',
    'storage',
    'TABLE_RAW[("Raw Table<br/>Staging Data")]:::snowflakeStyle',
    'Raw table for ingested data before transformation',
    ARRAY_CONSTRUCT('snowpipe', 'copy_into', 'external_stage'),
    ARRAY_CONSTRUCT('stream', 'view', 'task'),
    ARRAY_CONSTRUCT('TABLE'),
    'simple'
);

-- Table Block (Transformed)
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'TABLE_TRANSFORMED_BLOCK',
    'Transformed Table',
    'storage',
    'TABLE_TRANS[("Transformed Table<br/>Clean Data")]:::snowflakeStyle',
    'Transformed table with cleaned and structured data',
    ARRAY_CONSTRUCT('task', 'stream', 'procedure'),
    ARRAY_CONSTRUCT('view', 'table', 'external_share'),
    ARRAY_CONSTRUCT('TABLE'),
    'simple'
);

-- View Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'VIEW_BLOCK',
    'View',
    'storage',
    'VIEW[("View<br/>Business Logic")]:::snowflakeStyle',
    'Logical view with business rules',
    ARRAY_CONSTRUCT('table'),
    ARRAY_CONSTRUCT('dashboard', 'bi_tool', 'application'),
    ARRAY_CONSTRUCT('VIEW'),
    'simple'
);

-- Secure View Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'SECURE_VIEW_BLOCK',
    'Secure View',
    'storage',
    'SECURE_VIEW[("Secure View<br/>Protected Access")]:::secureStyle',
    'Secure view for sensitive data access',
    ARRAY_CONSTRUCT('table'),
    ARRAY_CONSTRUCT('dashboard', 'bi_tool', 'external_share'),
    ARRAY_CONSTRUCT('SECURE_VIEW'),
    'medium'
);

-- =====================================================
-- TRANSFORMATION BLOCKS
-- =====================================================

-- Stream Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'STREAM_BLOCK',
    'CDC Stream',
    'transformation',
    'STREAM[("Stream<br/>Change Capture")]:::snowflakeStyle',
    'Change data capture stream for tracking table changes',
    ARRAY_CONSTRUCT('table'),
    ARRAY_CONSTRUCT('task', 'procedure', 'table'),
    ARRAY_CONSTRUCT('STREAM'),
    'medium'
);

-- Task Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'TASK_BLOCK',
    'Scheduled Task',
    'transformation',
    'TASK[("Task<br/>Transform & Load")]:::snowflakeStyle',
    'Scheduled or triggered task for data transformation',
    ARRAY_CONSTRUCT('stream', 'table', 'view'),
    ARRAY_CONSTRUCT('table', 'procedure'),
    ARRAY_CONSTRUCT('TASK'),
    'medium'
);

-- Stored Procedure Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'PROCEDURE_BLOCK',
    'Stored Procedure',
    'transformation',
    'PROC[("Stored Procedure<br/>Complex Logic")]:::snowflakeStyle',
    'Stored procedure for complex transformation logic',
    ARRAY_CONSTRUCT('task', 'table'),
    ARRAY_CONSTRUCT('table', 'view'),
    ARRAY_CONSTRUCT('PROCEDURE'),
    'complex'
);

-- UDF Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'UDF_BLOCK',
    'User-Defined Function',
    'transformation',
    'UDF[("UDF<br/>Custom Function")]:::snowflakeStyle',
    'User-defined function for custom transformations',
    ARRAY_CONSTRUCT('query', 'procedure'),
    ARRAY_CONSTRUCT('query', 'view'),
    ARRAY_CONSTRUCT('FUNCTION'),
    'medium'
);

-- =====================================================
-- COMPUTE BLOCKS
-- =====================================================

-- Warehouse Block (X-Small)
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'WAREHOUSE_XS_BLOCK',
    'Warehouse (X-Small)',
    'compute',
    'WH_XS[("Warehouse<br/>X-SMALL")]:::warehouseStyle',
    'X-Small virtual warehouse for light workloads',
    NULL,
    ARRAY_CONSTRUCT('query', 'task', 'procedure'),
    ARRAY_CONSTRUCT('WAREHOUSE'),
    'simple'
);

-- Warehouse Block (Medium)
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'WAREHOUSE_M_BLOCK',
    'Warehouse (Medium)',
    'compute',
    'WH_M[("Warehouse<br/>MEDIUM")]:::warehouseStyle',
    'Medium virtual warehouse for moderate workloads',
    NULL,
    ARRAY_CONSTRUCT('query', 'task', 'procedure'),
    ARRAY_CONSTRUCT('WAREHOUSE'),
    'simple'
);

-- Warehouse Block (Large)
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'WAREHOUSE_L_BLOCK',
    'Warehouse (Large)',
    'compute',
    'WH_L[("Warehouse<br/>LARGE")]:::warehouseStyle',
    'Large virtual warehouse for heavy workloads',
    NULL,
    ARRAY_CONSTRUCT('query', 'task', 'procedure'),
    ARRAY_CONSTRUCT('WAREHOUSE'),
    'simple'
);

-- =====================================================
-- SECURITY BLOCKS
-- =====================================================

-- Role Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'ROLE_BLOCK',
    'Role',
    'security',
    'ROLE[("Role<br/>Access Control")]:::securityStyle',
    'RBAC role for access control',
    NULL,
    ARRAY_CONSTRUCT('user', 'grant'),
    ARRAY_CONSTRUCT('ROLE'),
    'simple'
);

-- User Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'USER_BLOCK',
    'User',
    'security',
    'USER[("User<br/>Identity")]:::securityStyle',
    'User account for authentication',
    ARRAY_CONSTRUCT('role'),
    ARRAY_CONSTRUCT('session', 'query'),
    ARRAY_CONSTRUCT('USER'),
    'simple'
);

-- Grant Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'GRANT_BLOCK',
    'Grant Privilege',
    'security',
    'GRANT[("GRANT<br/>Privileges")]:::securityStyle',
    'Grant privileges to role',
    ARRAY_CONSTRUCT('role'),
    ARRAY_CONSTRUCT('database', 'schema', 'table', 'view'),
    ARRAY_CONSTRUCT('GRANT'),
    'simple'
);

-- =====================================================
-- EXTERNAL INTEGRATION BLOCKS
-- =====================================================

-- External Function Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'EXTERNAL_FUNCTION_BLOCK',
    'External Function',
    'external',
    'EXT_FUNC[("External Function<br/>API Call")]:::externalStyle',
    'External function calling AWS Lambda or Azure Function',
    ARRAY_CONSTRUCT('table', 'procedure'),
    ARRAY_CONSTRUCT('table', 'api'),
    ARRAY_CONSTRUCT('EXTERNAL_FUNCTION', 'API_INTEGRATION'),
    'complex'
);

-- BI Tool Block (Tableau)
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'TABLEAU_BLOCK',
    'Tableau Dashboard',
    'external',
    'TABLEAU[("Tableau<br/>Analytics")]:::biStyle',
    'Tableau dashboard for data visualization',
    ARRAY_CONSTRUCT('view', 'table', 'secure_view'),
    NULL,
    NULL,
    'simple'
);

-- BI Tool Block (PowerBI)
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'POWERBI_BLOCK',
    'Power BI Dashboard',
    'external',
    'POWERBI[("Power BI<br/>Analytics")]:::biStyle',
    'Power BI dashboard for data visualization',
    ARRAY_CONSTRUCT('view', 'table', 'secure_view'),
    NULL,
    NULL,
    'simple'
);

-- Data Share Block
INSERT INTO COMPONENT_BLOCKS (
    block_id, block_name, block_category, mermaid_code, description,
    input_connectors, output_connectors, snowflake_components, complexity
) VALUES (
    'DATA_SHARE_BLOCK',
    'Secure Data Share',
    'external',
    'SHARE[("Secure Share<br/>Cross-Account")]:::shareStyle',
    'Secure data sharing with external accounts',
    ARRAY_CONSTRUCT('database', 'table', 'view'),
    ARRAY_CONSTRUCT('external_account'),
    ARRAY_CONSTRUCT('SHARE'),
    'medium'
);

SELECT 'Component blocks inserted: ' || COUNT(*) || ' total' AS status
FROM COMPONENT_BLOCKS;






