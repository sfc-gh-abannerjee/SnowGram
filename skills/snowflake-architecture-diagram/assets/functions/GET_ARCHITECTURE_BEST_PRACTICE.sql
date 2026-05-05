CREATE OR REPLACE FUNCTION SNOWGRAM_DB.CORE.GET_ARCHITECTURE_BEST_PRACTICE("USE_CASE_KEYWORD" VARCHAR)
RETURNS TABLE ("PRACTICE_ID" VARCHAR, "USE_CASE" VARCHAR, "TITLE" VARCHAR, "DESCRIPTION" VARCHAR, "RECOMMENDATIONS" VARCHAR, "ANTI_PATTERNS" VARCHAR, "EXAMPLE_COMPONENTS" ARRAY)
LANGUAGE SQL
AS '
    SELECT 
        practice_id,
        use_case,
        title,
        description,
        recommendations,
        anti_patterns,
        example_components
    FROM SNOWGRAM_DB.CORE.ARCHITECTURE_BEST_PRACTICES
    WHERE LOWER(use_case) LIKE ''%'' || LOWER(use_case_keyword) || ''%''
       OR LOWER(title) LIKE ''%'' || LOWER(use_case_keyword) || ''%''
       OR LOWER(description) LIKE ''%'' || LOWER(use_case_keyword) || ''%''
    ORDER BY 
        CASE 
            WHEN LOWER(use_case) = LOWER(use_case_keyword) THEN 1
            WHEN LOWER(use_case) LIKE LOWER(use_case_keyword) || ''%'' THEN 2
            ELSE 3
        END
    LIMIT 3
';