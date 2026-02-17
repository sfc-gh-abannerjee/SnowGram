/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { Edge, Node } from 'reactflow';

type Catalog = Record<string, any>;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const cleanText = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ============================================
// MEDALLION ARCHITECTURE COLOR SCHEME
// ============================================
// These colors are designed for architecture diagrams
// where visual distinction by layer is critical
export const LAYER_COLORS = {
  bronze: {
    border: '#CD7F32',      // Bronze/copper color
    background: '#FDF5E6',   // Light cream/antique white
    backgroundDark: '#3D2B1F', // Dark bronze
    label: 'Bronze Layer'
  },
  silver: {
    border: '#C0C0C0',      // Silver
    background: '#F5F5F5',   // Light gray
    backgroundDark: '#2F4F4F', // Dark slate gray
    label: 'Silver Layer'
  },
  gold: {
    border: '#FFD700',      // Gold
    background: '#FFFACD',   // Lemon chiffon
    backgroundDark: '#4A3C00', // Dark gold/brown
    label: 'Gold Layer'
  },
  external: {
    border: '#FF9900',      // AWS Orange
    background: '#FFF8E7',
    backgroundDark: '#2D2D2D',
    label: 'External Sources'
  },
  bi: {
    border: '#9370DB',      // Medium purple (BI/Analytics)
    background: '#E6E6FA',   // Lavender
    backgroundDark: '#2E1A47',
    label: 'BI/Analytics'
  },
  snowflake: {
    border: '#29B5E8',      // Snowflake blue (default)
    background: '#E6F7FF',
    backgroundDark: '#1e3a4a',
    label: 'Snowflake'
  }
};

// ============================================
// FLOW STAGE COLOR SCHEME (by flowStageOrder)
// ============================================
// Colors mapped to flowStageOrder values for consistent
// visual coding across the data pipeline stages
export const STAGE_COLORS: Record<number, { border: string; bg: string; bgDark: string }> = {
  0: { border: '#6366F1', bg: '#EEF2FF', bgDark: '#312E81' },  // source (indigo)
  1: { border: '#8B5CF6', bg: '#F5F3FF', bgDark: '#3B2A6D' },  // ingest (violet)
  2: { border: '#CD7F32', bg: '#FDF5E6', bgDark: '#3D2B1F' },  // raw/bronze
  3: { border: '#C0C0C0', bg: '#F5F5F5', bgDark: '#2F4F4F' },  // transform/silver
  4: { border: '#FFD700', bg: '#FFFACD', bgDark: '#4A3C00' },  // refined/gold
  5: { border: '#10B981', bg: '#ECFDF5', bgDark: '#064E3B' },  // serve (emerald)
  6: { border: '#F59E0B', bg: '#FFFBEB', bgDark: '#78350F' },  // consume (amber)
};

// Neutral fallback when flowStageOrder is unknown (Snowflake brand blue)
const NEUTRAL_STAGE = { border: '#29B5E8', bg: '#EBF8FF', bgDark: '#0C4A6E' };

// Helper to get color by flowStageOrder with fallback
// Uses Math.floor so fractional stages (e.g. 2.5 for CDC) inherit the nearest lower stage color
export const getStageColor = (flowStageOrder: number | undefined, isDark = false) => {
  const stage = typeof flowStageOrder === 'number' ? STAGE_COLORS[Math.floor(flowStageOrder)] : undefined;
  if (stage) {
    return { border: stage.border, background: isDark ? stage.bgDark : stage.bg };
  }
  // Unknown or missing stage → neutral Snowflake blue
  return { border: NEUTRAL_STAGE.border, background: isDark ? NEUTRAL_STAGE.bgDark : NEUTRAL_STAGE.bg };
};

