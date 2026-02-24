# SnowGram Skills & Agents Registry

> Last Updated: Feb 23, 2026
> Status: Complete autonomous improvement loop with bundled CoCo skills + project agents

---

## Architecture Overview

The autonomous improvement loop uses **three tiers** of skills/agents:

```
┌─────────────────────────────────────────────────────────────────────────┐
│              AUTONOMOUS IMPROVEMENT LOOP ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  TIER 1: CoCo BUNDLED SKILLS (Global)                                   │
│  ─────────────────────────────────────                                  │
│  $cortex-agent     → Optimize SNOWGRAM_AGENT instructions/tools         │
│  $semantic-view    → Optimize COMPONENT_MAP_SV semantic view            │
│                                                                         │
│  TIER 2: PROJECT SKILLS (Guide Conversation)                            │
│  ────────────────────────────────────────────                           │
│  $snowgram-debugger       → General bug fixes                           │
│  $lane-layout-debugger    → Frontend layout issues                      │
│  $snowgram-architect      → Generate architecture diagrams              │
│                                                                         │
│  TIER 3: CUSTOM AGENTS (Autonomous Background)                          │
│  ─────────────────────────────────────────────                          │
│  snowgram-debugger        → SWE-bench pattern autonomous debug          │
│  lane-layout-debugger     → Layout-specific autonomous debug            │
│  visual-layout-debugger   → Visual comparison autonomous debug          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Tier 1: CoCo Bundled Skills (Global)

These are **installed with Cortex Code** and available in any project.

| Skill | Invocation | Purpose | SnowGram Target |
|-------|------------|---------|-----------------|
| `cortex-agent` | `$cortex-agent` | Full agent lifecycle: create, edit, optimize, evaluate | `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT` |
| `semantic-view` | `$semantic-view` | Semantic view creation, audit, debug | `SNOWGRAM_DB.CORE.COMPONENT_MAP_SV` |

### When to Use Bundled Skills

| Defect Type | Root Cause | Skill | Mode |
|-------------|------------|-------|------|
| Wrong component names | Agent instructions | `$cortex-agent` | OPTIMIZE |
| Agent not calling tools | Tool descriptions | `$cortex-agent` | DEBUG |
| User term not found | Semantic view synonyms | `$semantic-view` | DEBUG |
| Wrong component mapping | Semantic view data | `$semantic-view` | AUDIT |

---

## Tier 2: Project Skills (Guide Conversation)

| Skill | Invocation | Lines | Location |
|-------|------------|-------|----------|
| `snowgram-debugger` | `$snowgram-debugger` | 416 | `.cortex/skills/` |
| `lane-layout-debugger` | `$lane-layout-debugger` | 206 | `.cortex/skills/` |

**Per CoCo Guide**: Skills in `.cortex/skills/` are auto-discovered with Priority 1 and invoked via `$skill-name`.

---

## Custom Agents (Autonomous Background Execution)

| Agent | Spawn Command | Lines | Location |
|-------|---------------|-------|----------|
| `snowgram-debugger` | `Task tool, subagent_type: "snowgram-debugger"` | 161 | `.cortex/agents/` |
| `lane-layout-debugger` | `Task tool, subagent_type: "lane-layout-debugger"` | 187 | `.cortex/agents/` |

### How to Spawn Autonomous Agents

```
Launch a snowgram-debugger agent in the background to investigate the bug.
```

Or explicitly:
```
Use the Task tool with:
- subagent_type: "snowgram-debugger"
- run_in_background: true
- prompt: "Debug the lane layout issue - badges not appearing"
```

---

## Loop Automation Triggers

Based on Anthropic's **Evaluator-Optimizer** pattern (Dec 2024):

### CONTINUE Loop Triggers

The agent re-enters the debug loop if ANY of these are true:

| Trigger | Condition | Action |
|---------|-----------|--------|
| `TEST_FAILURE` | `npm test` fails | Analyze → LOCATE → FIX → VERIFY |
| `REPRODUCTION_STILL_FAILS` | Bug script shows error | Re-analyze → different fix |
| `NEW_ERROR_INTRODUCED` | Different error appears | Create new reproduction |
| `PARTIAL_FIX` | Some cases pass, others don't | Add edge case handling |
| `METRICS_WRONG` | Expected values not met | Consult decision tree |

### EXIT Loop Triggers

Agent completes task only when ALL of these are true:

| Trigger | Condition |
|---------|-----------|
| `TESTS_PASS` | All tests pass (0 failures) |
| `REPRODUCTION_FIXED` | Bug script shows expected output |
| `NO_REGRESSIONS` | No new errors introduced |
| `METRICS_CORRECT` | All expected values met |

### Self-Evaluation Prompt (End of Each Loop)

```
After VERIFY phase, evaluate:

