# SPCS Deployment Reference for SnowGram

> **Quick reference for deploying SnowGram to Snowpark Container Services**  
> Source: Snowflake Documentation via MCP Server (Nov 14, 2025)

## 🎯 What You Need to Know

**SPCS** (Snowpark Container Services) = Snowflake's fully managed container platform
- No Kubernetes needed
- Native Snowflake integration (RBAC, stages, warehouses)
- Auto-scaling compute pools
- Built-in authentication

---

## 🚀 Quick Deployment (30 minutes)

### Step 1: Prerequisites

```sql
USE ROLE ACCOUNTADMIN;
GRANT CREATE COMPUTE POOL ON ACCOUNT TO ROLE SYSADMIN;
GRANT BIND SERVICE ENDPOINT ON ACCOUNT TO ROLE SYSADMIN;  -- For public endpoints

USE ROLE SYSADMIN;
!source setup_backend.sql
```

### Step 2: Create Image Repository

```bash
snow spcs image-repository create SNOWGRAM_IMAGE_REPO \
  --database SNOWGRAM_DB \
  --schema CORE \
  --connection svcUser
```

### Step 3: Build and Push Image

```bash
cd /Users/abannerjee/Documents/SnowGram

# Build
docker build -t snowgram:latest -f docker/Dockerfile .

# Login
snow spcs image-registry login --connection svcUser

# Upload
snow spcs image-repository upload-image SNOWGRAM_IMAGE_REPO \
  --database SNOWGRAM_DB \
  --schema CORE \
  --image-name snowgram:latest \
  --connection svcUser
```

### Step 4: Create Compute Pool

```bash
snow spcs compute-pool create SNOWGRAM_COMPUTE_POOL \
  --family CPU_X64_M \
  --min-nodes 1 \
  --max-nodes 3 \
  --auto-resume \
  --auto-suspend-secs 3600 \
  --connection svcUser
```

**Instance Families**:
- `CPU_X64_S` = 2 vCPU, 4 GB RAM (dev)
- `CPU_X64_M` = 4 vCPU, 8 GB RAM (**recommended for SnowGram**)
- `CPU_X64_L` = 8 vCPU, 16 GB RAM (production)

### Step 5: Upload Service Spec

```sql
USE DATABASE SNOWGRAM_DB;
USE SCHEMA CORE;

CREATE STAGE IF NOT EXISTS SPECS_STAGE;

PUT file:///Users/abannerjee/Documents/SnowGram/spec_simple.yml 
  @SPECS_STAGE AUTO_COMPRESS=FALSE OVERWRITE=TRUE;
```

### Step 6: Deploy Service

```bash
snow spcs service create SNOWGRAM_SERVICE \
  --compute-pool SNOWGRAM_COMPUTE_POOL \
  --spec-path @SPECS_STAGE/spec_simple.yml \
  --min-instances 1 \
  --max-instances 3 \
  --database SNOWGRAM_DB \
  --schema CORE \
  --connection svcUser
```

**Wait for READY status** (2-5 minutes):
- `PENDING` → Creating
- `RUNNING` → Starting containers
- `READY` → Operational ✅

### Step 7: Access Endpoint

```bash
snow spcs service list-endpoints SNOWGRAM_SERVICE \
  --database SNOWGRAM_DB \
  --schema CORE \
  --connection svcUser
```

---

## 📋 Service Specification Essentials

**Key spec.yml elements**:

```yaml
spec:
  containers:
  - name: snowgram
    image: /snowgram_db/core/snowgram_image_repo/snowgram:latest
    resources:
      requests:
        cpu: 1
        memory: 2Gi
      limits:
        cpu: 2
        memory: 4Gi
    readinessProbe:
      httpGet:
        path: /health
        port: 80
  endpoints:
  - name: web
    port: 80
    public: true  # Internet-accessible
```

**Critical Notes**:
- Image path is relative: `/database/schema/repo/image:tag`
- Always set resource `requests` and `limits`
- `public: true` requires `BIND SERVICE ENDPOINT` privilege (ACCOUNTADMIN)
- Health checks prevent traffic to unhealthy containers

---

## 🔍 Verification Commands

### Check Status
```bash
snow spcs service status SNOWGRAM_SERVICE \
  --database SNOWGRAM_DB --schema CORE --connection svcUser
```

### View Logs
```bash
snow spcs service logs SNOWGRAM_SERVICE \
  --container-name snowgram \
  --num-lines 50 \
  --database SNOWGRAM_DB --schema CORE --connection svcUser
```

### Test Health
```bash
curl -f "<ingress_url>/health"
```

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Stuck in PENDING | Check image exists in repository |
| Container crash loop | View logs: `snow spcs service logs` |
| Cannot access endpoint | `GRANT USAGE ON SERVICE TO ROLE PUBLIC` |
| Permission denied | Verify `BIND SERVICE ENDPOINT` granted |

---

## 🔄 Update Workflow

```bash
# 1. Build new version
docker build -t snowgram:v1.1.0 -f docker/Dockerfile .

# 2. Upload
snow spcs image-repository upload-image SNOWGRAM_IMAGE_REPO \
  --image-name snowgram:v1.1.0 --connection svcUser

# 3. Update spec_simple.yml with new image tag

# 4. Upload updated spec
PUT file:///path/to/spec_simple.yml @SPECS_STAGE OVERWRITE=TRUE;

# 5. Recreate service
snow spcs service create SNOWGRAM_SERVICE \
  --compute-pool SNOWGRAM_COMPUTE_POOL \
  --spec-path @SPECS_STAGE/spec_simple.yml \
  --replace \
  --connection svcUser
```

---

## 💰 Cost Optimization

**Development**:
```sql
ALTER COMPUTE POOL SNOWGRAM_COMPUTE_POOL SET
  AUTO_SUSPEND_SECS = 600  -- 10 minutes
  INSTANCE_FAMILY = CPU_X64_S;
```

**Production**:
```sql
ALTER COMPUTE POOL SNOWGRAM_COMPUTE_POOL SET
  AUTO_SUSPEND_SECS = 3600  -- 1 hour
  INSTANCE_FAMILY = CPU_X64_M
  MAX_NODES = 5;
```

---

## 📚 Implementation Files

**For detailed docs, see**:
- `docs/SPCS_DEPLOYMENT_GUIDE.md` - Full guide (~7,000 words)
- `spec_simple.yml` - Service specification template
- `grant_spcs_permissions.sql` - SPCS privilege grants

**Official Snowflake Docs**:
- [SPCS Overview](https://docs.snowflake.com/en/developer-guide/snowpark-container-services)
- [Service Specification](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/specification-reference)
- [Snowflake CLI - SPCS](https://docs.snowflake.com/en/developer-guide/snowflake-cli/spcs/overview)

---

**Researched**: Nov 14, 2025 via `snowflake-docs` MCP Server
