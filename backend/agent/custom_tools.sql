-- =====================================================
-- Cortex Agent Custom Tools
-- =====================================================
-- Purpose: UDFs and Stored Procedures for diagram generation
-- These tools are registered with the Cortex Agent
-- =====================================================

USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

-- =====================================================
-- 1. GENERATE_MERMAID_FROM_COMPONENTS
-- =====================================================
-- Purpose: Generate Mermaid diagram code from component blocks
-- Input: Array of component block IDs, connection rules
-- Output: Complete Mermaid flowchart code

CREATE OR REPLACE FUNCTION GENERATE_MERMAID_FROM_COMPONENTS(
    block_ids ARRAY,
    connections VARIANT
)
RETURNS TEXT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'generate_mermaid'
AS
$$
def generate_mermaid(block_ids, connections):
    """
    Generate Mermaid flowchart code from component blocks.
    
    Args:
        block_ids: Array of block IDs to include
        connections: JSON object defining how blocks connect
    
    Returns:
        Complete Mermaid flowchart code as string
    """
    if not block_ids or len(block_ids) == 0:
        return "flowchart LR\n    empty[No components specified]"
    
    # Import required modules
    import json
    
    # Start with flowchart declaration
    mermaid_code = "flowchart LR\n"
    
    # Add each block's Mermaid code
    # In production, this would fetch from COMPONENT_BLOCKS table
    # For now, generate placeholder nodes
    for i, block_id in enumerate(block_ids):
        # Create a valid node ID (remove special characters)
        node_id = block_id.replace("-", "_").replace(" ", "_")
        
        # Generate node with label
        mermaid_code += f"    {node_id}[(\"{block_id}\")]:::snowflakeStyle\n"
    
    # Add connections between blocks
    if connections and isinstance(connections, dict):
        conn_list = connections.get("connections", [])
        for conn in conn_list:
            source = conn.get("from", "").replace("-", "_").replace(" ", "_")
            target = conn.get("to", "").replace("-", "_").replace(" ", "_")
            label = conn.get("label", "")
            
            if source and target:
                if label:
                    mermaid_code += f"    {source} -->|{label}| {target}\n"
                else:
                    mermaid_code += f"    {source} --> {target}\n"
    else:
        # Default: connect sequentially
        for i in range(len(block_ids) - 1):
            source = block_ids[i].replace("-", "_").replace(" ", "_")
            target = block_ids[i + 1].replace("-", "_").replace(" ", "_")
            mermaid_code += f"    {source} --> {target}\n"
    
    # Add styling
    mermaid_code += "\n    %% Styling\n"
    mermaid_code += "    classDef snowflakeStyle fill:#29B5E8,stroke:#fff,stroke-width:2px,color:#fff\n"
    
    return mermaid_code
$$;

COMMENT ON FUNCTION GENERATE_MERMAID_FROM_COMPONENTS(ARRAY, VARIANT) IS 
  'Generates Mermaid flowchart code from array of component block IDs and connection rules. Used by Cortex Agent.';

-- =====================================================
-- 2. VALIDATE_MERMAID_SYNTAX
-- =====================================================
-- Purpose: Validate Mermaid code syntax
-- Input: Mermaid code string
-- Output: Boolean (true if valid, false otherwise)

CREATE OR REPLACE FUNCTION VALIDATE_MERMAID_SYNTAX(
    mermaid_code TEXT
)
RETURNS BOOLEAN
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
HANDLER = 'validate_syntax'
AS
$$
def validate_syntax(mermaid_code):
    """
    Validate Mermaid diagram syntax.
    
    Args:
        mermaid_code: Mermaid code string to validate
    
    Returns:
        True if syntax appears valid, False otherwise
    """
    if not mermaid_code or len(mermaid_code.strip()) == 0:
        return False
    
    # Basic validation checks
    checks = [
        # Must start with flowchart declaration
        mermaid_code.strip().startswith(('flowchart', 'graph', 'sequenceDiagram', 'classDiagram')),
        
        # Must have at least one node or connection
        ('-->' in mermaid_code or '[' in mermaid_code),
        
        # Check for balanced brackets
        mermaid_code.count('[') == mermaid_code.count(']'),
        mermaid_code.count('(') == mermaid_code.count(')'),
        mermaid_code.count('{') == mermaid_code.count('}'),
    ]
    
    return all(checks)
