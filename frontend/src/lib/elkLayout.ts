/**
 * Stage-Based Grid Layout Engine for SnowGram
 * 
 * Provides automatic graph layout using flowStageOrder to group nodes
 * into a neat grid of rows and columns.
 * 
 * Key Features:
 * - Groups nodes by flowStageOrder into columns (stages)
 * - Excludes external nodes (Kafka, AWS, etc.) from column count
 * - Wraps long pipelines into multiple rows for compact display
 * - Neat, predictable grid alignment (no serpentine/diagonal)
 * - Port-based connections mapped to ReactFlow handles
 * - Works with ANY component via AI classification
 */

import { Node, Edge } from 'reactflow';
import { getFlowStageOrder } from './elkLayoutUtils';

// Interface for node data used in flow layout
interface FlowNodeData {
  flowStageOrder?: number;
  flowStage?: string;
  label?: string;
  componentType?: string;
  [key: string]: unknown;
}

// Keywords that identify external (non-Snowflake) nodes
// These nodes are positioned by boundary fitting, not by ELK stage layout
// NOTE: "external" alone is NOT included because "External Stage" is a Snowflake object.
// Use specific patterns like "ext_" prefix or "external_source" instead.
const EXTERNAL_KEYWORDS = [
  'kafka', 's3', 'aws', 'azure', 'gcp', 'blob', 'lake',
  'fivetran', 'airbyte', 'debezium', 'confluent',
  'ext_kafka', 'ext_s3', 'ext_aws', 'external_source',
];

/**
 * Check if a node is an external data source (not a Snowflake component)
 */
function isExternalNode(node: Node): boolean {
  const data = node.data as FlowNodeData;
  const text = `${node.id} ${data.label || ''} ${data.componentType || ''}`.toLowerCase();
  
  // Boundary nodes are handled separately
  if ((data.componentType || '').toLowerCase().includes('account_boundary')) {
    return true;
  }
  
  return EXTERNAL_KEYWORDS.some(kw => text.includes(kw));
}

// Layout constants
const NODE_WIDTH = 150;
const NODE_HEIGHT = 130;
const COL_SPACING = 150;     // horizontal space between stage columns (reduced from 200 for more compact layout)
const ROW_SPACING = 60;      // vertical space between parallel nodes in same stage

/**
 * Map flowStageOrder to layout columns for horizontal flow.
 * Merges related stages into single columns for cleaner layout.
 * 
 * Columns (left to right):
 *   0: Ingestion (Snowpipe, stage ≤1.5 including External Stage)
 *   1: Raw/Bronze (stage ≤2)
 *   2: Processing (CDC 2.5 + Transform 3 merged)
 *   3: Refined/Silver (stage ≤3.5)
 *   4: Post-Silver Processing (CDC/Transform after Silver, stages 4-4.5)
 *   5: Curated/Gold (stage ≤5 but > 4.5)
 *   6: Serving (Analytics, stages 5-5.5)
 *   7+: Consumption (BI tools, stage > 5.5)
 * 
 * Edge propagation may push stages higher (e.g., CDC after Silver → 4),
 * so this function handles fractional and higher stages gracefully.
 */
function getLayoutColumn(flowStageOrder: number): number {
  if (flowStageOrder <= 1.5) return 0;     // Ingestion (Snowpipe, External Stage)
  if (flowStageOrder <= 2) return 1;       // Bronze/Raw
  if (flowStageOrder <= 3) return 2;       // Processing (CDC 2.5 + Transform 3)
  if (flowStageOrder <= 3.5) return 3;     // Silver/Refined
  if (flowStageOrder <= 4.5) return 4;     // Post-Silver Processing (propagated CDC/Transform)
  if (flowStageOrder <= 5) return 5;       // Gold/Curated
  if (flowStageOrder <= 5.5) return 6;     // Serving/Analytics
  return 7;                                 // Consumption/BI
}

/**
 * Map edge direction to ReactFlow handle names.
 * 
 * Enhanced logic:
 * - Same stage (vertical stack): use bottom→top handles based on vertical position
 * - Forward flow (left-to-right): source=right, target=left
 * - Backward flow (right-to-left): source=left, target=right
 * - Wrap transition (end of row to next row): source=bottom, target=top
 */
function assignHandles(
  sourceStageCol: number,
  targetStageCol: number,
  sourceRowIdx: number,
  targetRowIdx: number,
  sourceVerticalIdx: number = 0,
  targetVerticalIdx: number = 0,
): { sourceHandle: string; targetHandle: string } {
  // Same stage column: nodes stacked vertically
  if (sourceStageCol === targetStageCol && sourceRowIdx === targetRowIdx) {
    if (targetVerticalIdx > sourceVerticalIdx) {
      // Target is below source
      return { sourceHandle: 'bottom-source', targetHandle: 'top-target' };
    } else if (targetVerticalIdx < sourceVerticalIdx) {
      // Target is above source
      return { sourceHandle: 'top-source', targetHandle: 'bottom-target' };
    }
    // Same position (shouldn't happen) - default to right-left
    return { sourceHandle: 'right-source', targetHandle: 'left-target' };
  }
  
  // Cross-row (wrap transition)
  if (sourceRowIdx !== targetRowIdx) {
    return { sourceHandle: 'bottom-source', targetHandle: 'top-target' };
  }
  
  // Same row, different columns
  if (targetStageCol > sourceStageCol) {
    // Forward flow: left to right
    return { sourceHandle: 'right-source', targetHandle: 'left-target' };
  } else {
    // Backward flow: right to left (feedback loops)
    return { sourceHandle: 'left-source', targetHandle: 'right-target' };
  }
}

