"""
Icon Integration Routes for SnowGram

Provides access to icon catalogs from Font Awesome and Material Icons
for use in Mermaid diagrams.
"""

import logging
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter()


# =====================================================
# Icon Catalog Data
# =====================================================

# Font Awesome Free Icons (selected subset for Snowflake architectures)
FONT_AWESOME_ICONS = {
    "data": [
        {"name": "database", "category": "data", "mermaid": "fa:fa-database"},
        {"name": "table", "category": "data", "mermaid": "fa:fa-table"},
        {"name": "server", "category": "compute", "mermaid": "fa:fa-server"},
        {"name": "warehouse", "category": "data", "mermaid": "fa:fa-warehouse"},
        {"name": "cloud", "category": "cloud", "mermaid": "fa:fa-cloud"},
        {"name": "snowflake", "category": "snowflake", "mermaid": "fa:fa-snowflake"},
    ],
    "compute": [
        {"name": "server", "category": "compute", "mermaid": "fa:fa-server"},
        {"name": "microchip", "category": "compute", "mermaid": "fa:fa-microchip"},
        {"name": "memory", "category": "compute", "mermaid": "fa:fa-memory"},
        {"name": "network-wired", "category": "compute", "mermaid": "fa:fa-network-wired"},
    ],
    "integration": [
        {"name": "plug", "category": "integration", "mermaid": "fa:fa-plug"},
        {"name": "link", "category": "integration", "mermaid": "fa:fa-link"},
        {"name": "arrows-alt", "category": "integration", "mermaid": "fa:fa-arrows-alt"},
        {"name": "exchange-alt", "category": "integration", "mermaid": "fa:fa-exchange-alt"},
        {"name": "stream", "category": "integration", "mermaid": "fa:fa-stream"},
    ],
    "analytics": [
        {"name": "chart-line", "category": "analytics", "mermaid": "fa:fa-chart-line"},
        {"name": "chart-bar", "category": "analytics", "mermaid": "fa:fa-chart-bar"},
        {"name": "chart-pie", "category": "analytics", "mermaid": "fa:fa-chart-pie"},
        {"name": "chart-area", "category": "analytics", "mermaid": "fa:fa-chart-area"},
        {"name": "analytics", "category": "analytics", "mermaid": "fa:fa-analytics"},
    ],
    "ml_ai": [
        {"name": "brain", "category": "ml_ai", "mermaid": "fa:fa-brain"},
        {"name": "robot", "category": "ml_ai", "mermaid": "fa:fa-robot"},
        {"name": "project-diagram", "category": "ml_ai", "mermaid": "fa:fa-project-diagram"},
    ],
    "security": [
        {"name": "lock", "category": "security", "mermaid": "fa:fa-lock"},
        {"name": "shield-alt", "category": "security", "mermaid": "fa:fa-shield-alt"},
        {"name": "key", "category": "security", "mermaid": "fa:fa-key"},
        {"name": "user-shield", "category": "security", "mermaid": "fa:fa-user-shield"},
    ],
    "iot": [
        {"name": "thermometer", "category": "iot", "mermaid": "fa:fa-thermometer-half"},
        {"name": "wifi", "category": "iot", "mermaid": "fa:fa-wifi"},
        {"name": "mobile", "category": "iot", "mermaid": "fa:fa-mobile-alt"},
        {"name": "satellite", "category": "iot", "mermaid": "fa:fa-satellite"},
    ],
    "general": [
        {"name": "cog", "category": "general", "mermaid": "fa:fa-cog"},
        {"name": "file", "category": "general", "mermaid": "fa:fa-file"},
        {"name": "folder", "category": "general", "mermaid": "fa:fa-folder"},
        {"name": "user", "category": "general", "mermaid": "fa:fa-user"},
        {"name": "users", "category": "general", "mermaid": "fa:fa-users"},
        {"name": "bell", "category": "general", "mermaid": "fa:fa-bell"},
        {"name": "envelope", "category": "general", "mermaid": "fa:fa-envelope"},
    ]
}

