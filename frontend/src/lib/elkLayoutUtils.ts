/**
 * ELK layout utility functions for SnowGram diagrams.
 *
 * Extracted from elkLayout.ts for testability. Pure functions for:
 *  - getFlowStageOrder: infers a node's flow pipeline position (0-6)
 *  - selectPorts: picks edge handle direction based on relative flow positions
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NodeLike {
  id: string;
  data: {
    flowStageOrder?: number;
    flowStage?: string;
    label?: string;
    componentType?: string;
    [key: string]: any;
  };
}

// ---------------------------------------------------------------------------
// getFlowStageOrder
// ---------------------------------------------------------------------------

const STAGE_MAP: Record<string, number> = {
  source: 0,
  ingest: 1,
  raw: 2,
  transform: 3,
  refined: 4,
  serve: 5,
  consume: 6,
};

/**
 * Get the flow stage order for a node.
 *
 * Resolution priority:
 *   1. Keyword inference from id + label + componentType (most granular —
 *      assigns fractional stages like 2.5 for CDC, 3.5 for silver)
 *   2. Agent-provided `flowStageOrder` (numeric fallback when keywords miss)
 *   3. `flowStage` string mapping
 *   4. Default: 3 (transform/middle)
 *
 * Keywords are preferred over agent values because the agent often assigns
 * coarse integer stages (e.g. all "transform" nodes get 3) while keyword
 * inference differentiates CDC streams (2.5), transforms (3), and silver (3.5).
 */
export function getFlowStageOrder(node: NodeLike): number {
  const data = node.data || {};

  // 1. Keyword inference (most granular — fractional stages)
  const text = `${node.id} ${data.label || ''} ${data.componentType || ''}`.toLowerCase();

  // External sources (Kafka, S3, etc.) - NOT "External Stage" which is a Snowflake object
  if (/ext_|kafka|azure.*blob|gcs|api/.test(text)) return 0;
  // S3/lake only if NOT preceded by "external" (to avoid matching "External Stage")
  if (/(?<!external.*)s3|(?<!external.*)lake/.test(text)) return 0;
  
  // Ingestion layer
  if (/snowpipe|fivetran|airbyte|ingest|pipe/.test(text)) return 1;
  // External Stage / internal stage objects (between ingest and bronze)
  if (/external.stage|_stage(?!order)/i.test(text)) return 1.5;
  
  // Bronze/Raw layer
  if (/bronze|raw|landing|staging/.test(text)) return 2;
  // CDC streams (default position - may be adjusted by edge propagation)
  if (/cdc|change_capture/.test(text)) return 2.5;
  // "stream" alone is tricky - could be CDC stream or Kafka stream
  // Only assign 2.5 if it looks like a Snowflake stream (not kafka/kinesis)
  if (/stream/.test(text) && !/kafka|kinesis|event.*hub/.test(text)) return 2.5;
  
  // Transform layer
  if (/transform|task|clean|dbt|etl/.test(text)) return 3;
  // Silver layer
  if (/silver/.test(text)) return 3.5;
  // Gold layer
  if (/gold|refined|curated|mart|business/.test(text)) return 4;
  // Analytics/Serving layer
  if (/analytics|warehouse|view|serve/.test(text)) return 5;
  // Consumption layer (BI tools)
  if (/powerbi|tableau|looker|metabase|thoughtspot|sigma|qlik|dashboard|report|bi/.test(text)) return 6;

  // 2. Agent-provided numeric order (fallback for unrecognised components)
  if (typeof data.flowStageOrder === 'number') {
    return data.flowStageOrder;
  }

  // 3. flowStage string
  const flowStage = (data.flowStage || '').toLowerCase();
  if (STAGE_MAP[flowStage] !== undefined) {
    return STAGE_MAP[flowStage];
  }

  // 4. Default
  return 3;
}

// ---------------------------------------------------------------------------
// selectPorts
// ---------------------------------------------------------------------------

/**
 * Determine the best source and target ports based on relative flow positions.
 *
 * - Forward flow (source → target): right→left (standard L-R data flow)
 * - Backward flow (target → source): left→right (feedback loop)
 * - Same layer: default right→left
 */
export function selectPorts(
  sourceId: string,
  targetId: string,
  sourceOrder: number,
  targetOrder: number,
): { sourcePort: string; targetPort: string } {
  if (targetOrder > sourceOrder) {
    return { sourcePort: `${sourceId}-right`, targetPort: `${targetId}-left` };
  }
  if (targetOrder < sourceOrder) {
    return { sourcePort: `${sourceId}-left`, targetPort: `${targetId}-right` };
  }
  return { sourcePort: `${sourceId}-right`, targetPort: `${targetId}-left` };
}
