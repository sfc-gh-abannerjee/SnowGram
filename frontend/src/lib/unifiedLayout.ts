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
import { NODE_DIMENSIONS, calculateNodeDimensions } from './textMeasure';
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
  const laneAndSectionIds = new Set<string>([
    ...lanes.map(l => l.id),
    ...sections.map(s => s.id),
  ]);

  // Build node→group lookup. Lane/section group members are positioned by
  // their group; everything else (container groups like producer/consumer,
  // top-level boundary groups, ungrouped) goes through edge-propagation
  // column layout so source nodes end up on the far left and sinks on the
  // far right of the canvas.
  const nodesByGroup = new Map<string, DiagramNode[]>();
  const ungrouped: DiagramNode[] = [];
  for (const n of spec.nodes) {
    if (n.groupId && laneAndSectionIds.has(n.groupId)) {
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

  // Ungrouped nodes (producer, consumer, and any standalone nodes).
  // Classify each as source (only outgoing edges in the graph), sink (only
  // incoming), or middle. Sources go to the far left of the canvas, sinks
  // to the far right of all positioned content.
  if (ungrouped.length > 0) {
    const allEdges = spec.edges;
    const sources: DiagramNode[] = [];
    const sinks: DiagramNode[] = [];
    const middle: DiagramNode[] = [];
    for (const n of ungrouped) {
      const hasIn = allEdges.some(e => e.target === n.id);
      const hasOut = allEdges.some(e => e.source === n.id);
      if (hasOut && !hasIn) sources.push(n);
      else if (hasIn && !hasOut) sinks.push(n);
      else middle.push(n);
    }

    // Determine the rightmost positioned X so far so we can place sinks past it
    let rightmostX = laneStartX;
    for (const [, nodes] of nodesByGroup) {
      for (const n of nodes) {
        const p = positions.get(n.id);
        if (p) rightmostX = Math.max(rightmostX, p.x + NODE_WIDTH);
      }
    }

    // Sources: stack vertically at the far left (negative X relative to lanes)
    const sourcesX = laneStartX - LANE_COLUMN_WIDTH;
    sources.forEach((n, idx) => {
      positions.set(n.id, {
        x: sourcesX,
        y: TOP_MARGIN + (maxStackHeight / 2) - NODE_HEIGHT / 2 + idx * VERTICAL_SPACING,
      });
    });

    // Sinks: stack vertically to the right of all content
    const sinksX = rightmostX + 80;
    sinks.forEach((n, idx) => {
      positions.set(n.id, {
        x: sinksX,
        y: TOP_MARGIN + (maxStackHeight / 2) - NODE_HEIGHT / 2 + idx * VERTICAL_SPACING,
      });
    });

    // Middle (no edges or both): use edge-propagation column layout
    if (middle.length > 0) {
      const columnLayout = layoutByEdgePropagation(middle, spec.edges);
      const middleStartX = sinksX + 200;
      columnLayout.forEach(({ id, col, row, totalRows }) => {
        const stackHeight = totalRows * VERTICAL_SPACING - ROW_SPACING;
        const startY = TOP_MARGIN + (maxStackHeight - stackHeight) / 2;
        positions.set(id, {
          x: middleStartX + col * (NODE_WIDTH + NODE_DIMENSIONS.COL_SPACING),
          y: startY + row * VERTICAL_SPACING,
        });
      });
    }
  }

  // Build ReactFlow nodes
  const flowNodes: Node[] = spec.nodes.map(n => specNodeToFlowNode(n, positions, options));

  // Add badge nodes from spec.badges (declarative placement)
  const badgeNodes = buildBadgeNodes(spec.badges, lanes, sections, nodesByGroup, positions);
  flowNodes.push(...badgeNodes);

  // Add account boundaries computed from subgraph membership.
  // A node is "Snowflake-internal" iff one of its ancestor groups has
  // id or label matching 'snowflake' (case-insensitive). Otherwise external.
  const boundaryNodes = buildAccountBoundaries(spec, positions, options);
  // Boundaries render BEHIND content nodes (lower zIndex)
  flowNodes.unshift(...boundaryNodes);

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
// Account boundary placement (Snowflake / External Sources)
// ---------------------------------------------------------------------------

const BOUNDARY_PADDING = 40;
const BOUNDARY_LABEL_OFFSET = 20;
const BOUNDARY_GAP = 60; // horizontal gap between External and Snowflake boundaries

/**
 * Build account-boundary nodes (Snowflake + External Sources) by classifying
 * each content node via its group ancestry.
 *
 * Replaces the legacy keyword-based isExternalNode / addAccountBoundaries
 * with subgraph-membership semantics: a node is internal iff any ancestor
 * group has id or label matching 'snowflake' (case-insensitive).
 */
function buildAccountBoundaries(
  spec: DiagramSpec,
  positions: Map<string, { x: number; y: number }>,
  options: UnifiedLayoutOptions,
): Node[] {
  // Build group lookup
  const groupById = new Map(spec.groups.map(g => [g.id, g]));

  // Locate the Snowflake boundary group (if any). Templates conventionally
  // use a top-level group with id='snowflake' or label containing 'Snowflake'.
  const snowflakeGroupIds = new Set<string>();
  for (const g of spec.groups) {
    const idLower = g.id.toLowerCase();
    const labelLower = g.label.toLowerCase();
    if (idLower === 'snowflake' || idLower === 'snowflake_account' ||
        labelLower === 'snowflake' || labelLower === 'snowflake account' ||
        labelLower.includes('snowflake account')) {
      snowflakeGroupIds.add(g.id);
    }
  }

  // Resolve ancestry: returns true if any ancestor of `groupId` is in the Snowflake set.
  const ancestorIsSnowflake = (groupId: string | undefined): boolean => {
    let current: string | undefined = groupId;
    const seen = new Set<string>(); // cycle guard
    while (current && !seen.has(current)) {
      seen.add(current);
      if (snowflakeGroupIds.has(current)) return true;
      current = groupById.get(current)?.parentId;
    }
    return false;
  };

  // Classify content nodes. For External, only include nodes inside a
  // 'lane' or 'section' group whose ancestor is NOT snowflake. This excludes
  // standalone nodes like producer/consumer that sit at the extremes —
  // including them would stretch the External bbox across the entire canvas
  // and cause it to overlap the Snowflake bbox.
  const isInLayoutGroup = (groupId: string | undefined): boolean => {
    if (!groupId) return false;
    const g = groupById.get(groupId);
    if (!g) return false;
    return g.type === 'lane' || g.type === 'section';
  };

  const internalNodes: typeof spec.nodes = [];
  const externalNodes: typeof spec.nodes = [];
  for (const n of spec.nodes) {
    if (snowflakeGroupIds.size > 0 && ancestorIsSnowflake(n.groupId)) {
      internalNodes.push(n);
    } else if (isInLayoutGroup(n.groupId)) {
      externalNodes.push(n);
    }
    // Else: standalone (e.g., producer, consumer) — don't include in any bbox
  }

  // If neither group is identifiable, skip boundaries entirely.
  if (snowflakeGroupIds.size === 0 || internalNodes.length === 0) {
    return [];
  }

  // Compute bounding boxes (accounts for node width/height)
  const bbox = (nodes: typeof spec.nodes) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const p = positions.get(n.id);
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_WIDTH);
      maxY = Math.max(maxY, p.y + NODE_HEIGHT);
    }
    if (minX === Infinity) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  const internalBox = bbox(internalNodes);
  const externalBox = bbox(externalNodes);

  const result: Node[] = [];

  if (internalBox) {
    result.push(makeBoundaryNode(
      'account_boundary_snowflake',
      'Snowflake Account',
      internalBox,
      '#29B5E8', // Snowflake brand blue
      options,
    ));
  }

  if (externalBox) {
    result.push(makeBoundaryNode(
      'account_boundary_external',
      'External Sources',
      externalBox,
      '#94A3B8', // neutral slate
      options,
    ));
  }

  return result;
}

