-- =====================================================
-- SnowGram Monitoring & Alerting Setup
-- =====================================================
-- Purpose: Configure monitoring, logging, and alerts for SPCS service
-- Date: 2025-11-12
-- =====================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

-- =====================================================
-- 1. Enable Event Logging for Service
-- =====================================================

-- Set log level for service (INFO level for production)
ALTER SERVICE SNOWGRAM_SERVICE SET
  LOG_LEVEL = 'INFO';

-- =====================================================
-- 2. Create Monitoring Views
-- =====================================================

-- View for service status monitoring
CREATE OR REPLACE VIEW SNOWGRAM_SERVICE_STATUS AS
SELECT 
    PARSE_JSON(SYSTEM$GET_SERVICE_STATUS('SNOWGRAM_SERVICE')) AS status_json,
    status_json[0]:status::STRING AS service_status,
    status_json[0]:message::STRING AS status_message,
    status_json[0]:containerName::STRING AS container_name,
    status_json[0]:instanceId::STRING AS instance_id,
    status_json[0]:restartCount::INTEGER AS restart_count,
    status_json[0]:startTime::TIMESTAMP AS start_time,
    CURRENT_TIMESTAMP() AS checked_at
FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

-- View for service metrics (from SPCS metrics)
CREATE OR REPLACE VIEW SNOWGRAM_SERVICE_METRICS AS
SELECT
    metric_name,
    metric_value,
    labels,
    timestamp
FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_HISTORY
WHERE service_name = 'SNOWGRAM_SERVICE'
ORDER BY timestamp DESC
LIMIT 1000;

-- View for service logs summary
CREATE OR REPLACE VIEW SNOWGRAM_SERVICE_LOGS_SUMMARY AS
SELECT
    DATE_TRUNC('hour', timestamp) AS log_hour,
    COUNT(*) AS log_count,
    COUNT_IF(severity = 'ERROR') AS error_count,
    COUNT_IF(severity = 'WARNING') AS warning_count,
    COUNT_IF(severity = 'INFO') AS info_count
FROM SNOWFLAKE.ACCOUNT_USAGE.SERVICE_LOGS
WHERE service_name = 'SNOWGRAM_SERVICE'
GROUP BY log_hour
ORDER BY log_hour DESC
LIMIT 168;  -- Last 7 days (hourly)

-- =====================================================
-- 3. Create Monitoring Dashboard Table
-- =====================================================

CREATE OR REPLACE TABLE SNOWGRAM_MONITORING_DASHBOARD (
    check_timestamp TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    service_name VARCHAR,
    service_status VARCHAR,
    instance_count INTEGER,
    restart_count INTEGER,
    cpu_usage_percent FLOAT,
    memory_usage_mb FLOAT,
    error_rate FLOAT,
    avg_response_time_ms FLOAT,
    health_check_status VARCHAR,
    alerts_triggered INTEGER
);

-- =====================================================
-- 4. Create Stored Procedure for Health Monitoring
-- =====================================================

CREATE OR REPLACE PROCEDURE CHECK_SNOWGRAM_HEALTH()
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
DECLARE
    service_status VARCHAR;
    restart_count INTEGER;
    alert_message VARCHAR DEFAULT '';
BEGIN
    -- Get current service status
    CALL SYSTEM$GET_SERVICE_STATUS('SNOWGRAM_SERVICE') INTO :service_status;
    
    -- Parse status
    LET status_obj := PARSE_JSON(:service_status)[0];
    LET current_status := status_obj:status::STRING;
    LET current_restarts := status_obj:restartCount::INTEGER;
    
    -- Check for issues
    IF (current_status != 'READY') THEN
        alert_message := 'ALERT: Service status is ' || current_status;
    END IF;
    
    IF (current_restarts > 5) THEN
        alert_message := alert_message || ' | High restart count: ' || current_restarts;
    END IF;
    
    -- Log to monitoring dashboard
    INSERT INTO SNOWGRAM_MONITORING_DASHBOARD (
        service_name,
        service_status,
        restart_count,
        health_check_status,
        alerts_triggered
    ) VALUES (
        'SNOWGRAM_SERVICE',
        current_status,
        current_restarts,
        IFF(alert_message = '', 'HEALTHY', 'ALERT'),
        IFF(alert_message = '', 0, 1)
    );
    
    RETURN IFF(alert_message = '', 'Service healthy', alert_message);
END;
$$;

-- Grant execute to SVC_CURSOR_ROLE
GRANT USAGE ON PROCEDURE CHECK_SNOWGRAM_HEALTH() TO ROLE SVC_CURSOR_ROLE;

-- =====================================================
-- 5. Create Task for Automated Monitoring
-- =====================================================

-- Create task that runs health check every 5 minutes
CREATE OR REPLACE TASK SNOWGRAM_HEALTH_CHECK_TASK
    WAREHOUSE = COMPUTE_WH
    SCHEDULE = '5 MINUTE'
    COMMENT = 'Automated health monitoring for SnowGram service'
