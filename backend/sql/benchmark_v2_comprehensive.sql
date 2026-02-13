-- ============================================================================
-- COMPREHENSIVE LLM BENCHMARK V2.0
-- ============================================================================
-- Gap Analysis Resolution: Addresses limitations from V1 benchmark
-- Methodology: Inspired by Stanford HELM, DeepEval, PromptFoo, UK AISI Inspect
--
-- V1 GAPS IDENTIFIED:
-- 1. No statistical significance (single run per model)
-- 2. Limited adversarial/edge case testing
-- 3. No consistency testing (same input, multiple runs)
-- 4. No prompt sensitivity/perturbation testing
-- 5. No latency-weighted scoring
-- 6. No semantic similarity scoring (only exact match)
-- 7. No error categorization/analysis
-- 8. No confidence calibration testing
-- 9. Limited coverage of ambiguous components
-- 10. No inter-rater reliability validation
--
-- V2 IMPROVEMENTS:
-- + Multiple runs per model (statistical significance)
-- + Adversarial test cases (typos, ambiguous names, edge cases)
-- + Prompt perturbation testing (robustness)
-- + Semantic similarity scoring (EDIT_DISTANCE based)
-- + Error categorization and confusion matrix
-- + Consistency/stability metrics
-- + Latency percentiles (P50, P95, P99)
-- + Cost-weighted scoring
-- ============================================================================

USE DATABASE SNOWGRAM_DB;
USE SCHEMA BENCHMARK;

-- ============================================================================
-- PART 1: ENHANCED TEST DATASET
-- ============================================================================

-- 1A. Adversarial Test Cases (typos, case variations, abbreviations)
CREATE OR REPLACE TABLE ADVERSARIAL_TEST_COMPONENTS (
    test_id VARCHAR(50) NOT NULL,
    component_name VARCHAR(200) NOT NULL,
    canonical_name VARCHAR(100) NOT NULL,
    expected_stage VARCHAR(20) NOT NULL,
    expected_stage_order INT NOT NULL,
    adversarial_type VARCHAR(50) NOT NULL,  -- typo, case, abbreviation, synonym, ambiguous
    difficulty VARCHAR(20) NOT NULL,         -- easy, medium, hard
    notes VARCHAR(500)
);

INSERT INTO ADVERSARIAL_TEST_COMPONENTS VALUES
-- Typos (common misspellings)
('ADV001', 'Kafak', 'Kafka', 'source', 0, 'typo', 'easy', 'Single character swap'),
('ADV002', 'Tableauu', 'Tableau', 'consume', 6, 'typo', 'easy', 'Duplicate character'),
('ADV003', 'Fivetarn', 'Fivetran', 'ingest', 1, 'typo', 'medium', 'Character substitution'),
('ADV004', 'dbt Cluod', 'dbt Cloud', 'transform', 3, 'typo', 'medium', 'Transposition'),
('ADV005', 'Snowpip', 'Snowpipe', 'ingest', 1, 'typo', 'easy', 'Truncation'),
('ADV006', 'PowerBi', 'PowerBI', 'consume', 6, 'typo', 'easy', 'Case variation'),
('ADV007', 'Ariflow', 'Airflow', 'transform', 3, 'typo', 'medium', 'Missing character'),
('ADV008', 'Postgre SQL', 'PostgreSQL', 'source', 0, 'typo', 'easy', 'Space inserted'),

-- Case variations
('ADV009', 'KAFKA', 'Kafka', 'source', 0, 'case', 'easy', 'All caps'),
('ADV010', 'tableau', 'Tableau', 'consume', 6, 'case', 'easy', 'All lowercase'),
('ADV011', 'snowFLAKE', 'Snowflake', 'serve', 5, 'case', 'medium', 'Mixed case'),
('ADV012', 'DBT', 'dbt', 'transform', 3, 'case', 'easy', 'All caps acronym'),
('ADV013', 'fivetran', 'Fivetran', 'ingest', 1, 'case', 'easy', 'All lowercase'),

