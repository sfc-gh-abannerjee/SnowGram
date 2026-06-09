-- =====================================================
-- Full Templates: 7 templates extracted from se_demo
-- =====================================================
-- Purpose: These 7 ARCHITECTURE_TEMPLATES rows existed ONLY in the se_demo
--          account and were never committed to repo SQL (see full_templates.sql,
--          which defines the other 7). Captured via DESCRIBE/SELECT from
--          SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES so a fresh account deploy
--          reproduces all 14 templates.
--
-- Run AFTER the ARCHITECTURE_TEMPLATES table exists (see schema/DDL scripts)
-- and alongside backend/modular/full_templates.sql.
--
-- Note: these 7 have NO TEMPLATE_PATTERN_RELATIONSHIPS rows in se_demo; their
-- composed_patterns arrays are component-level block ids, not COMPOSED_PATTERNS ids.
-- Author: Abhinav Bannerjee
-- =====================================================

USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;


-- Medallion Architecture (Bronze-Silver-Gold)
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'MEDALLION_LAKEHOUSE',
    'Medallion Architecture (Bronze-Silver-Gold)',
    'Medallion Architecture (Bronze-Silver-Gold): Best practices: Separate batch/streaming tables (dont mix), VARIANT for JSON in Bronze, Serverless Tasks for Silver transforms, Dynamic Tables for Gold with DOWNSTREAM lag and dedicated refresh warehouse, explicitly set refresh mode for production DTs, isolated warehouses (WH_LOADING, WH_TRANSFORM, WH_BI_ANALYTICS).',
    ARRAY_CONSTRUCT('S3_TO_SNOWFLAKE_BATCH', 'STREAM_TASK_TRANSFORMATION', 'BI_TOOL_INTEGRATION'),
    'medallion_architecture',
    'Enterprise, Retail, Financial Services',
    'flowchart LR
    subgraph source["Data Sources"]
        s3["AWS S3<br/>Data Lake"]
    end

    subgraph bronze["Bronze Layer (Raw)"]
        pipe["Snowpipe<br/>Auto-Ingest<br/>Separate from Streaming"]
        bronze_db["BRONZE_DB"]
        bronze_raw["Raw Tables<br/>Append-Only<br/>VARIANT for JSON"]
    end

    subgraph silver["Silver Layer (Cleaned)"]
        stream_b["Stream<br/>Bronze CDC"]
        task_clean["Serverless Task<br/>Data Quality"]
        silver_db["SILVER_DB"]
        silver_tables["Cleaned Tables<br/>SCD Type 2"]
    end

    subgraph gold["Gold Layer (Business)"]
        dyn_table["Dynamic Tables<br/>TARGET_LAG=DOWNSTREAM<br/>Dedicated WH<br/>Set Refresh Mode"]
        gold_db["GOLD_DB"]
        gold_agg["Aggregated Facts<br/>Business Metrics"]
    end

    subgraph compute["Warehouse Strategy"]
        wh_load["WH_LOADING<br/>Ingestion"]
        wh_transform["WH_TRANSFORM<br/>DT Refresh"]
        wh_bi["WH_BI_ANALYTICS<br/>Multi-Cluster"]
    end

    subgraph bi["Analytics"]
        bi_tools["BI Tools<br/>Dashboards"]
    end

    s3 --> pipe
    pipe --> bronze_raw
    bronze_raw --> stream_b
    stream_b --> task_clean
    task_clean --> silver_tables
    silver_tables --> dyn_table
    dyn_table --> gold_agg
    gold_agg --> bi_tools
    
    wh_load -.-> pipe
    wh_transform -.-> dyn_table
    wh_bi -.-> bi_tools

    style source fill:#FF9900,stroke:#fff
    style bronze fill:#CD7F32,stroke:#8B4513
    style silver fill:#C0C0C0,stroke:#808080
    style gold fill:#FFD700,stroke:#DAA520
    style compute fill:#E6E6FA,stroke:#9370DB
    style bi fill:#F2C94C,stroke:#333'
);