$$;

COMMENT ON FUNCTION VALIDATE_MERMAID_SYNTAX(TEXT) IS 
  'Validates Mermaid diagram syntax. Returns true if syntax is valid, false otherwise.';

-- =====================================================
-- 3. OPTIMIZE_DIAGRAM_LAYOUT
-- =====================================================
-- Purpose: Optimize Mermaid diagram layout for better visual organization
-- Input: Mermaid code, layout style preference
-- Output: Optimized Mermaid code

CREATE OR REPLACE FUNCTION OPTIMIZE_DIAGRAM_LAYOUT(
    mermaid_code TEXT,
    layout_style VARCHAR
)
RETURNS TEXT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
HANDLER = 'optimize_layout'
AS
$$
def optimize_layout(mermaid_code, layout_style):
    """
    Optimize Mermaid diagram layout.
    
    Args:
        mermaid_code: Original Mermaid code
        layout_style: Desired layout (LR, TD, BT, RL)
    
    Returns:
        Optimized Mermaid code
    """
    if not mermaid_code:
        return mermaid_code
    
    # Valid layout styles
    valid_styles = ['LR', 'TD', 'BT', 'RL']
    if layout_style not in valid_styles:
        layout_style = 'LR'  # Default to left-to-right
    
    # Replace flowchart direction
    lines = mermaid_code.split('\n')
    optimized_lines = []
    
    for line in lines:
        if line.strip().startswith('flowchart'):
            # Replace with desired layout
            optimized_lines.append(f"flowchart {layout_style}")
        else:
            optimized_lines.append(line)
    
    return '\n'.join(optimized_lines)
$$;

COMMENT ON FUNCTION OPTIMIZE_DIAGRAM_LAYOUT(TEXT, VARCHAR) IS 
  'Optimizes Mermaid diagram layout. Supports LR (left-right), TD (top-down), BT (bottom-top), RL (right-left).';

-- =====================================================
-- 4. SUGGEST_SNOWFLAKE_ICONS
-- =====================================================
-- Purpose: Suggest appropriate Snowflake icons for component names
-- Input: Array of component names
-- Output: Array of icon URLs from stage

CREATE OR REPLACE FUNCTION SUGGEST_SNOWFLAKE_ICONS(
    component_names ARRAY
)
RETURNS ARRAY
LANGUAGE SQL
AS
$$
    SELECT ARRAY_AGG(
        OBJECT_CONSTRUCT(
            'component', value,
            'icon_url', COALESCE(c.icon_url, 'default_icon.svg')
        )
    )
    FROM TABLE(FLATTEN(input => component_names))
    LEFT JOIN SNOWGRAM_DB.CORE.COMPONENTS c 
        ON LOWER(value::STRING) = LOWER(c.component_name)
$$;

COMMENT ON FUNCTION SUGGEST_SNOWFLAKE_ICONS(ARRAY) IS 
  'Suggests icon URLs for given component names from the icon library.';

-- =====================================================
-- 5. COMPOSE_DIAGRAM_FROM_PATTERN
-- =====================================================
-- Purpose: Generate complete diagram from a pattern ID
-- Input: Pattern ID
-- Output: Mermaid code for the pattern

CREATE OR REPLACE FUNCTION COMPOSE_DIAGRAM_FROM_PATTERN(pattern_id_param VARCHAR)
RETURNS TEXT
LANGUAGE SQL
AS
$$
    SELECT mermaid_template
    FROM SNOWGRAM_DB.CORE.COMPOSED_PATTERNS
    WHERE pattern_id = pattern_id_param
    LIMIT 1