/**
 * Main layout function using horizontal flow with vertical stacking.
 * 
 * Creates a proper architecture diagram layout:
 * - Main flow: LEFT-TO-RIGHT (Sources → Bronze → Processing → Silver → Gold)
 * - Parallel paths: VERTICAL stacking within each column
 * - CDC + Transform are merged in the "Processing" column
 * 
 * External nodes (Kafka, AWS, etc.) are excluded from layout
 * since they are positioned by boundary fitting.
 */
export async function layoutWithELK(
  nodes: Node[],
  edges: Edge[]
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  if (nodes.length === 0) {
    return { nodes, edges };
  }

  // Separate external nodes from internal (Snowflake) nodes
  const externalNodes: Node[] = [];
  const internalNodes: Node[] = [];
  
  nodes.forEach(n => {
    if (isExternalNode(n)) {
      externalNodes.push(n);
    } else {
      internalNodes.push(n);
    }
  });

  console.log('[Layout] Node separation:', {
    total: nodes.length,
    internal: internalNodes.length,
    external: externalNodes.length,
  });

  if (internalNodes.length === 0) {
    return { nodes, edges };
  }

  // Step 1: Initialize stages from keywords (starting point)
  // Then use edge propagation to compute ACTUAL positions from topology
  const nodeStages = new Map<string, number>();
  const nodeColumns = new Map<string, number>();
  
  // Initialize with keyword-based stages as starting point
  internalNodes.forEach(n => {
    const data = n.data as FlowNodeData;
    // Agent-provided flowStageOrder is an optional OVERRIDE (rare)
    // Otherwise use keyword inference as starting point for edge propagation
    const stage = data.flowStageOrder ?? getFlowStageOrder(n as any);
    nodeStages.set(n.id, stage);
  });

  // ALWAYS run edge propagation to compute actual positions from topology
  // This is the PRIMARY method - the graph structure determines layout
  console.log('[Layout] Running edge propagation to compute stages from topology');
  
  const UTILITY_KEYWORDS = ['warehouse', 'compute', 'pool'];
  function isUtilityNode(nodeId: string): boolean {
    const node = internalNodes.find(n => n.id === nodeId);
    if (!node) return false;
    const data = node.data as FlowNodeData;
    const text = `${nodeId} ${data.label || ''} ${data.componentType || ''}`.toLowerCase();
    return UTILITY_KEYWORDS.some(kw => text.includes(kw));
  }
  
  const internalNodeIds = new Set(internalNodes.map(n => n.id));
  
  // Edge propagation: if source → target, target must be AFTER source
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    edges.forEach(e => {
      if (!internalNodeIds.has(e.source) || !internalNodeIds.has(e.target)) return;
      // Skip utility nodes (warehouses connect to multiple stages)
      if (isUtilityNode(e.source)) return;
      
      const sourceStage = nodeStages.get(e.source) ?? 3;
      const targetStage = nodeStages.get(e.target) ?? 3;
      
      // If source stage >= target stage, push target further right
      if (sourceStage >= targetStage) {
        const newTargetStage = sourceStage + 0.5;
        nodeStages.set(e.target, newTargetStage);
        changed = true;
      }
    });
    if (!changed) break;
  }

  // Now assign columns based on (possibly adjusted) stages
  internalNodes.forEach(n => {
    const stage = nodeStages.get(n.id) ?? 3;
    const col = getLayoutColumn(stage);
    nodeColumns.set(n.id, col);
  });

  // Step 2: Group nodes by COLUMN for horizontal layout
  const columnGroups = new Map<number, Node[]>();
  internalNodes.forEach(n => {
    const col = nodeColumns.get(n.id) ?? 2;
    if (!columnGroups.has(col)) {
      columnGroups.set(col, []);
    }
    columnGroups.get(col)!.push(n);
  });

  // Sort column keys for left-to-right ordering
  const sortedColumns = [...columnGroups.keys()].sort((a, b) => a - b);

  // Step 3: Within each column, sort nodes by their original stage order
  // This keeps CDC (2.5) before Transform (3) within the Processing column
  sortedColumns.forEach(col => {
    const nodesInCol = columnGroups.get(col)!;
    nodesInCol.sort((a, b) => {
      const stageA = nodeStages.get(a.id) ?? 3;
      const stageB = nodeStages.get(b.id) ?? 3;
      return stageA - stageB;
    });
  });

  // Step 4: Build edge connections for barycenter ordering
  const nodeConnections = new Map<string, { sources: string[]; targets: string[] }>();
  edges.forEach(e => {
    if (!nodeConnections.has(e.source)) {
      nodeConnections.set(e.source, { sources: [], targets: [] });
    }
    if (!nodeConnections.has(e.target)) {
      nodeConnections.set(e.target, { sources: [], targets: [] });
    }
    nodeConnections.get(e.source)!.targets.push(e.target);
    nodeConnections.get(e.target)!.sources.push(e.source);
  });

  // Step 5: Reorder nodes within each column using barycenter heuristic
  sortedColumns.forEach((col, colIdx) => {
    if (colIdx === 0) return;
    
    const nodesInCol = columnGroups.get(col)!;
    if (nodesInCol.length <= 1) return;
    
    const prevCol = sortedColumns[colIdx - 1];
    const prevNodes = columnGroups.get(prevCol) || [];
    const prevPositions = new Map<string, number>();
    prevNodes.forEach((n, idx) => prevPositions.set(n.id, idx));
    
    const barycenters = nodesInCol.map(n => {
      const conn = nodeConnections.get(n.id);
      if (!conn || conn.sources.length === 0) return { node: n, bc: Infinity };
      
      const sourcesInPrev = conn.sources.filter(s => prevPositions.has(s));
      if (sourcesInPrev.length === 0) return { node: n, bc: Infinity };
      
      const avg = sourcesInPrev.reduce((sum, s) => sum + (prevPositions.get(s) || 0), 0) / sourcesInPrev.length;
      return { node: n, bc: avg };
    });
    
    barycenters.sort((a, b) => a.bc - b.bc);
    columnGroups.set(col, barycenters.map(b => b.node));
  });

  // Step 6: Calculate max nodes in any column (for vertical centering)
  let maxNodesInColumn = 1;
  sortedColumns.forEach(col => {
    const count = columnGroups.get(col)!.length;
    if (count > maxNodesInColumn) maxNodesInColumn = count;
  });

  // Step 7: Position nodes - columns as X positions, vertical stacking as Y
  const positionedInternalNodes: Node[] = [];
  const maxStackHeight = maxNodesInColumn * (NODE_HEIGHT + ROW_SPACING) - ROW_SPACING;

  sortedColumns.forEach((col, colIdx) => {
    const nodesInCol = columnGroups.get(col)!;
    const stackHeight = nodesInCol.length * (NODE_HEIGHT + ROW_SPACING) - ROW_SPACING;
    
    // Center this column's stack vertically relative to the tallest column
    const startY = (maxStackHeight - stackHeight) / 2;
    const x = colIdx * (NODE_WIDTH + COL_SPACING);
    
    nodesInCol.forEach((n, rowIdx) => {
      const y = startY + rowIdx * (NODE_HEIGHT + ROW_SPACING);
      
      positionedInternalNodes.push({
        ...n,
        position: { x, y },
        style: {
          ...(n.style || {}),
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        },
      });
    });
  });

  // Combine external nodes with positioned internal nodes
  const positionedNodes: Node[] = [...externalNodes, ...positionedInternalNodes];

  // Step 8: Build node position maps for handle assignment
  const nodePositions = new Map<string, { col: number; row: number }>();
  sortedColumns.forEach((col, colIdx) => {
    const nodesInCol = columnGroups.get(col)!;
    nodesInCol.forEach((n, rowIdx) => {
      nodePositions.set(n.id, { col: colIdx, row: rowIdx });
    });
  });

  // Step 9: Assign edge handles based on positions
  const positionedEdges: Edge[] = edges.map(e => {
    const sourcePos = nodePositions.get(e.source);
    const targetPos = nodePositions.get(e.target);

    if (sourcePos && targetPos) {
      const handles = assignHandlesForColumns(
        sourcePos.col, targetPos.col,
        sourcePos.row, targetPos.row
      );
      return {
        ...e,
        sourceHandle: handles.sourceHandle,
        targetHandle: handles.targetHandle,
        type: 'smoothstep',
      };
    }

    // Default for edges involving external nodes (horizontal flow)
    return {
      ...e,
      sourceHandle: 'right-source',
      targetHandle: 'left-target',
      type: 'smoothstep',
    };
  });

  console.log('[Layout] Horizontal flow:', {
    totalNodes: nodes.length,
    internalNodes: internalNodes.length,
    externalNodes: externalNodes.length,
    columns: sortedColumns.length,
    columnSizes: sortedColumns.map(c => columnGroups.get(c)!.length),
  });

  return { nodes: positionedNodes, edges: positionedEdges };
}

