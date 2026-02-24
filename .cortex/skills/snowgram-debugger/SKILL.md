---
name: snowgram-debugger
description: "Generalized autonomous debug loop for the entire SnowGram codebase. Use when: any bug, error, test failure, or unexpected behavior. Triggers: debug, fix bug, error, failing test, broken, not working, investigate, diagnose."
tools: ["bash", "read", "edit", "write", "task", "grep", "glob", "snowflake_sql_execute"]
---

# SnowGram Autonomous Debug Loop

> **Architecture**: Anthropic SWE-bench Agent Pattern (Jan 2025) + Claude Code Skills (2026)
> **Principle**: Minimal scaffolding, maximum model control, deterministic verification

---

## ⚡ Entry Point: Route to Correct Sub-Skill

**Load this decision tree FIRST before proceeding:**

```
ANALYZE user's bug description:

IF mentions "lane", "badge", "layout", "section", "streaming diagram", "nodes scattered":
    → LOAD $lane-layout-debugger (specialized for layout issues)
    → EXIT this skill
    
ELIF mentions "agent", "Cortex Agent", "response", "tool call", "semantic model":
    → Continue below with agent-specific patterns
    
ELIF mentions "test", "npm test", "vitest", "jest", "failing test":
    → Continue below with test debugging patterns
    
ELSE:
    → Continue below with general SWE-bench pattern
```

---

## Design Philosophy (2025-2026 Best Practices)

Based on Anthropic's SWE-bench state-of-the-art agent (49% solve rate):

> "Our design philosophy was to give as much control as possible to the language model itself, and keep the scaffolding minimal."

| Principle | Implementation |
|-----------|----------------|
| **Minimal scaffolding** | No complex orchestration - single agent with tools |
| **Model-driven workflow** | Agent decides exploration strategy, not hardcoded |
| **Bash + Edit tools** | Same tools that achieved SOTA on SWE-bench |
| **Context awareness** | Uses CLAUDE.md + MEMORY.md for project context |
| **Verification-first** | Create reproduce script, confirm fix works |

---

## Entry Point: Describe the Bug

```
$snowgram-debugger

Input: Natural language description of the problem
- "Lane badges not appearing in streaming diagram"
- "Agent returns 'Diagram updated' without code"  
- "Tests failing after dependency update"
- "Component not rendering in dark mode"
```

---

## Autonomous Workflow (SWE-bench Pattern)

The agent follows this suggested approach (but can adapt as needed):

### Step 1: Explore Repository Structure

```bash
# Understand project layout
find /Users/abannerjee/Documents/SnowGram -type f -name "*.ts" | head -20
find /Users/abannerjee/Documents/SnowGram -type f -name "*.tsx" | head -20

# Read project context
cat /Users/abannerjee/Documents/SnowGram/CLAUDE.md
cat /Users/abannerjee/Documents/SnowGram/.cortex/MEMORY.md
```

### Step 2: Create Reproduction Script

```bash
# For frontend bugs: Create test that reproduces the issue
cat > /tmp/reproduce_bug.ts << 'EOF'
// Minimal reproduction of the bug
import { parseMermaidToReactFlow } from './frontend/src/lib/mermaidToReactFlow';

const testMermaid = `flowchart LR
  subgraph path_1a["1a - Kafka Path"]
    A[Node A]
  end
`;

const result = parseMermaidToReactFlow(testMermaid, {}, false);
console.log('Subgraphs:', result.subgraphs?.size);
console.log('LayoutInfo:', result.layoutInfo?.size);
EOF

# Run and confirm the error
npx ts-node /tmp/reproduce_bug.ts
```

### Step 3: Locate and Analyze Source Code

```bash
# Search for relevant code
grep -rn "layoutInfo" frontend/src/lib/
grep -rn "subgraph" frontend/src/lib/mermaidToReactFlow.ts

# Read the identified files
# (Agent uses Read tool with specific line ranges)
```

### Step 4: Edit Source Code to Fix

**⚠️ MANDATORY STOPPING POINT**: Before editing any source file, confirm:
1. Root cause has been identified with evidence
2. The fix approach has been described to user
3. User has acknowledged the proposed change

```bash
# Agent uses Edit tool with str_replace pattern
# old_string must match EXACTLY
# new_string contains the fix
```

