-- =====================================================
-- SnowGram Monitoring Dashboard Queries
-- =====================================================
-- Purpose: Quick queries for monitoring SnowGram service health
-- Usage: Run these queries in Snowsight for monitoring dashboard
-- =====================================================

USE ROLE SVC_CURSOR_ROLE;
USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

-- =====================================================
-- Real-Time Service Status
-- =====================================================

-- Current service status with all details
SELECT 
    SYSTEM$GET_SERVICE_STATUS('SNOWGRAM_SERVICE') AS raw_status,
    PARSE_JSON(raw_status)[0]:status::STRING AS status,
    PARSE_JSON(raw_status)[0]:message::STRING AS message,
    PARSE_JSON(raw_status)[0]:containerName::STRING AS container,
    PARSE_JSON(raw_status)[0]:instanceId::STRING AS instance,
    PARSE_JSON(raw_status)[0]:restartCount::INTEGER AS restarts,
    PARSE_JSON(raw_status)[0]:startTime::TIMESTAMP AS started_at,
    DATEDIFF(minute, PARSE_JSON(raw_status)[0]:startTime::TIMESTAMP, CURRENT_TIMESTAMP()) AS uptime_minutes,
    CURRENT_TIMESTAMP() AS checked_at;

-- =====================================================
-- Service Instances
-- =====================================================

-- List all service instances
SHOW SERVICE INSTANCES IN SERVICE SNOWGRAM_SERVICE;

-- Instance details with status
SELECT 
    "name" AS instance_name,
    "database_name" AS database,
    "schema_name" AS schema,
    "service_name" AS service,
    "state" AS current_state
FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

-- =====================================================
-- Service Endpoints
-- =====================================================

-- Show all endpoints
SHOW ENDPOINTS IN SERVICE SNOWGRAM_SERVICE;

-- Endpoint details
SELECT
    "name" AS endpoint_name,
    "port" AS port,
    "protocol" AS protocol,
    "is_public" AS public_access,
    "ingress_url" AS public_url
FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

-- =====================================================
-- Service Containers
-- =====================================================

-- List all containers in service
SHOW SERVICE CONTAINERS IN SERVICE SNOWGRAM_SERVICE;

-- =====================================================
-- Resource Usage (from Monitoring Dashboard)
-- =====================================================

-- Current resource usage
SELECT
    check_timestamp,
    service_status,
    restart_count,
    cpu_usage_percent,
    memory_usage_mb,
    health_check_status
FROM SNOWGRAM_MONITORING_DASHBOARD
ORDER BY check_timestamp DESC
LIMIT 1;

-- Resource usage trend (last 24 hours)
SELECT
    DATE_TRUNC('hour', check_timestamp) AS hour,
    AVG(cpu_usage_percent) AS avg_cpu,
    AVG(memory_usage_mb) AS avg_memory,
    MAX(restart_count) AS max_restarts,
    COUNT_IF(service_status = 'READY') AS ready_checks,
    COUNT_IF(service_status != 'READY') AS not_ready_checks
FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE check_timestamp >= DATEADD(hour, -24, CURRENT_TIMESTAMP())
GROUP BY hour
ORDER BY hour DESC;

-- =====================================================
-- Health Check History
-- =====================================================

-- Last 20 health checks
SELECT
    check_timestamp,
    service_status,
    restart_count,
    health_check_status,
    alerts_triggered,
    CASE 
        WHEN service_status = 'READY' THEN '✅'
        WHEN service_status = 'PENDING' THEN '⏳'
        ELSE '❌'
    END AS status_icon
FROM SNOWGRAM_MONITORING_DASHBOARD
ORDER BY check_timestamp DESC
LIMIT 20;

-- Health check success rate (last 7 days)
SELECT
    DATE(check_timestamp) AS check_date,
    COUNT(*) AS total_checks,
    COUNT_IF(health_check_status = 'HEALTHY') AS healthy_checks,
    COUNT_IF(health_check_status != 'HEALTHY') AS unhealthy_checks,
    ROUND(COUNT_IF(health_check_status = 'HEALTHY') * 100.0 / COUNT(*), 2) AS health_percentage
FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE check_timestamp >= DATEADD(day, -7, CURRENT_TIMESTAMP())
GROUP BY check_date
ORDER BY check_date DESC;

-- =====================================================
-- Alerts & Issues
-- =====================================================

-- Active alerts (last 24 hours)
SELECT * FROM SNOWGRAM_ALERTS
WHERE check_timestamp >= DATEADD(hour, -24, CURRENT_TIMESTAMP())
ORDER BY check_timestamp DESC;

-- Alert frequency by hour
SELECT
    DATE_TRUNC('hour', check_timestamp) AS alert_hour,
    COUNT(*) AS alert_count,
    LISTAGG(DISTINCT alert_reason, ', ') AS alert_reasons
FROM SNOWGRAM_ALERTS
WHERE check_timestamp >= DATEADD(day, -1, CURRENT_TIMESTAMP())
GROUP BY alert_hour
ORDER BY alert_hour DESC;

-- =====================================================
-- Service Logs
-- =====================================================

-- Recent service logs (via CLI)
-- Run in terminal:
-- snow spcs service logs SNOWGRAM_DB.CORE.SNOWGRAM_SERVICE -c svcUser --container snowgram --num-lines 50

-- Log summary by severity
SELECT * FROM SNOWGRAM_SERVICE_LOGS_SUMMARY
ORDER BY log_hour DESC
LIMIT 24;  -- Last 24 hours

-- =====================================================
-- Uptime & Reliability
-- =====================================================

-- Service uptime summary (24 hours)
SELECT * FROM SNOWGRAM_HEALTH_SUMMARY_24H;

-- Uptime by day (last 7 days)
SELECT
    DATE(check_timestamp) AS date,
    COUNT(*) AS total_checks,
    COUNT_IF(service_status = 'READY') AS ready_count,
    ROUND(COUNT_IF(service_status = 'READY') * 100.0 / COUNT(*), 2) AS uptime_percent,
    AVG(restart_count) AS avg_restarts,
    COUNT_IF(alerts_triggered > 0) AS alert_count
FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE check_timestamp >= DATEADD(day, -7, CURRENT_TIMESTAMP())
GROUP BY date
ORDER BY date DESC;

-- =====================================================
-- Service Restart Analysis
-- =====================================================

-- Restart count over time
SELECT
    DATE_TRUNC('hour', check_timestamp) AS hour,
    MAX(restart_count) AS max_restarts,
    MIN(restart_count) AS min_restarts,
    MAX(restart_count) - MIN(restart_count) AS restarts_in_hour
FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE check_timestamp >= DATEADD(day, -1, CURRENT_TIMESTAMP())
GROUP BY hour
ORDER BY hour DESC;

-- Times when service restarted
SELECT
    check_timestamp,
    restart_count,
    service_status,
    LAG(restart_count) OVER (ORDER BY check_timestamp) AS previous_restart_count,
    restart_count - LAG(restart_count) OVER (ORDER BY check_timestamp) AS new_restarts
FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE check_timestamp >= DATEADD(day, -7, CURRENT_TIMESTAMP())
QUALIFY new_restarts > 0
ORDER BY check_timestamp DESC;

-- =====================================================
-- Performance Metrics
-- =====================================================

-- Response time trends (if captured)
SELECT
    DATE_TRUNC('hour', check_timestamp) AS hour,
    AVG(avg_response_time_ms) AS avg_response_ms,
    MIN(avg_response_time_ms) AS min_response_ms,
    MAX(avg_response_time_ms) AS max_response_ms
FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE avg_response_time_ms IS NOT NULL
  AND check_timestamp >= DATEADD(day, -1, CURRENT_TIMESTAMP())
GROUP BY hour
ORDER BY hour DESC;

-- Error rate trends
SELECT
    DATE_TRUNC('hour', check_timestamp) AS hour,
    AVG(error_rate) * 100 AS avg_error_rate_percent,
    MAX(error_rate) * 100 AS max_error_rate_percent
FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE error_rate IS NOT NULL
  AND check_timestamp >= DATEADD(day, -1, CURRENT_TIMESTAMP())
GROUP BY hour
ORDER BY hour DESC;

-- =====================================================
-- Task Execution History
-- =====================================================