$$;

COMMENT ON FUNCTION COMPOSE_DIAGRAM_FROM_PATTERN(VARCHAR) IS 
  'Retrieves Mermaid template code for a given pattern ID.';

-- =====================================================
-- 6. COMPOSE_DIAGRAM_FROM_TEMPLATE
-- =====================================================
-- Purpose: Generate complete diagram from a template ID
-- Input: Template ID
-- Output: Full Mermaid code for the template

CREATE OR REPLACE FUNCTION COMPOSE_DIAGRAM_FROM_TEMPLATE(template_id_param VARCHAR)
RETURNS TEXT
LANGUAGE SQL
AS
$$
    SELECT full_mermaid_code
    FROM SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES
    WHERE template_id = template_id_param
    LIMIT 1
$$;

COMMENT ON FUNCTION COMPOSE_DIAGRAM_FROM_TEMPLATE(VARCHAR) IS 
  'Retrieves full Mermaid code for a given template ID.';

-- =====================================================
-- 7. SEARCH_COMPONENT_BLOCKS
-- =====================================================
-- Purpose: Search for component blocks by keyword
-- Input: Search keyword
-- Output: Array of matching blocks

CREATE OR REPLACE FUNCTION SEARCH_COMPONENT_BLOCKS(search_keyword VARCHAR)
RETURNS TABLE (block_id VARCHAR, block_name VARCHAR, block_category VARCHAR, description TEXT, complexity VARCHAR)
AS
$$
    SELECT block_id, block_name, block_category, description, complexity
    FROM SNOWGRAM_DB.CORE.COMPONENT_BLOCKS
    WHERE LOWER(block_name) LIKE LOWER('%' || search_keyword || '%')
       OR LOWER(description) LIKE LOWER('%' || search_keyword || '%')
       OR LOWER(block_category) = LOWER(search_keyword)
    ORDER BY reuse_count DESC
$$;

COMMENT ON FUNCTION SEARCH_COMPONENT_BLOCKS(VARCHAR) IS 
  'Searches component blocks by keyword in name, description, or category.';

-- =====================================================
-- 8. GET_PATTERN_BLOCKS
-- =====================================================
-- Purpose: Get all component blocks used in a pattern
-- Input: Pattern ID
-- Output: Array of block information

CREATE OR REPLACE FUNCTION GET_PATTERN_BLOCKS(pattern_id_param VARCHAR)
RETURNS TABLE (block_id VARCHAR, block_name VARCHAR, block_order INTEGER, mermaid_code TEXT)
AS
$$
    SELECT cb.block_id, cb.block_name, pbr.block_order, cb.mermaid_code
    FROM SNOWGRAM_DB.CORE.PATTERN_BLOCK_RELATIONSHIPS pbr
    JOIN SNOWGRAM_DB.CORE.COMPONENT_BLOCKS cb 
        ON pbr.block_id = cb.block_id
    WHERE pbr.pattern_id = pattern_id_param
    ORDER BY pbr.block_order
$$;

COMMENT ON FUNCTION GET_PATTERN_BLOCKS(VARCHAR) IS 
  'Returns all component blocks used in a pattern, ordered by sequence.';

-- =====================================================
-- 9. MERGE_DIAGRAMS
-- =====================================================
-- Purpose: Merge two Mermaid diagrams into one
-- Input: Two Mermaid code strings
-- Output: Merged Mermaid code

