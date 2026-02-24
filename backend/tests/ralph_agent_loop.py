#!/usr/bin/env python3
"""
Ralph Loop with Cortex Agent Integration
=========================================

This loop queries the ACTUAL Cortex Agent in Snowflake to generate diagrams,
then evaluates them visually and iterates with feedback.

Key principle: We do NOT inject mermaid code - the Agent generates it.
"""

import asyncio
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
import requests

# Selenium for screenshot capture
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False
    print("Warning: Selenium not available. Install with: pip install selenium")


@dataclass
class IterationResult:
    """Result of a single Ralph loop iteration."""
    iteration: int
    mermaid_code: str
    screenshot_path: Optional[Path]
    issues_found: List[str]
    score: float  # 0-100
    converged: bool
    agent_response: Dict[str, Any]


class RalphAgentLoop:
    """
    Ralph Loop that queries the Cortex Agent for diagram generation.
    
    Flow:
    1. PROMPT → Send user query to Cortex Agent API
    2. RENDER → Agent returns mermaid, frontend renders React Flow
    3. CAPTURE → Screenshot the rendered diagram
    4. ANALYZE → Use Cortex Vision to analyze quality
    5. FEEDBACK → Generate improvement prompt if not converged
    6. LOOP → Repeat until 95% quality or max iterations
    """
    
    # Configuration
    BACKEND_URL = "http://localhost:8082"
    FRONTEND_URL = "http://localhost:3002"
    TARGET_SCORE = 95.0
    MAX_ITERATIONS = 10
    
    # Snowflake connection
    CONNECTION_NAME = "se_demo"
    VISION_STAGE = "@SNOWGRAM_DB.CORE.VISUAL_TEST_IMAGES"
    
    def __init__(self):
        self.base_dir = Path(__file__).parent.parent.parent
        self.output_dir = Path(__file__).parent / ".ralph" / "iterations"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Reference image for comparison
        self.reference_image = Path(__file__).parent / "visual" / "reference_images" / "reference_page4.png"
        
        # State
        self.iteration = 0
        self.history: List[IterationResult] = []
        self.driver: Optional[webdriver.Chrome] = None
        
        # Test prompt
        self.base_prompt = "streaming data architecture with Kafka ingestion, Snowpipe Streaming, Dynamic Tables, and Analytics"
        
    def _init_browser(self):
        """Initialize headless Chrome for screenshots."""
        if not SELENIUM_AVAILABLE:
            return None
            
        options = Options()
        options.add_argument('--headless')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--window-size=1920,1080')
        
        try:
            self.driver = webdriver.Chrome(options=options)
            return self.driver
        except Exception as e:
            print(f"Failed to init Chrome: {e}")
            return None
    
    def _close_browser(self):
        """Close browser."""
        if self.driver:
            self.driver.quit()
            self.driver = None
    
    # =========================================================================
    # STEP 1: QUERY CORTEX AGENT
    # =========================================================================
    
    def query_agent(self, prompt: str) -> Dict[str, Any]:
        """
        Query the Cortex Agent via the backend API.
        
        Returns dict with:
        - mermaid_code: Generated mermaid
        - explanation: Agent's explanation
        - components_used: List of components
        - error: Error message if failed
        """
        print(f"  Querying Cortex Agent with: {prompt[:60]}...")
        
        try:
            response = requests.post(
                f"{self.BACKEND_URL}/api/diagram/generate",
                json={"user_query": prompt},
                timeout=120
            )
            
            if response.status_code != 200:
                return {"error": f"API returned {response.status_code}: {response.text[:200]}"}
            
            data = response.json()
            
            if "mermaid_code" not in data:
                return {"error": "No mermaid_code in response"}
            
            return {
                "mermaid_code": data["mermaid_code"],
                "explanation": data.get("explanation", ""),
                "components_used": data.get("components_used", []),
                "generation_time_ms": data.get("generation_time_ms", 0)
            }
            
        except requests.Timeout:
            return {"error": "Agent query timed out"}
        except Exception as e:
            return {"error": str(e)}
    
    # =========================================================================
    # STEP 2: RENDER IN FRONTEND
    # =========================================================================
    
    def render_in_frontend(self, mermaid_code: str) -> bool:
        """
        Load the frontend and paste mermaid code to render.
        
        Returns True if successful.
        """
        if not self.driver:
            print("  No browser available for rendering")
            return False
        
        try:
            # Navigate to frontend
            self.driver.get(self.FRONTEND_URL)
            
            # Wait for app to load
            WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.CLASS_NAME, "react-flow"))
            )
            
            # The frontend auto-renders when mermaid is received via API
            # So we just need to wait for the diagram to appear
            time.sleep(3)  # Give React Flow time to layout
            
            return True
            
        except Exception as e:
            print(f"  Render failed: {e}")
            return False
    
    # =========================================================================
    # STEP 3: CAPTURE SCREENSHOT
    # =========================================================================
    
    def capture_screenshot(self) -> Optional[Path]:
        """
        Capture screenshot of the rendered diagram.
        
        Returns path to screenshot, or None if failed.
        """
        if not self.driver:
            print("  No browser for screenshot")
            return None
        
        screenshot_path = self.output_dir / f"iter_{self.iteration}.png"
        
        try:
            # Find the React Flow canvas
            canvas = self.driver.find_element(By.CLASS_NAME, "react-flow")
            
            # Screenshot just the canvas area
            canvas.screenshot(str(screenshot_path))
            
            print(f"  Screenshot saved: {screenshot_path.name}")
            return screenshot_path
            
        except Exception as e:
            print(f"  Screenshot failed: {e}")
            # Try full page screenshot as fallback
            try:
                self.driver.save_screenshot(str(screenshot_path))
                return screenshot_path
            except:
                return None
    
    # =========================================================================
    # STEP 4: ANALYZE WITH CORTEX VISION
    # =========================================================================
    
    def analyze_with_vision(self, screenshot_path: Path) -> Tuple[float, List[str]]:
        """
        Use Cortex Vision (AI_COMPLETE with images) to analyze diagram quality.
        
        Returns: (score, list_of_issues)
        """
        print("  Analyzing with Cortex Vision...")
        
        # First, upload screenshot to stage
        stage_path = f"{self.VISION_STAGE}/ralph_iter_{self.iteration}.png"
        
        try:
            # Upload file to stage
            upload_sql = f"PUT file://{screenshot_path} {self.VISION_STAGE} AUTO_COMPRESS=FALSE OVERWRITE=TRUE"
            result = subprocess.run(
                ["snow", "sql", "-c", self.CONNECTION_NAME, "-q", upload_sql],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if result.returncode != 0:
                print(f"  Upload failed: {result.stderr[:100]}")
                return 50.0, ["Failed to upload image for analysis"]
            
            # Now call Cortex Vision to analyze
            analysis_prompt = """Analyze this Snowflake architecture diagram and rate its quality.

Look for these issues:
1. LAYOUT: Are components arranged in clear horizontal lanes (left-to-right flow)?
2. BADGES: Are lane badges (1A, 1B, 1C, 1D) visible at the LEFT edge of Snowflake?
3. SECTION BADGES: Are section badges (2, 3, 4, 5) visible at the TOP of their sections?
4. BOUNDARIES: Is External Sources clearly separated from Snowflake Account?
5. CONNECTIONS: Do arrows flow smoothly without overlapping?
6. TEXT: Is all text readable and not cut off?
7. SPACING: Is there appropriate spacing between components?

Return a JSON object with:
{
  "score": <0-100>,
  "issues": ["issue1", "issue2", ...],
  "layout_correct": true/false,
  "badges_visible": true/false,
  "connections_clean": true/false
}"""

            vision_sql = f"""
SELECT SNOWFLAKE.CORTEX.AI_COMPLETE(
    'claude-3-5-sonnet',
    PROMPT('{analysis_prompt.replace("'", "''")}'),
    TO_FILE('{stage_path}')
) as analysis
"""
            
            result = subprocess.run(
                ["snow", "sql", "-c", self.CONNECTION_NAME, "-q", vision_sql, "--format", "json"],
                capture_output=True,
                text=True,
                timeout=120
            )
            
            if result.returncode != 0:
                print(f"  Vision analysis failed: {result.stderr[:100]}")
                return 50.0, ["Vision analysis failed"]
            
            # Parse response
            rows = json.loads(result.stdout)
            if rows and len(rows) > 0:
                analysis_text = rows[0].get("ANALYSIS", "")
                
                # Try to extract JSON from response
                try:
                    # Find JSON in response
                    import re
                    json_match = re.search(r'\{[^{}]*"score"[^{}]*\}', analysis_text, re.DOTALL)
                    if json_match:
                        analysis = json.loads(json_match.group())
                        score = float(analysis.get("score", 50))
                        issues = analysis.get("issues", [])
                        return score, issues
                except:
                    pass
                
                # Fallback: estimate from text
                return 60.0, ["Could not parse vision analysis"]
            
            return 50.0, ["No vision response"]
            
        except Exception as e:
            print(f"  Vision error: {e}")
            return 50.0, [str(e)]
    
    # =========================================================================
    # STEP 5: GENERATE FEEDBACK PROMPT
    # =========================================================================
    
    def generate_feedback_prompt(self, issues: List[str]) -> str:
        """
        Generate an improved prompt based on identified issues.
        """
        feedback_parts = [self.base_prompt]
        
        # Add specific corrections based on issues
        issue_text = " ".join(issues).lower()
        
        if "badge" in issue_text or "1a" in issue_text or "1b" in issue_text:
            feedback_parts.append("Ensure lane badges (1A, 1B, 1C, 1D) are clearly visible at the left edge")
        
        if "layout" in issue_text or "horizontal" in issue_text:
            feedback_parts.append("Use clear horizontal lanes with left-to-right data flow")
        
        if "spacing" in issue_text or "gap" in issue_text:
            feedback_parts.append("Minimize gaps between related components")
        
        if "cut off" in issue_text or "text" in issue_text:
            feedback_parts.append("Ensure all labels are fully visible")
        
        if "scattered" in issue_text or "position" in issue_text:
            feedback_parts.append("Group related components together within their sections")
        
        return ". ".join(feedback_parts)
    
    # =========================================================================
    # MAIN LOOP
    # =========================================================================
    
    async def run_iteration(self) -> IterationResult:
        """Run a single iteration of the Ralph loop."""
        self.iteration += 1
        
        print(f"\n{'='*70}")
        print(f"RALPH LOOP - ITERATION {self.iteration}")
        print(f"{'='*70}")
        
        # Build prompt (include feedback from previous iteration)
        if self.history and self.history[-1].issues_found:
            prompt = self.generate_feedback_prompt(self.history[-1].issues_found)
        else:
            prompt = self.base_prompt
        
        # Step 1: Query Agent
        print("\n[1/4] Querying Cortex Agent...")
        agent_response = self.query_agent(prompt)
        
        if agent_response.get("error"):
            print(f"  ✗ Agent error: {agent_response['error']}")
            return IterationResult(
                iteration=self.iteration,
                mermaid_code="",
                screenshot_path=None,
                issues_found=[agent_response["error"]],
                score=0.0,
                converged=False,
                agent_response=agent_response
            )
        
        mermaid_code = agent_response["mermaid_code"]
        print(f"  ✓ Agent returned {len(mermaid_code)} chars of mermaid")
        print(f"  ✓ Components: {', '.join(agent_response.get('components_used', [])[:5])}")
        
        # Save mermaid code
        mermaid_path = self.output_dir / f"iter_{self.iteration}.mmd"
        mermaid_path.write_text(mermaid_code)
        
        # Step 2 & 3: Render and capture (if browser available)
        screenshot_path = None
        if self.driver:
            print("\n[2/4] Rendering in frontend...")
            if self.render_in_frontend(mermaid_code):
                print("\n[3/4] Capturing screenshot...")
                screenshot_path = self.capture_screenshot()
        else:
            print("\n[2/4] Skipping render (no browser)")
            print("[3/4] Skipping screenshot")
        
        # Step 4: Analyze
        print("\n[4/4] Analyzing quality...")
        if screenshot_path and screenshot_path.exists():
            score, issues = self.analyze_with_vision(screenshot_path)
        else:
            # Without screenshot, do basic mermaid analysis
            score, issues = self._analyze_mermaid_only(mermaid_code)
        
        converged = score >= self.TARGET_SCORE
        
        print(f"\n  Score: {score:.1f}% (target: {self.TARGET_SCORE}%)")
        print(f"  Issues: {len(issues)}")
        for issue in issues[:5]:
            print(f"    - {issue}")
        print(f"  Converged: {'✓ YES' if converged else '✗ NO'}")
        
        result = IterationResult(
            iteration=self.iteration,
            mermaid_code=mermaid_code,
            screenshot_path=screenshot_path,
            issues_found=issues,
            score=score,
            converged=converged,
            agent_response=agent_response
        )
        
        self.history.append(result)
        self._save_progress()
        
        return result
    
    def _analyze_mermaid_only(self, mermaid_code: str) -> Tuple[float, List[str]]:
        """Basic mermaid analysis when screenshots not available."""
        issues = []
        score = 70.0  # Base score
        
        # Check for key elements
        if "badge_1a" not in mermaid_code.lower():
            issues.append("Missing lane badge 1A")
            score -= 5
        if "badge_1b" not in mermaid_code.lower():
            issues.append("Missing lane badge 1B")
            score -= 5
        if "laneBadge" not in mermaid_code:
            issues.append("No laneBadge class definition")
            score -= 10
        if "sectionBadge" not in mermaid_code:
            issues.append("No sectionBadge class definition")
            score -= 10
        if "subgraph" not in mermaid_code:
            issues.append("No subgraphs for grouping")
            score -= 15
        if "snowflake" not in mermaid_code.lower():
            issues.append("Missing Snowflake boundary")
            score -= 10
        
        # Bonus for good structure
        if mermaid_code.count("subgraph") >= 5:
            score += 10
        if "flowchart LR" in mermaid_code:
            score += 5  # Left-to-right flow
        
        return max(0, min(100, score)), issues
    
    def _save_progress(self):
        """Save progress to markdown file."""
        progress_path = self.output_dir.parent / "progress.md"
        
        lines = [
            "# Ralph Agent Loop Progress",
            "",
            f"> **Target Score**: {self.TARGET_SCORE}%",
            f"> **Current Iteration**: {self.iteration}",
            f"> **Status**: {'CONVERGED' if self.history and self.history[-1].converged else 'IN PROGRESS'}",
            "",
            "## Iteration History",
            "",
            "| Iter | Score | Issues | Status |",
            "|------|-------|--------|--------|",
        ]
        
        for result in self.history:
            status = "✓" if result.converged else "→"
            lines.append(f"| {result.iteration} | {result.score:.1f}% | {len(result.issues_found)} | {status} |")
        
        if self.history:
            latest = self.history[-1]
            lines.extend([
                "",
                "## Latest Issues",
                "",
            ])
            for issue in latest.issues_found[:10]:
                lines.append(f"- {issue}")
        
        progress_path.write_text("\n".join(lines))
    
    async def run(self) -> bool:
        """
        Run the full Ralph loop until convergence or max iterations.
        
        Returns True if converged.
        """
        print("="*70)
        print("RALPH AGENT LOOP")
        print("="*70)
        print(f"Backend: {self.BACKEND_URL}")
        print(f"Frontend: {self.FRONTEND_URL}")
        print(f"Target: {self.TARGET_SCORE}%")
        print(f"Max Iterations: {self.MAX_ITERATIONS}")
        print("="*70)
        
        # Initialize browser
        print("\nInitializing browser...")
        self._init_browser()
        
        try:
            for _ in range(self.MAX_ITERATIONS):
                result = await self.run_iteration()
                
                if result.converged:
                    print("\n" + "="*70)
                    print("✓ CONVERGED!")
                    print(f"Final Score: {result.score:.1f}%")
                    print(f"Iterations: {self.iteration}")
                    print("="*70)
                    return True
                
                # Small delay between iterations
                await asyncio.sleep(2)
            
            print("\n" + "="*70)
            print("✗ MAX ITERATIONS REACHED")
            if self.history:
                print(f"Final Score: {self.history[-1].score:.1f}%")
            print("="*70)
            return False
            
        finally:
            self._close_browser()


async def main():
    """Run the Ralph Agent Loop."""
    loop = RalphAgentLoop()
    success = await loop.run()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
