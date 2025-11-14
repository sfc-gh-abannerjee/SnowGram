-- =====================================================
-- Composed Patterns: Mid-Level Assemblies
-- =====================================================
-- Purpose: INSERT statements for composed patterns built from component blocks
-- These combine multiple blocks into reusable workflow segments
-- =====================================================

USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

-- =====================================================
-- INGESTION PATTERNS
-- =====================================================

-- S3 to Snowflake Batch Ingestion Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'S3_TO_SNOWFLAKE_BATCH',
    'S3 to Snowflake Batch Ingestion',
    'Complete batch ingestion pipeline from AWS S3 to Snowflake table via external stage and Snowpipe',
    ARRAY_CONSTRUCT('S3_BUCKET_BLOCK', 'EXTERNAL_STAGE_BLOCK', 'SNOWPIPE_BLOCK', 'TABLE_RAW_BLOCK'),
    'flowchart LR
    S3[("AWS S3<br/>Bucket")]:::awsStyle
    STAGE[("External Stage<br/>@stage_name")]:::snowflakeStyle
    PIPE[("Snowpipe<br/>Auto-Ingest")]:::snowflakeStyle
    TABLE_RAW[("Raw Table<br/>Staging Data")]:::snowflakeStyle
    
    S3 -->|Object Created| STAGE
    STAGE -->|Trigger| PIPE
    PIPE -->|Load Data| TABLE_RAW',
    'batch_ingestion',
    'medium'
);

-- Azure Blob to Snowflake Batch Ingestion Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'AZURE_TO_SNOWFLAKE_BATCH',
    'Azure Blob to Snowflake Batch Ingestion',
    'Batch ingestion from Azure Blob Storage to Snowflake',
    ARRAY_CONSTRUCT('AZURE_BLOB_BLOCK', 'EXTERNAL_STAGE_BLOCK', 'SNOWPIPE_BLOCK', 'TABLE_RAW_BLOCK'),
    'flowchart LR
    AZURE[("Azure Blob<br/>Storage")]:::azureStyle
    STAGE[("External Stage<br/>@stage_name")]:::snowflakeStyle
    PIPE[("Snowpipe<br/>Auto-Ingest")]:::snowflakeStyle
    TABLE_RAW[("Raw Table<br/>Staging Data")]:::snowflakeStyle
    
    AZURE -->|Blob Created| STAGE
    STAGE -->|Trigger| PIPE
    PIPE -->|Load Data| TABLE_RAW',
    'batch_ingestion',
    'medium'
);

-- Kafka Streaming Ingestion Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'KAFKA_STREAMING_INGESTION',
    'Kafka to Snowflake Streaming',
    'Real-time streaming ingestion from Kafka to Snowflake via Snowpipe Streaming',
    ARRAY_CONSTRUCT('KAFKA_CONNECTOR_BLOCK', 'SNOWPIPE_STREAMING_BLOCK', 'TABLE_RAW_BLOCK'),
    'flowchart LR
    KAFKA[("Kafka Topic<br/>Real-Time")]:::kafkaStyle
    PIPE_STREAMING[("Snowpipe<br/>Streaming")]:::snowflakeStyle
    TABLE_RAW[("Raw Table<br/>Streaming Data")]:::snowflakeStyle
    
    KAFKA -->|Stream| PIPE_STREAMING
    PIPE_STREAMING -->|Continuous Load| TABLE_RAW',
    'realtime_ingestion',
    'complex'
);

-- GCS to Snowflake Batch Ingestion Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'GCS_TO_SNOWFLAKE_BATCH',
    'GCS to Snowflake Batch Ingestion',
    'Batch ingestion from Google Cloud Storage to Snowflake',
    ARRAY_CONSTRUCT('GCS_BUCKET_BLOCK', 'EXTERNAL_STAGE_BLOCK', 'SNOWPIPE_BLOCK', 'TABLE_RAW_BLOCK'),
    'flowchart LR
    GCS[("GCS Bucket<br/>Storage")]:::gcpStyle
    STAGE[("External Stage<br/>@stage_name")]:::snowflakeStyle
    PIPE[("Snowpipe<br/>Auto-Ingest")]:::snowflakeStyle
    TABLE_RAW[("Raw Table<br/>Staging Data")]:::snowflakeStyle
    
    GCS -->|Object Created| STAGE
    STAGE -->|Trigger| PIPE
    PIPE -->|Load Data| TABLE_RAW',
    'batch_ingestion',
    'medium'
);