### Step 5: Verify Fix

```bash
# Re-run reproduction script
npx ts-node /tmp/reproduce_bug.ts

# Run existing tests
cd /Users/abannerjee/Documents/SnowGram/frontend && npm test

# For agent issues, run agent tests
cd /Users/abannerjee/Documents/SnowGram/backend/tests/agent && python run_tests.py
```

### Step 6: Handle Edge Cases

```bash
# Agent considers additional test cases
# Creates additional reproduction scripts if needed
# Verifies fix doesn't break other functionality
```

---

## Domain-Specific Debug Patterns

### Frontend (React/TypeScript)

| Bug Type | Exploration Strategy | Verification |
|----------|---------------------|--------------|
| Layout issue | Check `elkLayout.ts`, `mermaidToReactFlow.ts` | Visual in browser |
| Component not rendering | Check component file, props, state | React DevTools |
| Styling issue | Check CSS modules, Tailwind classes | Browser DevTools |
| State management | Check Zustand stores, useEffect hooks | Console logs |

```bash
# Frontend-specific commands
cd /Users/abannerjee/Documents/SnowGram/frontend
npm run lint          # Check for syntax errors
npm run type-check    # Check TypeScript types
npm test              # Run Jest tests
```

### Backend (Snowflake/Python)

| Bug Type | Exploration Strategy | Verification |
|----------|---------------------|--------------|
| Agent not responding | Check agent spec in Snowflake | Run agent test harness |
| UDF returning wrong data | Check UDF definition, SQL logic | Query directly in SQL |
| Template mismatch | Check `ARCHITECTURE_TEMPLATES` table | COMPOSE_DIAGRAM_FROM_TEMPLATE |
| Search not finding docs | Check Cortex Search service | Query search directly |

```sql
-- Backend-specific queries
SELECT * FROM SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES WHERE TEMPLATE_ID = 'STREAMING_DATA_STACK';
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('STREAMING_DATA_STACK');
SELECT SNOWGRAM_DB.CORE.VALIDATE_MERMAID_SYNTAX('flowchart LR\n  A --> B');
```

```bash
# Agent test harness
cd /Users/abannerjee/Documents/SnowGram/backend/tests/agent
python run_tests.py --test test_streaming_template
```

### Integration (Frontend ↔ Backend)

| Bug Type | Exploration Strategy | Verification |
|----------|---------------------|--------------|
| Agent works in SQL but not UI | Check `snowgram-agent-client.ts` | Compare API vs UI |
| Mermaid parses in isolation but not in app | Check `App.tsx` pipeline | Add console.log markers |
| Data transformation issue | Trace data through pipeline | Log at each stage |

---

## Tools Available to the Agent

### Bash Tool (Anthropic SWE-bench pattern)

```json
{
  "name": "bash",
  "description": "Run commands in bash shell. State is persistent. Use for: exploration (find, grep), running scripts, testing."
}
```

### Edit Tool (str_replace pattern)

```json
{
  "name": "edit",
  "description": "Edit files using string replacement. old_string must match EXACTLY one location. Include enough context to make it unique."
}
```

### Read Tool

```json
{
  "name": "read", 
  "description": "Read file contents. Can specify line offset and limit for large files."
}
```

### Snowflake SQL Tool

```json
{
  "name": "snowflake_sql_execute",
  "description": "Execute SQL queries against Snowflake. Use for debugging agent, UDFs, templates."
}
```

### Task Tool (Subagents)

```json
{
  "name": "task",
  "description": "Spawn subagents for parallel exploration. Use 'Explore' type for codebase search."
}
```

---

## State Management

### Progress Tracking

The agent tracks progress in natural language within the conversation. For complex bugs, it can create a state document:

```markdown
## Debug Session: [Bug Description]

### Status: IN_PROGRESS | FIXED | ESCALATED

### Exploration
- [x] Read CLAUDE.md and MEMORY.md
- [x] Located relevant files: mermaidToReactFlow.ts
- [ ] Created reproduction script
- [ ] Identified root cause
- [ ] Applied fix
- [ ] Verified fix

### Findings
- Line 389: subgraphStartRegex matches template format
- Line 540: Metadata loop iterates but subgraphId is undefined
- Root cause: Nodes not assigned to subgraphs during parsing

### Fix Applied
- File: frontend/src/lib/mermaidToReactFlow.ts
- Lines: 480-490
- Change: Added currentSubgraph tracking during node creation
```