-- Medallion Architecture (Snowflake-Native)
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY',
    'Medallion Architecture (Snowflake-Native)',
    'Medallion Architecture (Snowflake-Native): Best practices: No external sources - pure Snowflake, VARIANT for JSON in Bronze, Streams for CDC with deduplication in Silver, Dynamic Tables with DOWNSTREAM lag for Gold (explicitly set refresh mode), Schema Tags for lineage tracking, dedicated warehouse for DT refresh, Multi-Cluster warehouse with auto-scaling for BI.',
    ARRAY_CONSTRUCT('STREAM_TASK_TRANSFORMATION', 'BI_TOOL_INTEGRATION'),
    'medallion_architecture',
    'Enterprise, Retail, Financial Services',
    'flowchart LR
    subgraph bronze["Bronze Layer (Raw)"]
        bronze_db["BRONZE_DB"]
        bronze_schema["Bronze Schema"]
        bronze_raw["Raw Tables<br/>Append-Only<br/>VARIANT for JSON"]
    end

    subgraph silver["Silver Layer (Cleaned)"]
        stream_b["Stream<br/>CDC Tracking"]
        task_silver["Serverless Task<br/>Data Quality"]
        silver_db["SILVER_DB"]
        silver_tables["Cleaned Tables<br/>SCD Type 2<br/>Deduplication"]
    end

    subgraph gold["Gold Layer (Business)"]
        dyn_table["Dynamic Tables<br/>TARGET_LAG=DOWNSTREAM<br/>Set Refresh Mode"]
        gold_db["GOLD_DB"]
        gold_agg["Business Aggregates<br/>Clustered"]
    end

    subgraph compute["Warehouse Strategy"]
        wh_transform["WH_TRANSFORM<br/>DT Dedicated"]
        wh_bi["WH_BI_ANALYTICS<br/>Multi-Cluster<br/>Auto-Scale"]
    end

    subgraph governance["Governance"]
        tags["Schema Tags<br/>BRONZE, SILVER, GOLD"]
        lineage["Data Lineage"]
    end

    subgraph bi["Analytics"]
        bi_tools["BI Tools"]
    end

    bronze_raw --> stream_b
    stream_b --> task_silver
    task_silver --> silver_tables
    silver_tables --> dyn_table
    dyn_table --> gold_agg
    gold_agg --> bi_tools
    
    bronze_db --> tags
    silver_db --> tags
    gold_db --> tags
    tags --> lineage
    
    wh_transform -.-> dyn_table
    wh_bi -.-> bi_tools

    style bronze fill:#CD7F32,stroke:#8B4513
    style silver fill:#C0C0C0,stroke:#808080
    style gold fill:#FFD700,stroke:#DAA520
    style compute fill:#E6E6FA,stroke:#9370DB
    style governance fill:#98D8C8,stroke:#2ECC71
    style bi fill:#F2C94C,stroke:#333'
);

-- Streaming Data Stack Reference Architecture
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'STREAMING_DATA_STACK',
    'Streaming Data Stack Reference Architecture',
    'Streaming Data Stack Reference Architecture (Snowflake Official) with 4 numbered ingestion paths:

**1a - Kafka Path**: Producer App → Amazon Data Firehose → Kafka → Snowflake Connector for Kafka (Snowpipe Streaming is built-in) → Staging

**1b - CSP Stream Processing**: Producer App → Amazon Kinesis OR Azure Event Hubs OR Google Pub/Sub → Compute (VM/Container/Serverless) with Java SDK → Snowpipe Streaming. Use when sub-second latency is critical.

**1c - Batch/Files Path**: Producer App → Amazon S3 OR Azure Blob Storage OR Google Cloud Storage → Snowpipe (regular, NOT Streaming) → Staging. Raw data retained in blob storage.

**1d - Native App Connector**: Industry Data Sources (ServiceNow, Salesforce, etc.) → Snowflake Marketplace → Native App Connector → Direct to Dynamic Tables

**Downstream Processing (Sections 2-5)**:
- (2) Ingestion: Snowpipe Streaming AND regular Snowpipe as separate entry points
- (3) Aggregation Using Streams & Tasks: Serverless Tasks for transformation
- (4) Tables: BOTH Normalized Tables AND Dynamic Tables with Instant Scalability
- (5) Consumption: Python Stored Procedures, Snowpark, Snowpark Container Services → In-app Analytics

