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
    AGENT_TOOL_USAGE = "agent_tool_usage"  # → $cortex-agent OPTIMIZE mode (Enhancement 7)
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
    
    # Score thresholds per pass - STRICT thresholds to catch visual quality issues
    # Raised 2024-02-24 after analysis showed 97.5% score missing truncated labels,
    # wrong badge labels, UI artifacts, tangled connections, boundary overlap
    PASS_THRESHOLDS = {
        "components": 95,   # Was 90 - require near-perfect component coverage
        "connections": 90,  # Was 85 - stricter flow validation  
        "layout": 85,       # Was 70 - MAJOR increase, catch layout chaos
        "badges": 95,       # Was 90 - require correct positioning AND labels
        "styling": 85,      # Was 80 - slightly stricter
        "structure": 85,    # Was 80 - require all subgraphs, no artifacts
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
        RootCause.AGENT_TOOL_USAGE: SkillTarget.CORTEX_AGENT,  # OPTIMIZE mode (Enhancement 7)
        RootCause.SEMANTIC_VIEW: SkillTarget.SEMANTIC_VIEW,
        RootCause.FRONTEND_CODE: SkillTarget.LANE_LAYOUT_DEBUGGER,
        RootCause.MERMAID_TEMPLATE: SkillTarget.DIRECT_FIX,
        RootCause.UNKNOWN: SkillTarget.SNOWGRAM_DEBUGGER,
    }
    
    # External tools that should trigger WEB_SEARCH usage (Enhancement 6)
    EXTERNAL_TOOL_KEYWORDS = ['kafka', 'dbt', 'tableau', 'airflow', 'databricks', 'fivetran', 
                              'spark', 'flink', 'confluent', 'debezium', 'azure data factory']
    
    # Repository context map for better localization (Enhancement 3 - from Aider)
    CONTEXT_MAP = """
## SnowGram Architecture Context

### Layout Files (for badge/position issues)
- `frontend/src/lib/elkLayout.ts` - ELK layout algorithm, badge zIndex, margins
- `frontend/src/lib/mermaidToReactFlow.ts` - Mermaid parsing, node creation

### Agent Files (for component/structure issues)  
- `agent_spec_v5.yaml` - Agent instructions, tool definitions
- `SNOWGRAM_DB.CORE.COMPONENT_MAP_SV` - Semantic view for component resolution

### Agent Tools (native Snowflake capabilities)
- SNOWFLAKE_DOCS_CKE - 41,000+ pages of Snowflake docs
- WEB_SEARCH - Native web search for external tools (dbt, Kafka, Tableau)
- SUGGEST_COMPONENTS_FOR_USE_CASE - Component resolution

### Reference Architecture
- Purple badges (1a-1d): Horizontal lanes, LEFT edge (x < 30% of canvas)
- Blue badges (2-5): Processing sections, CENTER area (25%-75% of canvas)
- Boundaries: Producer App (left), In-app Analytics (right)
"""
    
    # Annotation context for streaming architecture badges
    # This maps badge IDs to their semantic meaning in the reference architecture
    # Used to provide context to the Cortex Agent during feedback iterations
    STREAMING_BADGE_ANNOTATIONS = {
        "1a": {
            "label": "Kafka Connector Path",
            "description": "Kafka → Snowflake Connector for Kafka ingestion path",
            "position_hint": "top of external data sources, left edge of diagram",
            "color": "purple (lane marker)",
        },
        "1b": {
            "label": "CSP Streaming with Java SDK",
            "description": "Cloud service provider streaming using Java SDK for Snowpipe Streaming",
            "position_hint": "second from top in external sources, left edge",
            "color": "purple (lane marker)",
        },
        "1c": {
            "label": "Batch to Blob Store",
            "description": "Batch ingestion to blob store via CSP services",
            "position_hint": "third from top in external sources, left edge",
            "color": "purple (lane marker)",
        },
        "1d": {
            "label": "Native Connector",
            "description": "Snowflake Native Connector for third-party data integration",
            "position_hint": "fourth from top in external sources, left edge",
            "color": "purple (lane marker)",
        },
        "2": {
            "label": "Snowpipe Streaming Ingestion",
            "description": "Snowflake ingests data via Snowpipe Streaming",
            "position_hint": "at Snowflake boundary where data enters the platform",
            "color": "blue (section marker)",
        },
        "3": {
            "label": "Streams and Tasks",
            "description": "Transformation layer using Streams and Tasks",
            "position_hint": "center of Snowflake processing area",
            "color": "blue (section marker)",
        },
        "4": {
            "label": "Dynamic Tables",
            "description": "Simplified transformation using Dynamic Tables",
            "position_hint": "after Streams/Tasks in processing flow",
            "color": "blue (section marker)",
        },
        "5": {
            "label": "Python/Snowpark Processing",
            "description": "Python stored procedures or Snowpark for advanced processing",
            "position_hint": "right side of Snowflake processing, before outputs",
            "color": "blue (section marker)",
        },
    }
    
    def __init__(self, connection_name: str = "se_demo"):
        self.connection_name = connection_name
        self.base_dir = Path(__file__).parent.parent.parent
        self.ralph_dir = Path(__file__).parent / ".ralph"
        self.output_dir = Path(__file__).parent / "visual" / "output"
        self.reference_image = Path(__file__).parent / "visual" / "reference_images" / "reference_page4.png"
        
        # State
        self.state = ConvergenceState()
        
        # Test prompt (base)
        self.test_prompt = "streaming architecture with Kafka ingestion"
        
        # Iteration feedback for enhanced prompts
        self.iteration_feedback: List[str] = []
        
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
    # ENHANCEMENT 1: PLAUSIBILITY FILTER (from Aider - saves 40% iterations)
    # ========================================================================
    
    def _is_plausibly_correct(self, mermaid_code: str) -> Tuple[bool, str]:
        """
        Quick sanity check before expensive evaluation.
        
        From Aider's SWE-bench approach: filter "implausible" outputs early
        to avoid wasting iterations on clearly broken outputs.
        
        Returns: (is_plausible, reason)
        """
        if not mermaid_code or not mermaid_code.strip():
            return False, "Empty mermaid code"
        
        checks = [
            (mermaid_code.strip().startswith(("flowchart", "graph")), 
             "Invalid mermaid header - must start with flowchart or graph"),
            (mermaid_code.count('["') + mermaid_code.count("['") + mermaid_code.count('(["') >= 3, 
             "Too few nodes (need at least 3)"),
            ("1a" in mermaid_code or "badge_1a" in mermaid_code or "badge" in mermaid_code.lower(), 
             "Missing badge definitions"),
            ("snowflake" in mermaid_code.lower() or "subgraph" in mermaid_code, 
             "Missing Snowflake subgraph"),
            (len(mermaid_code) > 100,  # Lowered from 300 - real outputs are typically 500+
             f"Output too short ({len(mermaid_code)} chars, need > 100)"),
        ]
        
        for passed, error in checks:
            if not passed:
                self._log_activity(f"Plausibility check failed: {error}")
                return False, error
        
        return True, "Plausible"
    
    # ========================================================================
    # ENHANCEMENT 4: DEFECT DEDUPLICATION (prevents false gutter detection)
    # ========================================================================
    
    def _normalize_defect(self, defect: str) -> str:
        """
        Normalize defect for consistent gutter detection.
        
        Same defect worded differently was causing false gutter detection.
        This normalizes defects so we can properly detect repeated failures.
        """
        # Remove specific numbers/percentages
        normalized = re.sub(r'\d+\.?\d*%?', 'N', defect.lower())
        # Remove file paths
        normalized = re.sub(r'/[\w/]+\.\w+', 'FILE', normalized)
        # Keep only key terms
        key_terms = ['badge', 'layout', 'node', 'edge', 'position', 'missing', 
                     'scattered', 'overlap', 'left', 'right', 'center', 'zone',
                     'purple', 'blue', 'coherence', 'chaos']
        words = [w for w in normalized.split() if w in key_terms]
        return ' '.join(sorted(set(words)))
    
    # ========================================================================
    # ENHANCEMENT 5: WARM START FROM PREVIOUS SUCCESS (faster convergence)
    # ========================================================================
    
    def _load_best_previous_state(self) -> Optional[str]:
        """
        Load mermaid from best previous iteration if score > 70%.
        
        If we got close before, start from that state instead of scratch.
        """
        best_file = self.ralph_dir / "best_mermaid.mmd"
        best_score_file = self.ralph_dir / "best_score.txt"
        
        if best_file.exists() and best_score_file.exists():
            try:
                score = float(best_score_file.read_text().strip())
                if score > 70:
                    self._log_activity(f"Warm starting from previous best: {score:.1f}%")
                    return best_file.read_text()
            except (ValueError, IOError):
                pass
        return None
    
    def _save_if_best(self, mermaid_code: str, score: float) -> None:
        """Save mermaid if it's the best so far."""
        best_score_file = self.ralph_dir / "best_score.txt"
        current_best = 0.0
        
        if best_score_file.exists():
            try:
                current_best = float(best_score_file.read_text().strip())
            except (ValueError, IOError):
                pass
        
        if score > current_best:
            (self.ralph_dir / "best_mermaid.mmd").write_text(mermaid_code)
            best_score_file.write_text(str(score))
            self._log_activity(f"Saved new best mermaid (score: {score:.1f}%, was: {current_best:.1f}%)")
    
    # ========================================================================
    # ENHANCEMENT 7: AGENT TOOL USAGE DETECTION
    # ========================================================================
    
    def _detect_tool_usage_failure(self, eval_result: EvalResult) -> bool:
        """
        Detect if agent should have used WEB_SEARCH but didn't.
        
        When component defects involve external tools (Kafka, dbt, etc.),
        the agent should be using WEB_SEARCH to find correct patterns.
        
        IMPORTANT: Does NOT trigger if the defects are visual/frontend issues
        (truncation, UI artifacts, layout) - those need frontend fixes, not agent changes.
        """
        component_result = eval_result.pass_results.get('components')
        structure_result = eval_result.pass_results.get('structure')
        
        if not component_result:
            return False
        
        # FIRST: Check if defects are visual/frontend issues - if so, DON'T override
        frontend_keywords = ['truncation', 'truncated', 'cut off', 'artifact', 
                            'ui element', 'selection highlight', 'overlap', 'tangled']
        
        all_defects = list(component_result.defects) + (list(structure_result.defects) if structure_result else [])
        for defect in all_defects:
            defect_lower = defect.lower()
            if any(kw in defect_lower for kw in frontend_keywords):
                # This is a frontend/visual issue, not an agent tool usage issue
                self._log_activity(f"Visual/frontend defect detected, not tool usage: {defect[:50]}...")
                return False
        
        # Only check for tool usage failures if no frontend defects
        for defect in component_result.defects:
            defect_lower = defect.lower()
            if any(kw in defect_lower for kw in self.EXTERNAL_TOOL_KEYWORDS):
                self._log_activity(f"Tool usage failure detected: external tool mentioned in defect: {defect[:50]}...")
                return True
        
        # Also check the test prompt for external tools
        prompt_lower = self.test_prompt.lower()
        if any(kw in prompt_lower for kw in self.EXTERNAL_TOOL_KEYWORDS):
            # External tool in prompt but low component score
            if component_result.score < 80:
                self._log_activity(f"Tool usage failure: external tool in prompt but low component score ({component_result.score:.1f}%)")
                return True
        
        return False
    
    def _build_enhanced_prompt(self, defects: List[str] = None) -> str:
        """
        Build feedback-enhanced prompt for the Cortex Agent.
        
        On iteration 1: returns base prompt
        On iteration 2+: includes feedback from previous iteration defects
        
        Enhancement 6: Now includes hints to use WEB_SEARCH for external tools
        and SNOWFLAKE_DOCS_CKE for Snowflake-native issues.
        """
        base_prompt = self.test_prompt
        
        # First iteration - no feedback yet
        if self.state.iteration <= 1 or not self.iteration_feedback:
            return base_prompt
        
        # Build feedback section from accumulated defects
        feedback_lines = []
        for feedback in self.iteration_feedback[-3:]:  # Last 3 feedback items
            feedback_lines.append(f"- {feedback}")
        
        if not feedback_lines:
            return base_prompt
        
        # Enhanced prompt with feedback
        enhanced = f"""{base_prompt}

IMPORTANT LAYOUT FEEDBACK from previous iteration:
{chr(10).join(feedback_lines)}

Please ensure the generated diagram addresses these layout issues:
- Purple lane badges (1a-1d) must be vertically stacked on the LEFT edge
- Blue section badges (2-5) must appear at their corresponding Snowflake processing stages
- All components should be visible without clipping at edges"""
        
        # Enhancement 6: Detect external tool issues and add WEB_SEARCH hint
        external_tool_issues = [f for f in self.iteration_feedback 
                               if any(t in f.lower() for t in self.EXTERNAL_TOOL_KEYWORDS)]
        
        if external_tool_issues:
            enhanced += """

NOTE: For external tool integrations (Kafka, dbt, Tableau, etc.), use your WEB_SEARCH tool 
to find current best practices and integration patterns.
Example: WEB_SEARCH("Kafka Snowpipe Streaming integration architecture 2025")"""
        
        # Detect Snowflake-native issues and add CKE hint
        snowflake_keywords = ['snowpipe', 'dynamic table', 'stream', 'task', 'stage', 'warehouse']
        snowflake_issues = [f for f in self.iteration_feedback 
                           if any(t in f.lower() for t in snowflake_keywords)]
        
        if snowflake_issues:
            enhanced += """

NOTE: For Snowflake component questions, use SNOWFLAKE_DOCS_CKE to verify correct patterns.
Example: SNOWFLAKE_DOCS_CKE("dynamic tables vs streams best practices")"""
        
        return enhanced
    
    def _extract_defects_for_feedback(self, eval_result) -> List[str]:
        """
        Extract actionable defects from evaluation result for feedback loop.
        Focuses on badge and layout issues that the agent can influence.
        """
        feedback = []
        
        for pass_name, pass_result in eval_result.pass_results.items():
            if pass_name in ["badges", "layout"] and pass_result.defects:
                for defect in pass_result.defects[:2]:  # Top 2 defects per pass
                    # Clean up defect for feedback (remove "VISUAL:" prefix)
                    clean = defect.replace("VISUAL: ", "").replace("CODE: ", "")
                    feedback.append(clean)
        
        return feedback
    
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
                
                # Hide interactive UI elements before screenshot capture
                await page.evaluate("""
                    // Hide zoom controls, minimap, and panels
                    const hideSelectors = [
                        '.react-flow__controls',
                        '.react-flow__minimap', 
                        '[class*="panelActions"]',
                        '[class*="instructionsPanel"]',
                        '[class*="emptyPanel"]'
                    ];
                    hideSelectors.forEach(sel => {
                        document.querySelectorAll(sel).forEach(el => {
                            el.style.display = 'none';
                        });
                    });
                    // Also add export-mode class for any CSS-based hiding
                    document.body.classList.add('export-mode');
                    const rf = document.querySelector('.react-flow');
                    if (rf) rf.classList.add('export-mode');
                """)
                await page.wait_for_timeout(200)  # Let changes take effect
                
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
        
        Enhanced with:
        - Enhancement 4: Defect deduplication for gutter detection
        - Enhancement 7: Agent tool usage failure detection
        - FIX: Identify bottleneck even when all thresholds pass but overall < target
        
        Returns: (root_cause, skill_to_invoke, defect_description)
        """
        # Enhancement 7: Check for agent tool usage failures FIRST
        if self._detect_tool_usage_failure(eval_result):
            return (
                RootCause.AGENT_TOOL_USAGE,
                SkillTarget.CORTEX_AGENT,
                "Agent not leveraging WEB_SEARCH or SNOWFLAKE_DOCS_CKE for external tool patterns"
            )
        
        # Find lowest scoring pass below threshold
        failing_passes = []
        
        for pass_name, pass_result in eval_result.pass_results.items():
            threshold = self.PASS_THRESHOLDS.get(pass_name, 80)
            if pass_result.score < threshold:
                failing_passes.append((pass_name, pass_result.score, pass_result.defects))
        
        # FIX: If no failing passes but overall score < target, find the bottleneck
        if not failing_passes and eval_result.overall_score < self.TARGET_SCORE:
            # Find the pass with most room for improvement (lowest score relative to 100%)
            all_passes = []
            for pass_name, pass_result in eval_result.pass_results.items():
                gap_to_perfect = 100 - pass_result.score
                all_passes.append((pass_name, pass_result.score, pass_result.defects, gap_to_perfect))
            
            if all_passes:
                # Sort by gap to perfect (largest gap first = most room for improvement)
                all_passes.sort(key=lambda x: -x[3])
                bottleneck_pass, bottleneck_score, defects, gap = all_passes[0]
                
                root_cause = self.ROOT_CAUSE_MAP.get(bottleneck_pass, RootCause.UNKNOWN)
                skill = self.SKILL_MAP.get(root_cause, SkillTarget.SNOWGRAM_DEBUGGER)
                
                defect_desc = (
                    f"BOTTLENECK: {bottleneck_pass} at {bottleneck_score:.1f}% "
                    f"(threshold met, but {gap:.1f}% gap to perfect). "
                    f"Overall {eval_result.overall_score:.1f}% < {self.TARGET_SCORE}% target"
                )
                
                if defects:
                    defect_desc += f". Defects: {defects[0]}"
                
                self._log_activity(f"Bottleneck identified: {bottleneck_pass} ({gap:.1f}% improvement potential)")
                return root_cause, skill, defect_desc
        
        if not failing_passes:
            return RootCause.UNKNOWN, SkillTarget.DIRECT_FIX, "No failures detected"
        
        # Sort by severity (lowest score first)
        failing_passes.sort(key=lambda x: x[1])
        
        worst_pass, worst_score, defects = failing_passes[0]
        
        # Map to root cause (default based on pass name)
        root_cause = self.ROOT_CAUSE_MAP.get(worst_pass, RootCause.UNKNOWN)
        
        # OVERRIDE: Check if defects indicate frontend/visual issues
        # These need frontend code fixes, not agent/semantic view changes
        frontend_defect_keywords = ['truncation', 'truncated', 'cut off', 'artifact', 
                                    'ui element', 'selection highlight', 'overlap', 
                                    'tangled', 'boundary overlap', 'visual']
        
        raw_defect = defects[0] if defects else ''
        defect_lower = raw_defect.lower()
        
        if any(kw in defect_lower for kw in frontend_defect_keywords):
            # Override to frontend code regardless of which pass failed
            self._log_activity(f"Visual defect detected in {worst_pass}, routing to FRONTEND_CODE: {raw_defect[:50]}...")
            root_cause = RootCause.FRONTEND_CODE
        
        # Enhancement 4: Use normalized defect key for gutter detection
        normalized_defect = self._normalize_defect(raw_defect)
        defect_key = f"{worst_pass}:{normalized_defect}"
        
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
    
    def _format_badge_annotation_context(self, defect_desc: str) -> str:
        """
        Extract relevant badge annotations based on defect description.
        Returns formatted context string for feedback to Cortex Agent.
        """
        context_lines = []
        defect_lower = defect_desc.lower()
        
        # Check which badges are mentioned in the defect
        for badge_id, annotation in self.STREAMING_BADGE_ANNOTATIONS.items():
            # Match badge references like "1a", "badge 1a", "Badge_1A"
            if badge_id.lower() in defect_lower or f"badge_{badge_id}".lower() in defect_lower:
                context_lines.append(
                    f"  - Badge {badge_id.upper()}: {annotation['label']}\n"
                    f"    Purpose: {annotation['description']}\n"
                    f"    Expected position: {annotation['position_hint']}\n"
                    f"    Color: {annotation['color']}"
                )
        
        # If no specific badges found but it's a badge-related issue, provide all context
        if not context_lines and ("badge" in defect_lower or "lane" in defect_lower or "section" in defect_lower):
            context_lines.append("  Purple lane badges (1a-1d) - left edge, marking external data source lanes:")
            for badge_id in ["1a", "1b", "1c", "1d"]:
                ann = self.STREAMING_BADGE_ANNOTATIONS[badge_id]
                context_lines.append(f"    - {badge_id.upper()}: {ann['label']} → {ann['position_hint']}")
            
            context_lines.append("\n  Blue section badges (2-5) - marking Snowflake processing sections:")
            for badge_id in ["2", "3", "4", "5"]:
                ann = self.STREAMING_BADGE_ANNOTATIONS[badge_id]
                context_lines.append(f"    - {badge_id}: {ann['label']} → {ann['position_hint']}")
        
        if context_lines:
            return "\n\nBadge Annotation Context (from reference architecture):\n" + "\n".join(context_lines)
        return ""
    
    def _get_skill_instructions(
        self, 
        root_cause: RootCause, 
        skill_target: SkillTarget, 
        defect_desc: str
    ) -> str:
        """Generate instructions for the skill with annotation-aware feedback."""
        
        # Get badge annotation context if relevant
        badge_context = self._format_badge_annotation_context(defect_desc)
        
        if skill_target == SkillTarget.CORTEX_AGENT:
            # Enhancement 7: Different instructions for AGENT_TOOL_USAGE vs AGENT_SPEC
            if root_cause == RootCause.AGENT_TOOL_USAGE:
                return f"""
