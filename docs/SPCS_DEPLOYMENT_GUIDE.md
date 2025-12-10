# SPCS Deployment Guide for SnowGram

> **Snowpark Container Services Deployment Best Practices**  
> Researched from official Snowflake documentation via `snowflake-docs` MCP server  
> Last Updated: November 14, 2025

## 📋 Overview

This guide provides best practices for deploying SnowGram using **Snowpark Container Services (SPCS)** - Snowflake's fully managed container orchestration platform.

### What is SPCS?

Snowpark Container Services is a fully managed container offering that:
- Deploys, manages, and scales containerized applications within Snowflake
- Handles security, configuration, and operational tasks automatically
- Integrates natively with Snowflake RBAC, stages, and warehouses
- Eliminates the need for external Kubernetes or container orchestration

**Source**: [Snowpark Container Services Documentation](https://docs.snowflake.com/en/developer-guide/snowpark-container-services)

---

## 🏗️ SPCS Architecture for SnowGram

```text
┌─────────────────────────────────────────────────────────────┐
│                    Snowflake Account                        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Image Repository (Schema-Level Object)       │  │
│  │         SNOWGRAM_DB.CORE.IMAGE_REPO                  │  │
│  │                                                      │  │
│  │  • snowgram:latest                                   │  │
│  │  • snowgram:v1.0.0                                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Compute Pool (Account-Level Object)          │  │
│  │         SNOWGRAM_COMPUTE_POOL                        │  │
│  │                                                      │  │
│  │  • Instance Family: CPU_X64_M                        │  │
│  │  • Min Nodes: 1                                      │  │
│  │  • Max Nodes: 3 (auto-scaling)                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Service (Schema-Level Object)                │  │
│  │         SNOWGRAM_DB.CORE.SNOWGRAM_SERVICE            │  │
│  │                                                      │  │
│  │  Container 1: Backend (FastAPI)                      │  │
│  │  • Port 8000 (internal)                              │  │
│  │  • Cortex Agent Client                               │  │
│  │                                                      │  │
│  │  Container 2: Frontend (Next.js)                     │  │
│  │  • Port 3000 (public endpoint)                       │  │
│  │  • Excalidraw + Agent Chat                           │  │
│  └──────────────────────────────────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│                  Public Endpoint (Ingress)                  │
│                  https://<org>-<acct>.snowflakecomputing... │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Deployment Workflow

### Phase 1: Prerequisites

#### 1.1 Required Privileges

```sql
-- Grant SPCS privileges to deployment role
USE ROLE ACCOUNTADMIN;

GRANT CREATE COMPUTE POOL ON ACCOUNT TO ROLE SYSADMIN;
GRANT CREATE IMAGE REPOSITORY ON SCHEMA SNOWGRAM_DB.CORE TO ROLE SYSADMIN;
GRANT CREATE SERVICE ON SCHEMA SNOWGRAM_DB.CORE TO ROLE SYSADMIN;
GRANT BIND SERVICE ENDPOINT ON ACCOUNT TO ROLE SYSADMIN;  -- For public endpoints

-- Grant usage to service role
GRANT USAGE ON DATABASE SNOWGRAM_DB TO ROLE SVC_CURSOR_ROLE;
GRANT USAGE ON SCHEMA SNOWGRAM_DB.CORE TO ROLE SVC_CURSOR_ROLE;
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE SVC_CURSOR_ROLE;
```

**Key Privilege Notes**:
- `BIND SERVICE ENDPOINT`: Required for public (internet-accessible) endpoints
- Must be granted by `ACCOUNTADMIN` role
- Without it, services can only be accessed from within Snowflake

**Source**: [SPCS Privileges Documentation](https://docs.snowflake.com/en/sql-reference/sql/create-service#access-control-requirements)

#### 1.2 Setup Database Objects

```sql
-- Run setup script
USE ROLE SYSADMIN;
snow sql -c svcUser -f setup_backend.sql
```

Expected objects created:
- `SNOWGRAM_DB` database
- `SNOWGRAM_DB.CORE` schema
- `SNOWGRAM_DB.AGENTS` schema
- `SNOWGRAM_DB.SEMANTICS` schema
- `SNOWGRAM_DB.KNOWLEDGE` schema

---

### Phase 2: Create Image Repository

#### 2.1 Create Repository (SQL)

```sql
USE ROLE SYSADMIN;
USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

CREATE IMAGE REPOSITORY IF NOT EXISTS IMAGE_REPO;

-- Get repository URL
SHOW IMAGE REPOSITORIES;
```

#### 2.2 Create Repository (Snowflake CLI)

```bash
# Using Snowflake CLI
snow spcs image-repository create IMAGE_REPO \
  --database SNOWGRAM_DB \
  --schema CORE \
  --connection svcUser
```

#### 2.3 Get Repository URL

```bash
# Get the registry URL for Docker login
snow spcs image-repository url IMAGE_REPO \
  --database SNOWGRAM_DB \
  --schema CORE \
  --connection svcUser
```

Expected output format:
```
<org>-<account>.registry.snowflakecomputing.com/snowgram_db/core/image_repo
```

**Source**: [Working with Image Repositories](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/working-with-registry-repository)

---

### Phase 3: Build and Push Docker Image

#### 3.1 Build Multi-Stage Image

SnowGram uses a multi-stage Dockerfile for optimized image size:

```dockerfile
# docker/Dockerfile

# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM python:3.11-slim AS backend-builder
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./

# Stage 3: Production
FROM python:3.11-slim
WORKDIR /app

# Install Node.js for serving frontend
RUN apt-get update && apt-get install -y nodejs npm && rm -rf /var/lib/apt/lists/*

# Copy built frontend
COPY --from=frontend-builder /app/frontend/.next ./frontend/.next
COPY --from=frontend-builder /app/frontend/public ./frontend/public
COPY --from=frontend-builder /app/frontend/package*.json ./frontend/

# Copy backend
COPY --from=backend-builder /app/backend ./backend

# Install production dependencies only
WORKDIR /app/frontend
RUN npm ci --only=production

WORKDIR /app

# Expose ports
EXPOSE 8000 3000

# Start script
CMD ["sh", "-c", "cd frontend && npm start & cd backend && uvicorn api.main:app --host 0.0.0.0 --port 8000"]
```

#### 3.2 Build Image

```bash
# Build image locally
cd /Users/abannerjee/Documents/SnowGram

docker build -t snowgram:latest -f docker/Dockerfile .
```

#### 3.3 Authenticate to Snowflake Registry

```bash
# Get PAT token from environment or config
export SNOWFLAKE_PAT="<your_personal_access_token>"

# Docker login to Snowflake registry
docker login <org>-<account>.registry.snowflakecomputing.com \
  -u <username> \
  --password-stdin <<< "$SNOWFLAKE_PAT"
```

**Alternative**: Use Snowflake CLI's built-in authentication:

```bash
# Snowflake CLI handles authentication automatically
snow spcs image-registry login \
  --connection svcUser
```

#### 3.4 Tag and Push Image

```bash
# Tag image with full repository path
docker tag snowgram:latest \
  <org>-<account>.registry.snowflakecomputing.com/snowgram_db/core/image_repo/snowgram:latest

# Push to Snowflake
docker push \
  <org>-<account>.registry.snowflakecomputing.com/snowgram_db/core/image_repo/snowgram:latest
```

**Using Snowflake CLI** (Recommended):

```bash
# Upload image directly (CLI handles tagging)
snow spcs image-repository upload-image IMAGE_REPO \
  --database SNOWGRAM_DB \
  --schema CORE \
  --image-name snowgram:latest \
  --connection svcUser
```

**Source**: [Uploading Container Images](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/working-with-registry-repository#uploading-images)

---

### Phase 4: Create Compute Pool

#### 4.1 Choose Instance Family

| Family | vCPU | Memory | Use Case |
|--------|------|--------|----------|
| `CPU_X64_XS` | 1 | 2 GB | Development, testing |
| `CPU_X64_S` | 2 | 4 GB | Small services |
| `CPU_X64_M` | 4 | 8 GB | **Recommended for SnowGram** |
| `CPU_X64_L` | 8 | 16 GB | Large workloads |
| `GPU_NV_S` | 4 + GPU | 16 GB | ML inference |

#### 4.2 Create Compute Pool (SQL)

```sql
USE ROLE SYSADMIN;

CREATE COMPUTE POOL IF NOT EXISTS SNOWGRAM_COMPUTE_POOL
  MIN_NODES = 1
  MAX_NODES = 3
  INSTANCE_FAMILY = CPU_X64_M
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = FALSE
  AUTO_SUSPEND_SECS = 3600  -- Suspend after 1 hour of inactivity
  COMMENT = 'Compute pool for SnowGram SPCS service';

-- Verify creation
SHOW COMPUTE POOLS;
DESCRIBE COMPUTE POOL SNOWGRAM_COMPUTE_POOL;
```

#### 4.3 Create Compute Pool (Snowflake CLI)

```bash
snow spcs compute-pool create SNOWGRAM_COMPUTE_POOL \
  --family CPU_X64_M \
  --min-nodes 1 \
  --max-nodes 3 \
  --auto-resume \
  --auto-suspend-secs 3600 \
  --connection svcUser
```

**Best Practices**:
- ✅ Use `AUTO_RESUME = TRUE` for cost savings
- ✅ Set `AUTO_SUSPEND_SECS` based on usage patterns (3600 = 1 hour)
- ✅ Start with `MIN_NODES = 1` and scale up based on load
- ✅ Set `MAX_NODES` to handle peak traffic (3-5x min for burst capacity)

**Source**: [CREATE COMPUTE POOL](https://docs.snowflake.com/en/sql-reference/sql/create-compute-pool)

---

### Phase 5: Create Service Specification

#### 5.1 Service Specification YAML

Create `spec.yml` in project root:

```yaml
# spec.yml
spec:
  containers:
    - name: backend
      image: /snowgram_db/core/image_repo/snowgram:latest
      env:
        SNOWFLAKE_ACCOUNT: <account>
        SNOWFLAKE_DATABASE: SNOWGRAM_DB
        SNOWFLAKE_SCHEMA: AGENTS
        SNOWFLAKE_WAREHOUSE: COMPUTE_WH
      resources:
        requests:
          cpu: "1"
          memory: "2Gi"
        limits:
          cpu: "2"
          memory: "4Gi"
      volumeMounts:
        - name: app-logs
          mountPath: /app/logs
    
    - name: frontend
      image: /snowgram_db/core/image_repo/snowgram:latest
      env:
        NEXT_PUBLIC_BACKEND_URL: http://localhost:8000
      resources:
        requests:
          cpu: "1"
          memory: "2Gi"
        limits:
          cpu: "2"
          memory: "4Gi"
  
  endpoints:
    - name: frontend
      port: 3000
      protocol: TCP
      public: true  # Enable public access
    
    - name: backend-api
      port: 8000
      protocol: TCP
      public: false  # Internal only
  
  volumes:
    - name: app-logs
      source: local  # Ephemeral storage
      uid: 1000
      gid: 1000

serviceRoles:
  - name: service_role
    endpoints:
      - frontend
```

**Key Configuration Notes**:

- **Image Path**: Use relative path starting with `/database/schema/repo/image:tag`
- **Public Endpoints**: Set `public: true` for internet access (requires `BIND SERVICE ENDPOINT` privilege)
- **Resources**: Always set `requests` and `limits` for predictable performance
- **Volumes**: Use `local` for ephemeral storage (data lost on container restart)
- **Service Roles**: Define which endpoints are exposed and to whom

**Source**: [Service Specification Reference](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/specification-reference)

#### 5.2 Upload Specification to Stage

```sql
-- Create stage for specs
USE ROLE SYSADMIN;
USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

CREATE STAGE IF NOT EXISTS SPECS_STAGE
  DIRECTORY = (ENABLE = TRUE)
  COMMENT = 'Stage for SPCS service specifications';

-- Upload spec file
PUT file:///Users/abannerjee/Documents/SnowGram/spec.yml @SPECS_STAGE AUTO_COMPRESS=FALSE OVERWRITE=TRUE;

-- Verify upload
LIST @SPECS_STAGE;
```

---

### Phase 6: Deploy Service

#### 6.1 Deploy via SQL

```sql
USE ROLE SYSADMIN;
USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

CREATE SERVICE IF NOT EXISTS SNOWGRAM_SERVICE
  IN COMPUTE POOL SNOWGRAM_COMPUTE_POOL
  FROM @SPECS_STAGE
  SPECIFICATION_FILE = 'spec.yml'
  MIN_INSTANCES = 1
  MAX_INSTANCES = 3
  COMMENT = 'SnowGram diagram generation application';

-- Check service status
SHOW SERVICES;
DESCRIBE SERVICE SNOWGRAM_SERVICE;

-- View service status (should show READY)
CALL SYSTEM$GET_SERVICE_STATUS('SNOWGRAM_SERVICE');
```

#### 6.2 Deploy via Snowflake CLI

```bash
# Deploy service
snow spcs service create SNOWGRAM_SERVICE \
  --compute-pool SNOWGRAM_COMPUTE_POOL \
  --spec-path @SPECS_STAGE/spec.yml \
  --min-instances 1 \
  --max-instances 3 \
  --database SNOWGRAM_DB \
  --schema CORE \
  --connection svcUser

# Check status
snow spcs service status SNOWGRAM_SERVICE \
  --database SNOWGRAM_DB \
  --schema CORE \
  --connection svcUser
```

**Service Status States**:
- `PENDING`: Service is being created
- `RUNNING`: Containers are starting
- `READY`: Service is fully operational ✅
- `FAILED`: Deployment failed (check logs)

**Source**: [CREATE SERVICE](https://docs.snowflake.com/en/sql-reference/sql/create-service)

---

### Phase 7: Access Service Endpoints

#### 7.1 List Endpoints

```sql
-- Show all endpoints
SHOW ENDPOINTS IN SERVICE SNOWGRAM_SERVICE;
```

```bash
# Using Snowflake CLI
snow spcs service list-endpoints SNOWGRAM_SERVICE \
  --database SNOWGRAM_DB \
  --schema CORE \
  --connection svcUser
```

Expected output:
```
+----------+------+----------+---------+------------------------------------------+
| name     | port | protocol | public  | ingress_url                              |
+----------+------+----------+---------+------------------------------------------+
| frontend | 3000 | TCP      | true    | https://<org>-<acct>.snowflakecomputi... |
| backend  | 8000 | TCP      | false   | NULL                                     |
+----------+------+----------+---------+------------------------------------------+
```

#### 7.2 Access Public Endpoint

```bash
# Get the public URL
FRONTEND_URL=$(snow spcs service list-endpoints SNOWGRAM_SERVICE \
  --database SNOWGRAM_DB \
  --schema CORE \
  --connection svcUser \
  --format json | jq -r '.[] | select(.name=="frontend") | .ingress_url')

echo "SnowGram is accessible at: $FRONTEND_URL"

# Open in browser
open $FRONTEND_URL
```

**Authentication**: 
- Public endpoints require Snowflake authentication
- Users are authenticated via their default role
- Ensure users have been granted `USAGE` on the service

```sql
-- Grant service usage to users
GRANT USAGE ON SERVICE SNOWGRAM_DB.CORE.SNOWGRAM_SERVICE TO ROLE PUBLIC;
```

**Source**: [Service Endpoints and Ingress](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/additional-considerations-services-jobs#ingress-using-a-service-from-outside-snowflake)

---

## 🔍 Monitoring and Debugging

### View Service Logs

```sql
-- View logs from all containers
CALL SYSTEM$GET_SERVICE_LOGS('SNOWGRAM_DB.CORE.SNOWGRAM_SERVICE', '0', 'backend', 100);
CALL SYSTEM$GET_SERVICE_LOGS('SNOWGRAM_DB.CORE.SNOWGRAM_SERVICE', '0', 'frontend', 100);
```

```bash
# Using Snowflake CLI
snow spcs service logs SNOWGRAM_SERVICE \
  --container-name backend \
  --num-lines 100 \
  --database SNOWGRAM_DB \
  --schema CORE \
  --connection svcUser
```

### View Service Events

```sql
-- Get service events (useful for troubleshooting)
SELECT * FROM TABLE(
  INFORMATION_SCHEMA.SERVICE_EVENTS(
    SERVICE_NAME => 'SNOWGRAM_DB.CORE.SNOWGRAM_SERVICE'
  )
)
ORDER BY TIMESTAMP DESC
LIMIT 50;
```

### Common Issues

| Issue | Symptom | Solution |
|-------|---------|----------|
| Image pull failure | Status: `PENDING` for >5 min | Verify image exists in repository |
| Container crash loop | Status: `RUNNING` but not `READY` | Check container logs for errors |
| Endpoint not accessible | 404 or connection refused | Verify endpoint configuration in spec |
| Permission denied | 403 errors | Grant `USAGE` on service to role |

**Source**: [SPCS Troubleshooting](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/troubleshooting)

---

## 🔐 Security Best Practices

### 1. External Access Integration (for API calls)

If SnowGram needs to call external APIs:

```sql
-- Create network rule
CREATE OR REPLACE NETWORK RULE external_api_rule
  MODE = EGRESS
  TYPE = HOST_PORT
  VALUE_LIST = ('api.example.com:443', 'another-api.com:443');

-- Create external access integration
CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION external_api_integration
  ALLOWED_NETWORK_RULES = (external_api_rule)
  ENABLED = TRUE;

-- Grant usage
GRANT USAGE ON INTEGRATION external_api_integration TO ROLE SYSADMIN;

-- Update service to use integration
ALTER SERVICE SNOWGRAM_SERVICE SET
  EXTERNAL_ACCESS_INTEGRATIONS = (external_api_integration);
```

### 2. Secrets Management

Store sensitive data (API keys, passwords) as Snowflake secrets:

```sql
-- Create secret
CREATE OR REPLACE SECRET api_key
  TYPE = GENERIC_STRING
  SECRET_STRING = 'your-api-key-here';

-- Grant usage
GRANT USAGE ON SECRET api_key TO ROLE SYSADMIN;

-- Reference in service spec
-- env:
--   API_KEY:
--     secretKeyRef: "api_key"
```

### 3. Network Policies

Restrict access to services by IP range:

```sql
-- Create network policy
CREATE OR REPLACE NETWORK POLICY snowgram_policy
  ALLOWED_IP_LIST = ('203.0.113.0/24', '198.51.100.0/24')
  BLOCKED_IP_LIST = ();

-- Apply to account or role
ALTER ACCOUNT SET NETWORK_POLICY = snowgram_policy;
```

**Source**: [SPCS Security](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/additional-considerations-services-jobs#security-overview)

---

## 📊 Cost Optimization

### 1. Auto-Suspend Compute Pools

```sql
-- Set aggressive auto-suspend for dev environments
ALTER COMPUTE POOL SNOWGRAM_COMPUTE_POOL SET
  AUTO_SUSPEND_SECS = 600;  -- 10 minutes

-- For production, balance cost and latency
ALTER COMPUTE POOL SNOWGRAM_COMPUTE_POOL SET
  AUTO_SUSPEND_SECS = 3600;  -- 1 hour
```

### 2. Right-Size Instances

Start small and scale up based on actual usage:

```sql
-- Start with smaller instances
ALTER COMPUTE POOL SNOWGRAM_COMPUTE_POOL SET
  INSTANCE_FAMILY = CPU_X64_S
  MIN_NODES = 1
  MAX_NODES = 2;

-- Monitor and upgrade if needed
ALTER COMPUTE POOL SNOWGRAM_COMPUTE_POOL SET
  INSTANCE_FAMILY = CPU_X64_M
  MAX_NODES = 5;
```

### 3. Monitor Usage

```sql
-- Query compute pool usage
SELECT *
FROM SNOWFLAKE.ACCOUNT_USAGE.COMPUTE_POOL_USAGE_HISTORY
WHERE COMPUTE_POOL_NAME = 'SNOWGRAM_COMPUTE_POOL'
  AND START_TIME >= DATEADD(day, -7, CURRENT_TIMESTAMP())
ORDER BY START_TIME DESC;

-- Check service costs
SELECT *
FROM SNOWFLAKE.ACCOUNT_USAGE.SERVICE_USAGE_HISTORY
WHERE SERVICE_NAME = 'SNOWGRAM_SERVICE'
  AND START_TIME >= DATEADD(day, -7, CURRENT_TIMESTAMP())
ORDER BY START_TIME DESC;
```

---

## 🔄 Update and Rollback

### Update Service with New Image

```bash
# Build new image
docker build -t snowgram:v1.1.0 -f docker/Dockerfile .

# Push to registry
snow spcs image-repository upload-image IMAGE_REPO \
  --image-name snowgram:v1.1.0 \
  --connection svcUser

# Update spec.yml with new image tag
# Then recreate service
snow spcs service create SNOWGRAM_SERVICE \
  --compute-pool SNOWGRAM_COMPUTE_POOL \
  --spec-path @SPECS_STAGE/spec.yml \
  --replace \
  --connection svcUser
```

### Rollback to Previous Version

```bash
# Update spec.yml to use previous image tag (e.g., v1.0.0)
# Recreate service
snow spcs service create SNOWGRAM_SERVICE \
  --compute-pool SNOWGRAM_COMPUTE_POOL \
  --spec-path @SPECS_STAGE/spec.yml \
  --replace \
  --connection svcUser
```

---

## ✅ Deployment Checklist

### Pre-Deployment
- [ ] `setup_backend.sql` executed
- [ ] Image repository created
- [ ] Compute pool created
- [ ] Service specification file created
- [ ] Docker image built and tested locally

### Deployment
- [ ] Docker image pushed to Snowflake registry
- [ ] Specification file uploaded to stage
- [ ] Service created successfully
- [ ] Service status shows `READY`
- [ ] Endpoints are accessible

### Post-Deployment
- [ ] Grant service usage to appropriate roles
- [ ] Test public endpoint in browser
- [ ] Verify agent integration works
- [ ] Set up monitoring and alerts
- [ ] Document endpoint URLs for users

---

## 📚 Additional Resources

### Official Documentation
- [Snowpark Container Services Overview](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/overview)
- [Service Specification Reference](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/specification-reference)
- [Snowflake CLI - SPCS Commands](https://docs.snowflake.com/en/developer-guide/snowflake-cli/spcs/overview)
- [SPCS Troubleshooting](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/troubleshooting)

### SnowGram Files
- `spec_simple.yml` - Service specification template
- `setup_backend.sql` - Database setup script
- `docker/Dockerfile` - Container image definition
- `grant_spcs_permissions.sql` - SPCS privilege grants

---

**Research Completed By**: Cursor Agent  
**MCP Server**: `snowhouse-mcp` (Snowflake Documentation CKE)  
**Connection**: `svcUser`  
**Date**: November 14, 2025

**All information sourced from docs.snowflake.com**