/**
 * Assign handles for horizontal flow layout
 */
function assignHandlesForColumns(
  sourceCol: number,
  targetCol: number,
  sourceRow: number,
  targetRow: number,
): { sourceHandle: string; targetHandle: string } {
  // Same column: vertical connection
  if (sourceCol === targetCol) {
    if (targetRow > sourceRow) {
      return { sourceHandle: 'bottom-source', targetHandle: 'top-target' };
    }
    if (targetRow < sourceRow) {
      return { sourceHandle: 'top-source', targetHandle: 'bottom-target' };
    }
    // Same position
    return { sourceHandle: 'right-source', targetHandle: 'left-target' };
  }
  
  // Different columns: horizontal flow (primary direction)
  if (targetCol > sourceCol) {
    // Forward flow: left to right
    return { sourceHandle: 'right-source', targetHandle: 'left-target' };
  } else {
    // Backward flow: right to left
    return { sourceHandle: 'left-source', targetHandle: 'right-target' };
  }
}

/**
 * Check if nodes have valid flowStageOrder for layout
 */
export function hasFlowMetadata(nodes: Node[]): boolean {
  return nodes.some(n => {
    const data = n.data as FlowNodeData;
    return typeof data.flowStageOrder === 'number' || typeof data.flowStage === 'string';
  });
}