-- =====================================================
-- TRANSFORMATION PATTERNS
-- =====================================================

-- Stream-Task Transformation Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'STREAM_TASK_TRANSFORMATION',
    'Stream-Task Transformation Pipeline',
    'CDC-based transformation using Stream and Task for incremental processing',
    ARRAY_CONSTRUCT('TABLE_RAW_BLOCK', 'STREAM_BLOCK', 'TASK_BLOCK', 'WAREHOUSE_M_BLOCK', 'TABLE_TRANSFORMED_BLOCK'),
    'flowchart LR
    TABLE_RAW[("Raw Table<br/>Source Data")]:::snowflakeStyle
    STREAM[("Stream<br/>Change Capture")]:::snowflakeStyle
    TASK[("Task<br/>Transform & Load")]:::snowflakeStyle
    WH_M[("Warehouse<br/>MEDIUM")]:::warehouseStyle
    TABLE_TRANS[("Transformed Table<br/>Clean Data")]:::snowflakeStyle
    
    TABLE_RAW -->|CDC| STREAM
    STREAM -->|Trigger| TASK
    WH_M -.->|Compute| TASK
    TASK -->|Insert/Update| TABLE_TRANS',
    'transformation',
    'medium'
);

-- Stored Procedure Transformation Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'PROCEDURE_TRANSFORMATION',
    'Stored Procedure Complex Transformation',
    'Complex transformation logic using stored procedures',
    ARRAY_CONSTRUCT('TABLE_RAW_BLOCK', 'TASK_BLOCK', 'PROCEDURE_BLOCK', 'WAREHOUSE_L_BLOCK', 'TABLE_TRANSFORMED_BLOCK'),
    'flowchart LR
    TABLE_RAW[("Raw Table<br/>Source Data")]:::snowflakeStyle
    TASK[("Task<br/>Scheduled")]:::snowflakeStyle
    PROC[("Stored Procedure<br/>Complex Logic")]:::snowflakeStyle
    WH_L[("Warehouse<br/>LARGE")]:::warehouseStyle
    TABLE_TRANS[("Transformed Table<br/>Clean Data")]:::snowflakeStyle
    
    TABLE_RAW -->|Input| TASK
    TASK -->|Execute| PROC
    WH_L -.->|Compute| PROC
    PROC -->|Output| TABLE_TRANS',
    'transformation',
    'complex'
);

-- UDF-Based Transformation Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'UDF_TRANSFORMATION',
    'UDF-Based Data Enrichment',
    'Data enrichment using user-defined functions',
    ARRAY_CONSTRUCT('TABLE_RAW_BLOCK', 'UDF_BLOCK', 'VIEW_BLOCK'),
    'flowchart LR
    TABLE_RAW[("Raw Table<br/>Source Data")]:::snowflakeStyle
    UDF[("UDF<br/>Custom Function")]:::snowflakeStyle
    VIEW[("View<br/>Enriched Data")]:::snowflakeStyle
    
    TABLE_RAW -->|Apply| UDF
    UDF -->|Transform| VIEW',
    'transformation',
    'medium'
);

-- =====================================================
-- SECURITY PATTERNS
-- =====================================================

-- RBAC Security Layer Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'RBAC_SECURITY_LAYER',
    'RBAC Security Layer',
    'Role-based access control with users, roles, and grants',
    ARRAY_CONSTRUCT('USER_BLOCK', 'ROLE_BLOCK', 'GRANT_BLOCK', 'SECURE_VIEW_BLOCK'),
    'flowchart TD
    USER[("User<br/>Identity")]:::securityStyle
    ROLE[("Role<br/>Access Control")]:::securityStyle
    GRANT[("GRANT<br/>Privileges")]:::securityStyle
    SECURE_VIEW[("Secure View<br/>Protected Access")]:::secureStyle
    
    USER -->|Assigned| ROLE
    ROLE -->|Has| GRANT
    GRANT -->|Access| SECURE_VIEW',
    'security',
    'medium'
);