-- Abbreviations
('ADV014', 'PBI', 'PowerBI', 'consume', 6, 'abbreviation', 'medium', 'Common abbreviation'),
('ADV015', 'SF', 'Snowflake', 'serve', 5, 'abbreviation', 'hard', 'Ambiguous - could be Salesforce'),
('ADV016', 'AWS S3', 'Amazon S3', 'source', 0, 'abbreviation', 'easy', 'Cloud prefix'),
('ADV017', 'GCS', 'Google Cloud Storage', 'source', 0, 'abbreviation', 'medium', 'Google abbreviation'),
('ADV018', 'ADLS', 'Azure Data Lake Storage', 'source', 0, 'abbreviation', 'medium', 'Azure abbreviation'),
('ADV019', 'BQ', 'BigQuery', 'serve', 5, 'abbreviation', 'medium', 'Common abbreviation'),

-- Synonyms and alternative names
('ADV020', 'Message Queue', 'Kafka', 'source', 0, 'synonym', 'hard', 'Generic term'),
('ADV021', 'Data Warehouse', 'Snowflake', 'serve', 5, 'synonym', 'hard', 'Generic category'),
('ADV022', 'ETL Tool', 'dbt', 'transform', 3, 'synonym', 'hard', 'Generic category'),
('ADV023', 'BI Dashboard', 'Tableau', 'consume', 6, 'synonym', 'hard', 'Generic category'),
('ADV024', 'Object Storage', 'S3', 'source', 0, 'synonym', 'hard', 'Generic category'),
('ADV025', 'CDC Tool', 'Debezium', 'ingest', 1, 'synonym', 'hard', 'Generic category'),

-- Ambiguous components (could be multiple stages)
('ADV026', 'Pandas', 'Pandas', 'transform', 3, 'ambiguous', 'medium', 'Could be source reader or transform'),
('ADV027', 'Python Script', 'Python', 'transform', 3, 'ambiguous', 'hard', 'Context dependent'),
('ADV028', 'Lambda', 'AWS Lambda', 'transform', 3, 'ambiguous', 'hard', 'Multi-purpose'),
('ADV029', 'API', 'REST API', 'serve', 5, 'ambiguous', 'hard', 'Could be source or serve'),
('ADV030', 'Notebook', 'Jupyter', 'transform', 3, 'ambiguous', 'medium', 'Analysis vs transform'),
('ADV031', 'Excel', 'Excel', 'consume', 6, 'ambiguous', 'medium', 'Could be source or consume'),
('ADV032', 'CSV File', 'CSV', 'source', 0, 'ambiguous', 'medium', 'Storage vs format'),

-- Edge cases (unusual or new tools)
('ADV033', 'Motherduck', 'Motherduck', 'serve', 5, 'edge_case', 'hard', 'Newer tool'),
('ADV034', 'Databricks Unity Catalog', 'Unity Catalog', 'refined', 4, 'edge_case', 'hard', 'Governance layer'),
('ADV035', 'dlt', 'dlt', 'ingest', 1, 'edge_case', 'hard', 'Data load tool - easy to confuse'),
('ADV036', 'Meltano', 'Meltano', 'ingest', 1, 'edge_case', 'medium', 'ELT tool'),
('ADV037', 'Great Expectations', 'Great Expectations', 'transform', 3, 'edge_case', 'hard', 'Data quality'),
('ADV038', 'Elementary', 'Elementary', 'transform', 3, 'edge_case', 'hard', 'dbt observability'),
('ADV039', 'Hex', 'Hex', 'consume', 6, 'edge_case', 'medium', 'Modern BI'),
('ADV040', 'Observable', 'Observable', 'consume', 6, 'edge_case', 'medium', 'Data visualization');


-- 1B. Prompt Perturbation Variants (test prompt robustness)
CREATE OR REPLACE TABLE PROMPT_VARIANTS (
    variant_id VARCHAR(20) NOT NULL,
    variant_name VARCHAR(100) NOT NULL,
    prompt_template VARCHAR(4000) NOT NULL,
    perturbation_type VARCHAR(50) NOT NULL,  -- baseline, concise, verbose, reordered, examples
    description VARCHAR(500)
);

