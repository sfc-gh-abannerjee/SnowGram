USE ROLE SVC_CURSOR_ROLE;
USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

-- Check service status
SELECT SYSTEM$GET_SERVICE_STATUS('SNOWGRAM_SERVICE') AS service_status;

-- Get service configuration
SHOW SERVICES LIKE 'SNOWGRAM_SERVICE';

-- Check monitoring dashboard
SELECT COUNT(*) AS health_checks_recorded
FROM SNOWGRAM_MONITORING_DASHBOARD;

-- View last 5 health checks
SELECT 
    check_timestamp,
    service_status,
    restart_count,
    health_check_status
FROM SNOWGRAM_MONITORING_DASHBOARD
ORDER BY check_timestamp DESC
LIMIT 5;

-- Check task status
SHOW TASKS LIKE 'SNOWGRAM_HEALTH_CHECK_TASK';