-- Row-Level Security Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'ROW_LEVEL_SECURITY',
    'Row-Level Security with Secure Views',
    'Implement row-level security using secure views and RLS policies',
    ARRAY_CONSTRUCT('TABLE_TRANSFORMED_BLOCK', 'SECURE_VIEW_BLOCK', 'ROLE_BLOCK', 'GRANT_BLOCK'),
    'flowchart LR
    TABLE_TRANS[("Table<br/>Sensitive Data")]:::snowflakeStyle
    SECURE_VIEW[("Secure View<br/>Row Filtering")]:::secureStyle
    ROLE[("Role<br/>Department")]:::securityStyle
    GRANT[("GRANT<br/>Filtered Access")]:::securityStyle
    
    TABLE_TRANS -->|Filter| SECURE_VIEW
    SECURE_VIEW -->|Control| ROLE
    ROLE -->|Has| GRANT',
    'security',
    'complex'
);

-- =====================================================
-- INTEGRATION PATTERNS
-- =====================================================

-- External Function Enrichment Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'EXTERNAL_FUNCTION_ENRICHMENT',
    'External Function Data Enrichment',
    'Enrich data by calling external APIs via AWS Lambda or Azure Functions',
    ARRAY_CONSTRUCT('TABLE_RAW_BLOCK', 'EXTERNAL_FUNCTION_BLOCK', 'TABLE_TRANSFORMED_BLOCK'),
    'flowchart LR
    TABLE_RAW[("Raw Table<br/>Source Data")]:::snowflakeStyle
    EXT_FUNC[("External Function<br/>API Call")]:::externalStyle
    TABLE_TRANS[("Enriched Table<br/>Enhanced Data")]:::snowflakeStyle
    
    TABLE_RAW -->|Call| EXT_FUNC
    EXT_FUNC -->|Return| TABLE_TRANS',
    'integration',
    'complex'
);

-- Data Share Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'SECURE_DATA_SHARING',
    'Secure Data Sharing',
    'Share data securely with external Snowflake accounts',
    ARRAY_CONSTRUCT('DATABASE_BLOCK', 'SECURE_VIEW_BLOCK', 'DATA_SHARE_BLOCK'),
    'flowchart LR
    DB[("Database<br/>Shared Data")]:::snowflakeStyle
    SECURE_VIEW[("Secure View<br/>Curated Data")]:::secureStyle
    SHARE[("Secure Share<br/>Cross-Account")]:::shareStyle
    
    DB -->|Contains| SECURE_VIEW
    SECURE_VIEW -->|Published| SHARE
    SHARE -.->|Consumer Access| EXTERNAL[("External Account")]',
    'sharing',
    'medium'
);

-- BI Tool Integration Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'BI_TOOL_INTEGRATION',
    'BI Tool Analytics Integration',
    'Connect Snowflake to BI tools for analytics and visualization',
    ARRAY_CONSTRUCT('VIEW_BLOCK', 'TABLEAU_BLOCK'),
    'flowchart LR
    VIEW[("View<br/>Analytics Data")]:::snowflakeStyle
    TABLEAU[("Tableau<br/>Dashboard")]:::biStyle
    
    VIEW -->|Query| TABLEAU',
    'analytics',
    'simple'
);

-- =====================================================
-- HYBRID PATTERNS
-- =====================================================

-- End-to-End ELT Pattern
INSERT INTO COMPOSED_PATTERNS (
    pattern_id, pattern_name, description, component_blocks, mermaid_template, use_case, complexity
) VALUES (
    'END_TO_END_ELT',
    'End-to-End ELT Pipeline',
    'Complete ELT pipeline: Extract → Load → Transform',
    ARRAY_CONSTRUCT('S3_BUCKET_BLOCK', 'EXTERNAL_STAGE_BLOCK', 'SNOWPIPE_BLOCK', 'TABLE_RAW_BLOCK', 'STREAM_BLOCK', 'TASK_BLOCK', 'TABLE_TRANSFORMED_BLOCK', 'VIEW_BLOCK'),
    'flowchart LR
    S3[("AWS S3<br/>Source")]:::awsStyle
    STAGE[("External Stage")]:::snowflakeStyle
    PIPE[("Snowpipe")]:::snowflakeStyle
    TABLE_RAW[("Raw Table")]:::snowflakeStyle
    STREAM[("Stream")]:::snowflakeStyle
    TASK[("Task")]:::snowflakeStyle
    TABLE_TRANS[("Transformed")]:::snowflakeStyle
    VIEW[("View")]:::snowflakeStyle
    
    S3 --> STAGE --> PIPE --> TABLE_RAW
    TABLE_RAW --> STREAM --> TASK --> TABLE_TRANS --> VIEW',
    'full_pipeline',
    'complex'
);

