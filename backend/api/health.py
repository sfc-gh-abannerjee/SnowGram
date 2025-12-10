"""
Health Check Endpoints for SPCS Monitoring
Provides readiness and liveness checks with detailed diagnostics
"""

from fastapi import APIRouter, Response, status
from pydantic import BaseModel
from datetime import datetime
import os
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


class HealthResponse(BaseModel):
    """Health check response model"""
    status: str
    timestamp: str
    service: str
    version: str
    checks: dict


class ReadinessCheck(BaseModel):
    """Readiness check details"""
    snowflake_connection: bool
    database_accessible: bool
    environment_configured: bool


@router.get("/", response_model=HealthResponse)
async def health_check():
    """
    Basic health check endpoint for liveness probe.
    Returns 200 if service is running.
    """
    return HealthResponse(
        status="healthy",
        timestamp=datetime.utcnow().isoformat(),
        service="SnowGram",
        version="1.0.0",
        checks={
            "api": "ok",
            "process": "running"
        }
    )


@router.get("/ready", response_model=HealthResponse)
async def readiness_check(response: Response):
    """
    Readiness check endpoint with dependency validation.
    Returns 200 if service is ready to accept traffic.
    Returns 503 if service is not ready.
    """
    checks = {
        "api": "ok",
        "environment": check_environment(),
        "snowflake_config": check_snowflake_config()
    }
    
    # Service is ready if all checks pass
    all_ready = all(v == "ok" for v in checks.values())
    
    if not all_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthResponse(
            status="not_ready",
            timestamp=datetime.utcnow().isoformat(),
            service="SnowGram",
            version="1.0.0",
            checks=checks
        )
    
    return HealthResponse(
        status="ready",
        timestamp=datetime.utcnow().isoformat(),
        service="SnowGram",
        version="1.0.0",
        checks=checks
    )


@router.get("/live")
async def liveness_check():
    """
    Liveness check endpoint for SPCS.
    Returns 200 if service is alive and responsive.
    """
    return {
        "status": "alive",
        "timestamp": datetime.utcnow().isoformat()
    }


def check_environment() -> str:
    """Check if required environment variables are set"""
    required_vars = [
        "SNOWFLAKE_ACCOUNT",
        "SNOWFLAKE_USER",
        "SNOWFLAKE_ROLE",
        "SNOWFLAKE_WAREHOUSE",
        "SNOWFLAKE_DATABASE",
        "SNOWFLAKE_SCHEMA"
    ]
    
    missing = [var for var in required_vars if not os.getenv(var)]
    
    if missing:
        logger.warning(f"Missing environment variables: {missing}")
        return f"missing_vars: {', '.join(missing)}"
    
    return "ok"


def check_snowflake_config() -> str:
    """Check if Snowflake configuration is valid"""
    try:
        # Basic config check
        account = os.getenv("SNOWFLAKE_ACCOUNT")
        user = os.getenv("SNOWFLAKE_USER")
        
        if not account or not user:
            return "incomplete_config"
        
        # Could add actual connection test here if needed
        # For now, just verify config is present
        return "ok"
        
    except Exception as e:
        logger.error(f"Snowflake config check failed: {e}")
        return f"error: {str(e)}"


@router.get("/metrics")
async def metrics_endpoint():
    """
    Prometheus-compatible metrics endpoint.
    Returns service metrics in Prometheus format.
    """
    # Basic metrics - can be extended with actual monitoring data
    metrics = f"""# HELP snowgram_health Service health status (1 = healthy)
# TYPE snowgram_health gauge
snowgram_health 1

# HELP snowgram_uptime_seconds Service uptime in seconds
# TYPE snowgram_uptime_seconds counter
snowgram_uptime_seconds {{service="snowgram"}} {os.times().elapsed}

# HELP snowgram_requests_total Total HTTP requests
# TYPE snowgram_requests_total counter
snowgram_requests_total {{method="GET",endpoint="/health"}} 0
"""
    
    return Response(content=metrics, media_type="text/plain")

