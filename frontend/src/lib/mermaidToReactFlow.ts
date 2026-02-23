/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { Edge, Node } from 'reactflow';

type Catalog = Record<string, any>;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const cleanText = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\\n/g, ' ')         // Convert \n escape sequences to spaces
    .replace(/\n/g, ' ')           // Convert actual newlines to spaces
    .replace(/[<>]/g, ' ')
    .replace(/\\"/g, '')          // Remove escaped quotes from JSON-serialized data
    .replace(/^"|"$/g, '')        // Remove surrounding quotes
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

// ============================================
// GENERIC SUBGRAPH LAYOUT CONFIGURATION
// ============================================
// Layout types that can be auto-detected from subgraph naming conventions

export type SubgraphLayoutType = 'lane' | 'section' | 'boundary' | 'group';

export interface SubgraphLayoutInfo {
  id: string;
  label: string;
  type: SubgraphLayoutType;
  index: number;        // Order within its type (lane 0, 1, 2... or section 0, 1, 2...)
  badgeLabel: string;   // Text shown in badge (e.g., "1a", "2", "A")
  color: string;        // Background color for visual distinction
  parent?: string;      // Parent subgraph ID (for nested structures)
}

// Color palette for auto-assignment
const LAYOUT_COLORS = [
  '#E3F2FD', '#F3E5F5', '#E8F5E9', '#FFF8E1', 
  '#E1F5FE', '#FCE4EC', '#E0F2F1', '#FFF3E0',
  '#E8EAF6', '#F1F8E9', '#FFFDE7', '#ECEFF1'
];

/**
 * Auto-detect subgraph layout type from naming conventions.
 * Supports multiple naming patterns for flexibility across different templates.
 */
export function detectSubgraphLayoutType(id: string, label: string, parent?: string): { type: SubgraphLayoutType; index: number; badgeLabel: string } {
  const idLower = id.toLowerCase();
  const labelLower = label.toLowerCase();
  
  // LANE patterns: path_1a, lane_1, row_a, ingestion_1, etc.
  // Note: Patterns use specific suffix matching to avoid matching parent containers
  // like "ingestion_paths" or "flow_lanes" which should be groups, not lanes
  const lanePatterns = [
    /^path[_-]?(\d+[a-z]?|[a-z])$/i,      // path_1a, path-1, path_a (NOT path_anything)
    /^lane[_-]?(\d+[a-z]?|[a-z])$/i,      // lane_1, lane-a (NOT lane_container)
    /^row[_-]?(\d+[a-z]?|[a-z])$/i,       // row_1, row-a
    /^ingestion[_-]?(\d+[a-z]?|[a-z])$/i, // ingestion_1 (NOT ingestion_paths)
    /^flow[_-]?(\d+[a-z]?|[a-z])$/i,      // flow_1 (NOT flow_container)
    /^stream[_-]?(\d+[a-z]?|[a-z])$/i,    // stream_1
  ];
  
  for (const pattern of lanePatterns) {
    const match = idLower.match(pattern);
    if (match) {
      const suffix = match[1];
      // For compound identifiers like "1a", "1b", use the alpha suffix for lane index
      // The number is the group, the letter is the lane within the group
      const compoundMatch = suffix.match(/^(\d+)([a-z])$/i);
      let index: number;
      if (compoundMatch) {
        // "1a" -> index from 'a', "1b" -> index from 'b', etc.
        index = compoundMatch[2].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0);
      } else {
        // Simple numeric: "1" -> index 0, "2" -> index 1
        const numMatch = suffix.match(/(\d+)/);
        index = numMatch ? parseInt(numMatch[1], 10) - 1 : extractAlphaIndex(suffix);
      }
      return { type: 'lane', index: Math.max(0, index), badgeLabel: suffix.toUpperCase() };
    }
  }
  
  // SECTION patterns: section_2, stage_1, col_a, column_1, step_1, analytics_section
  const sectionPatterns = [
    /^section[_-]?(\w+)$/i,        // section_2, section-3
    /^(\w+)[_-]section$/i,         // analytics_section, delivery_section (section at end)
    /^stage[_-]?(\w+)$/i,          // stage_1, stage-2
    /^col(?:umn)?[_-]?(\w+)$/i,    // col_1, column_2
    /^step[_-]?(\w+)$/i,           // step_1, step-2
    /^phase[_-]?(\w+)$/i,          // phase_1
    /^zone[_-]?(\w+)$/i,           // zone_1
  ];
  
  for (const pattern of sectionPatterns) {
    const match = idLower.match(pattern);
    if (match) {
      const suffix = match[1];
      const numMatch = suffix.match(/(\d+)/);
      const index = numMatch ? parseInt(numMatch[1], 10) - 1 : extractAlphaIndex(suffix);
      return { type: 'section', index: Math.max(0, index), badgeLabel: suffix.toUpperCase() };
    }
  }
  
  // BOUNDARY patterns: snowflake, aws_account, cloud_boundary, etc.
  const boundaryKeywords = ['snowflake', 'aws', 'azure', 'gcp', 'google', 'cloud', 'account', 'boundary', 'vpc', 'network'];
  for (const keyword of boundaryKeywords) {
    if (idLower.includes(keyword) || labelLower.includes(keyword)) {
      return { type: 'boundary', index: 0, badgeLabel: '' };
    }
  }
  
  // Special handling for producer/consumer patterns (they're like boundaries)
  if (idLower.includes('producer') || idLower.includes('consumer') || idLower.includes('source') || idLower.includes('sink')) {
    return { type: 'boundary', index: -1, badgeLabel: '' };
  }
  
  // Default: general group
  return { type: 'group', index: 0, badgeLabel: extractBadgeFromLabel(label) };
}

