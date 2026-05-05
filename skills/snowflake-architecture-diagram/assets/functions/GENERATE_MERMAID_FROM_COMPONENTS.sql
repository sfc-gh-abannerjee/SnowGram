CREATE OR REPLACE FUNCTION SNOWGRAM_DB.CORE.GENERATE_MERMAID_FROM_COMPONENTS("BLOCK_IDS" ARRAY, "CONNECTIONS" VARIANT)
RETURNS VARCHAR
LANGUAGE SQL
COMMENT='Generates Mermaid flowchart code from component block IDs with proper layer styling. ORDER OF BLOCK_IDS MATTERS for connections.'
AS '
WITH input_order AS (
    SELECT 
        VALUE::VARCHAR as BLOCK_ID,
        INDEX as input_position
    FROM TABLE(FLATTEN(INPUT => BLOCK_IDS))
),
block_data AS (
    SELECT 
        b.BLOCK_ID,
        b.BLOCK_NAME,
        b.BLOCK_CATEGORY,
        b.MERMAID_CODE,
        io.input_position
    FROM SNOWGRAM_DB.CORE.COMPONENT_BLOCKS b
    JOIN input_order io ON b.BLOCK_ID = io.BLOCK_ID
),
styled_blocks AS (
    SELECT 
        bd.*,
        CASE bd.BLOCK_CATEGORY
            WHEN ''bronze'' THEN ''bronzeStyle''
            WHEN ''silver'' THEN ''silverStyle''
            WHEN ''gold'' THEN ''goldStyle''
            WHEN ''external'' THEN ''awsStyle''
            WHEN ''bi'' THEN ''biStyle''
            WHEN ''compute'' THEN ''warehouseStyle''
            WHEN ''security'' THEN ''secureStyle''
            WHEN ''transformation'' THEN ''transformStyle''
            ELSE ''snowflakeStyle''
        END as style_class,
        -- Extract node ID for connections (first word before [ or ()
        REGEXP_SUBSTR(MERMAID_CODE, ''^[A-Za-z_][A-Za-z0-9_]*'') as node_id
    FROM block_data bd
),
node_definitions AS (
    SELECT 
        BLOCK_ID,
        BLOCK_CATEGORY,
        input_position,
        node_id,
        -- Replace existing style class with layer-appropriate one
        CASE 
            WHEN MERMAID_CODE LIKE ''%:::%'' THEN 
                REGEXP_REPLACE(MERMAID_CODE, '':::.*$'', '':::'' || style_class)
            ELSE 
                MERMAID_CODE || '':::'' || style_class
        END as styled_mermaid_code
    FROM styled_blocks
),
-- Build connections in INPUT ORDER (not category order)
sequential_connections AS (
    SELECT 
        LAG(node_id) OVER (ORDER BY input_position) as from_node,
        node_id as to_node,
        input_position
    FROM node_definitions
),
-- Generate the final Mermaid code
mermaid_output AS (
    SELECT ''flowchart LR'' as line, 0 as line_order
    UNION ALL
    -- Add nodes in input order
    SELECT 
        ''    '' || styled_mermaid_code as line,
        100 + input_position as line_order
    FROM node_definitions
    UNION ALL
    -- Add connections (following input order)
    SELECT 
        ''    '' || from_node || '' --> '' || to_node as line,
        1000 + input_position as line_order
    FROM sequential_connections
    WHERE from_node IS NOT NULL
    UNION ALL
    -- Add styling definitions
    SELECT line, line_order FROM (
        SELECT ''    %% Styling'' as line, 2000 as line_order
        UNION ALL SELECT ''    classDef snowflakeStyle fill:#29B5E8,stroke:#fff,stroke-width:2px,color:#fff'', 2001
        UNION ALL SELECT ''    classDef awsStyle fill:#FF9900,stroke:#232F3E,stroke-width:2px,color:#fff'', 2002
        UNION ALL SELECT ''    classDef bronzeStyle fill:#CD7F32,stroke:#fff,stroke-width:2px,color:#fff'', 2003
        UNION ALL SELECT ''    classDef silverStyle fill:#C0C0C0,stroke:#333,stroke-width:2px,color:#333'', 2004
        UNION ALL SELECT ''    classDef goldStyle fill:#FFD700,stroke:#333,stroke-width:2px,color:#333'', 2005
        UNION ALL SELECT ''    classDef warehouseStyle fill:#0066CC,stroke:#fff,stroke-width:2px,color:#fff'', 2006
        UNION ALL SELECT ''    classDef secureStyle fill:#4ECDC4,stroke:#fff,stroke-width:2px,color:#fff'', 2007
        UNION ALL SELECT ''    classDef biStyle fill:#E97627,stroke:#fff,stroke-width:2px,color:#fff'', 2008
        UNION ALL SELECT ''    classDef transformStyle fill:#7B68EE,stroke:#fff,stroke-width:2px,color:#fff'', 2009
    )
)
SELECT LISTAGG(line, ''\\n'') WITHIN GROUP (ORDER BY line_order)
FROM mermaid_output
';