# Autonomous Debug Loop - Step-by-Step Execution Walkthrough

> This document verifies that each step of the autonomous loop is achievable and explains exactly how autonomy works.

---

## Pre-Conditions Check

Before the loop can run autonomously, verify:

| Condition | How to Verify | Status |
|-----------|---------------|--------|
| Dev server running | `curl http://localhost:3002` returns HTML | ⬜ Check |
| Template exists | Query `SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES` | ✅ Verified |
| Files exist | All 3 target files present in frontend/src | ✅ Verified |
| Debug markers NOT present | Grep for `[LOOP-DEBUG]` returns 0 | ⬜ Check |

---

## Step-by-Step Execution

### STEP 0: Initialize State Document

**Action**: Write initial state to `DEBUG_LANE_LAYOUT.md`

```json
{
  "iteration": { "current": 0, "status": "INITIALIZED" },
  "debug_logging_injected": false,
  "observations": { all null },
  "diagnosis": { all null }
}
```

**Autonomy**: ✅ Fully autonomous - just file write

---

### STEP 1: Inject Debug Logging (One-Time)

**Condition**: Only if `debug_logging_injected === false`

**Actions**:
1. Read `mermaidToReactFlow.ts` line 537
2. Insert after line 537:
   ```typescript
   console.log('[LOOP-DEBUG] Subgraphs:', subgraphs.size, Array.from(subgraphs.keys()));
   console.log('[LOOP-DEBUG] LayoutInfo:', layoutInfo.size);
   ```
3. Read `mermaidToReactFlow.ts` line 559
4. Insert after line 559:
   ```typescript
   const metaCount = Array.from(nodeMap.values()).filter(n => (n.data as any).layoutType).length;
   console.log('[LOOP-DEBUG] Nodes with metadata:', metaCount);
   ```
5. Read `elkLayout.ts` line 461
6. Insert after line 461:
   ```typescript
   console.log('[LOOP-DEBUG] hasLayoutMetadata:', hasLayoutMetadata);
   ```
7. Read `App.tsx` line 3044
8. Insert after line 3044:
   ```typescript
   console.log('[LOOP-DEBUG] usedLaneLayout:', usedLaneLayout);
   ```
9. Update state: `debug_logging_injected = true`

**Autonomy**: ✅ Fully autonomous - file edits with Edit tool

**Verification**: Grep for `[LOOP-DEBUG]` should return 5 matches

---

### STEP 2: Trigger Build and Capture Output

**Challenge**: How does the agent capture browser console output?

**Option A: Manual Checkpoint** (Semi-Autonomous)
```
The agent asks user to:
1. Open http://localhost:3002 in browser
2. Open DevTools Console (F12)
3. Click "Streaming Data Stack" template
4. Copy/paste console output back to agent
```

**Option B: Automated File Logging** (Fully Autonomous)
```typescript
// Add to App.tsx at the start of useEffect
const debugLog = (...args: any[]) => {
  console.log(...args);
  // Also write to a file that agent can read
  fetch('/api/debug-log', { 
    method: 'POST', 
    body: JSON.stringify(args) 
  });
};
```

**Option C: Puppeteer/Playwright** (Fully Autonomous but Complex)
```bash
# Agent runs headless browser test
npx playwright test debug-capture.spec.ts
# Reads results from test output file
```

**Recommended**: **Option A** for first iteration (proven to work), upgrade to Option C later.

**Autonomy**: ⚠️ Requires one manual step (user copies console output)

---

### STEP 3: Parse Console Output (Contract: ObserveConsole)

**Input**: Raw console output text (from user paste or log file)

