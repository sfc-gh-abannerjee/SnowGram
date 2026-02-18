/**
 * Layout utility functions for SnowGram diagrams.
 *
 * Extracted from App.tsx for testability. Pure functions for:
 *  - boundingBox: computes axis-aligned bounding rectangle for a node set
 *  - layoutDAG: topological sort-based DAG layout
 *  - fitNodesIntoBoundary: repositions external nodes into a boundary +
 *    resizes boundary to fit all children
 *  - LAYOUT_CONSTANTS: centralised spacing/dimension constants
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LAYOUT_CONSTANTS = {
  /** Standard node width used by ELK and medallion layout */
  STANDARD_NODE_WIDTH: 150,
  /** Standard node height used by ELK and medallion layout */
  STANDARD_NODE_HEIGHT: 130,
  /** Fallback node width when style is not set */
  DEFAULT_NODE_WIDTH: 180,
  /** Fallback node height when style is not set */
  DEFAULT_NODE_HEIGHT: 140,
  /** Horizontal padding inside boundaries */
  BOUNDARY_PADDING_X: 24,
  /** Top padding for boundary label room */
  BOUNDARY_PADDING_Y_TOP: 70,
  /** Bottom padding inside boundaries */
  BOUNDARY_PADDING_Y_BOTTOM: 24,
  /** Average Y padding for non-Snowflake boundaries */
  BOUNDARY_PADDING_Y: 30,
  /** Gap between adjacent boundaries */
  BOUNDARY_GAP: 40,
  /** Horizontal spacing between DAG columns */
  DAG_X_SPACING: 200,
  /** Vertical spacing between DAG rows */
  DAG_Y_SPACING: 150,
  /** Max columns before DAG wraps */
  DAG_MAX_COLS: 4,
  /** Padding inside fitted boundaries */
  FIT_PADDING: 40,
  /** Title height reserved in fitted boundaries */
  FIT_TITLE_HEIGHT: 50,
  /** Row height for stacked external nodes */
  FIT_ROW_HEIGHT: 170,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NodeLike {
  id: string;
  position: { x: number; y: number };
  data: { label?: string; componentType?: string; [key: string]: any };
  style?: { width?: number | string; height?: number | string; [key: string]: any };
  [key: string]: any;
}

interface EdgeLike {
  id: string;
  source: string;
  target: string;
  [key: string]: any;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ---------------------------------------------------------------------------
// boundingBox
// ---------------------------------------------------------------------------

/**
 * Compute the axis-aligned bounding box for a set of nodes.
 * Returns null for empty input.
 */
export function boundingBox(nodes: NodeLike[]): BBox | null {
  if (!nodes.length) return null;
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const widths = nodes.map(
    (n) => ((n.style as any)?.width as number) || LAYOUT_CONSTANTS.DEFAULT_NODE_WIDTH,
  );
  const heights = nodes.map(
    (n) => ((n.style as any)?.height as number) || LAYOUT_CONSTANTS.DEFAULT_NODE_HEIGHT,
  );
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...nodes.map((_, i) => xs[i] + widths[i])),
    maxY: Math.max(...nodes.map((_, i) => ys[i] + heights[i])),
  };
}

// ---------------------------------------------------------------------------
// layoutDAG
// ---------------------------------------------------------------------------

/**
 * Lay out nodes using a topological-sort DAG algorithm.
 *
 * Nodes are assigned depth levels based on their incoming edges, then placed
 * in columns (by level) and rows (by index within level). Handles cycles by
 * continuing to process even when indegree > 0.
 */
