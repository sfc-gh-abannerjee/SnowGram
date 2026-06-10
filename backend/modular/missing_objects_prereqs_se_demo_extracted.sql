-- =====================================================================
-- SnowGram port: prerequisites + finish Section B backfill
-- =====================================================================
-- Resolves the 2 objects that FAILED on the target during backfill because
-- their prerequisites did not exist there:
--   CORE.SUGGEST_COMPONENTS_JSON   -> needs CORE.SUGGEST_COMPONENTS_FOR_USE_CASE
--   CORE.CLASSIFY_COMPONENT_LEARN  -> needs CORE.KNOWN_COMPONENT_CLASSIFICATIONS
--
-- Run as SYSADMIN (matches existing CORE object ownership).
-- Source: se_demo SNOWGRAM_DB.CORE (GET_DDL + data SELECT). Author: Abhinav Bannerjee
--
-- NOTE: these are LEGACY/optional objects (not used by the live deployed agent).
--       Deploy only if you want the old suggest/classify paths.
-- =====================================================================

USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

-- ---------------------------------------------------------------------
-- PREREQ 1: SUGGEST_COMPONENTS_FOR_USE_CASE (table function)
-- Depends on CORE.COMPONENTS (must already exist on target).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "SUGGEST_COMPONENTS_FOR_USE_CASE"("USER_DESCRIPTION" VARCHAR)
RETURNS TABLE ("COMPONENT_ID" VARCHAR, "COMPONENT_NAME" VARCHAR, "DESCRIPTION" VARCHAR, "CONFIDENCE_SCORE" FLOAT, "REASONING" VARCHAR)
LANGUAGE SQL
COMMENT='AI-powered component recommendations using dynamic entity extraction. No hardcoded patterns - automatically recognizes any external source in COMPONENTS table.'
AS '
    WITH 
    -- STEP 1: Detect architectural patterns (medallion, lakehouse, etc.)
    pattern_detection AS (
        SELECT 
            CASE 
                WHEN LOWER(user_description) LIKE ''%medallion%'' 
                  OR LOWER(user_description) LIKE ''%lakehouse%''
                  OR LOWER(user_description) LIKE ''%bronze%silver%gold%''
                  OR LOWER(user_description) LIKE ''%data layers%''
                THEN TRUE 
                ELSE FALSE 
            END AS is_medallion_request
    ),
    
    -- STEP 2: AI-powered entity extraction (TRULY DYNAMIC - no hardcoding!)
    ai_extracted_sources AS (
        SELECT 
            TRY_PARSE_JSON(
                REGEXP_REPLACE(
                    REGEXP_REPLACE(
                        SNOWFLAKE.CORTEX.COMPLETE(
                            ''claude-sonnet-4-5'',
                            ''Extract ONLY the external data sources, tools, or platforms EXPLICITLY mentioned by the user.
Return a JSON array of lowercase keywords. If none mentioned, return empty array [].

User request: "'' || user_description || ''"

Examples:
- "medallion with kafka" → ["kafka"]
- "S3 to Snowflake pipeline" → ["s3"]
- "data from Azure and Kafka" → ["azure", "kafka"]
- "simple medallion architecture" → []

Return ONLY the JSON array, no other text.''
                        ),
                        ''```json\\\\s*'', ''''
                    ),
                    ''\\\\s*```'', ''''
                )
            ) AS extracted_sources
    ),
    
    -- STEP 3: Dynamic matching against COMPONENTS table (no hardcoded component IDs!)
    dynamically_matched_externals AS (
        SELECT DISTINCT c.component_id
        FROM SNOWGRAM_DB.CORE.COMPONENTS c, ai_extracted_sources e
        WHERE c.type_category = ''external''
        AND e.extracted_sources IS NOT NULL
        AND ARRAY_SIZE(e.extracted_sources) > 0
        AND EXISTS (
            SELECT 1 FROM LATERAL FLATTEN(input => e.extracted_sources) f
            WHERE LOWER(c.component_name) LIKE ''%'' || LOWER(f.value::VARCHAR) || ''%''
               OR LOWER(c.component_id) LIKE ''%'' || LOWER(f.value::VARCHAR) || ''%''
               OR LOWER(c.description) LIKE ''%'' || LOWER(f.value::VARCHAR) || ''%''
        )
    ),
    
    -- STEP 4: Build component list with dynamic external filtering
    component_list AS (
        SELECT 
            c.component_id,
            c.component_name,
            c.component_type,
            c.type_category,
            c.description
        FROM SNOWGRAM_DB.CORE.COMPONENTS c, pattern_detection pd
        WHERE 
            -- For medallion requests: EXCLUDE primitive storage components
            (pd.is_medallion_request = FALSE OR c.component_type NOT IN (''DATABASE'', ''SCHEMA'', ''TABLE'', ''VIEW''))
            -- Exclude generic Stream/Task when medallion (use CDC Stream and Transform Task)
            AND (pd.is_medallion_request = FALSE OR c.component_id NOT IN (''sf_stream'', ''sf_task''))
            -- DYNAMIC external filtering: only include externals that were AI-matched
            AND (
                c.type_category != ''external'' 
                OR c.component_id IN (SELECT component_id FROM dynamically_matched_externals)
            )
            -- Exclude Snowpipe if no external sources were extracted
            AND NOT (
                c.component_type = ''PIPE'' 
                AND NOT EXISTS (SELECT 1 FROM dynamically_matched_externals)
            )
    ),
    
    -- STEP 5: AI relevance analysis (unchanged from before)
    ai_analysis AS (
        SELECT
            c.component_id,
            c.component_name,
            c.description,
            SNOWFLAKE.CORTEX.COMPLETE(
                ''claude-sonnet-4-5'',
                CONCAT(
                    ''User requirement: "'', user_description, ''"

Component: '', c.component_name, ''
Type: '', c.component_type, ''  
Description: '', c.description, ''

Respond with ONLY raw JSON (no markdown, no code blocks):
{"relevant": true/false, "confidence": 0.0-1.0, "reasoning": "brief explanation"}''
                )
            ) AS ai_response
        FROM component_list c
    ),
    cleaned_responses AS (
        SELECT 
            component_id,
            component_name,
            description,
            REGEXP_REPLACE(REGEXP_REPLACE(ai_response, ''^```json\\\\s*'', ''''), ''\\\\s*```$'', '''') AS cleaned_json
        FROM ai_analysis
    ),
    parsed_results AS (
        SELECT 
            component_id,
            component_name,
            description,
            TRY_PARSE_JSON(cleaned_json) AS parsed_json
        FROM cleaned_responses
    )
    SELECT 
        component_id,
        component_name,
        description,
        parsed_json:confidence::FLOAT AS confidence_score,
        parsed_json:reasoning::VARCHAR AS reasoning
    FROM parsed_results
    WHERE parsed_json IS NOT NULL
        AND parsed_json:relevant::BOOLEAN = TRUE
        AND parsed_json:confidence::FLOAT >= 0.5
    ORDER BY confidence_score DESC
    LIMIT 10
';;

-- ---------------------------------------------------------------------
-- PREREQ 2: KNOWN_COMPONENT_CLASSIFICATIONS (table) + 131 verified rows
-- The classification cache CLASSIFY_COMPONENT_LEARN reads first.
-- ---------------------------------------------------------------------
create or replace TABLE KNOWN_COMPONENT_CLASSIFICATIONS (
	COMPONENT_NAME VARCHAR(16777216) NOT NULL,
	COMPONENT_NAME_NORMALIZED VARCHAR(16777216) NOT NULL,
	FLOW_STAGE VARCHAR(16777216) NOT NULL,
	FLOW_STAGE_ORDER NUMBER(38,0) NOT NULL,
	FLOW_TIER VARCHAR(16777216) NOT NULL,
	SUGGESTED_ICON VARCHAR(16777216),
	CATEGORY VARCHAR(16777216),
	VERIFIED BOOLEAN DEFAULT TRUE,
	CREATED_AT TIMESTAMP_NTZ(9) DEFAULT CURRENT_TIMESTAMP(),
	primary key (COMPONENT_NAME_NORMALIZED)
);;

INSERT INTO SNOWGRAM_DB.CORE.KNOWN_COMPONENT_CLASSIFICATIONS
  (COMPONENT_NAME, COMPONENT_NAME_NORMALIZED, FLOW_STAGE, FLOW_STAGE_ORDER, FLOW_TIER, SUGGESTED_ICON, CATEGORY, VERIFIED)
VALUES
  ('Kafka', 'kafka', 'source', 0, 'external', 'kafka', 'streaming', TRUE),
  ('Apache Kafka', 'apachekafka', 'source', 0, 'external', 'kafka', 'streaming', TRUE),
  ('AWS S3', 'awss3', 'source', 0, 'external', 's3', 'cloud_storage', TRUE),
  ('S3', 's3', 'source', 0, 'external', 's3', 'cloud_storage', TRUE),
  ('Azure Blob', 'azureblob', 'source', 0, 'external', 'azure', 'cloud_storage', TRUE),
  ('Azure Data Lake', 'azuredatalake', 'source', 0, 'external', 'azure', 'cloud_storage', TRUE),
  ('GCS', 'gcs', 'source', 0, 'external', 'gcp', 'cloud_storage', TRUE),
  ('Google Cloud Storage', 'googlecloudstorage', 'source', 0, 'external', 'gcp', 'cloud_storage', TRUE),
  ('PostgreSQL', 'postgresql', 'source', 0, 'external', 'database', 'database', TRUE),
  ('MySQL', 'mysql', 'source', 0, 'external', 'database', 'database', TRUE),
  ('Oracle', 'oracle', 'source', 0, 'external', 'database', 'database', TRUE),
  ('SQL Server', 'sqlserver', 'source', 0, 'external', 'database', 'database', TRUE),
  ('MongoDB', 'mongodb', 'source', 0, 'external', 'database', 'database', TRUE),
  ('Salesforce', 'salesforce', 'source', 0, 'external', 'salesforce', 'saas', TRUE),
  ('HubSpot', 'hubspot', 'source', 0, 'external', 'hubspot', 'saas', TRUE),
  ('Stripe', 'stripe', 'source', 0, 'external', 'stripe', 'saas', TRUE),
  ('Shopify', 'shopify', 'source', 0, 'external', 'shopify', 'saas', TRUE),
  ('REST API', 'restapi', 'source', 0, 'external', 'api', 'api', TRUE),
  ('Webhook', 'webhook', 'source', 0, 'external', 'webhook', 'api', TRUE),
  ('Snowpipe', 'snowpipe', 'ingest', 1, 'snowflake', 'snowpipe', 'native', TRUE),
  ('Fivetran', 'fivetran', 'ingest', 1, 'external', 'fivetran', 'etl', TRUE),
  ('Airbyte', 'airbyte', 'ingest', 1, 'external', 'airbyte', 'etl', TRUE),
  ('Stitch', 'stitch', 'ingest', 1, 'external', 'stitch', 'etl', TRUE),
  ('Matillion', 'matillion', 'ingest', 1, 'external', 'matillion', 'etl', TRUE),
  ('AWS Glue', 'awsglue', 'ingest', 1, 'external', 'aws', 'etl', TRUE),
  ('Azure Data Factory', 'azuredatafactory', 'ingest', 1, 'external', 'azure', 'etl', TRUE),
  ('Talend', 'talend', 'ingest', 1, 'external', 'talend', 'etl', TRUE),
  ('Informatica', 'informatica', 'ingest', 1, 'external', 'informatica', 'etl', TRUE),
  ('Raw Layer', 'rawlayer', 'raw', 2, 'snowflake', 'table', 'storage', TRUE),
  ('Bronze Layer', 'bronzelayer', 'raw', 2, 'snowflake', 'table', 'storage', TRUE),
  ('Landing Zone', 'landingzone', 'raw', 2, 'snowflake', 'table', 'storage', TRUE),
  ('Staging', 'staging', 'raw', 2, 'snowflake', 'table', 'storage', TRUE),
  ('Stage', 'stage', 'raw', 2, 'snowflake', 'stage', 'storage', TRUE),
  ('dbt', 'dbt', 'transform', 3, 'external', 'dbt', 'transform', TRUE),
  ('dbt Cloud', 'dbtcloud', 'transform', 3, 'external', 'dbt', 'transform', TRUE),
  ('Snowpark', 'snowpark', 'transform', 3, 'snowflake', 'snowpark', 'transform', TRUE),
  ('Apache Spark', 'apachespark', 'transform', 3, 'external', 'spark', 'transform', TRUE),
  ('Databricks', 'databricks', 'transform', 3, 'external', 'databricks', 'transform', TRUE),
  ('Silver Layer', 'silverlayer', 'transform', 3, 'snowflake', 'table', 'storage', TRUE),
  ('Task', 'task', 'transform', 3, 'snowflake', 'task', 'native', TRUE),
  ('Stream', 'stream', 'transform', 3, 'snowflake', 'stream', 'native', TRUE),
  ('Dynamic Table', 'dynamictable', 'transform', 3, 'snowflake', 'dynamic-table', 'native', TRUE),
  ('Stored Procedure', 'storedprocedure', 'transform', 3, 'snowflake', 'procedure', 'native', TRUE),
  ('Gold Layer', 'goldlayer', 'refined', 4, 'snowflake', 'table', 'storage', TRUE),
  ('Data Mart', 'datamart', 'refined', 4, 'snowflake', 'table', 'storage', TRUE),
  ('Curated', 'curated', 'refined', 4, 'snowflake', 'table', 'storage', TRUE),
  ('Semantic Layer', 'semanticlayer', 'refined', 4, 'snowflake', 'semantic', 'storage', TRUE),
  ('Warehouse', 'warehouse', 'serve', 5, 'snowflake', 'warehouse', 'native', TRUE),
  ('Virtual Warehouse', 'virtualwarehouse', 'serve', 5, 'snowflake', 'warehouse', 'native', TRUE),
  ('View', 'view', 'serve', 5, 'snowflake', 'view', 'native', TRUE),
  ('Materialized View', 'materializedview', 'serve', 5, 'snowflake', 'view', 'native', TRUE),
  ('Cortex', 'cortex', 'serve', 5, 'snowflake', 'cortex', 'native', TRUE),
  ('Snowflake API', 'snowflakeapi', 'serve', 5, 'snowflake', 'api', 'native', TRUE),
  ('Tableau', 'tableau', 'consume', 6, 'external', 'tableau', 'bi', TRUE),
  ('PowerBI', 'powerbi', 'consume', 6, 'external', 'powerbi', 'bi', TRUE),
  ('Power BI', 'powerbi', 'consume', 6, 'external', 'powerbi', 'bi', TRUE),
  ('Looker', 'looker', 'consume', 6, 'external', 'looker', 'bi', TRUE),
  ('Sigma', 'sigma', 'consume', 6, 'external', 'sigma', 'bi', TRUE),
  ('ThoughtSpot', 'thoughtspot', 'consume', 6, 'external', 'thoughtspot', 'bi', TRUE),
  ('Metabase', 'metabase', 'consume', 6, 'external', 'metabase', 'bi', TRUE),
  ('Superset', 'superset', 'consume', 6, 'external', 'superset', 'bi', TRUE),
  ('Streamlit', 'streamlit', 'consume', 6, 'snowflake', 'streamlit', 'app', TRUE),
  ('Hex', 'hex', 'consume', 6, 'external', 'hex', 'notebook', TRUE),
  ('Mode', 'mode', 'consume', 6, 'external', 'mode', 'bi', TRUE),
  ('Preset', 'preset', 'consume', 6, 'external', 'preset', 'bi', TRUE),
  ('Excel', 'excel', 'consume', 6, 'external', 'excel', 'spreadsheet', TRUE),
  ('Google Sheets', 'googlesheets', 'consume', 6, 'external', 'sheets', 'spreadsheet', TRUE),
  ('Jupyter', 'jupyter', 'consume', 6, 'external', 'jupyter', 'notebook', TRUE),
  ('Python', 'python', 'consume', 6, 'external', 'python', 'code', TRUE),
  ('Segment', 'segment', 'source', 0, 'external', 'segment', 'cdp', TRUE),
  ('Snowflake Polaris', 'snowflakepolaris', 'serve', 5, 'snowflake', 'database-with-magnifying-glass', 'auto-learned', FALSE),
  ('Apache Iceberg', 'apacheiceberg', 'raw', 2, 'external', 'storage', 'auto-learned', FALSE),
  ('Delta Lake', 'deltalake', 'raw', 2, 'external', 'storage-container', 'auto-learned', FALSE),
  ('Databricks Unity Catalog', 'databricksunitycatalog', 'serve', 5, 'external', 'governance-shield', 'auto-learned', FALSE),
  ('Apache Flink', 'apacheflink', 'transform', 3, 'external', 'mdi:stream', 'auto-learned', FALSE),
  ('MLflow', 'mlflow', 'transform', 3, 'external', 'mlflow', 'ml', TRUE),
  ('SageMaker', 'sagemaker', 'transform', 3, 'external', 'sagemaker', 'ml', TRUE),
  ('Vertex AI', 'vertexai', 'transform', 3, 'external', 'vertex-ai', 'ml', TRUE),
  ('Feature Store', 'featurestore', 'refined', 4, 'hybrid', 'feature-store', 'ml', TRUE),
  ('Model Registry', 'modelregistry', 'refined', 4, 'hybrid', 'model-registry', 'ml', TRUE),
  ('Kubeflow', 'kubeflow', 'transform', 3, 'external', 'kubeflow', 'ml', TRUE),
  ('Airflow', 'airflow', 'transform', 3, 'external', 'airflow', 'orchestration', TRUE),
  ('Apache Airflow', 'apacheairflow', 'transform', 3, 'external', 'airflow', 'orchestration', TRUE),
  ('Dagster', 'dagster', 'transform', 3, 'external', 'dagster', 'orchestration', TRUE),
  ('Prefect', 'prefect', 'transform', 3, 'external', 'prefect', 'orchestration', TRUE),
  ('Luigi', 'luigi', 'transform', 3, 'external', 'luigi', 'orchestration', TRUE),
  ('Argo Workflows', 'argoworkflows', 'transform', 3, 'external', 'argo', 'orchestration', TRUE),
  ('Debezium', 'debezium', 'ingest', 1, 'external', 'debezium', 'cdc', TRUE),
  ('Qlik Replicate', 'qlikreplicate', 'ingest', 1, 'external', 'qlik', 'cdc', TRUE),
  ('Attunity', 'attunity', 'ingest', 1, 'external', 'attunity', 'cdc', TRUE),
  ('HVR', 'hvr', 'ingest', 1, 'external', 'hvr', 'cdc', TRUE),
  ('StreamSets', 'streamsets', 'ingest', 1, 'external', 'streamsets', 'cdc', TRUE),
  ('Oracle GoldenGate', 'oraclegoldengate', 'ingest', 1, 'external', 'goldengate', 'cdc', TRUE),
  ('Great Expectations', 'greatexpectations', 'transform', 3, 'external', 'great-expectations', 'data_quality', TRUE),
  ('Soda', 'soda', 'transform', 3, 'external', 'soda', 'data_quality', TRUE),
  ('Monte Carlo', 'montecarlo', 'serve', 5, 'external', 'monte-carlo', 'data_quality', TRUE),
  ('Anomalo', 'anomalo', 'serve', 5, 'external', 'anomalo', 'data_quality', TRUE),
  ('dbt Tests', 'dbttests', 'transform', 3, 'hybrid', 'dbt-tests', 'data_quality', TRUE),
  ('Alation', 'alation', 'serve', 5, 'external', 'alation', 'governance', TRUE),
  ('Collibra', 'collibra', 'serve', 5, 'external', 'collibra', 'governance', TRUE),
  ('Atlan', 'atlan', 'serve', 5, 'external', 'atlan', 'governance', TRUE),
  ('DataHub', 'datahub', 'serve', 5, 'external', 'datahub', 'governance', TRUE),
  ('Apache Atlas', 'apacheatlas', 'serve', 5, 'external', 'atlas', 'governance', TRUE),
  ('Purview', 'purview', 'serve', 5, 'external', 'purview', 'governance', TRUE),
  ('Apache Pulsar', 'apachepulsar', 'source', 0, 'external', 'pulsar', 'streaming', TRUE),
  ('Amazon Kinesis', 'amazonkinesis', 'source', 0, 'external', 'kinesis', 'streaming', TRUE),
  ('Kinesis', 'kinesis', 'source', 0, 'external', 'kinesis', 'streaming', TRUE),
  ('Azure Event Hub', 'azureeventhub', 'source', 0, 'external', 'event-hub', 'streaming', TRUE),
  ('Event Hub', 'eventhub', 'source', 0, 'external', 'event-hub', 'streaming', TRUE),
  ('Confluent', 'confluent', 'source', 0, 'external', 'confluent', 'streaming', TRUE),
  ('Confluent Cloud', 'confluentcloud', 'source', 0, 'external', 'confluent', 'streaming', TRUE),
  ('Apache Hudi', 'apachehudi', 'raw', 2, 'external', 'hudi', 'lakehouse', TRUE),
  ('Trino', 'trino', 'serve', 5, 'external', 'trino', 'query_engine', TRUE),
  ('Presto', 'presto', 'serve', 5, 'external', 'presto', 'query_engine', TRUE),
  ('Dremio', 'dremio', 'serve', 5, 'external', 'dremio', 'query_engine', TRUE),
  ('Starburst', 'starburst', 'serve', 5, 'external', 'starburst', 'query_engine', TRUE),
  ('Census', 'census', 'serve', 5, 'external', 'census', 'reverse_etl', TRUE),
  ('Hightouch', 'hightouch', 'serve', 5, 'external', 'hightouch', 'reverse_etl', TRUE),
  ('Polytomic', 'polytomic', 'serve', 5, 'external', 'polytomic', 'reverse_etl', TRUE),
  ('Omnata', 'omnata', 'serve', 5, 'snowflake', 'omnata', 'reverse_etl', TRUE),
  ('Reverse ETL', 'reverseetl', 'serve', 5, 'hybrid', 'reverse-etl', 'reverse_etl', TRUE),
  ('Databricks Notebooks', 'databricksnotebooks', 'transform', 3, 'external', 'databricks-notebook', 'notebook', TRUE),
  ('Zeppelin', 'zeppelin', 'transform', 3, 'external', 'zeppelin', 'notebook', TRUE),
  ('Colab', 'colab', 'transform', 3, 'external', 'colab', 'notebook', TRUE),
  ('Retool', 'retool', 'consume', 6, 'external', 'retool', 'data_app', TRUE),
  ('Airplane', 'airplane', 'consume', 6, 'external', 'airplane', 'data_app', TRUE),
  ('Zendesk', 'zendesk', 'source', 0, 'external', 'zendesk', 'saas', TRUE),
  ('Marketo', 'marketo', 'source', 0, 'external', 'marketo', 'saas', TRUE),
  ('Netsuite', 'netsuite', 'source', 0, 'external', 'netsuite', 'saas', TRUE),
  ('Workday', 'workday', 'source', 0, 'external', 'workday', 'saas', TRUE),
  ('ServiceNow', 'servicenow', 'source', 0, 'external', 'servicenow', 'saas', TRUE);

-- ---------------------------------------------------------------------
-- NOW the two previously-failed objects can be created.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "SUGGEST_COMPONENTS_JSON"("USER_DESCRIPTION" VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
COMMENT='Wrapper for SUGGEST_COMPONENTS_FOR_USE_CASE that returns JSON array for agent tool use'
AS '
    SELECT ARRAY_AGG(
        OBJECT_CONSTRUCT(
            ''component_id'', COMPONENT_ID,
            ''component_name'', COMPONENT_NAME,
            ''description'', DESCRIPTION,
            ''confidence_score'', CONFIDENCE_SCORE,
            ''reasoning'', REASONING
        )
    )::VARCHAR
    FROM TABLE(SNOWGRAM_DB.CORE.SUGGEST_COMPONENTS_FOR_USE_CASE(user_description))
';;

CREATE OR REPLACE FUNCTION "CLASSIFY_COMPONENT_LEARN"("COMPONENT_NAME" VARCHAR, "MODEL_NAME" VARCHAR DEFAULT 'openai-gpt-5.1', "AUTO_CACHE" BOOLEAN DEFAULT TRUE)
RETURNS VARIANT
LANGUAGE SQL
AS '
  -- First check cache
  COALESCE(
    -- Try cache lookup (instant, free)
    (SELECT TO_VARIANT(OBJECT_CONSTRUCT(
        ''flow_stage'', flow_stage,
        ''flow_stage_order'', flow_stage_order,
        ''flow_tier'', flow_tier,
        ''suggested_icon'', suggested_icon,
        ''source'', ''cache''
      ))
     FROM SNOWGRAM_DB.CORE.KNOWN_COMPONENT_CLASSIFICATIONS
     WHERE component_name_normalized = LOWER(REGEXP_REPLACE(component_name, ''[^a-zA-Z0-9]'', ''''))
     LIMIT 1),
    
    -- Fallback: LLM classification (result will be cached via trigger/procedure)
    (SELECT TO_VARIANT(OBJECT_INSERT(
        TRY_PARSE_JSON(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                SNOWFLAKE.CORTEX.COMPLETE(
                  model_name,
                  ''Classify this data architecture component into ONE lifecycle stage.

Component: '' || component_name || ''

LIFECYCLE STAGES (choose exactly one):
- source (0): External data origins - databases, APIs, SaaS apps, files, streams
- ingest (1): Data ingestion tools - Snowpipe, Fivetran, Airbyte, connectors
- raw (2): Raw/landing storage - Bronze layer, staging, landing zone
- transform (3): Processing/transformation - dbt, Snowpark, ELT, Silver layer
- refined (4): Curated business data - Gold layer, data marts, semantic layer
- serve (5): Data serving - Warehouses, views, Cortex, APIs
- consume (6): End-user tools - BI dashboards, notebooks, apps, reports

FLOW TIERS:
- external: Outside Snowflake (S3, Kafka, Tableau, etc.)
- snowflake: Native Snowflake objects (Warehouse, Table, Stream, etc.)
- hybrid: Bridges both (Snowpipe, External Tables, etc.)

Return ONLY valid JSON:
{"flow_stage": "stage_name", "flow_stage_order": 0-6, "flow_tier": "tier", "suggested_icon": "icon_name"}''
                ),
                ''^[^{]*'', ''''
              ),
              ''[^}]*$'', ''''
            ),
            ''.*?(\\\\{[^}]+\\\\}).*'', ''$1''
          )
        ),
        ''source'', ''llm''
      ))
    )
  )
';;

-- ---------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------
SELECT 'KNOWN_COMPONENT_CLASSIFICATIONS rows: ' || COUNT(*) FROM SNOWGRAM_DB.CORE.KNOWN_COMPONENT_CLASSIFICATIONS;