**Parsing Logic** (Deterministic Regex):
```typescript
const parseDebugOutput = (output: string) => {
  const subgraphsMatch = output.match(/\[LOOP-DEBUG\] Subgraphs:\s*(\d+)/);
  const layoutInfoMatch = output.match(/\[LOOP-DEBUG\] LayoutInfo:\s*(\d+)/);
  const metadataMatch = output.match(/\[LOOP-DEBUG\] Nodes with metadata:\s*(\d+)/);
  const hasLayoutMatch = output.match(/\[LOOP-DEBUG\] hasLayoutMetadata:\s*(true|false)/);
  const usedLaneMatch = output.match(/\[LOOP-DEBUG\] usedLaneLayout:\s*(true|false)/);
  
  return {
    subgraphs_count: subgraphsMatch ? parseInt(subgraphsMatch[1]) : null,
    layoutInfo_count: layoutInfoMatch ? parseInt(layoutInfoMatch[1]) : null,
    nodes_with_metadata: metadataMatch ? parseInt(metadataMatch[1]) : null,
    hasLayoutMetadata: hasLayoutMatch ? hasLayoutMatch[1] === 'true' : null,
    usedLaneLayout: usedLaneMatch ? usedLaneMatch[1] === 'true' : null
  };
};
```

**Autonomy**: ✅ Fully autonomous - text parsing

---

### STEP 4: Diagnose Failure Point (Contract: DiagnoseFailure)

**Decision Tree** (Deterministic - No LLM Reasoning Required):

```
observations = parsed output from Step 3

IF observations.subgraphs_count === 0:
    RETURN {
      failure_point: "REGEX_NOT_MATCHING",
      target_file: "frontend/src/lib/mermaidToReactFlow.ts",
      target_lines: "389",
      confidence: 1.0,
      fix_hint: "subgraphStartRegex doesn't match template format"
    }

ELIF observations.layoutInfo_count === 0:
    RETURN {
      failure_point: "DETECTION_FAILING",
      target_file: "frontend/src/lib/mermaidToReactFlow.ts",
      target_lines: "228-301",
      confidence: 1.0,
      fix_hint: "detectSubgraphLayoutType() not recognizing patterns"
    }

ELIF observations.nodes_with_metadata === 0:
    RETURN {
      failure_point: "METADATA_NOT_APPLIED",
      target_file: "frontend/src/lib/mermaidToReactFlow.ts",
      target_lines: "540-559",
      confidence: 1.0,
      fix_hint: "Metadata application loop not finding nodes"
    }

ELIF observations.hasLayoutMetadata === false:
    RETURN {
      failure_point: "DATA_LOST_IN_TRANSFORM",
      target_file: "frontend/src/App.tsx",
      target_lines: "3038-3050",
      confidence: 0.9,
      fix_hint: "Node data not preserved through pipeline"
    }

ELIF observations.usedLaneLayout === false:
    RETURN {
      failure_point: "CONDITION_CHECK_FAILING",
      target_file: "frontend/src/App.tsx",
      target_lines: "3042",
      confidence: 0.9,
      fix_hint: "mermaidLayoutInfo check failing"
    }

ELSE:
    RETURN {
      failure_point: "SUCCESS_OR_VISUAL",
      confidence: 0.8,
      note: "All metrics correct - check visual rendering"
    }
```

**Autonomy**: ✅ Fully autonomous - deterministic mapping

---

### STEP 5: Apply Fix (Contract: ApplyFix)

Based on diagnosis, apply targeted fix:

**Fix for REGEX_NOT_MATCHING**:
```typescript
// Current (line 389):
const subgraphStartRegex = /^subgraph\s+([\w-]+)\s*\[?"?(.+?)"?\]?$/;

// Template format: subgraph path_1a["1a - Kafka Path"]
// Verify regex matches by testing in Node.js REPL
// If not matching, try:
const subgraphStartRegex = /^subgraph\s+([\w-]+)\s*(?:\["?|"?)(.+?)(?:"?\]|"?)?\s*$/;
```

**Fix for METADATA_NOT_APPLIED**:
```typescript
// Line 541: Check if subgraphId lookup is correct
// Problem might be: subgraph IDs stored differently than node.data.subgraph
// Debug by adding:
console.log('[DEBUG] Node subgraph:', subgraphId, 'LayoutInfo keys:', Array.from(layoutInfo.keys()));
```

**Fix for DATA_LOST_IN_TRANSFORM**:
```typescript
// Line 3038-3050: Check if node.data properties are preserved
// Spread operators might lose nested properties
// Ensure explicit property copying
```

**Autonomy**: ✅ Fully autonomous - Edit tool with specific old_string/new_string

---

### STEP 6: Update State and Loop

