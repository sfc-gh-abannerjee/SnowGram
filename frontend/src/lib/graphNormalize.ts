/**
 * Graph normalisation utilities for SnowGram diagrams.
 *
 * Extracted from App.tsx for testability. These pure functions handle:
 *  - canonicalizeComponentType: maps agent componentType values to canonical
 *    Snowflake types for consistent icon resolution and layout grouping.
 *  - keyForNode: generates a dedup key for normalizeGraph — boundaries dedup
 *    by provider, all other nodes use their unique ID.
 *  - normalizeBoundaryType: canonicalises boundary types by provider while
 *    passing through non-boundary nodes unchanged.
 *  - isMedallion: detects medallion (bronze/silver/gold) architectures.
 *  - normalizeGraph: full dedup pipeline for nodes + edges.
 */

// ---------------------------------------------------------------------------
// canonicalizeComponentType
// ---------------------------------------------------------------------------

/**
 * Map a raw componentType string to a canonical Snowflake type.
 *
 * Strips agent prefixes (sf_, ext_, src_, tgt_), recognises compound agent
 * names (cdc_stream → stream), and falls back to generic keyword matching.
 * Boundary types are always returned unchanged.
 */
export function canonicalizeComponentType(comp?: string): string {
  const raw = (comp || '').toLowerCase();

  // ALWAYS preserve boundary types unchanged
  if (raw.startsWith('account_boundary')) {
    return comp!; // Return original casing
  }

  // Strip agent prefixes (sf_, ext_, src_, tgt_) so sf_cdc_stream → cdc_stream
  const c = raw.replace(/^(sf|ext|src|tgt)_/, '');

  // Compound agent names — preserve their canonical Snowflake type
  if (c === 'cdc_stream' || c === 'change_stream') return 'stream';
  if (c === 'transform_task') return 'task';
  if (c === 'bronze_layer') return 'bronze_layer';
  if (c === 'silver_layer') return 'silver_layer';
  if (c === 'gold_layer') return 'gold_layer';
  if (c === 'analytics_views' || c === 'analytics_view') return 'analytics_views';

  // Preserve medallion-specific types
  if (c === 'bronze_db' || c === 'silver_db' || c === 'gold_db') return 'database';
  if (c === 'bronze_schema' || c === 'silver_schema' || c === 'gold_schema') return 'schema';
  if (c === 'bronze_tables' || c === 'silver_tables' || c === 'gold_tables') return 'table';

  // Generic matching (order matters — more specific first)
  if (c.includes('snowpipe') || c === 'pipe') return 'snowpipe';
  if (c.includes('kafka')) return 'kafka';
  if (c.includes('stream')) return 'stream';
  if (c.includes('task')) return 'task';
  if (c.includes('schema')) return 'schema';
  if (c.includes('table')) return 'table';
  if (c.includes('view') || c.includes('analytic')) return 'view';
  if (c.includes('warehouse') || c.includes('wh')) return 'warehouse';
  if (c.includes('db') || c.includes('database')) return 'database';
  if (c.includes('s3') || c.includes('lake')) return 'database';
  return comp || 'table';
}

// ---------------------------------------------------------------------------
// keyForNode
// ---------------------------------------------------------------------------

/** Minimal Node shape for dedup key generation. */
interface NodeLike {
  id: string;
  data?: { componentType?: string; label?: string };
}

/**
 * Generate a dedup key for a node.
 *
 * - Boundary nodes: keyed by canonical provider (account_boundary_snowflake,
 *   account_boundary_aws, etc.) so multiple boundaries of the same provider
 *   collapse to one.
 * - All other nodes: keyed by their unique node ID. This ensures the agent's
 *   intentional duplicates (e.g. two CDC streams) are preserved.
 */
export function keyForNode(n: NodeLike): string {
  const d = n.data || {};
  const rawComp = (d.componentType || '').toString().toLowerCase().trim();
  const label = (d.label || '').toString().toLowerCase().trim();

  if (rawComp.startsWith('account_boundary')) {
    // Deduplicate boundaries by provider (only one per cloud provider)
    const provider =
      rawComp.includes('aws') ? 'aws' :
      rawComp.includes('azure') ? 'azure' :
      rawComp.includes('gcp') ? 'gcp' :
      rawComp.includes('snowflake') ? 'snowflake' :
      rawComp.replace(/account_boundary[_-]?/, '') || label || 'boundary';
    return `account_boundary_${provider}`;
  }

  // Use the node ID as the dedup key for all non-boundary nodes.
  return n.id;
}

