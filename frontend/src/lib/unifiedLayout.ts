/**
 * unifiedLayout — Single layout function consuming DiagramSpec.
 *
 * Replaces the dual-path system (layoutWithELK + layoutWithLanes) with one
 * function that handles all cases by reading group metadata from the spec.
 *
 * Layout strategy:
 *   1. If spec.groups contains lanes: nodes positioned in vertical columns by lane
 *      with topology-aware ordering within each lane (analyzeLaneStructure).
 *   2. If spec.groups contains sections: nodes positioned in horizontal columns by
 *      section, after lanes, with edge-propagation topological sort within each.
 *   3. If spec has neither: fall back to edge-propagation column-based layout
 *      (same algorithm as the old layoutWithELK).
 *
 * Badges are placed declaratively from spec.badges — no post-layout repositioning.
 */

import { Edge, Node } from 'reactflow';
import {
  DiagramSpec,
  DiagramNode,
  DiagramGroup,
  DiagramBadge,
} from './types/diagramSpec';
import { NODE_DIMENSIONS } from './textMeasure';
import { LAYER_COLORS, getStageColor } from './mermaidToReactFlow';
import { resolveIcon } from './iconResolver';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const NODE_WIDTH = NODE_DIMENSIONS.WIDTH_DEFAULT;
const NODE_HEIGHT = NODE_DIMENSIONS.HEIGHT_DEFAULT;
const LANE_COLUMN_WIDTH = NODE_DIMENSIONS.LANE_COLUMN_WIDTH;
const SECTION_COLUMN_WIDTH = NODE_DIMENSIONS.SECTION_COLUMN_WIDTH;

const TOP_MARGIN = 60;
const LEFT_MARGIN = 80;
const ROW_SPACING = 30;
const VERTICAL_SPACING = NODE_HEIGHT + ROW_SPACING;
const BADGE_SIZE = 36;
const BADGE_OFFSET = 50; // distance from content edge

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface UnifiedLayoutOptions {
  isDarkMode: boolean;
}