/**
 * Extract alphabetic index (a=0, b=1, c=2, etc.)
 */
function extractAlphaIndex(str: string): number {
  const alphaMatch = str.match(/([a-z])$/i);
  if (alphaMatch) {
    return alphaMatch[1].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0);
  }
  return 0;
}

/**
 * Extract a short badge label from a longer label string
 */
function extractBadgeFromLabel(label: string): string {
  // Try to find a number or letter at the end
  const match = label.match(/(\d+[a-z]?|[a-z])$/i);
  if (match) return match[1].toUpperCase();
  
  // Otherwise use first letter(s)
  const words = label.split(/[\s_-]+/);
  if (words.length >= 2) {
    return words.map(w => w[0]).join('').substring(0, 2).toUpperCase();
  }
  return label.substring(0, 2).toUpperCase();
}

/**
 * Build layout info for all subgraphs, auto-detecting types and assigning colors
 */
export function buildSubgraphLayoutInfo(
  subgraphs: Map<string, { label: string; nodes: string[]; parent?: string }>
): Map<string, SubgraphLayoutInfo> {
  const layoutInfo = new Map<string, SubgraphLayoutInfo>();
  let colorIndex = 0;
  
  for (const [id, sg] of subgraphs) {
    const { type, index, badgeLabel } = detectSubgraphLayoutType(id, sg.label, sg.parent);
    
    layoutInfo.set(id, {
      id,
      label: sg.label,
      type,
      index,
      badgeLabel,
      color: LAYOUT_COLORS[colorIndex % LAYOUT_COLORS.length],
      parent: sg.parent,
    });
    
    colorIndex++;
  }
  
  return layoutInfo;
}

/**
 * Lightweight Mermaid flowchart parser to produce ReactFlow nodes/edges.
 * Supports common arrow types: -->, --- , -.->, ==> variants.
 * NOW SUPPORTS: Subgraph parsing for lane-based layouts (streaming architecture)
 * Layout is a simple grid; callers may re-run layout if desired.
 */
