-- =====================================================================
-- SnowGram port: Tier 1 + Tier 2 objects extracted from se_demo
-- =====================================================================
-- Source account : se_demo  (SNOWGRAM_DB)
-- Captured via   : GET_DDL / SHOW / DESCRIBE
-- Author         : Abhinav Bannerjee
--
-- These objects exist in se_demo but have NO CREATE in repo SQL. A fresh
-- deploy from the repo would omit them. Run AFTER the base schema/tables
-- (setup_backend.sql, component_blocks.sql, composed_patterns.sql,
--  full_templates*.sql) so dependencies (CORE.COMPONENTS, CORE.COMPOSED_PATTERNS,
--  CORE.KNOWN_COMPONENT_CLASSIFICATIONS, CORE.SEARCH_COMPONENT_BLOCKS,
--  CORE.SUGGEST_COMPONENTS_FOR_USE_CASE) already exist.
--
-- USAGE VERDICT (verified against the LIVE agent_spec_deployed.yaml + frontend):
--   The live deployed agent calls only: COMPONENT_MAP_SV, COMPOSE_DIAGRAM_FROM_TEMPLATE,
--   COMPOSE_DIAGRAM_FROM_PATTERN, SEARCH_COMPONENT_BLOCKS_JSON, VALIDATE_MERMAID_SYNTAX.
--   The frontend calls NO CORE function directly (it goes through the agent via REST).
--   => Of the objects below, ONLY SEARCH_COMPONENT_BLOCKS_JSON is on the live path.
--      Everything in Section B is LEGACY (referenced only by the archived v4 agent
--      spec / archive docs). Deploy Section B only if you want full parity / the old
--      classification + layout + web-search paths. Safe to skip otherwise.
--
-- TARGET-ACCOUNT NOTE (from the provided screenshot):
--   Target already has CORE.SEARCH_COMPONENT_BLOCKS_JSON and AGENTS.SKILLS_STAGE.
--   Target is MISSING the SEMANTICS schema entirely and everything else below.
-- =====================================================================

USE DATABASE SNOWGRAM_DB;



-- =====================================================================
-- SECTION A — LIVE PATH (required by deployed agent)
-- =====================================================================

USE SCHEMA CORE;

-- [LIVE] agent tool 'SEARCH_COMPONENT_BLOCKS' -> this identifier.
-- Depends on table function CORE.SEARCH_COMPONENT_BLOCKS (defined in repo).

