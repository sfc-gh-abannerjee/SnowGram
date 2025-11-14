-- =====================================================
-- Full Templates: Complete Reference Architectures
-- =====================================================
-- Purpose: INSERT statements for full architecture templates
-- These combine multiple patterns into production-ready diagrams
-- =====================================================

USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

-- =====================================================
-- REAL-TIME STREAMING ARCHITECTURES
-- =====================================================

-- Real-Time IoT Pipeline
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'REALTIME_IOT_PIPELINE',
    'Real-Time IoT Data Pipeline',
    'Complete real-time pipeline for IoT sensor data from Kafka through transformation to analytics',
    ARRAY_CONSTRUCT('KAFKA_STREAMING_INGESTION', 'STREAM_TASK_TRANSFORMATION', 'BI_TOOL_INTEGRATION'),
    'realtime_analytics',
    'IoT, Manufacturing, Smart Cities',
    'flowchart LR
    %% Ingestion Layer
    KAFKA[("Kafka Topics<br/>IoT Sensors")]:::kafkaStyle
    PIPE_STREAM[("Snowpipe Streaming<br/>Real-Time Ingest")]:::snowflakeStyle
    TABLE_RAW[("Raw Table<br/>IOT_RAW_DATA")]:::snowflakeStyle
    
    %% Transformation Layer
    STREAM[("Stream<br/>Change Capture")]:::snowflakeStyle
    TASK[("Task<br/>Data Cleansing")]:::snowflakeStyle
    WH[("Warehouse<br/>MEDIUM")]:::warehouseStyle
    TABLE_TRANS[("Transformed Table<br/>IOT_CLEAN_DATA")]:::snowflakeStyle
    
    %% Analytics Layer
    VIEW[("View<br/>IoT Analytics")]:::snowflakeStyle
    TABLEAU[("Tableau<br/>Real-Time Dashboard")]:::biStyle
    
    %% Connections
    KAFKA -->|Stream| PIPE_STREAM
    PIPE_STREAM -->|Continuous Load| TABLE_RAW
    TABLE_RAW -->|CDC| STREAM
    STREAM -->|Trigger| TASK
    WH -.->|Compute| TASK
    TASK -->|Transform| TABLE_TRANS
    TABLE_TRANS -->|Aggregate| VIEW
    VIEW -->|Visualize| TABLEAU
    
    %% Styling
    classDef kafkaStyle fill:#231F20,stroke:#fff,stroke-width:2px,color:#fff
    classDef snowflakeStyle fill:#29B5E8,stroke:#fff,stroke-width:2px,color:#fff
    classDef warehouseStyle fill:#0066CC,stroke:#fff,stroke-width:2px,color:#fff
    classDef biStyle fill:#E97627,stroke:#fff,stroke-width:2px,color:#fff'
);

-- Real-Time Financial Transactions
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'REALTIME_FINANCIAL_TRANSACTIONS',
    'Real-Time Financial Transaction Processing',
    'High-volume transaction processing with fraud detection and real-time analytics',
    ARRAY_CONSTRUCT('KAFKA_STREAMING_INGESTION', 'STREAM_TASK_TRANSFORMATION', 'EXTERNAL_FUNCTION_ENRICHMENT', 'ROW_LEVEL_SECURITY'),
    'realtime_analytics',
    'Financial Services, Banking, Fintech',
    'flowchart TD
    %% Data Sources
    KAFKA[("Kafka<br/>Transaction Stream")]:::kafkaStyle
    
    %% Ingestion
    PIPE_STREAM[("Snowpipe Streaming<br/>Real-Time")]:::snowflakeStyle
    TABLE_RAW[("Raw Transactions<br/>TRANS_RAW")]:::snowflakeStyle
    
    %% Enrichment
    EXT_FUNC[("External Function<br/>Fraud Detection API")]:::externalStyle
    TABLE_ENRICHED[("Enriched Transactions<br/>TRANS_ENRICHED")]:::snowflakeStyle
    
    %% Transformation
    STREAM[("Stream<br/>CDC")]:::snowflakeStyle
    TASK[("Task<br/>Aggregation")]:::snowflakeStyle
    TABLE_AGG[("Aggregated<br/>TRANS_SUMMARY")]:::snowflakeStyle
    
    %% Security
    SECURE_VIEW[("Secure View<br/>Customer-Level RLS")]:::secureStyle
    ROLE[("Role<br/>FINANCE_ANALYST")]:::securityStyle
    
    %% Connections
    KAFKA --> PIPE_STREAM --> TABLE_RAW
    TABLE_RAW --> EXT_FUNC --> TABLE_ENRICHED
    TABLE_ENRICHED --> STREAM --> TASK --> TABLE_AGG
    TABLE_AGG --> SECURE_VIEW
    SECURE_VIEW --> ROLE
    
    %% Styling
    classDef kafkaStyle fill:#231F20,stroke:#fff,stroke-width:2px,color:#fff
    classDef snowflakeStyle fill:#29B5E8,stroke:#fff,stroke-width:2px,color:#fff
    classDef externalStyle fill:#FF6B6B,stroke:#fff,stroke-width:2px,color:#fff
    classDef secureStyle fill:#4ECDC4,stroke:#fff,stroke-width:2px,color:#fff
    classDef securityStyle fill:#95E1D3,stroke:#333,stroke-width:2px,color:#333'
);

