"""
Ralph Loop Orchestrator - Full Integration

Orchestrates the complete autonomous visual quality loop:
1. Capture → Screenshot via Playwright
2. Compare → Cortex Vision analysis against PDF reference
3. Route → Gaps dispatched to CoCo skills
4. Fix → Skills apply fixes
5. Iterate → Loop until quality target achieved

This is the master controller that ties everything together.

Usage:
    # Full autonomous loop
    python ralph_loop.py --template STREAMING_DATA_STACK
    
    # Quick single capture and analyze
    python ralph_loop.py --template STREAMING_DATA_STACK --quick
    
    # With live frontend
    python ralph_loop.py --template STREAMING_DATA_STACK --live --url http://localhost:3002
"""

import os
import sys
import json
import asyncio
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any

# Add paths
BACKEND_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(BACKEND_ROOT))
sys.path.insert(0, str(Path(__file__).parent))

from cortex_visual_feedback import (
    CortexVisionAnalyzer,
    VisualFeedbackLoop,
    VisualAnalysisResult,
    VisualGap,
    GapCategory
)


@dataclass
class IterationResult:
    """Result of a single Ralph Loop iteration."""
    iteration: int
    screenshot_path: str
    analysis: VisualAnalysisResult
    gaps_routed: Dict[str, int]
    fixes_applied: List[str]
    duration_seconds: float
    
    def to_dict(self) -> Dict:
        return {
            "iteration": self.iteration,
            "screenshot": self.screenshot_path,
            "score": self.analysis.overall_score,
            "layout_match": self.analysis.layout_match,
            "component_completeness": self.analysis.component_completeness,
            "styling_quality": self.analysis.styling_quality,
            "edge_accuracy": self.analysis.edge_accuracy,
            "gaps_count": len(self.analysis.gaps),
            "gaps_routed": self.gaps_routed,
            "fixes_applied": self.fixes_applied,
            "duration_seconds": self.duration_seconds,
            "timestamp": self.analysis.timestamp
        }


