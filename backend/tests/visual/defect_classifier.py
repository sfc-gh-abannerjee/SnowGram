#!/usr/bin/env python3
"""
Defect Classifier for Visual Convergence Loop
==============================================

Analyzes evaluation results and classifies defects into:
- BACKEND defects: Issues with template Mermaid code
- FRONTEND defects: Issues with rendering/layout code

This classification determines which fixer module to invoke.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Any
import json
import os
import httpx

from eval_passes import EvalResult, EvalPass, PassResult


class DefectSource(Enum):
    """Where the defect needs to be fixed"""
    BACKEND = "backend"      # Template Mermaid code in Snowflake
    FRONTEND = "frontend"    # TypeScript rendering code
    UNKNOWN = "unknown"      # Could not determine


class DefectType(Enum):
    """Specific defect categories"""
    # Backend defects
    MISSING_NODE = "missing_node"
    WRONG_LABEL = "wrong_label"
    MISSING_SUBGRAPH = "missing_subgraph"
    MISSING_BADGE = "missing_badge"
    WRONG_CONNECTION = "wrong_connection"
    BAD_SYNTAX = "bad_syntax"
    
    # Frontend defects
    WRONG_COLUMN = "wrong_column"
    BAD_SPACING = "bad_spacing"
    WRONG_HANDLE = "wrong_handle"
    WRONG_COLOR = "wrong_color"
    MISSING_ICON = "missing_icon"
    LAYOUT_OVERFLOW = "layout_overflow"


@dataclass
class Defect:
    """A single identified defect"""
    source: DefectSource
    defect_type: DefectType
    pass_type: str  # String key like "structure", "badges", "layout"
    description: str
    severity: float  # 0.0-1.0, higher = more impactful
    fix_target: str  # File or table to modify
    fix_hint: str    # Suggested fix approach
    evidence: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DiagnosisResult:
    """Complete diagnosis of evaluation results"""
    defects: List[Defect]
    primary_source: DefectSource  # Most impactful defect source
    backend_defects: List[Defect] = field(default_factory=list)
    frontend_defects: List[Defect] = field(default_factory=list)
    recommended_fixes: List[str] = field(default_factory=list)
    
    @property
    def total_severity(self) -> float:
        return sum(d.severity for d in self.defects)
    
    @property
    def backend_severity(self) -> float:
        return sum(d.severity for d in self.backend_defects)
    
    @property
    def frontend_severity(self) -> float:
        return sum(d.severity for d in self.frontend_defects)


# Mapping of pass types to likely defect sources (using string keys)
PASS_TO_SOURCE_MAP = {
    "structure": DefectSource.BACKEND,
    "components": DefectSource.BACKEND,
    "badges": DefectSource.BACKEND,
    "layout": DefectSource.FRONTEND,
    "connections": DefectSource.FRONTEND,
    "styling": DefectSource.FRONTEND,
}

# Fix targets for frontend defects
FRONTEND_FIX_TARGETS = {
    DefectType.WRONG_COLUMN: "frontend/src/lib/elkLayoutUtils.ts",
    DefectType.BAD_SPACING: "frontend/src/lib/layoutUtils.ts",
    DefectType.WRONG_HANDLE: "frontend/src/lib/elkLayout.ts",
    DefectType.WRONG_COLOR: "frontend/src/lib/mermaidToReactFlow.ts",
    DefectType.MISSING_ICON: "frontend/src/lib/iconResolver.ts",
    DefectType.LAYOUT_OVERFLOW: "frontend/src/lib/elkLayout.ts",
}


class DefectClassifier:
    """
    Classifies evaluation defects into backend vs frontend.
    Uses LLM for nuanced classification when needed.
    """
    
    def __init__(
        self,
        eval_result: EvalResult,
        mermaid_code: str,
        template_id: str,
        use_llm: bool = True
    ):
        self.eval_result = eval_result
        self.mermaid_code = mermaid_code
        self.template_id = template_id
        self.use_llm = use_llm
        
        # LLM config
        self.snowflake_account = os.getenv("SNOWFLAKE_ACCOUNT", "abb59444.us-east-1")
        self.api_endpoint = f"https://{self.snowflake_account}.snowflakecomputing.com/api/v2/cortex/inference:complete"
    
    async def diagnose(self) -> DiagnosisResult:
        """
        Analyze evaluation results and classify defects.
        
        Returns:
            DiagnosisResult with classified defects
        """
        defects = []
        
        # Analyze each failing pass
        for pass_type, pass_result in self.eval_result.pass_results.items():
            if pass_result.score < 80:  # Threshold for "failing"
                pass_defects = await self._analyze_pass_failure(
                    pass_type, pass_result
                )
                defects.extend(pass_defects)
        
        # Separate by source
        backend_defects = [d for d in defects if d.source == DefectSource.BACKEND]
        frontend_defects = [d for d in defects if d.source == DefectSource.FRONTEND]
        
        # Determine primary source
        backend_severity = sum(d.severity for d in backend_defects)
        frontend_severity = sum(d.severity for d in frontend_defects)
        
        if backend_severity > frontend_severity:
            primary_source = DefectSource.BACKEND
        elif frontend_severity > backend_severity:
            primary_source = DefectSource.FRONTEND
        else:
            primary_source = DefectSource.BACKEND  # Default to backend
        
        # Generate fix recommendations
        recommendations = self._generate_recommendations(
            backend_defects, frontend_defects
        )
        
        return DiagnosisResult(
            defects=defects,
            primary_source=primary_source,
            backend_defects=backend_defects,
            frontend_defects=frontend_defects,
            recommended_fixes=recommendations
        )
    
    async def _analyze_pass_failure(
        self,
        pass_type: str,
        pass_result: PassResult
    ) -> List[Defect]:
        """
        Analyze a single failing pass to identify defects.
        """
        defects = []
        
        # Get default source for this pass type (now uses string keys)
        default_source = PASS_TO_SOURCE_MAP.get(pass_type, DefectSource.UNKNOWN)
        
        # Calculate severity based on score and weight
        severity = (100 - pass_result.score) / 100 * pass_result.pass_type.weight
        
        # Use rule-based classification first
        rule_defects = self._rule_based_classification(
            pass_type, pass_result, default_source, severity
        )
        defects.extend(rule_defects)
        
        # Use LLM for more nuanced analysis if enabled
        if self.use_llm and pass_result.score < 60:
            llm_defects = await self._llm_classification(
                pass_type, pass_result, default_source
            )
            defects.extend(llm_defects)
        
        return defects
    
    def _rule_based_classification(
        self,
        pass_type: str,
        pass_result: PassResult,
        default_source: DefectSource,
        severity: float
    ) -> List[Defect]:
        """
        Apply rule-based defect classification.
        """
        defects = []
        # Join findings list into a single string for pattern matching
        findings = " ".join(pass_result.findings) if pass_result.findings else ""
        findings_lower = findings.lower()
        
        if pass_type == "structure":
            if "subgraph" in findings_lower or "missing" in findings_lower:
                defects.append(Defect(
                    source=DefectSource.BACKEND,
                    defect_type=DefectType.MISSING_SUBGRAPH,
                    pass_type=pass_type,
                    description=findings,
                    severity=severity,
                    fix_target="ARCHITECTURE_TEMPLATES",
                    fix_hint="Add missing subgraph definitions to Mermaid code"
                ))
            else:
                # Generic structure issue
                defects.append(Defect(
                    source=DefectSource.BACKEND,
                    defect_type=DefectType.MISSING_SUBGRAPH,
                    pass_type=pass_type,
                    description=findings or "Structure mismatch",
                    severity=severity,
                    fix_target="ARCHITECTURE_TEMPLATES",
                    fix_hint="Review subgraph organization in template"
                ))
        
        elif pass_type == "components":
            if "missing" in findings_lower or "node" in findings_lower:
                defects.append(Defect(
                    source=DefectSource.BACKEND,
                    defect_type=DefectType.MISSING_NODE,
                    pass_type=pass_type,
                    description=findings,
                    severity=severity,
                    fix_target="ARCHITECTURE_TEMPLATES",
                    fix_hint="Add missing node definitions to Mermaid code"
                ))
            else:
                # Generic component issue
                defects.append(Defect(
                    source=DefectSource.BACKEND,
                    defect_type=DefectType.MISSING_NODE,
                    pass_type=pass_type,
                    description=findings or "Component mismatch",
                    severity=severity,
                    fix_target="ARCHITECTURE_TEMPLATES",
                    fix_hint="Review node definitions in template"
                ))
        
        elif pass_type == "badges":
            defects.append(Defect(
                source=DefectSource.BACKEND,
                defect_type=DefectType.MISSING_BADGE,
                pass_type=pass_type,
                description=findings or "Missing badges",
                severity=severity,
                fix_target="ARCHITECTURE_TEMPLATES",
                fix_hint="Add missing badge nodes (e.g., badge_1a, badge_2) with :::laneBadge or :::sectionBadge class"
            ))
        
        elif pass_type == "layout":
            if "column" in findings_lower or "position" in findings_lower:
                defects.append(Defect(
                    source=DefectSource.FRONTEND,
                    defect_type=DefectType.WRONG_COLUMN,
                    pass_type=pass_type,
                    description=findings,
                    severity=severity,
                    fix_target=FRONTEND_FIX_TARGETS[DefectType.WRONG_COLUMN],
                    fix_hint="Adjust getFlowStageOrder() rules in elkLayoutUtils.ts"
                ))
            elif "spacing" in findings_lower:
                defects.append(Defect(
                    source=DefectSource.FRONTEND,
                    defect_type=DefectType.BAD_SPACING,
                    pass_type=pass_type,
                    description=findings,
                    severity=severity,
                    fix_target=FRONTEND_FIX_TARGETS[DefectType.BAD_SPACING],
                    fix_hint="Adjust LAYOUT_CONSTANTS in layoutUtils.ts"
                ))
            else:
                # Generic layout issue
                defects.append(Defect(
                    source=DefectSource.FRONTEND,
                    defect_type=DefectType.WRONG_COLUMN,
                    pass_type=pass_type,
                    description=findings or "Layout mismatch",
                    severity=severity,
                    fix_target=FRONTEND_FIX_TARGETS[DefectType.WRONG_COLUMN],
                    fix_hint="Review ELK layout configuration"
                ))
        
        elif pass_type == "connections":
            if "handle" in findings_lower or "direction" in findings_lower:
                defects.append(Defect(
                    source=DefectSource.FRONTEND,
                    defect_type=DefectType.WRONG_HANDLE,
                    pass_type=pass_type,
                    description=findings,
                    severity=severity,
                    fix_target=FRONTEND_FIX_TARGETS[DefectType.WRONG_HANDLE],
                    fix_hint="Adjust assignHandles() in elkLayout.ts"
                ))
            else:
                # Could be backend connection definition
                defects.append(Defect(
                    source=DefectSource.BACKEND,
                    defect_type=DefectType.WRONG_CONNECTION,
                    pass_type=pass_type,
                    description=findings or "Connection mismatch",
                    severity=severity * 0.5,  # Split severity
                    fix_target="ARCHITECTURE_TEMPLATES",
                    fix_hint="Check edge definitions in Mermaid code"
                ))
        
        elif pass_type == "styling":
            defects.append(Defect(
                source=DefectSource.FRONTEND,
                defect_type=DefectType.WRONG_COLOR,
                pass_type=pass_type,
                description=findings or "Styling mismatch",
                severity=severity,
                fix_target=FRONTEND_FIX_TARGETS[DefectType.WRONG_COLOR],
                fix_hint="Adjust LAYER_COLORS or STAGE_COLORS in mermaidToReactFlow.ts"
            ))
        
        return defects
    
    async def _llm_classification(
        self,
        pass_type: str,
        pass_result: PassResult,
        default_source: DefectSource
    ) -> List[Defect]:
        """
        Use LLM for more nuanced defect classification.
        """
        try:
            prompt = f"""Analyze this diagram evaluation failure and classify the defect.