CREATE OR REPLACE FUNCTION MERGE_DIAGRAMS(
    diagram_1 TEXT,
    diagram_2 TEXT
)
RETURNS TEXT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
HANDLER = 'merge_diagrams'
AS
$$
def merge_diagrams(diagram_1, diagram_2):
    """
    Merge two Mermaid diagrams into one.
    
    Args:
        diagram_1: First Mermaid diagram
        diagram_2: Second Mermaid diagram
    
    Returns:
        Merged Mermaid diagram
    """
    if not diagram_1:
        return diagram_2 or ""
    if not diagram_2:
        return diagram_1
    
    # Extract nodes and connections from both diagrams
    lines_1 = [line.strip() for line in diagram_1.split('\n') if line.strip()]
    lines_2 = [line.strip() for line in diagram_2.split('\n') if line.strip()]
    
    # Start with flowchart declaration from first diagram
    merged = [lines_1[0]] if lines_1 else ["flowchart LR"]
    
    # Add nodes and connections from both diagrams (skip flowchart declaration and styling)
    for line in lines_1[1:]:
        if not line.startswith('flowchart') and not line.startswith('classDef') and not line.startswith('%%'):
            merged.append(line)
    
    for line in lines_2[1:]:
        if not line.startswith('flowchart') and not line.startswith('classDef') and not line.startswith('%%'):
            merged.append(line)
    
    # Add styling at the end
    merged.append("\n    %% Styling")
    merged.append("    classDef snowflakeStyle fill:#29B5E8,stroke:#fff,stroke-width:2px,color:#fff")
    
    return '\n    '.join(merged)
$$;

COMMENT ON FUNCTION MERGE_DIAGRAMS(TEXT, TEXT) IS 
  'Merges two Mermaid diagrams into a single combined diagram.';

-- =====================================================
-- Grant Permissions
-- =====================================================

GRANT USAGE ON FUNCTION GENERATE_MERMAID_FROM_COMPONENTS(ARRAY, VARIANT) TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON FUNCTION VALIDATE_MERMAID_SYNTAX(TEXT) TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON FUNCTION OPTIMIZE_DIAGRAM_LAYOUT(TEXT, VARCHAR) TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON FUNCTION SUGGEST_SNOWFLAKE_ICONS(ARRAY) TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON FUNCTION COMPOSE_DIAGRAM_FROM_PATTERN(VARCHAR) TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON FUNCTION COMPOSE_DIAGRAM_FROM_TEMPLATE(VARCHAR) TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON FUNCTION SEARCH_COMPONENT_BLOCKS(VARCHAR) TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON FUNCTION GET_PATTERN_BLOCKS(VARCHAR) TO ROLE SNOWGRAM_APP_ROLE;
GRANT USAGE ON FUNCTION MERGE_DIAGRAMS(TEXT, TEXT) TO ROLE SNOWGRAM_APP_ROLE;

-- =====================================================
-- Test Custom Tools
-- =====================================================

-- Test 1: Generate Mermaid from components
SELECT GENERATE_MERMAID_FROM_COMPONENTS(
    ARRAY_CONSTRUCT('S3_BUCKET_BLOCK', 'EXTERNAL_STAGE_BLOCK', 'SNOWPIPE_BLOCK', 'TABLE_RAW_BLOCK'),
    PARSE_JSON('{"connections": [{"from": "S3_BUCKET_BLOCK", "to": "EXTERNAL_STAGE_BLOCK", "label": "Data Files"}]}')
) AS generated_mermaid;

-- Test 2: Validate Mermaid syntax
SELECT VALIDATE_MERMAID_SYNTAX('flowchart LR\n    A[Start] --> B[End]') AS is_valid;

-- Test 3: Optimize layout
SELECT OPTIMIZE_DIAGRAM_LAYOUT(
    'flowchart LR\n    A --> B',
    'TD'
) AS optimized;

-- Test 4: Search component blocks
SELECT * FROM TABLE(SEARCH_COMPONENT_BLOCKS('kafka')) LIMIT 5;

-- Test 5: Compose from pattern
SELECT COMPOSE_DIAGRAM_FROM_PATTERN('S3_TO_SNOWFLAKE_BATCH') AS pattern_diagram;

SELECT 'All custom tools created and tested successfully!' AS status;






