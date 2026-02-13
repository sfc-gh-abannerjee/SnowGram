-- ============================================================================
-- AI-Powered Component Classification UDF (with Cache)
-- ============================================================================
-- Optimized classification that checks a cache of known components first,
-- falling back to LLM only for unknown components.
--
-- Performance:
--   - Cached lookup: ~100ms (instant, FREE)
--   - LLM fallback: ~1,400ms ($3.61/1K calls)
--
-- Model Options (Feb 2026 Benchmark - V4, 1,350 tests):
--   ┌─────────────────────┬──────────┬──────────┬─────────┬─────────────┐
--   │ Model               │ Accuracy │ Cost/1K  │ Latency │ Best For    │
--   ├─────────────────────┼──────────┼──────────┼─────────┼─────────────┤
--   │ claude-opus-4-6     │ 95.56%   │ $9.49    │ 2,079ms │ Max accuracy│
--   │ claude-sonnet-4-5   │ 93.33%   │ $5.69    │ 1,996ms │ Balanced    │
--   │ openai-gpt-5.1      │ 92.89%   │ $3.61    │ 1,388ms │ Best value  │
--   └─────────────────────┴──────────┴──────────┴─────────┴─────────────┘
--
-- Default: openai-gpt-5.1 (best cost/accuracy ratio)
--
-- Usage:
--   -- Uses cache for known components (Kafka, Tableau, dbt, etc.)
--   SELECT SNOWGRAM_DB.CORE.CLASSIFY_COMPONENT('Tableau');
--   -- Returns: {..., "source": "cache"}
--
--   -- Falls back to LLM for unknown components
--   SELECT SNOWGRAM_DB.CORE.CLASSIFY_COMPONENT('CustomETLTool');
--   -- Returns: {..., "source": "llm"}
--
--   -- Force high-accuracy model for unknowns
--   SELECT SNOWGRAM_DB.CORE.CLASSIFY_COMPONENT('CustomTool', 'claude-opus-4-6');
--
-- Returns VARIANT with:
--   - flow_stage: source|ingest|raw|transform|refined|serve|consume
--   - flow_stage_order: 0-6 (for ELK.js layer assignment)
--   - flow_tier: external|snowflake|hybrid
--   - suggested_icon: closest icon match
--   - source: 'cache' or 'llm' (indicates where result came from)
-- ============================================================================

USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

-- ============================================================================
-- Known Components Cache Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS KNOWN_COMPONENT_CLASSIFICATIONS (
    component_name VARCHAR NOT NULL,
    component_name_normalized VARCHAR NOT NULL,
    flow_stage VARCHAR NOT NULL,
    flow_stage_order INT NOT NULL,
    flow_tier VARCHAR NOT NULL,
    suggested_icon VARCHAR,
    category VARCHAR,
    verified BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
    PRIMARY KEY (component_name_normalized)
);

-- ============================================================================
-- Main Classification Function (Cache-First)
-- ============================================================================
CREATE OR REPLACE FUNCTION CLASSIFY_COMPONENT(
    component_name VARCHAR,
    model_name VARCHAR DEFAULT 'openai-gpt-5.1'
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'AI-powered classification with cache lookup. Checks known components first (instant, free), falls back to LLM for unknown components.'
AS
$$
  COALESCE(
    -- First: Try cache lookup (instant, free)
    (SELECT TO_VARIANT(OBJECT_CONSTRUCT(
        'flow_stage', flow_stage,
        'flow_stage_order', flow_stage_order,
        'flow_tier', flow_tier,
        'suggested_icon', suggested_icon,
        'source', 'cache'
      ))
     FROM SNOWGRAM_DB.CORE.KNOWN_COMPONENT_CLASSIFICATIONS
     WHERE component_name_normalized = LOWER(REGEXP_REPLACE(component_name, '[^a-zA-Z0-9]', ''))
     LIMIT 1),
    
    -- Fallback: LLM classification
    (SELECT TO_VARIANT(OBJECT_INSERT(
        TRY_PARSE_JSON(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                SNOWFLAKE.CORTEX.COMPLETE(
                  model_name,
                  'Classify "' || component_name || '" for positioning in a data architecture diagram.

DATA FLOW STAGES (left-to-right):
0. source: External data origins that PRODUCE data (Kafka, S3, databases, APIs)
1. ingest: Components that LOAD data into storage (Snowpipe, Fivetran, Airbyte)
2. raw: Raw/landing data STORAGE (bronze layer, staging tables)
3. transform: Data PROCESSING (silver layer, dbt, ETL, Spark)
4. refined: Business-ready CURATED data (gold layer, data marts)
5. serve: Components that EXPOSE data (warehouses, views, APIs)
6. consume: END-USER tools that VISUALIZE/REPORT (BI dashboards, Tableau, Looker)

TIERS: external (outside Snowflake), snowflake (native), hybrid (bridges)

Return ONLY valid JSON with no markdown: {"flow_stage":"...", "flow_stage_order":N, "flow_tier":"...", "suggested_icon":"..."}'
                ),
                '^"', ''
              ),
              '"$', ''
            ),
            '```json|```|\\n', ''
          )
        ),
        'source', 'llm'
      ))
    )
  )