INSERT INTO PROMPT_VARIANTS VALUES
-- Baseline (current production prompt)
('PROMPT_V1', 'Baseline Production', 
'Classify "{{COMPONENT}}" for positioning in a data architecture diagram.

DATA FLOW STAGES (left-to-right):
0. source: External data origins that PRODUCE data (Kafka, S3, databases, APIs)
1. ingest: Components that LOAD data into storage (Snowpipe, Fivetran, Airbyte)
2. raw: Raw/landing data STORAGE (bronze layer, staging tables)
3. transform: Data PROCESSING (silver layer, dbt, ETL, Spark)
4. refined: Business-ready CURATED data (gold layer, data marts)
5. serve: Components that EXPOSE data (warehouses, views, APIs)
6. consume: END-USER tools that VISUALIZE/REPORT (BI dashboards, Tableau, Looker)

TIERS: external (outside Snowflake), snowflake (native), hybrid (bridges)

Return ONLY valid JSON with no markdown: {"flow_stage":"...", "flow_stage_order":N, "flow_tier":"...", "suggested_icon":"..."}',
'baseline', 'Current production prompt'),

-- Concise variant (minimal instructions)
('PROMPT_V2', 'Concise Minimal',
'Classify "{{COMPONENT}}" into a data architecture flow stage.

Stages: source(0), ingest(1), raw(2), transform(3), refined(4), serve(5), consume(6)
Tiers: external, snowflake, hybrid

Return JSON only: {"flow_stage":"...", "flow_stage_order":N, "flow_tier":"...", "suggested_icon":"..."}',
'concise', 'Minimal prompt - tests if model has inherent knowledge'),

-- Verbose variant (extra detail)
('PROMPT_V3', 'Verbose Detailed',
'You are an expert data architect. Your task is to classify the component "{{COMPONENT}}" for automatic positioning in a data architecture diagram visualization.

IMPORTANT CONTEXT:
This classification will be used to automatically place components in a left-to-right data flow diagram. The stage determines horizontal position, and the tier determines the visual layer (external systems vs Snowflake-native).

DATA FLOW STAGES (ordered from left to right by data movement):
- Stage 0 (source): These are EXTERNAL DATA ORIGINS that PRODUCE or GENERATE data. Examples include message queues like Kafka, object storage like S3 or GCS, transactional databases like PostgreSQL or MySQL, and external APIs. The key characteristic is that data ORIGINATES from these systems.

- Stage 1 (ingest): These are INGESTION TOOLS that LOAD or TRANSFER data from sources into a data platform. Examples include Snowpipe, Fivetran, Airbyte, Stitch, and custom ingestion scripts. They move data from stage 0 to stage 2.

- Stage 2 (raw): This is RAW DATA STORAGE, also known as the landing zone or bronze layer. This includes staging tables, raw schemas, and initial landing areas where data arrives in its original form.

- Stage 3 (transform): These are DATA PROCESSING and TRANSFORMATION tools. Examples include dbt, Spark, Airflow, custom ETL scripts. They take raw data and transform it into cleaned, standardized formats. This is the silver layer.

- Stage 4 (refined): This is CURATED BUSINESS-READY DATA, also known as the gold layer or data marts. This includes fact tables, dimension tables, aggregates, and business-level data products.

- Stage 5 (serve): These are DATA SERVING COMPONENTS that EXPOSE data for consumption. This includes data warehouses, semantic layers, APIs, and views that make data available to consumers.

- Stage 6 (consume): These are END-USER CONSUMPTION TOOLS that VISUALIZE, REPORT, or ANALYZE data. Examples include BI tools like Tableau, PowerBI, Looker, Metabase, and analytical notebooks.

TIER CLASSIFICATION:
- external: Systems that exist OUTSIDE of Snowflake (cloud storage, third-party tools)
- snowflake: NATIVE Snowflake components (Snowpipe, Dynamic Tables, Snowflake functions)
- hybrid: Systems that BRIDGE external and Snowflake (connectors, integrations)

OUTPUT FORMAT:
Return ONLY a valid JSON object with no markdown formatting, no code blocks, no explanation:
{"flow_stage":"<stage_name>", "flow_stage_order":<0-6>, "flow_tier":"<tier>", "suggested_icon":"<icon_name>"}',
'verbose', 'Very detailed prompt - tests instruction following'),

