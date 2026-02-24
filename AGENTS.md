# SnowGram Autonomous Improvement Loop

This document is the **authoritative source** for the autonomous feedback loop that improves SnowGram's AI-powered diagram generation. CoCo reads this file to determine agent invocation, root cause analysis, and improvement actions.

---

## System Architecture

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │              SNOWGRAM AI GENERATION STACK                   │
                    │                                                             │
     User Query     │   ┌─────────────────┐    ┌─────────────────────────────┐   │
    ─────────────────▶  │  CORTEX AGENT   │───▶│      AGENT TOOLS            │   │
                    │   │  (SNOWGRAM_     │    │  ┌─────────────────────────┐│   │
                    │   │   AGENT)        │    │  │ SUGGEST_COMPONENTS_JSON ││   │
                    │   └────────┬────────┘    │  │ GENERATE_MERMAID        ││   │
                    │            │             │  │ VALIDATE_SYNTAX         ││   │
                    │            │             │  └─────────────────────────┘│   │
                    │            ▼             └──────────────┬──────────────┘   │
                    │   ┌─────────────────┐                   │                  │
                    │   │  SEMANTIC VIEW  │◀──────────────────┘                  │
                    │   │ (COMPONENT_MAP_ │    Queries semantic view             │
                    │   │   SV)           │    for component mappings            │
                    │   └─────────────────┘                                      │
                    └─────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ Generates
                    ┌───────────────────────────────────────┐
                    │         DIAGRAM OUTPUT                │
                    │  ┌─────────────┐  ┌─────────────────┐ │
                    │  │ ReactFlow   │  │  Mermaid        │ │
                    │  │ JSON        │  │  (fallback)     │ │
                    │  └─────────────┘  └─────────────────┘ │
                    └───────────────────────────────────────┘
```

---

## Core Components to Improve

### 1. Cortex Agent (`SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT`)

**Spec File**: `/Users/abannerjee/Documents/SnowGram/agent_spec_v5.yaml`
**Deploy Command**: `ALTER AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT SET AGENT_SPEC = '...'`

**Improvement Areas**:
- `instructions.orchestration` - Natural language guidance
- `tools` - Tool definitions and descriptions
- `tool_resources` - SQL queries, function identifiers

**Defect Indicators**:
- Agent returns wrong component types
- Agent doesn't call tools in correct order
- Agent misclassifies request type (diagram vs knowledge)

### 2. Semantic View (`SNOWGRAM_DB.CORE.COMPONENT_MAP_SV`)

**Backing Table**: `SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS`
**DDL Location**: Can query via `GET_DDL('SEMANTIC VIEW', ...)`

**Improvement Areas**:
- Add new synonyms for unrecognized user terms
- Update dimension descriptions
- Add metrics for usage tracking

**Defect Indicators**:
- User term not found in synonym lookup
- Wrong component type returned for known term
- Missing dimension for filtering

### 3. Agent Tools (Snowflake Functions)

**Functions**:
| Function | Location | Purpose |
|----------|----------|---------|
| `SUGGEST_COMPONENTS_JSON` | `SNOWGRAM_DB.CORE` | Returns pre-consolidated components |
| `GENERATE_MERMAID_FROM_COMPONENTS` | `SNOWGRAM_DB.CORE` | Creates Mermaid syntax |
| `VALIDATE_MERMAID_SYNTAX` | `SNOWGRAM_DB.CORE` | Validates diagram syntax |
| `WEB_SEARCH` | `SNOWGRAM_DB.CORE` | Searches external tool docs |
| `GET_ARCHITECTURE_BEST_PRACTICE` | `SNOWGRAM_DB.CORE` | Retrieves cached patterns |

**Defect Indicators**:
- Function returns empty or incomplete results
- Function SQL has incorrect joins
- Function doesn't handle edge cases

---

## Autonomous Improvement Loop

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         AUTONOMOUS IMPROVEMENT LOOP                              │
│                                                                                  │
│  ┌──────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌────────┐  │
│  │  INVOKE  │───▶│  EVALUATE │───▶│  DIAGNOSE │───▶│  IMPROVE  │───▶│ VERIFY │  │
│  │  Agent   │    │  Output   │    │  Root     │    │  Target   │    │ Change │  │
│  └──────────┘    └───────────┘    │  Cause    │    │  System   │    └───┬────┘  │
│       ▲                           └───────────┘    └───────────┘        │       │
│       │                                                                 │       │
│       └─────────────────────────────────────────────────────────────────┘       │
│                            CONTINUE if not converged                            │
│                                                                                  │
│                            EXIT when quality >= 95%                              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Phase 1: INVOKE - Call the Cortex Agent

```python
# Call agent with test prompt
response = await snowgram_agent.run(
    prompt="Create a medallion lakehouse architecture with CDC"
)
```

### Phase 2: EVALUATE - Assess Output Quality

**6-Pass Evaluation**:

| Pass | Weight | What It Checks |
|------|--------|----------------|
| Components | 25% | All expected components present and correctly named |
| Connections | 20% | Edges represent correct data flow |
| Structure | 15% | Proper grouping and hierarchy |
| Layout | 15% | Visual positioning (lanes, sections) |
| Styling | 15% | Correct component types and visual styles |
| Badges | 10% | Section badges and annotations |

**Scoring**:
- 95%+ = Converged (EXIT SUCCESS)
- 80-94% = Minor fixes needed
- <80% = Major investigation required

### Phase 3: DIAGNOSE - Root Cause Analysis

**Decision Tree**:

```
IF component_names_wrong:
    ROOT_CAUSE = "agent_instructions"
    TARGET = agent_spec_v5.yaml:instructions.orchestration
    