class RalphLoop:
    """
    Ralph Loop - Autonomous Visual Quality System
    
    Named after the iterative refinement approach: Render, Analyze, Loop, Perfect, Halt.
    
    Architecture:
    ┌─────────────────────────────────────────────────────────────────────┐
    │                         RALPH LOOP                                   │
    ├─────────────────────────────────────────────────────────────────────┤
    │  1. RENDER                                                           │
    │     └─ Trigger API to generate diagram from template                 │
    │                                                                      │
    │  2. CAPTURE                                                          │
    │     └─ Playwright screenshots the rendered React Flow diagram        │
    │                                                                      │
    │  3. ANALYZE                                                          │
    │     └─ Cortex Vision compares screenshot to PDF reference            │
    │     └─ Generates structured gap report with categories               │
    │                                                                      │
    │  4. ROUTE                                                            │
    │     └─ Gaps dispatched to appropriate CoCo skills:                   │
    │        • template_generation → cortex-agent                          │
    │        • semantic_mappings → semantic-view                           │
    │        • layout_rendering → lane-layout-debugger                     │
    │        • component_styling → snowgram-debugger                       │
    │                                                                      │
    │  5. FIX                                                              │
    │     └─ Skills apply targeted fixes                                   │
    │                                                                      │
    │  6. ITERATE                                                          │
    │     └─ Loop back to step 1 until quality target (95%) achieved       │
    └─────────────────────────────────────────────────────────────────────┘
    """
    
    QUALITY_TARGET = 95.0
    MAX_ITERATIONS = 5
    
    # Paths
    VISUAL_TEST_DIR = Path(__file__).parent
    SCREENSHOT_DIR = VISUAL_TEST_DIR / "screenshots"
    REFERENCE_DIR = VISUAL_TEST_DIR / "reference_images"
    
    def __init__(
        self,
        template_id: str,
        frontend_url: str = "http://localhost:3002",
        api_url: str = "http://localhost:8000",
        connection_name: str = "se_demo",
        quality_target: float = QUALITY_TARGET,
        max_iterations: int = MAX_ITERATIONS,
        use_cortex: bool = True,
        verbose: bool = True
    ):
        self.template_id = template_id
        self.frontend_url = frontend_url
        self.api_url = api_url
        self.connection_name = connection_name
        self.quality_target = quality_target
        self.max_iterations = max_iterations
        self.use_cortex = use_cortex
        self.verbose = verbose
        
        # Components
        self.analyzer = CortexVisionAnalyzer(connection_name)
        
        # State
        self.iterations: List[IterationResult] = []
        self.current_score = 0.0
        self.start_time = None
        
        # Ensure directories
        self.SCREENSHOT_DIR.mkdir(exist_ok=True)
    
    def log(self, msg: str, level: str = "info"):
        """Log with timestamp."""
        if self.verbose or level == "error":
            timestamp = datetime.now().strftime("%H:%M:%S")
            prefix = {
                "info": "ℹ️ ",
                "success": "✅",
                "warning": "⚠️ ",
                "error": "❌",
                "step": "→ "
            }.get(level, "")
            print(f"[{timestamp}] {prefix} {msg}")
    
    async def step_1_render(self) -> bool:
        """Step 1: Trigger diagram generation via API."""
        self.log("STEP 1: Rendering diagram via API...", "step")
        
        try:
            import httpx
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Call the diagram generation endpoint
                response = await client.post(
                    f"{self.api_url}/api/diagrams/generate",
                    json={"template_id": self.template_id}
                )
                
                if response.status_code == 200:
                    data = response.json()
                    self.log(f"Diagram generated: {data.get('node_count', '?')} nodes", "success")
                    return True
                else:
                    self.log(f"API returned {response.status_code}: {response.text[:100]}", "warning")
                    # Continue anyway - diagram might already be rendered
                    return True
                    
        except Exception as e:
            self.log(f"API call failed: {e}", "warning")
            # Continue - frontend might have cached diagram
            return True
    
    async def step_2_capture(self, iteration: int) -> Optional[Path]:
        """Step 2: Capture screenshot with Playwright."""
        self.log("STEP 2: Capturing screenshot...", "step")
        
        output_filename = f"{self.template_id}_iter{iteration}_{datetime.now().strftime('%H%M%S')}.png"
        output_path = self.SCREENSHOT_DIR / output_filename
        
        try:
            from playwright.async_api import async_playwright
            
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                context = await browser.new_context(
                    viewport={"width": 1920, "height": 1080}
                )
                page = await context.new_page()
                
                # Navigate to frontend
                await page.goto(self.frontend_url, wait_until="networkidle")
                
                # Wait for React Flow to render
                try:
                    await page.wait_for_selector(".react-flow", timeout=15000)
                    await asyncio.sleep(2)  # Extra time for animations
                except:
                    self.log("React Flow selector not found, capturing anyway", "warning")
                
                # Find the diagram container and screenshot
                diagram = await page.query_selector(".react-flow")
                if diagram:
                    await diagram.screenshot(path=str(output_path))
                else:
                    await page.screenshot(path=str(output_path), full_page=True)
                
                await browser.close()
            
            self.log(f"Screenshot saved: {output_path.name}", "success")
            return output_path
            
        except Exception as e:
            self.log(f"Capture failed: {e}", "error")
            return None
    
    def step_3_analyze(
        self,
        screenshot_path: Path,
        iteration: int
    ) -> VisualAnalysisResult:
        """Step 3: Analyze with Cortex Vision."""
        self.log("STEP 3: Analyzing with Cortex Vision...", "step")
        
        reference_path = self.analyzer._get_reference_image(self.template_id)
        
        if not reference_path or not reference_path.exists():
            self.log(f"No reference image found for {self.template_id}", "warning")
            # Use default reference
            reference_path = self.REFERENCE_DIR / "reference_page4.png"
        
        self.log(f"Comparing against: {reference_path.name}")
        
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
        
        self.log(f"Overall Score: {result.overall_score:.1f}%", 
                "success" if result.overall_score >= self.quality_target else "warning")
        self.log(f"  Layout: {result.layout_match:.1f}% | Components: {result.component_completeness:.1f}%")
        self.log(f"  Styling: {result.styling_quality:.1f}% | Edges: {result.edge_accuracy:.1f}%")
        self.log(f"  Gaps found: {len(result.gaps)}")
        
        return result
    
    def step_4_route(self, analysis: VisualAnalysisResult) -> Dict[str, List[VisualGap]]:
        """Step 4: Route gaps to CoCo skills."""
        self.log("STEP 4: Routing gaps to skills...", "step")
        
        skill_routing = {
            GapCategory.TEMPLATE_GENERATION: "cortex-agent",
            GapCategory.SEMANTIC_MAPPINGS: "semantic-view",
            GapCategory.LAYOUT_RENDERING: "lane-layout-debugger",
            GapCategory.COMPONENT_STYLING: "snowgram-debugger",
            GapCategory.EDGE_CONNECTIONS: "snowgram-debugger",
            GapCategory.BADGE_NUMBERING: "lane-layout-debugger",
            GapCategory.CLOUD_PROVIDER_LOGOS: "snowgram-debugger",
        }
        
        routing = {}
        for gap in analysis.gaps:
            skill = skill_routing.get(gap.category, "snowgram-debugger")
            if skill not in routing:
                routing[skill] = []
            routing[skill].append(gap)
        
        for skill, gaps in routing.items():
            self.log(f"  → {skill}: {len(gaps)} gap(s)")
            for gap in gaps[:2]:  # Show first 2
                self.log(f"      [{gap.severity}] {gap.description[:50]}...")
        
        return routing
    
    def step_5_generate_fix_prompt(
        self,
        routing: Dict[str, List[VisualGap]]
    ) -> str:
        """Step 5: Generate fix instructions for CoCo skills."""
        self.log("STEP 5: Generating fix prompts...", "step")
        
        prompts = []
        
        for skill, gaps in routing.items():
            prompt = f"""
## Visual Quality Fix Request - {skill}

**Template**: {self.template_id}
**Current Score**: {self.current_score:.1f}%
**Target Score**: {self.quality_target}%
**Gaps**: {len(gaps)}

### Issues to Fix:
"""
            for i, gap in enumerate(gaps, 1):
                prompt += f"""
{i}. **{gap.category.value}** ({gap.severity})
   - Problem: {gap.description}
   - Fix: {gap.suggested_fix}
"""
                if gap.reference_detail:
                    prompt += f"   - Reference shows: {gap.reference_detail}\n"
            
            prompts.append((skill, prompt))
        
        # Return combined prompt
        combined = "\n---\n".join([f"# {s}\n{p}" for s, p in prompts])
        
        # Save to file for CoCo to pick up
        prompt_path = self.SCREENSHOT_DIR / f"{self.template_id}_fix_prompt.md"
        with open(prompt_path, "w") as f:
            f.write(combined)
        
        self.log(f"Fix prompts saved: {prompt_path.name}", "success")
        return combined
    
    async def run_iteration(self, iteration: int) -> IterationResult:
        """Run a single iteration of the Ralph Loop."""
        start = datetime.now()
        
        print(f"\n{'='*70}")
        print(f"  RALPH LOOP - ITERATION {iteration}/{self.max_iterations}")
        print(f"  Template: {self.template_id} | Target: {self.quality_target}%")
        print(f"{'='*70}\n")
        
        # Step 1: Render
        await self.step_1_render()
        
        # Step 2: Capture
        screenshot_path = await self.step_2_capture(iteration)
        if not screenshot_path:
            return IterationResult(
                iteration=iteration,
                screenshot_path="",
                analysis=VisualAnalysisResult(overall_score=0),
                gaps_routed={},
                fixes_applied=[],
                duration_seconds=0
            )
        
        # Step 3: Analyze
        analysis = self.step_3_analyze(screenshot_path, iteration)
        self.current_score = analysis.overall_score
        
        # Step 4: Route
        routing = self.step_4_route(analysis)
        
        # Step 5: Generate fix prompts
        if analysis.gaps and analysis.overall_score < self.quality_target:
            self.step_5_generate_fix_prompt(routing)
        
        duration = (datetime.now() - start).total_seconds()
        
        result = IterationResult(
            iteration=iteration,
            screenshot_path=str(screenshot_path),
            analysis=analysis,
            gaps_routed={k: len(v) for k, v in routing.items()},
            fixes_applied=[],  # Will be populated after fixes
            duration_seconds=duration
        )
        
        self.iterations.append(result)
        return result
    
    async def run(self) -> Dict[str, Any]:
        """Run the full Ralph Loop."""
        self.start_time = datetime.now()
        
        print("\n" + "█" * 70)
        print("█" + " " * 68 + "█")
        print("█" + "       RALPH LOOP - Autonomous Visual Quality System".center(68) + "█")
        print("█" + " " * 68 + "█")
        print("█" * 70 + "\n")
        
        for iteration in range(1, self.max_iterations + 1):
            result = await self.run_iteration(iteration)
            
            if result.analysis.overall_score >= self.quality_target:
                print(f"\n{'★' * 70}")
                print(f"  🎯 TARGET ACHIEVED! Score: {result.analysis.overall_score:.1f}%")
                print(f"{'★' * 70}\n")
                break
            
            if iteration < self.max_iterations:
                print(f"\n⏳ Score {result.analysis.overall_score:.1f}% < {self.quality_target}%")
                print(f"   Fix prompts generated. Waiting for skill fixes...")
                print(f"   (In full integration, skills auto-dispatch here)\n")
        
        return self._generate_final_report()
    
    def _generate_final_report(self) -> Dict[str, Any]:
        """Generate final report."""
        total_time = (datetime.now() - self.start_time).total_seconds() if self.start_time else 0
        
        report = {
            "template_id": self.template_id,
            "quality_target": self.quality_target,
            "final_score": self.current_score,
            "target_achieved": self.current_score >= self.quality_target,
            "iterations_run": len(self.iterations),
            "total_duration_seconds": total_time,
            "iteration_history": [r.to_dict() for r in self.iterations],
            "score_progression": [r.analysis.overall_score for r in self.iterations],
            "timestamp": datetime.now().isoformat()
        }
        
        # Save report
        report_path = self.SCREENSHOT_DIR / f"{self.template_id}_ralph_report.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        
        print(f"\n{'─' * 70}")
        print("FINAL REPORT")
        print(f"{'─' * 70}")
        print(f"Template: {self.template_id}")
        print(f"Final Score: {self.current_score:.1f}%")
        print(f"Target: {self.quality_target}% {'✅ ACHIEVED' if report['target_achieved'] else '❌ NOT MET'}")
        print(f"Iterations: {len(self.iterations)}")
        print(f"Duration: {total_time:.1f}s")
        print(f"Report: {report_path}")
        print(f"{'─' * 70}\n")
        
        return report