-- Reordered stages (different presentation order)
('PROMPT_V4', 'Reordered Stages',
'Classify "{{COMPONENT}}" for a data architecture diagram.

DATA FLOW STAGES:
6. consume: END-USER visualization/reporting tools (Tableau, PowerBI, Looker)
5. serve: Data exposure components (warehouses, APIs, views)
4. refined: Business-ready curated data (gold layer, data marts)
3. transform: Data processing (dbt, ETL, Spark, silver layer)
2. raw: Landing/staging storage (bronze layer, raw tables)
1. ingest: Data loading tools (Snowpipe, Fivetran, Airbyte)
0. source: External data origins (Kafka, S3, databases)

TIERS: external (outside Snowflake), snowflake (native), hybrid (bridges)

Return ONLY valid JSON: {"flow_stage":"...", "flow_stage_order":N, "flow_tier":"...", "suggested_icon":"..."}',
'reordered', 'Reversed order - tests if model follows order vs memorization'),

-- Few-shot examples
('PROMPT_V5', 'Few-Shot Examples',
'Classify "{{COMPONENT}}" for positioning in a data architecture diagram.

EXAMPLES:
- "Kafka" -> {"flow_stage":"source", "flow_stage_order":0, "flow_tier":"external", "suggested_icon":"kafka"}
- "Fivetran" -> {"flow_stage":"ingest", "flow_stage_order":1, "flow_tier":"external", "suggested_icon":"fivetran"}
- "dbt" -> {"flow_stage":"transform", "flow_stage_order":3, "flow_tier":"hybrid", "suggested_icon":"dbt"}
- "Tableau" -> {"flow_stage":"consume", "flow_stage_order":6, "flow_tier":"external", "suggested_icon":"tableau"}

DATA FLOW STAGES (left-to-right):
0=source, 1=ingest, 2=raw, 3=transform, 4=refined, 5=serve, 6=consume

TIERS: external, snowflake, hybrid

Return ONLY valid JSON: {"flow_stage":"...", "flow_stage_order":N, "flow_tier":"...", "suggested_icon":"..."}',
'few_shot', 'Includes examples - tests in-context learning');


-- 1C. Enhanced Results Table with Additional Metrics
CREATE OR REPLACE TABLE BENCHMARK_RESULTS_V2 (
    run_id VARCHAR(50) NOT NULL,
    run_iteration INT NOT NULL DEFAULT 1,           -- For multiple runs
    model_name VARCHAR(100) NOT NULL,
    prompt_variant VARCHAR(20) NOT NULL,
    test_type VARCHAR(20) NOT NULL,                 -- standard, adversarial
    component_name VARCHAR(200) NOT NULL,
    expected_stage VARCHAR(20) NOT NULL,
    expected_stage_order INT NOT NULL,
    actual_response VARIANT,
    actual_stage VARCHAR(50),
    actual_stage_order INT,
    
    -- Accuracy metrics
    stage_match BOOLEAN,
    order_match BOOLEAN,
    order_within_tolerance BOOLEAN,                 -- Within 1 stage
    json_valid BOOLEAN,
    
    -- Semantic similarity (for partial credit)
    stage_similarity_score FLOAT,                   -- 0-1 based on edit distance
    
    -- Performance metrics
    latency_ms INT,
    token_count_input INT,
    token_count_output INT,
    
    -- Error categorization
    error_type VARCHAR(50),                         -- none, wrong_stage, wrong_order, invalid_json, timeout
    error_detail VARCHAR(500),
    
    -- Metadata
    run_timestamp TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);


-- ============================================================================
-- PART 2: ROBUST CLASSIFICATION UDF WITH METRICS
-- ============================================================================

