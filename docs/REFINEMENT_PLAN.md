# SnowGram Diagram Refinement Plan

**Created**: February 2026  
**Status**: In Progress  
**Version**: 1.0

## Executive Summary

Based on analysis of generated medallion architecture diagrams, this plan addresses **6 priority areas** for refinement spanning the agent, frontend layout, and visual polish.

---

## Issue Analysis

### Current State (from test generation)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Snowflake Account (label cut off)                                   │
├─────────────────────────────────────────────────────────────────────┤
│  [Bronze DB]──[Bronze Schema]──[Bronze Tables]──[Bronze→Silver]     │
│                                     ↓                               │
│  [Silver DB]──[Silver Schema]──[Silver Tables]──[Silver→Gold]       │
│                                     ↓                               │
│  [Gold DB]──[Gold Schema]──[Gold Tables]                            │
│                                     ↓                               │
│  [Analytics Views]  [Secure Reporting Views]  [Compute Warehouse]   │
│                                     ↓                               │
│  [PowerBI Reports & Dashboards]                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Issues Identified

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | Missing Tasks after Streams | High | Agent |
| 2 | Component verbosity (DB+Schema+Tables) | Medium | Agent |
| 3 | Horizontal alignment inconsistent | Medium | Layout |
| 4 | Boundary label truncation | Low | Frontend |
| 5 | Edge crossing/clutter | Medium | Layout |
| 6 | Compute Warehouse misplaced | Low | Agent |

---

## Priority 1: Agent Output Improvements

### Problem
- Streams exist without processing Tasks
- Each medallion layer shows 3 separate nodes (DB, Schema, Tables)
- Duplicate view types (Analytics + Secure Reporting)

### Solution

Update `agent_spec_v4.yaml` instructions with:

```yaml
**MEDALLION LAYER CONSOLIDATION:**
For medallion architectures, prefer consolidated layer representation:
- Use "Bronze Layer" (single node) instead of separate Bronze DB + Schema + Tables
- OR group as: Bronze DB containing nested Schema/Tables (if granularity needed)

**STREAM + TASK PAIRING:**
Every Stream MUST be followed by a Task that processes it:
- Bronze→Silver Stream → Transform Task (Bronze to Silver)
- Silver→Gold Stream → Transform Task (Silver to Gold)

**VIEW CONSOLIDATION:**
Do NOT create redundant view types. Use:
- "Analytics Views" for general analytics
- "Secure Views" ONLY if row-level security is explicitly requested
```

### Files to Modify
- `agent_spec_v4.yaml`
- `backend/agent/update_agent_instructions.py` (to deploy changes)

---

## Priority 2: Layout Engine Improvements

### Problem
- Nodes at same flowStageOrder not horizontally aligned
- Vertical spacing inconsistent
- Boundary labels cut off

### Solution

Update ELK.js configuration in `elkLayout.ts`:

```typescript
const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',  // Better for medallion
  'elk.layered.spacing.nodeNodeBetweenLayers': '160',
  'elk.layered.spacing.nodeNode': '60',
  'elk.alignment': 'CENTER',
  'elk.layered.nodePlacement.strategy': 'SIMPLE',
  'elk.layered.layering.strategy': 'INTERACTIVE',
};
```

Fix boundary padding in `App.tsx`:
```typescript
const padYTop = 70;  // Increased from 50
```

### Files to Modify
- `frontend/src/lib/elkLayout.ts`
- `frontend/src/App.tsx`

---

## Priority 3: Edge Routing Refinement

### Problem
- Multiple edge crossings
- Dashed lines hard to follow
- Spider-web effect from Gold Tables

### Solution

Update edge styling:

```typescript
const edgeDefaults = {
  type: 'smoothstep',
  animated: true,
  style: { 
    stroke: '#29B5E8', 
    strokeWidth: 2.5,
    strokeDasharray: '8,4',
  },
  markerEnd: { type: 'arrowclosed', color: '#29B5E8' },
};
```

### Files to Modify
- `frontend/src/App.tsx`

---

## Priority 4: Test Suite Expansion

### New Test Cases

```yaml
- name: "medallion_with_tasks"
  description: "Verify streams have associated tasks"
  validations:
    - stream_has_task

- name: "layout_vertical_alignment"
  description: "Verify nodes at same flowStageOrder are aligned"
  validations:
    - json_flowstage_aligned

- name: "bi_consume_layer"
  description: "Verify BI tools are in consume layer"
  validations:
    - bi_tools_consume_layer
```

### New Validations to Implement

| Validation | Description |
|------------|-------------|
| `stream_has_task` | Every Stream node has a downstream Task |
| `json_flowstage_aligned` | Nodes with same flowStageOrder have similar Y position |
| `bi_tools_consume_layer` | PowerBI/Tableau nodes have flowStageOrder=6 |

### Files to Modify
- `backend/tests/agent/test_cases.yaml`
- `backend/tests/agent/run_tests.py`

---

## Priority 5: Visual Polish

### Problem
- Fixed node sizing (150x130) doesn't adapt to label length
- No visual distinction between medallion layers in the canvas
- Color coding based on text matching rather than flowStageOrder

### Solution

#### 5.1 Auto-size nodes based on label length
Replace fixed sizing with dynamic calculation:
```typescript
const calculateNodeSize = (label: string) => {
  const baseWidth = 120;
  const charWidth = 8;
  const width = Math.max(baseWidth, Math.min(200, label.length * charWidth + 40));
  const height = label.length > 15 ? 150 : 130;
  return { width, height };
};
```

