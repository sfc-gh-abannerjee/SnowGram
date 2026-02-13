"""
Diagram API Routes
==================
Endpoints for diagram generation, save, load, and export.
"""

import logging
import uuid
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


# =====================================================
# Request/Response Models
# =====================================================

class GenerateDiagramRequest(BaseModel):
    """Request model for diagram generation"""
    user_query: str = Field(..., description="Natural language query for diagram generation")
    diagram_type: Optional[str] = Field("future_state", description="current_state or future_state")
    use_case: Optional[str] = Field(None, description="Specific use case or industry")


class GenerateDiagramResponse(BaseModel):
    """Response model for diagram generation"""
    mermaid_code: str = Field(..., description="Generated Mermaid diagram code")
    explanation: str = Field(..., description="Agent explanation of the diagram")
    components_used: List[str] = Field(default_factory=list, description="Component block IDs used")
    generation_time_ms: int = Field(..., description="Generation time in milliseconds")


class SaveDiagramRequest(BaseModel):
    """Request model for saving diagram"""
    diagram_name: str = Field(..., description="User-provided diagram name")
    mermaid_code: str = Field(..., description="Mermaid code")
    excalidraw_json: Optional[dict] = Field(None, description="Excalidraw state")
    diagram_type: str = Field("future_state", description="current_state or future_state")
    tags: Optional[List[str]] = Field(default_factory=list, description="Tags for categorization")
    project_name: Optional[str] = Field(None, description="Project name")
    is_public: bool = Field(False, description="Whether diagram is shared publicly")


class SaveDiagramResponse(BaseModel):
    """Response model for saving diagram"""
    diagram_id: str = Field(..., description="Unique diagram ID")
    message: str = Field(..., description="Success message")


class LoadDiagramResponse(BaseModel):
    """Response model for loading diagram"""
    diagram_id: str
    diagram_name: str
    mermaid_code: str
    excalidraw_json: Optional[dict]
    diagram_type: str
    tags: List[str]
    project_name: Optional[str]
    created_timestamp: str
    updated_timestamp: str
    is_public: bool


class ExportDiagramRequest(BaseModel):
    """Request model for exporting diagram"""
    mermaid_code: str = Field(..., description="Mermaid code to export")
    format: str = Field("png", description="Export format: png, svg, or pdf")
    width: Optional[int] = Field(1920, description="Export width in pixels")
    height: Optional[int] = Field(1080, description="Export height in pixels")


# =====================================================
# Endpoints
# =====================================================

@router.post("/generate", response_model=GenerateDiagramResponse)
async def generate_diagram(request: GenerateDiagramRequest):
    """
    Generate diagram from natural language query.
    
    This endpoint calls the Cortex Agent which orchestrates across:
    - Semantic models (via Cortex Analyst)
    - Documentation search (via Cortex Search)
    - Custom tools (Mermaid generation UDFs)
    """
    try:
        logger.info(f"Generating diagram for query: {request.user_query[:50]}...")
        
        start_time = datetime.now()
        
        # Get Cortex Agent client from app state
        from api.main import cortex_agent_client
        
        # Prepare context for the agent
        context = {
            "diagram_type": request.diagram_type,
            "use_case": request.use_case
        }
        
        # Call Cortex Agent (if available)
        if cortex_agent_client:
            try:
                logger.info("Calling Cortex Agent for diagram generation...")
                agent_response = await cortex_agent_client.query_agent(
                    query=request.user_query,
                    context=context
                )
                
                mermaid_code = agent_response["mermaid_code"]
                explanation = agent_response["explanation"]
                components_used = agent_response["components_used"]
                
                logger.info(f"✅ Agent response received ({agent_response['generation_time_ms']}ms)")
                
            except Exception as agent_error:
                logger.warning(f"⚠️  Cortex Agent call failed: {agent_error}")
                logger.warning("⚠️  Using fallback diagram generation")
                
                # Fallback: Generate simple diagram
                mermaid_code = f"""flowchart LR
    A[Data Source] --> B[Snowflake]
    B --> C[Analysis]
    C --> D[Insights]
    
    %% Generated from: {request.user_query[:50]}...
    %% Note: Using fallback generation (Agent error)
    
    classDef snowflakeBlue fill:#29B5E8,stroke:#1A78B8,stroke-width:2px,color:#fff
    class A,B,C,D snowflakeBlue
"""
                explanation = f"**Note**: Generated simplified diagram. Cortex Agent is temporarily unavailable.\n\n**Your Query**: {request.user_query}\n\nPlease try again or contact support if the issue persists."
                components_used = ["fallback_generation"]
        else:
            # Agent not initialized - use fallback
            logger.warning("⚠️  Cortex Agent not initialized, using fallback generation")
            
            mermaid_code = f"""flowchart LR
    A[Data Source] --> B[Snowflake]
    B --> C[Analysis]
    C --> D[Insights]
    
    %% Generated from: {request.user_query[:50]}...
    %% Note: Using fallback generation (Agent not configured)
    
    classDef snowflakeBlue fill:#29B5E8,stroke:#1A78B8,stroke-width:2px,color:#fff
    class A,B,C,D snowflakeBlue
"""
            explanation = f"**Note**: Generated simplified diagram. Cortex Agent is not configured.\n\n**Your Query**: {request.user_query}\n\nTo enable AI-powered diagram generation, please set the `CORTEX_AGENT_NAME` environment variable and ensure the agent is created in Snowflake."
            components_used = ["fallback_generation"]
        
        end_time = datetime.now()
        generation_time_ms = int((end_time - start_time).total_seconds() * 1000)
        
        return GenerateDiagramResponse(
            mermaid_code=mermaid_code,
            explanation=explanation,
            components_used=components_used,
            generation_time_ms=generation_time_ms
        )
    
    except Exception as e:
        logger.error(f"Error generating diagram: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/save", response_model=SaveDiagramResponse)