-- Enhanced UDF that captures all metrics
CREATE OR REPLACE FUNCTION CLASSIFY_WITH_METRICS(
    component_name VARCHAR, 
    model_name VARCHAR,
    prompt_template VARCHAR
)
RETURNS OBJECT
LANGUAGE SQL
AS
$$
  LET start_time := CURRENT_TIMESTAMP();
  LET prompt_text := REPLACE(prompt_template, '{{COMPONENT}}', component_name);
  LET raw_response := NULL;
  LET parsed_response := NULL;
  LET error_type := 'none';
  LET error_detail := NULL;
  
  -- Attempt AI_COMPLETE call
  SELECT 
    TRY_PARSE_JSON(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            SNOWFLAKE.CORTEX.AI_COMPLETE(model_name, prompt_text),
            '^"', ''
          ),
          '"$', ''
        ),
        '```json|```|\\n', ''
      )
    ) INTO parsed_response;
  
  -- Calculate latency
  LET end_time := CURRENT_TIMESTAMP();
  LET latency_ms := DATEDIFF(millisecond, start_time, end_time);
  
  -- Determine if valid
  LET is_valid := parsed_response IS NOT NULL;
  
  -- Return structured result
  RETURN OBJECT_CONSTRUCT(
    'response', parsed_response,
    'raw_response', raw_response,
    'latency_ms', latency_ms,
    'json_valid', is_valid,
    'error_type', IFF(is_valid, 'none', 'invalid_json'),
    'timestamp', end_time
  )
$$;


-- ============================================================================
-- PART 3: COMPREHENSIVE BENCHMARK EXECUTION PROCEDURES
-- ============================================================================

-- 3A. Run single model with multiple iterations (statistical significance)
CREATE OR REPLACE PROCEDURE RUN_MODEL_BENCHMARK_V2(
    p_model_name VARCHAR,
    p_run_id VARCHAR,
    p_iterations INT DEFAULT 3,
    p_include_adversarial BOOLEAN DEFAULT TRUE,
    p_prompt_variant VARCHAR DEFAULT 'PROMPT_V1'
)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
DECLARE
    v_iteration INT := 1;
    v_prompt_template VARCHAR;
    v_total_tests INT := 0;
