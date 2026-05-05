create or replace semantic view COMPONENT_MAP_SV
	tables (
		SYNONYMS as SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS primary key (SYNONYM) with synonyms=('term_mapping','component_lookup','type_resolver') comment='Maps user search terms to canonical Snowflake component types'
	)
	dimensions (
		SYNONYMS.SYNONYM as synonym with synonyms=('search_term','input_word','user_term','keyword'),
		SYNONYMS.COMPONENT_TYPE as component_type with synonyms=('snowflake_component','block_type','diagram_element','node_type'),
		SYNONYMS.WEIGHT as weight
	)
	metrics (
		SYNONYMS.COUNT_ENTRIES as COUNT(*)
	)
	comment='SnowGram component synonym resolver for Cortex Analyst/Agent - maps user terms to valid componentTypes'
	ai_sql_generation '## Purpose
This semantic view maps user terminology to valid SnowGram component types.
Use it to resolve ambiguous or varied user input to canonical component names.

## Query Patterns
- Find component type for a user term: SELECT component_type WHERE synonym = user_term
- Find all synonyms for a component: SELECT synonym WHERE component_type = ComponentType
- Search for partial matches: SELECT DISTINCT component_type WHERE synonym LIKE pattern

## Data Coverage
- 100+ synonyms covering 40+ component types
- Includes: Snowflake native components, external systems, AI/ML, cloud providers
- Case-insensitive matching recommended

## Important Notes
- Always use the returned component_type in diagram generation
- Multiple synonyms may map to the same component_type (that is expected)';