export interface UnifiedLayoutResult {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Compute ReactFlow positions for a DiagramSpec.
 */
export function unifiedLayout(
  spec: DiagramSpec,
  options: UnifiedLayoutOptions,
): UnifiedLayoutResult {
  const lanes = spec.groups.filter(g => g.type === 'lane').sort((a, b) => a.index - b.index);
  const sections = spec.groups.filter(g => g.type === 'section').sort((a, b) => a.index - b.index);

  // Build node→group lookup
  const nodesByGroup = new Map<string, DiagramNode[]>();
  const ungrouped: DiagramNode[] = [];
  for (const n of spec.nodes) {
    if (n.groupId) {
      if (!nodesByGroup.has(n.groupId)) nodesByGroup.set(n.groupId, []);
      nodesByGroup.get(n.groupId)!.push(n);
    } else {
      ungrouped.push(n);
    }
  }

  // Order nodes within each group using topology
  for (const [groupId, groupNodes] of nodesByGroup) {
    nodesByGroup.set(groupId, orderNodesByTopology(groupNodes, spec.edges));
  }

  // Compute total content height for vertical centering
  let maxNodesPerLane = 1;
  for (const lane of lanes) {
    const count = nodesByGroup.get(lane.id)?.length ?? 0;
    if (count > maxNodesPerLane) maxNodesPerLane = count;
  }
  let maxNodesPerSection = 1;
  for (const section of sections) {
    const count = nodesByGroup.get(section.id)?.length ?? 0;
    if (count > maxNodesPerSection) maxNodesPerSection = count;
  }
  const maxStackHeight = Math.max(maxNodesPerLane, maxNodesPerSection, 1) * VERTICAL_SPACING - ROW_SPACING;

  // Position nodes
  const positions = new Map<string, { x: number; y: number }>();
  const laneStartX = LEFT_MARGIN;

  // Lanes: each lane is a vertical column
  lanes.forEach((lane, laneIdx) => {
    const groupNodes = nodesByGroup.get(lane.id) ?? [];
    const stackHeight = groupNodes.length * VERTICAL_SPACING - ROW_SPACING;
    const startY = TOP_MARGIN + (maxStackHeight - stackHeight) / 2;
    const laneX = laneStartX + laneIdx * LANE_COLUMN_WIDTH;
    groupNodes.forEach((n, rowIdx) => {
      positions.set(n.id, {
        x: laneX + (LANE_COLUMN_WIDTH - NODE_WIDTH) / 2,
        y: startY + rowIdx * VERTICAL_SPACING,
      });
    });
  });

  // Sections: positioned after lanes, each section is a vertical stack within a horizontal column
  const sectionStartX = laneStartX + lanes.length * LANE_COLUMN_WIDTH + (lanes.length > 0 ? 50 : 0);
  sections.forEach((section, sectionIdx) => {
    const groupNodes = nodesByGroup.get(section.id) ?? [];
    const stackHeight = groupNodes.length * VERTICAL_SPACING - ROW_SPACING;
    const startY = TOP_MARGIN + (maxStackHeight - stackHeight) / 2;
    const sectionX = sectionStartX + sectionIdx * SECTION_COLUMN_WIDTH;
    groupNodes.forEach((n, rowIdx) => {
      positions.set(n.id, {
        x: sectionX,
        y: startY + rowIdx * VERTICAL_SPACING,
      });
    });
  });

  // Ungrouped nodes: use edge-propagation column layout (matches old layoutWithELK)
  if (ungrouped.length > 0) {
    const columnLayout = layoutByEdgePropagation(ungrouped, spec.edges);
    const ungroupedStartX = sections.length > 0
      ? sectionStartX + sections.length * SECTION_COLUMN_WIDTH + 50
      : laneStartX;
    columnLayout.forEach(({ id, col, row, totalRows }) => {
      const stackHeight = totalRows * VERTICAL_SPACING - ROW_SPACING;
      const startY = TOP_MARGIN + (maxStackHeight - stackHeight) / 2;
      positions.set(id, {
        x: ungroupedStartX + col * (NODE_WIDTH + NODE_DIMENSIONS.COL_SPACING),
        y: startY + row * VERTICAL_SPACING,
      });
    });
  }

  // Build ReactFlow nodes
  const flowNodes: Node[] = spec.nodes.map(n => specNodeToFlowNode(n, positions, options));

  // Add badge nodes from spec.badges (declarative placement)
  const badgeNodes = buildBadgeNodes(spec.badges, lanes, sections, nodesByGroup, positions);
  flowNodes.push(...badgeNodes);

  // Build ReactFlow edges
  const flowEdges: Edge[] = spec.edges.map((e, idx) => specEdgeToFlowEdge(e, idx, options));

  return { nodes: flowNodes, edges: flowEdges };
}

// ---------------------------------------------------------------------------
// Topological ordering within a group (handles fan-in, edge propagation)
// ---------------------------------------------------------------------------

/**
 * Order nodes within a group using edge-aware topological sort.
 *
 * If multiple nodes share a fan-in target inside the group, they are stacked
 * adjacently. Otherwise simple Kahn-style topological sort by in-degree.
 */
function orderNodesByTopology(nodes: DiagramNode[], edges: { source: string; target: string }[]): DiagramNode[] {
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

  const result: DiagramNode[] = [];
  const queue: string[] = [];
  const placed = new Set<string>();

  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (placed.has(nodeId)) continue;
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      result.push(node);
      placed.add(nodeId);
    }
    for (const targetId of outEdges.get(nodeId) || []) {
      const newDegree = (inDegree.get(targetId) || 1) - 1;
      inDegree.set(targetId, newDegree);
      if (newDegree === 0) queue.push(targetId);
    }
  }

  // Append any remaining nodes (e.g., those in cycles)
  for (const node of nodes) {
    if (!placed.has(node.id)) result.push(node);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Edge-propagation column layout (for ungrouped nodes)
// ---------------------------------------------------------------------------

/**
 * Assign nodes to columns using edge propagation.
 *
 * Starting stage = node.flowStageOrder (or 3 default). For each edge source→target,
 * push target's stage to source.stage + 0.5. Run up to 10 passes for convergence.
 * Returns {id, col, row, totalRows} for each node.
 */
function layoutByEdgePropagation(
  nodes: DiagramNode[],
  edges: { source: string; target: string }[],
): { id: string; col: number; row: number; totalRows: number }[] {
  const stages = new Map<string, number>();
  for (const n of nodes) {
    stages.set(n.id, typeof n.flowStageOrder === 'number' ? n.flowStageOrder : 3);
  }

  const nodeIds = new Set(nodes.map(n => n.id));
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const e of edges) {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
      const sourceStage = stages.get(e.source) ?? 3;
      const targetStage = stages.get(e.target) ?? 3;
      if (sourceStage >= targetStage) {
        stages.set(e.target, sourceStage + 0.5);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group nodes by integer column (Math.floor of stage)
  const columnGroups = new Map<number, DiagramNode[]>();
  for (const n of nodes) {
    const col = Math.floor(stages.get(n.id) ?? 3);
    if (!columnGroups.has(col)) columnGroups.set(col, []);
    columnGroups.get(col)!.push(n);
  }

  const sortedCols = [...columnGroups.keys()].sort((a, b) => a - b);

  // Sort within each column by stage (preserves CDC=2.5 before Transform=3)
  for (const col of sortedCols) {
    columnGroups.get(col)!.sort((a, b) => (stages.get(a.id) ?? 3) - (stages.get(b.id) ?? 3));
  }

  const result: { id: string; col: number; row: number; totalRows: number }[] = [];
  let maxRows = 1;
  for (const col of sortedCols) {
    const count = columnGroups.get(col)!.length;
    if (count > maxRows) maxRows = count;
  }

  sortedCols.forEach((col, colIdx) => {
    const nodesInCol = columnGroups.get(col)!;
    nodesInCol.forEach((n, rowIdx) => {
      result.push({ id: n.id, col: colIdx, row: rowIdx, totalRows: nodesInCol.length });
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Spec → ReactFlow node/edge converters
// ---------------------------------------------------------------------------

function specNodeToFlowNode(
  n: DiagramNode,
  positions: Map<string, { x: number; y: number }>,
  options: UnifiedLayoutOptions,
): Node {
  const layer = n.layer ?? 'snowflake';
  const layerColors = LAYER_COLORS[layer];
  const borderColor = layerColors?.border ?? '#29B5E8';
  const background = options.isDarkMode
    ? layerColors?.backgroundDark ?? '#1e3a4a'
    : layerColors?.background ?? '#E6F7FF';

  // Apply stage color override if flowStageOrder is set
  const stageColor = typeof n.flowStageOrder === 'number'
    ? getStageColor(n.flowStageOrder, options.isDarkMode)
    : null;

  return {
    id: n.id,
    type: 'snowflakeNode',
    data: {
      label: n.label,
      componentType: n.componentType,
      layer,
      flowStageOrder: n.flowStageOrder,
      icon: resolveIcon(n.componentType, n.label, n.flowStageOrder),
      labelColor: options.isDarkMode ? '#E5EDF5' : '#0F172A',
      isDarkMode: options.isDarkMode,
      showHandles: true,
      subgraph: n.groupId,
    },
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    style: {
      border: `2px solid ${stageColor?.border ?? borderColor}`,
      borderRadius: 8,
      background: stageColor?.background ?? background,
      color: options.isDarkMode ? '#e5f2ff' : '#0F172A',
    },
  };
}

function specEdgeToFlowEdge(
  e: { source: string; target: string; label?: string; style?: 'solid' | 'dotted' | 'thick' },
  idx: number,
  options: UnifiedLayoutOptions,
): Edge {
  const stroke = options.isDarkMode ? '#60A5FA' : '#29B5E8';
  return {
    id: `${e.source}-${e.target}-${idx}`,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    animated: true,
    sourceHandle: 'right-source',
    targetHandle: 'left-target',
    label: e.label,
    labelStyle: e.label
      ? {
          fill: options.isDarkMode ? '#E5EDF5' : '#0F172A',
          fontSize: 12,
          fontWeight: 500,
        }
      : undefined,
    labelBgPadding: e.label ? [4, 2] : undefined,
    labelBgBorderRadius: e.label ? 4 : undefined,
    labelBgStyle: e.label
      ? {
          fill: options.isDarkMode ? '#1e3a4a' : '#FFFFFF',
          opacity: 0.9,
        }
      : undefined,
    style: {
      stroke,
      strokeWidth: 2.5,
      strokeDasharray: e.style === 'dotted' ? '5 5' : undefined,
    },
    deletable: true,
  };
}

// ---------------------------------------------------------------------------
// Badge placement
// ---------------------------------------------------------------------------

/**
 * Build badge nodes from spec.badges, positioned relative to their target group.
 *
 * Lane badges: placed to the LEFT of the lane column at vertical center.
 * Section badges: placed ABOVE the section column at horizontal center.
 */
function buildBadgeNodes(
  badges: DiagramBadge[],
  lanes: DiagramGroup[],
  sections: DiagramGroup[],
  nodesByGroup: Map<string, DiagramNode[]>,
  positions: Map<string, { x: number; y: number }>,
): Node[] {
  const result: Node[] = [];

  for (const badge of badges) {
    const group = badge.variant === 'lane'
      ? lanes.find(l => l.id === badge.groupId)
      : sections.find(s => s.id === badge.groupId);
    if (!group) continue;

    const groupNodes = nodesByGroup.get(group.id) ?? [];
    if (groupNodes.length === 0) continue;

    const nodePositions = groupNodes
      .map(n => positions.get(n.id))
      .filter((p): p is { x: number; y: number } => !!p);
    if (nodePositions.length === 0) continue;

    let x: number;
    let y: number;
    if (badge.variant === 'lane') {
      // Place to the left of leftmost node in the lane, vertically centered
      const minX = Math.min(...nodePositions.map(p => p.x));
      const minY = Math.min(...nodePositions.map(p => p.y));
      const maxY = Math.max(...nodePositions.map(p => p.y + NODE_HEIGHT));
      x = minX - BADGE_OFFSET;
      y = (minY + maxY) / 2 - BADGE_SIZE / 2;
    } else {
      // Place above the topmost node in the section, horizontally centered
      const minX = Math.min(...nodePositions.map(p => p.x));
      const maxX = Math.max(...nodePositions.map(p => p.x + NODE_WIDTH));
      const minY = Math.min(...nodePositions.map(p => p.y));
      x = (minX + maxX) / 2 - BADGE_SIZE / 2;
      y = minY - BADGE_OFFSET;
    }

    const isLane = badge.variant === 'lane';
    result.push({
      id: badge.id,
      type: 'laneLabelNode',
      data: {
        label: badge.label,
        isLaneLabel: isLane,
        isSectionLabel: !isLane,
        isBadgeNode: true,
        badgeClass: isLane ? 'laneBadge' : 'sectionBadge',
        backgroundColor: isLane ? '#7C3AED' : '#2563EB',
        textColor: '#FFFFFF',
      },
      position: { x, y },
      style: {
        background: isLane ? '#7C3AED' : '#2563EB',
        color: '#FFFFFF',
        border: `2px solid ${isLane ? '#5B21B6' : '#1D4ED8'}`,
        borderRadius: 4,
        fontWeight: 'bold',
        fontSize: '14px',
        width: BADGE_SIZE,
        height: BADGE_SIZE,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      },
    });
  }

  return result;
}
