# SnowGram Local Testing Guide

## Overview

This directory contains scripts for testing SnowGram locally before SPCS deployment.

## Test Files

### `test_local_backend.py`
**Purpose**: Comprehensive backend API testing  
**Tests**: Health checks, icon endpoints, diagram generation, save/load/delete  
**Duration**: ~30 seconds (depending on Snowflake connection)

## Prerequisites

1. **Python Environment**
   ```bash
   conda activate pysnowpark
   pip install requests
   ```

2. **Snowflake Connection**
   - Ensure `~/.snowflake/config.toml` has valid credentials
   - `se_demo` connection should be configured

3. **Backend Running Locally**
   ```bash
   cd /Users/abannerjee/Documents/SnowGram/backend
   uvicorn api.main:app --reload --port 8000
   ```

## Running Tests

### Quick Test (All Endpoints)
```bash
cd /Users/abannerjee/Documents/SnowGram/tests
python test_local_backend.py
```

**Expected Output**:
```
🧪 SnowGram Local Backend Test Suite
======================================================================

Testing API at: http://localhost:8000
Started at: 2025-12-09 18:30:00
✅ Backend is running

🏥 Testing Health Endpoints...
[18:30:00] ✅ PASS - GET /health
    → Status: 200
[18:30:00] ✅ PASS - GET /health/live
    → Status: 200
[18:30:00] ✅ PASS - GET /health/ready
    → Status: 200 - ready

🎨 Testing Icon Endpoints...
[18:30:01] ✅ PASS - GET /api/icons/catalog/font-awesome
    → Found 38 icons in 8 categories
...

📊 TEST SUMMARY
======================================================================

Total Tests: 15
✅ Passed: 15 (100.0%)
❌ Failed: 0 (0.0%)
```

### Manual Endpoint Testing with curl

**Test health**:
```bash
curl http://localhost:8000/health
```

**Test icon catalog**:
```bash
curl http://localhost:8000/api/icons/catalog/font-awesome | jq
```

**Test diagram generation**:
```bash
curl -X POST http://localhost:8000/api/diagram/generate \
  -H "Content-Type: application/json" \
  -d '{"user_query": "Create IoT pipeline", "diagram_type": "future_state"}' \
  | jq
```

**Test icon search**:
```bash
curl "http://localhost:8000/api/icons/search?query=database" | jq
```

## Test Coverage

### ✅ Currently Tested
- [x] Health check endpoints (`/health`, `/health/live`, `/health/ready`)
- [x] Icon catalog endpoints (Font Awesome, Material Icons, Mermaid shapes)
- [x] Icon search and category listing
- [x] Diagram generation endpoint
- [x] Diagram save/load/list/delete endpoints

### ⏳ Manual Testing Required
- [ ] WebSocket real-time updates
- [ ] Cortex Agent integration (requires agent creation)
- [ ] Frontend integration (requires `npm start`)
- [ ] Multi-user concurrent access
- [ ] SPCS deployment validation

## Expected Test Results

### Scenario 1: Agent Not Created Yet
```
✅ Health endpoints: PASS
✅ Icon endpoints: PASS
⚠️  Diagram generation: Returns fallback diagram (expected)
✅ Save/load/delete: PASS (if Snowflake connected)
```

### Scenario 2: Agent Created + Snowflake Connected
```
✅ All tests: PASS
✅ Diagram generation: Returns real agent-generated Mermaid
✅ Response time: <10 seconds
```

### Scenario 3: Snowflake Not Connected
```
✅ Health endpoints: PASS (except /health/ready → 503)
✅ Icon endpoints: PASS
❌ Diagram generation: FAIL (connection error)
❌ Save/load: FAIL (no database access)
```

## Troubleshooting

### Error: `Connection refused`
**Cause**: Backend not running  
**Solution**: Start backend with `uvicorn api.main:app --reload --port 8000`

### Error: `Snowflake connection not ready`
**Cause**: Invalid credentials or network issues  
**Solution**: 
1. Check `~/.snowflake/config.toml`
2. Verify VPN connection
3. Test with `snow sql -c se_demo -q "SELECT CURRENT_USER()"`

### Error: `Agent not configured`
**Cause**: SNOWGRAM_AGENT not created in Snowsight  
**Solution**: Expected behavior. Test will pass with fallback diagram.

### Error: `Module not found: requests`
**Cause**: Missing Python package  
**Solution**: `pip install requests`

## Test Results Storage

Each test run saves results to:
```
tests/test_results_YYYYMMDD_HHMMSS.json
```

Example:
```json
[
  {
    "test": "GET /health",
    "passed": true,
    "details": "Status: 200",
    "timestamp": "18:30:00"
  },
  ...
]
```

## Integration with CI/CD (Future)

When deploying via GitHub Actions:

```yaml
- name: Run Backend Tests
  run: |
    cd tests
    python test_local_backend.py
    
- name: Check Test Results
  run: |
    if grep -q '"passed": false' test_results_*.json; then
      echo "❌ Tests failed"
      exit 1
    fi
```

## Next Steps

After local testing passes:
1. Build Docker image for AMD64
2. Push to Snowflake registry
3. Deploy to SPCS
4. Run SPCS validation tests
5. Frontend integration testing

## Questions?

- See `backend/api/routes/` for endpoint implementations
- See `backend/agent/BACKEND_INTEGRATION.md` for agent integration details
- See `MILESTONES.md` for project status