Key Distinctions:
- Snowpipe Streaming (1a, 1b) vs regular Snowpipe (1c) - different latency profiles
- Native App Connector (1d) bypasses Streams/Tasks and goes direct to Dynamic Tables
- Section 4 shows BOTH Normalized Tables and Dynamic Tables as valid transformation targets',
    ARRAY_CONSTRUCT('producer_app', 'kafka', 'snowflake_connector_for_kafka', 'amazon_kinesis', 'azure_event_hubs', 'google_pubsub', 'csp_compute', 'snowpipe_streaming', 'amazon_s3', 'azure_blob_storage', 'google_cloud_storage', 'snowpipe_auto_ingest', 'native_app_connector', 'snowflake_marketplace', 'staging_table', 'streams', 'tasks', 'dynamic_tables', 'python_stored_procedures', 'snowpark', 'snowpark_container_services', 'in_app_analytics'),
    'Real-Time Analytics',
    'All',
    'flowchart LR
    badge_5(["5"]):::sectionBadge
    badge_4(["4"]):::sectionBadge
    badge_3(["3"]):::sectionBadge
    badge_2(["2"]):::sectionBadge
    badge_6(["6"]):::sectionBadge
    %% Lane Badges (Purple)
    badge_1a(["1a"]):::laneBadge
    badge_1b(["1b"]):::laneBadge
    badge_1c(["1c"]):::laneBadge
    badge_1d(["1d"]):::laneBadge
    
    subgraph spacer_top[" "]
        spacer_top_node[" "]
        style spacer_top_node fill:none,stroke:none
    end
    
    subgraph spacer_left[" "]
        spacer_left_node[" "]
        style spacer_left_node fill:none,stroke:none
    end
    
    subgraph spacer_left_bottom[" "]
        spacer_left_bottom_node[" "]
        style spacer_left_bottom_node fill:none,stroke:none
    end
    
    subgraph producer["Producer App"]
        prod_app["Producer App"]
    end
    
    subgraph ingestion_paths["Ingestion Paths"]
        subgraph path_1a["1a: Kafka Path"]
            firehose["Amazon Data Firehose"]
            kafka["Kafka"]
            kafka_connector["Snowflake Connector<br/>for Kafka<br/>(Snowpipe Streaming built-in)"]
        end
        
        subgraph path_1b["1b: CSP Stream Processing"]
            kinesis["Amazon Kinesis"]
            event_hubs["Azure Event Hubs"]
            pubsub["Google Pub/Sub"]
            compute["Compute<br/>(VM, Container, Serverless)"]
        end
        
        subgraph path_1c["1c: Batch/Files"]
            s3["Amazon S3"]
            azure_blob["Azure Blob Storage"]
            gcs["Google Cloud Storage"]
        end
        
        subgraph path_1d["1d: Native App Connector"]
            industry_sources["Industry Data Sources<br/>(ServiceNow, Salesforce, etc.)"]
            marketplace["Snowflake Marketplace"]
        end
    end
    
    subgraph snowflake["Snowflake"]
        subgraph section_2["2: Ingestion"]
            snowpipe_streaming["Snowpipe Streaming"]
            snowpipe["Snowpipe"]
            native_connector["Native App Connector"]
        end
        
        subgraph section_3["3: Aggregation Using Streams & Tasks"]
            streams["Streams"]
            serverless_tasks["Serverless Tasks"]
        end
        
        subgraph section_4["4: Tables"]
            normalized_tables["Normalized Tables"]
            dynamic_tables["Dynamic Tables"]
            scalability[/"Instant Scalability"/]
        end
        
        subgraph section_5["5: Consumption"]
            python_sp["Python Stored Procedures"]
            snowpark["Snowpark"]
            spcs["Snowpark Container Services"]
        end
        
        subgraph analytics_section["6: Analytics"]
            analytics["In-app Analytics"]
        end
    end
    
    subgraph consumer_group["Consumer"]
        consumer["Consumer App"]
    end
    
    subgraph spacer_right[" "]
        spacer_right_node[" "]
        style spacer_right_node fill:none,stroke:none
    end
    
    subgraph spacer_right_bottom[" "]
        spacer_right_bottom_node[" "]
        style spacer_right_bottom_node fill:none,stroke:none
    end
    
    subgraph spacer_bottom[" "]
        spacer_bottom_node[" "]
        style spacer_bottom_node fill:none,stroke:none
    end
    
    subgraph spacer_top_left[" "]
        spacer_top_left_node[" "]
        style spacer_top_left_node fill:none,stroke:none
    end
    
    subgraph spacer_top_right[" "]
        spacer_top_right_node[" "]
        style spacer_top_right_node fill:none,stroke:none
    end
    
    subgraph spacer_bottom_right[" "]
        spacer_bottom_right_node[" "]
        style spacer_bottom_right_node fill:none,stroke:none
    end
    
    subgraph spacer_bottom_left[" "]
        spacer_bottom_left_node[" "]
        style spacer_bottom_left_node fill:none,stroke:none
    end
    
    subgraph label_area_streaming_1a[" "]
        label_streaming_1a[" "]
        style label_streaming_1a fill:none,stroke:none
    end
    
    subgraph label_area_streaming_1b[" "]
        label_streaming_1b[" "]
        style label_streaming_1b fill:none,stroke:none
    end
    
    subgraph label_area_batch_1c[" "]
        label_batch_1c[" "]
        style label_batch_1c fill:none,stroke:none
    end
    
    subgraph label_area_native_1d[" "]
        label_native_1d[" "]
        style label_native_1d fill:none,stroke:none
    end
    
    subgraph label_area_cdc_2_3[" "]
        label_cdc_2_3[" "]
        style label_cdc_2_3 fill:none,stroke:none
    end
    
    subgraph label_area_transform_3[" "]
        label_transform_3[" "]
        style label_transform_3 fill:none,stroke:none
    end
    
    subgraph label_area_write_3_4[" "]
        label_write_3_4[" "]
        style label_write_3_4 fill:none,stroke:none
    end
    
    subgraph label_area_scale_4[" "]
        label_scale_4[" "]
        style label_scale_4 fill:none,stroke:none
    end
    
    subgraph label_area_process_4_5[" "]
        label_process_4_5[" "]
        style label_process_4_5 fill:none,stroke:none
    end
    
    subgraph label_area_analyze_5_6[" "]
        label_analyze_5_6[" "]
        style label_analyze_5_6 fill:none,stroke:none
    end
    
    subgraph label_area_deliver_6[" "]
        label_deliver_6[" "]
        style label_deliver_6 fill:none,stroke:none
    end
    
    %% Spacer connections for layout
    spacer_top_node ~~~ spacer_top_left_node
    spacer_top_left_node ~~~ spacer_left_node
    spacer_left_node ~~~ spacer_left_bottom_node
    spacer_left_bottom_node ~~~ spacer_bottom_node
    spacer_top_node ~~~ spacer_top_right_node
    spacer_top_right_node ~~~ spacer_right_node
    spacer_right_node ~~~ spacer_right_bottom_node
    spacer_right_bottom_node ~~~ spacer_bottom_right_node
    spacer_bottom_node ~~~ spacer_bottom_right_node
    spacer_bottom_node ~~~ spacer_bottom_left_node
    spacer_bottom_left_node ~~~ spacer_left_bottom_node
    
    %% Path 1a: Kafka
    prod_app -->|"Streaming"| firehose
    firehose -->|"Streaming"| kafka
    kafka -->|"Streaming"| kafka_connector
    kafka_connector -->|"Streaming/row-set"| snowpipe_streaming
    
    %% Path 1b: CSP Streaming
    prod_app -->|"Streaming"| kinesis
    prod_app -->|"Streaming"| event_hubs
    prod_app -->|"Streaming"| pubsub
    kinesis -->|"Streaming"| compute
    event_hubs -->|"Streaming"| compute
    pubsub -->|"Streaming"| compute
    compute -->|"Streaming"| snowpipe_streaming
    
    %% Path 1c: Batch/Files
    prod_app -->|"Batch"| s3
    prod_app -->|"Batch"| azure_blob
    prod_app -->|"Batch"| gcs
    s3 -->|"Batch/Files"| snowpipe
    azure_blob -->|"Batch/Files"| snowpipe
    gcs -->|"Batch/Files"| snowpipe
    
    %% Path 1d: Native App Connector
    industry_sources -->|"Native"| marketplace
    marketplace -->|"Native"| native_connector
    
    %% Section 2 to Section 3
    snowpipe_streaming -->|"CDC"| streams
    snowpipe -->|"CDC"| streams
    native_connector -->|"CDC"| streams
    native_connector -->|"Direct"| dynamic_tables
    
    %% Section 3 processing
    streams -->|"Transform"| serverless_tasks
    serverless_tasks -->|"Write"| normalized_tables
    serverless_tasks -->|"Write"| dynamic_tables
    
    %% Section 4 scalability
    normalized_tables -->|"Scale"| scalability
    dynamic_tables -->|"Scale"| scalability
    
    %% Section 4 to Section 5
    scalability -->|"Process"| python_sp
    scalability -->|"Process"| snowpark
    scalability -->|"Process"| spcs
    
    %% Section 5 to Analytics
    python_sp -->|"Analyze"| analytics
    snowpark -->|"Analyze"| analytics
    spcs -->|"Analyze"| analytics
    
    %% Analytics to Consumer
    analytics -->|"Deliver"| consumer
    
    %% Badge positioning
    badge_1a ~~~ path_1a
    badge_1b ~~~ path_1b
    badge_1c ~~~ path_1c
    badge_1d ~~~ path_1d
    badge_2 ~~~ section_2
    badge_3 ~~~ section_3
    badge_4 ~~~ section_4
    badge_5 ~~~ section_5
    badge_6 ~~~ analytics_section
    
    %% Styling
    classDef laneBadge fill:#7C3AED,stroke:#5B21B6,color:#fff,font-weight:bold
    classDef sectionBadge fill:#2563EB,stroke:#1D4ED8,color:#fff,font-weight:bold
    
    style ingestion_paths fill:#F5F5F5,stroke:#666
    style path_1a fill:#E3F2FD,stroke:#2196F3
    style path_1b fill:#F3E5F5,stroke:#9C27B0
    style path_1c fill:#E8F5E9,stroke:#4CAF50
    style path_1d fill:#FFF8E1,stroke:#FFC107
    style snowflake fill:#E0F7FA,stroke:#00ACC1
    style section_2 fill:#E1F5FE,stroke:#03A9F4
    style section_3 fill:#F3E5F5,stroke:#9C27B0
    style section_4 fill:#E8F5E9,stroke:#4CAF50
    style section_5 fill:#FFF3E0,stroke:#FF9800
    style analytics_section fill:#FCE4EC,stroke:#E91E63
    style consumer_group fill:#FFF,stroke:#999
    style producer fill:#FFF,stroke:#999
    style spacer_top fill:none,stroke:none
    style spacer_left fill:none,stroke:none
    style spacer_left_bottom fill:none,stroke:none
    style spacer_right fill:none,stroke:none
    style spacer_right_bottom fill:none,stroke:none
    style spacer_bottom fill:none,stroke:none
    style spacer_top_left fill:none,stroke:none
    style spacer_top_right fill:none,stroke:none
    style spacer_bottom_right fill:none,stroke:none
    style spacer_bottom_left fill:none,stroke:none
    style label_area_streaming_1a fill:none,stroke:none
    style label_area_streaming_1b fill:none,stroke:none
    style label_area_batch_1c fill:none,stroke:none
    style label_area_native_1d fill:none,stroke:none
    style label_area_cdc_2_3 fill:none,stroke:none
    style label_area_transform_3 fill:none,stroke:none
    style label_area_write_3_4 fill:none,stroke:none
    style label_area_scale_4 fill:none,stroke:none
    style label_area_process_4_5 fill:none,stroke:none
    style label_area_analyze_5_6 fill:none,stroke:none
    style label_area_deliver_6 fill:none,stroke:none'
);