Invoke $cortex-agent skill in OPTIMIZE mode:

**Issue**: {defect_desc}

**Root Cause**: Agent is not leveraging its native tools (WEB_SEARCH, SNOWFLAKE_DOCS_CKE) 
for external tool integrations. This causes incorrect or incomplete component generation.

**Action Required**:
1. Update agent_spec_v5.yaml to emphasize WEB_SEARCH usage:
   - Add explicit instruction: "For Kafka/dbt/Tableau/Airflow patterns, call WEB_SEARCH FIRST"
   - Add examples in instructions showing when to use each tool
   
2. Update tool descriptions to be clearer:
   - WEB_SEARCH: "ALWAYS use for non-Snowflake tools (Kafka, dbt, Tableau, Airflow, Databricks)"
   - SNOWFLAKE_DOCS_CKE: "Use for Snowflake-native features and best practices"

3. Redeploy with: ALTER AGENT {self.AGENT_DATABASE}.{self.AGENT_SCHEMA}.{self.AGENT_NAME} 
   SET SPECIFICATION = @stage/agent_spec_v5.yaml

**Context Map**:
{self.CONTEXT_MAP}
"""
            else:
                return f"""
Invoke $cortex-agent skill in DEBUG mode:
1. Target: {self.AGENT_DATABASE}.{self.AGENT_SCHEMA}.{self.AGENT_NAME}
2. Issue: {defect_desc}
3. Check agent_spec_v5.yaml for instruction issues
4. Redeploy with ALTER AGENT after fix
{badge_context}