# Material Design Icons (selected subset)
MATERIAL_ICONS = {
    "data": [
        {"name": "storage", "category": "data", "mermaid": "mi:storage"},
        {"name": "database", "category": "data", "mermaid": "mi:database"},
        {"name": "cloud_queue", "category": "data", "mermaid": "mi:cloud_queue"},
        {"name": "folder_open", "category": "data", "mermaid": "mi:folder_open"},
    ],
    "compute": [
        {"name": "memory", "category": "compute", "mermaid": "mi:memory"},
        {"name": "developer_board", "category": "compute", "mermaid": "mi:developer_board"},
        {"name": "dns", "category": "compute", "mermaid": "mi:dns"},
    ],
    "analytics": [
        {"name": "analytics", "category": "analytics", "mermaid": "mi:analytics"},
        {"name": "insights", "category": "analytics", "mermaid": "mi:insights"},
        {"name": "bar_chart", "category": "analytics", "mermaid": "mi:bar_chart"},
        {"name": "pie_chart", "category": "analytics", "mermaid": "mi:pie_chart"},
    ],
    "ml_ai": [
        {"name": "psychology", "category": "ml_ai", "mermaid": "mi:psychology"},
        {"name": "model_training", "category": "ml_ai", "mermaid": "mi:model_training"},
        {"name": "smart_toy", "category": "ml_ai", "mermaid": "mi:smart_toy"},
    ],
    "integration": [
        {"name": "integration_instructions", "category": "integration", "mermaid": "mi:integration_instructions"},
        {"name": "hub", "category": "integration", "mermaid": "mi:hub"},
        {"name": "connect_without_contact", "category": "integration", "mermaid": "mi:connect_without_contact"},
    ],
    "general": [
        {"name": "settings", "category": "general", "mermaid": "mi:settings"},
        {"name": "account_circle", "category": "general", "mermaid": "mi:account_circle"},
        {"name": "schedule", "category": "general", "mermaid": "mi:schedule"},
    ]
}

# Built-in Mermaid shapes (no icons, but useful for reference)
MERMAID_SHAPES = [
    {"name": "rectangle", "syntax": "A[Text]", "description": "Standard rectangle"},
    {"name": "rounded", "syntax": "A(Text)", "description": "Rounded rectangle"},
    {"name": "stadium", "syntax": "A([Text])", "description": "Stadium shape"},
    {"name": "subroutine", "syntax": "A[[Text]]", "description": "Subroutine shape"},
    {"name": "cylindrical", "syntax": "A[(Text)]", "description": "Database cylinder"},
    {"name": "circle", "syntax": "A((Text))", "description": "Circle"},
    {"name": "asymmetric", "syntax": "A>Text]", "description": "Asymmetric shape"},
    {"name": "rhombus", "syntax": "A{Text}", "description": "Decision diamond"},
    {"name": "hexagon", "syntax": "A{{Text}}", "description": "Hexagon"},
    {"name": "parallelogram", "syntax": "A[/Text/]", "description": "Parallelogram"},
    {"name": "trapezoid", "syntax": "A[\\Text\\]", "description": "Trapezoid"},
]


# =====================================================
# Response Models
# =====================================================

from pydantic import BaseModel, Field

class IconItem(BaseModel):
    """Single icon item"""
    name: str = Field(..., description="Icon name")
    category: str = Field(..., description="Icon category")
    mermaid: str = Field(..., description="Mermaid syntax for this icon")


class IconCatalogResponse(BaseModel):
    """Response containing icon catalog"""
    library: str = Field(..., description="Icon library name (font_awesome, material_icons, mermaid_shapes)")
    categories: List[str] = Field(..., description="Available categories")
    icons: List[IconItem] = Field(..., description="List of icons")
    total_count: int = Field(..., description="Total number of icons")
    usage_instructions: str = Field(..., description="How to use these icons in Mermaid")


class IconSearchResponse(BaseModel):
    """Response for icon search"""
    query: str = Field(..., description="Search query")
    results: List[IconItem] = Field(..., description="Matching icons")
    count: int = Field(..., description="Number of results")


# =====================================================
# Endpoints
# =====================================================