async def quick_analyze(
    template_id: str,
    screenshot_path: Optional[str] = None,
    use_cortex: bool = True,
    connection_name: str = "se_demo"
):
    """Quick single analysis without full loop."""
    analyzer = CortexVisionAnalyzer(connection_name)
    
    # Find screenshot
    screenshot_dir = Path(__file__).parent / "screenshots"
    
    if screenshot_path:
        path = Path(screenshot_path)
    else:
        # Find latest
        screenshots = sorted(screenshot_dir.glob(f"{template_id}*.png"))
        if not screenshots:
            print(f"No screenshots found for {template_id}")
            return None
        path = screenshots[-1]
    
    reference = analyzer._get_reference_image(template_id)
    
    print(f"Analyzing: {path}")
    print(f"Reference: {reference}")
    
    if use_cortex:
        result = analyzer.analyze_with_cortex(path, reference, template_id)
    else:
        result = analyzer.analyze_local_vision(path, reference, template_id)
    
    print(f"\nResults:")
    print(json.dumps(result.to_dict(), indent=2))
    return result


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Ralph Loop - Autonomous Visual Quality System for SnowGram"
    )
    parser.add_argument(
        "--template", "-t",
        default="STREAMING_DATA_STACK",
        help="Template ID"
    )
    parser.add_argument(
        "--quick", "-q",
        action="store_true",
        help="Quick single analysis"
    )
    parser.add_argument(
        "--screenshot", "-s",
        help="Specific screenshot path for quick analysis"
    )
    parser.add_argument(
        "--url", "-u",
        default="http://localhost:3002",
        help="Frontend URL"
    )
    parser.add_argument(
        "--api", "-a",
        default="http://localhost:8000",
        help="API URL"
    )
    parser.add_argument(
        "--connection", "-c",
        default="se_demo",
        help="Snowflake connection"
    )
    parser.add_argument(
        "--target",
        type=float,
        default=95.0,
        help="Quality target percentage"
    )
    parser.add_argument(
        "--max-iterations", "-n",
        type=int,
        default=5,
        help="Max iterations"
    )
    parser.add_argument(
        "--local-only",
        action="store_true",
        help="Use local SSIM instead of Cortex"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Verbose output"
    )
    
    args = parser.parse_args()
    
    if args.quick:
        asyncio.run(quick_analyze(
            args.template,
            args.screenshot,
            not args.local_only,
            args.connection
        ))
    else:
        loop = RalphLoop(
            template_id=args.template,
            frontend_url=args.url,
            api_url=args.api,
            connection_name=args.connection,
            quality_target=args.target,
            max_iterations=args.max_iterations,
            use_cortex=not args.local_only,
            verbose=args.verbose or True
        )
        asyncio.run(loop.run())


if __name__ == "__main__":
    main()
