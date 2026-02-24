#!/usr/bin/env python3
"""
Unified Convergence Loop for SnowGram (Ralph Loop Pattern)
==========================================================

Follows Ralph Loop best practices:
1. EXTERNAL CONTROL - Progress lives in files/git, not LLM context
2. MACHINE-VERIFIABLE - Exact criteria that can be checked programmatically
3. FAILURE-DRIVEN - Errors become feedback for next iteration
4. STATE PERSISTENCE - progress.md, guardrails.md track across iterations
5. GUTTER DETECTION - 3x same failure = escalate to bundled skill
6. FRESH CONTEXT - CoCo skill invocation gets clean context

Architecture:
    INVOKE (Agent) → RENDER (React Flow Frontend) → EVALUATE (6-pass) → DIAGNOSE → FIX → LOOP

Files:
    .ralph/progress.md   - Completion checklist with [ ] boxes
    .ralph/guardrails.md - Lessons learned from failures
    .ralph/activity.log  - Iteration history
"""

import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from visual.eval_passes import VisualEvaluator, EvalResult, PassResult, EvalPass
from visual.skill_triggers import SkillTrigger, FixAction


class RootCause(Enum):
    """Root cause categories mapped to skills."""
    AGENT_SPEC = "agent_spec"           # → $cortex-agent
    SEMANTIC_VIEW = "semantic_view"     # → $semantic-view
    FRONTEND_CODE = "frontend_code"     # → $lane-layout-debugger
    MERMAID_TEMPLATE = "mermaid_template"  # → Direct fix
    UNKNOWN = "unknown"                 # → $snowgram-debugger


class SkillTarget(Enum):
    """Skills to invoke based on root cause."""
    CORTEX_AGENT = "cortex-agent"
    SEMANTIC_VIEW = "semantic-view"
    LANE_LAYOUT_DEBUGGER = "lane-layout-debugger"
    SNOWGRAM_DEBUGGER = "snowgram-debugger"
    DIRECT_FIX = "direct"


@dataclass
class FailureRecord:
    """Track repeated failures for gutter detection."""
    defect_key: str
    count: int = 1
    iterations: List[int] = field(default_factory=list)
    last_action: str = ""


@dataclass
class ConvergenceState:
    """Persistent state across iterations."""
    iteration: int = 0
    scores: Dict[str, float] = field(default_factory=dict)
    failure_counts: Dict[str, FailureRecord] = field(default_factory=dict)
    guardrails: List[str] = field(default_factory=list)
    converged: bool = False
    last_action: str = ""