-- =====================================================
-- BATCH DATA WAREHOUSE ARCHITECTURES
-- =====================================================

-- Classic Batch Data Warehouse
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'BATCH_DATA_WAREHOUSE',
    'Enterprise Batch Data Warehouse',
    'Traditional batch ETL data warehouse with nightly loads and dimensional modeling',
    ARRAY_CONSTRUCT('S3_TO_SNOWFLAKE_BATCH', 'STREAM_TASK_TRANSFORMATION', 'RBAC_SECURITY_LAYER', 'BI_TOOL_INTEGRATION'),
    'batch_analytics',
    'Retail, Healthcare, Manufacturing',
    'flowchart TD
    %% Source Layer
    S3[("AWS S3<br/>Data Lake")]:::awsStyle
    
    %% Ingestion Layer
    STAGE[("External Stage<br/>@S3_STAGE")]:::snowflakeStyle
    PIPE[("Snowpipe<br/>Batch Load")]:::snowflakeStyle
    TABLE_RAW[("Raw Table<br/>STAGING")]:::snowflakeStyle
    
    %% Transformation Layer
    STREAM[("Stream<br/>CDC")]:::snowflakeStyle
    TASK_CLEAN[("Task<br/>Cleansing")]:::snowflakeStyle
    TABLE_CLEAN[("Clean Table<br/>CLEAN_DATA")]:::snowflakeStyle
    
    TASK_DIM[("Task<br/>Dimensions")]:::snowflakeStyle
    DIM_CUSTOMER[("Dimension<br/>DIM_CUSTOMER")]:::snowflakeStyle
    DIM_PRODUCT[("Dimension<br/>DIM_PRODUCT")]:::snowflakeStyle
    
    TASK_FACT[("Task<br/>Facts")]:::snowflakeStyle
    FACT_SALES[("Fact Table<br/>FACT_SALES")]:::snowflakeStyle
    
    %% Analytics Layer
    VIEW_MART[("View<br/>SALES_MART")]:::snowflakeStyle
    
    %% Security Layer
    SECURE_VIEW[("Secure Views<br/>Row-Level Security")]:::secureStyle
    ROLE_ANALYST[("Role<br/>ANALYST")]:::securityStyle
    ROLE_MANAGER[("Role<br/>MANAGER")]:::securityStyle
    
    %% BI Tools
    POWERBI[("Power BI<br/>Reports")]:::biStyle
    
    %% Connections
    S3 --> STAGE --> PIPE --> TABLE_RAW
    TABLE_RAW --> STREAM --> TASK_CLEAN --> TABLE_CLEAN
    TABLE_CLEAN --> TASK_DIM --> DIM_CUSTOMER & DIM_PRODUCT
    TABLE_CLEAN --> TASK_FACT --> FACT_SALES
    DIM_CUSTOMER & DIM_PRODUCT --> FACT_SALES
    FACT_SALES --> VIEW_MART --> SECURE_VIEW
    SECURE_VIEW --> ROLE_ANALYST & ROLE_MANAGER
    ROLE_ANALYST & ROLE_MANAGER --> POWERBI
    
    %% Styling
    classDef awsStyle fill:#FF9900,stroke:#fff,stroke-width:2px,color:#fff
    classDef snowflakeStyle fill:#29B5E8,stroke:#fff,stroke-width:2px,color:#fff
    classDef secureStyle fill:#4ECDC4,stroke:#fff,stroke-width:2px,color:#fff
    classDef securityStyle fill:#95E1D3,stroke:#333,stroke-width:2px,color:#333
    classDef biStyle fill:#F2C94C,stroke:#333,stroke-width:2px,color:#333'
);