IMPORTANT: The agent should generate mermaid that places badges correctly based on the 
architectural flow. Do NOT hardcode positions - let the layout algorithm handle placement,
but ensure the mermaid structure supports proper badge association with components.
"""
        
        elif skill_target == SkillTarget.SEMANTIC_VIEW:
            return f"""
Invoke $semantic-view skill in DEBUG mode:
1. Target: {self.SEMANTIC_VIEW}
2. Backing table: SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS
3. Issue: {defect_desc}
4. Add missing synonyms to map user terms to component types
{badge_context}
"""
        
        elif skill_target == SkillTarget.LANE_LAYOUT_DEBUGGER:
            return f"""
Invoke $lane-layout-debugger skill:
1. Issue: {defect_desc}
2. Check elkLayout.ts for layout algorithm issues
3. Check mermaidToReactFlow.ts for node positioning
4. Reference: backend/tests/visual/reference_images/reference_page4.png
{badge_context}

Layout expectations for streaming architecture:
- External sources (Kafka, CSP, Blob, Connectors) should be on LEFT
- Snowflake processing (Snowpipe, Streams, Dynamic Tables) in CENTER
- Outputs (Analytics, ML, Apps) on RIGHT
- Purple badges mark horizontal lanes (left edge)
- Blue badges mark processing sections (center area)
"""
        
        elif skill_target == SkillTarget.DIRECT_FIX:
            return f"""
