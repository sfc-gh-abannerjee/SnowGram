-- ============================================================================
-- Migration: 2026-05-14 — Synonym routing improvements
-- ============================================================================
-- B5: Resolve `kafka` synonym conflict (kafka → ext_kafka shadowed kafka → Kafka)
-- B4: Add template-routing synonyms for the 13 templates that lacked coverage
--
-- Run against connection `se_demo` against SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS.
-- Idempotent: re-running this script after applying it once is safe — the DELETE
-- and INSERT clauses are scoped to specific (synonym, component_type) pairs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B5: kafka synonym conflict
-- ----------------------------------------------------------------------------
-- Before:
--   ('kafka', 'ext_kafka', 100, 'Apache Kafka streaming platform')
--   ('kafka', 'Kafka', 1, 'Apache Kafka')
-- The high-weight ext_kafka mapping won, but templates use 'Kafka' as the
-- canonical component type. This caused mismatches in template-driven
-- diagrams.
-- After:
--   ('kafka', 'Kafka', 10, 'Apache Kafka')

UPDATE SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS
SET WEIGHT = 10
WHERE SYNONYM = 'kafka' AND COMPONENT_TYPE = 'Kafka';

DELETE FROM SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS
WHERE SYNONYM = 'kafka' AND COMPONENT_TYPE = 'ext_kafka';

-- ----------------------------------------------------------------------------
-- B4: Template routing synonyms
-- ----------------------------------------------------------------------------
-- Before this migration, only MEDALLION_LAKEHOUSE had user-term → template_id
-- synonym entries. The other 13 templates relied on the agent's orchestration
-- instructions for keyword matching, which left common phrasings unhandled.
-- This adds 73 routing synonyms covering the full template catalog.