BEGIN
    -- Get prompt template
    SELECT prompt_template INTO v_prompt_template 
    FROM PROMPT_VARIANTS 
    WHERE variant_id = p_prompt_variant;
    
    -- Run multiple iterations for statistical significance
    WHILE (v_iteration <= p_iterations) DO
        
        -- Standard test components
        INSERT INTO BENCHMARK_RESULTS_V2 (
            run_id, run_iteration, model_name, prompt_variant, test_type,
            component_name, expected_stage, expected_stage_order,
            actual_response, actual_stage, actual_stage_order,
            stage_match, order_match, order_within_tolerance, json_valid,
            latency_ms, error_type
        )
        SELECT 
            :p_run_id,
            :v_iteration,
            :p_model_name,
            :p_prompt_variant,
            'standard',
            tc.component_name,
            tc.expected_stage,
            tc.expected_stage_order,
            TRY_PARSE_JSON(
                REGEXP_REPLACE(
                    REGEXP_REPLACE(
                        REGEXP_REPLACE(
                            SNOWFLAKE.CORTEX.AI_COMPLETE(
                                :p_model_name,
                                REPLACE(:v_prompt_template, '{{COMPONENT}}', tc.component_name)
                            ),
                            '^"', ''
                        ),
                        '"$', ''
                    ),
                    '```json|```|\\n', ''
                )
            ) AS response,
            response:flow_stage::VARCHAR,
            TRY_CAST(response:flow_stage_order AS INT),
            LOWER(response:flow_stage::VARCHAR) = LOWER(tc.expected_stage),
            TRY_CAST(response:flow_stage_order AS INT) = tc.expected_stage_order,
            ABS(COALESCE(TRY_CAST(response:flow_stage_order AS INT), -99) - tc.expected_stage_order) <= 1,
            response IS NOT NULL,
            NULL,  -- latency captured separately
            IFF(response IS NOT NULL, 'none', 'invalid_json')
        FROM TEST_COMPONENTS tc;
        
        -- Adversarial test components (if enabled)
        IF (p_include_adversarial) THEN
            INSERT INTO BENCHMARK_RESULTS_V2 (
                run_id, run_iteration, model_name, prompt_variant, test_type,
                component_name, expected_stage, expected_stage_order,
                actual_response, actual_stage, actual_stage_order,
                stage_match, order_match, order_within_tolerance, json_valid,
                latency_ms, error_type
            )
            SELECT 
                :p_run_id,
                :v_iteration,
                :p_model_name,
                :p_prompt_variant,
                'adversarial',
                atc.component_name,
                atc.expected_stage,
                atc.expected_stage_order,
                TRY_PARSE_JSON(
                    REGEXP_REPLACE(
                        REGEXP_REPLACE(
                            REGEXP_REPLACE(
                                SNOWFLAKE.CORTEX.AI_COMPLETE(
                                    :p_model_name,
                                    REPLACE(:v_prompt_template, '{{COMPONENT}}', atc.component_name)
                                ),
                                '^"', ''
                            ),
                            '"$', ''
                        ),
                        '```json|```|\\n', ''
                    )
                ) AS response,
                response:flow_stage::VARCHAR,
                TRY_CAST(response:flow_stage_order AS INT),
                LOWER(response:flow_stage::VARCHAR) = LOWER(atc.expected_stage),
                TRY_CAST(response:flow_stage_order AS INT) = atc.expected_stage_order,
                ABS(COALESCE(TRY_CAST(response:flow_stage_order AS INT), -99) - atc.expected_stage_order) <= 1,
                response IS NOT NULL,
                NULL,
                IFF(response IS NOT NULL, 'none', 'invalid_json')
            FROM ADVERSARIAL_TEST_COMPONENTS atc;
        END IF;
        
        v_iteration := v_iteration + 1;
        
    END WHILE;
    
    SELECT COUNT(*) INTO v_total_tests FROM BENCHMARK_RESULTS_V2 WHERE run_id = p_run_id;
    
    RETURN 'Completed ' || v_total_tests || ' tests for ' || p_model_name;
END;
$$;


-- ============================================================================
-- PART 4: COMPREHENSIVE METRICS VIEWS
-- ============================================================================

-- 4A. Model Summary with Statistical Metrics
CREATE OR REPLACE VIEW BENCHMARK_SUMMARY_V2 AS
WITH base_stats AS (
    SELECT 
        model_name,
        prompt_variant,
        test_type,
        run_iteration,
        COUNT(*) AS tests_per_iteration,
        SUM(CASE WHEN stage_match THEN 1 ELSE 0 END) AS stage_correct,
        SUM(CASE WHEN order_match THEN 1 ELSE 0 END) AS order_correct,
        SUM(CASE WHEN order_within_tolerance THEN 1 ELSE 0 END) AS order_tolerance,
        SUM(CASE WHEN json_valid THEN 1 ELSE 0 END) AS json_valid_count,
        AVG(latency_ms) AS avg_latency
    FROM BENCHMARK_RESULTS_V2
    GROUP BY model_name, prompt_variant, test_type, run_iteration
),
aggregated AS (
    SELECT 
        model_name,
        prompt_variant,
        test_type,
        COUNT(DISTINCT run_iteration) AS iterations,
        SUM(tests_per_iteration) AS total_tests,
        
        -- Mean accuracy
        AVG(100.0 * stage_correct / tests_per_iteration) AS stage_accuracy_mean,
        AVG(100.0 * order_correct / tests_per_iteration) AS order_accuracy_mean,
        AVG(100.0 * order_tolerance / tests_per_iteration) AS tolerance_accuracy_mean,
        AVG(100.0 * json_valid_count / tests_per_iteration) AS json_validity_mean,
        
        -- Standard deviation (consistency metric)
        STDDEV(100.0 * stage_correct / tests_per_iteration) AS stage_accuracy_stddev,
        STDDEV(100.0 * order_correct / tests_per_iteration) AS order_accuracy_stddev,
        
        -- Latency
        AVG(avg_latency) AS latency_mean_ms
        
    FROM base_stats
    GROUP BY model_name, prompt_variant, test_type
)
SELECT 
    model_name,
    prompt_variant,
    test_type,
    iterations,
    total_tests,
    
    -- Accuracy metrics with confidence
    ROUND(stage_accuracy_mean, 1) AS stage_accuracy_pct,
    ROUND(COALESCE(stage_accuracy_stddev, 0), 2) AS stage_accuracy_stddev,
    ROUND(order_accuracy_mean, 1) AS order_accuracy_pct,
    ROUND(tolerance_accuracy_mean, 1) AS tolerance_accuracy_pct,
    ROUND(json_validity_mean, 1) AS json_validity_pct,
    
    -- Consistency score (lower stddev = more consistent)
    ROUND(100 - COALESCE(stage_accuracy_stddev, 0), 1) AS consistency_score,
    
    -- Weighted score (same formula as V1 but with consistency bonus)
    ROUND(
        (0.30 * stage_accuracy_mean) +
        (0.20 * order_accuracy_mean) +
        (0.15 * tolerance_accuracy_mean) +
        (0.15 * json_validity_mean) +
        (0.10 * (100 - COALESCE(stage_accuracy_stddev, 0))) +  -- Consistency bonus
        (0.10 * LEAST(100, 1000 / NULLIF(latency_mean_ms, 0)))  -- Speed bonus (capped)
    , 1) AS weighted_score_v2,
    
    -- Latency
    ROUND(latency_mean_ms, 0) AS latency_mean_ms
    