@router.get("/catalog/font-awesome", response_model=IconCatalogResponse)
async def get_font_awesome_catalog(
    category: str = Query(None, description="Filter by category")
):
    """
    Get Font Awesome icon catalog.
    
    Returns a curated list of Font Awesome icons suitable for
    Snowflake architecture diagrams.
    """
    try:
        icons = []
        categories = list(FONT_AWESOME_ICONS.keys())
        
        if category and category in FONT_AWESOME_ICONS:
            # Filter by specific category
            icons = FONT_AWESOME_ICONS[category]
            categories = [category]
        else:
            # Return all icons
            for cat_icons in FONT_AWESOME_ICONS.values():
                icons.extend(cat_icons)
        
        return IconCatalogResponse(
            library="font_awesome",
            categories=categories,
            icons=icons,
            total_count=len(icons),
            usage_instructions="Use in Mermaid: A[fa:fa-database Database]. CDN: https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        )
    except Exception as e:
        logger.error(f"Error fetching Font Awesome catalog: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/catalog/material-icons", response_model=IconCatalogResponse)
async def get_material_icons_catalog(
    category: str = Query(None, description="Filter by category")
):
    """
    Get Material Design Icons catalog.
    
    Returns a curated list of Material Icons suitable for
    Snowflake architecture diagrams.
    """
    try:
        icons = []
        categories = list(MATERIAL_ICONS.keys())
        
        if category and category in MATERIAL_ICONS:
            # Filter by specific category
            icons = MATERIAL_ICONS[category]
            categories = [category]
        else:
            # Return all icons
            for cat_icons in MATERIAL_ICONS.values():
                icons.extend(cat_icons)
        
        return IconCatalogResponse(
            library="material_icons",
            categories=categories,
            icons=icons,
            total_count=len(icons),
            usage_instructions="Use in Mermaid: A[mi:storage Storage]. CDN: https://fonts.googleapis.com/icon?family=Material+Icons"
        )
    except Exception as e:
        logger.error(f"Error fetching Material Icons catalog: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/catalog/mermaid-shapes")
async def get_mermaid_shapes():
    """
    Get built-in Mermaid shape reference.
    
    Returns a list of built-in Mermaid shapes that don't require icons.
    """
    try:
        return {
            "library": "mermaid_shapes",
            "shapes": MERMAID_SHAPES,
            "total_count": len(MERMAID_SHAPES),
            "usage_instructions": "Use the syntax directly in your Mermaid diagram. Example: A[Database] or B((AI Model))"
        }
    except Exception as e:
        logger.error(f"Error fetching Mermaid shapes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/search", response_model=IconSearchResponse)
async def search_icons(
    query: str = Query(..., description="Search query (icon name or category)"),
    library: str = Query("all", description="Icon library (font_awesome, material_icons, all)")
):
    """
    Search icons across libraries.
    
    Searches icon names and categories for matching terms.
    """
    try:
        results = []
        query_lower = query.lower()
        
        # Search Font Awesome
        if library in ("all", "font_awesome"):
            for cat_icons in FONT_AWESOME_ICONS.values():
                for icon in cat_icons:
                    if (query_lower in icon["name"].lower() or 
                        query_lower in icon["category"].lower()):
                        results.append(icon)
        
        # Search Material Icons
        if library in ("all", "material_icons"):
            for cat_icons in MATERIAL_ICONS.values():
                for icon in cat_icons:
                    if (query_lower in icon["name"].lower() or 
                        query_lower in icon["category"].lower()):
                        results.append(icon)
        
        return IconSearchResponse(
            query=query,
            results=results,
            count=len(results)
        )
    except Exception as e:
        logger.error(f"Error searching icons: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/categories")
async def list_categories():
    """
    List all icon categories across libraries.
    
    Returns unique categories from Font Awesome and Material Icons.
    """
    try:
        categories = set()
        
        # Collect categories from Font Awesome
        for category in FONT_AWESOME_ICONS.keys():
            categories.add(category)
        
        # Collect categories from Material Icons
        for category in MATERIAL_ICONS.keys():
            categories.add(category)
        
        return {
            "categories": sorted(list(categories)),
            "total_count": len(categories),
            "description": "Available icon categories across all libraries"
        }
    except Exception as e:
        logger.error(f"Error listing categories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/examples")
async def get_icon_examples():
    """
    Get example Mermaid diagrams with icons.
    
    Returns sample diagrams demonstrating icon usage.
    """
    examples = [
        {
            "name": "Simple Data Pipeline",
            "description": "Basic pipeline with icons",
            "mermaid": """flowchart LR
    A[fa:fa-database Source DB] --> B[fa:fa-stream Snowpipe]
    B --> C[fa:fa-snowflake Snowflake]
    C --> D[fa:fa-chart-bar Analytics]"""
        },
        {
            "name": "IoT Architecture",
            "description": "IoT sensors to analytics",
            "mermaid": """flowchart TD
    A[fa:fa-thermometer Sensor] --> B[fa:fa-wifi Gateway]
    B --> C[fa:fa-cloud Cloud Storage]
    C --> D[mi:storage Data Lake]
    D --> E[fa:fa-brain ML Model]"""
        },
        {
            "name": "Security Model",
            "description": "Security and access control",
            "mermaid": """flowchart LR
    A[fa:fa-user User] --> B[fa:fa-shield-alt Auth]
    B --> C[fa:fa-key API Gateway]
    C --> D[fa:fa-database Secure DB]"""
        }
    ]
    
    return {
        "examples": examples,
        "count": len(examples),
        "usage_note": "Copy the mermaid code and modify for your use case"
    }
