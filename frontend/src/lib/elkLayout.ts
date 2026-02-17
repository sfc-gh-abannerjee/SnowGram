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
const COL_SPACING = 200;     // horizontal space between stage columns
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

  // Step 1: Get flowStageOrder and layout column for each internal node
  const nodeStages = new Map<string, number>();
  const nodeColumns = new Map<string, number>();
  
  internalNodes.forEach(n => {
    const data = n.data as FlowNodeData;
    const stage = data.flowStageOrder ?? getFlowStageOrder(n as any);
    nodeStages.set(n.id, stage);
  });

  // Step 1b: Edge-aware stage propagation
  // If A → B and A.stage >= B.stage, push B.stage to A.stage + 0.5
  // This ensures downstream nodes (e.g., CDC after Silver) get higher stages
  // 
  // EXCEPTION: Ignore edges FROM utility/compute nodes (warehouse, compute pool)
  // These are "support" edges that shouldn't affect pipeline flow order
  
  const UTILITY_KEYWORDS = ['warehouse', 'compute', 'pool'];
  function isUtilityNode(nodeId: string): boolean {
    const node = internalNodes.find(n => n.id === nodeId);
    if (!node) return false;
    const data = node.data as FlowNodeData;
    const text = `${nodeId} ${data.label || ''} ${data.componentType || ''}`.toLowerCase();
    return UTILITY_KEYWORDS.some(kw => text.includes(kw));
  }
  
  const internalNodeIds = new Set(internalNodes.map(n => n.id));
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    edges.forEach(e => {
      // Only consider edges between internal nodes
      if (!internalNodeIds.has(e.source) || !internalNodeIds.has(e.target)) return;
      
      // Skip edges FROM utility nodes (warehouse → task should not push task forward)
      if (isUtilityNode(e.source)) return;
      
      const sourceStage = nodeStages.get(e.source) ?? 3;
      const targetStage = nodeStages.get(e.target) ?? 3;
      
      // If source stage >= target stage, target should be later
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
 * Enrich nodes with inferred flowStageOrder if not provided by agent
 */
export function enrichNodesWithFlowOrder(nodes: Node[]): Node[] {
  return nodes.map(n => ({
    ...n,
    data: {
      ...(n.data as FlowNodeData),
      flowStageOrder: getFlowStageOrder(n as any),
    },
  }));
}

export default layoutWithELK;