-- =====================================================
-- MULTI-CLOUD DATA MESH
-- =====================================================

-- Multi-Cloud Data Mesh Architecture
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'MULTI_CLOUD_DATA_MESH',
    'Multi-Cloud Data Mesh with Secure Sharing',
    'Federated data mesh architecture ingesting from AWS, Azure, and GCP with secure cross-domain sharing',
    ARRAY_CONSTRUCT('S3_TO_SNOWFLAKE_BATCH', 'AZURE_TO_SNOWFLAKE_BATCH', 'GCS_TO_SNOWFLAKE_BATCH', 'SECURE_DATA_SHARING'),
    'data_mesh',
    'Enterprise, Technology, Consulting',
    'flowchart LR
    %% Cloud Sources
    subgraph AWS["AWS Domain"]
        S3[("S3 Bucket<br/>Sales Data")]:::awsStyle
        STAGE_AWS[("Stage<br/>@AWS_STAGE")]:::snowflakeStyle
        DB_AWS[("Database<br/>SALES_DOMAIN")]:::snowflakeStyle
    end
    
    subgraph AZURE["Azure Domain"]
        AZURE_BLOB[("Azure Blob<br/>Marketing Data")]:::azureStyle
        STAGE_AZURE[("Stage<br/>@AZURE_STAGE")]:::snowflakeStyle
        DB_AZURE[("Database<br/>MARKETING_DOMAIN")]:::snowflakeStyle
    end
    
    subgraph GCP["GCP Domain"]
        GCS[("GCS Bucket<br/>Product Data")]:::gcpStyle
        STAGE_GCP[("Stage<br/>@GCP_STAGE")]:::snowflakeStyle
        DB_GCP[("Database<br/>PRODUCT_DOMAIN")]:::snowflakeStyle
    end
    
    %% Central Mesh Layer
    subgraph MESH["Data Mesh Hub"]
        SHARE_SALES[("Share<br/>Sales Domain")]:::shareStyle
        SHARE_MARKETING[("Share<br/>Marketing Domain")]:::shareStyle
        SHARE_PRODUCT[("Share<br/>Product Domain")]:::shareStyle
        
        CONSUMER_DB[("Consumer DB<br/>ANALYTICS_360")]:::snowflakeStyle
        VIEW_UNIFIED[("Unified View<br/>CUSTOMER_360")]:::snowflakeStyle
    end
    
    %% Analytics
    TABLEAU[("Tableau<br/>Executive Dashboard")]:::biStyle
    
    %% Connections
    S3 --> STAGE_AWS --> DB_AWS --> SHARE_SALES
    AZURE_BLOB --> STAGE_AZURE --> DB_AZURE --> SHARE_MARKETING
    GCS --> STAGE_GCP --> DB_GCP --> SHARE_PRODUCT
    
    SHARE_SALES & SHARE_MARKETING & SHARE_PRODUCT --> CONSUMER_DB
    CONSUMER_DB --> VIEW_UNIFIED --> TABLEAU
    
    %% Styling
    classDef awsStyle fill:#FF9900,stroke:#fff,stroke-width:2px,color:#fff
    classDef azureStyle fill:#0078D4,stroke:#fff,stroke-width:2px,color:#fff
    classDef gcpStyle fill:#4285F4,stroke:#fff,stroke-width:2px,color:#fff
    classDef snowflakeStyle fill:#29B5E8,stroke:#fff,stroke-width:2px,color:#fff
    classDef shareStyle fill:#56CCF2,stroke:#fff,stroke-width:2px,color:#fff
    classDef biStyle fill:#E97627,stroke:#fff,stroke-width:2px,color:#fff'
);