$$;

-- ============================================================================
-- Convenience Wrappers
-- ============================================================================
CREATE OR REPLACE FUNCTION CLASSIFY_COMPONENT_ACCURATE(component_name VARCHAR)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'High-accuracy classification. Cache first, then claude-opus-4-6 for unknowns.'
AS $$ CLASSIFY_COMPONENT(component_name, 'claude-opus-4-6') $$;

CREATE OR REPLACE FUNCTION CLASSIFY_COMPONENT_FAST(component_name VARCHAR)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Cost-optimized classification. Cache first, then openai-gpt-5.1 for unknowns.'
AS $$ CLASSIFY_COMPONENT(component_name, 'openai-gpt-5.1') $$;

-- ============================================================================
-- Batch Classification
-- ============================================================================
CREATE OR REPLACE FUNCTION CLASSIFY_COMPONENTS_BATCH(
    components ARRAY,
    model_name VARCHAR DEFAULT 'openai-gpt-5.1'
)
RETURNS ARRAY
LANGUAGE SQL
COMMENT = 'Classify multiple components in batch.'
AS
$$
  (
    SELECT ARRAY_AGG(
      OBJECT_CONSTRUCT(
        'component', c.value::VARCHAR,
        'classification', CLASSIFY_COMPONENT(c.value::VARCHAR, model_name)
      )
    )
    FROM TABLE(FLATTEN(INPUT => components)) c
  )
$$;

-- ============================================================================
-- Admin: Add new component to cache
-- ============================================================================
CREATE OR REPLACE PROCEDURE ADD_KNOWN_COMPONENT(
    p_component_name VARCHAR,
    p_flow_stage VARCHAR,
    p_flow_stage_order INT,
    p_flow_tier VARCHAR,
    p_suggested_icon VARCHAR,
    p_category VARCHAR
)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
BEGIN
    INSERT INTO SNOWGRAM_DB.CORE.KNOWN_COMPONENT_CLASSIFICATIONS 
    (component_name, component_name_normalized, flow_stage, flow_stage_order, flow_tier, suggested_icon, category)
    VALUES (
        :p_component_name,
        LOWER(REGEXP_REPLACE(:p_component_name, '[^a-zA-Z0-9]', '')),
        :p_flow_stage,
        :p_flow_stage_order,
        :p_flow_tier,
        :p_suggested_icon,
        :p_category
    );
    RETURN 'Added: ' || :p_component_name;
END;
$$;