AS
    CALL CHECK_SNOWGRAM_HEALTH();

-- Grant necessary privileges
GRANT EXECUTE TASK ON ACCOUNT TO ROLE ACCOUNTADMIN;
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE ACCOUNTADMIN;

-- Resume task to start monitoring
ALTER TASK SNOWGRAM_HEALTH_CHECK_TASK RESUME;

-- =====================================================
-- 6. Create Alert Views
-- =====================================================

-- View for recent alerts
CREATE OR REPLACE VIEW SNOWGRAM_ALERTS AS
SELECT
    check_timestamp,
    service_status,
    restart_count,
    health_check_status,
    CASE
        WHEN service_status != 'READY' THEN 'Service not ready'
        WHEN restart_count > 5 THEN 'High restart count'
        WHEN error_rate > 0.05 THEN 'High error rate'
        ELSE 'No issues'
    END AS alert_reason
FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE alerts_triggered > 0
ORDER BY check_timestamp DESC
LIMIT 100;

-- View for service health summary (last 24 hours)
CREATE OR REPLACE VIEW SNOWGRAM_HEALTH_SUMMARY_24H AS
SELECT
    COUNT(*) AS total_checks,
    SUM(alerts_triggered) AS total_alerts,
    AVG(CASE WHEN service_status = 'READY' THEN 1 ELSE 0 END) * 100 AS uptime_percentage,
    AVG(restart_count) AS avg_restart_count,
    MAX(restart_count) AS max_restart_count,
    MIN(check_timestamp) AS monitoring_start,
    MAX(check_timestamp) AS monitoring_end
FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE check_timestamp >= DATEADD(hour, -24, CURRENT_TIMESTAMP());

-- =====================================================
-- 7. Create Email Alert Procedure (Optional)
-- =====================================================

CREATE OR REPLACE PROCEDURE SEND_SNOWGRAM_ALERT(alert_message VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
BEGIN
    -- This is a placeholder for email integration
    -- In production, integrate with Snowflake's email notification
    -- or external alerting system (PagerDuty, Slack, etc.)
    
    -- For now, just log to monitoring table
    INSERT INTO SNOWGRAM_MONITORING_DASHBOARD (
        service_name,
        health_check_status,
        alerts_triggered
    ) VALUES (
        'SNOWGRAM_SERVICE',
        'ALERT: ' || alert_message,
        1
    );
    
    RETURN 'Alert logged: ' || alert_message;
END;
$$;

-- =====================================================
-- 8. Grant Permissions for Monitoring
-- =====================================================

GRANT SELECT ON VIEW SNOWGRAM_SERVICE_STATUS TO ROLE SVC_CURSOR_ROLE;
GRANT SELECT ON VIEW SNOWGRAM_SERVICE_METRICS TO ROLE SVC_CURSOR_ROLE;
GRANT SELECT ON VIEW SNOWGRAM_SERVICE_LOGS_SUMMARY TO ROLE SVC_CURSOR_ROLE;
GRANT SELECT ON VIEW SNOWGRAM_ALERTS TO ROLE SVC_CURSOR_ROLE;
GRANT SELECT ON VIEW SNOWGRAM_HEALTH_SUMMARY_24H TO ROLE SVC_CURSOR_ROLE;
GRANT SELECT ON TABLE SNOWGRAM_MONITORING_DASHBOARD TO ROLE SVC_CURSOR_ROLE;

-- =====================================================
-- 9. Quick Monitoring Queries
-- =====================================================

-- View current service status
SELECT * FROM SNOWGRAM_SERVICE_STATUS;

-- View recent alerts
SELECT * FROM SNOWGRAM_ALERTS;

-- View 24-hour health summary
SELECT * FROM SNOWGRAM_HEALTH_SUMMARY_24H;

-- View monitoring dashboard (last 10 checks)
SELECT 
    check_timestamp,
    service_status,
    restart_count,
    health_check_status
FROM SNOWGRAM_MONITORING_DASHBOARD
ORDER BY check_timestamp DESC
LIMIT 10;

-- =====================================================
-- 10. Monitoring Commands Reference
-- =====================================================

-- Manual health check
-- CALL CHECK_SNOWGRAM_HEALTH();

-- Check task status
-- SHOW TASKS LIKE 'SNOWGRAM_HEALTH_CHECK_TASK';

-- View task history
-- SELECT * FROM TABLE(INFORMATION_SCHEMA.TASK_HISTORY())
-- WHERE name = 'SNOWGRAM_HEALTH_CHECK_TASK'
-- ORDER BY scheduled_time DESC
-- LIMIT 10;

-- Suspend monitoring task
-- ALTER TASK SNOWGRAM_HEALTH_CHECK_TASK SUSPEND;

-- Resume monitoring task
-- ALTER TASK SNOWGRAM_HEALTH_CHECK_TASK RESUME;

-- =====================================================
-- Setup Complete
-- =====================================================

SELECT 'Monitoring setup complete for SnowGram service' AS status;