### Git Integration

**⚠️ MANDATORY STOPPING POINT**: Before committing, confirm:
1. All tests pass
2. Fix has been verified
3. User wants to commit (don't assume)

For non-trivial fixes, the agent creates a commit:

```bash
git add frontend/src/lib/mermaidToReactFlow.ts
git commit -m "Fix: Lane metadata not applied to nodes

Root cause: Nodes were created before subgraph tracking was initialized.
Fix: Track currentSubgraph during parsing and assign to node.data.subgraph.

Tested with STREAMING_DATA_STACK template - lane badges now appear correctly.

.... Generated with [Cortex Code](https://docs.snowflake.com/user-guide/snowflake-cortex/cortex-agents)

Co-Authored-By: Cortex Code <noreply@snowflake.com>"
```

---

## Verification Patterns

### Pattern 1: Console Marker Injection (Temporary)

For bugs where the failure point is unclear:

```typescript
// Add temporary markers (remove after debugging)
console.log('[DEBUG-1] Before operation:', variable);
// ... operation ...
console.log('[DEBUG-2] After operation:', result);
```

### Pattern 2: Reproduction Script (Persistent)

For bugs that should have test coverage:

```typescript
// tests/reproduce_issue_123.test.ts
describe('Issue #123: Lane metadata not applied', () => {
  it('should apply layoutType to nodes in subgraphs', () => {
    const result = parseMermaidToReactFlow(testMermaid, {}, false);
    const nodesWithLayout = result.nodes.filter(n => n.data.layoutType);
    expect(nodesWithLayout.length).toBeGreaterThan(0);
  });
});
```

### Pattern 3: SQL Verification (Backend)

For agent/UDF issues:

```sql
-- Verify UDF output
SELECT SNOWGRAM_DB.CORE.COMPOSE_DIAGRAM_FROM_TEMPLATE('STREAMING_DATA_STACK')
  AS mermaid_code;

-- Verify agent response
-- Use test harness: python run_tests.py --test specific_test
```

---

## Escalation Criteria

The agent should escalate to the user when:

1. **Same error after 3 fix attempts** - Likely deeper architectural issue
2. **Requires external access** - API keys, external services, network
3. **Destructive operation needed** - Database schema change, DROP statements
4. **Ambiguous requirements** - Multiple valid interpretations of "correct" behavior
5. **Cross-repository change** - Fix requires changes outside SnowGram

---

## Integration with Project Documentation

The agent reads these files for context:

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project root - concise overview |
| `.cortex/MEMORY.md` | Persistent context - schemas, templates, common issues |
| `frontend/BUG_AUDIT.md` | Known frontend issues |
| `frontend/DEPENDENCIES.md` | Package versions, compatibility |
| `docs/AI_POWERED_DIAGRAM_ARCHITECTURE.md` | System architecture |

---

## Invocation Examples

```bash
# General bug
$snowgram-debugger "Lane badges not appearing on streaming diagram"

# Specific file
$snowgram-debugger "mermaidToReactFlow.ts not parsing subgraphs correctly"

# Test failure
$snowgram-debugger "npm test failing with 'Cannot read property layoutType of undefined'"

# Agent issue
$snowgram-debugger "Agent returns template description but not Mermaid code"

# Performance issue
$snowgram-debugger "Diagram rendering takes 10+ seconds for large templates"
```

---

## References

### 2025-2026 Best Practices Applied

| Source | Date | Key Insight |
|--------|------|-------------|
| **Anthropic SWE-bench** | Jan 2025 | Minimal scaffolding, Bash + Edit tools |
| **Claude Code Docs** | Feb 2026 | CLAUDE.md context, hooks, skills |
| **Cortex Code Skills** | 2026 | Skill-based workflow encapsulation |

### Project-Specific

| Resource | Location |
|----------|----------|
| Project Memory | `.cortex/MEMORY.md` |
| Test Harness | `backend/tests/agent/run_tests.py` |
| Frontend Tests | `frontend/npm test` |
| Template Table | `SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES` |
