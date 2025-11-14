-- =====================================================
-- Create Snowflake Secret for SPCS Service
-- =====================================================
-- Purpose: Store SVC_CURSOR password securely for SPCS
-- Usage: Execute as ACCOUNTADMIN before deploying service
-- =====================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

-- Create secret with SVC_CURSOR credentials
-- Note: Replace <SVC_CURSOR_PASSWORD> with the actual password or PAT token
CREATE OR REPLACE SECRET snowgram_credentials
    TYPE = PASSWORD
    USERNAME = 'SVC_CURSOR'
    PASSWORD = '<SVC_CURSOR_PASSWORD>';  -- Replace with actual password

-- Grant usage to SVC_CURSOR_ROLE
GRANT USAGE ON SECRET snowgram_credentials TO ROLE SVC_CURSOR_ROLE;

-- Verify secret was created
SHOW SECRETS LIKE 'snowgram_credentials';

-- =====================================================
-- Instructions for Getting SVC_CURSOR Password
-- =====================================================
-- If using PAT token, use one from:
--   ~/.snowflake/config.toml (svcUser connection)
--   ~/.snowflake/pat_tokens.txt
--
-- To generate a new PAT token:
--   1. Login to Snowsight as ACCOUNTADMIN
--   2. Go to "Governance & security" → "Users & roles"
--   3. Select SVC_CURSOR user
--   4. Under "Programmatic access tokens", click "Generate new token"
--   5. Copy the token and replace <SVC_CURSOR_PASSWORD> above
-- =====================================================

-- =====================================================
-- Alternative: Use Key Pair Authentication (More Secure)
-- =====================================================
-- For production, consider using key pair authentication:
--
-- 1. Generate RSA key pair:
--    openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out rsa_key.p8 -nocrypt
--    openssl rsa -in rsa_key.p8 -pubout -out rsa_key.pub
--
-- 2. Set public key for SVC_CURSOR:
--    ALTER USER SVC_CURSOR SET RSA_PUBLIC_KEY='<public_key_content>';
--
-- 3. Store private key in secret:
--    CREATE SECRET snowgram_keypair
--      TYPE = GENERIC_STRING
--      SECRET_STRING = '<private_key_content>';
--
-- 4. Update backend/db/connector.py to use key pair auth
-- =====================================================

