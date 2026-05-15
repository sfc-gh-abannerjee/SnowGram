/**
 * DiagramSpec — Canonical intermediate representation for SnowGram diagrams.
 *
 * All input sources (Mermaid parser, agent JSON, template DB) produce this type.
 * The unified layout function consumes it and outputs ReactFlow nodes/edges.
 *
 * This decouples input parsing from layout logic and eliminates the dual-path
 * rendering pipeline that previously existed in App.tsx.
 */

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export interface DiagramNode {
  /** Unique node identifier (matches Mermaid node ID or agent-provided ID) */
  id: string;
  /** Human-readable label displayed on the node */
  label: string;
  /** Component type for icon resolution and styling (e.g., "Kafka", "Dynamic Table") */
  componentType: string;
  /** ID of the group this node belongs to (references DiagramGroup.id) */
  groupId?: string;
  /** Topological ordering hint for left-to-right layout (0=source, 6=consume) */
  flowStageOrder?: number;
  /** Medallion layer for color coding (bronze/silver/gold/external/bi/snowflake) */
  layer?: 'bronze' | 'silver' | 'gold' | 'external' | 'bi' | 'snowflake';
}

// ---------------------------------------------------------------------------
// Edge
// ---------------------------------------------------------------------------

export interface DiagramEdge {
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Optional edge label (e.g., "Streaming", "CDC", "Batch") */
  label?: string;
  /** Arrow style from Mermaid syntax: solid (-->), dotted (-.->), thick (==>) */
  style?: 'solid' | 'dotted' | 'thick';
}

// ---------------------------------------------------------------------------
// Group (lanes, sections, boundaries, containers)
// ---------------------------------------------------------------------------

export type GroupType = 'lane' | 'section' | 'boundary' | 'container';

export interface DiagramGroup {
  /** Unique group identifier (matches subgraph ID from Mermaid) */
  id: string;
  /** Display label for the group */
  label: string;
  /** Layout semantics: lanes are vertical columns, sections are horizontal columns */
  type: GroupType;
  /** Parent group ID for nested structures (e.g., lanes inside a container) */
  parentId?: string;
  /** Sort order within its type (lane 0, 1, 2... or section 0, 1, 2...) */
  index: number;
  /** Visual styling overrides */
  style?: {
    background?: string;
    border?: string;
  };
}

// ---------------------------------------------------------------------------
// Badge (numbered annotations for lanes/sections)
// ---------------------------------------------------------------------------

export interface DiagramBadge {
  /** Unique badge identifier */
  id: string;
  /** Badge text content (e.g., "1A", "2", "6") */
  label: string;
  /** The group this badge annotates (references DiagramGroup.id) */
  groupId: string;
  /** Visual variant determines color: lane=purple, section=blue */
  variant: 'lane' | 'section';
}

// ---------------------------------------------------------------------------
// DiagramSpec (top-level container)
// ---------------------------------------------------------------------------

export interface DiagramSpec {
  /** All nodes in the diagram */
  nodes: DiagramNode[];
  /** All edges (connections) between nodes */
  edges: DiagramEdge[];
  /** Grouping structures: lanes, sections, boundaries, containers */
  groups: DiagramGroup[];
  /** Numbered annotation badges associated with groups */
  badges: DiagramBadge[];
  /** Primary flow direction */
  direction: 'LR' | 'TB';
  /** Original Mermaid source text (preserved for chat display and .mmd export) */
  mermaidSource?: string;
}