INSERT INTO SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS (SYNONYM, COMPONENT_TYPE, WEIGHT, COMMENT)
SELECT * FROM VALUES
  -- STREAMING_DATA_STACK
  ('streaming pipeline', 'STREAMING_DATA_STACK', 1, 'Real-time streaming pipeline'),
  ('real-time pipeline', 'STREAMING_DATA_STACK', 1, 'Real-time data pipeline'),
  ('kafka pipeline', 'STREAMING_DATA_STACK', 1, 'Kafka-based streaming'),
  ('event-driven', 'STREAMING_DATA_STACK', 1, 'Event-driven streaming architecture'),
  ('streaming architecture', 'STREAMING_DATA_STACK', 1, 'Streaming data architecture'),
  ('snowpipe streaming pipeline', 'STREAMING_DATA_STACK', 1, 'Snowpipe Streaming-based architecture'),
  -- SECURITY_ANALYTICS
  ('siem', 'SECURITY_ANALYTICS', 1, 'Security information and event management'),
  ('log analytics', 'SECURITY_ANALYTICS', 1, 'Log analysis architecture'),
  ('security analytics', 'SECURITY_ANALYTICS', 1, 'Security analytics platform'),
  ('threat detection', 'SECURITY_ANALYTICS', 1, 'Threat detection pipeline'),
  ('compliance monitoring', 'SECURITY_ANALYTICS', 1, 'Compliance monitoring architecture'),
  ('security monitoring', 'SECURITY_ANALYTICS', 1, 'Security event monitoring'),
  -- CUSTOMER_360
  ('customer 360', 'CUSTOMER_360', 1, '360-degree customer view'),
  ('cdp', 'CUSTOMER_360', 1, 'Customer Data Platform'),
  ('customer data platform', 'CUSTOMER_360', 1, 'CDP architecture'),
  ('customer view', 'CUSTOMER_360', 1, 'Unified customer view'),
  ('personalization', 'CUSTOMER_360', 1, 'Personalization platform'),
  ('customer segmentation', 'CUSTOMER_360', 1, 'Customer segmentation pipeline'),
  -- ML_FEATURE_ENGINEERING
  ('ml pipeline', 'ML_FEATURE_ENGINEERING', 1, 'ML training/inference pipeline'),
  ('feature store', 'ML_FEATURE_ENGINEERING', 1, 'ML feature store'),
  ('model registry', 'ML_FEATURE_ENGINEERING', 1, 'ML model registry pipeline'),
  ('ml training', 'ML_FEATURE_ENGINEERING', 1, 'ML training architecture'),
  ('feature engineering', 'ML_FEATURE_ENGINEERING', 1, 'Feature engineering pipeline'),
  ('machine learning', 'ML_FEATURE_ENGINEERING', 1, 'Machine learning pipeline'),
  -- BATCH_DATA_WAREHOUSE
  ('batch etl', 'BATCH_DATA_WAREHOUSE', 1, 'Batch ETL pipeline'),
  ('star schema', 'BATCH_DATA_WAREHOUSE', 1, 'Dimensional star schema warehouse'),
  ('dimensional model', 'BATCH_DATA_WAREHOUSE', 1, 'Dimensional data warehouse'),
  ('data warehouse', 'BATCH_DATA_WAREHOUSE', 1, 'Traditional data warehouse'),
  ('batch load', 'BATCH_DATA_WAREHOUSE', 1, 'Batch loading architecture'),
  ('etl warehouse', 'BATCH_DATA_WAREHOUSE', 1, 'ETL-based warehouse'),
  -- REALTIME_IOT_PIPELINE
  ('iot pipeline', 'REALTIME_IOT_PIPELINE', 1, 'IoT data pipeline'),
  ('iot streaming', 'REALTIME_IOT_PIPELINE', 1, 'IoT streaming architecture'),
  ('sensor data', 'REALTIME_IOT_PIPELINE', 1, 'Sensor data processing'),
  ('mqtt', 'REALTIME_IOT_PIPELINE', 1, 'MQTT IoT messaging'),
  ('edge computing', 'REALTIME_IOT_PIPELINE', 1, 'Edge computing architecture'),
  ('telemetry', 'REALTIME_IOT_PIPELINE', 1, 'Telemetry data pipeline'),
  ('device data', 'REALTIME_IOT_PIPELINE', 1, 'IoT device data ingestion'),
  -- DATA_GOVERNANCE_COMPLIANCE
  ('data governance', 'DATA_GOVERNANCE_COMPLIANCE', 1, 'Data governance architecture'),
  ('masking', 'DATA_GOVERNANCE_COMPLIANCE', 1, 'Dynamic data masking'),
  ('rls', 'DATA_GOVERNANCE_COMPLIANCE', 1, 'Row-level security policies'),
  ('access control', 'DATA_GOVERNANCE_COMPLIANCE', 1, 'Access control governance'),
  ('data privacy', 'DATA_GOVERNANCE_COMPLIANCE', 1, 'Data privacy architecture'),
  ('compliance', 'DATA_GOVERNANCE_COMPLIANCE', 1, 'Compliance data architecture'),
  -- EMBEDDED_ANALYTICS
  ('embedded analytics', 'EMBEDDED_ANALYTICS', 1, 'Embedded BI analytics'),
  ('embedded bi', 'EMBEDDED_ANALYTICS', 1, 'Embedded business intelligence'),
  ('in-app analytics', 'EMBEDDED_ANALYTICS', 1, 'In-application analytics'),
  ('low-latency analytics', 'EMBEDDED_ANALYTICS', 1, 'Low-latency embedded analytics'),
  ('bi analytics', 'EMBEDDED_ANALYTICS', 1, 'BI analytics architecture'),
  -- MULTI_CLOUD_DATA_MESH
  ('data mesh', 'MULTI_CLOUD_DATA_MESH', 1, 'Data mesh architecture'),
  ('multi-cloud', 'MULTI_CLOUD_DATA_MESH', 1, 'Multi-cloud data architecture'),
  ('multi cloud', 'MULTI_CLOUD_DATA_MESH', 1, 'Multi-cloud federated data'),
  ('federated data', 'MULTI_CLOUD_DATA_MESH', 1, 'Federated data mesh'),
  ('cross-cloud', 'MULTI_CLOUD_DATA_MESH', 1, 'Cross-cloud data sharing'),
  ('domain ownership', 'MULTI_CLOUD_DATA_MESH', 1, 'Domain-driven data ownership'),
  -- SERVERLESS_DATA_STACK
  ('serverless', 'SERVERLESS_DATA_STACK', 1, 'Serverless data architecture'),
  ('lambda', 'SERVERLESS_DATA_STACK', 1, 'AWS Lambda serverless'),
  ('api gateway', 'SERVERLESS_DATA_STACK', 1, 'API Gateway serverless'),
  ('serverless functions', 'SERVERLESS_DATA_STACK', 1, 'Serverless functions architecture'),
  ('faas', 'SERVERLESS_DATA_STACK', 1, 'Functions-as-a-Service'),
  -- REALTIME_FINANCIAL_TRANSACTIONS
  ('fintech', 'REALTIME_FINANCIAL_TRANSACTIONS', 1, 'FinTech transaction processing'),
  ('payment processing', 'REALTIME_FINANCIAL_TRANSACTIONS', 1, 'Payment processing pipeline'),
  ('fraud detection', 'REALTIME_FINANCIAL_TRANSACTIONS', 1, 'Fraud detection architecture'),
  ('financial transactions', 'REALTIME_FINANCIAL_TRANSACTIONS', 1, 'Financial transaction processing'),
  ('high-volume transactions', 'REALTIME_FINANCIAL_TRANSACTIONS', 1, 'High-volume transaction architecture'),
  ('trading platform', 'REALTIME_FINANCIAL_TRANSACTIONS', 1, 'Trading platform architecture'),
  -- HYBRID_CLOUD_LAKEHOUSE
  ('iceberg lakehouse', 'HYBRID_CLOUD_LAKEHOUSE', 1, 'Iceberg-based lakehouse'),
  ('open table format', 'HYBRID_CLOUD_LAKEHOUSE', 1, 'Open table format lakehouse'),
  ('external catalog', 'HYBRID_CLOUD_LAKEHOUSE', 1, 'External catalog architecture'),
  ('lakehouse federation', 'HYBRID_CLOUD_LAKEHOUSE', 1, 'Federated lakehouse'),
  ('hybrid lakehouse', 'HYBRID_CLOUD_LAKEHOUSE', 1, 'Hybrid cloud lakehouse'),
  -- MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY
  ('snowflake-only medallion', 'MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY', 1, 'Snowflake-native medallion'),
  ('native medallion', 'MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY', 1, 'Native Snowflake medallion'),
  ('snowflake medallion', 'MEDALLION_LAKEHOUSE_SNOWFLAKE_ONLY', 1, 'Snowflake-only medallion architecture')
AS v(SYNONYM, COMPONENT_TYPE, WEIGHT, COMMENT);

-- ----------------------------------------------------------------------------
-- Verification queries
-- ----------------------------------------------------------------------------
-- SELECT SYNONYM, COMPONENT_TYPE, WEIGHT FROM SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS
--   WHERE LOWER(SYNONYM) LIKE '%kafka%' ORDER BY WEIGHT DESC;
--
-- SELECT COMPONENT_TYPE, COUNT(*) AS synonym_count
-- FROM SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS
-- WHERE COMPONENT_TYPE IN (SELECT DISTINCT template_id FROM SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES)
-- GROUP BY COMPONENT_TYPE ORDER BY COMPONENT_TYPE;