class UnifiedConvergenceLoop:
    """
    Ralph-style convergence loop integrating:
    - Agent tool testing (SUGGEST_COMPONENTS_JSON)
    - Visual rendering (Mermaid CLI)
    - Visual comparison (6-pass evaluation)
    - Root cause diagnosis
    - CoCo skill routing
    """
    
    MAX_ITERATIONS = 10
    TARGET_SCORE = 95.0
    GUTTER_THRESHOLD = 3  # 3x same failure = escalate
    
    # Backend API URL (calls actual Cortex Agent)
    BACKEND_API_URL = "http://localhost:8082"
    
    # Frontend URL (React Flow rendering)
    FRONTEND_URL = "http://localhost:3002"
    
    # Snowflake coordinates
    AGENT_DATABASE = "SNOWGRAM_DB"
    AGENT_SCHEMA = "AGENTS"
    AGENT_NAME = "SNOWGRAM_AGENT"
    SEMANTIC_VIEW = "SNOWGRAM_DB.CORE.COMPONENT_MAP_SV"
    
    # Score thresholds per pass
    PASS_THRESHOLDS = {
        "components": 90,
        "connections": 85,
        "layout": 70,
        "badges": 90,
        "styling": 80,
        "structure": 80,
    }
    
    # Root cause mapping based on failing pass
    ROOT_CAUSE_MAP = {
        "components": RootCause.SEMANTIC_VIEW,
        "connections": RootCause.AGENT_SPEC,
        "layout": RootCause.FRONTEND_CODE,
        "badges": RootCause.MERMAID_TEMPLATE,
        "styling": RootCause.MERMAID_TEMPLATE,
        "structure": RootCause.AGENT_SPEC,
    }
    
    # Skill mapping for root causes
    SKILL_MAP = {
        RootCause.AGENT_SPEC: SkillTarget.CORTEX_AGENT,
        RootCause.SEMANTIC_VIEW: SkillTarget.SEMANTIC_VIEW,
        RootCause.FRONTEND_CODE: SkillTarget.LANE_LAYOUT_DEBUGGER,
        RootCause.MERMAID_TEMPLATE: SkillTarget.DIRECT_FIX,
        RootCause.UNKNOWN: SkillTarget.SNOWGRAM_DEBUGGER,
    }
    
    def __init__(self, connection_name: str = "se_demo"):
        self.connection_name = connection_name
        self.base_dir = Path(__file__).parent.parent.parent
        self.ralph_dir = Path(__file__).parent / ".ralph"
        self.output_dir = Path(__file__).parent / "visual" / "output"
        self.reference_image = Path(__file__).parent / "visual" / "reference_images" / "reference_page4.png"
        
        # State
        self.state = ConvergenceState()
        
        # Test prompt
        self.test_prompt = "streaming architecture with Kafka ingestion"
        
        # Mermaid template
        self.mermaid_template = self._load_streaming_template()
        
        # Ensure directories exist
        self.ralph_dir.mkdir(exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
    
    def _load_streaming_template(self) -> str:
        """Load the streaming data stack template."""
        # Primary location
        template_path = Path(__file__).parent / "visual" / "mermaid_templates" / "streaming_data_stack.mmd"
        if template_path.exists():
            return template_path.read_text()
        
        # Fallback location
        template_path = self.base_dir / "mermaid_templates" / "streaming_data_stack.mmd"
        if template_path.exists():
            return template_path.read_text()
        
        # Fallback minimal template
        return """flowchart LR
    badge_1a(["1a"]):::laneBadge
    badge_1b(["1b"]):::laneBadge
    badge_1c(["1c"]):::laneBadge
    badge_1d(["1d"]):::laneBadge
    
    subgraph snowflake["Snowflake"]
        badge_2(["2"]):::sectionBadge
        badge_3(["3"]):::sectionBadge
        badge_4(["4"]):::sectionBadge
        badge_5(["5"]):::sectionBadge
        
        snowpipe_streaming["Snowpipe\\nStreaming"]
        dynamic_tables["Dynamic\\nTables"]
        analytics_views["Analytics\\nViews"]
    end
    
    kafka["Kafka"] --> snowpipe_streaming
    snowpipe_streaming --> dynamic_tables
    dynamic_tables --> analytics_views
    
    classDef laneBadge fill:#7C3AED,stroke:#5B21B6,color:#fff,font-weight:bold
    classDef sectionBadge fill:#2563EB,stroke:#1D4ED8,color:#fff,font-weight:bold
"""
    
    # ========================================================================
    # RALPH STATE MANAGEMENT
    # ========================================================================
    
    def _load_progress(self) -> Dict[str, bool]:
        """Load progress.md and parse [ ] / [x] checkboxes."""
        progress_file = self.ralph_dir / "progress.md"
        criteria = {}
        
        if progress_file.exists():
            content = progress_file.read_text()
            # Parse checkboxes like "- [ ] Components >= 90%"
            for match in re.finditer(r'- \[([ x])\] (\w+) >= (\d+)%', content):
                checked = match.group(1) == 'x'
                pass_name = match.group(2).lower()
                criteria[pass_name] = checked
        
        return criteria
    
    def _update_progress(self, scores: Dict[str, float]) -> None:
        """Update progress.md with current scores."""
        progress_file = self.ralph_dir / "progress.md"
        
        # Build updated content
        lines = [
            "# SnowGram Convergence Progress",
            "",
            f"> **Target**: {self.TARGET_SCORE}% overall visual quality score",
            f"> **Test Prompt**: \"{self.test_prompt}\"",
            f"> **Iteration**: {self.state.iteration}",
            "",
            "## Success Criteria (Machine-Verifiable)",
            "",
        ]
        
        # Add checkboxes
        overall_score = scores.get("overall", 0)
        for pass_name, threshold in self.PASS_THRESHOLDS.items():
            score = scores.get(pass_name, 0)
            checked = "x" if score >= threshold else " "
            lines.append(f"- [{checked}] {pass_name.title()} >= {threshold}% (current: {score:.1f}%)")
        
        overall_checked = "x" if overall_score >= self.TARGET_SCORE else " "
        lines.append(f"- [{overall_checked}] **Overall >= {self.TARGET_SCORE}%** (current: {overall_score:.1f}%)")
        
        # Add scores table
        lines.extend([
            "",
            "## Current Scores",
            "",
            "| Pass | Score | Threshold | Status |",
            "|------|-------|-----------|--------|",
        ])
        
        for pass_name, threshold in self.PASS_THRESHOLDS.items():
            score = scores.get(pass_name, 0)
            status = "✓" if score >= threshold else "✗"
            lines.append(f"| {pass_name.title()} | {score:.1f}% | {threshold}% | {status} |")
        
        lines.append(f"| **Overall** | **{overall_score:.1f}%** | **{self.TARGET_SCORE}%** | {'✓' if overall_score >= self.TARGET_SCORE else '✗'} |")
        
        # Add iteration log
        lines.extend([
            "",
            "## Iteration Log",
            "",
            "| Iter | Overall | Action Taken | Result |",
            "|------|---------|--------------|--------|",
        ])
        
        lines.append(f"| {self.state.iteration} | {overall_score:.1f}% | {self.state.last_action or 'Initial'} | {'Converged' if overall_score >= self.TARGET_SCORE else 'Continue'} |")
        
        progress_file.write_text("\n".join(lines))
    
    def _load_guardrails(self) -> List[str]:
        """Load guardrails.md and parse Signs."""
        guardrails_file = self.ralph_dir / "guardrails.md"
        signs = []
        
        if guardrails_file.exists():
            content = guardrails_file.read_text()
            # Parse "### Sign: ..." blocks
            for match in re.finditer(r'### Sign: (.+)', content):
                signs.append(match.group(1))
        
        return signs
    
    def _add_guardrail(self, trigger: str, instruction: str) -> None:
        """Add a new Sign to guardrails.md."""
        guardrails_file = self.ralph_dir / "guardrails.md"
        
        content = guardrails_file.read_text() if guardrails_file.exists() else ""
        
        # Find insertion point (after "## Signs" section)
        insert_marker = "<!-- Signs are added automatically"
        if insert_marker in content:
            insert_pos = content.find(insert_marker)
            insert_pos = content.find("\n", insert_pos) + 1
        else:
            insert_pos = len(content)
        
        # Create new sign
        new_sign = f"\n### Sign: {trigger}\n- **Instruction**: {instruction}\n- **Added after**: Iteration {self.state.iteration}\n"
        
        content = content[:insert_pos] + new_sign + content[insert_pos:]
        guardrails_file.write_text(content)
        
        self.state.guardrails.append(f"{trigger}: {instruction}")
    
    def _log_activity(self, message: str) -> None:
        """Append to activity.log."""
        log_file = self.ralph_dir / "activity.log"
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        with open(log_file, "a") as f:
            f.write(f"[{timestamp}] Iter {self.state.iteration}: {message}\n")
    
    # ========================================================================
    # STEP 1: INVOKE AGENT
    # ========================================================================
    
    async def invoke_agent(self, prompt: str) -> Dict[str, Any]:
        """
        Invoke the Cortex Agent via the backend HTTP API.
        
        This calls the ACTUAL Snowflake Cortex Agent (not just SUGGEST_COMPONENTS_JSON)
        which returns complete mermaid code for rendering.
        
        Returns dict with:
        - mermaid_code: Generated Mermaid code from Cortex Agent
        - components: List of components used
        - explanation: Agent's explanation
        - error: Error message if failed
        """
        import requests
        
        self._log_activity(f"Invoking Cortex Agent via API with prompt: {prompt[:50]}...")
        
        try:
            response = requests.post(
                f"{self.BACKEND_API_URL}/api/diagram/generate",
                json={"user_query": prompt},
                timeout=120
            )
            
            if response.status_code != 200:
                return {"error": f"API returned {response.status_code}: {response.text[:200]}"}
            
            data = response.json()
            
            if "mermaid_code" not in data:
                return {"error": "No mermaid_code in agent response"}
            
            mermaid_code = data["mermaid_code"]
            components = data.get("components_used", [])
            
            self._log_activity(f"Cortex Agent returned {len(mermaid_code)} chars mermaid, {len(components)} components")
            
            # Update the template with agent-generated mermaid
            self.mermaid_template = mermaid_code
            
            return {
                "mermaid_code": mermaid_code,
                "components": components,
                "explanation": data.get("explanation", ""),
                "generation_time_ms": data.get("generation_time_ms", 0)
            }
            
        except requests.Timeout:
            return {"error": "Cortex Agent API timed out"}
        except requests.ConnectionError:
            return {"error": f"Cannot connect to backend at {self.BACKEND_API_URL}"}
        except Exception as e:
            return {"error": str(e)}
    
    # ========================================================================
    # STEP 2: RENDER DIAGRAM
    # ========================================================================
    
    def render_mermaid(self, mermaid_code: str) -> Optional[Path]:
        """
        Render Mermaid code to PNG using Mermaid CLI.
        
        Returns path to generated image, or None if failed.
        """
        self._log_activity("Rendering Mermaid diagram...")
        
        output_path = self.output_dir / f"streaming_iter_{self.state.iteration}.png"
        
        try:
            # Write Mermaid code to temp file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.mmd', delete=False) as f:
                f.write(mermaid_code)
                temp_input = f.name
            
            # Run Mermaid CLI
            result = subprocess.run(
                ["npx", "--yes", "@mermaid-js/mermaid-cli", "-i", temp_input, "-o", str(output_path)],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            # Cleanup
            os.unlink(temp_input)
            
            if output_path.exists():
                self._log_activity(f"Rendered to {output_path}")
                return output_path
            else:
                self._log_activity(f"Render failed: {result.stderr[:200]}")
                return None
                
        except Exception as e:
            self._log_activity(f"Render error: {e}")
            return None
    
    async def render_in_frontend(self, prompt: str) -> Optional[Path]:
        """
        Render diagram via React Flow frontend using Playwright.
        
        This captures the ACTUAL frontend rendering that users see,
        not the Mermaid CLI output. The frontend uses:
        - React Flow for node/edge rendering
        - ELK layout algorithm for positioning
        - Custom lane/badge rendering
        
        Flow:
        1. Call backend API to get mermaid code from Cortex Agent
        2. Use window.generateDiagram test hook to render in React Flow
        3. Screenshot the React Flow canvas
        
        Args:
            prompt: The user query to send to the Cortex Agent
            
        Returns:
            Path to captured screenshot, or None if failed
        """
        from playwright.async_api import async_playwright
        import requests
        
        self._log_activity(f"Rendering via React Flow frontend: {prompt[:50]}...")
        
        output_path = self.output_dir / f"frontend_iter_{self.state.iteration}.png"
        
        try:
            # Step 1: Get mermaid code from Cortex Agent via backend API
            self._log_activity("Calling Cortex Agent API for mermaid code...")
            response = requests.post(
                f"{self.BACKEND_API_URL}/api/diagram/generate",
                json={"user_query": prompt},
                timeout=120
            )
            
            if response.status_code != 200:
                self._log_activity(f"API error: {response.status_code} - {response.text[:200]}")
                return None
            
            data = response.json()
            mermaid_code = data.get("mermaid_code", "")
            
            if not mermaid_code:
                self._log_activity("No mermaid_code in API response")
                return None
            
            self._log_activity(f"Got {len(mermaid_code)} chars mermaid from Cortex Agent")
            
            # Store mermaid for evaluation
            self.mermaid_template = mermaid_code
            
            # Step 2: Use Playwright to render via frontend test hook
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page(viewport={"width": 1920, "height": 1080})
                
                # Navigate to frontend
                self._log_activity(f"Loading frontend at {self.FRONTEND_URL}")
                await page.goto(self.FRONTEND_URL, wait_until="networkidle")
                
                # Wait for React Flow to be ready
                await page.wait_for_selector(".react-flow", timeout=15000)
                self._log_activity("React Flow canvas ready")
                
                # Wait for test hook to be registered
                await page.wait_for_function(
                    "typeof window.generateDiagram === 'function'",
                    timeout=10000
                )
                self._log_activity("Test hook window.generateDiagram is available")
                
                # Call the test hook to render mermaid
                self._log_activity("Calling window.generateDiagram with Cortex Agent mermaid...")
                success = await page.evaluate(
                    """async (mermaidCode) => {
                        try {
                            return await window.generateDiagram(mermaidCode);
                        } catch (e) {
                            console.error('generateDiagram error:', e);
                            return false;
                        }
                    }""",
                    mermaid_code
                )
                
                if not success:
                    self._log_activity("WARNING: window.generateDiagram returned false")
                else:
                    self._log_activity("Diagram rendered successfully")
                
                # Wait for layout to stabilize
                await page.wait_for_timeout(2000)
                
                # Wait for nodes to appear
                try:
                    await page.wait_for_selector(".react-flow__node", timeout=10000)
                    node_count = await page.evaluate(
                        "document.querySelectorAll('.react-flow__node').length"
                    )
                    self._log_activity(f"React Flow rendered {node_count} nodes")
                except:
                    self._log_activity("WARNING: No React Flow nodes found")
                
                # Additional stabilization time for ELK layout
                await page.wait_for_timeout(1000)
                
                # Screenshot the React Flow canvas
                react_flow_element = await page.query_selector(".react-flow")
                
                if react_flow_element:
                    await react_flow_element.screenshot(path=str(output_path))
                    self._log_activity(f"Captured React Flow canvas to {output_path}")
                else:
                    await page.screenshot(path=str(output_path), full_page=False)
                    self._log_activity(f"Captured full page to {output_path}")
                
                await browser.close()
                
                if output_path.exists():
                    return output_path
                else:
                    return None
                    
        except Exception as e:
            self._log_activity(f"Frontend render error: {e}")
            import traceback
            self._log_activity(traceback.format_exc())
            return None
    
    # ========================================================================
    # STEP 3: VISUAL EVALUATION (6-pass)
    # ========================================================================
    
    async def evaluate_visual(self, generated_image: Path) -> EvalResult:
        """
        Run 6-pass visual evaluation comparing against reference.
        
        Passes:
        1. Structure (15%) - Subgraph hierarchy
        2. Components (25%) - Node presence
        3. Connections (20%) - Edge routing
        4. Styling (15%) - Colors, classDef
        5. Layout (15%) - Horizontal lanes
        6. Badges (10%) - Position quality
        """
        self._log_activity("Running 6-pass visual evaluation...")
        
        evaluator = VisualEvaluator(
            reference_image_path=str(self.reference_image) if self.reference_image.exists() else None,
            generated_image_path=str(generated_image),
            mermaid_code=self.mermaid_template,
            target_score=self.TARGET_SCORE
        )
        
        result = await evaluator.evaluate()
        
        # Log scores
        for pass_name, pass_result in result.pass_results.items():
            self._log_activity(f"  {pass_name}: {pass_result.score:.1f}%")
        
        self._log_activity(f"Overall: {result.overall_score:.1f}%")
        
        return result
    
    # ========================================================================
    # STEP 4: ROOT CAUSE DIAGNOSIS
    # ========================================================================
    
    def diagnose_root_cause(self, eval_result: EvalResult) -> Tuple[RootCause, SkillTarget, str]:
        """
        Analyze evaluation results to determine root cause.
        
        Returns: (root_cause, skill_to_invoke, defect_description)
        """
        # Find lowest scoring pass below threshold
        failing_passes = []
        
        for pass_name, pass_result in eval_result.pass_results.items():
            threshold = self.PASS_THRESHOLDS.get(pass_name, 80)
            if pass_result.score < threshold:
                failing_passes.append((pass_name, pass_result.score, pass_result.defects))
        
        if not failing_passes:
            return RootCause.UNKNOWN, SkillTarget.DIRECT_FIX, "No failures detected"
        
        # Sort by severity (lowest score first)
        failing_passes.sort(key=lambda x: x[1])
        
        worst_pass, worst_score, defects = failing_passes[0]
        
        # Map to root cause
        root_cause = self.ROOT_CAUSE_MAP.get(worst_pass, RootCause.UNKNOWN)
        
        # Check for gutter condition (3x same failure)
        defect_key = f"{worst_pass}:{defects[0] if defects else 'unknown'}"
        
        if defect_key in self.state.failure_counts:
            record = self.state.failure_counts[defect_key]
            record.count += 1
            record.iterations.append(self.state.iteration)
            
            if record.count >= self.GUTTER_THRESHOLD:
                # GUTTER DETECTED: Escalate to bundled skill
                self._log_activity(f"GUTTER DETECTED: {defect_key} failed {record.count}x - escalating")
                self._add_guardrail(
                    f"Repeated {worst_pass} failure",
                    f"Direct fixes failed {record.count}x. Escalate to bundled skill."
                )
                
                # Force escalation from direct fix to bundled skill
                if root_cause == RootCause.MERMAID_TEMPLATE:
                    root_cause = RootCause.FRONTEND_CODE
        else:
            self.state.failure_counts[defect_key] = FailureRecord(
                defect_key=defect_key,
                iterations=[self.state.iteration]
            )
        
        # Get skill target
        skill_target = self.SKILL_MAP.get(root_cause, SkillTarget.SNOWGRAM_DEBUGGER)
        
        # Build defect description
        defect_desc = f"{worst_pass} at {worst_score:.1f}% (threshold {self.PASS_THRESHOLDS.get(worst_pass, 80)}%)"
        if defects:
            defect_desc += f": {defects[0]}"
        
        return root_cause, skill_target, defect_desc
    
    # ========================================================================
    # STEP 5: OUTPUT YAML FOR COCO
    # ========================================================================
    
    def output_coco_yaml(
        self,
        root_cause: RootCause,
        skill_target: SkillTarget,
        defect_desc: str,
        eval_result: EvalResult
    ) -> str:
        """
        Output structured YAML for CoCo to parse and invoke skill.
        
        This is the KEY OUTPUT that tells CoCo what to do.
        """
        import yaml
        
        output = {
            "ralph_loop": {
                "iteration": self.state.iteration,
                "status": "converged" if eval_result.converged else "continue",
                "overall_score": round(eval_result.overall_score, 1),
                "target_score": self.TARGET_SCORE,
            },
            "diagnosis": {
                "root_cause": root_cause.value,
                "defect": defect_desc,
                "gutter_detected": any(
                    r.count >= self.GUTTER_THRESHOLD 
                    for r in self.state.failure_counts.values()
                ),
            },
            "action_required": {
                "skill": f"${skill_target.value}" if skill_target != SkillTarget.DIRECT_FIX else "direct_fix",
                "instructions": self._get_skill_instructions(root_cause, skill_target, defect_desc),
            },
            "pass_scores": {
                name: {
                    "score": round(pr.score, 1),
                    "threshold": self.PASS_THRESHOLDS.get(name, 80),
                    "passed": pr.score >= self.PASS_THRESHOLDS.get(name, 80),
                }
                for name, pr in eval_result.pass_results.items()
            },
            "guardrails_active": len(self.state.guardrails),
        }
        
        return yaml.dump(output, default_flow_style=False, sort_keys=False)
    
    def _get_skill_instructions(
        self, 
        root_cause: RootCause, 
        skill_target: SkillTarget, 
        defect_desc: str
    ) -> str:
        """Generate instructions for the skill."""
        
        if skill_target == SkillTarget.CORTEX_AGENT:
            return f"""
Invoke $cortex-agent skill in DEBUG mode:
1. Target: {self.AGENT_DATABASE}.{self.AGENT_SCHEMA}.{self.AGENT_NAME}
2. Issue: {defect_desc}
3. Check agent_spec_v5.yaml for instruction issues
4. Redeploy with ALTER AGENT after fix
"""
        
        elif skill_target == SkillTarget.SEMANTIC_VIEW:
            return f"""
Invoke $semantic-view skill in DEBUG mode:
1. Target: {self.SEMANTIC_VIEW}
2. Backing table: SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS
3. Issue: {defect_desc}
4. Add missing synonyms to map user terms to component types
"""
        
        elif skill_target == SkillTarget.LANE_LAYOUT_DEBUGGER:
            return f"""
Invoke $lane-layout-debugger skill:
1. Issue: {defect_desc}
2. Check elkLayout.ts for layout algorithm issues
3. Check mermaidToReactFlow.ts for node positioning
4. Reference: backend/tests/visual/reference_images/reference_page4.png
"""
        
        elif skill_target == SkillTarget.DIRECT_FIX:
            return f"""
Apply direct fix to Mermaid template:
1. Issue: {defect_desc}
2. Template: mermaid_templates/streaming_data_stack.mmd
3. Use SkillTrigger._fix_badges() or _fix_styling() patterns
"""
        
        else:
            return f"""
Invoke $snowgram-debugger skill:
1. Issue: {defect_desc}
2. Use SWE-bench pattern: EXPLORE → REPRODUCE → LOCATE → FIX → VERIFY
"""
    
    # ========================================================================
    # MAIN LOOP
    # ========================================================================
    
    async def run_single_iteration(self) -> Tuple[EvalResult, str]:
        """
        Run a single iteration of the convergence loop.
        
        Returns: (eval_result, yaml_output)
        """
        self.state.iteration += 1
        self._log_activity(f"=== ITERATION {self.state.iteration} START ===")
        
        print(f"\n{'='*70}")
        print(f"ITERATION {self.state.iteration}: Unified Convergence Loop")
        print(f"{'='*70}")
        
        # Step 1: Invoke agent
        print("\n[1/5] Invoking Cortex Agent...")
        agent_response = await self.invoke_agent(self.test_prompt)
        
        if agent_response.get("error"):
            print(f"  ✗ Agent error: {agent_response['error']}")
            # Continue with template-only evaluation
        else:
            components = agent_response.get("components", [])
            print(f"  ✓ Agent returned {len(components)} components")
            for c in components[:5]:
                # Handle both string and dict formats
                if isinstance(c, str):
                    print(f"    - {c}")
                else:
                    print(f"    - {c.get('component_name', c.get('component_id', 'unknown'))}")
        
        # Step 2: Render via React Flow frontend (NOT Mermaid CLI)
        print("\n[2/5] Rendering via React Flow frontend...")
        generated_image = await self.render_in_frontend(self.test_prompt)
        
        if not generated_image:
            print("  ✗ Render failed - using placeholder evaluation")
            # Create minimal eval result
            eval_result = EvalResult(
                pass_results={},
                overall_score=0.0,
                converged=False,
                iteration=self.state.iteration
            )
        else:
            print(f"  ✓ Rendered to {generated_image.name}")
            
            # Step 3: Visual evaluation
            print("\n[3/5] Running 6-pass visual evaluation...")
            eval_result = await self.evaluate_visual(generated_image)
            
            print(f"\n  Pass Scores:")
            for pass_name, pass_result in eval_result.pass_results.items():
                threshold = self.PASS_THRESHOLDS.get(pass_name, 80)
                status = "✓" if pass_result.score >= threshold else "✗"
                print(f"    {status} {pass_name.title()}: {pass_result.score:.1f}% (threshold: {threshold}%)")
            
            print(f"\n  Overall: {eval_result.overall_score:.1f}% (target: {self.TARGET_SCORE}%)")
        
        # Step 4: Diagnose
        print("\n[4/5] Diagnosing root cause...")
        root_cause, skill_target, defect_desc = self.diagnose_root_cause(eval_result)
        print(f"  Root cause: {root_cause.value}")
        print(f"  Skill: ${skill_target.value}")
        print(f"  Defect: {defect_desc}")
        
        # Step 5: Output YAML
        print("\n[5/5] Generating CoCo action YAML...")
        yaml_output = self.output_coco_yaml(root_cause, skill_target, defect_desc, eval_result)
        
        # Update state
        self.state.scores = {
            name: pr.score for name, pr in eval_result.pass_results.items()
        }
        self.state.scores["overall"] = eval_result.overall_score
        self.state.converged = eval_result.overall_score >= self.TARGET_SCORE
        self.state.last_action = f"Diagnosed {root_cause.value} → ${skill_target.value}"
        
        # Update progress.md
        self._update_progress(self.state.scores)
        
        self._log_activity(f"=== ITERATION {self.state.iteration} END (score: {eval_result.overall_score:.1f}%) ===")
        
        return eval_result, yaml_output
    
    async def run(self) -> bool:
        """
        Run the full convergence loop until success or max iterations.
        
        Returns True if converged, False otherwise.
        """
        print("="*70)
        print("RALPH-STYLE UNIFIED CONVERGENCE LOOP")
        print("="*70)
        print(f"Target Score: {self.TARGET_SCORE}%")
        print(f"Max Iterations: {self.MAX_ITERATIONS}")
        print(f"Gutter Threshold: {self.GUTTER_THRESHOLD}x same failure")
        print(f"Test Prompt: {self.test_prompt}")
        print("="*70)
        
        # Load existing guardrails
        self.state.guardrails = self._load_guardrails()
        if self.state.guardrails:
            print(f"\nLoaded {len(self.state.guardrails)} guardrails from previous runs")
        
        for _ in range(self.MAX_ITERATIONS):
            eval_result, yaml_output = await self.run_single_iteration()
            
            print("\n" + "-"*70)
            print("ACTION YAML FOR COCO:")
            print("-"*70)
            print(yaml_output)
            
            if self.state.converged:
                print("\n" + "="*70)
                print("✓ CONVERGED!")
                print(f"Final Score: {eval_result.overall_score:.1f}%")
                print(f"Iterations: {self.state.iteration}")
                print(f"Guardrails accumulated: {len(self.state.guardrails)}")
                print("="*70)
                return True
            
            print(f"\nIteration {self.state.iteration} complete. Score: {eval_result.overall_score:.1f}%")
            print("Waiting for CoCo to apply fix before next iteration...")
            
            # In real usage, CoCo would invoke the skill here
            # For testing, we just continue to next iteration
            await asyncio.sleep(1)
        
        print("\n" + "="*70)
        print("✗ MAX ITERATIONS REACHED WITHOUT CONVERGENCE")
        print(f"Final Score: {self.state.scores.get('overall', 0):.1f}%")
        print(f"Guardrails accumulated: {len(self.state.guardrails)}")
        print("="*70)
        
        return False


async def main():
    """Run the unified convergence loop."""
    loop = UnifiedConvergenceLoop()
    success = await loop.run()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
