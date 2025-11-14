USE ROLE ACCOUNTADMIN;

-- Grant MONITOR privilege on service to ACCOUNTADMIN for stored procedure
GRANT MONITOR ON SERVICE SNOWGRAM_DB.CORE.SNOWGRAM_SERVICE TO ROLE ACCOUNTADMIN;

-- Run health check manually
CALL SNOWGRAM_DB.CORE.CHECK_SNOWGRAM_HEALTH();

SELECT 'Monitoring permissions granted' AS status;
