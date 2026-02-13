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
import sys
import logging
from contextlib import asynccontextmanager
from typing import Optional
from pathlib import Path

# Load environment variables from .env file
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

# Add parent directory to path for imports when running from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from db.connector import SnowflakeConnector
from agent.cortex_agent_client import CortexAgentClient

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
    
    # Initialize Snowflake connector - auto-detects SPCS vs local environment
    try:
        snowflake_connector = SnowflakeConnector.create_from_env()
        await snowflake_connector.connect()
        logger.info("✅ Snowflake connection established")
    except Exception as e:
        logger.error(f"❌ Failed to connect to Snowflake: {e}")
        logger.warning("⚠️  Running in degraded mode (some endpoints may not work)")
        snowflake_connector = None
    
    # Initialize Cortex Agent client
    agent_name = os.getenv("CORTEX_AGENT_NAME", "SNOWGRAM_AGENT")
    if agent_name:
        try:
            cortex_agent_client = CortexAgentClient.create_from_env(
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

from api.routes import diagrams, icons
from api import health

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
        "api.main:app",  # Run from backend/ directory
        host="0.0.0.0",
        port=int(os.getenv("BACKEND_PORT", "8082")),  # Default 8082 to avoid conflict with 8081
        reload=os.getenv("ENVIRONMENT") == "development",
        log_level=os.getenv("LOG_LEVEL", "info").lower()
    )






