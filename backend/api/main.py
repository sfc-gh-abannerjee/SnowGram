"""
SnowGram FastAPI Application
============================
Main FastAPI application for SnowGram backend.

Endpoints:
    - GET /health: Health check
    - WS /ws/chat: WebSocket for Cortex Agent conversation
    - POST /api/diagram/generate: Generate diagram from text
    - POST /api/diagram/save: Save diagram to database
    - GET /api/diagram/load/{id}: Load saved diagram
    - POST /api/diagram/export: Export diagram as PNG/SVG/PDF
    - POST /api/icons/upload: Upload custom icon
    - GET /api/icons/list: List available icons
"""

import os
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

# Import database connector and Cortex Agent client
from backend.db.connector import SnowflakeConnector
from backend.agent.cortex_agent_client import CortexAgentClient

# Setup logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Global Snowflake connector instance
snowflake_connector: Optional[SnowflakeConnector] = None
# Global Cortex Agent client instance
cortex_agent_client: Optional[CortexAgentClient] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup and shutdown"""
    global snowflake_connector, cortex_agent_client
    
    # Startup
    logger.info("🚀 Starting SnowGram application...")
    
    # Initialize Snowflake connector (optional for testing)
    try:
        account = os.getenv("SNOWFLAKE_ACCOUNT")
        if account:
            snowflake_connector = SnowflakeConnector(
                account=account,
                user=os.getenv("SNOWFLAKE_USER"),
                password=os.getenv("SNOWFLAKE_PASSWORD"),
                role=os.getenv("SNOWFLAKE_ROLE", "SNOWGRAM_APP_ROLE"),
                warehouse=os.getenv("SNOWFLAKE_WAREHOUSE", "SNOWGRAM_WH"),
                database=os.getenv("SNOWFLAKE_DATABASE", "SNOWGRAM_DB"),
                schema=os.getenv("SNOWFLAKE_SCHEMA", "CORE")
            )
            await snowflake_connector.connect()
            logger.info("✅ Snowflake connection established")
        else:
            logger.warning("⚠️  SNOWFLAKE_ACCOUNT not set, running in test mode (icon/health endpoints only)")
            snowflake_connector = None
    except Exception as e:
        logger.error(f"❌ Failed to connect to Snowflake: {e}")
        logger.warning("⚠️  Running in degraded mode (some endpoints may not work)")
        snowflake_connector = None
    
    # Initialize Cortex Agent client
    agent_name = os.getenv("CORTEX_AGENT_NAME", "SNOWGRAM_AGENT")
    if agent_name:
        try:
            cortex_agent_client = CortexAgentClient(
                account=os.getenv("SNOWFLAKE_ACCOUNT"),
                user=os.getenv("SNOWFLAKE_USER"),
                password=os.getenv("SNOWFLAKE_PASSWORD"),
                agent_name=agent_name,
                database=os.getenv("SNOWFLAKE_DATABASE", "SNOWGRAM_DB"),
                schema=os.getenv("SNOWFLAKE_SCHEMA", "CORE")
            )
            logger.info(f"✅ Cortex Agent client initialized: {agent_name}")
        except Exception as e:
            logger.warning(f"⚠️  Failed to initialize Cortex Agent client: {e}")
            logger.warning("⚠️  Diagram generation will use fallback mode")
            cortex_agent_client = None
    else:
        logger.warning("⚠️  CORTEX_AGENT_NAME not set, diagram generation will use fallback mode")
        cortex_agent_client = None
    
    yield
    
    # Shutdown
    logger.info("🛑 Shutting down SnowGram application...")
    if snowflake_connector:
        await snowflake_connector.close()
        logger.info("✅ Snowflake connection closed")
    if cortex_agent_client:
        await cortex_agent_client.close()
        logger.info("✅ Cortex Agent client closed")


# Create FastAPI application
app = FastAPI(
    title="SnowGram API",
    description="Cortex-powered diagram generation for Snowflake SEs",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware (adjust for production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =====================================================
# Health Check Endpoint
# =====================================================

@app.get("/health")
async def health_check():
    """Health check endpoint for container orchestration"""
    try:
        # Check Snowflake connection
        if snowflake_connector and await snowflake_connector.is_connected():
            return {
                "status": "healthy",
                "snowflake": "connected",
                "version": "1.0.0"
            }
        else:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "unhealthy",
                    "snowflake": "disconnected",
                    "version": "1.0.0"
                }
            )
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "error": str(e),
                "version": "1.0.0"
            }
        )


# =====================================================
# WebSocket Endpoint for Agent Chat
# =====================================================

@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    """
    WebSocket endpoint for real-time agent conversation.
    
    Message format:
    Client → Server: {"type": "message", "content": "user query"}
    Server → Client: {"type": "response", "content": "agent response", "diagram": "mermaid_code"}
    """
    await websocket.accept()
    logger.info("WebSocket connection established")
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_json()
            message_type = data.get("type")
            content = data.get("content")
            
            if message_type == "message":
                logger.info(f"Received message: {content[:50]}...")
                
                # TODO: Call Cortex Agent via REST API
                # For now, echo back with placeholder
                response = {
                    "type": "response",
                    "content": f"Echo: {content}",
                    "diagram": None
                }
                
                await websocket.send_json(response)
            
            elif message_type == "ping":
                await websocket.send_json({"type": "pong"})
            
            else:
                logger.warning(f"Unknown message type: {message_type}")
    
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close(code=1011, reason=str(e))


# =====================================================
# Diagram Endpoints
# =====================================================

from backend.api.routes import diagrams, icons
from backend.api import health

# Include routers
app.include_router(health.router, prefix="/health", tags=["health"])
app.include_router(diagrams.router, prefix="/api/diagram", tags=["diagrams"])
app.include_router(icons.router, prefix="/api/icons", tags=["icons"])


# =====================================================
# Root Endpoint
# =====================================================

@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "application": "SnowGram",
        "version": "1.0.0",
        "description": "Cortex-powered diagram generation for Snowflake SEs",
        "docs": "/docs",
        "health": "/health"
    }


# =====================================================
# Main Entry Point
# =====================================================

if __name__ == "__main__":
    uvicorn.run(
        "backend.api.main:app",
        host="0.0.0.0",
        port=8000,
        reload=os.getenv("ENVIRONMENT") == "development",
        log_level=os.getenv("LOG_LEVEL", "info").lower()
    )