1. Does reproduction script show bug is fixed? [YES/NO]
2. Do all tests pass? [YES/NO]
3. Did I introduce new errors? [YES/NO]
4. Are there unconsidered edge cases? [YES/NO]

If any NO → Re-enter loop at appropriate phase
If all YES → Task complete, report results
```

---

## Best Practices Applied

### Anthropic Research (2024-2025)

| Pattern | Source | Implementation |
|---------|--------|----------------|
| Minimal scaffolding | SWE-bench (Jan 2025) | Agent decides workflow |
| Model-driven workflow | SWE-bench | No hardcoded transitions |
| Evaluator-Optimizer | Building Effective Agents (Dec 2024) | Loop automation triggers |
| Tool descriptions | SWE-bench | Detailed tool specs |

### Cortex Code (2026)

| Pattern | Source | Implementation |
|---------|--------|----------------|
| Stopping points | SKILL_BEST_PRACTICES | 3 points per skill |
| Decision tree routing | SKILL_BEST_PRACTICES | Entry point routing |
| Sub-skill hierarchy | SKILL_BEST_PRACTICES | Parent-child relationship |
| Frontmatter format | SKILLS.md | name, description, tools |

---

## Directory Structure

```
/Users/abannerjee/Documents/SnowGram/
├── .cortex/
│   ├── skills/                    # Skills (guide conversation)
│   │   ├── snowgram-debugger/
│   │   │   └── SKILL.md          # 416 lines
│   │   ├── lane-layout-debugger/
│   │   │   └── SKILL.md          # 206 lines
│   │   └── SKILLS_REGISTRY.md    # This file
│   │
│   └── agents/                    # Custom Agents (autonomous)
│       ├── snowgram-debugger.md   # 161 lines
│       └── lane-layout-debugger.md # 187 lines

~/.snowflake/cortex/
├── skills/                        # Global skills (backup)
│   ├── snowgram-debugger/
│   └── lane-layout-debugger/
│
└── agents/                        # Global agents (backup)
    ├── snowgram-debugger/
    └── lane-layout-debugger/
```

---

## Invocation Quick Reference

| Task | Method | Command |
|------|--------|---------|
| Debug with guidance | Skill | `$snowgram-debugger "bug description"` |
| Debug autonomously | Agent | "Launch snowgram-debugger agent in background" |
| Layout bug (guided) | Skill | `$lane-layout-debugger "badges missing"` |
| Layout bug (autonomous) | Agent | "Spawn lane-layout-debugger to investigate" |
| Architecture diagram | Skill | `$snowgram-architect "medallion architecture"` |

---

## Validation Summary

| Component | Status | Test |
|-----------|--------|------|
| Skills frontmatter | ✅ | Valid YAML |
| Skills location | ✅ | `.cortex/skills/` Priority 1 |
| Agents frontmatter | ✅ | Valid YAML |
| Agents location | ✅ | `.cortex/agents/` |
| Loop triggers | ✅ | Evaluator-Optimizer pattern |
| SWE-bench workflow | ✅ | EXPLORE→REPRODUCE→LOCATE→FIX→VERIFY |
| Stopping points | ✅ | 3 per skill/agent |
| Decision trees | ✅ | Entry point routing |
| Frontend tests | ✅ | 245/245 pass |
