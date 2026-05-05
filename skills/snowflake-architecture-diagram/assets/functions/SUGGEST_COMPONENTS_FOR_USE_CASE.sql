CREATE OR REPLACE FUNCTION SNOWGRAM_DB.CORE.SUGGEST_COMPONENTS_FOR_USE_CASE("USER_DESCRIPTION" VARCHAR)
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
';