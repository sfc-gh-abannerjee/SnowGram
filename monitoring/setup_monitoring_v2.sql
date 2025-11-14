USE ROLE ACCOUNTADMIN;
USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

-- Create monitoring dashboard table
CREATE OR REPLACE TABLE SNOWGRAM_MONITORING_DASHBOARD (
    check_timestamp TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    service_name VARCHAR,
    service_status VARCHAR,
    instance_count INTEGER,
    restart_count INTEGER,
    health_check_status VARCHAR,
    alerts_triggered INTEGER
);

-- Create stored procedure using Python (easier than SQL for JSON parsing)
CREATE OR REPLACE PROCEDURE CHECK_SNOWGRAM_HEALTH()
RETURNS VARCHAR
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'check_health'
AS
$$
import json

def check_health(session):
    # Get service status
    result = session.sql("SELECT SYSTEM$GET_SERVICE_STATUS('SNOWGRAM_SERVICE')").collect()
    status_json = json.loads(result[0][0])
    
    if not status_json:
        return "No status available"
    
    first_instance = status_json[0]
    service_status = first_instance.get('status', 'UNKNOWN')
    restart_count = first_instance.get('restartCount', 0)
    
    # Determine health
    is_healthy = service_status == 'READY'
    
    # Insert monitoring record
    session.sql(f"""
        INSERT INTO SNOWGRAM_MONITORING_DASHBOARD (
            service_name,
            service_status,
            restart_count,
            health_check_status,
            alerts_triggered
        ) VALUES (
            'SNOWGRAM_SERVICE',
            '{service_status}',
            {restart_count},
            '{"HEALTHY" if is_healthy else "ALERT"}',
            {0 if is_healthy else 1}
        )
    """).collect()
    
    return f"Health check completed: {service_status}"
$$;

GRANT USAGE ON PROCEDURE CHECK_SNOWGRAM_HEALTH() TO ROLE SVC_CURSOR_ROLE;

-- Create monitoring task
CREATE OR REPLACE TASK SNOWGRAM_HEALTH_CHECK_TASK
    WAREHOUSE = COMPUTE_WH
    SCHEDULE = '5 MINUTE'
    COMMENT = 'Automated health monitoring for SnowGram service'
AS
    CALL CHECK_SNOWGRAM_HEALTH();

-- Resume task
ALTER TASK SNOWGRAM_HEALTH_CHECK_TASK RESUME;

-- Create alert views
CREATE OR REPLACE VIEW SNOWGRAM_ALERTS AS
SELECT 
    check_timestamp,
    service_status,
    restart_count,
    health_check_status
FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE alerts_triggered > 0
ORDER BY check_timestamp DESC;

CREATE OR REPLACE VIEW SNOWGRAM_HEALTH_SUMMARY_24H AS
SELECT
    COUNT(*) AS total_checks,
    SUM(alerts_triggered) AS total_alerts,
    ROUND(AVG(CASE WHEN service_status = 'READY' THEN 1 ELSE 0 END) * 100, 2) AS uptime_percentage,
    AVG(restart_count) AS avg_restart_count
FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE check_timestamp >= DATEADD(hour, -24, CURRENT_TIMESTAMP());

-- Grant permissions
GRANT SELECT ON VIEW SNOWGRAM_SERVICE_STATUS TO ROLE SVC_CURSOR_ROLE;
GRANT SELECT ON VIEW SNOWGRAM_ALERTS TO ROLE SVC_CURSOR_ROLE;
GRANT SELECT ON VIEW SNOWGRAM_HEALTH_SUMMARY_24H TO ROLE SVC_CURSOR_ROLE;
GRANT SELECT ON TABLE SNOWGRAM_MONITORING_DASHBOARD TO ROLE SVC_CURSOR_ROLE;

-- Run first health check
CALL CHECK_SNOWGRAM_HEALTH();

SELECT 'Monitoring setup complete' AS status;
