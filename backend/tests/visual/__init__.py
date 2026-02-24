"""
Visual Testing Module for SnowGram
===================================

This module provides tools for automated visual evaluation and
optimization of SnowGram architecture diagrams.

Components:
    - eval_passes: 6-pass visual evaluator
    - skill_triggers: Auto-trigger skills based on scores
    - convergence_loop: Autonomous refinement loop
    - capture_diagram: Playwright screenshot capture

Usage:
    from visual import ConvergenceLoop, VisualEvaluator
    
    # Run convergence loop
    loop = ConvergenceLoop(template_id="STREAMING_DATA_STACK")
    result = await loop.run()
    
    # Or run single evaluation
    evaluator = VisualEvaluator(reference_path, generated_path, mermaid_code)
    eval_result = await evaluator.evaluate()
"""

from .eval_passes import (
    VisualEvaluator,
    EvalResult,
    PassResult,
    EvalPass
)

from .skill_triggers import (
    SkillTrigger,
    FixAction
)

from .convergence_loop import (
    ConvergenceLoop
)

__all__ = [
    "VisualEvaluator",
    "EvalResult", 
    "PassResult",
    "EvalPass",
    "SkillTrigger",
    "FixAction",
    "ConvergenceLoop"
]