-- Application Health & Security Analytics
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'SECURITY_ANALYTICS',
    'Application Health & Security Analytics',
    'Application Health & Security Analytics: Multi-cloud log ingestion via Kafka/Kinesis/Event Hubs/Pub/Sub. Best practices: Snowpipe Streaming with MAX_CLIENT_LAG=50s for optimal partition sizes, Dynamic Tables with dedicated warehouse and TARGET_LAG=1min, Search Optimization Service for log search, Time Travel (90-day) for forensics, Multi-cluster warehouse for dashboards, Secure Data Sharing for cross-team visibility.',
    ARRAY_CONSTRUCT('log_collection', 'kafka_streaming', 'kinesis_streaming', 'eventhub_streaming', 'pubsub_streaming', 's3_storage', 'azure_blob_storage', 'gcs_storage', 'snowpipe_streaming', 'snowpipe', 'snowpipe_auto_ingest', 'streams_tasks', 'dynamic_tables', 'snowpark', 'search_optimization_service', 'dashboards', 'messaging_service'),
    'Security & Compliance',
    'Cross-Industry',
    'flowchart LR
    subgraph app_infra["App / Infrastructure"]
        messages["Messages"]
        logs["Logs"]
        log_collection["Log Collection &<br/>Aggregation Systems"]
    end
    
    subgraph streaming["Streaming Service (CSP or Kafka)"]
        kafka["Kafka"]
        kinesis["Amazon Kinesis"]
        event_hubs["Azure Event Hubs"]
        pubsub["Google Pub/Sub"]
    end
    
    subgraph object_storage["Object Storage"]
        s3["Amazon S3"]
        azure_blob["Azure Blob Storage"]
        gcs["Google Cloud Storage"]
    end
    
    subgraph snowflake["Snowflake"]
        subgraph snowpipe_services["Snowpipe Services"]
            snowpipe_streaming["Snowpipe Streaming<br/>MAX_CLIENT_LAG=50s"]
            snowpipe["Snowpipe"]
            snowpipe_auto["Snowpipe w/<br/>Auto Ingest"]
        end
        
        subgraph processing["Data Processing"]
            streams_tasks["Streams & Tasks<br/>Serverless Tasks"]
            dynamic_tables["Dynamic Tables<br/>TARGET_LAG=1min<br/>Dedicated WH"]
            snowpark["Snowpark ML<br/>Anomaly Detection"]
        end
        
        subgraph analytics["Analytics"]
            sos["Search Optimization<br/>Service<br/>Log Search"]
            time_travel["Time Travel<br/>90-day Forensics"]
            dashboards["Monitoring Dashboards<br/>Multi-Cluster WH"]
        end
        
        subgraph sharing["Cross-Team"]
            data_sharing["Secure Data Sharing<br/>Cross-Team Visibility"]
        end
    end
    
    subgraph external_services["External Services"]
        messaging["Messaging Service<br/>Email, SMS/Push"]
    end
    
    messages --> log_collection
    logs --> log_collection
    log_collection --> kafka & kinesis & event_hubs & pubsub
    
    kafka & kinesis --> s3
    event_hubs --> azure_blob
    pubsub --> gcs
    
    s3 & azure_blob & gcs --> snowpipe_auto
    kafka & kinesis & event_hubs & pubsub --> snowpipe_streaming
    s3 & azure_blob & gcs --> snowpipe
    
    snowpipe_streaming & snowpipe & snowpipe_auto --> streams_tasks
    streams_tasks --> dynamic_tables
    dynamic_tables --> snowpark
    snowpark --> sos
    dynamic_tables --> sos
    sos --> time_travel
    time_travel --> dashboards
    dashboards --> messaging
    dashboards --> data_sharing
    
    style app_infra fill:#E8F4FD,stroke:#29B5E8
    style streaming fill:#FFE4B5,stroke:#FFA500
    style object_storage fill:#E6E6FA,stroke:#9370DB
    style snowflake fill:#E0F7FA,stroke:#00ACC1
    style external_services fill:#FFE4E1,stroke:#FF6B6B'
);

