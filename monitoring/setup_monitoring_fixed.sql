-- Continue from where we left off - skip the problematic view
USE ROLE ACCOUNTADMIN;
USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

-- Create simpler monitoring views without METERING_HISTORY
CREATE OR REPLACE TABLE SNOWGRAM_MONITORING_DASHBOARD (
    check_timestamp TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    service_name VARCHAR,
    service_status VARCHAR,
    instance_count INTEGER,
    restart_count INTEGER,
    health_check_status VARCHAR,
    alerts_triggered INTEGER
);

CREATE OR REPLACE PROCEDURE CHECK_SNOWGRAM_HEALTH()
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
DECLARE
    service_status_result VARCHAR;
BEGIN
    SELECT SYSTEM\$GET_SERVICE_STATUS('SNOWGRAM_SERVICE') INTO :service_status_result;
    
    INSERT INTO SNOWGRAM_MONITORING_DASHBOARD (
        service_name,
        service_status,
        restart_count,
        health_check_status,
        alerts_triggered
    ) 
    SELECT
        'SNOWGRAM_SERVICE',
        PARSE_JSON(:service_status_result)[0]:status::STRING,
        PARSE_JSON(:service_status_result)[0]:restartCount::INTEGER,
        CASE 
            WHEN PARSE_JSON(:service_status_result)[0]:status::STRING = 'READY' THEN 'HEALTHY'
            ELSE 'ALERT'
        END,
        CASE 
            WHEN PARSE_JSON(:service_status_result)[0]:status::STRING = 'READY' THEN 0
            ELSE 1
        END;
    
    RETURN 'Health check completed';
END;
$$;

GRANT USAGE ON PROCEDURE CHECK_SNOWGRAM_HEALTH() TO ROLE SVC_CURSOR_ROLE;

-- Create task
CREATE OR REPLACE TASK SNOWGRAM_HEALTH_CHECK_TASK
    WAREHOUSE = COMPUTE_WH
    SCHEDULE = '5 MINUTE'
AS CALL CHECK_SNOWGRAM_HEALTH();

ALTER TASK SNOWGRAM_HEALTH_CHECK_TASK RESUME;

-- Create alert views
CREATE OR REPLACE VIEW SNOWGRAM_ALERTS AS
SELECT * FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE alerts_triggered > 0
ORDER BY check_timestamp DESC;

CREATE OR REPLACE VIEW SNOWGRAM_HEALTH_SUMMARY_24H AS
SELECT
    COUNT(*) AS total_checks,
    SUM(alerts_triggered) AS total_alerts,
    AVG(CASE WHEN service_status = 'READY' THEN 1 ELSE 0 END) * 100 AS uptime_percentage,
    AVG(restart_count) AS avg_restart_count
FROM SNOWGRAM_MONITORING_DASHBOARD
WHERE check_timestamp >= DATEADD(hour, -24, CURRENT_TIMESTAMP());

-- Grant permissions
GRANT SELECT ON VIEW SNOWGRAM_SERVICE_STATUS TO ROLE SVC_CURSOR_ROLE;
GRANT SELECT ON VIEW SNOWGRAM_ALERTS TO ROLE SVC_CURSOR_ROLE;
GRANT SELECT ON VIEW SNOWGRAM_HEALTH_SUMMARY_24H TO ROLE SVC_CURSOR_ROLE;
GRANT SELECT ON TABLE SNOWGRAM_MONITORING_DASHBOARD TO ROLE SVC_CURSOR_ROLE;

SELECT 'Monitoring setup complete' AS status;