Pass Type: {pass_type}
Score: {pass_result.score}%
Findings: {pass_result.findings}

Mermaid Code (first 500 chars):
{self.mermaid_code[:500]}...

Classify as:
1. BACKEND (template Mermaid code issue) - missing nodes, wrong labels, bad syntax
2. FRONTEND (rendering code issue) - layout problems, wrong colors, connection routing

Respond with JSON:
{{"source": "backend" or "frontend", "defect_type": "specific issue", "fix_hint": "how to fix"}}
"""
            
            # In production, call Cortex Complete
            # For now, return empty list
            return []
            
        except Exception as e:
            print(f"  LLM classification failed: {e}")
            return []
    
    def _generate_recommendations(
        self,
        backend_defects: List[Defect],
        frontend_defects: List[Defect]
    ) -> List[str]:
        """
        Generate ordered fix recommendations.
        """
        recommendations = []
        
        # Sort defects by severity
        all_defects = sorted(
            backend_defects + frontend_defects,
            key=lambda d: d.severity,
            reverse=True
        )
        
        for defect in all_defects[:5]:  # Top 5
            if defect.source == DefectSource.BACKEND:
                recommendations.append(
                    f"[BACKEND] {defect.defect_type.value}: {defect.fix_hint}"
                )
            else:
                recommendations.append(
                    f"[FRONTEND] Fix {defect.fix_target}: {defect.fix_hint}"
                )
        
        return recommendations
    
    def print_diagnosis(self, result: DiagnosisResult) -> None:
        """
        Print diagnosis summary.
        """
        print("\n" + "=" * 60)
        print("DEFECT DIAGNOSIS")
        print("=" * 60)
        
        print(f"\nPrimary Source: {result.primary_source.value.upper()}")
        print(f"Total Defects: {len(result.defects)}")
        print(f"  Backend: {len(result.backend_defects)} (severity: {result.backend_severity:.2f})")
        print(f"  Frontend: {len(result.frontend_defects)} (severity: {result.frontend_severity:.2f})")
        
        print("\nRecommended Fixes:")
        for i, rec in enumerate(result.recommended_fixes, 1):
            print(f"  {i}. {rec}")
        
        print("\nDetailed Defects:")
        for defect in result.defects:
            print(f"  - [{defect.source.value.upper()}] {defect.pass_type}")
            print(f"    Type: {defect.defect_type.value}")
            print(f"    Severity: {defect.severity:.2f}")
            print(f"    Fix: {defect.fix_hint[:60]}...")