-- Customer 360 Reference Architecture
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'CUSTOMER_360',
    'Customer 360 Reference Architecture',
    'Customer 360 Architecture: Best practices: Native Apps for third-party data (no copying), Secure Data Sharing (zero-copy, no storage charges), External Tables for querying data lake in place, Reader Accounts with resource monitors for cost control, External Network Rules for egress control to public APIs (Healthcare API), ML models for propensity scoring and real-time predictions.',
    ARRAY_CONSTRUCT('data_lake', 'streaming_service', 'clickstreams', 'native_apps', 'secure_data_sharing', 'snowpark', 'dbt', 'external_tables', 'streams_tasks', 'json_support', 'ml_models', 'predictions_api', 'external_access'),
    'Customer Analytics',
    'All',
    'flowchart LR
    subgraph sources["Data Sources"]
        data_lake["Data Lake<br/>Products, Audiences"]
        streaming["Streaming Service<br/>Clickstreams"]
        third_party["Third-Party Data<br/>Native Apps"]
    end
    
    subgraph snowflake["Snowflake"]
        subgraph ingestion["Ingestion & Transform"]
            snowpark["Snowpark<br/>Orchestration"]
            dbt["dbt<br/>SQL Transforms"]
            external_tables["External Tables<br/>Query in Place"]
            streams_tasks["Streams & Tasks<br/>Automation"]
        end
        
        subgraph storage["Customer Data"]
            raw_data["Raw Data<br/>Native JSON"]
            enriched_data["Customer 360 View<br/>Unified Profile"]
        end
        
        subgraph sharing["Data Sharing"]
            secure_share["Secure Shares<br/>Zero-Copy"]
            native_app["Native Apps<br/>No Data Movement"]
            reader["Reader Accounts<br/>Resource Monitors"]
        end
    end
    
    subgraph ml["Machine Learning"]
        ml_training["ML Models<br/>Propensity Scoring"]
        predictions["Real-Time API<br/>External Access"]
        batch_results["Batch Predictions"]
    end
    
    subgraph external["External Access"]
        cloud_api["External Network Rules<br/>Egress Control"]
        healthcare["Cloud Healthcare API"]
    end
    
    data_lake --> snowpark & external_tables
    streaming --> streams_tasks
    third_party --> native_app
    native_app --> raw_data
    snowpark --> dbt
    dbt --> raw_data
    external_tables --> raw_data
    streams_tasks --> raw_data
    raw_data --> enriched_data
    enriched_data --> secure_share
    secure_share --> reader
    enriched_data --> ml_training
    ml_training --> predictions & batch_results
    enriched_data --> cloud_api
    cloud_api --> healthcare
    
    style sources fill:#E8F4FD,stroke:#29B5E8
    style snowflake fill:#E0F7FA,stroke:#00ACC1
    style ml fill:#E6E6FA,stroke:#9370DB
    style external fill:#FFE4E1,stroke:#FF6B6B'
);

