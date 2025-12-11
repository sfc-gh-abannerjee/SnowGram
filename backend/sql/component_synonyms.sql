-- SnowGram component synonym mapping
-- Run in SNOWGRAM_DB.CORE

create schema if not exists SNOWGRAM_DB.CORE;

create or replace table SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS (
  synonym string not null,
  component_type string not null,
  weight number default 1,
  comment string
);

-- Core objects
insert into SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS (synonym, component_type) values
  ('database', 'Database'),
  ('db', 'Database'),
  ('datastore', 'Database'),
  ('schema', 'Schema'),
  ('schemas', 'Schema'),
  ('table', 'Table'),
  ('tables', 'Table'),
  ('view', 'View'),
  ('views', 'View'),
  ('stage', 'Table'),
  ('staging', 'Table'),
  ('landing', 'Table'),
  ('rawdata', 'Table'),
  ('curateddata', 'Table'),
  ('csv', 'Table'),
  ('csvfiles', 'Table'),
  ('file', 'Table'),
  ('files', 'Table');

-- Warehouses
insert into SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS (synonym, component_type) values
  ('warehouse', 'Warehouse'),
  ('wh', 'Warehouse'),
  ('datawarehouse', 'Data WH'),
  ('datawh', 'Data WH'),
  ('virtualwh', 'Virtual WH'),
  ('snowparkwh', 'Snowpark WH'),
  ('adaptivewh', 'Adaptive WH'),
  ('snowflake', 'Warehouse');

-- Pipelines / ingest
insert into SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS (synonym, component_type) values
  ('stream', 'Stream'),
  ('streams', 'Stream'),
  ('api', 'Stream'),
  ('apis', 'Stream'),
  ('source', 'Stream'),
  ('sources', 'Stream'),
  ('ingest', 'Snowpipe'),
  ('ingestion', 'Snowpipe'),
  ('snowpipe', 'Snowpipe'),
  ('extract', 'Snowpipe'),
  ('pull', 'Snowpipe'),
  ('connect', 'Snowpipe'),
  ('load', 'Snowpipe');

-- Transform / orchestration
insert into SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS (synonym, component_type) values
  ('task', 'Task'),
  ('tasks', 'Task'),
  ('transform', 'Task'),
  ('transformation', 'Task'),
  ('clean', 'Task'),
  ('validate', 'Task'),
  ('aggregate', 'Task'),
  ('format', 'Task'),
  ('process', 'Task'),
  ('businessrules', 'Task');

-- Analytics / monitoring
insert into SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS (synonym, component_type) values
  ('analytics', 'View'),
  ('report', 'View'),
  ('reports', 'View'),
  ('reporting', 'View'),
  ('dashboard', 'View'),
  ('metrics', 'View'),
  ('monitor', 'View'),
  ('monitoring', 'View'),
  ('logging', 'View');

-- Semantic view for fast lookup
create or replace view SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS_V as
select
  synonym,
  component_type,
  weight,
  comment
from SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS;

-- Optional: a lookup UDF (pseudo, adjust permissions as needed)
-- create or replace function SNOWGRAM_DB.CORE.MAP_COMPONENT(word string)
-- returns string
-- language sql
-- as
-- $$ select component_type
--    from SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS
--    where synonym = lower(regexp_replace(word, '[^a-zA-Z0-9]', ''))
--    qualify row_number() over (order by weight desc) = 1 $$;