SELECT 'Composed patterns inserted: ' || COUNT(*) || ' total' AS status
FROM COMPOSED_PATTERNS;

-- =====================================================
-- PATTERN-BLOCK RELATIONSHIPS
-- =====================================================

-- S3_TO_SNOWFLAKE_BATCH relationships
INSERT INTO PATTERN_BLOCK_RELATIONSHIPS (pattern_id, block_id, block_order, connection_rules) VALUES
    ('S3_TO_SNOWFLAKE_BATCH', 'S3_BUCKET_BLOCK', 1, PARSE_JSON('{"connector_type": "trigger", "condition": "object_created"}')),
    ('S3_TO_SNOWFLAKE_BATCH', 'EXTERNAL_STAGE_BLOCK', 2, PARSE_JSON('{"connector_type": "reference", "condition": "stage_defined"}')),
    ('S3_TO_SNOWFLAKE_BATCH', 'SNOWPIPE_BLOCK', 3, PARSE_JSON('{"connector_type": "auto", "condition": "notification"}')),
    ('S3_TO_SNOWFLAKE_BATCH', 'TABLE_RAW_BLOCK', 4, PARSE_JSON('{"connector_type": "load", "condition": "copy_into"}'));

-- STREAM_TASK_TRANSFORMATION relationships
INSERT INTO PATTERN_BLOCK_RELATIONSHIPS (pattern_id, block_id, block_order, connection_rules) VALUES
    ('STREAM_TASK_TRANSFORMATION', 'TABLE_RAW_BLOCK', 1, PARSE_JSON('{"connector_type": "source", "condition": null}')),
    ('STREAM_TASK_TRANSFORMATION', 'STREAM_BLOCK', 2, PARSE_JSON('{"connector_type": "cdc", "condition": "changes_detected"}')),
    ('STREAM_TASK_TRANSFORMATION', 'TASK_BLOCK', 3, PARSE_JSON('{"connector_type": "trigger", "condition": "stream_has_data"}')),
    ('STREAM_TASK_TRANSFORMATION', 'WAREHOUSE_M_BLOCK', 3, PARSE_JSON('{"connector_type": "compute", "condition": "task_execution"}')),
    ('STREAM_TASK_TRANSFORMATION', 'TABLE_TRANSFORMED_BLOCK', 4, PARSE_JSON('{"connector_type": "target", "condition": "merge_upsert"}'));

-- KAFKA_STREAMING_INGESTION relationships
INSERT INTO PATTERN_BLOCK_RELATIONSHIPS (pattern_id, block_id, block_order, connection_rules) VALUES
    ('KAFKA_STREAMING_INGESTION', 'KAFKA_CONNECTOR_BLOCK', 1, PARSE_JSON('{"connector_type": "source", "condition": "topic_subscribed"}')),
    ('KAFKA_STREAMING_INGESTION', 'SNOWPIPE_STREAMING_BLOCK', 2, PARSE_JSON('{"connector_type": "stream", "condition": "continuous"}')),
    ('KAFKA_STREAMING_INGESTION', 'TABLE_RAW_BLOCK', 3, PARSE_JSON('{"connector_type": "append", "condition": "realtime_insert"}'));

-- RBAC_SECURITY_LAYER relationships
INSERT INTO PATTERN_BLOCK_RELATIONSHIPS (pattern_id, block_id, block_order, connection_rules) VALUES
    ('RBAC_SECURITY_LAYER', 'USER_BLOCK', 1, PARSE_JSON('{"connector_type": "identity", "condition": null}')),
    ('RBAC_SECURITY_LAYER', 'ROLE_BLOCK', 2, PARSE_JSON('{"connector_type": "assignment", "condition": "grant_role"}')),
    ('RBAC_SECURITY_LAYER', 'GRANT_BLOCK', 3, PARSE_JSON('{"connector_type": "privilege", "condition": "grant_privilege"}')),
    ('RBAC_SECURITY_LAYER', 'SECURE_VIEW_BLOCK', 4, PARSE_JSON('{"connector_type": "access", "condition": "select_privilege"}'));

SELECT 'Pattern-block relationships inserted: ' || COUNT(*) || ' total' AS status
FROM PATTERN_BLOCK_RELATIONSHIPS;