-- Embedded Analytics Reference Architecture
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'EMBEDDED_ANALYTICS',
    'Embedded Analytics Reference Architecture',
    'Embedded Analytics: In-app visualizations with Hybrid Tables for operational workloads. Best practices: Hybrid Tables with index-based reads and row locking, CTAS for bulk loading empty tables, X-Small Multi-Cluster warehouse with Standard scaling for operational queries, separate warehouse sized for BI working set, Streamlit for custom apps.',
    ARRAY_CONSTRUCT('api_gateway', 'web_tier', 'oltp_database', 'hybrid_tables', 'etl_partners', 'fivetran', 'matillion', 'dbt', 'hvr', 'virtual_warehouses', 'workload_isolation', 'autoscaling', 'streamlit', 'embedded_bi', 'charting_libraries'),
    'Analytics',
    'All',
    'flowchart LR
    subgraph application["Application Layer"]
        api["API / Web Tier<br/>SLA Enforcement"]
        app["Application<br/>User Requests"]
    end
    
    subgraph transactional["Transactional Layer"]
        oltp["OLTP Database<br/>SQL or NoSQL"]
        hybrid["Snowflake Hybrid Tables<br/>Index-Based Reads<br/>Row Locking"]
    end
    
    subgraph etl["ETL / Data Integration"]
        fivetran["FiveTran"]
        matillion["Matillion"]
        dbt["dbt"]
        hvr["HVR"]
    end
    
    subgraph snowflake["Snowflake"]
        subgraph storage["Historical Data"]
            historical["Historical Data<br/>CTAS Bulk Loading"]
        end
        
        subgraph compute["Compute Isolation"]
            vw_app["WH_APP_QUERIES<br/>X-Small Multi-Cluster<br/>Standard Scaling"]
            vw_bi["WH_BI_ANALYTICS<br/>Sized for Working Set"]
        end
    end
    
    subgraph visualization["Visualization"]
        streamlit["Streamlit in Snowflake"]
        embedded_bi["Embedded BI Tools"]
    end
    
    app --> api
    api --> oltp
    api --> hybrid
    oltp --> fivetran & matillion & dbt & hvr
    fivetran & matillion & dbt & hvr --> historical
    historical --> vw_app
    historical --> vw_bi
    vw_app --> streamlit
    vw_bi --> embedded_bi
    hybrid --> vw_app
    
    style application fill:#E8F4FD,stroke:#29B5E8
    style transactional fill:#FFE4B5,stroke:#FFA500
    style etl fill:#E6E6FA,stroke:#9370DB
    style snowflake fill:#E0F7FA,stroke:#00ACC1
    style visualization fill:#FFE4E1,stroke:#FF6B6B'
);