ELIF components_missing:
    IF user_term_not_in_synonyms:
        ROOT_CAUSE = "semantic_view"
        TARGET = COMPONENT_SYNONYMS table
    ELSE:
        ROOT_CAUSE = "suggest_function"
        TARGET = SUGGEST_COMPONENTS_JSON function
        
ELIF connections_wrong:
    ROOT_CAUSE = "agent_instructions"
    TARGET = agent_spec_v5.yaml (edge direction guidance)
    
ELIF tool_not_called:
    ROOT_CAUSE = "agent_tool_config"
    TARGET = agent_spec_v5.yaml:tools section
    
ELIF layout_broken:
    ROOT_CAUSE = "frontend_code"
    TARGET = elkLayout.ts, mermaidToReactFlow.ts
```

### Phase 4: IMPROVE - Apply Fixes

**Based on Root Cause**:

| Root Cause | Improvement Action | Agent to Invoke |
|------------|-------------------|-----------------|
| `agent_instructions` | Edit agent_spec_v5.yaml, redeploy | `$cortex-agent` skill |
| `semantic_view` | INSERT INTO COMPONENT_SYNONYMS | `$semantic-view` skill |
| `suggest_function` | ALTER FUNCTION with fixed SQL | `$snowgram-debugger` |
| `agent_tool_config` | Update tool_resources in spec | `$cortex-agent` skill |
| `frontend_code` | Edit TypeScript files | `$lane-layout-debugger` |

### Phase 5: VERIFY - Test the Improvement

1. If agent spec changed → Redeploy with `ALTER AGENT`
2. Re-run the same test prompt
3. Re-evaluate with 6-pass scoring
4. Compare scores before/after

---

## Bundled CoCo Skills (Global)

These skills are **bundled with Cortex Code** and available globally. The convergence loop invokes them via the `skill` tool.

### `$cortex-agent` (Agent Optimization)

**CoCo Bundled Skill** - Full agent lifecycle management with OPTIMIZE workflow.

**Location**: `~/.local/share/cortex/.../bundled_skills/cortex-agent`

**Invoke When**:
- Agent returns wrong component names
- Agent doesn't call tools correctly
- Agent misinterprets request type

**Key Workflows**:
| Intent | Sub-Skill | Triggers |
|--------|-----------|----------|
| OPTIMIZE | `optimize-cortex-agent/SKILL.md` | "improve accuracy", "production ready" |
| DEBUG | `debug-single-query-for-cortex-agent/SKILL.md` | "debug query", "why did this fail" |
| EDIT | `edit-cortex-agent/SKILL.md` | "edit agent", "update instructions" |
| EVALUATE | `evaluate-cortex-agent/SKILL.md` | "benchmark", "measure accuracy" |

**Invocation from Convergence Loop**:
```python
# CoCo will load the skill and enter OPTIMIZE mode
skill("cortex-agent")
# Then describe the defect for targeted optimization
```

**Target for SnowGram**:
- Agent: `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT`
- Spec File: `/Users/abannerjee/Documents/SnowGram/agent_spec_v5.yaml`

### `$semantic-view` (Semantic View Optimization)

**CoCo Bundled Skill** - Semantic view creation, audit, debug, and optimization.

**Location**: `~/.local/share/cortex/.../bundled_skills/semantic-view`

**Invoke When**:
- User term not found in synonym lookup
- Cortex Analyst queries return incomplete data
- Component type mapping incorrect

**Key Workflows**:
| Mode | Sub-Skill | Purpose |
|------|-----------|---------|
| AUDIT | `audit/SKILL.md` | Comprehensive audit with VQR testing |
| DEBUG | `debug/SKILL.md` | Targeted problem-solving for SQL generation |
| CREATE | `creation/SKILL.md` | Build new semantic view from scratch |

**Invocation from Convergence Loop**:
```python
# CoCo will load the skill and enter DEBUG mode
skill("semantic-view")
# Then describe the failing query for targeted fix
```

**Target for SnowGram**:
- Semantic View: `SNOWGRAM_DB.CORE.COMPONENT_MAP_SV`
- Backing Table: `SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS`

### `$lane-layout-debugger` (Frontend Layout)

**Invoke When**:
- Visual layout incorrect (overlapping, scattered)
- Lane badges not positioned correctly
- Subgraph detection failing

**Target Files**:
- `frontend/src/lib/elkLayout.ts`
- `frontend/src/lib/mermaidToReactFlow.ts`
- `frontend/src/App.tsx`

**Decision Tree**: (See existing AGENTS.md)

### `$snowgram-debugger` (General Debugging)

**Invoke When**:
- Function errors
- Test failures
- Issues not covered by specialized skills

**Uses**: SWE-bench debugging pattern

---

## Trigger Matrix

| Defect Type | Root Cause | Skill | Priority |
|-------------|------------|-------|----------|
| Wrong component names | Agent instructions | `$cortex-agent` | 1 |
| Missing components | Semantic view or function | `$semantic-view` | 2 |
| Wrong connections | Agent instructions | `$cortex-agent` | 3 |
| Tool not called | Agent tool config | `$cortex-agent` | 4 |
| Layout broken | Frontend code | `$lane-layout-debugger` | 5 |
| Function error | Function SQL | `$snowgram-debugger` | 6 |

---

## Inter-Agent Communication Protocol

When a skill completes, it **MUST** output YAML for the loop to parse:

```yaml
---
skill: <skill-name>
status: <success|partial|failed|escalate>
iterations: <N>
root_cause: <agent_instructions|semantic_view|suggest_function|frontend_code>
target_changed:
  - type: <file|table|function|agent>
    path: <path or identifier>
    change: <description>
