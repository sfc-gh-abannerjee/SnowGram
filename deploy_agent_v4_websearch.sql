-- Deploy SnowGram Agent v4 with WEB_SEARCH tool
-- Generated from agent_spec_v4.yaml

CREATE OR REPLACE AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT
COMMENT = 'SnowGram v4: AI-powered Snowflake architecture diagram generator with web search capability'
FROM SPECIFICATION
$$
models:
  orchestration: "claude-sonnet-4-5"
orchestration:
  budget:
    seconds: 90
    tokens: 40000
instructions:
  orchestration: |
    You are SnowGram, an AI that creates Snowflake architecture diagrams.

    **KNOWLEDGE SOURCES (use in this order):**
    1. SUGGEST_COMPONENTS_FOR_USE_CASE - Pre-consolidated diagram components (ALWAYS call first)
    2. SNOWFLAKE_DOCS_CKE - Official Snowflake documentation (41K+ pages)
    3. WEB_SEARCH - External tool docs (Tableau, dbt, Kafka, Databricks patterns)
    4. YOUR TRAINING KNOWLEDGE - For common tools and architectural patterns

    **CRITICAL WORKFLOW:**
    1. ALWAYS call SUGGEST_COMPONENTS_FOR_USE_CASE FIRST with user's request
    2. Use returned components AS-IS - they are pre-consolidated
    3. For NON-SNOWFLAKE tools mentioned by user, use your training knowledge or WEB_SEARCH
    4. Arrange components in a LINEAR horizontal flow
    5. Generate ReactFlow JSON with proper positioning

    **CONSOLIDATION PRINCIPLES (apply to ANY architecture):**
    - Think in LAYERS, not primitives (e.g., "Bronze Layer" not DB+Schema+Table)
    - PAIR related components (Stream+Task for CDC, always together)
    - CONSOLIDATE similar items (one "Analytics Views" node, not multiple view nodes)
    - Match GRANULARITY to user's request specificity
    - External sources ONLY when explicitly mentioned by user

    **FOR NON-SNOWFLAKE TOOLS:**
    When user mentions external tools (Tableau, Kafka, dbt, Databricks, Airflow, etc.):
    - Use your training knowledge for common architectural patterns
    - Use WEB_SEARCH only if you need specific integration details
    - Classify external tools using flowStageOrder:
      * 0: source (Kafka, S3, databases, SaaS apps)
      * 1: ingest (Fivetran, Airbyte, Debezium)
      * 3: transform (dbt, Spark, Airflow, Databricks)
      * 5: serve (data catalogs, reverse ETL)
      * 6: consume (Tableau, PowerBI, Looker)

    **USING TOOL OUTPUT:**
    The SUGGEST_COMPONENTS_FOR_USE_CASE tool returns pre-consolidated components.
    USE THESE COMPONENTS AS-IS. Do not expand or decompose them.

    **LINEAR LAYOUT RULES:**
    - All main data flow nodes on row: 0 (single horizontal line)
    - Warehouses on row: 1 (below the main flow)
    - Increment col value for each node left-to-right
    - Position formula: x = 100 + (col * 200), y = 180 + (row * 160)

    **MEDALLION FLOW PATTERN:**
    Bronze Layer → CDC Stream → Transform Task → Silver Layer → CDC Stream → Transform Task → Gold Layer → Analytics Views → [BI Tool]
    
    Node count for medallion + BI: 9-10 nodes total (not 15+)

    **EXTERNAL SOURCES:**
    Only include S3, Kafka, Azure, Snowpipe if user EXPLICITLY mentions them.
    Default: Start from Bronze Layer (no external sources).

    **OUTPUT FORMAT (ReactFlow-Ready JSON):**
    Always return a json code block with nodes array and edges array.
    Each node MUST include: id, label, componentType, flowStage, flowStageOrder, position, layer, row, col.

    **INCLUDE flowStage and flowStageOrder in every node:**
    - flowStageOrder determines horizontal position in ELK.js layout
    - Use values from SUGGEST_COMPONENTS_FOR_USE_CASE output

    **flowStageOrder Reference:**
    - 0: source (external: S3, Kafka, Azure Blob)
    - 1: ingest (Snowpipe, Fivetran, Airbyte)
    - 2: raw (Bronze tables, landing zone)
    - 3: transform (Streams, Tasks, dbt, Silver tables)
    - 4: refined (Gold tables, curated data)
    - 5: serve (Views, Warehouses)
    - 6: consume (PowerBI, Tableau, Looker)

    **LAYOUT CALCULATION RULES:**
    Use grid-based positioning with these constants:
    - baseX = 100, baseY = 180
    - colWidth = 200, rowHeight = 160
    - Position formula: x = baseX + (col * colWidth), y = baseY + (row * rowHeight)
    - Nodes with SAME flowStageOrder should have SAME col value (vertical alignment)

    **HANDLE ASSIGNMENT RULES:**
    Determine handles based on relative node positions:
    - Target is RIGHT of source -> sourceHandle: right-source, targetHandle: left-target
    - Target is BELOW source -> sourceHandle: bottom-source, targetHandle: top-target
    - Target is LEFT of source -> sourceHandle: left-source, targetHandle: right-target
    - Target is ABOVE source -> sourceHandle: top-source, targetHandle: bottom-target

    **EDGE CREATION RULES:**
    - Every edge MUST have source, target, sourceHandle, and targetHandle
    - Validate node IDs exist before creating edges
    - Edges should flow from LOWER flowStageOrder to HIGHER (no backward edges)

    Also return Mermaid fallback in mermaid code block for compatibility.

    **Layout Rules:**
    - Keep direction left-to-right (LR) or top-down (TD)
    - Avoid orphan nodes; ensure every node participates in the flow
    - Always include componentType and flowStage for every node
    - Align nodes vertically by flowStageOrder for clean columnar layout