Apply direct fix to Mermaid template:
1. Issue: {defect_desc}
2. Template: mermaid_templates/streaming_data_stack.mmd
3. Use SkillTrigger._fix_badges() or _fix_styling() patterns
{badge_context}

NOTE: Fixes should guide the Cortex Agent to generate correct structure,
not hardcode component positions. The layout algorithm handles positioning.
"""
        
        else:
            return f"""
Invoke $snowgram-debugger skill:
1. Issue: {defect_desc}
2. Use SWE-bench pattern: EXPLORE → REPRODUCE → LOCATE → FIX → VERIFY
{badge_context}
"""
    
    # ========================================================================
    # MAIN LOOP
    # ========================================================================
    
    async def run_single_iteration(self) -> Tuple[EvalResult, str]:
        """
        Run a single iteration of the convergence loop.
        
        Enhanced with:
        - Enhancement 1: Plausibility check before expensive evaluation
        - Enhancement 5: Save best mermaid for warm start
        
        Returns: (eval_result, yaml_output)
        """
        self.state.iteration += 1
        self._log_activity(f"=== ITERATION {self.state.iteration} START ===")
        
        print(f"\n{'='*70}")
        print(f"ITERATION {self.state.iteration}: Unified Convergence Loop (Enhanced)")
        print(f"{'='*70}")
        
        # Build enhanced prompt with feedback from previous iterations
        enhanced_prompt = self._build_enhanced_prompt()
        if self.state.iteration > 1 and self.iteration_feedback:
            print(f"\n[0/6] Using feedback-enhanced prompt ({len(self.iteration_feedback)} feedback items)")
        
        # Step 1: Invoke agent with enhanced prompt
        print("\n[1/6] Invoking Cortex Agent...")
        agent_response = await self.invoke_agent(enhanced_prompt)
        
        mermaid_code = None
        if agent_response.get("error"):
            print(f"  ✗ Agent error: {agent_response['error']}")
            # Continue with template-only evaluation
        else:
            components = agent_response.get("components", [])
            mermaid_code = agent_response.get("mermaid_code", "")
            print(f"  ✓ Agent returned {len(components)} components")
            for c in components[:5]:
                # Handle both string and dict formats
                if isinstance(c, str):
                    print(f"    - {c}")
                else:
                    print(f"    - {c.get('component_name', c.get('component_id', 'unknown'))}")
        
        # Enhancement 1: Plausibility check BEFORE expensive rendering
        print("\n[2/6] Plausibility check (Enhancement 1)...")
        if mermaid_code:
            is_plausible, plausibility_reason = self._is_plausibly_correct(mermaid_code)
            if not is_plausible:
                print(f"  ✗ Implausible output: {plausibility_reason}")
                print(f"  → Skipping expensive render/eval, creating retry result")
                
                # Create minimal eval result for implausible output
                eval_result = EvalResult(
                    pass_results={
                        "structure": PassResult(pass_type=EvalPass.STRUCTURE, score=0, 
                                               defects=[f"Implausible: {plausibility_reason}"]),
                    },
                    overall_score=0.0,
                    converged=False,
                    iteration=self.state.iteration
                )
                
                # Still diagnose and output YAML
                root_cause, skill_target, defect_desc = self.diagnose_root_cause(eval_result)
                yaml_output = self.output_coco_yaml(root_cause, skill_target, 
                                                    f"Implausible output: {plausibility_reason}", eval_result)
                
                self._log_activity(f"=== ITERATION {self.state.iteration} END (implausible, score: 0%) ===")
                return eval_result, yaml_output
            else:
                print(f"  ✓ Output is plausible")
        else:
            print(f"  ⚠ No mermaid code to check")
        
        # Step 3: Render via React Flow frontend (NOT Mermaid CLI)
        print("\n[3/6] Rendering via React Flow frontend...")
        generated_image = await self.render_in_frontend(enhanced_prompt)
        
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
            
            # Step 4: Visual evaluation
            print("\n[4/6] Running 6-pass visual evaluation...")
            eval_result = await self.evaluate_visual(generated_image)
            
            print(f"\n  Pass Scores:")
            for pass_name, pass_result in eval_result.pass_results.items():
                threshold = self.PASS_THRESHOLDS.get(pass_name, 80)
                status = "✓" if pass_result.score >= threshold else "✗"
                print(f"    {status} {pass_name.title()}: {pass_result.score:.1f}% (threshold: {threshold}%)")
            
            print(f"\n  Overall: {eval_result.overall_score:.1f}% (target: {self.TARGET_SCORE}%)")
            
            # Enhancement 5: Save if this is the best result so far
            if mermaid_code and eval_result.overall_score > 0:
                self._save_if_best(mermaid_code, eval_result.overall_score)
            
            # Extract defects for next iteration feedback
            new_feedback = self._extract_defects_for_feedback(eval_result)
            if new_feedback:
                self.iteration_feedback.extend(new_feedback)
                print(f"\n  Collected {len(new_feedback)} feedback items for next iteration")
        
        # Step 5: Diagnose
        print("\n[5/6] Diagnosing root cause...")
        root_cause, skill_target, defect_desc = self.diagnose_root_cause(eval_result)
        print(f"  Root cause: {root_cause.value}")
        print(f"  Skill: ${skill_target.value}")
        print(f"  Defect: {defect_desc}")
        
        # Step 6: Output YAML
        print("\n[6/6] Generating CoCo action YAML...")
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
        
        AUTONOMOUS EXECUTION:
        - Diagnoses issues
        - Automatically invokes appropriate skill/fix
        - Re-evaluates and continues until convergence
        
        Returns True if converged, False otherwise.
        """
        print("="*70)
        print("RALPH-STYLE UNIFIED CONVERGENCE LOOP (AUTONOMOUS)")
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
            print("DIAGNOSIS:")
            print("-"*70)
            
            if self.state.converged:
                print("\n" + "="*70)
                print("✓ CONVERGED!")
                print(f"Final Score: {eval_result.overall_score:.1f}%")
                print(f"Iterations: {self.state.iteration}")
                print(f"Guardrails accumulated: {len(self.state.guardrails)}")
                print("="*70)
                return True
            
            # AUTONOMOUS FIX EXECUTION
            print(f"\n[AUTO-FIX] Applying fix for iteration {self.state.iteration}...")
            fix_applied = await self._apply_autonomous_fix(eval_result)
            
            if fix_applied:
                print(f"[AUTO-FIX] ✓ Fix applied, continuing to next iteration...")
            else:
                print(f"[AUTO-FIX] ⚠ No fix available, continuing anyway...")
            
            # Small delay before next iteration
            await asyncio.sleep(0.5)
        
        print("\n" + "="*70)
        print("✗ MAX ITERATIONS REACHED WITHOUT CONVERGENCE")
        print(f"Final Score: {self.state.scores.get('overall', 0):.1f}%")
        print(f"Guardrails accumulated: {len(self.state.guardrails)}")
        print("="*70)
        
        return False
    
    async def _apply_autonomous_fix(self, eval_result: EvalResult) -> bool:
        """
        Autonomously apply fixes based on evaluation results.
        
        Uses SkillTrigger to determine and execute appropriate fixes.
        Captures feedback/guidance for next iteration.
        
        Returns True if a fix was applied, False otherwise.
        """
        try:
            # Use SkillTrigger to determine and apply fixes
            trigger = SkillTrigger(eval_result)
            actions = await trigger.determine_actions(target_score=self.TARGET_SCORE)
            
            if not actions:
                self._log_activity("No fix actions determined by SkillTrigger")
                return False
            
            # Log the actions being taken
            for action in actions:
                self._log_activity(f"Fix action: {action.action_type} for {action.target_pass} - {action.description}")
                print(f"  → {action.action_type}: {action.description}")
            
            # Execute the fixes
            results = await trigger.execute_fixes()
            
            # Capture any layout guidance for next iteration
            for pass_name, result in results.items():
                if result.get("layout_guidance"):
                    guidance = result["layout_guidance"]
                    self._log_activity(f"Layout guidance captured: {len(guidance)} chars")
                    # Add guidance to iteration feedback for next prompt
                    self.iteration_feedback.append(f"LAYOUT_FIX: {guidance}")
                    print(f"  → Layout guidance added to next iteration prompt")
            
            # Check if any fixes were successful
            success_count = sum(1 for r in results.values() if r.get("success", False))
            self._log_activity(f"Applied {success_count}/{len(results)} fixes successfully")
            
            return success_count > 0
            
        except Exception as e:
            self._log_activity(f"Error applying autonomous fix: {e}")
            print(f"  ✗ Error: {e}")
            return False


async def main():
    """Run the unified convergence loop."""
    loop = UnifiedConvergenceLoop()
    success = await loop.run()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