/**
 * Enrich nodes with inferred flowStageOrder as starting point for edge propagation.
 * The actual positions are computed by edge propagation in layoutWithELK.
 */
export function enrichNodesWithFlowOrder(nodes: Node[]): Node[] {
  return nodes.map(n => {
    const data = n.data as FlowNodeData;
    // If agent provided flowStageOrder, preserve it (optional override)
    if (typeof data.flowStageOrder === 'number') {
      return n;
    }
    // Otherwise infer from keywords as starting point
    return {
      ...n,
      data: {
        ...data,
        flowStageOrder: getFlowStageOrder(n as any),
      },
    };
  });
}

/**
 * Generic subgraph-based layout for architecture diagrams.
 * Arranges nodes based on their subgraph layout type:
 * - 'lane' type: Horizontal rows, each lane gets its own row
 * - 'section' type: Vertical columns within a boundary region
 * - 'boundary' type: Container regions (e.g., Snowflake, AWS)
 * - 'group' type: General groupings
 * 
 * Works for ANY architecture template with subgraphs, not just streaming.
 */
export function layoutWithLanes(
  nodes: Node[],
  edges: Edge[],
  subgraphs?: Map<string, { label: string; nodes: string[]; parent?: string }>,
  layoutInfo?: Map<string, { id: string; type: string; index: number; badgeLabel: string; color: string; parent?: string }>
): { nodes: Node[]; edges: Edge[] } {
  // Check if nodes have layout metadata
  const hasLayoutMetadata = nodes.some(n => {
    const data = n.data as any;
    return typeof data.layoutType === 'string' || typeof data.lane === 'number';
  });
  
  if (!hasLayoutMetadata) {
    // Fall back to standard layout - no subgraph info
    return { nodes, edges };
  }
  
  // Layout constants - configurable for different diagram types
  const NODE_WIDTH = 180;
  const NODE_HEIGHT = 100;
  const LANE_HEIGHT = 140;
  const LANE_PADDING = 20;
  const COLUMN_WIDTH = 220;
  const LEFT_MARGIN = 80;
  const TOP_MARGIN = 60;
  const LANE_LABEL_WIDTH = 40;
  const SECTION_COLUMN_WIDTH = 200;
  const BOUNDARY_MARGIN_LEFT = 80;  // Extra margin for source boundaries (Producer App)
  
  // Analyze the subgraph structure to determine layout regions
  const laneSubgraphs: Array<{ id: string; index: number; label: string }> = [];
  const sectionSubgraphs: Array<{ id: string; index: number; label: string; parent?: string }> = [];
  const boundarySubgraphs: Array<{ id: string; index: number; label: string }> = [];
  
  if (layoutInfo) {
    for (const [id, info] of layoutInfo) {
      if (info.type === 'lane') {
        laneSubgraphs.push({ id, index: info.index, label: info.badgeLabel });
      } else if (info.type === 'section') {
        sectionSubgraphs.push({ id, index: info.index, label: info.badgeLabel, parent: info.parent });
      } else if (info.type === 'boundary') {
        boundarySubgraphs.push({ id, index: info.index, label: info.badgeLabel });
      }
    }
  }
  
  // Sort lanes and sections by index
  laneSubgraphs.sort((a, b) => a.index - b.index);
  sectionSubgraphs.sort((a, b) => a.index - b.index);
  
  // Group nodes by their layout type
  const laneNodes = new Map<number, Node[]>();
  const sectionNodes = new Map<string, Node[]>();
  const boundaryNodes: Node[] = [];
  const ungroupedNodes: Node[] = [];
  
  console.log('[layoutWithLanes] Processing nodes:', nodes.length);
  for (const node of nodes) {
    const data = node.data as any;
    const layoutType = data.layoutType as string | undefined;
    const subgraphId = data.subgraph as string | undefined;
    const laneIndex = data.lane as number | undefined;
    
    console.log(`[layoutWithLanes] Node ${node.id}: layoutType=${layoutType}, subgraph=${subgraphId}, lane=${laneIndex}`);
    
    if (layoutType === 'lane' && laneIndex !== undefined && laneIndex >= 0) {
      if (!laneNodes.has(laneIndex)) {
        laneNodes.set(laneIndex, []);
      }
      laneNodes.get(laneIndex)!.push(node);
    } else if (layoutType === 'section' && subgraphId) {
      if (!sectionNodes.has(subgraphId)) {
        sectionNodes.set(subgraphId, []);
      }
      sectionNodes.get(subgraphId)!.push(node);
    } else if (layoutType === 'boundary' || laneIndex === -1) {
      // Filter out label_area_* subgraphs - these are template artifacts for badge positioning
      // They have fill:none,stroke:none in Mermaid but render as gray boxes if not filtered
      const nodeIdLower = node.id.toLowerCase();
      const subgraphLower = subgraphId?.toLowerCase() || '';
      if (nodeIdLower.startsWith('label_area_') || subgraphLower.startsWith('label_area_')) {
        console.log(`[layoutWithLanes] Skipping label_area boundary: ${node.id}`);
        continue;  // Skip this node entirely
      }
      boundaryNodes.push(node);
    } else if (laneIndex === 99 && subgraphId) {
      // Legacy: section nodes marked with lane 99
      if (!sectionNodes.has(subgraphId)) {
        sectionNodes.set(subgraphId, []);
      }
      sectionNodes.get(subgraphId)!.push(node);
    } else {
      ungroupedNodes.push(node);
    }
  }
  
  // Create lane label badge nodes
  const labelNodes: Node[] = [];
  const numLanes = laneSubgraphs.length || laneNodes.size;
  console.log(`[layoutWithLanes] Creating labels: numLanes=${numLanes}, laneSubgraphs=`, laneSubgraphs.map(s => s.label));
  
  // =============================================================================
  // HORIZONTAL LANE LAYOUT: Lanes are COLUMNS arranged left-to-right (1A→1B→1C→1D)
  // Each lane is a vertical column. Badges appear at TOP of each column.
  // Nodes within each lane are stacked vertically within their column.
  // =============================================================================
  
  const LANE_COLUMN_WIDTH = 220;  // Width of each lane column
  const LANE_START_X = LEFT_MARGIN;
  const BADGE_Y = TOP_MARGIN - 50;  // Badges at TOP, above content
  
  // Add lane labels (positioned at TOP of each horizontal column)
  // Reference architecture: 1A, 1B, 1C, 1D flow left-to-right as column headers
  for (let i = 0; i < numLanes; i++) {
    const laneInfo = laneSubgraphs[i];
    const label = laneInfo?.label || String(i + 1);
    const laneX = LANE_START_X + i * LANE_COLUMN_WIDTH;
    
    if (label) {
      labelNodes.push({
        id: `lane_label_${label}`,
        type: 'laneLabelNode',
        data: {
          label: label,
          isLaneLabel: true,
          backgroundColor: '#7C3AED',  // Purple for lane badges
          textColor: '#FFFFFF',
        },
        // Position badge at TOP CENTER of each lane column
        position: { x: laneX + (LANE_COLUMN_WIDTH - 36) / 2, y: BADGE_Y },
        style: {
          width: 36,
          height: 36,
          borderRadius: 4,
          background: '#7C3AED',  // Purple for lane badges
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 'bold',
          fontSize: '14px',
          border: 'none',
          zIndex: 100,  // Ensure badges render above node boxes
        },
      });
    }
  }
  
  // Calculate where sections start (after all lane columns)
  // With horizontal lanes, sections start after the rightmost lane column
  const SECTION_START_X = LANE_START_X + numLanes * LANE_COLUMN_WIDTH + 50;
  
  // Add section labels (top badges above section columns)
  for (let i = 0; i < sectionSubgraphs.length; i++) {
    const sectionInfo = sectionSubgraphs[i];
    const label = sectionInfo.label;
    const sectionX = SECTION_START_X + i * SECTION_COLUMN_WIDTH;
    
    if (label) {
      labelNodes.push({
        id: `section_label_${label}`,
        type: 'laneLabelNode',
        data: {
          label: label,
          isSectionLabel: true,
          backgroundColor: '#2563EB',  // Blue for section badges
          textColor: '#FFFFFF',
        },
        position: { x: sectionX + (SECTION_COLUMN_WIDTH - 36) / 2, y: TOP_MARGIN - 50 },
        style: {
          width: 36,
          height: 36,
          borderRadius: 4,
          background: '#2563EB',  // Blue for section badges
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 'bold',
          fontSize: '14px',
          border: 'none',
          zIndex: 100,  // Ensure badges render above node boxes
        },
      });
    }
  }
  
  // Position boundary nodes based on edge flow direction
  // Sources (only outgoing edges) go LEFT, Sinks (only incoming edges) go RIGHT
  // With horizontal lanes, calculate total content height for vertical centering
  
  // First, calculate max nodes in any lane to determine content height
  let maxNodesInAnyLane = 1;
  for (const [_laneIdx, nodesInLane] of laneNodes) {
    if (nodesInLane.length > maxNodesInAnyLane) {
      maxNodesInAnyLane = nodesInLane.length;
    }
  }
  const VERTICAL_SPACING = NODE_HEIGHT + 30;
  const totalContentHeight = maxNodesInAnyLane * NODE_HEIGHT + (maxNodesInAnyLane - 1) * 30;
  
  // Analyze boundary nodes to classify as source or sink
  const sourceBoundaryNodes: typeof boundaryNodes = [];
  const sinkBoundaryNodes: typeof boundaryNodes = [];
  
  for (const node of boundaryNodes) {
    const hasOutgoing = edges.some(e => e.source === node.id);
    const hasIncoming = edges.some(e => e.target === node.id);
    
    if (hasOutgoing && !hasIncoming) {
      // Source: only sends edges (e.g., Producer App)
      sourceBoundaryNodes.push(node);
    } else if (hasIncoming && !hasOutgoing) {
      // Sink: only receives edges (e.g., Consumer App)
      sinkBoundaryNodes.push(node);
    } else if (hasIncoming && hasOutgoing) {
      // Both: treat as source (left side) for now
      sourceBoundaryNodes.push(node);
    } else {
      // No edges: default to left
      sourceBoundaryNodes.push(node);
    }
  }
  
  // Position source boundary nodes on LEFT (with extra margin for spacing)
  sourceBoundaryNodes.forEach((node, idx) => {
    node.position = {
      x: -BOUNDARY_MARGIN_LEFT - idx * 140,
      y: TOP_MARGIN + totalContentHeight / 2 - NODE_HEIGHT / 2,
    };
  });
  
  // Calculate right edge position (after all lanes are laid out)
  // We'll update sink positions after lane layout - store reference for now
  const sinkBoundaryNodeIds = new Set(sinkBoundaryNodes.map(n => n.id));
  
  // =============================================================================
  // HORIZONTAL LANE NODE POSITIONING
  // Each lane is a COLUMN. Lane index determines X position.
  // Nodes within each lane are stacked VERTICALLY within their column.
  // =============================================================================
  const sortedLaneIndices = Array.from(laneNodes.keys()).sort((a, b) => a - b);
  
  for (const laneIdx of sortedLaneIndices) {
    const nodesInLane = laneNodes.get(laneIdx)!;
    
    // Calculate X position for this lane column
    const laneX = LANE_START_X + laneIdx * LANE_COLUMN_WIDTH;
    
    // Stack nodes vertically within this lane column
    // Center the stack vertically based on tallest column
    const stackHeight = nodesInLane.length;
    const totalStackHeight = stackHeight * NODE_HEIGHT + (stackHeight - 1) * 30;
    const startY = TOP_MARGIN + (totalContentHeight - totalStackHeight) / 2;
    
    nodesInLane.forEach((node, stackIdx) => {
      node.position = {
        x: laneX + (LANE_COLUMN_WIDTH - NODE_WIDTH) / 2,  // Center node within column
        y: startY + stackIdx * VERTICAL_SPACING,
      };
    });
    
    console.log(`[layoutWithLanes] Lane ${laneIdx}: ${nodesInLane.length} nodes at x=${laneX}`);
  }
  
  // Position section nodes
  for (let sectionIdx = 0; sectionIdx < sectionSubgraphs.length; sectionIdx++) {
    const sectionId = sectionSubgraphs[sectionIdx].id;
    const nodesInSection = sectionNodes.get(sectionId) || [];
    
    const sectionX = SECTION_START_X + sectionIdx * SECTION_COLUMN_WIDTH;
    
    // Stack nodes vertically within each section column
    nodesInSection.forEach((node, rowIdx) => {
      node.position = {
        x: sectionX,
        y: TOP_MARGIN + rowIdx * (NODE_HEIGHT + 30),
      };
    });
  }
  
  // Handle sections not in sectionSubgraphs (legacy section_N naming)
  for (const [sectionId, nodesInSection] of sectionNodes) {
    if (!sectionSubgraphs.find(s => s.id === sectionId)) {
      // Extract index from section ID if possible
      const indexMatch = sectionId.match(/(\d+)/);
      const sectionIdx = indexMatch ? parseInt(indexMatch[1], 10) - 1 : sectionNodes.size;
      const sectionX = SECTION_START_X + sectionIdx * SECTION_COLUMN_WIDTH;
      
      nodesInSection.forEach((node, rowIdx) => {
        if (node.position.x === 0 && node.position.y === 0) {
          node.position = {
            x: sectionX,
            y: TOP_MARGIN + rowIdx * (NODE_HEIGHT + 30),
          };
        }
      });
    }
  }
  
  // Position ungrouped nodes at the bottom
  ungroupedNodes.forEach((node, idx) => {
    node.position = {
      x: LANE_START_X + idx * LANE_COLUMN_WIDTH,
      y: TOP_MARGIN + totalContentHeight + 50,
    };
  });
  
  // Position SINK boundary nodes on the RIGHT (after all lane/section content)
  // Calculate the rightmost X position from all positioned nodes
  let maxRightX = LANE_START_X;
  for (const [_laneIdx, nodesInLane] of laneNodes) {
    for (const node of nodesInLane) {
      const rightEdge = node.position.x + NODE_WIDTH;
      if (rightEdge > maxRightX) {
        maxRightX = rightEdge;
      }
    }
  }
  for (const [_sectionId, nodesInSection] of sectionNodes) {
    for (const node of nodesInSection) {
      const rightEdge = node.position.x + NODE_WIDTH;
      if (rightEdge > maxRightX) {
        maxRightX = rightEdge;
      }
    }
  }
  
  // Position sink boundary nodes to the right of all content
  sinkBoundaryNodes.forEach((node, idx) => {
    node.position = {
      x: maxRightX + 80 + idx * 140,  // 80px gap after rightmost content
      y: TOP_MARGIN + totalContentHeight / 2 - NODE_HEIGHT / 2,
    };
    console.log(`[layoutWithLanes] Positioned sink boundary node ${node.id} at x=${node.position.x}`);
  });
  
  // Filter out existing badge nodes from Mermaid parse - we'll use our positioned labelNodes instead
  // Also filter out helper nodes (spacers, labels) that are template artifacts
  // Badge nodes from Mermaid have isBadgeNode: true or id starting with 'badge_'
  const filteredBadges: string[] = [];
  const filteredHelpers: string[] = [];
  const nonHelperNodes = nodes.filter(n => {
    const data = n.data as any;
    const idLower = n.id.toLowerCase();
    
    // Filter out badge nodes
    const isBadge = data?.isBadgeNode === true || 
                    idLower.startsWith('badge_') ||
                    n.type === 'laneLabelNode';
    
    // Filter out spacer/label helper nodes from Mermaid templates
    // Also filter label_area_* subgraph containers (template artifacts for badge positioning)
    const isHelper = idLower.startsWith('spacer_') ||
                     idLower.startsWith('label_') ||
                     idLower.startsWith('label_area_') ||
                     idLower.includes('_node') && (idLower.includes('spacer') || idLower.includes('label'));
    
    if (isBadge) filteredBadges.push(n.id);
    if (isHelper) filteredHelpers.push(n.id);
    
    return !isBadge && !isHelper && !boundaryNodes.includes(n);
  });
  console.log(`[layoutWithLanes] Filtered badges:`, filteredBadges);
  console.log(`[layoutWithLanes] Filtered helpers:`, filteredHelpers);
  
  // Combine all nodes: label nodes (properly positioned) + positioned original nodes (minus helpers)
  const allNodes = [...labelNodes, ...boundaryNodes, ...nonHelperNodes];
  console.log(`[layoutWithLanes] Final output: ${allNodes.length} nodes (${labelNodes.length} labels, ${boundaryNodes.length} boundaries, ${nonHelperNodes.length} content)`);
  console.log(`[layoutWithLanes] Label nodes:`, labelNodes.map(n => `${n.id}@(${n.position.x},${n.position.y})`));
  
  // Reassign handles based on actual node positions for optimal routing
  const nodePositionMap = new Map(allNodes.map(n => [n.id, n.position]));
  const edgesWithOptimalHandles = edges.map(e => {
    const sourcePos = nodePositionMap.get(e.source);
    const targetPos = nodePositionMap.get(e.target);
    
    if (sourcePos && targetPos) {
      const dx = targetPos.x - sourcePos.x;
      const dy = targetPos.y - sourcePos.y;
      
      let sourceHandle: string;
      let targetHandle: string;
      
      // Choose handles based on relative positions
      if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal dominant
        if (dx > 0) {
          sourceHandle = 'right-source';
          targetHandle = 'left-target';
        } else {
          sourceHandle = 'left-source';
          targetHandle = 'right-target';
        }
      } else {
        // Vertical dominant
        if (dy > 0) {
          sourceHandle = 'bottom-source';
          targetHandle = 'top-target';
        } else {
          sourceHandle = 'top-source';
          targetHandle = 'bottom-target';
        }
      }
      
      return {
        ...e,
        sourceHandle,
        targetHandle,
        type: 'smoothstep',  // Ensure orthogonal routing
      };
    }
    
    // Fallback for edges with unknown positions
    return {
      ...e,
      sourceHandle: e.sourceHandle || 'right-source',
      targetHandle: e.targetHandle || 'left-target',
      type: 'smoothstep',
    };
  });
  
  return { nodes: allNodes, edges: edgesWithOptimalHandles };
}