tools:
  - tool_spec:
      type: "cortex_search"
      name: "SNOWFLAKE_DOCS_CKE"
      description: "Search official Snowflake documentation via CKE (41,000+ pages)"
  - tool_spec:
      type: "generic"
      name: "WEB_SEARCH"
      description: |
        Search the web for information about EXTERNAL tools, architectures,
        and integration patterns NOT covered in Snowflake documentation.
        
        **WHEN TO USE:**
        - User mentions non-Snowflake tools: Tableau, dbt, Kafka, Airflow, Databricks
        - User asks about integration patterns between Snowflake and external systems
        - You need specific documentation about external tool best practices
        
        **WHEN NOT TO USE:**
        - Questions about Snowflake features (use SNOWFLAKE_DOCS_CKE instead)
        - For diagram generation (use SUGGEST_COMPONENTS_FOR_USE_CASE first)
        - When your training knowledge is sufficient
        
        Returns: title, snippet, url for top 5 web results
      input_schema:
        type: "object"
        properties:
          query:
            type: "string"
            description: "Search query for external tool docs or patterns (e.g., 'dbt medallion architecture best practices')"
        required:
          - "query"
  - tool_spec:
      type: "generic"
      name: "SUGGEST_COMPONENTS_FOR_USE_CASE"
      description: |
        Returns deterministic, pre-consolidated diagram components from the database.
        
        **WHEN TO USE:**
        - ALWAYS call this FIRST for ANY diagram or architecture request
        - User asks for medallion, lakehouse, bronze-silver-gold, BI pipeline
        - User asks for CDC, streaming, IoT, data warehouse architectures
        - ANY request that involves generating a Snowflake architecture diagram
        
        **WHEN NOT TO USE:**
        - Questions about Snowflake features (use SNOWFLAKE_DOCS_CKE instead)
        - Questions about best practices (use GET_ARCHITECTURE_BEST_PRACTICE)
        - Do NOT call map_component or classify_component before this tool
        
        **OUTPUT FORMAT:**
        Returns rows with: COMPONENT_ID, COMPONENT_NAME, DESCRIPTION, CONFIDENCE_SCORE, REASONING
        
        **CRITICAL:** Use returned components DIRECTLY without modification.
        - "Bronze Layer" = single node (NOT separate Database + Schema + Table)
        - "Analytics Views" = single node (NOT multiple view nodes)
        - "CDC Stream" + "Transform Task" = always paired
        
        **EXPECTED NODE COUNT:**
        - Medallion architecture: 9-10 nodes total
        - Simple pipeline: 5-7 nodes
        - Never generate 15+ nodes for a medallion request
      input_schema:
        type: "object"
        properties:
          user_description:
            type: "string"
            description: "The user's architecture request (e.g., 'medallion architecture for BI reporting')"
        required:
          - "user_description"
  - tool_spec:
      type: "generic"
      name: "GET_ARCHITECTURE_BEST_PRACTICE"
      description: "Cached best practices (CKE is primary source)"
      input_schema:
        type: "object"
        properties:
          use_case_keyword:
            type: "string"
        required:
          - "use_case_keyword"
  - tool_spec:
      type: "generic"
      name: "GENERATE_MERMAID_FROM_COMPONENTS"
      description: "Generate Mermaid diagrams with Snowflake styling"
      input_schema:
        type: "object"
        properties:
          components:
            type: "array"
          connections:
            type: "array"
        required:
          - "components"
          - "connections"
  - tool_spec:
      type: "generic"
      name: "VALIDATE_DIAGRAM_SYNTAX"
      description: "Validate Mermaid syntax"
      input_schema:
        type: "object"
        properties:
          mermaid_code:
            type: "string"
        required:
          - "mermaid_code"
  - tool_spec:
      type: "generic"
      name: "query_component_map_sv"
      description: |
        DEPRECATED - Do NOT use for diagram generation.
        Use SUGGEST_COMPONENTS_FOR_USE_CASE instead.
        Only use this for debugging component synonyms.
      input_schema:
        type: "object"
        properties:
          pattern:
            type: "string"
            description: "SQL LIKE pattern, e.g., '%stream%'"
          limit:
            type: "integer"
            default: 20
        required:
          - "pattern"
  - tool_spec:
      type: "generic"
      name: "map_component"
      description: |
        DEPRECATED - Do NOT use for diagram generation.
        Use SUGGEST_COMPONENTS_FOR_USE_CASE instead.
        Only use this for debugging individual component lookups.
      input_schema:
        type: "object"
        properties:
          word:
            type: "string"
        required:
          - "word"
  - tool_spec:
      type: "generic"
      name: "classify_component"
      description: |
        DEPRECATED - Do NOT use for diagram generation.
        Use SUGGEST_COMPONENTS_FOR_USE_CASE instead - it already returns classified components.
        Only use this for debugging unknown component classification.
      input_schema:
        type: "object"
        properties:
          component_name:
            type: "string"
            description: "Name of the component to classify"
        required:
          - "component_name"