-- =====================================================
-- ML & AI PIPELINES
-- =====================================================

-- ML Feature Engineering Pipeline
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'ML_FEATURE_ENGINEERING',
    'ML Feature Engineering Pipeline',
    'End-to-end ML pipeline with feature engineering, model training, and inference',
    ARRAY_CONSTRUCT('STREAM_TASK_TRANSFORMATION', 'UDF_TRANSFORMATION', 'EXTERNAL_FUNCTION_ENRICHMENT'),
    'machine_learning',
    'Technology, E-commerce, Healthcare',
    'flowchart TD
    %% Raw Data
    TABLE_RAW[("Raw Table<br/>USER_BEHAVIOR")]:::snowflakeStyle
    
    %% Feature Engineering
    STREAM[("Stream<br/>CDC")]:::snowflakeStyle
    TASK_FE[("Task<br/>Feature Engineering")]:::snowflakeStyle
    UDF_FEATURES[("UDF<br/>Calculate Features")]:::snowflakeStyle
    TABLE_FEATURES[("Feature Table<br/>ML_FEATURES")]:::snowflakeStyle
    
    %% External ML
    EXT_FUNC_TRAIN[("External Function<br/>SageMaker Training")]:::externalStyle
    EXT_FUNC_PREDICT[("External Function<br/>Model Inference")]:::externalStyle
    
    %% Predictions
    TABLE_PREDICTIONS[("Predictions Table<br/>ML_PREDICTIONS")]:::snowflakeStyle
    VIEW_RESULTS[("View<br/>BUSINESS_INSIGHTS")]:::snowflakeStyle
    
    %% Connections
    TABLE_RAW --> STREAM --> TASK_FE
    TASK_FE --> UDF_FEATURES --> TABLE_FEATURES
    TABLE_FEATURES --> EXT_FUNC_TRAIN
    TABLE_FEATURES --> EXT_FUNC_PREDICT --> TABLE_PREDICTIONS
    TABLE_PREDICTIONS --> VIEW_RESULTS
    
    %% Styling
    classDef snowflakeStyle fill:#29B5E8,stroke:#fff,stroke-width:2px,color:#fff
    classDef externalStyle fill:#FF6B6B,stroke:#fff,stroke-width:2px,color:#fff'
);

-- =====================================================
-- DATA GOVERNANCE & COMPLIANCE
-- =====================================================

-- Data Governance & Compliance Architecture
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'DATA_GOVERNANCE_COMPLIANCE',
    'Data Governance & Compliance Framework',
    'Comprehensive data governance with masking, tagging, and audit logging',
    ARRAY_CONSTRUCT('RBAC_SECURITY_LAYER', 'ROW_LEVEL_SECURITY', 'SECURE_DATA_SHARING'),
    'governance',
    'Financial Services, Healthcare, Government',
    'flowchart TD
    %% Source Data
    TABLE_SOURCE[("Source Table<br/>CUSTOMER_PII")]:::snowflakeStyle
    
    %% Masking Layer
    MASKING_POLICY[("Masking Policy<br/>PII_MASK")]:::securityStyle
    TABLE_MASKED[("Masked View<br/>CUSTOMER_SAFE")]:::secureStyle
    
    %% Row-Level Security
    RLS_POLICY[("RLS Policy<br/>REGION_FILTER")]:::securityStyle
    SECURE_VIEW[("Secure View<br/>CUSTOMER_RLS")]:::secureStyle
    
    %% Role Hierarchy
    ROLE_DPO[("Role<br/>DATA_PRIVACY_OFFICER")]:::securityStyle
    ROLE_ANALYST[("Role<br/>REGIONAL_ANALYST")]:::securityStyle
    ROLE_USER[("Role<br/>BUSINESS_USER")]:::securityStyle
    
    %% Audit
    ACCESS_HISTORY[("Access History<br/>Audit Logs")]:::auditStyle
    
    %% External Sharing
    SHARE_EXTERNAL[("Secure Share<br/>Partner Access")]:::shareStyle
    
    %% Connections
    TABLE_SOURCE --> MASKING_POLICY --> TABLE_MASKED
    TABLE_MASKED --> RLS_POLICY --> SECURE_VIEW
    SECURE_VIEW --> ROLE_DPO & ROLE_ANALYST & ROLE_USER
    ROLE_DPO & ROLE_ANALYST & ROLE_USER --> ACCESS_HISTORY
    SECURE_VIEW --> SHARE_EXTERNAL
    
    %% Styling
    classDef snowflakeStyle fill:#29B5E8,stroke:#fff,stroke-width:2px,color:#fff
    classDef securityStyle fill:#95E1D3,stroke:#333,stroke-width:2px,color:#333
    classDef secureStyle fill:#4ECDC4,stroke:#fff,stroke-width:2px,color:#fff
    classDef auditStyle fill:#A8E6CF,stroke:#333,stroke-width:2px,color:#333
    classDef shareStyle fill:#56CCF2,stroke:#fff,stroke-width:2px,color:#fff'
);