score_before: <X%>
score_after: <Y%>
next_action: <continue|exit|escalate>
escalate_to: <skill-name or null>
---
```

---

## Test Prompts for Validation

Use these prompts to verify improvements:

| Test ID | Prompt | Expected Components |
|---------|--------|---------------------|
| T1 | "Create a medallion lakehouse" | Bronze Layer, Silver Layer, Gold Layer, CDC Stream, Transform Task |
| T2 | "Build a streaming data pipeline" | Kafka, Snowpipe Streaming, Raw Tables, Analytics Views |
| T3 | "Design BI analytics architecture" | Gold Layer, Analytics Views, Materialized View, Dashboard |
| T4 | "Create IoT data pipeline" | IoT Gateway, Kinesis, Snowpipe, Time Series Tables |

---

## Exit Conditions

### SUCCESS
- [ ] Overall weighted score >= 95%
- [ ] All 6 passes above their thresholds
- [ ] Agent correctly calls tools in order
- [ ] Semantic view returns correct mappings
- [ ] No regressions in existing test prompts

### FAILURE (Escalate to User)
- [ ] 10 improvement iterations with no progress
- [ ] Root cause requires manual decision (ambiguous requirement)
- [ ] Destructive change needed (DROP TABLE, etc.)
- [ ] Agent spec change breaks existing functionality

---

## File References

| File | Purpose | When to Modify |
|------|---------|----------------|
| `agent_spec_v5.yaml` | Agent instructions and tool config | Wrong component names, tool order |
| `deploy_agent_v4.sql` | Agent deployment SQL | After any spec change |
| `COMPONENT_SYNONYMS` table | User term → component mappings | Missing synonyms |
| `COMPONENT_MAP_SV` view | Semantic view for queries | After table changes |
| `SUGGEST_COMPONENTS_JSON` | Component suggestion function | Incomplete results |
| `elkLayout.ts` | Visual layout algorithm | Positioning issues |
| `mermaidToReactFlow.ts` | Mermaid parsing | Label/metadata issues |

---

## Quick Reference: Improvement Commands

### Redeploy Agent After Spec Change
```bash
# Generate compact JSON from YAML
python -c "import yaml, json; print(json.dumps(yaml.safe_load(open('agent_spec_v5.yaml'))))" > agent_spec_v5.json

# Deploy via SQL
snow sql -q "ALTER AGENT SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT SET AGENT_SPEC = '\$(cat agent_spec_v5.json)'"
```

### Add Synonym to Semantic View
```sql
INSERT INTO SNOWGRAM_DB.CORE.COMPONENT_SYNONYMS 
VALUES ('new_term', 'sf_component_type', 100);
```

### Test Agent Response
```bash
snow cortex agent run SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT "Create medallion architecture"
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-02-23 | Complete rewrite: Added Cortex Agent, Semantic View, and Tool improvement paths |
| 1.0 | 2026-02-23 | Initial visual-only convergence loop |