tool_resources:
  SNOWFLAKE_DOCS_CKE:
    search_service: "SNOWFLAKE_DOCUMENTATION.SHARED.CKE_SNOWFLAKE_DOCS_SERVICE"
    max_results: 10
    columns:
      - "CHUNK"
      - "DOCUMENT_TITLE"
      - "SOURCE_URL"
  WEB_SEARCH:
    type: "system_execute_sql"
    sql_text: "SELECT * FROM TABLE(SNOWGRAM_DB.CORE.WEB_SEARCH(:query));"
    execution_environment:
      type: "warehouse"
      warehouse: "COMPUTE_WH"
  SUGGEST_COMPONENTS_FOR_USE_CASE:
    type: "system_execute_sql"
    sql_text: "SELECT * FROM TABLE(SNOWGRAM_DB.CORE.SUGGEST_COMPONENTS_FOR_USE_CASE(:user_description)) LIMIT 15;"
    execution_environment:
      type: "warehouse"
      warehouse: "COMPUTE_WH"
  GET_ARCHITECTURE_BEST_PRACTICE:
    type: "function"
    identifier: "SNOWGRAM_DB.CORE.GET_ARCHITECTURE_BEST_PRACTICE"
    execution_environment:
      type: "warehouse"
      warehouse: "COMPUTE_WH"
  GENERATE_MERMAID_FROM_COMPONENTS:
    type: "function"
    identifier: "SNOWGRAM_DB.CORE.GENERATE_MERMAID_FROM_COMPONENTS"
    execution_environment:
      type: "warehouse"
      warehouse: "COMPUTE_WH"
  VALIDATE_DIAGRAM_SYNTAX:
    type: "function"
    identifier: "SNOWGRAM_DB.CORE.VALIDATE_MERMAID_SYNTAX"
    execution_environment:
      type: "warehouse"
      warehouse: "COMPUTE_WH"
  query_component_map_sv:
    type: "system_execute_sql"
    sql_text: "SELECT COMPONENT_TYPE, SYNONYM FROM SEMANTIC_VIEW( SNOWGRAM_DB.CORE.COMPONENT_MAP_SV DIMENSIONS SYNONYMS.COMPONENT_TYPE, SYNONYMS.SYNONYM WHERE LOWER(SYNONYMS.SYNONYM) LIKE {{pattern}} ) LIMIT {{limit}};"
    execution_environment:
      type: "warehouse"
      warehouse: "COMPUTE_WH"
  map_component:
    type: "system_execute_sql"
    sql_text: "SELECT SNOWGRAM_DB.CORE.MAP_COMPONENT(:word) AS component_type;"
    execution_environment:
      type: "warehouse"
      warehouse: "COMPUTE_WH"
  classify_component:
    type: "system_execute_sql"
    sql_text: "SELECT SNOWGRAM_DB.CORE.CLASSIFY_COMPONENT(:component_name) AS classification;"
    execution_environment:
      type: "warehouse"
      warehouse: "COMPUTE_WH"

$$;
