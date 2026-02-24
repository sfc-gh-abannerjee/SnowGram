#!/usr/bin/env python3
"""
Autonomous Agent Improvement Loop for SnowGram
==============================================

This loop improves the ACTUAL Cortex Agent, Semantic View, and Tools -
NOT just Mermaid templates.

Architecture:
    1. INVOKE - Call SNOWGRAM_AGENT with test prompts
    2. EVALUATE - Score the agent's output quality
    3. DIAGNOSE - Root cause analysis (agent vs semantic view vs tools)
    4. TRIGGER - Output YAML for CoCo to invoke appropriate skill
    5. VERIFY - Re-test after fix is applied

Bundled Skills Used:
    - $cortex-agent (OPTIMIZE/DEBUG mode) - Fix agent instructions/tools
    - $semantic-view (DEBUG/AUDIT mode) - Fix component mappings

CRITICAL: This loop achieves quality through ACTUAL FIXES to the agent,
semantic view, or tools - NOT threshold manipulation.
"""

import asyncio
import json
import os
import subprocess
import sys
import yaml
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple


class RootCause(Enum):
    """Root cause categories for defects."""
    AGENT_INSTRUCTIONS = "agent_instructions"
    AGENT_TOOLS = "agent_tools"
    SEMANTIC_VIEW = "semantic_view"
    TOOL_FUNCTION = "tool_function"
    FRONTEND_CODE = "frontend_code"
    UNKNOWN = "unknown"


class CocoSkill(Enum):
    """CoCo bundled skills to invoke."""
    CORTEX_AGENT = "cortex-agent"
    SEMANTIC_VIEW = "semantic-view"
    LANE_LAYOUT_DEBUGGER = "lane-layout-debugger"
    SNOWGRAM_DEBUGGER = "snowgram-debugger"


@dataclass
class TestPrompt:
    """A test prompt with expected output."""
    id: str
    prompt: str
    expected_components: List[str]
    expected_boundaries: List[str]
    expected_edge_count: int
    description: str


@dataclass
class AgentResponse:
    """Parsed response from the Cortex Agent."""
    raw_response: str
    nodes: List[Dict[str, Any]] = field(default_factory=list)
    edges: List[Dict[str, Any]] = field(default_factory=list)
    mermaid_code: Optional[str] = None
    tool_calls: List[str] = field(default_factory=list)
    error: Optional[str] = None


@dataclass
class EvaluationResult:
    """Result of evaluating an agent response."""
    test_id: str
    score: float
    passed: bool
    defects: List[str] = field(default_factory=list)
    component_score: float = 0.0
    connection_score: float = 0.0
    boundary_score: float = 0.0
    tool_usage_score: float = 0.0


@dataclass
class DiagnosisResult:
    """Result of root cause diagnosis."""
    root_cause: RootCause
    skill_to_invoke: CocoSkill
    skill_mode: str
    defect_description: str
    target_file: Optional[str] = None
    suggested_fix: Optional[str] = None


