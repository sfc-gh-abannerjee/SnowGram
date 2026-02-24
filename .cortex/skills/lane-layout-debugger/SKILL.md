---
name: lane-layout-debugger  
description: "Specialized debug loop for SnowGram lane/section layout issues. Inherits from snowgram-debugger. Use when: lane badges not appearing, nodes scattered, layout not matching reference PDF. Triggers: debug layout, fix lanes, layout broken, badges missing, streaming diagram, section badges."
tools: ["bash", "read", "edit", "write", "task", "grep", "glob"]
parent_skill: snowgram-debugger
---

# Lane Layout Debugger

> **Inherits**: `$snowgram-debugger` (generalized debug loop)
> **Specialization**: Lane-based layout system in `mermaidToReactFlow.ts` and `elkLayout.ts`

---

## ⚡ Quick Start (Skip if already ran tests)

**Most lane layout "bugs" are actually working correctly.** Before debugging, run:

```bash
cd /Users/abannerjee/Documents/SnowGram/frontend && npm test -- --grep "lane"
```

If tests pass → The code is correct. Check browser console for `usedLaneLayout: true`.

---

## When to Use This Skill

Use `$lane-layout-debugger` instead of `$snowgram-debugger` when the bug involves:

- Lane badges (1A, 1B, 1C, 1D) not appearing
- Section badges (2, 3, 4, 5) not appearing
- Nodes scattered instead of organized in lanes
- `usedLaneLayout: false` in console
- Streaming template not matching reference PDF

---

## Domain-Specific Context

### Code Path

```
User clicks template → App.tsx → parseMermaidToReactFlow()
                                        ↓
                          mermaidToReactFlow.ts (lines 389-577)
                          - Parse subgraph lines
                          - Call buildSubgraphLayoutInfo()
                          - Apply metadata to nodes (lines 540-559)
                                        ↓
                          Returns { nodes, edges, subgraphs, layoutInfo }
                                        ↓
                          App.tsx (lines 3038-3050)
                          - Check if layoutInfo.size > 0
                          - Call layoutWithLanes()
                                        ↓
                          elkLayout.ts (lines 458-466)
                          - Check hasLayoutMetadata
                          - If true: Apply lane layout with badges
                          - If false: Standard layout (no badges)
```

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `frontend/src/lib/mermaidToReactFlow.ts` | 389 | `subgraphStartRegex` - parses subgraph lines |
| `frontend/src/lib/mermaidToReactFlow.ts` | 228-301 | `detectSubgraphLayoutType()` - classifies subgraphs |
| `frontend/src/lib/mermaidToReactFlow.ts` | 540-559 | Metadata application loop |
| `frontend/src/lib/elkLayout.ts` | 458-466 | `hasLayoutMetadata` check |
| `frontend/src/App.tsx` | 3038-3050 | Pipeline orchestration |

### Expected Values (STREAMING_DATA_STACK)

| Metric | Expected | Meaning |
|--------|----------|---------|
| Subgraphs count | 10 | 4 lanes + 4 sections + 2 boundaries |
| LayoutInfo count | 10 | Same as subgraphs |
| Nodes with metadata | >0 | At least some nodes have `layoutType` |
| hasLayoutMetadata | `true` | Triggers lane layout path |
| usedLaneLayout | `true` | Confirms lane layout was applied |

---

## Reproduction Script

```typescript
// /tmp/test_lane_layout.ts
import { parseMermaidToReactFlow } from '../frontend/src/lib/mermaidToReactFlow';

const streamingMermaid = `flowchart LR
  subgraph path_1a["1a - Kafka Path"]
    kafka[Apache Kafka] --> connector[Kafka Connector]
  end
  subgraph path_1b["1b - CSP Streaming"]
    kinesis[Kinesis] --> compute[Compute]
  end
  subgraph section_2["2 - Ingestion"]
    snowpipe[Snowpipe]
  end
