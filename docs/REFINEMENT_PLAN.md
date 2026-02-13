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

| Element | Current | Target |
|---------|---------|--------|
| Node sizing | Fixed 150x130 | Auto-size based on label |
| Layer grouping | Implicit | Visual layer bands |
| Color coding | Single blue | Gradient by flowStageOrder |

### Files to Modify
- `frontend/src/components/CustomNode.tsx`
- `frontend/src/App.tsx`

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
- [ ] Phase 2: ELK layout tuning
- [ ] Phase 3: Edge routing
- [ ] Phase 4: Test expansion
- [ ] Phase 5: Visual polish

### Phase 1 Results
- Agent now produces 10 nodes (was 15-20)
- Stream+Task pairs included for CDC flows
- Single "Analytics Views" (no redundant views)
- Warehouse positioned separately from data flow
- All flowStageOrder values correctly assigned

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