-- =====================================================
-- HYBRID CLOUD DATA LAKE
-- =====================================================

-- Hybrid Cloud Data Lakehouse
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'HYBRID_CLOUD_LAKEHOUSE',
    'Hybrid Cloud Data Lakehouse with Iceberg',
    'Modern lakehouse architecture with Iceberg tables and external catalog',
    ARRAY_CONSTRUCT('S3_TO_SNOWFLAKE_BATCH', 'STREAM_TASK_TRANSFORMATION', 'BI_TOOL_INTEGRATION'),
    'lakehouse',
    'Technology, Media, Telecommunications',
    'flowchart LR
    %% Data Lake
    S3[("AWS S3<br/>Data Lake<br/>Parquet/Iceberg")]:::awsStyle
    
    %% External Catalog
    GLUE[("AWS Glue<br/>Catalog")]:::awsStyle
    
    %% Snowflake Lakehouse
    EXTERNAL_TABLE[("External Table<br/>ICEBERG_TABLE")]:::snowflakeStyle
    CATALOG_INT[("Catalog Integration<br/>Glue Integration")]:::snowflakeStyle
    
    %% Materialized Views
    MAT_VIEW[("Materialized View<br/>Optimized Query")]:::snowflakeStyle
    
    %% Transformation
    STREAM[("Stream<br/>CDC")]:::snowflakeStyle
    TASK[("Task<br/>Transform")]:::snowflakeStyle
    TABLE_CURATED[("Curated Table<br/>ANALYTICS_READY")]:::snowflakeStyle
    
    %% Analytics
    VIEW[("View<br/>Business Metrics")]:::snowflakeStyle
    TABLEAU[("Tableau<br/>Dashboard")]:::biStyle
    
    %% Connections
    S3 -.->|External| GLUE
    GLUE --> CATALOG_INT --> EXTERNAL_TABLE
    EXTERNAL_TABLE --> MAT_VIEW
    MAT_VIEW --> STREAM --> TASK --> TABLE_CURATED
    TABLE_CURATED --> VIEW --> TABLEAU
    
    %% Styling
    classDef awsStyle fill:#FF9900,stroke:#fff,stroke-width:2px,color:#fff
    classDef snowflakeStyle fill:#29B5E8,stroke:#fff,stroke-width:2px,color:#fff
    classDef biStyle fill:#E97627,stroke:#fff,stroke-width:2px,color:#fff'
);

SELECT 'Full architecture templates inserted: ' || COUNT(*) || ' total' AS status
FROM ARCHITECTURE_TEMPLATES;

-- =====================================================
-- TEMPLATE-PATTERN RELATIONSHIPS
-- =====================================================