-- Serverless Data Stack Reference Architecture
INSERT INTO ARCHITECTURE_TEMPLATES (
    template_id, template_name, description, composed_patterns, use_case_category, industry, full_mermaid_code
) VALUES (
    'SERVERLESS_DATA_STACK',
    'Serverless Data Stack Reference Architecture',
    'Serverless Data Stack: Best practices: Hybrid Tables for operational workloads (index-based reads, row locking, CTAS for bulk load), Native JSON/VARIANT for semi-structured data, X-Small Multi-Cluster warehouse for operational queries, separate analytical warehouse for isolation, Serverless Tasks for auto-scaling transforms.',
    ARRAY_CONSTRUCT('api_gateway', 'rest_endpoints', 'aws_lambda', 'azure_functions', 'cloud_functions', 'oltp_database', 'nosql_database', 'aws_glue', 'azure_data_factory', 'serverless_etl', 'json_support', 'virtual_warehouses', 'hybrid_tables'),
    'Serverless',
    'All',
    'flowchart LR
    subgraph clients["Clients"]
        client["Client Applications"]
    end
    
    subgraph api["API Layer"]
        api_gateway["API Gateway<br/>REST Endpoints"]
    end
    
    subgraph serverless_compute["Serverless Compute"]
        lambda["AWS Lambda"]
        azure_func["Azure Functions"]
        cloud_func["GCP Cloud Functions"]
    end
    
    subgraph transactional["Transactional Storage"]
        oltp["OLTP Database"]
        nosql["NoSQL Database"]
    end
    
    subgraph serverless_etl["Serverless ETL"]
        glue["AWS Glue"]
        adf["Azure Data Factory"]
    end
    
    subgraph snowflake["Snowflake Data Cloud"]
        subgraph operational["Operational"]
            hybrid["Hybrid Tables<br/>Index-Based Reads<br/>Row Locking<br/>CTAS Bulk Load"]
        end
        
        subgraph storage["Storage"]
            json["Native JSON<br/>VARIANT Type"]
        end
        
        subgraph compute["Compute"]
            vw_ops["WH_OPERATIONAL<br/>X-Small Multi-Cluster"]
            vw_analytics["WH_ANALYTICS<br/>Workload Isolated"]
        end
        
        subgraph tasks["Serverless"]
            serverless_tasks["Serverless Tasks<br/>Auto-Scaling"]
        end
    end
    
    client --> api_gateway
    api_gateway --> lambda & azure_func & cloud_func
    lambda --> oltp
    azure_func --> nosql
    cloud_func --> oltp
    oltp --> glue
    nosql --> adf
    glue --> json
    adf --> json
    json --> hybrid
    hybrid --> vw_ops
    json --> vw_analytics
    serverless_tasks --> json
    
    style clients fill:#E8F4FD,stroke:#29B5E8
    style api fill:#FFE4B5,stroke:#FFA500
    style serverless_compute fill:#E6E6FA,stroke:#9370DB
    style transactional fill:#FFDAB9,stroke:#FF8C00
    style serverless_etl fill:#D8BFD8,stroke:#8B008B
    style snowflake fill:#E0F7FA,stroke:#00ACC1'
);


SELECT 'Extracted templates inserted: ' || COUNT(*) AS status
FROM ARCHITECTURE_TEMPLATES
WHERE template_id IN (
  'MEDALLION_LAKEHOUSE','MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY','STREAMING_DATA_STACK',
  'SECURITY_ANALYTICS','CUSTOMER_360','EMBEDDED_ANALYTICS','SERVERLESS_DATA_STACK'
);