`;

const result = parseMermaidToReactFlow(streamingMermaid, {}, false);

console.log('=== LANE LAYOUT DEBUG ===');
console.log('Subgraphs:', result.subgraphs?.size ?? 0);
console.log('LayoutInfo:', result.layoutInfo?.size ?? 0);

const nodesWithMeta = result.nodes.filter(n => (n.data as any).layoutType);
console.log('Nodes with metadata:', nodesWithMeta.length);

if (result.layoutInfo) {
  console.log('Layout entries:');
  for (const [id, info] of result.layoutInfo) {
    console.log(`  ${id}: type=${info.type}, index=${info.index}, badge=${info.badgeLabel}`);
  }
}
```

---

## Decision Tree (Deterministic Diagnosis)

**⚠️ MANDATORY STOPPING POINT**: Before editing code, run the reproduction script and use this decision tree to identify the exact target.

```
RUN reproduction script and parse output:

IF subgraphs_count === 0:
    DIAGNOSIS: "REGEX_NOT_MATCHING"
    TARGET: mermaidToReactFlow.ts:389
    FIX: Update subgraphStartRegex to handle template format
    
ELIF layoutInfo_count === 0:
    DIAGNOSIS: "DETECTION_FAILING"
    TARGET: mermaidToReactFlow.ts:228-301
    FIX: Update detectSubgraphLayoutType() patterns
    
ELIF nodes_with_metadata === 0:
    DIAGNOSIS: "METADATA_NOT_APPLIED"
    TARGET: mermaidToReactFlow.ts:540-559
    FIX: Ensure node.data.subgraph is set during parsing
    
ELIF hasLayoutMetadata === false:
    DIAGNOSIS: "DATA_LOST_IN_TRANSFORM"
    TARGET: App.tsx:3038-3050
    FIX: Preserve node.data properties through pipeline
    
ELIF usedLaneLayout === false:
    DIAGNOSIS: "CONDITION_CHECK_FAILING"
    TARGET: App.tsx:3042
    FIX: Check mermaidLayoutInfo condition
    
ELSE:
    DIAGNOSIS: "VISUAL_RENDERING"
    TARGET: elkLayout.ts:458-500
    FIX: Check badge node creation and positioning
```

---

## Verification Checklist

**⚠️ MANDATORY STOPPING POINT**: After applying any fix, complete this checklist before reporting success:

After applying a fix, verify:

1. **Run reproduction script** - All metrics show expected values
2. **Run frontend tests** - `npm test` passes
3. **Visual check** - Open browser, click Streaming template, confirm:
   - Lane badges (1A, 1B, 1C, 1D) visible on left
   - Section badges (2, 3, 4, 5) visible on top
   - Nodes organized in horizontal lanes
   - Layout matches reference PDF

---

## Reference

### Template: STREAMING_DATA_STACK

```sql
SELECT FULL_MERMAID_CODE 
FROM SNOWGRAM_DB.CORE.ARCHITECTURE_TEMPLATES 
WHERE TEMPLATE_ID = 'STREAMING_DATA_STACK';
```

### Reference Architecture PDF

`/Users/abannerjee/Documents/SnowGram/pdf_images/streaming_page4_img0.png`

### Expected Layout

```
        │ Section 2 │ Section 3 │ Section 4 │ Section 5 │
────────┼───────────┼───────────┼───────────┼───────────┤
Lane 1A │ Kafka     │ Connector │ Tables    │ Analytics │
────────┼───────────┼───────────┼───────────┼───────────┤
Lane 1B │ Kinesis   │ Compute   │ DT        │ Dashboard │
────────┼───────────┼───────────┼───────────┼───────────┤
Lane 1C │ S3        │ Snowpipe  │ Norm      │ Python    │
────────┼───────────┼───────────┼───────────┼───────────┤
Lane 1D │ Mkplace   │ NativeApp │ DT        │ SPCS      │
────────┴───────────┴───────────┴───────────┴───────────┘
```