// Detect which medallion layer a node belongs to based on ID/label
function detectLayer(id: string, label: string): keyof typeof LAYER_COLORS {
  const text = `${id} ${label}`.toLowerCase();
  
  // Bronze layer indicators
  if (text.includes('bronze') || text.includes('raw') || text.includes('landing') ||
      text.includes('ingest') || text.includes('source') || text.includes('staging')) {
    return 'bronze';
  }
  
  // Silver layer indicators  
  if (text.includes('silver') || text.includes('clean') || text.includes('conform') ||
      text.includes('transform') || text.includes('standardize') || text.includes('validated')) {
    return 'silver';
  }
  
  // Gold layer indicators
  if (text.includes('gold') || text.includes('curated') || text.includes('refined') ||
      text.includes('aggregate') || text.includes('business') || text.includes('dim_') ||
      text.includes('fact_') || text.includes('mart')) {
    return 'gold';
  }
  
  // External sources
  if (text.includes('s3') || text.includes('aws') || text.includes('kafka') ||
      text.includes('api') || text.includes('external') || text.includes('lake')) {
    return 'external';
  }
  
  // BI/Analytics
  if (text.includes('analytics') || text.includes('dashboard') || text.includes('report') ||
      text.includes('bi_') || text.includes('tableau') || text.includes('powerbi')) {
    return 'bi';
  }
  
  return 'snowflake'; // Default
}

// Map common Mermaid labels to SnowGram component names
const LABEL_SYNONYMS: Record<string, string> = {
  database: 'Database',
  db: 'Database',
  datastore: 'Database',
  datawarehouse: 'Data WH',
  warehouse: 'Warehouse',
  wh: 'Warehouse',
  snowflake: 'Warehouse',
  virtualwarehouse: 'Virtual WH',
  snowparkwarehouse: 'Snowpark WH',
  adaptivewarehouse: 'Adaptive WH',
  table: 'Table',
  tables: 'Table',
  view: 'View',
  schema: 'Schema',
  schemas: 'Schema',
  stream: 'Stream',
  streaming: 'Stream',
  snowpipe: 'Snowpipe',
  pipe: 'Snowpipe',
  task: 'Task',
  tasks: 'Task',
  staging: 'Table',
  landing: 'Table',
  rawdata: 'Table',
  cleanseddata: 'Table',
  curateddata: 'Table',
  csv: 'Table',
  csvfiles: 'Table',
  files: 'Table',
  api: 'Stream',
  apis: 'Stream',
  ingest: 'Snowpipe',
  ingestion: 'Snowpipe',
  extractlayer: 'Snowpipe',
  transformlayer: 'Task',
  loadlayer: 'Table',
  monitoring: 'View',
  logging: 'View',
  monitoringlogging: 'View',
  analytics: 'View',
  dashboard: 'View',
  report: 'View',
  reporting: 'View',
  metric: 'View',
  metrics: 'View',
};

function classifyByHeuristic(norm: string): string | null {
  const has = (k: string) => norm.includes(k);

  if (has('warehouse')) return 'Warehouse';
  if (has('virtualwh')) return 'Virtual WH';
  if (has('snowparkw')) return 'Snowpark WH';
  if (has('adaptive')) return 'Adaptive WH';
  if (has('database') || has('datastore')) return 'Database';

  if (has('view') || has('dashboard') || has('report') || has('reporting') || has('analytics') || has('monitor') || has('logg'))
    return 'View';

  if (has('table') || has('csv') || has('file') || has('staging') || has('landing') || has('rawdata') || has('curated'))
    return 'Table';

  if (has('api') || has('source') || has('ingest') || has('stream') || has('connect')) return 'Stream';

  if (has('snowpipe') || has('extract') || has('pull') || has('ingestion')) return 'Snowpipe';

  if (has('task') || has('transform') || has('clean') || has('validate') || has('aggregate') || has('format') || has('process'))
    return 'Task';

  return null;
}

/**
 * Lightweight Mermaid flowchart parser to produce ReactFlow nodes/edges.
 * Supports common arrow types: -->, --- , -.->, ==> variants.
 * Layout is a simple grid; callers may re-run layout if desired.
 */