-- ============================================================================
-- Auto-Learning: Classify and Cache
-- ============================================================================
-- Classifies unknown components via LLM and automatically caches the result
-- for future reuse. Auto-learned entries are marked verified=FALSE until
-- human review.
-- ============================================================================
CREATE OR REPLACE PROCEDURE CLASSIFY_AND_CACHE(
    p_component_name VARCHAR,
    p_model_name VARCHAR DEFAULT 'openai-gpt-5.1'
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Classify component and cache result for future reuse. Auto-learned entries marked unverified.'
AS
$$
DECLARE
    v_result VARIANT;
    v_normalized VARCHAR;
    v_cached_count INT;
    v_flow_stage VARCHAR;
    v_flow_stage_order INT;
    v_flow_tier VARCHAR;
    v_suggested_icon VARCHAR;
BEGIN
    -- Normalize the component name
    v_normalized := LOWER(REGEXP_REPLACE(:p_component_name, '[^a-zA-Z0-9]', ''));
    
    -- Check if already cached
    SELECT COUNT(*) INTO v_cached_count
    FROM SNOWGRAM_DB.CORE.KNOWN_COMPONENT_CLASSIFICATIONS
    WHERE component_name_normalized = :v_normalized;
    
    IF (v_cached_count > 0) THEN
        -- Return from cache
        SELECT TO_VARIANT(OBJECT_CONSTRUCT(
            'flow_stage', flow_stage,
            'flow_stage_order', flow_stage_order,
            'flow_tier', flow_tier,
            'suggested_icon', suggested_icon,
            'source', 'cache',
            'message', 'Already cached'
        )) INTO v_result
        FROM SNOWGRAM_DB.CORE.KNOWN_COMPONENT_CLASSIFICATIONS
        WHERE component_name_normalized = :v_normalized
        LIMIT 1;
        
        RETURN v_result;
    END IF;
    
    -- Call LLM for classification
    SELECT CLASSIFY_COMPONENT(:p_component_name, :p_model_name) INTO v_result;
    
    -- Extract fields for insert
    v_flow_stage := v_result:flow_stage::VARCHAR;
    v_flow_stage_order := v_result:flow_stage_order::INT;
    v_flow_tier := v_result:flow_tier::VARCHAR;
    v_suggested_icon := v_result:suggested_icon::VARCHAR;
    
    -- If valid result from LLM, add to cache
    IF (v_flow_stage IS NOT NULL AND v_result:source::VARCHAR = 'llm') THEN
        INSERT INTO SNOWGRAM_DB.CORE.KNOWN_COMPONENT_CLASSIFICATIONS
            (component_name, component_name_normalized, flow_stage, flow_stage_order, 
             flow_tier, suggested_icon, category, verified, created_at)
        VALUES 
            (:p_component_name, :v_normalized, :v_flow_stage, :v_flow_stage_order, 
             :v_flow_tier, :v_suggested_icon, 'auto-learned', FALSE, CURRENT_TIMESTAMP());
        
        -- Return result with cache confirmation
        RETURN OBJECT_CONSTRUCT(
            'flow_stage', :v_flow_stage,
            'flow_stage_order', :v_flow_stage_order,
            'flow_tier', :v_flow_tier,
            'suggested_icon', :v_suggested_icon,
            'source', 'llm',
            'cached', TRUE,
            'message', 'Classified and cached for future use'
        );
    END IF;
    
    RETURN v_result;
END;
$$;

-- ============================================================================
-- Auto-Learning: Review & Verify
-- ============================================================================
CREATE OR REPLACE VIEW AUTO_LEARNED_COMPONENTS AS
SELECT 
    component_name,
    flow_stage,
    flow_stage_order,
    flow_tier,
    suggested_icon,
    verified,
    created_at,
    DATEDIFF('hour', created_at, CURRENT_TIMESTAMP()) as hours_ago
FROM SNOWGRAM_DB.CORE.KNOWN_COMPONENT_CLASSIFICATIONS
WHERE category = 'auto-learned'
ORDER BY created_at DESC;

CREATE OR REPLACE PROCEDURE VERIFY_COMPONENT(p_component_name VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
COMMENT = 'Mark an auto-learned component as human-verified.'
AS
$$
BEGIN
    UPDATE SNOWGRAM_DB.CORE.KNOWN_COMPONENT_CLASSIFICATIONS
    SET verified = TRUE
    WHERE component_name = :p_component_name;
    
    RETURN 'Verified: ' || :p_component_name;
END;
$$;

-- ============================================================================
-- Grants
-- ============================================================================
GRANT SELECT ON KNOWN_COMPONENT_CLASSIFICATIONS TO ROLE PUBLIC;
GRANT SELECT ON AUTO_LEARNED_COMPONENTS TO ROLE PUBLIC;
GRANT USAGE ON FUNCTION CLASSIFY_COMPONENT(VARCHAR, VARCHAR) TO ROLE PUBLIC;
GRANT USAGE ON FUNCTION CLASSIFY_COMPONENT_ACCURATE(VARCHAR) TO ROLE PUBLIC;
GRANT USAGE ON FUNCTION CLASSIFY_COMPONENT_FAST(VARCHAR) TO ROLE PUBLIC;
GRANT USAGE ON FUNCTION CLASSIFY_COMPONENTS_BATCH(ARRAY, VARCHAR) TO ROLE PUBLIC;

-- ============================================================================
-- Test Examples
-- ============================================================================
-- Cached (instant):
-- SELECT CLASSIFY_COMPONENT('Kafka');        -- source: cache
-- SELECT CLASSIFY_COMPONENT('Tableau');      -- source: cache
-- SELECT CLASSIFY_COMPONENT('dbt');          -- source: cache

-- LLM fallback (1-2 seconds):
-- SELECT CLASSIFY_COMPONENT('CustomETLTool'); -- source: llm

-- Batch:
-- SELECT CLASSIFY_COMPONENTS_BATCH(ARRAY_CONSTRUCT('Kafka', 'dbt', 'Tableau'));

-- Add new component to cache manually:
-- CALL ADD_KNOWN_COMPONENT('Segment', 'source', 0, 'external', 'segment', 'cdp');

-- Auto-learning (classify + cache for reuse):
-- CALL CLASSIFY_AND_CACHE('Snowflake Polaris');  -- First call: LLM + cache
-- CALL CLASSIFY_AND_CACHE('Snowflake Polaris');  -- Second call: instant from cache

-- Review auto-learned components:
-- SELECT * FROM AUTO_LEARNED_COMPONENTS;

-- Verify an auto-learned component:
-- CALL VERIFY_COMPONENT('Snowflake Polaris');