-- Monitoring task execution history
SELECT
    name,
    scheduled_time,
    completed_time,
    state,
    error_code,
    error_message,
    DATEDIFF(second, scheduled_time, completed_time) AS execution_seconds
FROM TABLE(INFORMATION_SCHEMA.TASK_HISTORY())
WHERE name = 'SNOWGRAM_HEALTH_CHECK_TASK'
ORDER BY scheduled_time DESC
LIMIT 20;

-- Task success rate
SELECT
    DATE(scheduled_time) AS date,
    COUNT(*) AS total_runs,
    COUNT_IF(state = 'SUCCEEDED') AS successful_runs,
    COUNT_IF(state = 'FAILED') AS failed_runs,
    ROUND(COUNT_IF(state = 'SUCCEEDED') * 100.0 / COUNT(*), 2) AS success_rate
FROM TABLE(INFORMATION_SCHEMA.TASK_HISTORY())
WHERE name = 'SNOWGRAM_HEALTH_CHECK_TASK'
  AND scheduled_time >= DATEADD(day, -7, CURRENT_TIMESTAMP())
GROUP BY date
ORDER BY date DESC;

-- =====================================================
-- Quick Health Check
-- =====================================================

-- Manual health check
CALL CHECK_SNOWGRAM_HEALTH();

-- View result
SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

-- =====================================================
-- Service Configuration
-- =====================================================

-- Show service details
DESC SERVICE SNOWGRAM_SERVICE;

-- Service properties
SHOW SERVICES LIKE 'SNOWGRAM_SERVICE';

-- =====================================================
-- Compute Pool Status
-- =====================================================

-- Show compute pool details
SHOW COMPUTE POOLS LIKE 'SNOWGRAM_COMPUTE_POOL';

-- Compute pool metrics (if available)
SELECT *
FROM SNOWFLAKE.ACCOUNT_USAGE.COMPUTE_POOL_METRICS
WHERE compute_pool_name = 'SNOWGRAM_COMPUTE_POOL'
ORDER BY timestamp DESC
LIMIT 100;

-- =====================================================
-- Cost Monitoring
-- =====================================================

-- Service cost (last 7 days)
SELECT
    usage_date,
    service_name,
    SUM(credits_used) AS total_credits,
    SUM(credits_used_compute) AS compute_credits,
    SUM(credits_used_cloud_services) AS cloud_services_credits
FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_HISTORY
WHERE service_name = 'SNOWGRAM_SERVICE'
  AND usage_date >= DATEADD(day, -7, CURRENT_DATE())
GROUP BY usage_date, service_name
ORDER BY usage_date DESC;

-- =====================================================
-- Summary Dashboard Query (Single View)
-- =====================================================

-- Complete service health overview
WITH current_status AS (
    SELECT 
        PARSE_JSON(SYSTEM$GET_SERVICE_STATUS('SNOWGRAM_SERVICE'))[0] AS status_json
),
recent_health AS (
    SELECT 
        health_check_status,
        restart_count,
        check_timestamp
    FROM SNOWGRAM_MONITORING_DASHBOARD
    ORDER BY check_timestamp DESC
    LIMIT 1
)
SELECT
    -- Current Status
    status_json:status::STRING AS current_status,
    status_json:restartCount::INTEGER AS total_restarts,
    DATEDIFF(minute, status_json:startTime::TIMESTAMP, CURRENT_TIMESTAMP()) AS uptime_minutes,
    
    -- Recent Health
    rh.health_check_status AS last_health_check,
    rh.check_timestamp AS last_checked,
    
    -- 24h Summary
    (SELECT uptime_percentage FROM SNOWGRAM_HEALTH_SUMMARY_24H) AS uptime_24h_percent,
    (SELECT total_alerts FROM SNOWGRAM_HEALTH_SUMMARY_24H) AS alerts_24h,
    
    -- Indicators
    CASE 
        WHEN status_json:status::STRING = 'READY' THEN '✅ Healthy'
        WHEN status_json:status::STRING = 'PENDING' THEN '⏳ Starting'
        ELSE '❌ Issue Detected'
    END AS overall_health
FROM current_status
CROSS JOIN recent_health rh;