**Actions**:
1. Increment `iteration.current`
2. Update `observations` with parsed values
3. Update `diagnosis` with failure point
4. Record fix in `fixes_applied` array
5. Check termination conditions:
   - SUCCESS: All observations correct + visual confirmed
   - MAX_ITERATIONS: current >= 5
   - ESCALATE: Same failure_point for 2 consecutive iterations

**Autonomy**: ✅ Fully autonomous - state management

---

## Autonomy Assessment

| Step | Fully Autonomous | Requires User |
|------|------------------|---------------|
| 0. Initialize | ✅ | |
| 1. Inject logging | ✅ | |
| 2. Capture output | ⚠️ | User copies console |
| 3. Parse output | ✅ | |
| 4. Diagnose | ✅ | |
| 5. Apply fix | ✅ | |
| 6. Loop/Exit | ✅ | |

**Overall**: **86% Autonomous** (6/7 steps)

---

## Making Step 2 Fully Autonomous

To achieve 100% autonomy, we can add a debug endpoint:

```typescript
// Add to frontend/src/App.tsx
useEffect(() => {
  // Write debug output to localStorage
  const originalLog = console.log;
  console.log = (...args) => {
    originalLog(...args);
    if (args[0]?.includes?.('[LOOP-DEBUG]')) {
      const existing = localStorage.getItem('debug_output') || '';
      localStorage.setItem('debug_output', existing + args.join(' ') + '\n');
    }
  };
}, []);
```

Then agent can:
1. Run `npm run build` (triggers hot reload)
2. Wait 3 seconds
3. Use Playwright to:
   - Navigate to http://localhost:3002
   - Click template
   - Execute `localStorage.getItem('debug_output')` in console
   - Return output to agent

**With this addition**: **100% Autonomous**

---

## Verification: Will This Work?

### Code Path Analysis

```
User clicks "Streaming Data Stack" template
    ↓
App.tsx calls parseMermaidToReactFlow() [line ~2900]
    ↓
mermaidToReactFlow.ts parses subgraph lines [line 389-534]
    ↓
buildSubgraphLayoutInfo() creates layoutInfo map [line 537]
    ↓
Loop applies metadata to nodes [lines 540-559]
    ↓
Returns { nodes, edges, subgraphs, layoutInfo } [line 572-577]
    ↓
App.tsx receives mermaidLayoutInfo [line 3042]
    ↓
layoutWithLanes() called if layoutInfo.size > 0 [line 3044]
    ↓
elkLayout.ts checks hasLayoutMetadata [line 458-466]
    ↓
If true: Apply lane layout with badges
If false: Return early with standard layout
```

### Known Issue Location

Based on code analysis, the likely failure point is:

**mermaidToReactFlow.ts lines 540-559**: The metadata application loop

```typescript
for (const node of nodeMap.values()) {
  const subgraphId = node.data.subgraph as string | undefined;  // ← Is this set correctly?
  if (subgraphId && layoutInfo.has(subgraphId)) {  // ← Is layoutInfo keyed correctly?
```

**Hypothesis**: Nodes are not getting `subgraph` property set during parsing, so the loop finds nothing to update.

**This will be confirmed by debug output**: If `Nodes with metadata: 0` but `Subgraphs: 10` and `LayoutInfo: 10`, then the issue is the node→subgraph association.

---

## Summary: Autonomous Loop Execution

```
┌─────────────────────────────────────────────────────────────────────┐
│ ITERATION 1                                                         │
├─────────────────────────────────────────────────────────────────────┤
│ 1. [AUTO] Inject debug logging (5 console.log statements)          │
│ 2. [SEMI] User: Open browser, click template, copy console output  │
│ 3. [AUTO] Parse: Extract 5 metrics from console text               │
│ 4. [AUTO] Diagnose: Apply decision tree → failure_point            │
│ 5. [AUTO] Fix: Edit target_file at target_lines                    │
│ 6. [AUTO] Update state, check termination                          │
│    └─ If not done: LOOP to step 2                                  │
├─────────────────────────────────────────────────────────────────────┤
│ Expected iterations: 1-3 (based on single failure point)           │
│ Max iterations: 5 (hard cap)                                       │
│ Escalation: After 2 same failures                                  │
└─────────────────────────────────────────────────────────────────────┘
```

**Ready to execute?**