-- REALTIME_IOT_PIPELINE
INSERT INTO TEMPLATE_PATTERN_RELATIONSHIPS (template_id, pattern_id, pattern_order) VALUES
    ('REALTIME_IOT_PIPELINE', 'KAFKA_STREAMING_INGESTION', 1),
    ('REALTIME_IOT_PIPELINE', 'STREAM_TASK_TRANSFORMATION', 2),
    ('REALTIME_IOT_PIPELINE', 'BI_TOOL_INTEGRATION', 3);

-- BATCH_DATA_WAREHOUSE
INSERT INTO TEMPLATE_PATTERN_RELATIONSHIPS (template_id, pattern_id, pattern_order) VALUES
    ('BATCH_DATA_WAREHOUSE', 'S3_TO_SNOWFLAKE_BATCH', 1),
    ('BATCH_DATA_WAREHOUSE', 'STREAM_TASK_TRANSFORMATION', 2),
    ('BATCH_DATA_WAREHOUSE', 'RBAC_SECURITY_LAYER', 3),
    ('BATCH_DATA_WAREHOUSE', 'BI_TOOL_INTEGRATION', 4);

-- MULTI_CLOUD_DATA_MESH
INSERT INTO TEMPLATE_PATTERN_RELATIONSHIPS (template_id, pattern_id, pattern_order) VALUES
    ('MULTI_CLOUD_DATA_MESH', 'S3_TO_SNOWFLAKE_BATCH', 1),
    ('MULTI_CLOUD_DATA_MESH', 'AZURE_TO_SNOWFLAKE_BATCH', 2),
    ('MULTI_CLOUD_DATA_MESH', 'GCS_TO_SNOWFLAKE_BATCH', 3),
    ('MULTI_CLOUD_DATA_MESH', 'SECURE_DATA_SHARING', 4);

-- REALTIME_FINANCIAL_TRANSACTIONS
INSERT INTO TEMPLATE_PATTERN_RELATIONSHIPS (template_id, pattern_id, pattern_order) VALUES
    ('REALTIME_FINANCIAL_TRANSACTIONS', 'KAFKA_STREAMING_INGESTION', 1),
    ('REALTIME_FINANCIAL_TRANSACTIONS', 'STREAM_TASK_TRANSFORMATION', 2),
    ('REALTIME_FINANCIAL_TRANSACTIONS', 'EXTERNAL_FUNCTION_ENRICHMENT', 3),
    ('REALTIME_FINANCIAL_TRANSACTIONS', 'ROW_LEVEL_SECURITY', 4);

-- ML_FEATURE_ENGINEERING
INSERT INTO TEMPLATE_PATTERN_RELATIONSHIPS (template_id, pattern_id, pattern_order) VALUES
    ('ML_FEATURE_ENGINEERING', 'STREAM_TASK_TRANSFORMATION', 1),
    ('ML_FEATURE_ENGINEERING', 'UDF_TRANSFORMATION', 2),
    ('ML_FEATURE_ENGINEERING', 'EXTERNAL_FUNCTION_ENRICHMENT', 3);

-- DATA_GOVERNANCE_COMPLIANCE
INSERT INTO TEMPLATE_PATTERN_RELATIONSHIPS (template_id, pattern_id, pattern_order) VALUES
    ('DATA_GOVERNANCE_COMPLIANCE', 'RBAC_SECURITY_LAYER', 1),
    ('DATA_GOVERNANCE_COMPLIANCE', 'ROW_LEVEL_SECURITY', 2),
    ('DATA_GOVERNANCE_COMPLIANCE', 'SECURE_DATA_SHARING', 3);

-- HYBRID_CLOUD_LAKEHOUSE
INSERT INTO TEMPLATE_PATTERN_RELATIONSHIPS (template_id, pattern_id, pattern_order) VALUES
    ('HYBRID_CLOUD_LAKEHOUSE', 'S3_TO_SNOWFLAKE_BATCH', 1),
    ('HYBRID_CLOUD_LAKEHOUSE', 'STREAM_TASK_TRANSFORMATION', 2),
    ('HYBRID_CLOUD_LAKEHOUSE', 'BI_TOOL_INTEGRATION', 3);

SELECT 'Template-pattern relationships inserted: ' || COUNT(*) || ' total' AS status
FROM TEMPLATE_PATTERN_RELATIONSHIPS;






