-- =====================================================
-- Test SnowGram Cortex Agent
-- =====================================================
-- Purpose: Validate agent functionality with example queries
-- =====================================================

USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;
USE ROLE SVC_CURSOR_ROLE;
USE WAREHOUSE COMPUTE_WH;

-- =====================================================
-- Test 1: Simple S3 Ingestion Pipeline
-- =====================================================

SELECT 
    'Test 1: S3 Ingestion' AS test_name,
    SNOWFLAKE.CORTEX.COMPLETE(
        'SNOWGRAM_AGENT',
        'Create a simple S3 to Snowflake data ingestion pipeline'
    ) AS agent_response;

-- =====================================================
-- Test 2: Real-Time IoT Pipeline
-- =====================================================

SELECT 
    'Test 2: IoT Pipeline' AS test_name,
    SNOWFLAKE.CORTEX.COMPLETE(
        'SNOWGRAM_AGENT',
        'Show me a real-time IoT pipeline with Kafka streaming into Snowflake'
    ) AS agent_response;

-- =====================================================
-- Test 3: Enterprise Data Warehouse
-- =====================================================

SELECT 
    'Test 3: Data Warehouse' AS test_name,
    SNOWFLAKE.CORTEX.COMPLETE(
        'SNOWGRAM_AGENT',
        'Create an enterprise data warehouse architecture with batch ingestion from S3'
    ) AS agent_response;

-- =====================================================
-- Test 4: Multi-Cloud Data Mesh
-- =====================================================

SELECT 
    'Test 4: Data Mesh' AS test_name,
    SNOWFLAKE.CORTEX.COMPLETE(
        'SNOWGRAM_AGENT',
        'Build a multi-cloud data mesh architecture with Azure and AWS'
    ) AS agent_response;

-- =====================================================
-- Test 5: Financial Transactions Pipeline
-- =====================================================

SELECT 
    'Test 5: Financial Pipeline' AS test_name,
    SNOWFLAKE.CORTEX.COMPLETE(
        'SNOWGRAM_AGENT',
        'Design a real-time financial transactions processing pipeline'
    ) AS agent_response;

-- =====================================================
-- Test 6: Machine Learning Feature Pipeline
-- =====================================================

SELECT 
    'Test 6: ML Pipeline' AS test_name,
    SNOWFLAKE.CORTEX.COMPLETE(
        'SNOWGRAM_AGENT',
        'Create a machine learning feature engineering pipeline with model training'
    ) AS agent_response;

-- =====================================================
-- Test 7: Stream + Task Transformation
-- =====================================================

SELECT 
    'Test 7: Stream + Task' AS test_name,
    SNOWFLAKE.CORTEX.COMPLETE(
        'SNOWGRAM_AGENT',
        'Show me a data transformation pipeline using Streams and Tasks'
    ) AS agent_response;

-- =====================================================
-- Validation Queries
-- =====================================================

-- Check if agent is using custom tools
SELECT 
    'Tool Usage Check' AS check_name,
    SNOWFLAKE.CORTEX.COMPLETE(
        'SNOWGRAM_AGENT',
        'Search for component blocks related to Kafka'
    ) AS agent_response;

-- Check if agent can access patterns
SELECT 
    'Pattern Check' AS check_name,
    SNOWFLAKE.CORTEX.COMPLETE(
        'SNOWGRAM_AGENT',
        'What patterns are available for streaming ingestion?'
    ) AS agent_response;

-- Check if agent can access templates
SELECT 
    'Template Check' AS check_name,
    SNOWFLAKE.CORTEX.COMPLETE(
        'SNOWGRAM_AGENT',
        'Show me a full template for real-time IoT'
    ) AS agent_response;

-- =====================================================
-- Performance Test
-- =====================================================

-- Measure response time
SET start_time = CURRENT_TIMESTAMP();

SELECT SNOWFLAKE.CORTEX.COMPLETE(
    'SNOWGRAM_AGENT',
    'Create a simple data warehouse diagram'
) AS response;

SET end_time = CURRENT_TIMESTAMP();

SELECT 
    DATEDIFF('millisecond', $start_time, $end_time) AS response_time_ms,
    CASE 
        WHEN response_time_ms < 5000 THEN '✅ Fast (<5s)'
        WHEN response_time_ms < 10000 THEN '⚠️ Acceptable (5-10s)'
        ELSE '❌ Slow (>10s)'
    END AS performance_rating;

-- =====================================================
-- Expected Results
-- =====================================================

-- Each test should return:
-- 1. Valid Mermaid flowchart code
-- 2. Explanation of the diagram
-- 3. List of components used
-- 4. Response time < 10 seconds (ideally < 5s)
--
-- Validation:
-- - Mermaid code should start with "flowchart LR" (or TD/BT/RL)
-- - Should include valid node definitions
-- - Should include connections with arrows
-- - Should have Snowflake styling
--
-- If tests fail:
-- - Check agent creation succeeded
-- - Verify all custom tools are registered
-- - Ensure semantic models are accessible
-- - Check Cortex Search service is available
-- - Review system prompt for clarity