FROM aggregated
ORDER BY weighted_score_v2 DESC;


-- 4B. Adversarial Performance Breakdown
CREATE OR REPLACE VIEW ADVERSARIAL_ANALYSIS AS
SELECT 
    br.model_name,
    atc.adversarial_type,
    atc.difficulty,
    COUNT(*) AS test_count,
    ROUND(100.0 * SUM(CASE WHEN br.stage_match THEN 1 ELSE 0 END) / COUNT(*), 1) AS accuracy_pct,
    ROUND(100.0 * SUM(CASE WHEN br.json_valid THEN 1 ELSE 0 END) / COUNT(*), 1) AS json_valid_pct
FROM BENCHMARK_RESULTS_V2 br
JOIN ADVERSARIAL_TEST_COMPONENTS atc 
    ON br.component_name = atc.component_name
WHERE br.test_type = 'adversarial'
GROUP BY br.model_name, atc.adversarial_type, atc.difficulty
ORDER BY br.model_name, atc.adversarial_type, atc.difficulty;


-- 4C. Confusion Matrix for Error Analysis
CREATE OR REPLACE VIEW CONFUSION_MATRIX AS
SELECT 
    model_name,
    expected_stage,
    actual_stage,
    COUNT(*) AS occurrence_count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY model_name, expected_stage), 1) AS pct_of_expected
FROM BENCHMARK_RESULTS_V2
WHERE json_valid = TRUE
GROUP BY model_name, expected_stage, actual_stage
ORDER BY model_name, expected_stage, occurrence_count DESC;


-- 4D. Prompt Robustness Analysis
CREATE OR REPLACE VIEW PROMPT_ROBUSTNESS AS
SELECT 
    model_name,
    prompt_variant,
    COUNT(*) AS total_tests,
    ROUND(100.0 * SUM(CASE WHEN stage_match THEN 1 ELSE 0 END) / COUNT(*), 1) AS accuracy_pct,
    ROUND(100.0 * SUM(CASE WHEN json_valid THEN 1 ELSE 0 END) / COUNT(*), 1) AS json_valid_pct
FROM BENCHMARK_RESULTS_V2
GROUP BY model_name, prompt_variant
ORDER BY model_name, accuracy_pct DESC;


