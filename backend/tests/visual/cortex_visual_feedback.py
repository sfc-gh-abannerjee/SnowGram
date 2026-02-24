"""
Cortex Visual Feedback Loop

Autonomous visual quality system that:
1. Captures screenshot of rendered SnowGram diagram
2. Sends screenshot + PDF reference to Cortex Vision
3. Cortex analyzes visual gaps (layout, components, styling)
4. Routes gaps to appropriate CoCo skills
5. Iterates until quality target is met

Usage:
    python cortex_visual_feedback.py --template STREAMING_DATA_STACK --max-iterations 5

Author: Ralph Loop Integration
"""

import os
import sys
import json
import base64
import asyncio
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from enum import Enum

# Add parent paths for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


class GapCategory(Enum):
    """Categories of visual gaps that route to different skills."""
    TEMPLATE_GENERATION = "template_generation"      # → cortex-agent
    SEMANTIC_MAPPINGS = "semantic_mappings"          # → semantic-view
    LAYOUT_RENDERING = "layout_rendering"            # → lane-layout-debugger
    COMPONENT_STYLING = "component_styling"          # → snowgram-debugger
    EDGE_CONNECTIONS = "edge_connections"            # → snowgram-debugger
    BADGE_NUMBERING = "badge_numbering"              # → lane-layout-debugger
    CLOUD_PROVIDER_LOGOS = "cloud_provider_logos"    # → component catalog update


@dataclass
class VisualGap:
    """A specific gap identified by Cortex vision analysis."""
    category: GapCategory
    description: str
    severity: str  # "high", "medium", "low"
    suggested_fix: str
    reference_detail: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "category": self.category.value,
            "description": self.description,
            "severity": self.severity,
            "suggested_fix": self.suggested_fix,
            "reference_detail": self.reference_detail
        }


@dataclass
class VisualAnalysisResult:
    """Result from Cortex visual comparison."""
    overall_score: float  # 0-100
    gaps: List[VisualGap] = field(default_factory=list)
    layout_match: float = 0.0  # 0-100
    component_completeness: float = 0.0  # 0-100
    styling_quality: float = 0.0  # 0-100
    edge_accuracy: float = 0.0  # 0-100
    raw_analysis: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "overall_score": self.overall_score,
            "layout_match": self.layout_match,
            "component_completeness": self.component_completeness,
            "styling_quality": self.styling_quality,
            "edge_accuracy": self.edge_accuracy,
            "gaps": [g.to_dict() for g in self.gaps],
            "timestamp": self.timestamp
        }


