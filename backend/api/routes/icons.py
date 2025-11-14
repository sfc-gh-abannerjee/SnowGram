"""
Icon API Routes
===============
Endpoints for icon management (upload, list, download).
"""

import logging
import uuid
from typing import Optional, List

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


# =====================================================
# Request/Response Models
# =====================================================

class IconMetadata(BaseModel):
    """Icon metadata model"""
    icon_id: str
    icon_name: str
    file_type: str  # svg, png
    file_size: int  # bytes
    stage_url: str
    uploaded_at: str
    tags: List[str]


class UploadIconResponse(BaseModel):
    """Response model for icon upload"""
    icon_id: str
    icon_name: str
    stage_url: str
    message: str


# =====================================================
# Endpoints
# =====================================================

@router.post("/upload", response_model=UploadIconResponse)
async def upload_icon(
    file: UploadFile = File(...),
    tags: Optional[List[str]] = None
):
    """
    Upload custom icon to Snowflake stage.
    
    Supported formats: SVG, PNG
    Max file size: 5MB
    
    Uploads to: @SNOWGRAM_DB.CORE.ICONS_STAGE
    """
    try:
        # Validate file type
        allowed_types = ["image/svg+xml", "image/png"]
        if file.content_type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type. Allowed: SVG, PNG"
            )
        
        # Validate file size (5MB max)
        contents = await file.read()
        file_size = len(contents)
        
        if file_size > 5 * 1024 * 1024:  # 5MB
            raise HTTPException(
                status_code=400,
                detail="File size exceeds 5MB limit"
            )
        
        # Generate icon ID
        icon_id = str(uuid.uuid4())
        icon_name = file.filename
        
        logger.info(f"Uploading icon: {icon_name} ({file_size} bytes)")
        
        # TODO: Upload to Snowflake stage
        # PUT file://<local_path> @SNOWGRAM_DB.CORE.ICONS_STAGE/icons/
        
        stage_url = f"@SNOWGRAM_DB.CORE.ICONS_STAGE/icons/{icon_id}/{icon_name}"
        
        return UploadIconResponse(
            icon_id=icon_id,
            icon_name=icon_name,
            stage_url=stage_url,
            message=f"Icon '{icon_name}' uploaded successfully"
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading icon: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list", response_model=List[IconMetadata])
async def list_icons(
    tag: Optional[str] = None,
    limit: int = 100
):
    """
    List available icons from stage.
    
    Query parameters:
        - tag: Filter by tag
        - limit: Maximum number of results
    
    Returns icons from:
        - Default Snowflake icon pack
        - User-uploaded custom icons
    """
    try:
        logger.info(f"Listing icons (limit={limit}, tag={tag})")
        
        # TODO: Query Snowflake stage for icon files
        # LIST @SNOWGRAM_DB.CORE.ICONS_STAGE/icons/
        
        # Return default icons for now
        default_icons = [
            IconMetadata(
                icon_id="default-warehouse",
                icon_name="warehouse.svg",
                file_type="svg",
                file_size=2048,
                stage_url="@SNOWGRAM_DB.CORE.ICONS_STAGE/default/warehouse.svg",
                uploaded_at="2025-01-01T00:00:00Z",
                tags=["compute", "default"]
            ),
            IconMetadata(
                icon_id="default-database",
                icon_name="database.svg",
                file_type="svg",
                file_size=1850,
                stage_url="@SNOWGRAM_DB.CORE.ICONS_STAGE/default/database.svg",
                uploaded_at="2025-01-01T00:00:00Z",
                tags=["storage", "default"]
            ),
            IconMetadata(
                icon_id="default-table",
                icon_name="table.svg",
                file_type="svg",
                file_size=1920,
                stage_url="@SNOWGRAM_DB.CORE.ICONS_STAGE/default/table.svg",
                uploaded_at="2025-01-01T00:00:00Z",
                tags=["storage", "default"]
            )
        ]
        
        # Filter by tag if provided
        if tag:
            default_icons = [icon for icon in default_icons if tag in icon.tags]
        
        return default_icons[:limit]
    
    except Exception as e:
        logger.error(f"Error listing icons: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/download/{icon_id}")
async def download_icon(icon_id: str):
    """
    Download icon file from stage.
    
    Returns a pre-signed URL or file stream.
    """
    try:
        logger.info(f"Downloading icon: {icon_id}")
        
        # TODO: Generate pre-signed URL for stage file
        # GET @SNOWGRAM_DB.CORE.ICONS_STAGE/icons/{icon_id}/*
        
        return {
            "icon_id": icon_id,
            "download_url": f"@SNOWGRAM_DB.CORE.ICONS_STAGE/icons/{icon_id}",
            "expires_in": 3600  # 1 hour
        }
    
    except Exception as e:
        logger.error(f"Error downloading icon: {e}")
        raise HTTPException(status_code=404, detail=f"Icon {icon_id} not found")


@router.delete("/delete/{icon_id}")
async def delete_icon(icon_id: str):
    """
    Delete custom icon from stage.
    
    Note: Cannot delete default icons.
    """
    try:
        logger.info(f"Deleting icon: {icon_id}")
        
        # Check if it's a default icon
        if icon_id.startswith("default-"):
            raise HTTPException(
                status_code=400,
                detail="Cannot delete default icons"
            )
        
        # TODO: Remove from Snowflake stage
        # REMOVE @SNOWGRAM_DB.CORE.ICONS_STAGE/icons/{icon_id}/*
        
        return {
            "icon_id": icon_id,
            "message": "Icon deleted successfully"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting icon: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/categories")
async def list_icon_categories():
    """
    List available icon categories/tags.
    
    Useful for organizing and filtering icons in the UI.
    """
    return {
        "categories": [
            {"name": "compute", "count": 5, "description": "Compute resources (warehouses)"},
            {"name": "storage", "count": 8, "description": "Storage objects (databases, schemas, tables)"},
            {"name": "ingestion", "count": 6, "description": "Data ingestion (Snowpipe, stages)"},
            {"name": "transformation", "count": 7, "description": "Data transformation (streams, tasks)"},
            {"name": "security", "count": 4, "description": "Security (roles, grants)"},
            {"name": "external", "count": 10, "description": "External systems (S3, Kafka, BI tools)"},
            {"name": "custom", "count": 0, "description": "User-uploaded custom icons"}
        ]
    }