export function convertMermaidToFlow(
  mermaidCode: string,
  componentCatalog: Catalog,
  isDarkMode = false
): { nodes: Node[]; edges: Edge[] } {
  const edges: Edge[] = [];
  const nodeMap: Map<string, Node> = new Map();

  const lines = mermaidCode.split('\n').map(l => l.trim()).filter(Boolean);
  const edgeRegex = /^([\w-]+)\s*[-.=>]+?\s*([\w-]+)(?:\s*\[\[?(.+?)\]?\])?/;
  const nodeDefRegex = /^([\w-]+)\s*\[(.+)\]/;

  const getLabel = (id: string) => {
    const def = lines.find(l => l.startsWith(`${id}[`));
    if (def) {
      const m = def.match(nodeDefRegex);
      if (m) return cleanText(m[2]);
    }
    return cleanText(id);
  };

  const normalizeBoundaryId = (id: string, label: string) => {
    const txt = `${id} ${label}`.toLowerCase();
    if (txt.includes('snowflake account')) return 'account_boundary_snowflake';
    if (txt.includes('aws account') || txt.includes('amazon account')) return 'account_boundary_aws';
    if (txt.includes('azure')) return 'account_boundary_azure';
    if (txt.includes('gcp') || txt.includes('google')) return 'account_boundary_gcp';
    return id;
  };

  const ensureNode = (rawId: string) => {
    const label = getLabel(rawId);
    const id = normalizeBoundaryId(rawId, label);
    if (nodeMap.has(id)) return nodeMap.get(id)!;
    
    const isBoundary = id.startsWith('account_boundary');
    const componentType = isBoundary ? id : matchComponent(label, componentCatalog);
    
    // Detect layer and apply appropriate colors
    const layer = detectLayer(rawId, label);
    const layerColors = LAYER_COLORS[layer];
    const borderColor = layerColors.border;
    const backgroundColor = isDarkMode ? layerColors.backgroundDark : layerColors.background;
    
    const node: Node = {
      id,
      type: 'snowflakeNode',
      data: {
        label,
        componentType,
        layer, // Store layer info for downstream use
        labelColor: isDarkMode ? '#E5EDF5' : '#0F172A',
        isDarkMode,
        showHandles: !isBoundary,
        icon: isBoundary ? undefined : undefined,
      },
      position: { x: 0, y: 0 },
      style: {
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        background: backgroundColor,
        color: isDarkMode ? '#e5f2ff' : '#0F172A',
      },
    };
    nodeMap.set(id, node);
    return node;
  };

  for (const line of lines) {
    // node definition lines
    const nd = line.match(nodeDefRegex);
    if (nd) {
      ensureNode(nd[1]);
      continue;
    }
    // edge lines
    const m = line.match(edgeRegex);
    if (m) {
      const source = m[1];
      const target = m[2];
      const sourceNode = ensureNode(source);
      const targetNode = ensureNode(target);
      const sourceId = sourceNode.id;
      const targetId = targetNode.id;
      edges.push({
        id: `${sourceId}-${targetId}-${edges.length}`,
        source: sourceId,
        target: targetId,
        type: 'straight',  // Direct lines to eliminate kinks
        animated: true,
        sourceHandle: 'right-source',
        targetHandle: 'left-target',
        style: { stroke: '#29B5E8', strokeWidth: 2 },
        deletable: true,
      });
    }
  }

  // Simple grid layout
  const nodes = Array.from(nodeMap.values());
  const cols = 4;
  nodes.forEach((n, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    n.position = { x: col * 260, y: row * 200 };
  });

  return { nodes, edges };
}

function matchComponent(label: string, catalog: Catalog): string {
  const norm = normalize(cleanText(label));

  // 1) Exact catalog name match
  for (const [_cat, comps] of Object.entries(catalog)) {
    for (const c of comps as any[]) {
      if (!c?.name) continue;
      if (normalize(c.name) === norm) return c.name;
    }
  }

  // 2) Synonym match
  if (LABEL_SYNONYMS[norm]) return LABEL_SYNONYMS[norm];

  // 2b) Heuristic classification
  const heuristic = classifyByHeuristic(norm);
  if (heuristic) return heuristic;

  // 3) Fuzzy contains: if label contains a catalog item or vice versa
  for (const [_cat, comps] of Object.entries(catalog)) {
    for (const c of comps as any[]) {
      if (!c?.name) continue;
      const cn = normalize(c.name);
      if (norm.includes(cn) || cn.includes(norm)) return c.name;
    }
  }

  return label;
}