/**
 * Analyze lane structure to detect fan-in patterns (multiple sources → shared target).
 * Returns an array of "columns" where each column can have multiple vertically-stacked nodes.
 * 
 * Example: For path_1b with kinesis, event_hubs, pubsub → compute:
 * Returns: [[kinesis, event_hubs, pubsub], [compute]]
 * These get stacked vertically in column 0, then compute in column 1.
 * 
 * CROSS-REGION FAN-IN: Also detects when all nodes in a lane connect to the SAME target
 * outside the lane (e.g., path_1c: s3, azure_blob, gcs → snowpipe in section_2).
 */
function analyzeLaneStructure(
  nodes: Node[], 
  edges: Edge[]
): { columns: Node[][]; requiresVerticalStack: boolean } {
  if (nodes.length <= 1) return { columns: [nodes], requiresVerticalStack: false };
  
  const nodeIds = new Set(nodes.map(n => n.id));
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();
  const inEdges = new Map<string, string[]>();
  // Track edges going OUT of the lane to external targets
  const externalOutEdges = new Map<string, string[]>();
  
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    outEdges.set(node.id, []);
    inEdges.set(node.id, []);
    externalOutEdges.set(node.id, []);
  }
  
  // Count in-degree within lane and track edge directions (including cross-region)
  for (const edge of edges) {
    const sourceInLane = nodeIds.has(edge.source);
    const targetInLane = nodeIds.has(edge.target);
    
    if (sourceInLane && targetInLane) {
      // Intra-lane edge
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
      outEdges.get(edge.source)?.push(edge.target);
      inEdges.get(edge.target)?.push(edge.source);
    } else if (sourceInLane && !targetInLane) {
      // Cross-region edge: source in lane, target outside
      externalOutEdges.get(edge.source)?.push(edge.target);
    }
  }
  
  // Detect INTRA-LANE fan-in pattern: nodes with multiple incoming edges from lane sources
  const fanInTargets: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree >= 2) {
      fanInTargets.push(nodeId);
    }
  }
  
  // Detect CROSS-REGION fan-in pattern: multiple lane nodes connecting to SAME external target
  // This handles cases like path_1c where s3, azure_blob, gcs all → snowpipe (in section_2)
  const externalTargetCounts = new Map<string, string[]>(); // external target → sources in this lane
  for (const [nodeId, targets] of externalOutEdges) {
    for (const target of targets) {
      if (!externalTargetCounts.has(target)) {
        externalTargetCounts.set(target, []);
      }
      externalTargetCounts.get(target)!.push(nodeId);
    }
  }
  
  // Find external targets that have 2+ sources from this lane (cross-region fan-in)
  const crossRegionFanInSources: string[] = [];
  for (const [externalTarget, sources] of externalTargetCounts) {
    if (sources.length >= 2) {
      crossRegionFanInSources.push(...sources);
      console.log(`[analyzeLaneStructure] Cross-region fan-in detected: ${sources.join(', ')} → ${externalTarget} (external)`);
    }
  }
  
  // If we have intra-lane OR cross-region fan-in patterns, group parallel sources together
  if (fanInTargets.length > 0 || crossRegionFanInSources.length > 0) {
    const columns: Node[][] = [];
    const placed = new Set<string>();
    
    // Find nodes with in-degree 0 (sources) - these should be stacked vertically if they share a target
    const sources = nodes.filter(n => (inDegree.get(n.id) || 0) === 0);
    
    // Group sources by their shared INTRA-LANE target
    const sourcesByTarget = new Map<string, Node[]>();
    for (const source of sources) {
      const targets = outEdges.get(source.id) || [];
      for (const target of targets) {
        if (fanInTargets.includes(target)) {
          if (!sourcesByTarget.has(target)) {
            sourcesByTarget.set(target, []);
          }
          sourcesByTarget.get(target)!.push(source);
        }
      }
    }
    
    // First column: vertically stack all sources that share a fan-in target (intra-lane)
    const stackedSources: Node[] = [];
    for (const [_target, sourcesForTarget] of sourcesByTarget) {
      if (sourcesForTarget.length >= 2) {
        for (const src of sourcesForTarget) {
          if (!placed.has(src.id)) {
            stackedSources.push(src);
            placed.add(src.id);
          }
        }
      }
    }
    
    // Also stack CROSS-REGION fan-in sources (they share an external target)
    for (const sourceId of crossRegionFanInSources) {
      if (!placed.has(sourceId)) {
        const node = nodes.find(n => n.id === sourceId);
        if (node) {
          stackedSources.push(node);
          placed.add(sourceId);
        }
      }
    }
    
    if (stackedSources.length > 0) {
      columns.push(stackedSources);
    }
    
    // Add non-stacked sources as individual columns
    for (const source of sources) {
      if (!placed.has(source.id)) {
        columns.push([source]);
        placed.add(source.id);
      }
    }
    
    // Add fan-in targets in the next column
    const fanInNodes = nodes.filter(n => fanInTargets.includes(n.id) && !placed.has(n.id));
    if (fanInNodes.length > 0) {
      columns.push(fanInNodes);
      fanInNodes.forEach(n => placed.add(n.id));
    }
    
    // Topologically sort remaining nodes
    const remaining = nodes.filter(n => !placed.has(n.id));
    if (remaining.length > 0) {
      const sorted = orderNodesSimple(remaining, edges);
      for (const node of sorted) {
        columns.push([node]);
      }
    }
    
    return { columns, requiresVerticalStack: stackedSources.length >= 2 };
  }
  
  // No fan-in pattern - use simple linear ordering
  const sorted = orderNodesSimple(nodes, edges);
  return { columns: sorted.map(n => [n]), requiresVerticalStack: false };
}

/**
 * Simple topological ordering without fan-in detection.
 */
function orderNodesSimple(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length <= 1) return nodes;
  
  const nodeIds = new Set(nodes.map(n => n.id));
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();
  
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    outEdges.set(node.id, []);
  }
  
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
      outEdges.get(edge.source)?.push(edge.target);
    }
  }
  
  const result: Node[] = [];
  const queue: string[] = [];
  
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }
  
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodes.find(n => n.id === nodeId);
    if (node) result.push(node);
    
    for (const targetId of outEdges.get(nodeId) || []) {
      const newDegree = (inDegree.get(targetId) || 1) - 1;
      inDegree.set(targetId, newDegree);
      if (newDegree === 0) queue.push(targetId);
    }
  }
  
  for (const node of nodes) {
    if (!result.includes(node)) {
      result.push(node);
    }
  }
  
  return result;
}

/**
 * Order nodes within a lane based on edge connections.
 * Nodes that are sources come before targets.
 * @deprecated Use analyzeLaneStructure for better parallel path handling
 */
function orderNodesInLane(nodes: Node[], edges: Edge[]): Node[] {
  return orderNodesSimple(nodes, edges);
}

export default layoutWithELK