class CortexVisionAnalyzer:
    """
    Analyzes rendered diagrams against PDF references using Cortex Vision.
    
    Uses Snowflake Cortex multimodal capabilities to:
    - Compare visual layouts
    - Identify missing components
    - Assess styling quality
    - Detect edge/connection issues
    """
    
    REFERENCE_DIR = Path(__file__).parent / "reference_images"
    
    # Map architecture types to reference pages
    REFERENCE_MAPPING = {
        "STREAMING_DATA_STACK": "reference_page4.png",  # Streaming architecture
        "SERVERLESS_DATA_STACK": "reference_page3.png",  # Serverless architecture
        "EMBEDDED_ANALYTICS": "reference_page2.png",     # Embedded analytics
        "ML_DATA_SCIENCE": "reference_page5.png",        # ML/Data Science
        "DATA_LAKEHOUSE": "reference_page6.png",         # Lakehouse pattern
    }
    
    ANALYSIS_PROMPT = """You are a visual architecture diagram expert. Compare the RENDERED DIAGRAM against the REFERENCE ARCHITECTURE and provide a detailed analysis.

## Analysis Criteria

### 1. Layout Match (0-100)
- Are sections/lanes properly organized?
- Is vertical/horizontal flow preserved?
- Are numbered callout badges present and positioned correctly?

### 2. Component Completeness (0-100)
- Are all expected components from reference present?
- Are component icons/logos correct?
- Are labels accurate?

### 3. Styling Quality (0-100)
- Do colors match the reference pattern (blue headers, etc.)?
- Is spacing consistent?
- Are fonts readable?

### 4. Edge Accuracy (0-100)
- Are flow arrows present and pointing correctly?
- Are connections between components accurate?
- Are edge styles (solid, dashed) appropriate?

## Output Format

Return your analysis as JSON:
```json
{
  "overall_score": <0-100>,
  "layout_match": <0-100>,
  "component_completeness": <0-100>,
  "styling_quality": <0-100>,
  "edge_accuracy": <0-100>,
  "gaps": [
    {
      "category": "<template_generation|semantic_mappings|layout_rendering|component_styling|edge_connections|badge_numbering|cloud_provider_logos>",
      "description": "What is wrong",
      "severity": "<high|medium|low>",
      "suggested_fix": "How to fix it",
      "reference_detail": "What the reference shows"
    }
  ],
  "summary": "Brief overall assessment"
}
```

Be specific about what's missing or wrong. Focus on actionable gaps that can be fixed programmatically."""

    def __init__(self, connection_name: str = "se_demo"):
        self.connection_name = connection_name
        
    def _encode_image(self, image_path: Path) -> str:
        """Encode image to base64 for Cortex API."""
        with open(image_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")
    
    def _get_reference_image(self, template_id: str) -> Optional[Path]:
        """Get the appropriate reference image for a template."""
        ref_file = self.REFERENCE_MAPPING.get(template_id)
        if ref_file:
            ref_path = self.REFERENCE_DIR / ref_file
            if ref_path.exists():
                return ref_path
        
        # Fallback: try to find closest match
        for key, ref in self.REFERENCE_MAPPING.items():
            if key in template_id or template_id in key:
                ref_path = self.REFERENCE_DIR / ref
                if ref_path.exists():
                    return ref_path
        
        # Default to page 4 (streaming) if no match
        default = self.REFERENCE_DIR / "reference_page4.png"
        return default if default.exists() else None
    
    # Snowflake stage for storing images (must be pre-created with DIRECTORY and SSE encryption)
    STAGE_NAME = "@SNOWGRAM_DB.CORE.VISUAL_TEST_IMAGES"
    
    # Analysis prompt without f-string formatting (to avoid brace conflicts)
    CORTEX_PROMPT_TEMPLATE = '''Compare these architecture diagrams. Image 0 is the REFERENCE (target). Image 1 is the RENDERED diagram to evaluate. {0} {1}

Rate each 0-100:
- Layout Match: Sections organized? Numbered badges present?
- Component Completeness: All components? Correct icons/logos?
- Styling Quality: Colors match? Spacing consistent?
- Edge Accuracy: Flow arrows correct?

Provide JSON with overall_score, layout_match, component_completeness, styling_quality, edge_accuracy, gaps array (each with category like badge_numbering/cloud_provider_logos/component_styling/edge_connections/layout_rendering, description, severity, suggested_fix), and summary.'''
    
    def analyze_with_cortex(
        self,
        rendered_image_path: Path,
        reference_image_path: Path,
        template_id: str
    ) -> VisualAnalysisResult:
        """
        Send both images to Cortex Vision for comparison.
        
        Uses AI_COMPLETE with PROMPT and TO_FILE for stage-based multimodal analysis.
        Cortex requires images to be in a Snowflake stage, not base64 encoded.
        """
        # Upload images to stage first
        reference_stage_name = self._upload_to_stage(reference_image_path, "reference")
        rendered_stage_name = self._upload_to_stage(rendered_image_path, "rendered")
        
        # Escape for SQL single quotes
        escaped_prompt = self.CORTEX_PROMPT_TEMPLATE.replace("'", "''")

        # Build SQL using AI_COMPLETE with PROMPT helper function
        sql = f"""
SELECT AI_COMPLETE(
    'claude-3-5-sonnet',
    PROMPT(
        '{escaped_prompt}',
        TO_FILE('{self.STAGE_NAME}', '{reference_stage_name}'),
        TO_FILE('{self.STAGE_NAME}', '{rendered_stage_name}')
    ),
    {{'temperature': 0.1}}
) AS analysis;
"""
        
        # Execute via snowsql or connection
        result = self._execute_cortex_sql(sql)
        return self._parse_analysis_result(result, template_id)
    
    def _upload_to_stage(self, image_path: Path, prefix: str) -> str:
        """Upload image to Snowflake stage and return the staged filename."""
        stage_filename = f"{prefix}_{image_path.name}"
        
        # Use snow CLI to upload
        result = subprocess.run(
            [
                "snow", "stage", "copy",
                str(image_path),
                self.STAGE_NAME,
                "-c", self.connection_name,
                "--overwrite"
            ],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        if result.returncode != 0:
            print(f"Warning: Stage upload may have failed: {result.stderr}")
        
        # Refresh directory table
        subprocess.run(
            [
                "snow", "sql",
                "-c", self.connection_name,
                "-q", f"ALTER STAGE {self.STAGE_NAME} REFRESH"
            ],
            capture_output=True,
            timeout=30
        )
        
        return image_path.name  # Return original filename (snow copies with same name)
    
    def analyze_local_vision(
        self,
        rendered_image_path: Path,
        reference_image_path: Path,
        template_id: str
    ) -> VisualAnalysisResult:
        """
        Alternative: Use local vision analysis when Cortex unavailable.
        
        This uses structural image comparison as a fallback.
        """
        try:
            import cv2
            import numpy as np
            from skimage.metrics import structural_similarity as ssim
            
            # Load images
            rendered = cv2.imread(str(rendered_image_path))
            reference = cv2.imread(str(reference_image_path))
            
            if rendered is None or reference is None:
                return VisualAnalysisResult(
                    overall_score=0.0,
                    gaps=[VisualGap(
                        category=GapCategory.LAYOUT_RENDERING,
                        description="Could not load images for comparison",
                        severity="high",
                        suggested_fix="Check image paths"
                    )]
                )
            
            # Resize to match
            h, w = reference.shape[:2]
            rendered_resized = cv2.resize(rendered, (w, h))
            
            # Convert to grayscale for SSIM
            gray_rendered = cv2.cvtColor(rendered_resized, cv2.COLOR_BGR2GRAY)
            gray_reference = cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY)
            
            # Calculate SSIM
            score, diff = ssim(gray_reference, gray_rendered, full=True)
            ssim_score = score * 100
            
            # Basic gap detection based on SSIM
            gaps = []
            if ssim_score < 70:
                gaps.append(VisualGap(
                    category=GapCategory.LAYOUT_RENDERING,
                    description="Overall layout significantly differs from reference",
                    severity="high",
                    suggested_fix="Review lane structure and component positioning"
                ))
            elif ssim_score < 85:
                gaps.append(VisualGap(
                    category=GapCategory.COMPONENT_STYLING,
                    description="Minor styling differences detected",
                    severity="medium",
                    suggested_fix="Check colors, fonts, and spacing"
                ))
            
            return VisualAnalysisResult(
                overall_score=ssim_score,
                layout_match=ssim_score,
                component_completeness=ssim_score,
                styling_quality=ssim_score,
                edge_accuracy=ssim_score,
                gaps=gaps,
                raw_analysis=f"SSIM-based analysis: {ssim_score:.1f}%"
            )
            
        except ImportError:
            return VisualAnalysisResult(
                overall_score=0.0,
                gaps=[VisualGap(
                    category=GapCategory.LAYOUT_RENDERING,
                    description="cv2/skimage not available for local analysis",
                    severity="high",
                    suggested_fix="pip install opencv-python scikit-image"
                )]
            )
    
    def _execute_cortex_sql(self, sql: str) -> str:
        """Execute SQL via Snowflake connection."""
        # Write SQL to temp file to handle complex quoting
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.sql', delete=False) as f:
            f.write(sql)
            sql_file = f.name
        
        try:
            result = subprocess.run(
                [
                    "snow", "sql", 
                    "-c", self.connection_name,
                    "-f", sql_file,
                    "--format", "json"
                ],
                capture_output=True,
                text=True,
                timeout=120
            )
            os.unlink(sql_file)
            
            if result.returncode != 0:
                print(f"Cortex SQL error: {result.stderr}")
                return "{}"
            
            return result.stdout
        except Exception as e:
            print(f"Error executing Cortex SQL: {e}")
            if os.path.exists(sql_file):
                os.unlink(sql_file)
            return "{}"
    
    def _parse_analysis_result(self, raw_result: str, template_id: str) -> VisualAnalysisResult:
        """Parse Cortex response into structured result."""
        try:
            # Extract JSON from response
            data = json.loads(raw_result)
            if isinstance(data, list) and len(data) > 0:
                # Get the ANALYSIS field (uppercase from SQL alias)
                analysis_text = data[0].get("ANALYSIS", "{}")
            else:
                analysis_text = raw_result
            
            # The response may be double-quoted/escaped - strip outer quotes if present
            if isinstance(analysis_text, str):
                analysis_text = analysis_text.strip()
                if analysis_text.startswith('"') and analysis_text.endswith('"'):
                    # Unescape the inner JSON string
                    analysis_text = json.loads(analysis_text)
            
            # If still a string, try to find JSON in it
            if isinstance(analysis_text, str):
                import re
                json_match = re.search(r'\{[\s\S]*\}', analysis_text)
                if json_match:
                    analysis = json.loads(json_match.group())
                else:
                    analysis = {}
            else:
                analysis = analysis_text
            
            # Build gaps
            gaps = []
            for gap_data in analysis.get("gaps", []):
                try:
                    category = GapCategory(gap_data.get("category", "layout_rendering"))
                except ValueError:
                    category = GapCategory.LAYOUT_RENDERING
                
                gaps.append(VisualGap(
                    category=category,
                    description=gap_data.get("description", "Unknown gap"),
                    severity=gap_data.get("severity", "medium"),
                    suggested_fix=gap_data.get("suggested_fix", "Review manually"),
                    reference_detail=gap_data.get("reference_detail")
                ))
            
            return VisualAnalysisResult(
                overall_score=float(analysis.get("overall_score", 0)),
                layout_match=float(analysis.get("layout_match", 0)),
                component_completeness=float(analysis.get("component_completeness", 0)),
                styling_quality=float(analysis.get("styling_quality", 0)),
                edge_accuracy=float(analysis.get("edge_accuracy", 0)),
                gaps=gaps,
                raw_analysis=analysis.get("summary", "")
            )
            
        except Exception as e:
            print(f"Error parsing Cortex result: {e}")
            return VisualAnalysisResult(
                overall_score=0.0,
                gaps=[VisualGap(
                    category=GapCategory.LAYOUT_RENDERING,
                    description=f"Failed to parse Cortex analysis: {e}",
                    severity="high",
                    suggested_fix="Check Cortex response format"
                )],
                raw_analysis=raw_result[:500]
            )


class VisualFeedbackLoop:
    """
    Main orchestrator for the visual feedback loop.
    
    Flow:
    1. Render diagram via API
    2. Capture screenshot with Playwright
    3. Send to Cortex Vision for analysis
    4. Route gaps to appropriate skills
    5. Apply fixes
    6. Iterate until quality target met
    """
    
    QUALITY_TARGET = 95.0  # Target score
    MAX_ITERATIONS = 5
    SCREENSHOT_DIR = Path(__file__).parent / "screenshots"
    
    # Skill routing based on gap category
    SKILL_ROUTING = {
        GapCategory.TEMPLATE_GENERATION: "cortex-agent",
        GapCategory.SEMANTIC_MAPPINGS: "semantic-view",
        GapCategory.LAYOUT_RENDERING: "lane-layout-debugger",
        GapCategory.COMPONENT_STYLING: "snowgram-debugger",
        GapCategory.EDGE_CONNECTIONS: "snowgram-debugger",
        GapCategory.BADGE_NUMBERING: "lane-layout-debugger",
        GapCategory.CLOUD_PROVIDER_LOGOS: "snowgram-debugger",
    }
    
    def __init__(
        self,
        template_id: str,
        frontend_url: str = "http://localhost:3002",
        connection_name: str = "se_demo",
        max_iterations: int = MAX_ITERATIONS,
        quality_target: float = QUALITY_TARGET,
        use_cortex: bool = True,
        skip_capture: bool = False
    ):
        self.template_id = template_id
        self.frontend_url = frontend_url
        self.connection_name = connection_name
        self.max_iterations = max_iterations
        self.quality_target = quality_target
        self.use_cortex = use_cortex
        self.skip_capture = skip_capture
        
        self.analyzer = CortexVisionAnalyzer(connection_name)
        self.iteration_history: List[VisualAnalysisResult] = []
        
        # Ensure screenshot directory exists
        self.SCREENSHOT_DIR.mkdir(exist_ok=True)
    
    async def capture_screenshot(self, iteration: int) -> Path:
        """Capture screenshot of current diagram rendering."""
        import aiohttp
        from capture_diagram import capture_with_mermaid
        
        output_path = self.SCREENSHOT_DIR / f"{self.template_id}_iter{iteration}.png"
        
        # Step 1: Call API to generate mermaid code
        api_url = self.frontend_url.replace('3002', '8082')  # API runs on 8082
        generate_url = f"{api_url}/api/diagram/generate"
        
        print(f"  Calling API to generate diagram: {generate_url}")
        mermaid_code = None
        async with aiohttp.ClientSession() as session:
            try:
                async with session.post(
                    generate_url,
                    json={"user_query": f"Generate {self.template_id} architecture"},
                    timeout=aiohttp.ClientTimeout(total=120)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        mermaid_code = data.get('mermaid_code')
                        components = data.get('components_used', [])
                        print(f"  API response: {len(components)} components, {len(mermaid_code) if mermaid_code else 0} chars mermaid")
                    else:
                        text = await resp.text()
                        print(f"  API error: {resp.status} - {text[:100]}")
            except Exception as e:
                print(f"  API call failed: {e}")
        
        if not mermaid_code:
            print("  ERROR: No mermaid code received from API")
            # Fallback to basic capture
            from capture_diagram import capture_diagram
            await capture_diagram(
                output_path=str(output_path),
                url=self.frontend_url,
                template_id=self.template_id,
                wait_timeout=30000,
                animation_delay=3000
            )
            return output_path
        
        # Step 2: Inject mermaid code into browser and capture screenshot
        print(f"  Injecting mermaid code into browser...")
        await capture_with_mermaid(
            mermaid_code=mermaid_code,
            output_path=str(output_path),
            frontend_url=self.frontend_url,
            layout_delay=5000  # Give more time for layout
        )
        
        return output_path
    
    def analyze_screenshot(
        self,
        screenshot_path: Path,
        iteration: int
    ) -> VisualAnalysisResult:
        """Analyze screenshot against reference using Cortex."""
        reference_path = self.analyzer._get_reference_image(self.template_id)
        
        if reference_path is None:
            return VisualAnalysisResult(
                overall_score=0.0,
                gaps=[VisualGap(
                    category=GapCategory.LAYOUT_RENDERING,
                    description="No reference image found",
                    severity="high",
                    suggested_fix="Add reference image to reference_images/"
                )]
            )
        
        print(f"\n[Iteration {iteration}] Analyzing with {'Cortex Vision' if self.use_cortex else 'Local SSIM'}...")
        print(f"  Rendered: {screenshot_path}")
        print(f"  Reference: {reference_path}")
        
        if self.use_cortex:
            result = self.analyzer.analyze_with_cortex(
                screenshot_path, 
                reference_path,
                self.template_id
            )
        else:
            result = self.analyzer.analyze_local_vision(
                screenshot_path,
                reference_path,
                self.template_id
            )
        
        self.iteration_history.append(result)
        return result
    
    def route_gaps_to_skills(self, gaps: List[VisualGap]) -> Dict[str, List[VisualGap]]:
        """Route gaps to appropriate CoCo skills."""
        routing = {}
        
        for gap in gaps:
            skill = self.SKILL_ROUTING.get(gap.category, "snowgram-debugger")
            if skill not in routing:
                routing[skill] = []
            routing[skill].append(gap)
        
        return routing
    
    def generate_fix_instructions(
        self,
        skill_name: str,
        gaps: List[VisualGap]
    ) -> str:
        """Generate instructions for CoCo skill to fix gaps."""
        instructions = f"""
## Visual Gap Fix Request

**Template**: {self.template_id}
**Target Skill**: {skill_name}
**Gaps to Address**: {len(gaps)}

### Gaps Identified by Cortex Vision:

"""
        for i, gap in enumerate(gaps, 1):
            instructions += f"""
#### Gap {i}: {gap.category.value}
- **Description**: {gap.description}
- **Severity**: {gap.severity}
- **Suggested Fix**: {gap.suggested_fix}
"""
            if gap.reference_detail:
                instructions += f"- **Reference Detail**: {gap.reference_detail}\n"
        
        instructions += """
### Instructions

Please fix these visual gaps and verify the changes render correctly.
After fixing, the visual feedback loop will re-capture and re-analyze.
"""
        return instructions
    
    async def run_iteration(self, iteration: int) -> VisualAnalysisResult:
        """Run a single iteration of the feedback loop."""
        print(f"\n{'='*60}")
        print(f"ITERATION {iteration} / {self.max_iterations}")
        print(f"{'='*60}")
        
        # Step 1: Capture screenshot (or use existing)
        print(f"\n[Step 1] Capturing screenshot...")
        if self.skip_capture:
            # Use existing _generated.png file
            screenshot_path = self.SCREENSHOT_DIR / f"{self.template_id}_generated.png"
            if not screenshot_path.exists():
                # Fallback to any matching screenshot
                matches = list(self.SCREENSHOT_DIR.glob(f"{self.template_id}*.png"))
                if matches:
                    screenshot_path = matches[0]
                else:
                    raise FileNotFoundError(f"No screenshot found for {self.template_id}")
            print(f"  Using existing: {screenshot_path}")
        else:
            screenshot_path = await self.capture_screenshot(iteration)
            print(f"  Saved: {screenshot_path}")
        
        # Step 2: Analyze with Cortex
        print(f"\n[Step 2] Analyzing with Cortex Vision...")
        result = self.analyze_screenshot(screenshot_path, iteration)
        
        # Step 3: Report results
        print(f"\n[Step 3] Analysis Results:")
        print(f"  Overall Score: {result.overall_score:.1f}%")
        print(f"  Layout Match: {result.layout_match:.1f}%")
        print(f"  Component Completeness: {result.component_completeness:.1f}%")
        print(f"  Styling Quality: {result.styling_quality:.1f}%")
        print(f"  Edge Accuracy: {result.edge_accuracy:.1f}%")
        print(f"  Gaps Found: {len(result.gaps)}")
        
        if result.gaps:
            print(f"\n[Step 4] Gap Routing:")
            routing = self.route_gaps_to_skills(result.gaps)
            for skill, skill_gaps in routing.items():
                print(f"  → {skill}: {len(skill_gaps)} gaps")
                for gap in skill_gaps:
                    print(f"    - [{gap.severity}] {gap.description[:60]}...")
        
        return result
    
    async def run(self) -> Dict[str, Any]:
        """
        Run the full visual feedback loop.
        
        Returns summary of all iterations.
        """
        print(f"\n{'#'*60}")
        print(f"# CORTEX VISUAL FEEDBACK LOOP")
        print(f"# Template: {self.template_id}")
        print(f"# Quality Target: {self.quality_target}%")
        print(f"# Max Iterations: {self.max_iterations}")
        print(f"{'#'*60}")
        
        for iteration in range(1, self.max_iterations + 1):
            result = await self.run_iteration(iteration)
            
            if result.overall_score >= self.quality_target:
                print(f"\n{'*'*60}")
                print(f"* TARGET ACHIEVED! Score: {result.overall_score:.1f}%")
                print(f"{'*'*60}")
                break
            
            if iteration < self.max_iterations:
                print(f"\n[Waiting for fixes before next iteration...]")
                # In full integration, this would trigger CoCo skills
                # For now, pause for manual intervention or skill dispatch
        
        # Generate final report
        return self._generate_report()
    
    def _generate_report(self) -> Dict[str, Any]:
        """Generate final report of all iterations."""
        report = {
            "template_id": self.template_id,
            "quality_target": self.quality_target,
            "iterations_run": len(self.iteration_history),
            "final_score": self.iteration_history[-1].overall_score if self.iteration_history else 0,
            "target_achieved": (
                self.iteration_history[-1].overall_score >= self.quality_target 
                if self.iteration_history else False
            ),
            "iteration_history": [r.to_dict() for r in self.iteration_history],
            "timestamp": datetime.now().isoformat()
        }
        
        # Save report
        report_path = self.SCREENSHOT_DIR / f"{self.template_id}_report.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        
        print(f"\nReport saved: {report_path}")
        return report


async def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Cortex Visual Feedback Loop for SnowGram diagrams"
    )
    parser.add_argument(
        "--template", "-t",
        default="STREAMING_DATA_STACK",
        help="Template ID to test"
    )
    parser.add_argument(
        "--max-iterations", "-n",
        type=int,
        default=5,
        help="Maximum iterations"
    )
    parser.add_argument(
        "--quality-target", "-q",
        type=float,
        default=95.0,
        help="Quality target percentage"
    )
    parser.add_argument(
        "--frontend-url", "-f",
        default="http://localhost:3002",
        help="Frontend URL"
    )
    parser.add_argument(
        "--connection", "-c",
        default="se_demo",
        help="Snowflake connection name"
    )
    parser.add_argument(
        "--local-only",
        action="store_true",
        help="Use local SSIM analysis instead of Cortex"
    )
    parser.add_argument(
        "--single-analysis",
        action="store_true",
        help="Run single analysis without iteration loop"
    )
    parser.add_argument(
        "--skip-capture",
        action="store_true",
        help="Skip screenshot capture and use existing _generated.png file"
    )
    
    args = parser.parse_args()
    
    if args.single_analysis:
        # Single analysis mode for quick testing
        analyzer = CortexVisionAnalyzer(args.connection)
        
        # Find latest screenshot or use provided path
        screenshot_dir = Path(__file__).parent / "screenshots"
        screenshots = list(screenshot_dir.glob(f"{args.template}*.png"))
        
        if not screenshots:
            print(f"No screenshots found for {args.template}")
            return
        
        # Prefer _generated.png files, otherwise use most recently modified
        generated = [s for s in screenshots if '_generated' in s.name]
        if generated:
            latest = generated[0]
        else:
            # Sort by modification time, newest first
            latest = sorted(screenshots, key=lambda x: x.stat().st_mtime, reverse=True)[0]
        
        print(f"Using screenshot: {latest.name} ({latest.stat().st_size} bytes)")
        reference = analyzer._get_reference_image(args.template)
        print(f"Using reference: {reference.name if reference else 'None'}")
        
        if args.local_only:
            result = analyzer.analyze_local_vision(latest, reference, args.template)
        else:
            result = analyzer.analyze_with_cortex(latest, reference, args.template)
        
        print(json.dumps(result.to_dict(), indent=2))
    else:
        # Full feedback loop
        loop = VisualFeedbackLoop(
            template_id=args.template,
            frontend_url=args.frontend_url,
            connection_name=args.connection,
            max_iterations=args.max_iterations,
            quality_target=args.quality_target,
            use_cortex=not args.local_only,
            skip_capture=args.skip_capture
        )
        
        report = await loop.run()
        print(f"\n{'='*60}")
        print("FINAL REPORT")
        print(f"{'='*60}")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