#### 5.2 Visual layer bands (background zones)
Add semi-transparent colored rectangles behind each medallion layer:
- Bronze zone: `rgba(205, 127, 50, 0.05)` 
- Silver zone: `rgba(192, 192, 192, 0.05)`
- Gold zone: `rgba(255, 215, 0, 0.05)`

#### 5.3 Color coding by flowStageOrder
Add `STAGE_COLORS` map using flowStageOrder directly:
```typescript
const STAGE_COLORS = {
  0: { border: '#6366F1', bg: '#EEF2FF' },  // source (indigo)
  1: { border: '#8B5CF6', bg: '#F5F3FF' },  // ingest (violet)
  2: { border: '#CD7F32', bg: '#FDF5E6' },  // raw/bronze
  3: { border: '#C0C0C0', bg: '#F5F5F5' },  // transform/silver
  4: { border: '#FFD700', bg: '#FFFACD' },  // refined/gold
  5: { border: '#10B981', bg: '#ECFDF5' },  // serve (emerald)
  6: { border: '#F59E0B', bg: '#FFFBEB' },  // consume (amber)
};
```

| Element | Current | Target |
|---------|---------|--------|
| Node sizing | Fixed 150x130 | Auto-size based on label |
| Layer grouping | Implicit | Visual layer bands |
| Color coding | Single blue | Gradient by flowStageOrder |

### Files to Modify
- `frontend/src/App.tsx` (node sizing, layer bands)
- `frontend/src/lib/mermaidToReactFlow.ts` (STAGE_COLORS)

---

## Priority 6: Agent Response Quality

### Prompt Engineering Refinements

1. **Layer-first thinking**: Plan layers before generating nodes
2. **Edge validation**: Verify all edges reference valid nodes
3. **flowStageOrder consistency**: Ensure no backward edges

---

## Implementation Roadmap

| Phase | Focus | Files | Validation |
|-------|-------|-------|------------|
| **Phase 1** | Agent prompt improvements | `agent_spec_v4.yaml` | `smoke` tests |
| **Phase 2** | ELK layout tuning | `elkLayout.ts` | `layout` tests |
| **Phase 3** | Edge routing | `App.tsx` | Visual inspection |
| **Phase 4** | Test expansion | `test_cases.yaml`, `run_tests.py` | `core` tests |
| **Phase 5** | Visual polish | `CustomNode.tsx`, `App.tsx` | Manual review |

---

## Progress Tracking

- [x] Phase 1: Agent prompt improvements ✅ (2026-02-13)
- [x] Phase 2: ELK layout tuning ✅ (2026-02-13)
- [x] Phase 3: Edge routing ✅ (2026-02-13)
- [ ] Phase 4: Test expansion
- [x] Phase 5: Visual polish ✅ (2026-02-13)

### Phase 1 Results
- Agent now produces 10 nodes (was 15-20)
- Stream+Task pairs included for CDC flows
- Single "Analytics Views" (no redundant views)
- Warehouse positioned separately from data flow
- All flowStageOrder values correctly assigned

### Phase 2 & 3 Results
- Edge strokeWidth increased from 2 to 2.5 for better visibility
- Boundary label padding increased (padYTop: 50 → 70)
- ELK options tuned for better alignment and spacing
- Smoothstep edge type in elkLayout for curved routing
- Consistent styling across light and dark modes

### Phase 5 Results
- Added STAGE_COLORS map for flowStageOrder-based coloring
- Nodes now colored by pipeline stage (source→ingest→raw→transform→refined→serve→consume)
- Color scheme: Indigo→Violet→Bronze→Silver→Gold→Emerald→Amber
- Both spec and mermaid paths apply consistent stage coloring
- Added calculateNodeSize helper for future dynamic sizing

### Phase 5b: Agent Instruction Strengthening (2026-02-13)
**Issue**: Testing revealed agent still not following instructions:
- VIEW CONSOLIDATION ignored (both "Analytics Views" + "Secure Views" appeared)
- STREAM + TASK PAIRING ignored (missing "Gold Transform Task" after "Silver to Gold Stream")
- Diagonal edges from poor node alignment

**Fixes Applied**:
1. **Stronger VIEW CONSOLIDATION instruction**:
   - Added explicit "INCORRECT/CORRECT" examples
   - Made rule STRICT with "NEVER add Secure Views" language
   
2. **Stronger STREAM + TASK PAIRING instruction**:
   - Added "REQUIRED - DO NOT SKIP" emphasis
   - Added explicit INCORRECT/CORRECT flow diagrams
   - Named specific tasks: "Transform Task", "Aggregate Task"

3. **Added concrete EXAMPLE section**:
   - Exact 8-9 node list with flowStageOrder values
   - Exact flow pattern: Bronze → Stream → Task → Silver → Stream → Task → Gold → Views → PowerBI
   - Explicit "clean LINEAR horizontal flow with NO diagonal edges" requirement

4. **Agent updated** via `CREATE OR REPLACE AGENT` with all improvements

---

## Testing Commands

```bash
# Quick validation after changes
python backend/tests/agent/run_tests.py --category smoke --cached

# Full test suite
python backend/tests/agent/run_tests.py --category core

# Specific test
python backend/tests/agent/run_tests.py --test medallion_internal --cached
```