CREATE OR REPLACE FUNCTION "SEARCH_COMPONENT_BLOCKS_JSON"("SEARCH_KEYWORD" VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
COMMENT='JSON wrapper for SEARCH_COMPONENT_BLOCKS table function - returns results as JSON array for Cortex Agent compatibility'
AS '
SELECT TO_VARCHAR(
    ARRAY_AGG(
        OBJECT_CONSTRUCT(
            ''block_id'', BLOCK_ID,
            ''block_name'', BLOCK_NAME,
            ''block_category'', BLOCK_CATEGORY,
            ''description'', DESCRIPTION,
            ''complexity'', COMPLEXITY
        )
    )
)
FROM TABLE(SNOWGRAM_DB.CORE.SEARCH_COMPONENT_BLOCKS(SEARCH_KEYWORD))
';;


-- =====================================================================
-- SECTION B — LEGACY / OPTIONAL (not on live path)
-- =====================================================================


-- B1. SEMANTICS schema + views (entire schema absent on target).
-- Views depend on CORE.COMPONENTS and CORE.COMPOSED_PATTERNS.

CREATE SCHEMA IF NOT EXISTS SNOWGRAM_DB.SEMANTICS
  COMMENT='Semantic models and views for natural language querying';

USE SCHEMA SEMANTICS;

create or replace view COMPONENT_SEMANTIC_MODEL(
	COMPONENT_ID,
	COMPONENT_NAME,
	COMPONENT_TYPE,
	TYPE_CATEGORY,
	DESCRIPTION,
	SNOWFLAKE_OBJECT_TYPE,
	CREATED_AT
) COMMENT='Semantic model view for component metadata and analytics. Query this for component information.'
 as
SELECT 
    c.component_id,
    c.component_name,
    c.component_type,
    c.type_category,
    c.description,
    c.snowflake_object_type,
    c.created_at
FROM SNOWGRAM_DB.CORE.COMPONENTS c;;

create or replace view PATTERN_SEMANTIC_MODEL(
	PATTERN_ID,
	PATTERN_NAME,
	DESCRIPTION,
	COMPONENT_BLOCKS,
	MERMAID_TEMPLATE,
	USE_CASE,
	COMPLEXITY,
	REUSE_COUNT,
	CREATED_AT,
	UPDATED_AT
) COMMENT='Semantic model view for pattern metadata and analytics. Query this for architecture pattern information.'
 as
SELECT 
    p.pattern_id,
    p.pattern_name,
    p.description,
    p.component_blocks,
    p.mermaid_template,
    p.use_case,
    p.complexity,
    p.reuse_count,
    p.created_at,
    p.updated_at
FROM SNOWGRAM_DB.CORE.COMPOSED_PATTERNS p;;


-- B2. CORE legacy tables.

USE SCHEMA CORE;

create or replace TABLE ARCHITECTURE_BEST_PRACTICES (
	PRACTICE_ID VARCHAR(50) NOT NULL,
	USE_CASE VARCHAR(100),
	TITLE VARCHAR(200),
	DESCRIPTION VARCHAR(16777216),
	RECOMMENDATIONS VARCHAR(16777216),
	ANTI_PATTERNS VARCHAR(16777216),
	EXAMPLE_COMPONENTS ARRAY,
	CREATED_AT TIMESTAMP_LTZ(9) DEFAULT CURRENT_TIMESTAMP(),
	primary key (PRACTICE_ID)
);;

-- NOTE: ARCHITECTURE_BEST_PRACTICES holds 7 data rows in se_demo; load separately if GET_ARCHITECTURE_BEST_PRACTICE is used.

create or replace TABLE COMPONENT_CATALOG (
	COMPONENT_TYPE VARCHAR(16777216) NOT NULL,
	DESCRIPTION VARCHAR(16777216),
	primary key (COMPONENT_TYPE)
);;

create or replace TABLE TEMPLATE_HISTORY (
	HISTORY_ID NUMBER(38,0) NOT NULL autoincrement start 1 increment 1 noorder,
	TEMPLATE_ID VARCHAR(16777216) NOT NULL,
	FULL_MERMAID_CODE VARCHAR(16777216) NOT NULL,
	SAVED_AT TIMESTAMP_LTZ(9) DEFAULT CURRENT_TIMESTAMP(),
	SAVED_BY VARCHAR(16777216) DEFAULT CURRENT_USER(),
	primary key (HISTORY_ID)
);;


-- B3. CORE legacy functions.

-- SUGGEST_COMPONENTS_JSON depends on table function CORE.SUGGEST_COMPONENTS_FOR_USE_CASE (repo).

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

-- CALCULATE_DIAGRAM_LAYOUT (Python) MUST precede POSITION_DIAGRAM_NODES (calls it).

CREATE OR REPLACE FUNCTION "CALCULATE_DIAGRAM_LAYOUT"("NODES" ARRAY, "EDGES" ARRAY, "LAYOUT_TYPE" VARCHAR DEFAULT 'medallion')
RETURNS OBJECT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
HANDLER = 'calculate_layout'
AS '
import json

def calculate_layout(nodes, edges, layout_type=''medallion''):
    """
    Calculate grid-based layout for diagram nodes and assign edge handles.
    
    Args:
        nodes: Array of node objects with id, label, componentType
        edges: Array of edge objects with source, target
        layout_type: ''medallion'' for medallion architecture, ''grid'' for generic grid
    
    Returns:
        Object with positioned nodes, edges with handles, and layout metadata
    """
    # Layout constants
    BASE_X = 100
    BASE_Y = 180
    COL_WIDTH = 200
    ROW_HEIGHT = 160
    NODE_WIDTH = 150
    NODE_HEIGHT = 130
    
    # Parse inputs
    node_list = nodes if isinstance(nodes, list) else json.loads(nodes) if nodes else []
    edge_list = edges if isinstance(edges, list) else json.loads(edges) if edges else []
    
    # Medallion layer detection
    def detect_layer(node_id, label):
        text = f"{node_id} {label}".lower()
        if any(k in text for k in [''bronze'', ''raw'', ''landing'', ''ingest'']):
            return ''bronze''
        if any(k in text for k in [''silver'', ''clean'', ''transform'', ''validated'']):
            return ''silver''
        if any(k in text for k in [''gold'', ''curated'', ''refined'', ''business'', ''mart'']):
            return ''gold''
        if any(k in text for k in [''s3'', ''aws'', ''kafka'', ''external'', ''lake'']):
            return ''external''
        if any(k in text for k in [''analytics'', ''dashboard'', ''bi_'', ''warehouse'', ''compute'']):
            return ''consumption''
        return ''default''
    
    # Medallion slot assignments
    MEDALLION_SLOTS = {
        # (layer, component_type): (col, row)
        (''external'', ''any''): (-1, 0),
        (''external'', ''Snowpipe''): (-1, 1),
        (''bronze'', ''Database''): (0, 0),
        (''bronze'', ''Schema''): (0, 1),
        (''bronze'', ''Table''): (0, 2),
        (''silver'', ''Database''): (1, 0),
        (''silver'', ''Schema''): (1, 1),
        (''silver'', ''Table''): (1, 2),
        (''gold'', ''Database''): (2, 0),
        (''gold'', ''Schema''): (2, 1),
        (''gold'', ''Table''): (2, 2),
        (''consumption'', ''View''): (3, 0),
        (''consumption'', ''Warehouse''): (3, 1),
    }
    
    def get_slot(layer, comp_type):
        key = (layer, comp_type)
        if key in MEDALLION_SLOTS:
            return MEDALLION_SLOTS[key]
        key = (layer, ''any'')
        if key in MEDALLION_SLOTS:
            return MEDALLION_SLOTS[key]
        return None
    
    # Position nodes
    positioned_nodes = []
    node_positions = {}  # id -> {x, y}
    used_slots = set()
    extra_col = 4
    extra_row = 0
    
    for node in node_list:
        node_id = node.get(''id'', '''')
        label = node.get(''label'', node_id)
        comp_type = node.get(''componentType'', ''Table'')
        
        layer = detect_layer(node_id, label)
        slot = get_slot(layer, comp_type) if layout_type == ''medallion'' else None
        
        if slot and slot not in used_slots:
            col, row = slot
            used_slots.add(slot)
        else:
            # Place extras in rightmost columns
            col, row = extra_col, extra_row
            extra_row += 1
            if extra_row > 2:
                extra_row = 0
                extra_col += 1
        
        x = BASE_X + col * COL_WIDTH
        y = BASE_Y + row * ROW_HEIGHT
        
        node_positions[node_id] = {''x'': x, ''y'': y, ''col'': col, ''row'': row}
        
        positioned_nodes.append({
            ''id'': node_id,
            ''label'': label,
            ''componentType'': comp_type,
            ''position'': {''x'': x, ''y'': y},
            ''layer'': layer,
            ''row'': row,
            ''col'': col,
            ''style'': {
                ''width'': NODE_WIDTH,
                ''height'': NODE_HEIGHT
            }
        })
    
    # Assign edge handles based on relative positions
    def pick_handles(source_pos, target_pos):
        dx = target_pos[''x''] - source_pos[''x'']
        dy = target_pos[''y''] - source_pos[''y'']
        
        if abs(dy) > abs(dx):
            # Primarily vertical
            if dy > 0:
                return ''bottom-source'', ''top-target''
            else:
                return ''top-source'', ''bottom-target''
        else:
            # Primarily horizontal
            if dx > 0:
                return ''right-source'', ''left-target''
            else:
                return ''left-source'', ''right-target''
    
    positioned_edges = []
    for i, edge in enumerate(edge_list):
        source = edge.get(''source'', '''')
        target = edge.get(''target'', '''')
        
        source_pos = node_positions.get(source, {''x'': 0, ''y'': 0})
        target_pos = node_positions.get(target, {''x'': COL_WIDTH, ''y'': 0})
        
        source_handle, target_handle = pick_handles(source_pos, target_pos)
        
        positioned_edges.append({
            ''id'': f"e-{source}-{target}-{i}",
            ''source'': source,
            ''target'': target,
            ''sourceHandle'': source_handle,
            ''targetHandle'': target_handle,
            ''type'': ''straight'',
            ''animated'': True
        })
    
    return {
        ''nodes'': positioned_nodes,
        ''edges'': positioned_edges,
        ''layout'': {
            ''type'': layout_type,
            ''direction'': ''LR'',
            ''baseX'': BASE_X,
            ''baseY'': BASE_Y,
            ''colWidth'': COL_WIDTH,
            ''rowHeight'': ROW_HEIGHT,
            ''nodeWidth'': NODE_WIDTH,
            ''nodeHeight'': NODE_HEIGHT
        }
    }
';;

CREATE OR REPLACE FUNCTION "POSITION_DIAGRAM_NODES"("NODES_JSON" VARCHAR, "EDGES_JSON" VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
AS '
    SELECT TO_JSON(SNOWGRAM_DB.CORE.CALCULATE_DIAGRAM_LAYOUT(
        PARSE_JSON(nodes_json),
        PARSE_JSON(edges_json),
        ''medallion''
    ))::VARCHAR
';;

-- CLASSIFY_COMPONENT_LEARN depends on CORE.KNOWN_COMPONENT_CLASSIFICATIONS (repo).
-- Uses SNOWFLAKE.CORTEX.COMPLETE verbatim from source (consider AI_COMPLETE on modernization).

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


-- B4. WEB_SEARCH external-access chain (account-level objects first).
-- Requires ACCOUNTADMIN (or CREATE INTEGRATION priv). Network rule -> EAI -> function.

CREATE OR REPLACE NETWORK RULE SNOWGRAM_DB.CORE.DDG_NETWORK_RULE
  MODE = EGRESS
  TYPE = HOST_PORT
  VALUE_LIST = ('html.duckduckgo.com','duckduckgo.com','lite.duckduckgo.com');

CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION DDG_ACCESS
  ALLOWED_NETWORK_RULES = (SNOWGRAM_DB.CORE.DDG_NETWORK_RULE)
  ENABLED = TRUE;

CREATE OR REPLACE FUNCTION "WEB_SEARCH"("QUERY" VARCHAR)
RETURNS TABLE ("TITLE" VARCHAR, "SNIPPET" VARCHAR, "URL" VARCHAR)
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('requests','beautifulsoup4')
HANDLER = 'WebSearchHandler'
EXTERNAL_ACCESS_INTEGRATIONS = (DDG_ACCESS)
COMMENT='Free web search via DuckDuckGo HTML endpoint. No API key required.'
AS '
import requests
from bs4 import BeautifulSoup
import urllib.parse

class WebSearchHandler:
    def process(self, query):
        """Search DuckDuckGo and return top results."""
        try:
            # URL encode the query
            encoded_query = urllib.parse.quote_plus(query)
            url = f"https://html.duckduckgo.com/html/?q={encoded_query}"
            
            headers = {
                ''User-Agent'': ''Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36''
            }
            
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.text, ''html.parser'')
            
            # DuckDuckGo HTML results structure
            results = soup.select(''.result__body'')[:5]
            
            for result in results:
                title_el = result.select_one(''.result__title'')
                snippet_el = result.select_one(''.result__snippet'')
                url_el = result.select_one(''.result__url'')
                
                if title_el:
                    title = title_el.get_text(strip=True)
                    snippet = snippet_el.get_text(strip=True) if snippet_el else ''''
                    result_url = url_el.get_text(strip=True) if url_el else ''''
                    yield (title, snippet, result_url)
                    
        except Exception as e:
            # Return error info if search fails
            yield (f"Search Error", str(e), "")
';;


-- =====================================================================
-- SECTION C — STAGES (GET_DDL unsupported; rebuilt from SHOW STAGES)
-- =====================================================================

-- Stage OBJECTS only. Their FILE CONTENTS must be re-uploaded via PUT (see migration notes).

-- AGENTS.SKILLS_STAGE already exists on target (holds clarify/ + edit_existing/ SKILL.md).

CREATE STAGE IF NOT EXISTS SNOWGRAM_DB.AGENTS.SKILLS_STAGE
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
  COMMENT = 'Hosts Cortex Agent skill folders (SKILL.md files) for SNOWGRAM_AGENT';

CREATE STAGE IF NOT EXISTS SNOWGRAM_DB.CORE.AGENT_SPECS;

CREATE STAGE IF NOT EXISTS SNOWGRAM_DB.CORE.VISUAL_TEST_IMAGES
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
  DIRECTORY = (ENABLE = TRUE);

CREATE STAGE IF NOT EXISTS SNOWGRAM_DB.KNOWLEDGE.REFERENCE_DOCS
  DIRECTORY = (ENABLE = TRUE)
  COMMENT = 'Stage for reference architecture documents';

CREATE STAGE IF NOT EXISTS SNOWGRAM_DB.KNOWLEDGE.REFERENCE_DOCS_UNENC
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
  DIRECTORY = (ENABLE = TRUE)
  COMMENT = 'Stage for reference architecture documents (SSE for Document AI)';


-- =====================================================================
-- END
-- =====================================================================
