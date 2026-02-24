#!/usr/bin/env python3
"""
Autonomous Convergence Loop for SnowGram Diagrams
=================================================

Iteratively generates, renders, and evaluates Mermaid diagrams until
reaching the 95% quality target or max iterations.

Integrates with AGENTS.md trigger matrix to determine which CoCo agent
to invoke when passes fail. Outputs YAML for CoCo to parse.

CRITICAL: This loop achieves quality through ACTUAL FIXES, not threshold manipulation.
"""

import asyncio
import json
import os
import subprocess
import sys
import yaml
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent))

from eval_passes import VisualEvaluator, EvalResult
from skill_triggers import SkillTrigger


class ConvergenceLoop:
    """
    Autonomous convergence loop for diagram generation.
    
    Follows AGENTS.md protocol:
    1. EVALUATE - Run 6-pass visual evaluation
    2. TRIGGER - Consult trigger matrix, determine agent to invoke
    3. OUTPUT - Emit YAML for CoCo to parse and invoke agent
    """
    
    MAX_ITERATIONS = 10
    TARGET_SCORE = 95.0
    
    # Trigger matrix from AGENTS.md
    TRIGGER_MATRIX = {
        "layout": {"threshold": 70, "agent": "lane-layout-debugger", "priority": 1},
        "structure": {"threshold": 80, "agent": "snowgram-debugger", "priority": 2},
        "connections": {"threshold": 85, "agent": None, "priority": 3},  # Direct fix
        "styling": {"threshold": 80, "agent": None, "priority": 4},      # Direct fix
        "badges": {"threshold": 90, "agent": None, "priority": 5},       # Direct fix
        "components": {"threshold": 90, "agent": None, "priority": 6},   # Docs search
    }
    
    # Paths
    BASE_DIR = Path(__file__).parent
    REFERENCE_IMAGE = BASE_DIR / "reference_images" / "reference_page4.png"
    OUTPUT_DIR = BASE_DIR / "output"
    
    # Initial Mermaid template based on reference PDF
    # Uses horizontal lanes with proper badge positioning
    INITIAL_TEMPLATE = '''flowchart LR
    %% ═══════════════════════════════════════════════════════════════════
    %% STREAMING DATA STACK REFERENCE ARCHITECTURE
    %% Horizontal Lane Layout - Matching Reference PDF Page 4
    %% ═══════════════════════════════════════════════════════════════════

    %% ─────────────────────────────────────────────────────────────────
    %% LANE 1a: Streaming Services Path (Top Lane)
    %% Badge -> Producer -> Streaming Services -> Kafka Connector
    %% ─────────────────────────────────────────────────────────────────
    subgraph lane_1a[" "]
        direction LR
        badge_1a(["1a"]):::laneBadge
        producer["Producer\\nApp"]:::external
        subgraph streaming_svcs["Streaming"]
            kafka["Kafka"]:::streaming
            firehose["Amazon Data\\nFirehose"]:::streaming
            kinesis["Amazon\\nKinesis"]:::streaming
            eventhubs["Azure\\nEvent Hubs"]:::streaming
            pubsub["Google\\nPub/Sub"]:::streaming
        end
        kafka_connector["Snowflake Connector\\nfor Kafka"]:::connector
        badge_1a ~~~ producer
    end
    
    %% ─────────────────────────────────────────────────────────────────
    %% LANE 1b: CSP Stream Processing Path
    %% Badge -> CSP Processing -> Streaming Row-set
    %% ─────────────────────────────────────────────────────────────────
    subgraph lane_1b[" "]
        direction LR
        badge_1b(["1b"]):::laneBadge
        subgraph csp_processing["CSP Stream Processing"]
            compute["Compute\\n(VM, Container, Serverless)"]:::processing
        end
        streaming_rowset["Streaming/\\nrow-set"]:::connector
        badge_1b ~~~ compute
    end
    
    %% ─────────────────────────────────────────────────────────────────
    %% LANE 1c: Batch/Files Path (Cloud Storage)
    %% Badge -> Cloud Storage -> Batch/Files
    %% ─────────────────────────────────────────────────────────────────
    subgraph lane_1c[" "]
        direction LR
        badge_1c(["1c"]):::laneBadge
        subgraph cloud_storage["Cloud Storage"]
            s3["Amazon S3"]:::storage
            azure_blob["Azure Blob\\nStorage"]:::storage
            gcs["Google Cloud\\nStorage"]:::storage
        end
        batch_files["Batch/Files"]:::connector
        badge_1c ~~~ s3
    end
    
    %% ─────────────────────────────────────────────────────────────────
    %% LANE 1d: Industry Data Sources (Marketplace)
    %% Badge -> Industry Sources -> Marketplace
    %% ─────────────────────────────────────────────────────────────────
    subgraph lane_1d[" "]
        direction LR
        badge_1d(["1d"]):::laneBadge
        industry_sources["Industry Data Sources/Providers\\nlike ServiceNow, Salesforce, etc."]:::external
        marketplace_badge["Snowflake\\nMARKETPLACE"]:::marketplace
        badge_1d ~~~ industry_sources
    end
    
    %% ═══════════════════════════════════════════════════════════════════
    %% SNOWFLAKE PLATFORM (Center-Right Region)
    %% ═══════════════════════════════════════════════════════════════════
    subgraph snowflake["❄️ snowflake"]
        direction TB
        
        %% Section 2: Ingestion Layer
        subgraph section_2["  "]
            badge_2(["2"]):::sectionBadge
            snowpipe_streaming["Snowpipe Streaming"]:::snowflake_comp
            snowpipe["Snowpipe"]:::snowflake_comp
        end
        
        %% Section 3: Processing Layer  
        subgraph section_3["  "]
            badge_3(["3"]):::sectionBadge
            aggregation["Aggregation Using\\nStreams & Tasks"]:::snowflake_comp
            serverless_tasks["Serverless Tasks"]:::snowflake_comp
        end
        
        %% Section 4: Storage Layer
        subgraph section_4["  "]
            badge_4(["4"]):::sectionBadge
            normalized_tables["Normalized\\nTables"]:::snowflake_comp
            dynamic_tables["Dynamic\\nTables"]:::snowflake_comp
            instant_scale["Instant\\nScalability"]:::snowflake_comp
        end
        
        %% Section 5: Compute Layer
        subgraph section_5["  "]
            badge_5(["5"]):::sectionBadge
            python_sp["Python Stored\\nProcedures"]:::snowflake_comp
            snowpark["Snowpark"]:::snowflake_comp
            spcs["Snowpark Container\\nServices"]:::snowflake_comp
        end
        
        %% Native Connector at bottom
        native_connector["Snowflake Native App Connector\\nfrom Snowflake Marketplace"]:::snowflake_comp
    end
    
    %% ─────────────────────────────────────────────────────────────────
    %% OUTPUT: In-App Analytics (Right Edge)
    %% ─────────────────────────────────────────────────────────────────
    analytics["In-app\\nAnalytics"]:::output
    
    %% ═══════════════════════════════════════════════════════════════════
    %% CONNECTIONS - Left to Right Flow
    %% ═══════════════════════════════════════════════════════════════════
    
    %% Lane 1a flow (badge aligned via subgraph)
    producer --> kafka
    producer --> firehose
    producer --> kinesis
    producer --> eventhubs
    producer --> pubsub
    kafka --> kafka_connector
    firehose --> kafka_connector
    kinesis --> kafka_connector
    eventhubs --> kafka_connector
    pubsub --> kafka_connector
    kafka_connector --> snowpipe_streaming
    
    %% Lane 1b flow
    compute --> streaming_rowset
    streaming_rowset --> snowpipe_streaming
    
    %% Lane 1c flow
    s3 --> batch_files
    azure_blob --> batch_files
    gcs --> batch_files
    batch_files --> snowpipe
    
    %% Lane 1d flow
    industry_sources --> marketplace_badge
    marketplace_badge --> native_connector
    
    %% Internal Snowflake flow
    snowpipe_streaming --> aggregation
    snowpipe --> serverless_tasks
    aggregation --> normalized_tables
    serverless_tasks --> dynamic_tables
    normalized_tables --> instant_scale
    dynamic_tables --> instant_scale
    instant_scale --> python_sp
    instant_scale --> snowpark
    instant_scale --> spcs
    native_connector --> dynamic_tables
    
    %% Output flow
    python_sp --> analytics
    snowpark --> analytics
    spcs --> analytics
    
    %% ═══════════════════════════════════════════════════════════════════
    %% VERTICAL ORDERING (Force lanes to stack top-to-bottom)
    %% ═══════════════════════════════════════════════════════════════════
    lane_1a ~~~ lane_1b
    lane_1b ~~~ lane_1c
    lane_1c ~~~ lane_1d
    
    %% ═══════════════════════════════════════════════════════════════════
    %% STYLING
    %% ═══════════════════════════════════════════════════════════════════
    classDef laneBadge fill:#7C3AED,stroke:#5B21B6,color:#fff,font-weight:bold,font-size:14px
    classDef sectionBadge fill:#2563EB,stroke:#1D4ED8,color:#fff,font-weight:bold,font-size:14px
    classDef external fill:#f3f4f6,stroke:#9ca3af,color:#374151
    classDef streaming fill:#dbeafe,stroke:#3b82f6,color:#1e40af
    classDef processing fill:#fef3c7,stroke:#f59e0b,color:#92400e
    classDef storage fill:#d1fae5,stroke:#10b981,color:#065f46
    classDef marketplace fill:#7C3AED,stroke:#5B21B6,color:#fff
    classDef connector fill:#e5e7eb,stroke:#6b7280,color:#374151
    classDef snowflake_comp fill:#e0f2fe,stroke:#0ea5e9,color:#0369a1
    classDef output fill:#fce7f3,stroke:#ec4899,color:#9d174d
    
    style snowflake fill:#f0f9ff,stroke:#0284c7,stroke-width:3px
    style section_2 fill:#e0f2fe,stroke:#0ea5e9
    style section_3 fill:#e0f2fe,stroke:#0ea5e9
    style section_4 fill:#e0f2fe,stroke:#0ea5e9
    style section_5 fill:#e0f2fe,stroke:#0ea5e9
    style lane_1a fill:#fafafa,stroke:#e5e7eb,stroke-dasharray:5 5
    style lane_1b fill:#fafafa,stroke:#e5e7eb,stroke-dasharray:5 5
    style lane_1c fill:#fafafa,stroke:#e5e7eb,stroke-dasharray:5 5
    style lane_1d fill:#fafafa,stroke:#e5e7eb,stroke-dasharray:5 5
    style streaming_svcs fill:#eff6ff,stroke:#3b82f6
    style csp_processing fill:#fef9c3,stroke:#eab308
    style cloud_storage fill:#dcfce7,stroke:#22c55e
'''

    def __init__(self):
        self.iteration = 0
        self.history: List[Dict[str, Any]] = []
        self.current_mermaid = self.INITIAL_TEMPLATE
        self.OUTPUT_DIR.mkdir(exist_ok=True)
        
    async def render_mermaid(self, mermaid_code: str, output_name: str) -> Optional[Path]:
        """Render Mermaid code to PNG using mermaid-cli."""
        mmd_file = self.OUTPUT_DIR / f"{output_name}.mmd"
        png_file = self.OUTPUT_DIR / f"{output_name}.png"
        
        # Write Mermaid code to file
        mmd_file.write_text(mermaid_code)
        
        try:
            # Render using npx mermaid-cli
            result = subprocess.run(
                ["npx", "--yes", "@mermaid-js/mermaid-cli", 
                 "-i", str(mmd_file), 
                 "-o", str(png_file),
                 "-b", "white",
                 "-w", "1600",
                 "-H", "1200"],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if result.returncode != 0:
                print(f"  ⚠ Mermaid render warning: {result.stderr[:200]}")
            
            if png_file.exists():
                print(f"  ✓ Rendered: {png_file.name}")
                return png_file
            else:
                print(f"  ✗ Render failed: {result.stderr[:200]}")
                return None
                
        except subprocess.TimeoutExpired:
            print("  ✗ Render timeout")
            return None
        except Exception as e:
            print(f"  ✗ Render error: {e}")
            return None
    
    async def evaluate(self, generated_path: Path) -> EvalResult:
        """Run visual evaluation on generated diagram."""
        evaluator = VisualEvaluator(
            reference_image_path=str(self.REFERENCE_IMAGE),
            generated_image_path=str(generated_path),
            mermaid_code=self.current_mermaid,
            target_score=self.TARGET_SCORE
        )
        
        result = await evaluator.evaluate(iteration=self.iteration)
        return result
    
    async def apply_fixes(self, result: EvalResult) -> Dict[str, Any]:
        """
        Determine required fixes based on evaluation result.
        
        Uses SkillTrigger to analyze failing passes and determine:
        1. Which agent to invoke (if any)
        2. Which direct code fixes to apply
        
        Returns YAML-compatible dict for CoCo to parse.
        """
        # Use SkillTrigger to analyze and determine actions
        trigger = SkillTrigger(result, mermaid_code=self.current_mermaid)
        actions = await trigger.determine_actions()
        
        # Find failing passes that need agent intervention
        failing_passes = []
        for pass_name, pr in result.pass_results.items():
            matrix_entry = self.TRIGGER_MATRIX.get(pass_name, {})
            threshold = matrix_entry.get("threshold", 80)
            if pr.score < threshold:
                failing_passes.append({
                    "pass": pass_name,
                    "score": pr.score,
                    "threshold": threshold,
                    "agent": matrix_entry.get("agent"),
                    "priority": matrix_entry.get("priority", 99),
                    "defects": pr.defects[:3]  # Top 3 defects
                })
        
        # Sort by priority
        failing_passes.sort(key=lambda x: x["priority"])
        
        # Determine next action
        next_action = None
        agent_to_invoke = None
        direct_fixes = []
        
        for fp in failing_passes:
            if fp["agent"]:
                # Agent intervention needed
                agent_to_invoke = fp["agent"]
                next_action = "invoke_agent"
                break
            else:
                # Direct code fix possible
                direct_fixes.append(fp["pass"])
        
        if not agent_to_invoke and direct_fixes:
            next_action = "direct_fix"
            # Apply direct fixes via SkillTrigger
            fix_results = await trigger.execute_fixes()
            for pass_name, fix_result in fix_results.items():
                if fix_result.get("modified_code"):
                    self.current_mermaid = fix_result["modified_code"]
        
        # Build output for CoCo
        output = {
            "iteration": self.iteration,
            "score_before": result.overall_score,
            "failing_passes": failing_passes,
            "next_action": next_action or "continue",
            "agent_to_invoke": agent_to_invoke,
            "direct_fixes_applied": direct_fixes if next_action == "direct_fix" else [],
        }
        
        return output
    
    def output_yaml_for_coco(self, status: str, result: EvalResult, action_info: Dict[str, Any]) -> str:
        """
        Output YAML block for CoCo to parse.
        
        Format follows AGENTS.md Inter-Agent Communication protocol.
        """
        yaml_output = {
            "agent": "convergence-loop",
            "status": status,
            "iterations": self.iteration,
            "score_before": self.history[-2]["score"] if len(self.history) > 1 else 0,
            "score_after": result.overall_score,
            "fixes_applied": action_info.get("direct_fixes_applied", []),
            "defects_remaining": [
                d for pr in result.pass_results.values() 
                for d in pr.defects[:2]
            ][:5],
            "next_action": action_info.get("next_action", "continue"),
            "escalate_to": action_info.get("agent_to_invoke"),
        }
        
        yaml_str = yaml.dump(yaml_output, default_flow_style=False, sort_keys=False)
        return f"---\n{yaml_str}---"
    
    def print_iteration_report(self, result: EvalResult):
        """Print formatted iteration report."""
        print("\n" + "─" * 70)
        print(f"ITERATION {self.iteration} RESULTS")
        print("─" * 70)
        print(f"Overall Score: {result.overall_score:.1f}%")
        print(f"Target: {self.TARGET_SCORE}%")
        print(f"Converged: {'✓ YES' if result.converged else '✗ NO'}")
        
        print("\nPass Scores:")
        for name, pr in result.pass_results.items():
            status = "✓" if pr.score >= 80 else "⚠" if pr.score >= 60 else "✗"
            print(f"  {status} {name.upper()}: {pr.score:.0f}% (weighted: {pr.weighted_score:.1f}%)")
        
        # Show top defects
        all_defects = []
        for pr in result.pass_results.values():
            all_defects.extend(pr.defects)
        
        if all_defects:
            print("\nTop Defects:")
            for d in all_defects[:5]:
                print(f"  • {d}")
    
    async def run(self) -> bool:
        """
        Run the convergence loop.
        
        Follows AGENTS.md Autonomous Execution Protocol:
        1. INITIALIZE - Load reference, generate diagram
        2. EVALUATE - Run 6-pass visual evaluation
        3. TRIGGER - Consult trigger matrix
        4. EXECUTE - Apply direct fixes or request agent invocation
        5. VERIFY - Re-evaluate
        6. DECIDE - Continue, exit success, or escalate
        """
        print("=" * 70)
        print("AUTONOMOUS CONVERGENCE LOOP")
        print("=" * 70)
        print(f"Target Score: {self.TARGET_SCORE}%")
        print(f"Max Iterations: {self.MAX_ITERATIONS}")
        print(f"Reference: {self.REFERENCE_IMAGE.name}")
        print("Protocol: AGENTS.md Autonomous Execution")
        print("=" * 70)
        
        converged = False
        agent_requested = None
        
        for self.iteration in range(1, self.MAX_ITERATIONS + 1):
            print(f"\n{'='*70}")
            print(f"ITERATION {self.iteration}/{self.MAX_ITERATIONS}")
            print(f"{'='*70}")
            
            # Step 1: Render current Mermaid
            print("\n[1/4] Rendering Mermaid diagram...")
            output_name = f"streaming_iter_{self.iteration}"
            png_path = await self.render_mermaid(self.current_mermaid, output_name)
            
            if not png_path:
                print("  ✗ FAILED: Could not render diagram")
                continue
            
            # Step 2: Evaluate
            print("\n[2/4] Evaluating visual quality (6-pass)...")
            result = await self.evaluate(png_path)
            
            # Step 3: Report
            self.print_iteration_report(result)
            
            # Record history
            self.history.append({
                "iteration": self.iteration,
                "score": result.overall_score,
                "converged": result.converged,
                "png_path": str(png_path),
                "defects": [d for pr in result.pass_results.values() for d in pr.defects]
            })
            
            # Step 4: Check convergence (EXIT_SUCCESS)
            if result.converged:
                print(f"\n{'='*70}")
                print("✓ CONVERGENCE ACHIEVED!")
                print(f"{'='*70}")
                print(f"Final Score: {result.overall_score:.1f}%")
                print(f"Iterations: {self.iteration}")
                print(f"Output: {png_path}")
                
                # Output YAML for CoCo
                yaml_output = self.output_yaml_for_coco("success", result, {})
                print(f"\n{yaml_output}")
                
                converged = True
                break
            
            # Step 5: Determine fixes (TRIGGER phase)
            print("\n[3/4] Consulting AGENTS.md trigger matrix...")
            action_info = await self.apply_fixes(result)
            
            # Step 6: Handle agent invocation request (ESCALATE)
            if action_info.get("next_action") == "invoke_agent":
                agent_requested = action_info.get("agent_to_invoke")
                failing_pass = action_info.get("failing_passes", [{}])[0]
                
                print(f"\n{'='*70}")
                print(f"⚠ AGENT INVOCATION REQUIRED: {agent_requested}")
                print(f"{'='*70}")
                print(f"Failing Pass: {failing_pass.get('pass', 'unknown')}")
                print(f"Score: {failing_pass.get('score', 0):.0f}% (threshold: {failing_pass.get('threshold', 0)}%)")
                print(f"Defects: {failing_pass.get('defects', [])[:2]}")
                
                # Output YAML for CoCo to invoke agent
                yaml_output = self.output_yaml_for_coco("escalate", result, action_info)
                print(f"\n{yaml_output}")
                
                # Pause loop - CoCo will invoke agent and resume
                print(f"\n→ CoCo should invoke: Task(subagent_type='{agent_requested}')")
                print(f"→ After agent completes, re-run convergence loop")
                break
            
            # Step 7: Direct fixes applied, continue loop
            if action_info.get("next_action") == "direct_fix":
                fixes = action_info.get("direct_fixes_applied", [])
                print(f"\n[4/4] Applied direct fixes: {fixes}")
            
            if self.iteration < self.MAX_ITERATIONS:
                print(f"\n→ Proceeding to iteration {self.iteration + 1}")
        
        # Final summary
        print("\n" + "=" * 70)
        print("CONVERGENCE LOOP SUMMARY")
        print("=" * 70)
        
        if converged:
            print("Status: ✓ SUCCESS - Quality target achieved")
        elif agent_requested:
            print(f"Status: ⏸ PAUSED - Awaiting agent: {agent_requested}")
            print("Action: CoCo should invoke the agent, then re-run this loop")
        else:
            print("Status: ⚠ MAX ITERATIONS REACHED")
            if self.history:
                best = max(self.history, key=lambda h: h["score"])
                print(f"Best Score: {best['score']:.1f}% (iteration {best['iteration']})")
        
        print("\nIteration History:")
        for h in self.history:
            status = "✓" if h["converged"] else "○"
            print(f"  {status} Iter {h['iteration']}: {h['score']:.1f}%")
        
        return converged


async def main():
    """Run the convergence loop."""
    loop = ConvergenceLoop()
    success = await loop.run()
    return 0 if success else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