function makeBoundaryNode(
  id: string,
  label: string,
  box: { x: number; y: number; w: number; h: number },
  borderColor: string,
  options: UnifiedLayoutOptions,
): Node {
  return {
    id,
    type: 'snowflakeNode',
    data: {
      label,
      componentType: id, // 'account_boundary_snowflake' or 'account_boundary_external'
      isAccountBoundary: true,
      isDarkMode: options.isDarkMode,
      showHandles: false,
      labelColor: options.isDarkMode ? '#94A3B8' : '#64748B',
    },
    position: {
      x: box.x - BOUNDARY_PADDING,
      y: box.y - BOUNDARY_PADDING - BOUNDARY_LABEL_OFFSET,
    },
    style: {
      width: box.w + BOUNDARY_PADDING * 2,
      height: box.h + BOUNDARY_PADDING * 2 + BOUNDARY_LABEL_OFFSET,
      border: `2px dashed ${borderColor}`,
      borderRadius: 12,
      background: 'transparent',
      color: borderColor,
      pointerEvents: 'none',
      zIndex: -1, // render behind content
    },
    draggable: false,
    selectable: false,
  };
}


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

  // Compute dynamic width/height from label so nodes don't collapse to 1ch
  // and wrap each character vertically. Mirrors the legacy pipeline's
  // calculateNodeDimensions usage in App.tsx.
  let width: number = NODE_DIMENSIONS.WIDTH_DEFAULT;
  let height: number = NODE_DIMENSIONS.HEIGHT_DEFAULT;
  let shouldWrap = false;
  if (typeof window !== 'undefined') {
    const dim = calculateNodeDimensions(n.label, {
      hasIcon: true,
      baseHeight: NODE_DIMENSIONS.HEIGHT_DEFAULT,
    });
    width = dim.width;
    height = dim.height;
    shouldWrap = dim.shouldWrap;
  }

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
      shouldWrap,
      subgraph: n.groupId,
    },
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    style: {
      border: `2px solid ${stageColor?.border ?? borderColor}`,
      borderRadius: 8,
      background: stageColor?.background ?? background,
      color: options.isDarkMode ? '#e5f2ff' : '#0F172A',
      width,
      height,
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