// ---------------------------------------------------------------------------
// normalizeBoundaryType
// ---------------------------------------------------------------------------

/**
 * Normalise a boundary node's componentType to a canonical provider string.
 *
 * Non-boundary nodes are returned unchanged. Boundary nodes are matched
 * against known providers (snowflake, aws, azure, gcp, kafka) using the
 * combined text of raw type, label, and id.
 */
export function normalizeBoundaryType(
  raw?: string,
  label?: string,
  id?: string,
): string | undefined {
  const rawLower = (raw || '').toLowerCase();
  const idLower = (id || '').toLowerCase();

  // Check if this is explicitly a boundary node (by ID or componentType)
  const isBoundaryNode =
    idLower.startsWith('account_boundary_') ||
    rawLower.includes('boundary') ||
    rawLower.startsWith('account_');

  if (!isBoundaryNode) {
    return raw; // Regular component, don't convert
  }

  // Normalise to canonical boundary type
  const text = `${rawLower} ${(label || '').toLowerCase()} ${idLower}`;
  if (text.includes('snowflake')) return 'account_boundary_snowflake';
  if (text.includes('aws') || text.includes('amazon')) return 'account_boundary_aws';
  if (text.includes('azure')) return 'account_boundary_azure';
  if (text.includes('gcp') || text.includes('google')) return 'account_boundary_gcp';
  if (text.includes('kafka') || text.includes('streaming') || text.includes('confluent'))
    return 'account_boundary_kafka';

  return raw;
}

// ---------------------------------------------------------------------------
// isMedallion
// ---------------------------------------------------------------------------

/** Minimal Node shape for medallion detection. */
interface MedallionNodeLike {
  data?: { label?: string; componentType?: string };
}

/**
 * Detect whether a set of nodes represents a medallion architecture
 * (contains bronze, silver, or gold keywords in label or componentType).
 */
export function isMedallion(nodes: MedallionNodeLike[]): boolean {
  return nodes.some((n) => {
    const lbl = ((n.data as any)?.label || '').toLowerCase();
    const ct = ((n.data as any)?.componentType || '').toLowerCase();
    return ['bronze', 'silver', 'gold'].some((k) => lbl.includes(k) || ct.includes(k));
  });
}

// ---------------------------------------------------------------------------
// normalizeGraph
// ---------------------------------------------------------------------------

/** Minimal Edge shape for graph normalisation. */
interface EdgeLike {
  id: string;
  source: string;
  target: string;
  [key: string]: any;
}

/**
 * Deduplicate nodes and edges for consistent rendering.
 *
 * - Nodes: deduped by keyForNode (boundaries by provider, others by ID).
 *   ComponentTypes are canonicalised on all output nodes.
 * - Edges: orphaned edges (missing source/target), self-referencing edges,
 *   and duplicate source→target pairs are removed.
 *
 * Generic over N and E so callers preserve their full Node/Edge types.
 */
export function normalizeGraph<
  N extends NodeLike = NodeLike,
  E extends EdgeLike = EdgeLike,
>(
  nodes: N[],
  edges: E[],
): { nodes: N[]; edges: E[] } {
  const dedupedNodes: N[] = [];
  const keyToNode = new Map<string, N>();
  const duplicates: string[] = [];

  // First pass: collect all nodes by key
  nodes.forEach((n) => {
    const k = keyForNode(n);
    const existing = keyToNode.get(k);

    // Keep first node per key; for boundaries this deduplicates by provider
    if (!existing) {
      keyToNode.set(k, n);
    } else {
      duplicates.push(`${n.id}(${k}) collapsed into ${existing.id}`);
    }
  });

  // Second pass: add unique nodes with canonicalised componentType
  keyToNode.forEach((n) => {
    const d: any = n.data || {};
    const canonical = canonicalizeComponentType(d.componentType);
    dedupedNodes.push({
      ...n,
      data: { ...d, componentType: canonical },
    });
  });

  // Edge dedup + orphan removal
  const nodeIds = new Set(dedupedNodes.map((n) => n.id));
  const edgeKey = (e: E) => `${e.source}->${e.target}`;
  const seenEdges = new Set<string>();
  const dedupedEdges: E[] = [];

  edges.forEach((e) => {
    if (!e.source || !e.target) return;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return; // orphaned
    if (e.source === e.target) return; // self-referencing
    const k = edgeKey(e);
    if (seenEdges.has(k)) return; // duplicate
    seenEdges.add(k);
    dedupedEdges.push(e);
  });

  return { nodes: dedupedNodes, edges: dedupedEdges };
}
