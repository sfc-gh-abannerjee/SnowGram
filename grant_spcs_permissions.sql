-- =====================================================
-- Grant SPCS Permissions to SVC_CURSOR_ROLE
-- =====================================================
-- Purpose: Enable svcUser to deploy SPCS services
-- Execute with: snow sql -c adminUser -f grant_spcs_permissions.sql
-- =====================================================

USE ROLE ACCOUNTADMIN;

-- Grant SPCS deployment privileges
GRANT CREATE SERVICE ON SCHEMA SNOWGRAM_DB.CORE TO ROLE SVC_CURSOR_ROLE;
GRANT BIND SERVICE ENDPOINT ON ACCOUNT TO ROLE SVC_CURSOR_ROLE;
GRANT USAGE, MONITOR, OPERATE ON COMPUTE POOL SNOWGRAM_COMPUTE_POOL TO ROLE SVC_CURSOR_ROLE;
GRANT READ, WRITE ON IMAGE REPOSITORY SNOWGRAM_DB.CORE.SNOWGRAM_IMAGE_REPO TO ROLE SVC_CURSOR_ROLE;

-- Grant function creation privileges for custom tools
GRANT CREATE FUNCTION ON SCHEMA SNOWGRAM_DB.CORE TO ROLE SVC_CURSOR_ROLE;
GRANT CREATE PROCEDURE ON SCHEMA SNOWGRAM_DB.CORE TO ROLE SVC_CURSOR_ROLE;

-- Grant role to itself (for role switching)
GRANT ROLE SVC_CURSOR_ROLE TO ROLE SVC_CURSOR_ROLE;

-- Additional grants for service management
GRANT CREATE SECRET ON SCHEMA SNOWGRAM_DB.CORE TO ROLE SVC_CURSOR_ROLE;
GRANT USAGE ON SECRET snowgram_credentials TO ROLE SVC_CURSOR_ROLE;

SELECT 'SPCS permissions granted to SVC_CURSOR_ROLE successfully!' AS status;

