#!/usr/bin/env python3
"""
Skill Auto-Triggers for Visual Evaluation Loop
===============================================

Automatically triggers appropriate skills/fixes based on evaluation
pass scores. Integrates with Snowflake docs for best practices.

Trigger Matrix:
    Layout < 70%     → $lane-layout-debugger
    Badges < 90%     → Fix badge positioning
    Components < 90% → Search Snowflake docs for missing components
    Styling < 80%    → Update classDef from reference
    Connections < 85%→ Fix edge routing

Usage:
    from skill_triggers import SkillTrigger
    
    trigger = SkillTrigger(eval_result)
    actions = await trigger.determine_actions()
    await trigger.execute_fixes()
"""

import asyncio
import re
from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Callable
from pathlib import Path

# Import eval_passes types
try:
    from .eval_passes import EvalResult, PassResult, EvalPass
except ImportError:
    from eval_passes import EvalResult, PassResult, EvalPass


@dataclass
class FixAction:
    """Represents a fix action to be taken"""
    target_pass: str
    action_type: str  # 'skill', 'code_fix', 'template_update', 'docs_search'
    description: str
    priority: int  # 1 = highest
    params: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.params is None:
            self.params = {}


class SkillTrigger:
    """
    Determines and executes skill triggers based on evaluation results.
    
    Integrates with:
    - Cortex Skills ($lane-layout-debugger, etc.)
    - Snowflake docs search for best practices
    - Direct code fixes for template issues
    """
    
    # Score thresholds for triggering fixes
    THRESHOLDS = {
        "layout": 70,
        "badges": 90,
        "components": 90,
        "styling": 80,
        "connections": 85,
        "structure": 80,
    }
    
    # Skill mappings for each pass type
    SKILL_MAPPINGS = {
        "layout": {
            "skill": "lane-layout-debugger",
            "description": "Debug lane/section layout issues",
            "docs_query": "architecture diagram horizontal lanes sections layout"
        },
        "badges": {
            "skill": None,  # Direct code fix
            "description": "Fix badge positioning via invisible connections",
            "docs_query": "mermaid badge positioning subgraph"
        },
        "components": {
            "skill": None,
            "description": "Add missing Snowflake components",
            "docs_query": "streaming architecture kafka snowpipe dynamic tables components"
        },
        "styling": {
            "skill": None,
            "description": "Update classDef colors to match reference",
            "docs_query": "mermaid styling classDef colors theming"
        },
        "connections": {
            "skill": None,
            "description": "Fix edge routing and flow labels",
            "docs_query": "data flow diagram edge labels arrows connections"
        },
        "structure": {
            "skill": None,
            "description": "Fix subgraph hierarchy and boundaries",
            "docs_query": "snowflake architecture boundaries subgraph hierarchy"
        }
    }
    
    def __init__(
        self,
        eval_result: EvalResult,
        mermaid_code: Optional[str] = None,
        template_path: Optional[str] = None
    ):
        self.eval_result = eval_result
        self.mermaid_code = mermaid_code
        self.template_path = template_path
        self.actions: List[FixAction] = []
        
    async def determine_actions(self, target_score: float = 95.0) -> List[FixAction]:
        """
        Analyze evaluation result and determine required fix actions.
        
        Args:
            target_score: Overall target score (default 95%). Used for bottleneck detection.
        
        Returns:
            List of FixAction objects sorted by priority
        """
        self.actions = []
        
        # First, check for passes below their individual thresholds
        for pass_name, pass_result in self.eval_result.pass_results.items():
            threshold = self.THRESHOLDS.get(pass_name, 80)
            
            if pass_result.score < threshold:
                action = self._create_action_for_pass(pass_name, pass_result)
                if action:
                    self.actions.append(action)
        
        # If no failing passes but overall score < target, find bottleneck
        if not self.actions and self.eval_result.overall_score < target_score:
            # Find pass with most room for improvement
            bottleneck_pass = None
            bottleneck_gap = 0
            bottleneck_result = None
            
            for pass_name, pass_result in self.eval_result.pass_results.items():
                gap = 100 - pass_result.score
                if gap > bottleneck_gap:
                    bottleneck_gap = gap
                    bottleneck_pass = pass_name
                    bottleneck_result = pass_result
            
            if bottleneck_pass and bottleneck_result:
                action = self._create_action_for_pass(bottleneck_pass, bottleneck_result, is_bottleneck=True)
                if action:
                    action.description = f"BOTTLENECK: {action.description} ({bottleneck_gap:.0f}% improvement potential)"
                    self.actions.append(action)
        
        # Sort by priority (lowest score = highest priority)
        self.actions.sort(key=lambda a: a.priority)
        
        return self.actions
    
    def _create_action_for_pass(
        self, 
        pass_name: str, 
        pass_result: PassResult,
        is_bottleneck: bool = False
    ) -> Optional[FixAction]:
        """Create appropriate fix action for a failing pass"""
        
        mapping = self.SKILL_MAPPINGS.get(pass_name)
        if not mapping:
            return None
        
        # Priority based on score (lower score = higher priority)
        priority = int((100 - pass_result.score) / 10) + 1
        
        # CHECK FOR VISUAL/FRONTEND DEFECTS FIRST
        # These need frontend code fixes, not docs search
        frontend_keywords = ['truncation', 'truncated', 'cut off', 'artifact', 
                            'ui element', 'selection highlight', 'overlap', 
                            'tangled', 'boundary overlap', 'visual']
        
        has_visual_defect = False
        visual_defect_desc = None
        for defect in pass_result.defects:
            defect_lower = defect.lower()
            if any(kw in defect_lower for kw in frontend_keywords):
                has_visual_defect = True
                visual_defect_desc = defect
                break
        
        # Override action type for visual defects - route to layout debugger
        if has_visual_defect:
            return FixAction(
                target_pass=pass_name,
                action_type="skill",
                description=f"FRONTEND FIX: {visual_defect_desc[:60]}...",
                priority=priority,
                params={
                    "skill_name": "lane-layout-debugger",
                    "docs_query": "react flow node sizing text truncation layout",
                    "defects": pass_result.defects,
                    "suggestions": pass_result.suggestions,
                    "score": pass_result.score,
                    "visual_defect": True
                }
            )
        
        # Standard action determination
        if mapping["skill"]:
            action_type = "skill"
        elif pass_name in ["badges", "styling", "connections"]:
            action_type = "code_fix"
        else:
            action_type = "docs_search"
        
        return FixAction(
            target_pass=pass_name,
            action_type=action_type,
            description=mapping["description"],
            priority=priority,
            params={
                "skill_name": mapping.get("skill"),
                "docs_query": mapping["docs_query"],
                "defects": pass_result.defects,
                "suggestions": pass_result.suggestions,
                "score": pass_result.score
            }
        )
    
    async def execute_fixes(self) -> Dict[str, Any]:
        """
        Execute all determined fix actions.
        
        Returns:
            Dict with results from each fix attempt
        """
        if not self.actions:
            await self.determine_actions()
        
        results = {}
        
        for action in self.actions:
            print(f"\nExecuting fix for {action.target_pass}...")
            print(f"  Action: {action.action_type}")
            print(f"  Description: {action.description}")
            
            if action.action_type == "skill":
                result = await self._execute_skill(action)
            elif action.action_type == "code_fix":
                result = await self._execute_code_fix(action)
            elif action.action_type == "docs_search":
                result = await self._execute_docs_search(action)
            else:
                result = {"status": "skipped", "reason": "Unknown action type"}
            
            results[action.target_pass] = result
        
        return results
    
    async def _execute_skill(self, action: FixAction) -> Dict[str, Any]:
        """
        Execute a Cortex skill - for visual defects, apply frontend code fixes directly.
        """
        skill_name = action.params.get("skill_name")
        is_visual_defect = action.params.get("visual_defect", False)
        
        if not skill_name:
            return {"success": False, "status": "error", "reason": "No skill specified"}
        
        print(f"  Skill to invoke: ${skill_name}")
        defects = action.params.get("defects", [])
        defects_lower = " ".join(defects).lower()
        
        # For visual defects, apply DIRECT frontend code fixes
        if skill_name == "lane-layout-debugger" and is_visual_defect:
            fixes_applied = []
            
            # FIX 1: Label truncation - update CSS to allow more text
            if "truncat" in defects_lower:
                css_fix = await self._fix_label_truncation()
                if css_fix.get("success"):
                    fixes_applied.append("label_truncation")
                    print(f"  ✓ Fixed label truncation in CustomNode.module.css")
            
            # FIX 2: UI artifacts (red X button) - hide during screenshot
            if "artifact" in defects_lower or "red" in defects_lower:
                artifact_fix = await self._fix_ui_artifacts()
                if artifact_fix.get("success"):
                    fixes_applied.append("ui_artifacts")
                    print(f"  ✓ Fixed UI artifact visibility")
            
            # FIX 3: Boundary overlap - adjust subgraph spacing
            if "overlap" in defects_lower or "boundary" in defects_lower:
                overlap_fix = await self._fix_boundary_overlap()
                if overlap_fix.get("success"):
                    fixes_applied.append("boundary_overlap")
                    print(f"  ✓ Fixed boundary overlap spacing")
            
            if fixes_applied:
                return {
                    "success": True,
                    "status": "frontend_fixes_applied",
                    "skill": skill_name,
                    "fixes_applied": fixes_applied,
                    "defects_addressed": defects,
                    "action": "Frontend code updated - re-render to verify"
                }
            else:
                # Generate guidance if no direct fixes possible
                return {
                    "success": True,
                    "status": "guidance_generated",
                    "skill": skill_name,
                    "layout_guidance": self._generate_layout_guidance(defects),
                    "defects_to_fix": defects
                }
        
        # Standard layout guidance for non-visual defects
        if skill_name == "lane-layout-debugger":
            return {
                "success": True,
                "status": "feedback_generated",
                "skill": skill_name,
                "layout_guidance": self._generate_layout_guidance(defects),
                "defects_to_fix": defects,
                "action": "Feed layout_guidance into next agent prompt"
            }
        
        # For other skills, return pending for CoCo to handle
        return {
            "success": True,
            "status": "pending",
            "skill": skill_name,
            "invoke_command": f"${skill_name}",
            "defects_to_fix": defects
        }
    
    def _generate_layout_guidance(self, defects: List[str]) -> str:
        """Generate layout guidance based on defects."""
        return """
LAYOUT FIX REQUIRED:
1. Ensure external sources (Kafka, CSP) are in LEFT subgraph
2. Ensure Snowflake processing is in CENTER subgraph  
3. Ensure outputs (Analytics, ML) are in RIGHT subgraph
4. Add explicit subgraph nesting: sources -> snowflake -> outputs
5. Use 'direction LR' at top level for horizontal flow
"""
    
    async def _fix_label_truncation(self) -> Dict[str, Any]:
        """
        Fix label truncation by updating CustomNode.module.css.
        Removes line-clamp and increases max-height to prevent text cutoff.
        """
        import os
        css_path = os.path.join(
            os.path.dirname(__file__), 
            "../../../frontend/src/components/CustomNode.module.css"
        )
        
        try:
            with open(css_path, 'r') as f:
                content = f.read()
            
            # Check if truncation CSS is present
            if "-webkit-line-clamp: 3;" in content:
                # Replace restrictive label styles with flexible ones
                old_label_css = """  /* Support for multi-line labels */
  line-height: 1.3;
  max-height: 4em;  /* ~3 lines max */
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;"""
                
                new_label_css = """  /* Support for multi-line labels - NO TRUNCATION */
  line-height: 1.3;
  max-height: none;  /* Allow full text display */
  overflow: visible;
  /* Removed -webkit-line-clamp to prevent truncation */"""
                
                if old_label_css in content:
                    content = content.replace(old_label_css, new_label_css)
                    with open(css_path, 'w') as f:
                        f.write(content)
                    return {"success": True, "file": css_path, "change": "removed line-clamp"}
            
            return {"success": False, "reason": "CSS pattern not found"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _fix_ui_artifacts(self) -> Dict[str, Any]:
        """
        Fix UI artifacts by ensuring delete button is hidden in export/screenshot mode.
        Adds a CSS class that can be toggled during screenshot capture.
        """
        import os
        css_path = os.path.join(
            os.path.dirname(__file__), 
            "../../../frontend/src/components/CustomNode.module.css"
        )
        
        try:
            with open(css_path, 'r') as f:
                content = f.read()
            
            # Add export mode class if not present
            export_mode_css = """
/* ===== EXPORT MODE - Hide interactive elements during screenshot ===== */
:global(.export-mode) .deleteButton {
  display: none !important;
}

:global(.export-mode) .handle {
  opacity: 0 !important;
}
"""
            if ":global(.export-mode)" not in content:
                content += export_mode_css
                with open(css_path, 'w') as f:
                    f.write(content)
                return {"success": True, "file": css_path, "change": "added export-mode class"}
            
            return {"success": True, "reason": "export-mode already present"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _fix_boundary_overlap(self) -> Dict[str, Any]:
        """
        Fix boundary overlap by adjusting subgraph padding/margins.
        """
        import os
        css_path = os.path.join(
            os.path.dirname(__file__), 
            "../../../frontend/src/components/CustomNode.module.css"
        )
        
        try:
            with open(css_path, 'r') as f:
                content = f.read()
            
            # Add boundary spacing if not present
            boundary_spacing_css = """
/* ===== BOUNDARY OVERLAP FIX - Increased spacing ===== */
.boundaryNode {
  margin: 16px;
  padding: 24px;
}

.boundaryNode .nodeSurface {
  padding: 24px;
}
"""
            # Check if we already have the fix
            if "BOUNDARY OVERLAP FIX" not in content:
                content += boundary_spacing_css
                with open(css_path, 'w') as f:
                    f.write(content)
                return {"success": True, "file": css_path, "change": "added boundary spacing"}
            
            return {"success": True, "reason": "boundary spacing already present"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _execute_code_fix(self, action: FixAction) -> Dict[str, Any]:
        """Execute a direct code fix on Mermaid template"""
        
        if not self.mermaid_code:
            return {"status": "error", "reason": "No Mermaid code provided"}
        
        target = action.target_pass
        defects = action.params.get("defects", [])
        
        fixes_applied = []
        modified_code = self.mermaid_code
        
        if target == "badges":
            modified_code, badge_fixes = self._fix_badges(modified_code, defects)
            fixes_applied.extend(badge_fixes)
            
        elif target == "styling":
            modified_code, style_fixes = self._fix_styling(modified_code, defects)
            fixes_applied.extend(style_fixes)
            
        elif target == "connections":
            modified_code, conn_fixes = self._fix_connections(modified_code, defects)
            fixes_applied.extend(conn_fixes)
        
        return {
            "status": "success" if fixes_applied else "no_changes",
            "fixes_applied": fixes_applied,
            "modified_code": modified_code if fixes_applied else None
        }
    
    def _fix_badges(
        self, 
        code: str, 
        defects: List[str]
    ) -> tuple[str, List[str]]:
        """Fix badge-related defects in Mermaid code"""
        fixes = []
        
        for defect in defects:
            # Handle missing badge positioning
            if "missing positioning connection" in defect.lower():
                # Extract badge name
                match = re.search(r'Badge (\w+)', defect)
                if match:
                    badge_id = match.group(1)
                    
                    # Find the badge definition and add positioning
                    # This is a simplified fix - real implementation would be smarter
                    if f"badge_{badge_id}" in code and f"badge_{badge_id} ~~~" not in code:
                        # Determine what to connect to based on badge type
                        if badge_id.startswith("1"):  # Lane badge
                            target = f"path_{badge_id}"
                        else:  # Section badge
                            target = f"section_{badge_id}"
                        
                        # Add positioning after classDef section
                        positioning_line = f"\n    badge_{badge_id} ~~~ {target}"
                        
                        # Insert before classDef if possible
                        if "classDef" in code:
                            insert_pos = code.find("classDef")
                            code = code[:insert_pos] + positioning_line + "\n\n    " + code[insert_pos:]
                        else:
                            code += positioning_line
                        
                        fixes.append(f"Added positioning for badge_{badge_id}")
            
            # Handle missing badges
            elif "missing badge" in defect.lower():
                match = re.search(r'Missing badge: (\w+)', defect)
                if match:
                    badge_label = match.group(1)
                    
                    # Determine badge type and color
                    if badge_label[0].isdigit() and len(badge_label) == 1:
                        badge_class = "sectionBadge"
                    else:
                        badge_class = "laneBadge"
                    
                    # Add badge definition
                    badge_def = f'\n    badge_{badge_label}(["{badge_label}"]):::{badge_class}'
                    
                    # Insert near other badges
                    if "badge_" in code:
                        # Find last badge definition
                        last_badge = max(code.rfind(f"badge_{b}") for b in ["1a", "1b", "1c", "1d", "2", "3", "4", "5"] if f"badge_{b}" in code)
                        if last_badge > 0:
                            # Find end of that line
                            line_end = code.find("\n", last_badge)
                            if line_end > 0:
                                code = code[:line_end] + badge_def + code[line_end:]
                                fixes.append(f"Added missing badge: {badge_label}")
        
        return code, fixes
    
    def _fix_styling(
        self, 
        code: str, 
        defects: List[str]
    ) -> tuple[str, List[str]]:
        """Fix styling-related defects in Mermaid code"""
        fixes = []
        
        for defect in defects:
            if "Missing classDef: laneBadge" in defect:
                if "classDef laneBadge" not in code:
                    styling = "\n    classDef laneBadge fill:#7C3AED,stroke:#5B21B6,color:#fff,font-weight:bold"
                    code += styling
                    fixes.append("Added classDef laneBadge")
            
            elif "Missing classDef: sectionBadge" in defect:
                if "classDef sectionBadge" not in code:
                    styling = "\n    classDef sectionBadge fill:#2563EB,stroke:#1D4ED8,color:#fff,font-weight:bold"
                    code += styling
                    fixes.append("Added classDef sectionBadge")
            
            elif "Wrong color" in defect:
                # Fix color values
                if "laneBadge" in defect:
                    # Replace incorrect color with correct one
                    code = re.sub(
                        r'(classDef laneBadge.*?fill:)#\w+',
                        r'\1#7C3AED',
                        code
                    )
                    fixes.append("Fixed laneBadge color to #7C3AED")
                
                elif "sectionBadge" in defect:
                    code = re.sub(
                        r'(classDef sectionBadge.*?fill:)#\w+',
                        r'\1#2563EB',
                        code
                    )
                    fixes.append("Fixed sectionBadge color to #2563EB")
        
        return code, fixes
    
    def _fix_connections(
        self, 
        code: str, 
        defects: List[str]
    ) -> tuple[str, List[str]]:
        """Fix connection-related defects in Mermaid code"""
        fixes = []
        
        for defect in defects:
            if "Missing flow label" in defect:
                match = re.search(r'Missing flow label: (\w+)', defect)
                if match:
                    label = match.group(1)
                    
                    # Find appropriate edge to add label to
                    # This is a simplified approach
                    if label.lower() == "streaming":
                        # Add label to Kafka connector edge
                        code = code.replace(
                            "kafka_connector --> snowpipe_streaming",
                            f'kafka_connector -->|"{label}"| snowpipe_streaming'
                        )
                        if "Streaming" not in code:
                            fixes.append(f"Added flow label: {label}")
                    
                    elif label.lower() == "batch":
                        # Add label to batch path edge  
                        code = code.replace(
                            "s3 --> snowpipe",
                            f's3 -->|"{label}"| snowpipe'
                        )
                        if "Batch" not in code:
                            fixes.append(f"Added flow label: {label}")
        
        return code, fixes
    
    async def _execute_docs_search(self, action: FixAction) -> Dict[str, Any]:
        """Search Snowflake docs for guidance on fixing issues"""
        query = action.params.get("docs_query", "")
        
        print(f"  Docs search query: {query}")
        
        # In actual implementation, this would call:
        # mcp__snowflake-docs__snowflake_docs_search(query=query)
        
        return {
            "status": "pending",
            "query": query,
            "instruction": "Use mcp__snowflake-docs__snowflake_docs_search to find best practices",
            "defects_to_address": action.params.get("defects", [])
        }
    
    def print_action_plan(self) -> None:
        """Print formatted action plan"""
        if not self.actions:
            print("No fix actions required - all passes above threshold!")
            return
        
        print("\n" + "=" * 60)
        print("FIX ACTION PLAN")
        print("=" * 60)
        
        for i, action in enumerate(self.actions, 1):
            print(f"\n{i}. [{action.action_type.upper()}] {action.target_pass}")
            print(f"   Priority: {action.priority}")
            print(f"   Description: {action.description}")
            print(f"   Score: {action.params.get('score', 'N/A')}%")
            
            if action.params.get("skill_name"):
                print(f"   Skill: ${action.params['skill_name']}")
            
            if action.params.get("defects"):
                print(f"   Defects to fix:")
                for d in action.params["defects"][:3]:
                    print(f"     - {d}")
        
        print("\n" + "=" * 60)


async def main():
    """Example usage"""
    from eval_passes import VisualEvaluator
    
    # Sample Mermaid code with issues
    sample_mermaid = """flowchart LR
    badge_1a(["1a"]):::laneBadge
    badge_1b(["1b"]):::laneBadge
    
    subgraph snowflake["Snowflake"]
        badge_2(["2"]):::sectionBadge
        
        subgraph section_2["Ingestion"]
            snowpipe_streaming["Snowpipe Streaming"]
        end
    end
    
    %% Missing badge positioning
    
    classDef laneBadge fill:#7C3AED,stroke:#5B21B6,color:#fff
    """
    
    # Run evaluation
    evaluator = VisualEvaluator(
        reference_image_path="pdf_images/streaming_page4_img0.png",
        generated_image_path="output/streaming_generated.png",
        mermaid_code=sample_mermaid
    )
    
    result = await evaluator.evaluate()
    evaluator.print_report(result)
    
    # Determine and execute fixes
    trigger = SkillTrigger(result, mermaid_code=sample_mermaid)
    actions = await trigger.determine_actions()
    trigger.print_action_plan()
    
    # Execute fixes
    fix_results = await trigger.execute_fixes()
    
    print("\nFix Results:")
    for pass_name, result in fix_results.items():
        print(f"  {pass_name}: {result.get('status')}")
        if result.get("fixes_applied"):
            for fix in result["fixes_applied"]:
                print(f"    - {fix}")


if __name__ == "__main__":
    asyncio.run(main())