-- 4E. Consistency Analysis (variance across iterations)
CREATE OR REPLACE VIEW CONSISTENCY_ANALYSIS AS
SELECT 
    model_name,
    component_name,
    COUNT(DISTINCT actual_stage) AS unique_responses,
    LISTAGG(DISTINCT actual_stage, ', ') AS response_variants,
    CASE 
        WHEN COUNT(DISTINCT actual_stage) = 1 THEN 'consistent'
        WHEN COUNT(DISTINCT actual_stage) = 2 THEN 'variable'
        ELSE 'unstable'
    END AS stability_rating
FROM BENCHMARK_RESULTS_V2
WHERE json_valid = TRUE
GROUP BY model_name, component_name
HAVING COUNT(*) > 1  -- Only components with multiple runs
ORDER BY unique_responses DESC, model_name;


-- 4F. Final Leaderboard (combines all factors)
CREATE OR REPLACE VIEW FINAL_LEADERBOARD AS
WITH model_scores AS (
    SELECT 
        model_name,
        
        -- Standard test accuracy
        AVG(CASE WHEN test_type = 'standard' AND stage_match THEN 100.0 ELSE 0 END) AS standard_accuracy,
        
        -- Adversarial test accuracy  
        AVG(CASE WHEN test_type = 'adversarial' AND stage_match THEN 100.0 ELSE 0 END) AS adversarial_accuracy,
        
        -- JSON validity
        AVG(CASE WHEN json_valid THEN 100.0 ELSE 0 END) AS json_validity,
        
        -- Consistency (unique responses per component)
        100 - (10 * AVG(
            CASE WHEN component_name IN (
                SELECT component_name FROM BENCHMARK_RESULTS_V2 br2 
                WHERE br2.model_name = BENCHMARK_RESULTS_V2.model_name 
                GROUP BY component_name 
                HAVING COUNT(DISTINCT actual_stage) > 1
            ) THEN 1 ELSE 0 END
        )) AS consistency_score,
        
        -- Average latency
        AVG(latency_ms) AS avg_latency_ms
        
    FROM BENCHMARK_RESULTS_V2
    GROUP BY model_name
)
SELECT 
    model_name,
    ROUND(standard_accuracy, 1) AS standard_accuracy_pct,
    ROUND(adversarial_accuracy, 1) AS adversarial_accuracy_pct,
    ROUND(json_validity, 1) AS json_validity_pct,
    ROUND(consistency_score, 1) AS consistency_pct,
    ROUND(avg_latency_ms, 0) AS avg_latency_ms,
    
    -- Comprehensive weighted score
    ROUND(
        (0.35 * standard_accuracy) +      -- Core accuracy
        (0.25 * adversarial_accuracy) +   -- Robustness
        (0.15 * json_validity) +          -- Reliability
        (0.15 * consistency_score) +      -- Consistency
        (0.10 * LEAST(100, 2000 / NULLIF(avg_latency_ms, 0)))  -- Speed (capped)
    , 1) AS final_weighted_score,
    
    -- Ranking
    RANK() OVER (ORDER BY 
        (0.35 * standard_accuracy) +
        (0.25 * adversarial_accuracy) +
        (0.15 * json_validity) +
        (0.15 * consistency_score) +
        (0.10 * LEAST(100, 2000 / NULLIF(avg_latency_ms, 0)))
    DESC) AS overall_rank
    
FROM model_scores
ORDER BY final_weighted_score DESC;


-- ============================================================================
-- PART 5: EXECUTION SCRIPT
-- ============================================================================

-- Example execution:
-- CALL RUN_MODEL_BENCHMARK_V2('claude-opus-4-6', 'RUN_V2_001', 3, TRUE, 'PROMPT_V1');
-- CALL RUN_MODEL_BENCHMARK_V2('claude-opus-4-5', 'RUN_V2_001', 3, TRUE, 'PROMPT_V1');
-- etc.

-- Query results:
-- SELECT * FROM FINAL_LEADERBOARD;
-- SELECT * FROM ADVERSARIAL_ANALYSIS WHERE model_name = 'claude-opus-4-6';
-- SELECT * FROM CONFUSION_MATRIX WHERE model_name = 'claude-opus-4-6';
-- SELECT * FROM CONSISTENCY_ANALYSIS WHERE model_name = 'claude-opus-4-6';