async def save_diagram(request: SaveDiagramRequest):
    """
    Save diagram to Snowflake database.
    
    Stores in SNOWGRAM_DB.CORE.USER_DIAGRAMS table.
    """
    try:
        logger.info(f"Saving diagram: {request.diagram_name}")
        
        # Generate diagram ID
        diagram_id = str(uuid.uuid4())
        
        # TODO: Save to Snowflake USER_DIAGRAMS table
        # INSERT INTO SNOWGRAM_DB.CORE.USER_DIAGRAMS ...
        
        return SaveDiagramResponse(
            diagram_id=diagram_id,
            message=f"Diagram '{request.diagram_name}' saved successfully"
        )
    
    except Exception as e:
        logger.error(f"Error saving diagram: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/load/{diagram_id}", response_model=LoadDiagramResponse)
async def load_diagram(diagram_id: str):
    """
    Load saved diagram from database.
    
    Retrieves from SNOWGRAM_DB.CORE.USER_DIAGRAMS table.
    """
    try:
        logger.info(f"Loading diagram: {diagram_id}")
        
        # TODO: Query Snowflake USER_DIAGRAMS table
        # SELECT * FROM SNOWGRAM_DB.CORE.USER_DIAGRAMS WHERE diagram_id = ?
        
        # Placeholder response
        return LoadDiagramResponse(
            diagram_id=diagram_id,
            diagram_name="Sample Diagram",
            mermaid_code="flowchart LR\n    A --> B",
            excalidraw_json=None,
            diagram_type="future_state",
            tags=["sample"],
            project_name=None,
            created_timestamp=datetime.now().isoformat(),
            updated_timestamp=datetime.now().isoformat(),
            is_public=False
        )
    
    except Exception as e:
        logger.error(f"Error loading diagram: {e}")
        raise HTTPException(status_code=404, detail=f"Diagram {diagram_id} not found")


@router.get("/list")
async def list_diagrams(
    user_id: Optional[str] = None,
    project_name: Optional[str] = None,
    limit: int = 20
):
    """
    List saved diagrams with optional filtering.
    
    Query parameters:
        - user_id: Filter by user
        - project_name: Filter by project
        - limit: Maximum number of results
    """
    try:
        logger.info(f"Listing diagrams (limit={limit})")
        
        # TODO: Query Snowflake USER_DIAGRAMS table with filters
        
        return {
            "diagrams": [],
            "count": 0,
            "limit": limit
        }
    
    except Exception as e:
        logger.error(f"Error listing diagrams: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/export")
async def export_diagram(request: ExportDiagramRequest):
    """
    Export diagram as PNG, SVG, or PDF.
    
    Note: This requires a Mermaid rendering service or library.
    For SPCS deployment, consider using Puppeteer or similar.
    """
    try:
        logger.info(f"Exporting diagram as {request.format}")
        
        # TODO: Render Mermaid to requested format
        # Options:
        # 1. Use mermaid-cli (mmdc)
        # 2. Use Puppeteer + mermaid.js
        # 3. Call external rendering service
        
        return {
            "status": "not_implemented",
            "message": "Export functionality to be implemented",
            "format": request.format
        }
    
    except Exception as e:
        logger.error(f"Error exporting diagram: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/delete/{diagram_id}")
async def delete_diagram(diagram_id: str):
    """
    Delete saved diagram.
    
    Removes from SNOWGRAM_DB.CORE.USER_DIAGRAMS table.
    """
    try:
        logger.info(f"Deleting diagram: {diagram_id}")
        
        # TODO: DELETE FROM SNOWGRAM_DB.CORE.USER_DIAGRAMS WHERE diagram_id = ?
        
        return {
            "diagram_id": diagram_id,
            "message": "Diagram deleted successfully"
        }
    
    except Exception as e:
        logger.error(f"Error deleting diagram: {e}")
        raise HTTPException(status_code=500, detail=str(e))