export function layoutDAG<N extends NodeLike>(nodes: N[], edges: EdgeLike[]): N[] {
  if (!nodes.length) return [];

  const nodeMap = new Map<string, N>();
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  nodes.forEach((n) => {
    nodeMap.set(n.id, n);
    indegree.set(n.id, 0);
  });

  edges.forEach((e) => {
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) return;
    indegree.set(e.target, (indegree.get(e.target) || 0) + 1);
    if (!children.has(e.source)) children.set(e.source, []);
    children.get(e.source)!.push(e.target);
  });

  const queue: string[] = [];
  indegree.forEach((v, k) => {
    if (v === 0) queue.push(k);
  });
  // Fallback if cycle: start with all nodes
  if (queue.length === 0) queue.push(...nodes.map((n) => n.id));

  const level = new Map<string, number>();
  queue.forEach((id) => level.set(id, 0));

  while (queue.length) {
    const cur = queue.shift()!;
    const curLevel = level.get(cur) ?? 0;
    const kids = children.get(cur) || [];
    kids.forEach((kid) => {
      const next = indegree.get(kid) || 0;
      indegree.set(kid, next - 1);
      if (next - 1 === 0) {
        queue.push(kid);
        level.set(kid, Math.max(level.get(kid) ?? 0, curLevel + 1));
      } else {
        level.set(kid, Math.max(level.get(kid) ?? 0, curLevel + 1));
      }
    });
  }

  // Group by level
  const grouped = new Map<number, string[]>();
  nodes.forEach((n) => {
    const l = level.get(n.id) ?? 0;
    if (!grouped.has(l)) grouped.set(l, []);
    grouped.get(l)!.push(n.id);
  });

  const { DAG_X_SPACING, DAG_Y_SPACING, DAG_MAX_COLS } = LAYOUT_CONSTANTS;
  const ROW_HEIGHT = DAG_Y_SPACING * 6;

  return nodes.map((n) => {
    const l = level.get(n.id) ?? 0;
    const siblings = grouped.get(l) || [];
    const idx = siblings.indexOf(n.id);
    const col = l % DAG_MAX_COLS;
    const blockRow = Math.floor(l / DAG_MAX_COLS);
    return {
      ...n,
      position: {
        x: col * DAG_X_SPACING,
        y: blockRow * ROW_HEIGHT + idx * DAG_Y_SPACING,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// fitNodesIntoBoundary
// ---------------------------------------------------------------------------

/** Provider keyword map for matching child nodes to boundaries (FALLBACK ONLY).
 * AGENTIC: The agent should provide node.data.boundary for explicit assignment.
 * Keywords are only used when the agent doesn't specify boundary.
 */
export const PROVIDER_KEYWORDS: Record<string, string[]> = {
  // AWS-specific: S3, lake storage, Kinesis (AWS streaming service)
  aws: ['aws', 's3', 'lake', 'kinesis', 'amazon_kinesis', 'ext_kinesis'],
  // Azure-specific: ADLS, Blob, Event Hubs (Azure streaming service)
  azure: ['azure', 'adls', 'blob', 'event_hub', 'event_hubs', 'eventhub', 'ext_event_hub'],
  // GCP-specific: GCS, BigQuery, Pub/Sub
  gcp: ['gcp', 'gcs', 'bigquery', 'bq', 'pub_sub', 'pubsub'],
  // Kafka boundary: ONLY for self-hosted Kafka or Confluent Cloud
  // Cloud-native streaming services belong in their cloud provider boundaries
  kafka: ['kafka', 'confluent', 'ext_kafka'],
  // Snowflake-internal features: medallion layers, tasks, CDC streams, Snowpipe Streaming, etc.
  snowflake: [
    'bronze', 'silver', 'gold', 'layer', 'task', 'cdc',
    'transform', 'warehouse', 'analytics', 'view', 'table', 'database', 'schema',
    'stage', 'snowpipe', 'snowpipe_streaming', 'pipe', 'stream',
  ],
};

/**
 * EXTERNAL_PROVIDERS defines which providers represent external data sources.
 * These are processed BEFORE snowflake to ensure their nodes aren't claimed
 * by the snowflake boundary.
 */
export const EXTERNAL_PROVIDERS = ['aws', 'azure', 'gcp', 'kafka'] as const;

/**
 * Fit child nodes into their provider boundary.
 *
 * AGENTIC APPROACH:
 * 1. First, check if node.data.boundary matches the provider (agent-provided)
 * 2. Fall back to keyword matching only if boundary is not provided
 *
 * - Snowflake: only measures existing positions (doesn't move nodes), resizes boundary.
 * - External providers (kafka, aws, azure, gcp): repositions nodes into a
 *   vertical stack inside boundary, then resizes boundary to fit.
 *
 * Returns the updated nodes array and the boundary node (or null if none found).
 */
export function fitNodesIntoBoundary<N extends NodeLike>(
  nodes: N[],
  provider: string,
): { nodes: N[]; boundary: N | null } {
  const result = nodes.map((n) => ({ ...n })); // shallow clone

  // Find boundary for this provider
  const boundaryIdx = result.findIndex((n) => {
    const comp = ((n.data as any)?.componentType || '').toString().toLowerCase();
    return comp.startsWith('account_boundary') && comp.includes(provider);
  });

  if (boundaryIdx < 0) {
    return { nodes: result, boundary: null };
  }

  const boundary = result[boundaryIdx];
  const keywords = PROVIDER_KEYWORDS[provider] || [];
  const repositionNodes = provider !== 'snowflake';

  const { FIT_PADDING, FIT_TITLE_HEIGHT, FIT_ROW_HEIGHT, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } =
    LAYOUT_CONSTANTS;

  const bx = boundary.position.x + FIT_PADDING;
  const by = boundary.position.y + FIT_PADDING + FIT_TITLE_HEIGHT;

  // Find matching child nodes
  // AGENTIC: Check node.data.boundary FIRST, fall back to keywords
  const matchingIndices: number[] = [];
  result.forEach((n, i) => {
    if (i === boundaryIdx) return;
    const d: any = n.data || {};
    const isBound = ((d.componentType || '').toString().toLowerCase()).startsWith('account_boundary');
    if (isBound) return;
    
    // AGENTIC: Agent-provided boundary takes priority
    const agentBoundary = (d.boundary || '').toString().toLowerCase();
    if (agentBoundary) {
      if (agentBoundary === provider) {
        matchingIndices.push(i);
      }
      return; // Agent provided boundary - don't use keyword fallback
    }
    
    // FALLBACK: Keyword matching for mermaid/legacy paths
    const text = `${(d.label || '').toString().toLowerCase()} ${(d.componentType || '').toString().toLowerCase()}`;
    if (keywords.some((k) => text.includes(k))) {
      matchingIndices.push(i);
    }
  });

  if (matchingIndices.length === 0) {
    return { nodes: result, boundary };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  matchingIndices.forEach((idx, stackIndex) => {
    const n = result[idx];
    const nodeWidth = ((n.style as any)?.width as number) || DEFAULT_NODE_WIDTH;
    const nodeHeight = ((n.style as any)?.height as number) || DEFAULT_NODE_HEIGHT;

    if (repositionNodes) {
      const newPos = { x: bx, y: by + stackIndex * FIT_ROW_HEIGHT };
      result[idx] = { ...n, position: newPos };
      minX = Math.min(minX, newPos.x);
      minY = Math.min(minY, newPos.y);
      maxX = Math.max(maxX, newPos.x + nodeWidth);
      maxY = Math.max(maxY, newPos.y + nodeHeight);
    } else {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + nodeWidth);
      maxY = Math.max(maxY, n.position.y + nodeHeight);
    }
  });

  // Resize boundary to encompass all matched nodes
  // Add minimum dimensions to prevent boundary/child overlap when there's only 1 node
  const MIN_BOUNDARY_WIDTH = 200;   // Minimum boundary width
  const MIN_BOUNDARY_HEIGHT = 200;  // Minimum boundary height
  const LABEL_PADDING = 30;         // Extra padding for boundary label text
  
  const newBoundaryX = minX - FIT_PADDING;
  const newBoundaryY = minY - FIT_PADDING - FIT_TITLE_HEIGHT;
  const rawWidth = maxX - minX + FIT_PADDING * 2;
  const rawHeight = maxY - minY + FIT_PADDING * 2 + FIT_TITLE_HEIGHT;
  
  // Ensure minimum dimensions so boundary is always visibly larger than children
  const width = Math.max(rawWidth, MIN_BOUNDARY_WIDTH);
  const height = Math.max(rawHeight, MIN_BOUNDARY_HEIGHT + LABEL_PADDING);

  result[boundaryIdx] = {
    ...boundary,
    position: { x: newBoundaryX, y: newBoundaryY },
    style: { ...(boundary.style || {}), width, height },
  };

  return { nodes: result, boundary: result[boundaryIdx] };
}

// ---------------------------------------------------------------------------
// fitAllBoundaries — multi-provider convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Fit nodes into ALL detected provider boundaries in a single pass.
 *
 * IMPORTANT: Processes EXTERNAL_PROVIDERS first (aws, azure, gcp, kafka),
 * then snowflake. This ensures external boundaries are sized and positioned
 * BEFORE the Snowflake boundary is calculated, preventing the Snowflake
 * boundary from extending to encompass external nodes.
 */
export function fitAllBoundaries<N extends NodeLike>(nodes: N[]): N[] {
  let current = nodes;
  
  // Process external providers FIRST
  for (const provider of EXTERNAL_PROVIDERS) {
    const { nodes: updated } = fitNodesIntoBoundary(current, provider);
    current = updated;
  }
  
  // Process snowflake LAST (after external boundaries are established)
  const { nodes: final } = fitNodesIntoBoundary(current, 'snowflake');
  return final;
}
