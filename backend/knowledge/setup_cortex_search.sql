-- =====================================================
-- Cortex Search Service Setup
-- =====================================================
-- Purpose: Create Cortex Search service for RAG over Snowflake documentation
-- =====================================================

USE ROLE SYSADMIN;
USE DATABASE SNOWGRAM_DB;
USE SCHEMA KNOWLEDGE;

-- Dedicated XS warehouse for Cortex Search indexing to avoid pinning shared compute
CREATE WAREHOUSE IF NOT EXISTS CORTEX_REFRESH_WH
    WAREHOUSE_SIZE = 'XSMALL'
    AUTO_SUSPEND = 60
    AUTO_RESUME = TRUE
    INITIALLY_SUSPENDED = TRUE
    COMMENT = 'Low-cost warehouse reserved for Cortex Search / dynamic table refreshes';

ALTER WAREHOUSE CORTEX_REFRESH_WH SET
    AUTO_SUSPEND = 60,
    AUTO_RESUME = TRUE,
    WAREHOUSE_SIZE = 'XSMALL';

GRANT USAGE ON WAREHOUSE CORTEX_REFRESH_WH TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON WAREHOUSE CORTEX_REFRESH_WH TO ROLE SVC_CURSOR_ROLE;

-- =====================================================
-- 1. Create Cortex Search Service
-- =====================================================

-- This service enables semantic search over Snowflake documentation
-- for RAG (Retrieval Augmented Generation) in the Cortex Agent

CREATE OR REPLACE CORTEX SEARCH SERVICE SNOWFLAKE_DOCS_SEARCH
  ON chunk
  ATTRIBUTES category, document_title, source_url, doc_type
  WAREHOUSE = CORTEX_REFRESH_WH
  TARGET_LAG = '1 day'
  AS (
    SELECT 
      chunk,
      document_title,
      source_url,
      category,
      doc_type
    FROM SNOWGRAM_DB.KNOWLEDGE.SNOWFLAKE_DOCUMENTATION
    WHERE chunk IS NOT NULL
      AND LENGTH(chunk) > 50  -- Filter out very short chunks
  );

COMMENT ON CORTEX SEARCH SERVICE SNOWFLAKE_DOCS_SEARCH IS 
  'Cortex Search service for semantic search over Snowflake documentation. Used for RAG in SnowGram Cortex Agent.';

-- =====================================================
-- 2. Grant Access to Cortex Search Service
-- =====================================================

-- Grant usage on Cortex Search service to application role
GRANT USAGE ON CORTEX SEARCH SERVICE SNOWFLAKE_DOCS_SEARCH TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON CORTEX SEARCH SERVICE SNOWFLAKE_DOCS_SEARCH TO ROLE SVC_CURSOR_ROLE;

-- =====================================================
-- 3. Test Cortex Search Service
-- =====================================================

-- Test query 1: Search for Snowpipe documentation
SELECT 
    snowflake.cortex.search_preview(
        'SNOWGRAM_DB.KNOWLEDGE.SNOWFLAKE_DOCS_SEARCH',
        OBJECT_CONSTRUCT(
            'query', 'How do I create a Snowpipe for automatic data loading?',
            'columns', ARRAY_CONSTRUCT('chunk', 'document_title', 'source_url', 'category'),
            'limit', 3
        )
    ) AS search_results;

-- Test query 2: Search for Cortex Agent documentation
SELECT 
    snowflake.cortex.search_preview(
        'SNOWGRAM_DB.KNOWLEDGE.SNOWFLAKE_DOCS_SEARCH',
        OBJECT_CONSTRUCT(
            'query', 'What are Cortex Agents and how do I configure custom tools?',
            'columns', ARRAY_CONSTRUCT('chunk', 'document_title', 'source_url'),
            'filter', OBJECT_CONSTRUCT('@eq', OBJECT_CONSTRUCT('doc_type', 'official_docs')),
            'limit', 5
        )
    ) AS search_results;

-- Test query 3: Search for Stream and Task documentation
SELECT 
    snowflake.cortex.search_preview(
        'SNOWGRAM_DB.KNOWLEDGE.SNOWFLAKE_DOCS_SEARCH',
        OBJECT_CONSTRUCT(
            'query', 'How do Streams and Tasks work together for CDC pipelines?',
            'columns', ARRAY_CONSTRUCT('chunk', 'document_title', 'category'),
            'limit', 3
        )
    ) AS search_results;

-- =====================================================
-- 4. Stored Procedure: Query Cortex Search
-- =====================================================

-- Helper stored procedure for querying Cortex Search from application code

CREATE OR REPLACE PROCEDURE QUERY_SNOWFLAKE_DOCS(
    query_text VARCHAR,
    max_results INTEGER
)
RETURNS VARIANT
LANGUAGE SQL
AS
$$
DECLARE
    search_result VARIANT;
BEGIN
    SELECT 
        snowflake.cortex.search_preview(
            'SNOWGRAM_DB.KNOWLEDGE.SNOWFLAKE_DOCS_SEARCH',
            OBJECT_CONSTRUCT(
                'query', :query_text,
                'columns', ARRAY_CONSTRUCT('chunk', 'document_title', 'source_url', 'category', 'doc_type'),
                'limit', :max_results
            )
        )
    INTO :search_result;
    
    RETURN search_result;
END;
$$;

COMMENT ON PROCEDURE QUERY_SNOWFLAKE_DOCS IS 
  'Helper procedure to query Cortex Search service for Snowflake documentation. Returns top results as JSON.';

-- Grant execution permission
GRANT USAGE ON PROCEDURE QUERY_SNOWFLAKE_DOCS(VARCHAR, INTEGER) TO ROLE SNOWGRAM_APP_ROLE;

-- Test the stored procedure
CALL QUERY_SNOWFLAKE_DOCS('What is a semantic model in Cortex Analyst?', 3);

-- =====================================================
-- 5. View for Monitoring Cortex Search Service
-- =====================================================

-- Create view to monitor Cortex Search service status and performance
CREATE OR REPLACE VIEW CORTEX_SEARCH_STATUS AS
SELECT 
    'SNOWFLAKE_DOCS_SEARCH' AS service_name,
    CURRENT_TIMESTAMP() AS checked_at,
    'Active' AS status  -- Placeholder; would need SHOW CORTEX SEARCH SERVICES for real status
FROM DUAL;

SELECT * FROM CORTEX_SEARCH_STATUS;

-- =====================================================
-- 6. Refresh Cortex Search Service (Manual)
-- =====================================================

-- To manually refresh the Cortex Search service:
-- ALTER CORTEX SEARCH SERVICE SNOWFLAKE_DOCS_SEARCH REFRESH;

-- To suspend indexing (save costs):
-- ALTER CORTEX SEARCH SERVICE SNOWFLAKE_DOCS_SEARCH SUSPEND INDEXING;

-- To resume indexing:
-- ALTER CORTEX SEARCH SERVICE SNOWFLAKE_DOCS_SEARCH RESUME INDEXING;

-- To suspend serving (stop queries):
-- ALTER CORTEX SEARCH SERVICE SNOWFLAKE_DOCS_SEARCH SUSPEND SERVING;

-- To resume serving:
-- ALTER CORTEX SEARCH SERVICE SNOWFLAKE_DOCS_SEARCH RESUME SERVING;

SELECT 'Cortex Search service setup complete!' AS status;
SELECT 'Service name: SNOWFLAKE_DOCS_SEARCH' AS info;
SELECT 'Ready for RAG queries via Cortex Agent' AS ready;