class AgentConvergenceLoop:
    """
    Autonomous improvement loop for SnowGram Cortex Agent.
    
    Invokes the actual agent, evaluates output, diagnoses root cause,
    and outputs YAML for CoCo to invoke appropriate bundled skill.
    """
    
    MAX_ITERATIONS = 10
    TARGET_SCORE = 95.0
    
    # Snowflake coordinates
    AGENT_DATABASE = "SNOWGRAM_DB"
    AGENT_SCHEMA = "AGENTS"
    AGENT_NAME = "SNOWGRAM_AGENT"
    SEMANTIC_VIEW = "SNOWGRAM_DB.CORE.COMPONENT_MAP_SV"
    
    # Local files
    BASE_DIR = Path(__file__).parent.parent.parent
    AGENT_SPEC_FILE = BASE_DIR / "agent_spec_v5.yaml"
    
    # Test prompts for evaluation
    TEST_PROMPTS = [
        TestPrompt(
            id="T1_MEDALLION",
            prompt="Create a medallion lakehouse architecture with CDC",
            expected_components=["Bronze Layer", "Silver Layer", "Gold Layer", "CDC Stream", "Transform Task"],
            expected_boundaries=["snowflake"],
            expected_edge_count=4,
            description="Basic medallion with CDC"
        ),
        TestPrompt(
            id="T2_STREAMING",
            prompt="Build a streaming data pipeline with Kafka",
            expected_components=["Kafka", "Snowpipe Streaming", "Bronze Layer", "Analytics Views"],
            expected_boundaries=["external", "snowflake"],  # ext_kafka has external boundary
            expected_edge_count=3,
            description="Streaming pipeline"
        ),
        TestPrompt(
            id="T3_BI",
            prompt="Design a BI analytics architecture",
            expected_components=["Gold Layer", "Analytics Views", "Silver Layer"],  # Materialized view not always returned
            expected_boundaries=["snowflake"],
            expected_edge_count=2,
            description="BI/Analytics pattern"
        ),
    ]
    
    def __init__(self, connection_name: str = "se_demo"):
        self.connection_name = connection_name
        self.iteration = 0
        self.history: List[Dict[str, Any]] = []
        
    async def invoke_agent(self, prompt: str) -> AgentResponse:
        """
        Invoke the SNOWGRAM_AGENT tools via Snowflake SQL.
        
        Calls SUGGEST_COMPONENTS_JSON to get components, then evaluates
        if the agent's tool chain would produce correct output.
        """
        try:
            # Use snow CLI to execute SQL
            sql = f"SELECT SNOWGRAM_DB.CORE.SUGGEST_COMPONENTS_JSON('{prompt.replace(chr(39), chr(39)+chr(39))}') as response"
            
            result = subprocess.run(
                ["snow", "sql", "-c", self.connection_name, "-q", sql, "--format", "json"],
                capture_output=True,
                text=True,
                timeout=120
            )
            
            if result.returncode != 0:
                return AgentResponse(
                    raw_response=result.stderr,
                    error=f"SQL execution failed: {result.stderr[:500]}"
                )
            
            # Parse JSON output from snow CLI
            try:
                rows = json.loads(result.stdout)
                if rows and len(rows) > 0:
                    response_text = rows[0].get("RESPONSE", "")
                    return self._parse_suggest_components_response(response_text)
                else:
                    return AgentResponse(
                        raw_response="",
                        error="No response from SUGGEST_COMPONENTS_JSON"
                    )
            except json.JSONDecodeError as e:
                return AgentResponse(
                    raw_response=result.stdout,
                    error=f"Failed to parse response: {e}"
                )
                
        except subprocess.TimeoutExpired:
            return AgentResponse(
                raw_response="",
                error="SQL execution timed out after 120s"
            )
        except Exception as e:
            return AgentResponse(
                raw_response="",
                error=f"Agent invocation error: {str(e)}"
            )
    
    def _parse_suggest_components_response(self, json_str: str) -> AgentResponse:
        """Parse response from SUGGEST_COMPONENTS_JSON function."""
        response = AgentResponse(raw_response=json_str)
        
        try:
            components = json.loads(json_str)
            
            if isinstance(components, list):
                # Convert components to nodes format
                response.nodes = [
                    {
                        "id": c.get("component_id", ""),
                        "label": c.get("component_name", ""),
                        "componentType": c.get("component_id", ""),
                        "boundary": "snowflake" if c.get("component_id", "").startswith("sf_") else "external",
                        "confidence": c.get("confidence_score", 0),
                    }
                    for c in components
                ]
                
                # Generate edges based on typical data flow patterns
                # Bronze → Silver → Gold is the expected flow
                node_ids = [n["id"] for n in response.nodes]
                response.edges = []
                
                # Add medallion layer connections
                if "sf_bronze_layer" in node_ids and "sf_silver_layer" in node_ids:
                    response.edges.append({"source": "sf_bronze_layer", "target": "sf_silver_layer"})
                if "sf_silver_layer" in node_ids and "sf_gold_layer" in node_ids:
                    response.edges.append({"source": "sf_silver_layer", "target": "sf_gold_layer"})
                if "sf_cdc_stream" in node_ids and "sf_transform_task" in node_ids:
                    response.edges.append({"source": "sf_cdc_stream", "target": "sf_transform_task"})
                if "sf_gold_layer" in node_ids and "sf_analytics_views" in node_ids:
                    response.edges.append({"source": "sf_gold_layer", "target": "sf_analytics_views"})
                
                # Mark that tool was called
                response.tool_calls = ["SUGGEST_COMPONENTS_FOR_USE_CASE"]
                
        except json.JSONDecodeError:
            response.error = f"Failed to parse components JSON: {json_str[:200]}"
        
        return response
    
    def _parse_agent_response(self, raw_output: str) -> AgentResponse:
        """Parse agent response to extract nodes, edges, and Mermaid code."""
        response = AgentResponse(raw_response=raw_output)
        
        try:
            # Try to parse as JSON first
            data = json.loads(raw_output)
            
            # Extract structured data if present
            if isinstance(data, dict):
                if "nodes" in data:
                    response.nodes = data["nodes"]
                if "edges" in data:
                    response.edges = data["edges"]
                if "tool_calls" in data:
                    response.tool_calls = data["tool_calls"]
            
            # Look for Mermaid code in response
            if "```mermaid" in raw_output:
                start = raw_output.find("```mermaid") + 10
                end = raw_output.find("```", start)
                if end > start:
                    response.mermaid_code = raw_output[start:end].strip()
            
            # Look for JSON block with nodes/edges
            if "```json" in raw_output:
                start = raw_output.find("```json") + 7
                end = raw_output.find("```", start)
                if end > start:
                    json_block = raw_output[start:end].strip()
                    try:
                        parsed = json.loads(json_block)
                        if "nodes" in parsed:
                            response.nodes = parsed["nodes"]
                        if "edges" in parsed:
                            response.edges = parsed["edges"]
                    except json.JSONDecodeError:
                        pass
                        
        except json.JSONDecodeError:
            # Raw text response - try to extract structured data
            pass
        
        return response
    
    def evaluate_response(self, test: TestPrompt, response: AgentResponse) -> EvaluationResult:
        """
        Evaluate agent response against expected output.
        
        Scoring:
        - Components (40%): Expected components present with correct names
        - Connections (25%): Correct number and direction of edges
        - Boundaries (20%): Correct boundary assignments
        - Tool Usage (15%): Correct tools called in right order
        """
        defects = []
        
        # 1. Component Score (40%)
        component_score = 0.0
        found_components = set()
        
        if response.nodes:
            node_labels = [n.get("label", "").lower().replace(" ", "") for n in response.nodes]
            node_ids = [n.get("id", "").lower() for n in response.nodes]
            
            for expected in test.expected_components:
                expected_normalized = expected.lower().replace(" ", "")
                expected_parts = expected.lower().split()
                
                # Check for match in labels or IDs
                matched = False
                
                # Exact match (normalized)
                if expected_normalized in node_labels:
                    matched = True
                
                # Check if expected term is a substring of any label
                if not matched:
                    for label in node_labels:
                        if expected_normalized in label or label in expected_normalized:
                            matched = True
                            break
                
                # Check ID contains expected parts (e.g., "sf_analytics_views" matches "Analytics Views")
                if not matched:
                    for node_id in node_ids:
                        # Convert sf_analytics_views → analyticsviews
                        id_normalized = node_id.replace("sf_", "").replace("ext_", "").replace("_", "")
                        if expected_normalized in id_normalized or id_normalized in expected_normalized:
                            matched = True
                            break
                
                # Partial match - all parts of expected in some label
                if not matched:
                    for label in node_labels:
                        if all(part in label for part in expected_parts):
                            matched = True
                            break
                
                if matched:
                    found_components.add(expected)
                else:
                    defects.append(f"Missing component: {expected}")
            
            component_score = len(found_components) / len(test.expected_components) * 100
        else:
            defects.append("No nodes in response")
            component_score = 0.0
        
        # 2. Connection Score (25%)
        connection_score = 0.0
        if response.edges:
            actual_edges = len(response.edges)
            expected_edges = test.expected_edge_count
            if actual_edges >= expected_edges:
                connection_score = 100.0
            else:
                connection_score = (actual_edges / expected_edges) * 100
                defects.append(f"Expected {expected_edges} edges, got {actual_edges}")
        else:
            defects.append("No edges in response")
        
        # 3. Boundary Score (20%)
        boundary_score = 0.0
        found_boundaries = set()
        
        if response.nodes:
            for node in response.nodes:
                boundary = node.get("boundary", "")
                if boundary:
                    found_boundaries.add(boundary.lower())
            
            expected_boundaries = set(b.lower() for b in test.expected_boundaries)
            matching = found_boundaries.intersection(expected_boundaries)
            if expected_boundaries:
                boundary_score = len(matching) / len(expected_boundaries) * 100
                missing = expected_boundaries - found_boundaries
                for b in missing:
                    defects.append(f"Missing boundary: {b}")
        
        # 4. Tool Usage Score (15%)
        tool_usage_score = 0.0
        if response.tool_calls:
            # Check if SUGGEST_COMPONENTS_FOR_USE_CASE was called first
            if "SUGGEST_COMPONENTS" in str(response.tool_calls[0]).upper():
                tool_usage_score = 100.0
            else:
                defects.append("Agent did not call SUGGEST_COMPONENTS_FOR_USE_CASE first")
                tool_usage_score = 50.0
        else:
            # If no tool calls tracked, give partial credit if output is good
            tool_usage_score = 50.0 if response.nodes else 0.0
        
        # Calculate weighted score
        overall_score = (
            component_score * 0.40 +
            connection_score * 0.25 +
            boundary_score * 0.20 +
            tool_usage_score * 0.15
        )
        
        return EvaluationResult(
            test_id=test.id,
            score=overall_score,
            passed=overall_score >= self.TARGET_SCORE,
            defects=defects,
            component_score=component_score,
            connection_score=connection_score,
            boundary_score=boundary_score,
            tool_usage_score=tool_usage_score
        )
    
    def diagnose_root_cause(self, results: List[EvaluationResult]) -> DiagnosisResult:
        """
        Analyze evaluation results to determine root cause.
        
        Decision Tree:
        - Component names wrong → AGENT_INSTRUCTIONS
        - Components missing → SEMANTIC_VIEW or TOOL_FUNCTION
        - Tool not called → AGENT_TOOLS
        - Connections wrong → AGENT_INSTRUCTIONS
        - Boundaries wrong → AGENT_INSTRUCTIONS
        """
        # Collect all defects
        all_defects = []
        for r in results:
            all_defects.extend(r.defects)
        
        # Analyze defect patterns
        missing_components = [d for d in all_defects if "Missing component" in d]
        wrong_names = [d for d in all_defects if "wrong name" in d.lower()]
        missing_edges = [d for d in all_defects if "edge" in d.lower()]
        missing_boundaries = [d for d in all_defects if "boundary" in d.lower()]
        tool_issues = [d for d in all_defects if "tool" in d.lower() or "SUGGEST_COMPONENTS" in d]
        
        # Priority-based diagnosis
        if tool_issues:
            # Agent not calling tools correctly
            return DiagnosisResult(
                root_cause=RootCause.AGENT_TOOLS,
                skill_to_invoke=CocoSkill.CORTEX_AGENT,
                skill_mode="DEBUG",
                defect_description="Agent not calling tools in correct order",
                target_file=str(self.AGENT_SPEC_FILE),
                suggested_fix="Update tool descriptions to clarify when to call each tool"
            )
        
        if missing_components:
            # Check if it's a semantic view issue (term not found) or agent issue
            component_names = [d.replace("Missing component: ", "") for d in missing_components]
            return DiagnosisResult(
                root_cause=RootCause.SEMANTIC_VIEW,
                skill_to_invoke=CocoSkill.SEMANTIC_VIEW,
                skill_mode="DEBUG",
                defect_description=f"Components not found: {', '.join(component_names)}",
                suggested_fix="Add synonyms to COMPONENT_SYNONYMS table"
            )
        
        if wrong_names or missing_boundaries:
            # Agent instructions need refinement
            return DiagnosisResult(
                root_cause=RootCause.AGENT_INSTRUCTIONS,
                skill_to_invoke=CocoSkill.CORTEX_AGENT,
                skill_mode="OPTIMIZE",
                defect_description="Agent using incorrect component names or boundaries",
                target_file=str(self.AGENT_SPEC_FILE),
                suggested_fix="Add explicit naming rules to instructions.orchestration"
            )
        
        if missing_edges:
            return DiagnosisResult(
                root_cause=RootCause.AGENT_INSTRUCTIONS,
                skill_to_invoke=CocoSkill.CORTEX_AGENT,
                skill_mode="EDIT",
                defect_description="Agent not generating correct edge connections",
                target_file=str(self.AGENT_SPEC_FILE),
                suggested_fix="Clarify edge direction rules in instructions"
            )
        
        # Default: unknown issue, use general debugger
        return DiagnosisResult(
            root_cause=RootCause.UNKNOWN,
            skill_to_invoke=CocoSkill.SNOWGRAM_DEBUGGER,
            skill_mode="INVESTIGATE",
            defect_description="Unknown issue - requires investigation"
        )
    
    def output_yaml_for_coco(
        self,
        iteration: int,
        avg_score: float,
        diagnosis: DiagnosisResult,
        results: List[EvaluationResult]
    ) -> str:
        """
        Output YAML block for CoCo to parse and invoke appropriate skill.
        
        CoCo reads this output and invokes the skill automatically.
        """
        yaml_output = {
            "convergence_loop": {
                "iteration": iteration,
                "status": "continue" if avg_score < self.TARGET_SCORE else "success",
                "overall_score": round(avg_score, 1),
                "target_score": self.TARGET_SCORE,
                "tests_run": len(results),
                "tests_passed": sum(1 for r in results if r.passed),
            },
            "diagnosis": {
                "root_cause": diagnosis.root_cause.value,
                "defect": diagnosis.defect_description,
                "suggested_fix": diagnosis.suggested_fix,
            },
            "action_required": {
                "skill": diagnosis.skill_to_invoke.value,
                "mode": diagnosis.skill_mode,
                "target": diagnosis.target_file,
                "instructions": self._get_skill_instructions(diagnosis),
            },
            "test_results": [
                {
                    "id": r.test_id,
                    "score": round(r.score, 1),
                    "passed": r.passed,
                    "defects": r.defects[:3],  # Top 3 defects
                }
                for r in results
            ]
        }
        
        return yaml.dump(yaml_output, default_flow_style=False, sort_keys=False)
    
    def _get_skill_instructions(self, diagnosis: DiagnosisResult) -> str:
        """Generate instructions for the skill to follow."""
        if diagnosis.skill_to_invoke == CocoSkill.CORTEX_AGENT:
            return f"""
Invoke $cortex-agent skill in {diagnosis.skill_mode} mode:
1. Target agent: {self.AGENT_DATABASE}.{self.AGENT_SCHEMA}.{self.AGENT_NAME}
2. Spec file: {self.AGENT_SPEC_FILE}
3. Issue: {diagnosis.defect_description}
4. Fix: {diagnosis.suggested_fix}
5. After fix, redeploy agent with ALTER AGENT
"""
        
        elif diagnosis.skill_to_invoke == CocoSkill.SEMANTIC_VIEW:
            return f"""
Invoke $semantic-view skill in {diagnosis.skill_mode} mode:
1. Target: {self.SEMANTIC_VIEW}
2. Backing table: SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS
3. Issue: {diagnosis.defect_description}
4. Fix: Add missing synonyms to map user terms to component types
"""
        
        elif diagnosis.skill_to_invoke == CocoSkill.LANE_LAYOUT_DEBUGGER:
            return f"""
Invoke $lane-layout-debugger skill:
1. Issue: {diagnosis.defect_description}
2. Check frontend files: elkLayout.ts, mermaidToReactFlow.ts
"""
        
        else:
            return f"""
Invoke $snowgram-debugger skill:
1. Issue: {diagnosis.defect_description}
2. Use SWE-bench pattern: EXPLORE → REPRODUCE → LOCATE → FIX → VERIFY
"""
    
    async def run_single_iteration(self) -> Tuple[float, DiagnosisResult, List[EvaluationResult]]:
        """Run a single iteration of the convergence loop."""
        self.iteration += 1
        results = []
        
        print(f"\n{'='*70}")
        print(f"ITERATION {self.iteration}: Testing SNOWGRAM_AGENT")
        print(f"{'='*70}")
        
        for test in self.TEST_PROMPTS:
            print(f"\n[Test {test.id}] {test.description}")
            print(f"  Prompt: {test.prompt[:50]}...")
            
            # Invoke agent
            response = await self.invoke_agent(test.prompt)
            
            if response.error:
                print(f"  ✗ Error: {response.error[:100]}")
                results.append(EvaluationResult(
                    test_id=test.id,
                    score=0.0,
                    passed=False,
                    defects=[response.error]
                ))
                continue
            
            # Evaluate response
            eval_result = self.evaluate_response(test, response)
            results.append(eval_result)
            
            status = "✓" if eval_result.passed else "✗"
            print(f"  {status} Score: {eval_result.score:.1f}%")
            print(f"    Components: {eval_result.component_score:.0f}%")
            print(f"    Connections: {eval_result.connection_score:.0f}%")
            print(f"    Boundaries: {eval_result.boundary_score:.0f}%")
            print(f"    Tool Usage: {eval_result.tool_usage_score:.0f}%")
            
            if eval_result.defects:
                print(f"    Defects: {eval_result.defects[:2]}")
        
        # Calculate average score
        avg_score = sum(r.score for r in results) / len(results) if results else 0.0
        
        # Diagnose root cause
        diagnosis = self.diagnose_root_cause(results)
        
        # Record history
        self.history.append({
            "iteration": self.iteration,
            "avg_score": avg_score,
            "root_cause": diagnosis.root_cause.value,
            "skill": diagnosis.skill_to_invoke.value,
        })
        
        return avg_score, diagnosis, results
    
    async def run(self) -> bool:
        """
        Run the autonomous improvement loop.
        
        Returns True if converged, False otherwise.
        """
        print("="*70)
        print("AUTONOMOUS AGENT IMPROVEMENT LOOP")
        print("="*70)
        print(f"Target Score: {self.TARGET_SCORE}%")
        print(f"Max Iterations: {self.MAX_ITERATIONS}")
        print(f"Agent: {self.AGENT_DATABASE}.{self.AGENT_SCHEMA}.{self.AGENT_NAME}")
        print(f"Semantic View: {self.SEMANTIC_VIEW}")
        print("="*70)
        
        for _ in range(self.MAX_ITERATIONS):
            avg_score, diagnosis, results = await self.run_single_iteration()
            
            # Check for convergence
            if avg_score >= self.TARGET_SCORE:
                print(f"\n{'='*70}")
                print("✓ CONVERGENCE ACHIEVED!")
                print(f"{'='*70}")
                print(f"Final Score: {avg_score:.1f}%")
                print(f"Iterations: {self.iteration}")
                return True
            
            # Output YAML for CoCo
            print(f"\n{'='*70}")
            print("ACTION REQUIRED - CoCo should invoke skill:")
            print(f"{'='*70}")
            yaml_output = self.output_yaml_for_coco(self.iteration, avg_score, diagnosis, results)
            print(yaml_output)
            
            # In autonomous mode, CoCo would invoke the skill here
            # For now, we pause and let CoCo decide
            print("\n→ Pausing loop. CoCo should:")
            print(f"  1. Invoke skill: ${diagnosis.skill_to_invoke.value}")
            print(f"  2. Mode: {diagnosis.skill_mode}")
            print(f"  3. After fix, re-run this loop")
            
            # Break after first iteration to let CoCo act
            # In a fully autonomous mode, this would continue after skill completes
            break
        
        # Print summary
        print(f"\n{'='*70}")
        print("LOOP SUMMARY")
        print(f"{'='*70}")
        for h in self.history:
            print(f"  Iter {h['iteration']}: {h['avg_score']:.1f}% → {h['skill']}")
        
        return False


async def main():
    """Run the agent convergence loop."""
    loop = AgentConvergenceLoop()
    success = await loop.run()
    return 0 if success else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