export function convertMermaidToFlow(
  mermaidCode: string,
  componentCatalog: Catalog,
  isDarkMode = false
): { 
  nodes: Node[]; 
  edges: Edge[]; 
  subgraphs?: Map<string, { label: string; nodes: string[]; parent?: string }>;
  layoutInfo?: Map<string, SubgraphLayoutInfo>;
} {
  const edges: Edge[] = [];
  const nodeMap: Map<string, Node> = new Map();
  
  // Track subgraphs and their contained nodes
  const subgraphs = new Map<string, { label: string; nodes: string[]; parent?: string }>();
  const nodeToSubgraph = new Map<string, string>(); // nodeId -> subgraphId

  // PRE-PROCESS: Unescape JSON escape sequences that may come from LLM output
  // The agent sometimes outputs mermaid with escaped quotes like [\"5\"] instead of ["5"]
  const unescapedMermaid = mermaidCode
    .replace(/\\"/g, '"')   // Unescape quotes: \" -> "
    .replace(/\\\\/g, '\\'); // Unescape backslashes: \\ -> \
  
  const lines = unescapedMermaid.split('\n').map(l => l.trim()).filter(Boolean);
  // Edge regex: handles arrows like --> , -->, -->|"label"|, -.->|label|, etc.
  // Format: source -->|"optional label"| target  OR  source --> target
  const edgeRegex = /^([\w-]+)\s*([-.=]+>)\s*(?:\|[^|]*\|\s*)?([\w-]+)/;
  const nodeDefRegex = /^([\w-]+)\s*\[(.+)\]/;
  // Invisible link regex: handles ~~~ syntax for alignment without visible edges
  // Format: source ~~~ target (used to associate badges with their target subgraphs)
  // Note: ^\s* handles leading whitespace from indented Mermaid code
  const invisibleLinkRegex = /^\s*([\w-]+)\s*~~~\s*([\w-]+)$/;
  
  // Subgraph parsing regex
  const subgraphStartRegex = /^subgraph\s+([\w-]+)\s*\[?"?(.+?)"?\]?$/;
  const subgraphEndRegex = /^end$/i;
  
  // classDef parsing regex: classDef name fill:#color,stroke:#color,color:#color,...
  const classDefRegex = /^classDef\s+([\w-]+)\s+(.+)$/;
  // classDef with just the name (styles may be on next line)
  const classDefNameOnlyRegex = /^classDef\s+([\w-]+)\s*$/;
  // Style line: fill:#color,stroke:#color,color:#color,...
  const styleLineRegex = /^fill:(#[\w]+)/;
  // Node with class: nodeId(["label"]):::className or nodeId["label"]:::className
  const nodeWithClassRegex = /^([\w-]+)\s*\(\[?"?([^"\]]+)"?\]\):::(\w+)/;
  
  // Parse classDef definitions first (handle multi-line)
  const classStyles = new Map<string, { fill?: string; stroke?: string; color?: string }>();
  let pendingClassName: string | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // First try single-line classDef
    const classDefMatch = line.match(classDefRegex);
    if (classDefMatch) {
      const className = classDefMatch[1];
      const styleStr = classDefMatch[2];
      const styles: { fill?: string; stroke?: string; color?: string } = {};
      
      // Parse style properties
      const fillMatch = styleStr.match(/fill:(#[\w]+)/);
      const strokeMatch = styleStr.match(/stroke:(#[\w]+)/);
      const colorMatch = styleStr.match(/color:(#[\w]+)/);
      
      if (fillMatch) styles.fill = fillMatch[1];
      if (strokeMatch) styles.stroke = strokeMatch[1];
      if (colorMatch) styles.color = colorMatch[1];
      
      classStyles.set(className, styles);
      pendingClassName = null;
      continue;
    }
    
    // Check for classDef with just name (styles on next line)
    const nameOnlyMatch = line.match(classDefNameOnlyRegex);
    if (nameOnlyMatch) {
      pendingClassName = nameOnlyMatch[1];
      continue;
    }
    
    // Check if this is a style line following a classDef name
    if (pendingClassName && styleLineRegex.test(line)) {
      const styles: { fill?: string; stroke?: string; color?: string } = {};
      
      const fillMatch = line.match(/fill:(#[\w]+)/);
      const strokeMatch = line.match(/stroke:(#[\w]+)/);
      const colorMatch = line.match(/color:(#[\w]+)/);
      
      if (fillMatch) styles.fill = fillMatch[1];
      if (strokeMatch) styles.stroke = strokeMatch[1];
      if (colorMatch) styles.color = colorMatch[1];
      
      classStyles.set(pendingClassName, styles);
      pendingClassName = null;
      continue;
    }
    
    // Clear pending if we hit a non-style line
    if (pendingClassName && !line.startsWith('fill:')) {
      pendingClassName = null;
    }
  }
  
  // Debug: log parsed classStyles
  if (classStyles.size > 0) {
    console.log('[Mermaid Parser] Parsed classDef styles:', Object.fromEntries(classStyles));
  }

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
    // Only normalize actual ACCOUNT BOUNDARY nodes, not individual cloud services
    // Must match patterns like "Azure Account", "Azure Account Boundary", "GCP Account", etc.
    // NOT patterns like "Azure Blob Storage", "Google Pub/Sub", "Azure Event Hubs"
    if (txt.includes('snowflake account')) return 'account_boundary_snowflake';
    if (txt.includes('aws account') || txt.includes('amazon account')) return 'account_boundary_aws';
    // Azure: only match "azure account" or boundary patterns, NOT individual services
    if (txt.includes('azure account') || (txt.includes('azure') && txt.includes('boundary'))) {
      return 'account_boundary_azure';
    }
    // GCP/Google: only match "gcp account", "google account", or boundary patterns
    if (txt.includes('gcp account') || txt.includes('google account') || 
        ((txt.includes('gcp') || txt.includes('google')) && txt.includes('boundary'))) {
      return 'account_boundary_gcp';
    }
    return id;
  };

  const ensureNode = (rawId: string) => {
    // Skip invalid node IDs (empty, just dashes, etc.)
    if (!rawId || rawId === '-' || rawId.trim() === '' || /^-+$/.test(rawId)) {
      console.warn('[Mermaid Parser] Skipping invalid node ID:', rawId);
      // Return a dummy node that won't be rendered
      return { id: '__invalid__', data: {}, position: { x: 0, y: 0 } } as Node;
    }
    
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
        // Lane info will be added after subgraph parsing
        subgraph: undefined as string | undefined,
        lane: undefined as number | undefined,
        laneLabel: undefined as string | undefined,
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

  // Track current subgraph stack (for nested subgraphs)
  const subgraphStack: string[] = [];
  
  // Track invisible link associations (badge_id -> target_subgraph_id)
  // These are used to associate badges with their target lanes/sections
  const invisibleLinkAssociations = new Map<string, string>();
  
  for (const line of lines) {
    // Skip flowchart declaration and style lines
    if (line.startsWith('flowchart') || line.startsWith('graph') || line.startsWith('%%') || line.startsWith('style ') || line.startsWith('classDef ')) {
      continue;
    }
    
    // Check for badge nodes with :::className syntax (e.g., badge_1a(["1a"]):::laneBadge)
    const badgeMatch = line.match(nodeWithClassRegex);
    if (badgeMatch) {
      const nodeId = badgeMatch[1];
      const label = cleanText(badgeMatch[2]);
      const className = badgeMatch[3];
      const classStyle = classStyles.get(className);
      
      // Create as laneLabelNode with proper styling
      const badgeNode: Node = {
        id: nodeId,
        type: 'laneLabelNode',
        data: {
          label: label,
          isLaneLabel: true,
          isBadgeNode: true,
          badgeClass: className,
          backgroundColor: classStyle?.fill || (className === 'laneBadge' ? '#7C3AED' : '#2563EB'),
          textColor: classStyle?.color || '#FFFFFF',
        },
        position: { x: 0, y: 0 },
        style: {
          background: classStyle?.fill || (className === 'laneBadge' ? '#7C3AED' : '#2563EB'),
          color: classStyle?.color || '#FFFFFF',
          border: `2px solid ${classStyle?.stroke || (className === 'laneBadge' ? '#5B21B6' : '#1D4ED8')}`,
          borderRadius: '4px',
          fontWeight: 'bold',
          width: 36,
          height: 36,
        },
      };
      nodeMap.set(nodeId, badgeNode);
      console.log(`[Mermaid Parser] Created badge node: ${nodeId}, class=${className}, bg=${badgeNode.data.backgroundColor}`);
      
      // Associate with current subgraph if any
      if (subgraphStack.length > 0) {
        const currentSubgraph = subgraphStack[subgraphStack.length - 1];
        nodeToSubgraph.set(nodeId, currentSubgraph);
        subgraphs.get(currentSubgraph)?.nodes.push(nodeId);
        badgeNode.data.subgraph = currentSubgraph;
      }
      continue;
    }
    
    // Check for subgraph start
    const subgraphMatch = line.match(subgraphStartRegex);
    if (subgraphMatch) {
      const subgraphId = subgraphMatch[1];
      const subgraphLabel = cleanText(subgraphMatch[2].replace(/["]/g, ''));
      const parentSubgraph = subgraphStack.length > 0 ? subgraphStack[subgraphStack.length - 1] : undefined;
      
      subgraphs.set(subgraphId, {
        label: subgraphLabel,
        nodes: [],
        parent: parentSubgraph
      });
      subgraphStack.push(subgraphId);
      continue;
    }
    
    // Check for subgraph end
    if (subgraphEndRegex.test(line)) {
      subgraphStack.pop();
      continue;
    }
    
    // Node definition lines
    const nd = line.match(nodeDefRegex);
    if (nd) {
      const node = ensureNode(nd[1]);
      // Associate node with current subgraph (layout info applied after all parsing)
      if (subgraphStack.length > 0) {
        const currentSubgraph = subgraphStack[subgraphStack.length - 1];
        nodeToSubgraph.set(node.id, currentSubgraph);
        subgraphs.get(currentSubgraph)?.nodes.push(node.id);
        node.data.subgraph = currentSubgraph;
      }
      continue;
    }
    
    // Handle invisible links (~~~ syntax) - used to associate badges with target subgraphs
    // Format: badge_1a ~~~ path_1a (associates badge_1a with the path_1a subgraph)
    const invisibleMatch = line.match(invisibleLinkRegex);
    if (invisibleMatch) {
      const source = invisibleMatch[1];
      const target = invisibleMatch[2];
      // Store the association - source (badge) should inherit layout from target (subgraph)
      invisibleLinkAssociations.set(source, target);
      console.log(`[Mermaid Parser] Invisible link: ${source} ~~~ ${target}`);
      continue;  // Don't create visible edges for invisible links
    }
    
    // Edge lines
    const m = line.match(edgeRegex);
    if (m) {
      const source = m[1];
      const target = m[3];  // Group 3: target node (group 2 is the arrow type)
      const sourceNode = ensureNode(source);
      const targetNode = ensureNode(target);
      
      // Skip edges with invalid nodes
      if (sourceNode.id === '__invalid__' || targetNode.id === '__invalid__') {
        console.warn('[Mermaid Parser] Skipping edge with invalid node:', source, '->', target);
        continue;
      }
      
      // Associate nodes with current subgraph if they were just created
      if (subgraphStack.length > 0) {
        const currentSubgraph = subgraphStack[subgraphStack.length - 1];
        if (!nodeToSubgraph.has(sourceNode.id)) {
          nodeToSubgraph.set(sourceNode.id, currentSubgraph);
          subgraphs.get(currentSubgraph)?.nodes.push(sourceNode.id);
          sourceNode.data.subgraph = currentSubgraph;
        }
        if (!nodeToSubgraph.has(targetNode.id)) {
          nodeToSubgraph.set(targetNode.id, currentSubgraph);
          subgraphs.get(currentSubgraph)?.nodes.push(targetNode.id);
          targetNode.data.subgraph = currentSubgraph;
        }
      }
      
      const sourceId = sourceNode.id;
      const targetId = targetNode.id;
      edges.push({
        id: `${sourceId}-${targetId}-${edges.length}`,
        source: sourceId,
        target: targetId,
        type: 'smoothstep',  // Orthogonal routing with rounded corners
        animated: true,
        sourceHandle: 'right-source',
        targetHandle: 'left-target',
        style: { stroke: '#29B5E8', strokeWidth: 2 },
        deletable: true,
      });
    }
  }

  // Build generic layout info from subgraphs and apply to nodes
  const layoutInfo = buildSubgraphLayoutInfo(subgraphs);
  
  // Apply invisible link associations - badges inherit layout from their target subgraphs
  // This happens BEFORE applying layout to nodes, so badges get proper positioning
  for (const [badgeId, targetSubgraphId] of invisibleLinkAssociations) {
    const badgeNode = nodeMap.get(badgeId);
    if (badgeNode && layoutInfo.has(targetSubgraphId)) {
      const targetInfo = layoutInfo.get(targetSubgraphId)!;
      // Associate badge with the target subgraph for layout purposes
      badgeNode.data.subgraph = targetSubgraphId;
      badgeNode.data.associatedSubgraph = targetSubgraphId;  // Track original association
      nodeToSubgraph.set(badgeId, targetSubgraphId);
      console.log(`[Mermaid Parser] Badge ${badgeId} associated with ${targetSubgraphId} (${targetInfo.type}, index=${targetInfo.index})`);
    }
  }
  
  // Apply layout metadata to all nodes based on their subgraph
  for (const node of nodeMap.values()) {
    const subgraphId = node.data.subgraph as string | undefined;
    if (subgraphId && layoutInfo.has(subgraphId)) {
      const info = layoutInfo.get(subgraphId)!;
      node.data.layoutType = info.type;
      node.data.layoutIndex = info.index;
      node.data.badgeLabel = info.badgeLabel;
      node.data.layoutColor = info.color;
      
      // Legacy compatibility: map layout type to lane number
      if (info.type === 'lane') {
        node.data.lane = info.index;
        node.data.laneLabel = info.badgeLabel;
      } else if (info.type === 'section') {
        node.data.lane = 99; // Sections use lane 99 convention
        node.data.laneLabel = info.badgeLabel;
      } else if (info.type === 'boundary') {
        node.data.lane = info.index === -1 ? -1 : 99;
      }
    }
  }

  // Simple grid layout (will be overridden by lane layout if subgraphs present)
  const nodes = Array.from(nodeMap.values());
  const cols = 4;
  nodes.forEach((n, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    n.position = { x: col * 260, y: row * 200 };
  });

  // Return subgraph info and layout info for lane-based layout
  return { 
    nodes, 
    edges, 
    subgraphs: subgraphs.size > 0 ? subgraphs : undefined,
    layoutInfo: layoutInfo.size > 0 ? layoutInfo : undefined
  };
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

