/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @next/next/no-img-element */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Connection,
  ConnectionMode,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap,
  NodeTypes,
  Panel,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import styles from './App.module.css';
import { COMPONENT_CATEGORIES, SNOWFLAKE_ICONS } from './components/iconMap';
import CustomNode from './components/CustomNode';
// SnowgramAgentClient removed - PAT must never be exposed in client-side bundle
import { convertMermaidToFlow, LAYER_COLORS, getStageColor } from './lib/mermaidToReactFlow';
import { layoutWithELK, enrichNodesWithFlowOrder } from './lib/elkLayout';
import { resolveIcon } from './lib/iconResolver';
import { canonicalizeComponentType, keyForNode, normalizeBoundaryType, isMedallion, normalizeGraph } from './lib/graphNormalize';
import { hexToRgb as hexToRgbUtil, getLabelColor } from './lib/colorUtils';
import { generateMermaidFromDiagram } from './lib/mermaidExport';
import { boundingBox, layoutDAG, fitAllBoundaries, LAYOUT_CONSTANTS } from './lib/layoutUtils';
import { getFlowStageOrder } from './lib/elkLayoutUtils';

// Re-export constants for backward-compat with inline usage throughout this file
const DEFAULT_NODE_WIDTH = LAYOUT_CONSTANTS.DEFAULT_NODE_WIDTH;
const DEFAULT_NODE_HEIGHT = LAYOUT_CONSTANTS.DEFAULT_NODE_HEIGHT;
const STANDARD_NODE_WIDTH = LAYOUT_CONSTANTS.STANDARD_NODE_WIDTH;
const STANDARD_NODE_HEIGHT = LAYOUT_CONSTANTS.STANDARD_NODE_HEIGHT;
const BOUNDARY_PADDING_X = LAYOUT_CONSTANTS.BOUNDARY_PADDING_X;
const BOUNDARY_PADDING_Y_TOP = LAYOUT_CONSTANTS.BOUNDARY_PADDING_Y_TOP;
const BOUNDARY_PADDING_Y_BOTTOM = LAYOUT_CONSTANTS.BOUNDARY_PADDING_Y_BOTTOM;
const BOUNDARY_PADDING_Y = LAYOUT_CONSTANTS.BOUNDARY_PADDING_Y;
const BOUNDARY_GAP = LAYOUT_CONSTANTS.BOUNDARY_GAP;

// ============================================
// DEBUG LOGGING UTILITY (BUG-014 Fix)
// ============================================
const isDevelopment = process.env.NODE_ENV === 'development';

const debugLog = (message: string, ...args: unknown[]) => {
  if (isDevelopment) {
    console.log(message, ...args);
  }
};

const debugWarn = (message: string, ...args: unknown[]) => {
  if (isDevelopment) {
    console.warn(message, ...args);
  }
};

type AgentResult = {
  mermaidCode: string;
  spec?: { 
    nodes: any[]; 
    edges: any[];
    // Backend-driven layout metadata (when agent provides positions)
    layout?: {
      type: string;
      direction: string;
      baseX: number;
      baseY: number;
      colWidth: number;
      rowHeight: number;
    };
  };
  overview?: string;
  bestPractices?: string[];
  antiPatterns?: string[];
  components?: Array<{ name: string; purpose: string; configuration: string; bestPractice: string; source?: string }>;
  rawResponse?: string;
};

const nodeTypes: NodeTypes = {
  snowflakeNode: CustomNode,
};

// Flattened catalog for quick icon lookup
const ALL_COMPONENTS = Object.values(COMPONENT_CATEGORIES).flat() as Array<{
  id: string;
  name: string;
  icon: string;
}>;

// Map a component type/name to the best icon available
// DEPRECATED: Use resolveIcon from './lib/iconResolver' for new code
// This wrapper maintains backwards compatibility
const getIconForComponentType = (componentType?: string, label?: string, flowStageOrder?: number) => {
  return resolveIcon(componentType, label, flowStageOrder);
};

// Safe no-op callbacks for nodes that should not expose edit/delete (e.g., boundaries)
const boundaryCallbacks = {
  onRename: (_id: string, _newName: string) => {},
  onDelete: (_id: string) => {},
  onCopy: (_id: string) => {},
};


// Enforce single boundary per provider; remap edges to canonical boundary ids; restyle boundaries
const enforceAccountBoundaries = (nodes: Node[], edges: Edge[], isDark: boolean) => {
  const providerId = (ct?: string) => {
    const t = (ct || '').toLowerCase();
    if (t.includes('account_boundary_snowflake')) return 'account_boundary_snowflake';
    if (t.includes('account_boundary_aws')) return 'account_boundary_aws';
    if (t.includes('account_boundary_azure')) return 'account_boundary_azure';
    if (t.includes('account_boundary_gcp')) return 'account_boundary_gcp';
    if (t.includes('account_boundary_kafka')) return 'account_boundary_kafka';
    return null;
  };

  const keepers = new Map<string, Node>();
  const idRemap = new Map<string, string>();

  nodes.forEach((n) => {
    const rawType = ((n.data as any)?.componentType || n.id || '').toString();
    const normalizedType = normalizeBoundaryType(rawType, (n.data as any)?.label, n.id) || rawType;
    const pid = providerId(normalizedType);
    if (!pid) return;
    // assign canonical id/type
    const canonicalId = pid;
    idRemap.set(n.id, canonicalId);
    if (!keepers.has(pid)) {
      keepers.set(
        pid,
        ensureBoundaryStyle(
          {
            ...n,
            id: canonicalId,
            data: {
              ...(n.data as any),
              componentType: canonicalId,
              icon: undefined,
              showHandles: false,
            },
          },
          isDark
        )
      );
    }
  });

  const filteredNodes = [
    ...keepers.values(),
    ...nodes.filter((n) => !providerId(((n.data as any)?.componentType || '').toString())),
  ];

  const remappedEdges = edges.map((e) => {
    const src = idRemap.get(e.source) || e.source;
    const tgt = idRemap.get(e.target) || e.target;
    return { ...e, source: src, target: tgt };
  });

  return { nodes: filteredNodes, edges: remappedEdges };
};

// Ensure boundary nodes (account_boundary_*) have consistent styling and no icons
const ensureBoundaryStyle = (node: Node, isDark: boolean): Node => {
  const compType = ((node.data as any)?.componentType || '').toString().toLowerCase();
  if (!compType.startsWith('account_boundary')) return node;

  const brandColors: Record<string, string> = {
    account_boundary_snowflake: '#29B5E8',
    account_boundary_aws: '#FF9900',
    account_boundary_azure: '#0089D6',
    account_boundary_gcp: '#4285F4',
    account_boundary_kafka: '#E01E5A',  // Kafka/Confluent brand color
  };

  const brandFill = brandColors[compType] || '#29B5E8';

  const fillColor = ((node.data as any)?.fillColor as string) || brandFill;
  const alpha =
    typeof (node.data as any)?.fillAlpha === 'number'
      ? (node.data as any)?.fillAlpha
      : isDark
        ? 0.15
        : 0.08;
  const { r, g, b } = hexToRgbUtil(fillColor) || { r: 41, g: 181, b: 232 };
  const background = `rgba(${r}, ${g}, ${b}, ${alpha})`;

  return {
    ...node,
    style: {
      ...(node.style || {}),
      width: (node.style as any)?.width ?? 360,
      height: (node.style as any)?.height ?? 220,
      border: `2px dashed ${brandFill}`,
      background,
      borderRadius: 16,
      color: isDark ? '#e5f2ff' : '#1a1a1a',
      zIndex: (node.style as any)?.zIndex ?? -20,
    },
    data: {
      ...(node.data as any),
      icon: undefined, // never show icon on boundary
      labelColor: isDark ? '#e5f2ff' : '#1a1a1a',
      isDarkMode: isDark,
      showHandles: false,
      fillColor,
      fillAlpha: alpha,
      cornerRadius: 16,
      hideBorder: false,
      ...boundaryCallbacks,
    },
  };
};

// Create cloud/account boundary nodes (AWS/Azure/GCP/Snowflake) and push to back
const addAccountBoundaries = (nodes: Node[]): Node[] => {
  debugLog(`[addAccountBoundaries] Called with ${nodes.length} nodes`);
  const lowered = (s?: string) => (s || '').toLowerCase();
  const hasKeyword = (n: Node, keywords: string[]) =>
    keywords.some((k) => lowered((n.data as any)?.label).includes(k) || lowered((n.data as any)?.componentType).includes(k));

  const isBoundary = (n: Node) => lowered((n.data as any)?.componentType).startsWith('account_boundary');

  const cloudSets = {
    // Only match truly AWS-specific keywords (NOT 'lake' which could mean lakehouse)
    aws: ['s3', 'aws', 's3_bucket', 'aws_'],
    azure: ['azure', 'adls', 'blob'],
    gcp: ['gcp', 'gcs', 'google', 'bigquery', 'bq'],
    // Streaming/ingest sources — Snowpipe Streaming is the bridge between
    // external sources (Kafka) and Snowflake. Placing it inside the Streaming
    // Source boundary prevents the Snowflake boundary from extending leftward
    // and overlapping with the Kafka boundary.
    kafka: ['kafka', 'kinesis', 'event_hub', 'confluent', 'snowpipe_streaming', 'snowpipe streaming'],
  };

  const existingBoundary = (nodes || []).reduce<Record<string, boolean>>((acc, n) => {
    const ct = lowered((n.data as any)?.componentType);
    if (ct.startsWith('account_boundary')) {
      acc[ct] = true;
      debugLog(`[addAccountBoundaries] Detected existing boundary: ${ct} (id: ${n.id})`);
    }
    return acc;
  }, {});
  
  debugLog(`[addAccountBoundaries] Existing boundaries:`, Object.keys(existingBoundary));

  // Partition nodes by cloud vs snowflake (exclude boundaries from the working set)
  const nonBoundaryNodes = nodes.filter((n) => !isBoundary(n));
  const awsNodes = nonBoundaryNodes.filter((n) => hasKeyword(n, cloudSets.aws));
  const azureNodes = nonBoundaryNodes.filter((n) => hasKeyword(n, cloudSets.azure));
  const gcpNodes = nonBoundaryNodes.filter((n) => hasKeyword(n, cloudSets.gcp));
  const kafkaNodes = nonBoundaryNodes.filter((n) => hasKeyword(n, cloudSets.kafka));

  // Snowflake nodes = everything else that's not a cloud/external node or boundary
  const cloudNodeIds = new Set([...awsNodes, ...azureNodes, ...gcpNodes, ...kafkaNodes].map((n) => n.id));
  const snowflakeNodes = nonBoundaryNodes.filter((n) => !cloudNodeIds.has(n.id));
  
  debugLog(`[addAccountBoundaries] AWS: ${awsNodes.length}, Kafka: ${kafkaNodes.length}, Snowflake: ${snowflakeNodes.length}, Azure: ${azureNodes.length}, GCP: ${gcpNodes.length}`);

  const bbox = boundingBox;

  // Padding for boundaries - TOP needs extra space for label
  const padX = BOUNDARY_PADDING_X;
  const padYTop = BOUNDARY_PADDING_Y_TOP;  // Phase 2: Increased from 50 for boundary label room
  const padYBottom = BOUNDARY_PADDING_Y_BOTTOM;
  const padY = BOUNDARY_PADDING_Y; // Average padding for non-Snowflake boundaries

  const makeBoundary = (canonicalType: string, label: string, color: string, box: { minX: number; minY: number; maxX: number; maxY: number }, isDark: boolean = false) => {
    // Convert hex to RGB for proper alpha blending
    const rgb = hexToRgbUtil(color) || { r: 41, g: 181, b: 232 };
    // Use higher alpha in dark mode for visibility, lower in light mode to avoid overwhelming
    const alpha = isDark ? 0.15 : 0.08;
    const bgColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    
    return {
      id: `${canonicalType}_${Date.now()}`, // Timestamped ID for uniqueness
      type: 'snowflakeNode',
      position: { x: box.minX - padX, y: box.minY - padYTop },
      style: {
        width: (box.maxX - box.minX) + padX * 2,
        height: (box.maxY - box.minY) + padYTop + padYBottom,
        border: `2px dashed ${color}`,
        background: bgColor,
        borderRadius: 16,
        color: isDark ? '#e5f2ff' : '#1a1a1a',
        zIndex: -20,
      },
      data: {
        label,
        componentType: canonicalType, // Use canonical type, not timestamped ID
        icon: undefined, // Boundaries should NEVER have icons
        labelColor: isDark ? '#e5f2ff' : '#1a1a1a',
        isDarkMode: isDark,
        showHandles: false,
        fillColor: color,
        fillAlpha: alpha,
        cornerRadius: 16,
        hideBorder: false,
        ...boundaryCallbacks,
      },
    } as Node;
  };

  const boundaries: Node[] = [];
  const isDark = nodes[0]?.data?.isDarkMode ?? false;

  // Debug: log sample nodes
  if (snowflakeNodes.length > 0) {
    const sample = snowflakeNodes.slice(0, 3).map(n => ({
      id: n.id,
      label: (n.data as any)?.label,
      pos: n.position,
      style: n.style
    }));
    debugLog(`[addAccountBoundaries] Sample Snowflake nodes:`, sample);
  }
  
  const snowBox = bbox(snowflakeNodes);
  debugLog(`[addAccountBoundaries] Snowflake box:`, snowBox, `existing:`, existingBoundary['account_boundary_snowflake']);
  if (snowBox && !existingBoundary['account_boundary_snowflake']) {
    debugLog(`[addAccountBoundaries] ✅ Creating Snowflake boundary (not provided by agent)`);
    boundaries.push(makeBoundary('account_boundary_snowflake', 'Snowflake Account', '#29B5E8', snowBox, isDark));
  } else if (existingBoundary['account_boundary_snowflake']) {
    debugLog(`[addAccountBoundaries] ⏭️  Skipping Snowflake boundary (already exists from agent)`);
  }

  // Track repositioning offsets for external node groups
  // When a boundary is placed to the left of Snowflake, we must also move its contained nodes
  const nodeOffsets = new Map<string, { dx: number; dy: number }>(); // nodeId → offset

  const awsBoxRaw = bbox(awsNodes);
  debugLog(`[addAccountBoundaries] AWS box:`, awsBoxRaw, `existing:`, existingBoundary['account_boundary_aws']);
  if (awsBoxRaw && !existingBoundary['account_boundary_aws']) {
    debugLog(`[addAccountBoundaries] ✅ Creating AWS boundary (not provided by agent)`);
    // Position AWS box to the left of Snowflake box when both exist to avoid overlap
    const width = (awsBoxRaw.maxX - awsBoxRaw.minX) + padX * 2;
    const height = (awsBoxRaw.maxY - awsBoxRaw.minY) + padY * 2;
    const leftX = snowBox ? snowBox.minX - width - BOUNDARY_GAP : awsBoxRaw.minX - padX;
    const box = snowBox
      ? { minX: leftX, minY: awsBoxRaw.minY - padY, maxX: leftX + width, maxY: awsBoxRaw.maxY + padY }
      : awsBoxRaw;
    boundaries.push(makeBoundary('account_boundary_aws', 'AWS Account', '#FF9900', box, isDark));
    // Reposition AWS nodes into the new boundary position
    if (snowBox) {
      const dx = (box.minX + padX) - awsBoxRaw.minX;
      awsNodes.forEach(n => nodeOffsets.set(n.id, { dx, dy: 0 }));
    }
  } else if (existingBoundary['account_boundary_aws']) {
    debugLog(`[addAccountBoundaries] ⏭️  Skipping AWS boundary (already exists from agent)`);
  }

  const azureBox = bbox(azureNodes);
  if (azureBox && !existingBoundary['account_boundary_azure']) {
    debugLog(`[addAccountBoundaries] ✅ Creating Azure boundary (not provided by agent)`);
    boundaries.push(makeBoundary('account_boundary_azure', 'Azure Account', '#0089D6', azureBox, isDark));
  } else if (existingBoundary['account_boundary_azure']) {
    debugLog(`[addAccountBoundaries] ⏭️  Skipping Azure boundary (already exists from agent)`);
  }

  const gcpBox = bbox(gcpNodes);
  if (gcpBox && !existingBoundary['account_boundary_gcp']) {
    debugLog(`[addAccountBoundaries] ✅ Creating GCP boundary (not provided by agent)`);
    boundaries.push(makeBoundary('account_boundary_gcp', 'GCP Account', '#4285F4', gcpBox, isDark));
  } else if (existingBoundary['account_boundary_gcp']) {
    debugLog(`[addAccountBoundaries] ⏭️  Skipping GCP boundary (already exists from agent)`);
  }

  // Kafka/streaming boundary (external to Snowflake)
  const kafkaBox = bbox(kafkaNodes);
  if (kafkaBox && !existingBoundary['account_boundary_kafka']) {
    debugLog(`[addAccountBoundaries] ✅ Creating Kafka boundary (not provided by agent)`);
    // Position Kafka to the left of Snowflake
    const width = (kafkaBox.maxX - kafkaBox.minX) + padX * 2;
    const height = (kafkaBox.maxY - kafkaBox.minY) + padY * 2;
    // BUG-006 FIX: Renamed from snowBox to snowBoxForKafka to avoid shadowing
    const snowBoxForKafka = bbox(snowflakeNodes);
    const leftX = snowBoxForKafka ? snowBoxForKafka.minX - width - BOUNDARY_GAP : kafkaBox.minX - padX;
    const box = snowBoxForKafka
      ? { minX: leftX, minY: kafkaBox.minY - padY, maxX: leftX + width, maxY: kafkaBox.maxY + padY }
      : kafkaBox;
    boundaries.push(makeBoundary('account_boundary_kafka', 'Streaming Source', '#E01E5A', box, isDark));
    // Reposition Kafka nodes into the new boundary position
    if (snowBoxForKafka) {
      const dx = (box.minX + padX) - kafkaBox.minX;
      kafkaNodes.forEach(n => nodeOffsets.set(n.id, { dx, dy: 0 }));
    }
  } else if (existingBoundary['account_boundary_kafka']) {
    debugLog(`[addAccountBoundaries] ⏭️  Skipping Kafka boundary (already exists from agent)`);
  }

  // Collect existing boundaries from input
  const existingBoundaryNodes = nodes.filter((n) => isBoundary(n));
  
  debugLog(`[addAccountBoundaries] Created ${boundaries.length} new boundaries, found ${existingBoundaryNodes.length} existing boundaries`);
  
  // Calculate bounding boxes for recalculation
  const snowBoxCalc = bbox(snowflakeNodes);
  const awsBoxCalc = bbox(awsNodes);
  const azureBoxCalc = bbox(azureNodes);
  const gcpBoxCalc = bbox(gcpNodes);
  const kafkaBoxCalc = bbox(kafkaNodes);
  
  // Recalculate positions for agent-provided boundaries based on actual node positions
  const recalculatedBoundaries = existingBoundaryNodes.map(boundary => {
    const compType = lowered((boundary.data as any)?.componentType);
    
    // Find nodes that should be inside this boundary
    let containedNodes: Node[] = [];
    let rawBox: ReturnType<typeof bbox> = null;
    
    if (compType === 'account_boundary_snowflake') {
      containedNodes = snowflakeNodes;
      rawBox = snowBoxCalc;
    } else if (compType === 'account_boundary_aws') {
      containedNodes = awsNodes;
      rawBox = awsBoxCalc;
    } else if (compType === 'account_boundary_azure') {
      containedNodes = azureNodes;
      rawBox = azureBoxCalc;
    } else if (compType === 'account_boundary_gcp') {
      containedNodes = gcpNodes;
      rawBox = gcpBoxCalc;
    } else if (compType === 'account_boundary_kafka') {
      containedNodes = kafkaNodes;
      rawBox = kafkaBoxCalc;
    }
    
    if (!rawBox) {
      debugLog(`[addAccountBoundaries] No box for ${compType}, keeping original dimensions`);
      return boundary;
    }
    
    debugLog(`[addAccountBoundaries] Recalculating ${compType} boundary from ${containedNodes.length} nodes`);
    
    // Apply spacing logic: AWS should be positioned to the left of Snowflake with 40px gap
    let finalPosition = { x: rawBox.minX - padX, y: rawBox.minY - padY };
    const finalSize = {
      width: (rawBox.maxX - rawBox.minX) + padX * 2,
      height: (rawBox.maxY - rawBox.minY) + padY * 2
    };
    
    if (compType === 'account_boundary_aws' && snowBoxCalc) {
      // Calculate the width of the AWS boundary
      const awsWidth = (rawBox.maxX - rawBox.minX) + padX * 2;
      // Calculate Snowflake boundary left edge (node minX - padding)
      const snowflakeBoundaryLeft = snowBoxCalc.minX - padX;
      // Position AWS to the left of Snowflake boundary with BOUNDARY_GAP gap
      const leftX = snowflakeBoundaryLeft - awsWidth - BOUNDARY_GAP;
      finalPosition = { x: leftX, y: rawBox.minY - padY };
      debugLog(`[addAccountBoundaries] Repositioning AWS: snowflake nodes minX=${snowBoxCalc.minX}, snowflake boundary left=${snowflakeBoundaryLeft}, awsWidth=${awsWidth}, final leftX=${leftX}`);
    }
    
    // Position Kafka boundary to the left of Snowflake (similar to AWS)
    if (compType === 'account_boundary_kafka' && snowBoxCalc) {
      const kafkaWidth = (rawBox.maxX - rawBox.minX) + padX * 2;
      const snowflakeBoundaryLeft = snowBoxCalc.minX - padX;
      const leftX = snowflakeBoundaryLeft - kafkaWidth - BOUNDARY_GAP;
      finalPosition = { x: leftX, y: rawBox.minY - padY };
      debugLog(`[addAccountBoundaries] Repositioning Kafka: final leftX=${leftX}`);
    }
    
    // Update boundary position and size
    return {
      ...boundary,
      position: finalPosition,
      style: {
        ...(boundary.style || {}),
        width: finalSize.width,
        height: finalSize.height,
      },
    };
  });
  
  // Combine: newly created boundaries + recalculated existing boundaries + non-boundary nodes
  const allBoundaries = [...boundaries, ...recalculatedBoundaries];
  
  debugLog(`[addAccountBoundaries] Total boundaries: ${allBoundaries.length} (${boundaries.length} new + ${recalculatedBoundaries.length} recalculated)`);
  
  // Apply repositioning offsets to external nodes that were moved with their boundary
  const repositionedNodes = nonBoundaryNodes.map(n => {
    const offset = nodeOffsets.get(n.id);
    if (offset) {
      debugLog(`[addAccountBoundaries] Repositioning node ${n.id} by dx=${offset.dx}`);
      return {
        ...n,
        position: {
          x: n.position.x + offset.dx,
          y: n.position.y + offset.dy,
        },
      };
    }
    return n;
  });
  
  // Push boundaries behind everything else
  return [...allBoundaries, ...repositionedNodes];
};

// Compact DAG layout: imported from layoutUtils, aliased for call-site compat
const layoutNodes = layoutDAG;

// Deterministic medallion layout: fixed slots + minimal edges + non-overlapping boundaries
const layoutMedallionDeterministic = (nodes: Node[]) => {
  const isBoundary = (n: Node) => (((n.data as any)?.componentType || '') as string).toLowerCase().startsWith('account_boundary');
  const nonBoundary = nodes.filter((n) => !isBoundary(n));
  const boundaries = nodes.filter((n) => isBoundary(n));

  // BUG-005 FIX: Track which nodes have been picked to prevent duplicates
  const usedNodeIds = new Set<string>();

  // Exact ID picker - tries to find node by exact ID match first
  const pickById = (id: string): Node | null => {
    // BUG-005 FIX: Skip already-used nodes
    const node = nonBoundary.find(n => n.id === id && !usedNodeIds.has(n.id));
    return node || null;
  };

  // Score-based node picker - matches against id, label, and componentType
  const pick = (keywords: string[], preferredId?: string): Node | null => {
    // FIRST: Try exact ID match if provided (most reliable)
    if (preferredId) {
      const exact = pickById(preferredId);
      if (exact) {
        // BUG-005 FIX: Mark as used
        usedNodeIds.add(exact.id);
        return exact;
      }
    }
    
    const score = (n: Node) => {
      // Check against node id, label, AND componentType for best matching
      const s = `${n.id} ${((n.data as any)?.label || '')} ${((n.data as any)?.componentType || '')}`.toLowerCase();
      return keywords.reduce((acc, k) => (s.includes(k) ? acc + 1 : acc), 0);
    };
    // BUG-005 FIX: Filter out already-used nodes before scoring
    const availableNodes = nonBoundary.filter(n => !usedNodeIds.has(n.id));
    const result = availableNodes.reduce<{ best: Node | null; sc: number }>(
      (acc, n) => {
        const sc = score(n);
        if (sc > acc.sc) return { best: n, sc };
        return acc;
      },
      { best: null, sc: 0 }
    ).best;
    // BUG-005 FIX: Mark the picked node as used
    if (result) {
      usedNodeIds.add(result.id);
    }
    return result;
  };

  // === SOURCE LAYER (External) ===
  const cloud = pick(['s3', 'lake', 'aws', 'data lake'], 's3');
  const snowpipe = pick(['snowpipe', 'ingest', 'pipe'], 'pipe1');
  
  // === BRONZE LAYER (Raw Data) ===
  const bronzeDb = pick(['bronze db', 'bronze database'], 'bronze_db');
  const bronzeSchema = pick(['raw schema', 'bronze schema', 'raw_schema'], 'bronze_schema');
  const bronzeTables = pick(['raw table', 'bronze table', 'raw tables', 'raw_tables'], 'bronze_tables');
  
  // === SILVER LAYER (Cleaned Data) ===
  const silverDb = pick(['silver db', 'silver database'], 'silver_db');
  const silverSchema = pick(['cleansed schema', 'silver schema', 'clean schema', 'silver_schema'], 'silver_schema');
  const silverTables = pick(['cleansed table', 'silver table', 'cleansed tables', 'silver_tables'], 'silver_tables');
  
  // === GOLD LAYER (Business Ready) ===
  const goldDb = pick(['gold db', 'gold database'], 'gold_db');
  const goldSchema = pick(['curated schema', 'refined schema', 'gold schema', 'gold_schema'], 'gold_schema');
  const goldTables = pick(['curated tables', 'refined tables', 'gold tables', 'gold_tables'], 'gold_tables');
  
  // === CONSUMPTION LAYER (BI & Analytics) - MINIMAL ===
  const analyticsViews = pick(['analytics view', 'analytics_views', 'bi_views', 'reporting_views'], 'analytics_views');
  const computeWarehouse = pick(['compute warehouse', 'compute wh', 'warehouse'], 'compute_wh');
  
  // Optional BI Tools (only if agent provides them) - no preferredId since these are optional
  const tableau = pick(['tableau', 'tableau dashboard', 'tableau integration']);
  const streamlit = pick(['streamlit', 'streamlit dashboard', 'streamlit app']);

  // DEBUG: Log picked nodes to help diagnose layout issues
  debugLog('[layoutMedallionDeterministic] Picked nodes:', {
    bronzeDb: bronzeDb?.id,
    bronzeSchema: bronzeSchema?.id,
    bronzeTables: bronzeTables?.id,
    silverDb: silverDb?.id,
    silverSchema: silverSchema?.id,
    silverTables: silverTables?.id,
    goldDb: goldDb?.id,
    goldSchema: goldSchema?.id,
    goldTables: goldTables?.id,
    analyticsViews: analyticsViews?.id,
    computeWarehouse: computeWarehouse?.id,
    tableau: tableau?.id,
    streamlit: streamlit?.id,
  });
  debugLog('[layoutMedallionDeterministic] Available non-boundary nodes:', nonBoundary.map(n => `${n.id}/${(n.data as any)?.label}`));

  // Fixed grid slots with GENEROUS spacing for cleaner connections
  // SIMPLIFIED LAYOUT: Bronze → Silver → Gold → Analytics
  const baseX = 100;   // Start closer to left edge
  const baseY = 180;   // INCREASED: More room at top for "Snowflake Account" boundary label
  
  // CRITICAL: All nodes must have IDENTICAL dimensions for handles to align
  // This ensures right-edge handle of node A aligns with left-edge handle of node B
  const nodeWidth = 150;   // Fixed width for all medallion nodes
  const nodeHeight = 130;  // Fixed height for all medallion nodes
  
  // Spacing should account for node dimensions to align handle centers
  const colWidth = 200;   // Horizontal spacing between columns (node centers)
  const rowHeight = 160;  // Vertical spacing between rows (node centers)
  
  const X = (c: number) => baseX + c * colWidth;
  const Y = (r: number) => baseY + r * rowHeight;
  
  // Place function enforces consistent node dimensions
  const place = (n: Node | null, c: number, r: number) =>
    n
      ? {
          ...n,
          position: { x: X(c), y: Y(r) },
          // Force consistent width/height so handles align perfectly
          style: {
            ...(n.style || {}),
            width: nodeWidth,
            height: nodeHeight,
          },
        }
      : null;
  const placeAt = (n: Node | null, x: number, y: number) =>
    n
      ? {
          ...n,
          position: { x, y },
          // Force consistent width/height
          style: {
            ...(n.style || {}),
            width: nodeWidth,
            height: nodeHeight,
          },
        }
      : null;

  // ===============================
  // SIMPLIFIED GRID LAYOUT - Medallion Architecture
  // ===============================
  // Row 0: Databases (Bronze DB → Silver DB → Gold DB → Analytics Views)
  // Row 1: Schemas (Bronze Schema → Silver Schema → Gold Schema → Compute WH)
  // Row 2: Tables (Bronze Tables → Silver Tables → Gold Tables)
  // ===============================

  const positioned: Node[] = [
    // External Sources (left of Snowflake boundary, only if present)
    placeAt(cloud, -150, baseY),
    placeAt(snowpipe, -150, baseY + rowHeight),
    
    // === MEDALLION CORE: Bronze → Silver → Gold ===
    // Row 0: Databases
    place(bronzeDb, 0, 0),
    place(silverDb, 1, 0),
    place(goldDb, 2, 0),
    place(analyticsViews, 3, 0),
    
    // Row 1: Schemas
    place(bronzeSchema, 0, 1),
    place(silverSchema, 1, 1),
    place(goldSchema, 2, 1),
    place(computeWarehouse, 3, 1),
    
    // Row 2: Tables
    place(bronzeTables, 0, 2),
    place(silverTables, 1, 2),
    place(goldTables, 2, 2),
    
    // Optional BI Tools (col 4)
    place(tableau, 4, 0),
    place(streamlit, 4, 1),
  ].filter(Boolean) as Node[];

  // Deduplicate positioned array (in case of any duplicates in the manual placement list)
  const seenIds = new Set<string>();
  const dedupedPositioned = positioned.filter(n => {
    if (seenIds.has(n.id)) {
      debugWarn(`[layoutMedallionDeterministic] Skipping duplicate node: ${n.id}`);
      return false;
    }
    seenIds.add(n.id);
    return true;
  });
  positioned.length = 0;
  positioned.push(...dedupedPositioned);

  // DO NOT place extras - filter them out completely
  // Any node not in the core layout is a hallucination and should not appear
  const placedIds = new Set(positioned.map((n) => n.id));
  const extras = nonBoundary.filter((n) => !placedIds.has(n.id));
  if (extras.length > 0) {
    debugWarn(`[layoutMedallionDeterministic] DISCARDING ${extras.length} extra nodes:`, 
      extras.map(n => `${n.id}/${(n.data as any)?.label}`));
  }
  // NOTE: We do NOT add extras to positioned array - they are filtered out

  // Minimal edges - PROPERLY CONNECT ALL LAYERS
  // Create edges with proper handle selection based on node positions
  const makeEdge = (a: Node | null, b: Node | null, idx: number) => {
    if (!a || !b) return null;
    
    // Determine handle selection based on relative positions
    const dx = b.position.x - a.position.x;
    const dy = b.position.y - a.position.y;
    
    let sourceHandle: string;
    let targetHandle: string;
    
    // Use 'straight' edges ALWAYS to eliminate kinks
    // Straight edges draw direct lines between handles - no orthogonal routing
    const edgeType = 'straight';
    
    // If target is primarily below source (vertical flow within a layer)
    if (Math.abs(dy) > Math.abs(dx) && dy > 0) {
      sourceHandle = 'bottom-source';
      targetHandle = 'top-target';
    }
    // If target is primarily above source (shouldn't happen in medallion but handle it)
    else if (Math.abs(dy) > Math.abs(dx) && dy < 0) {
      sourceHandle = 'top-source';
      targetHandle = 'bottom-target';
    }
    // If target is primarily to the right (horizontal flow between layers)
    else if (dx > 0) {
      sourceHandle = 'right-source';
      targetHandle = 'left-target';
    }
    // If target is primarily to the left (shouldn't happen much)
    else {
      sourceHandle = 'left-source';
      targetHandle = 'right-target';
    }
    
    return {
      id: `d-${a.id}-${b.id}-${idx}`,
      source: a.id,
      target: b.id,
      sourceHandle,
      targetHandle,
      // 'straight' for aligned connections (no kinks), 'step' for diagonal
      type: edgeType,
      animated: true,
      style: { stroke: '#29B5E8', strokeWidth: 2.5 },  // Phase 3: Increased strokeWidth
      deletable: true,
    } as Edge;
  };

  // SIMPLIFIED edges - clean medallion flow
  // FLOW: Horizontal at each row (DB→DB, Schema→Schema, Tables→Tables)
  // This creates a clean grid pattern instead of diagonal lines
  const newEdges: Edge[] = [
    // === SOURCE TO BRONZE (only if external sources present) ===
    makeEdge(cloud, snowpipe, 0),
    makeEdge(snowpipe, bronzeDb, 1),
    
    // === ROW 0: Database layer (horizontal flow) ===
    makeEdge(bronzeDb, silverDb, 2),
    makeEdge(silverDb, goldDb, 3),
    makeEdge(goldDb, analyticsViews, 4),
    
    // === ROW 1: Schema layer (horizontal flow) ===
    makeEdge(bronzeSchema, silverSchema, 5),
    makeEdge(silverSchema, goldSchema, 6),
    makeEdge(goldSchema, computeWarehouse, 7),
    
    // === ROW 2: Tables layer (horizontal flow) ===
    makeEdge(bronzeTables, silverTables, 8),
    makeEdge(silverTables, goldTables, 9),
    
    // === VERTICAL: Within each layer ===
    makeEdge(bronzeDb, bronzeSchema, 10),
    makeEdge(bronzeSchema, bronzeTables, 11),
    makeEdge(silverDb, silverSchema, 12),
    makeEdge(silverSchema, silverTables, 13),
    makeEdge(goldDb, goldSchema, 14),
    makeEdge(goldSchema, goldTables, 15),
    makeEdge(analyticsViews, computeWarehouse, 16),
    
    // Optional BI tool connections
    makeEdge(computeWarehouse, tableau, 17),
    makeEdge(computeWarehouse, streamlit, 18),
  ].filter(Boolean) as Edge[];

  // Don't create boundaries here - let addAccountBoundaries handle it after layout
  debugLog(`[layoutMedallionDeterministic] Returning ${positioned.length} positioned nodes`);
  return { nodes: positioned, edges: newEdges };
};

const App: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const { getNodes, getEdges } = useReactFlow();
  
  // Track the last user prompt to detect if external sources were requested
  const lastUserPromptRef = useRef<string>('');
  
  // NEW: Dark mode state
  const [isDarkMode, setIsDarkMode] = useState(false);
  
  // NEW: Collapsed categories state (initially all expanded)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  
  // NEW: Search state
  const [searchQuery, setSearchQuery] = useState('');
  
  // NEW: Selected edges state for contextual actions (supports multi-select)
  const [selectedEdges, setSelectedEdges] = useState<Edge[]>([]);
  
  // NEW: Menu position state
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  // NEW: Clear confirmation state (inline)
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // NEW: Combined style/layer controls (screen coords + state)
  const [stylePanelPos, setStylePanelPos] = useState<{ x: number; y: number } | null>(null);
  const [fillColor, setFillColor] = useState('#29B5E8');
  const [fillAlpha, setFillAlpha] = useState(0);
  const [cornerRadius, setCornerRadius] = useState(8);
  const [hideBorder, setHideBorder] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showQuickTips, setShowQuickTips] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([
    { role: 'assistant', text: 'Tell me what to build. I will refine the diagram and keep context.' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatPos, setChatPos] = useState<{ x: number; y: number }>({ x: 120, y: 520 });
  const [chatDragging, setChatDragging] = useState(false);
  const [clearSpin, setClearSpin] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const chatDragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // History for multi-step undo
  const historyRef = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const historyIndexRef = useRef(-1);
  const skipHistoryRef = useRef(false);
  const historyLimit = 50;
  const lastSnapshotRef = useRef<string | null>(null);
  
  // BUG-007 FIX: Abort controller for parseMermaidAndCreateDiagram race condition
  const parseAbortControllerRef = useRef<AbortController | null>(null);

  // Undo handler
  const undo = useCallback(() => {
    const hist = historyRef.current;
    if (!hist.length) return;
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const snap = hist[historyIndexRef.current];
    skipHistoryRef.current = true;
    lastSnapshotRef.current = JSON.stringify(snap);
    setNodes(snap.nodes);
    setEdges(snap.edges);
  }, [setEdges, setNodes]);
  const clampChatPos = useCallback(
    (pos: { x: number; y: number }) => {
      if (typeof window === 'undefined') return pos;
      const margin = 16;
      const maxX = Math.max(margin, window.innerWidth - 80);
      const maxY = Math.max(margin, window.innerHeight - 80);
      return {
        x: Math.min(Math.max(pos.x, margin), maxX),
        y: Math.min(Math.max(pos.y, margin), maxY),
      };
    },
    []
  );

  // Persist chat state
  useEffect(() => {
    try {
      const stored = localStorage.getItem('snowgram.chat');
      if (stored) {
        const parsed = JSON.parse(stored);
        // BUG-009 FIX: Validate array structure before setting
        if (parsed.messages && Array.isArray(parsed.messages)) {
          setChatMessages(parsed.messages);
        }
        if (typeof parsed.open === 'boolean') setChatOpen(parsed.open);
        if (typeof parsed.input === 'string') setChatInput(parsed.input);
        if (parsed.pos && typeof parsed.pos.x === 'number' && typeof parsed.pos.y === 'number') {
          setChatPos(clampChatPos(parsed.pos));
        }
      }
    } catch (e) {
      console.warn('Failed to load chat from storage', e);
      // Clear corrupted storage
      try { localStorage.removeItem('snowgram.chat'); } catch {}
    }
  }, [clampChatPos]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => setChatPos((pos) => clampChatPos(pos));
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampChatPos]);

  useEffect(() => {
    try {
      localStorage.setItem(
        'snowgram.chat',
        JSON.stringify({ messages: chatMessages, open: chatOpen, input: chatInput, pos: chatPos })
      );
    } catch (e) {
      console.warn('Failed to persist chat to storage', e);
    }
  }, [chatMessages, chatOpen, chatInput, chatPos]);

  const currentMermaid = React.useMemo(() => generateMermaidFromDiagram(nodes, edges), [nodes, edges]);

  // History tracking for undo
  useEffect(() => {
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }
    const snapshot = JSON.stringify({ nodes, edges });
    if (lastSnapshotRef.current === snapshot) return;

    const hist = historyRef.current;
    if (historyIndexRef.current < hist.length - 1) {
      hist.splice(historyIndexRef.current + 1);
    }
    hist.push(JSON.parse(snapshot));
    if (hist.length > historyLimit) {
      hist.shift();
    }
    historyIndexRef.current = hist.length - 1;
    lastSnapshotRef.current = snapshot;
  }, [nodes, edges]);

  // Global undo hotkey (Cmd/Ctrl + Z)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTextField =
        tag === 'input' ||
        tag === 'textarea' ||
        (target && target.getAttribute && target.getAttribute('contenteditable') === 'true');
      if (isTextField) return;

      const isUndo = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
      if (isUndo) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo]);

  const updateEdgeMenuPosition = useCallback(() => {
    if (!reactFlowInstance || selectedEdges.length === 0) {
      setMenuPosition(null);
      return;
    }

    const edge = selectedEdges[0];
    const sourceNode = reactFlowInstance.getNode(edge.source) || nodes.find((n) => n.id === edge.source);
    const targetNode = reactFlowInstance.getNode(edge.target) || nodes.find((n) => n.id === edge.target);
    if (!sourceNode || !targetNode) {
      setMenuPosition(null);
      return;
    }

    const midX = (sourceNode.position.x + targetNode.position.x) / 2;
    const midY = (sourceNode.position.y + targetNode.position.y) / 2;
    const screenPos = reactFlowInstance.flowToScreenPosition({ x: midX, y: midY });
    setMenuPosition({ x: screenPos.x, y: screenPos.y - 80 });
  }, [reactFlowInstance, selectedEdges, nodes]);

  const onMove = useCallback(() => {
    updateEdgeMenuPosition();
  }, [updateEdgeMenuPosition]);

  React.useEffect(() => {
    updateEdgeMenuPosition();
  }, [updateEdgeMenuPosition, selectedEdges, nodes, reactFlowInstance]);

  // Helper: get current z-index for a node
  const getZ = (n: Node) => (n.style as any)?.zIndex ?? 0;

  // Grid snapping parameters (proximity-based, slightly stickier)
  const GRID_SIZE = 16;
  const SNAP_THRESHOLD_X = 10;  // grid snap when within 10px horizontally
  const SNAP_THRESHOLD_Y = 10;  // grid snap when within 10px vertically
  const SNAP_NODE_THRESHOLD_X = 12;  // neighbor snap when within 12px horizontally
  const SNAP_NODE_THRESHOLD_Y = 14;  // neighbor snap when within 14px vertically
  
  // NEW: Toggle category collapse/expand
  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  }, []);
  
  // NEW: Collapse all categories
  const collapseAll = useCallback(() => {
    const allCategories = Object.keys(COMPONENT_CATEGORIES);
    setCollapsedCategories(new Set(allCategories));
  }, []);
  
  // NEW: Expand all categories
  const expandAll = useCallback(() => {
    setCollapsedCategories(new Set());
  }, []);
  
  // NEW: Check if all categories are expanded (for toggle button)
  const allExpanded = collapsedCategories.size === 0;

  // Apply theme flag to node data so components can pick correct defaults
  const applyThemeToNode = useCallback((node: Node): Node => ({
    ...node,
    data: { ...(node.data as any), isDarkMode },
  }), [isDarkMode]);
  
  // NEW: Filter components by search query (fuzzy match)
  const filterComponents = useCallback((components: any[], query: string) => {
    if (!query.trim()) return components;
    
    const lowerQuery = query.toLowerCase();
    return components.filter(component => 
      component.name.toLowerCase().includes(lowerQuery) ||
      component.id.toLowerCase().includes(lowerQuery)
    );
  }, []);
  
  // Snap helper: only snap when within axis-specific thresholds of grid
  const snapValueX = useCallback((value: number) => {
    const remainder = value % GRID_SIZE;
    if (Math.abs(remainder) <= SNAP_THRESHOLD_X) return value - remainder;
    if (Math.abs(remainder - GRID_SIZE) <= SNAP_THRESHOLD_X) return value + (GRID_SIZE - remainder);
    return value;
  }, []);
  const snapValueY = useCallback((value: number) => {
    const remainder = value % GRID_SIZE;
    if (Math.abs(remainder) <= SNAP_THRESHOLD_Y) return value - remainder;
    if (Math.abs(remainder - GRID_SIZE) <= SNAP_THRESHOLD_Y) return value + (GRID_SIZE - remainder);
    return value;
  }, []);

  // Get node dimensions with sensible defaults
  const getNodeSize = useCallback((node: Node) => {
    const width = (node.style as any)?.width ?? 180;
    const height = (node.style as any)?.height ?? 140;
    return { width, height };
  }, []);

  // Snap position to nearby nodes (align centers or edges) if within threshold
  const snapToNearbyNodes = useCallback((node: Node, pos: { x: number; y: number }, allNodes: Node[]) => {
    const { width, height } = getNodeSize(node);
    const nodeCenter = { x: pos.x + width / 2, y: pos.y + height / 2 };

    let bestPos = { ...pos };
    let bestDelta = Number.MAX_VALUE;

    allNodes.forEach((other) => {
      if (other.id === node.id) return;
      const { width: w2, height: h2 } = getNodeSize(other);
      const otherCenter = { x: other.position.x + w2 / 2, y: other.position.y + h2 / 2 };

      // Candidate alignments: center X, center Y, left edges, top edges
      const candidates = [
        { x: otherCenter.x - width / 2, y: pos.y, kind: 'center-x' },
        { x: pos.x, y: otherCenter.y - height / 2, kind: 'center-y' },
        { x: other.position.x, y: pos.y, kind: 'left' },
        { x: pos.x, y: other.position.y, kind: 'top' },
      ];

      candidates.forEach((c) => {
        const deltaX = Math.abs((c.x + width / 2) - nodeCenter.x);
        const deltaY = Math.abs((c.y + height / 2) - nodeCenter.y);
        const isCenterX = c.kind === 'center-x';
        const isCenterY = c.kind === 'center-y';
        const isLeft = c.kind === 'left';
        const isTop = c.kind === 'top';

        const withinX = deltaX <= SNAP_NODE_THRESHOLD_X;
        const withinY = deltaY <= SNAP_NODE_THRESHOLD_Y;

        // Require closeness on relevant axis AND reasonable proximity on perpendicular axis
        const isCandidate =
          (isCenterX && withinX && withinY) ||
          (isCenterY && withinY && withinX) ||
          (isLeft && withinX && withinY) ||
          (isTop && withinY && withinX);

        if (isCandidate) {
          const delta = Math.min(deltaX, deltaY);
          if (delta < bestDelta) {
            bestDelta = delta;
            bestPos = { x: c.x, y: c.y };
          }
        }
      });
    });

    return bestPos;
  }, [getNodeSize]);

  // Snap node position on drag stop (conditional snap, not global)
  const onNodeDragStop = useCallback((_event: React.MouseEvent | React.TouchEvent, node: Node) => {
    // First, snap to grid if close (axis-specific thresholds)
    let nextPos = {
      x: snapValueX(node.position.x),
      y: snapValueY(node.position.y),
    };

    // Then, snap to nearby nodes if close enough
    const currentNodes = getNodes();
    nextPos = snapToNearbyNodes(node, nextPos, currentNodes);

    if (nextPos.x === node.position.x && nextPos.y === node.position.y) return;

    setNodes((nds) =>
      nds.map((n) =>
        n.id === node.id
          ? { ...n, position: { x: nextPos.x, y: nextPos.y } }
          : n
      )
    );
  }, [setNodes, snapValueX, snapValueY, snapToNearbyNodes, getNodes]);

  // Recompute style panel position and current fill for selected nodes
  React.useEffect(() => {
    if (!reactFlowInstance) {
      setStylePanelPos(null);
      return;
    }
    const selectedNodes = nodes.filter(n => n.selected);
    if (selectedNodes.length === 0) {
      setStylePanelPos(null);
      return;
    }
    const target = selectedNodes[0];
    const screenPos = reactFlowInstance.flowToScreenPosition({ x: target.position.x, y: target.position.y });
    setStylePanelPos({ x: screenPos.x, y: screenPos.y - 32 });

    // derive color/alpha from style.background if rgba, else default per type
    const dataFillColor = (target.data as any)?.fillColor as string | undefined;
    const dataFillAlpha = (target.data as any)?.fillAlpha as number | undefined;
    const dataRadius = (target.data as any)?.cornerRadius as number | undefined;
    const bg = (target.style as any)?.background as string | undefined;
    const defaultColors: Record<string, string> = {
      account_boundary_snowflake: '#29B5E8',
      account_boundary_aws: '#FF9900',
      account_boundary_azure: '#0089D6',
      account_boundary_gcp: '#4285F4',
    };
    const fallback = defaultColors[target.data?.componentType] || '#29B5E8';
    const detectedRadius =
      dataRadius ??
      (target.style as any)?.borderRadius ??
      8;
    setCornerRadius(typeof detectedRadius === 'number' ? detectedRadius : 8);

    if (typeof dataFillColor === 'string' && typeof dataFillAlpha === 'number') {
      setFillColor(dataFillColor);
      setFillAlpha(dataFillAlpha);
    } else if (bg && bg.startsWith('rgba')) {
      const m = bg.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)/);
      if (m) {
        const [, r, g, b, a] = m;
        const hex = '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('');
        setFillColor(hex);
        setFillAlpha(parseFloat(a));
      }
    } else if (bg && bg.startsWith('#')) {
      setFillColor(bg);
      setFillAlpha(1);
    } else {
      setFillColor(fallback || '#29B5E8');
      setFillAlpha(0);
    }
  }, [nodes, reactFlowInstance, getNodeSize]);

  // Layering controls (bring forward/back)
  const bringForward = useCallback(() => {
    setNodes((nds) => {
      return nds.map((n) =>
        n.selected ? { ...n, style: { ...(n.style || {}), zIndex: getZ(n) + 1 } } : n
      );
    });
  }, [setNodes]);

  const sendBackward = useCallback(() => {
    setNodes((nds) => {
      return nds.map((n) =>
        n.selected ? { ...n, style: { ...(n.style || {}), zIndex: getZ(n) - 1 } } : n
      );
    });
  }, [setNodes]);

  const bringToFront = useCallback(() => {
    setNodes((nds) => {
      const maxZ = nds.reduce((m, n) => Math.max(m, getZ(n)), 0);
      return nds.map((n) =>
        n.selected ? { ...n, style: { ...(n.style || {}), zIndex: maxZ + 1 } } : n
      );
    });
  }, [setNodes]);

  const sendToBack = useCallback(() => {
    setNodes((nds) => {
      const minZ = nds.reduce((m, n) => Math.min(m, getZ(n)), 0);
      return nds.map((n) =>
        n.selected ? { ...n, style: { ...(n.style || {}), zIndex: minZ - 1 } } : n
      );
    });
  }, [setNodes]);

  // Handle connections between nodes
  const onConnect = useCallback(
    (params: Connection) => {
      debugLog('🔌 Connection attempt:', params);

      // Guard against incomplete connections
      if (!params.source || !params.target) {
        debugWarn('❌ Missing source/target on connect, skipping edge', params);
        return;
      }

      // If user-selected handles are missing or incompatible, pick sane defaults based on relative positions
      const pickHandle = (fromId: string, toId: string, srcHandle?: string, tgtHandle?: string) => {
        // Validate handle types: source handles must end with '-source', target with '-target'
        const isValidSourceHandle = (h?: string) => h && h.endsWith('-source');
        const isValidTargetHandle = (h?: string) => h && h.endsWith('-target');
        
        // If both are provided AND valid, use them
        if (isValidSourceHandle(srcHandle) && isValidTargetHandle(tgtHandle)) {
          return { sourceHandle: srcHandle!, targetHandle: tgtHandle! };
        }
        
        // Otherwise, compute based on relative positions
        const from = getNodes().find(n => n.id === fromId);
        const to = getNodes().find(n => n.id === toId);
        if (!from || !to) {
          // Fallback to defaults if nodes not found
          return { 
            sourceHandle: isValidSourceHandle(srcHandle) ? srcHandle! : 'right-source', 
            targetHandle: isValidTargetHandle(tgtHandle) ? tgtHandle! : 'left-target' 
          };
        }
        
        const { width: w1, height: h1 } = getNodeSize(from);
        const { width: w2, height: h2 } = getNodeSize(to);
        const c1 = { x: from.position.x + w1 / 2, y: from.position.y + h1 / 2 };
        const c2 = { x: to.position.x + w2 / 2, y: to.position.y + h2 / 2 };
        const dx = c2.x - c1.x;
        const dy = c2.y - c1.y;
        
        // Pick handles based on direction, but only use provided handles if they're valid
        if (Math.abs(dx) >= Math.abs(dy)) {
          return {
            sourceHandle: isValidSourceHandle(srcHandle) ? srcHandle! : (dx >= 0 ? 'right-source' : 'left-source'),
            targetHandle: isValidTargetHandle(tgtHandle) ? tgtHandle! : (dx >= 0 ? 'left-target' : 'right-target'),
          };
        }
        return {
          sourceHandle: isValidSourceHandle(srcHandle) ? srcHandle! : (dy >= 0 ? 'bottom-source' : 'top-source'),
          targetHandle: isValidTargetHandle(tgtHandle) ? tgtHandle! : (dy >= 0 ? 'top-target' : 'bottom-target'),
        };
      };

      const handles = pickHandle(params.source, params.target, params.sourceHandle ?? undefined, params.targetHandle ?? undefined);
      const newEdge: Edge = {
        id: `${params.source}-${params.target}-${Date.now()}`,
        source: params.source,
        target: params.target,
        sourceHandle: handles.sourceHandle,
        targetHandle: handles.targetHandle,
        type: 'straight',  // Direct line between handles (no routing kinks)
        animated: true,
      style: { stroke: '#29B5E8', strokeWidth: 2.5 },  // Phase 3: Increased strokeWidth
        deletable: true,
        data: {
          // Track animation direction: 'forward' = source -> target, 'reverse' = target -> source
          animationDirection: 'forward',
        },
      };
      
      debugLog('✅ Adding edge:', newEdge);
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges, getNodes, getNodeSize]
  );
  
  // Handle edge click for selection with Shift multi-select support
  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.stopPropagation();
    
    if (event.shiftKey) {
      // Shift+click: Add to selection or remove if already selected
      setSelectedEdges(prev => {
        const isSelected = prev.some(e => e.id === edge.id);
        if (isSelected) {
          return prev.filter(e => e.id !== edge.id);
        } else {
          return [...prev, edge];
        }
      });
    } else {
      // Regular click: Select only this edge
      setSelectedEdges([edge]);
    }
    updateEdgeMenuPosition();
    setNodeMenu(null);
  }, [updateEdgeMenuPosition]);
  
  // Handle canvas click to deselect edges and nodes
  const onPaneClick = useCallback(() => {
    setSelectedEdges([]);
    setMenuPosition(null);
    setNodeMenu(null);
    // Deselect all nodes
    setNodes((nds) => nds.map((n) => ({ ...n, selected: false, data: { ...(n.data || {}), showHandles: false } })));
  }, [setNodes]);

  // Show/hide handles
  const refreshHandleVisibility = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...(n.data || {}),
          showHandles: !!n.selected,
        },
      }))
    );
  }, [setNodes]);

  const onConnectStart = useCallback(
    (_event: any, params: any) => {
      setIsConnecting(true);
      const sourceId = params?.nodeId;
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: {
            ...(n.data || {}),
            showHandles: !!n.selected || n.id === sourceId,
          },
        }))
      );
    },
    [setNodes]
  );

  const onConnectEnd = useCallback(() => {
    setIsConnecting(false);
    refreshHandleVisibility();
  }, [refreshHandleVisibility]);

  const onNodeMouseEnter = useCallback(
    (_event: any, node: Node) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id
            ? {
                ...n,
                data: {
                  ...(n.data || {}),
                  showHandles: (n.data as any)?.componentType?.toString().toLowerCase().startsWith('account_boundary')
                    ? false
                    : true,
                },
              }
            : n
        )
      );
    },
    [setNodes]
  );

  const onNodeMouseLeave = useCallback(
    (_event: any, node: Node) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id
            ? {
                ...n,
                data: {
                  ...(n.data || {}),
                  showHandles: (n.data as any)?.componentType?.toString().toLowerCase().startsWith('account_boundary')
                    ? false
                    : !!n.selected,
                },
              }
            : n
        )
      );
    },
    [setNodes]
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedEdges([]);
      setMenuPosition(null);
      setNodeMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id
            ? {
                ...n,
                selected: true,
                data: {
                  ...(n.data || {}),
                  showHandles: (n.data as any)?.componentType?.toString().toLowerCase().startsWith('account_boundary')
                    ? false
                    : true,
                },
              }
            : { ...n, selected: false, data: { ...(n.data || {}), showHandles: false } }
        )
      );
    },
    [setNodes]
  );
  
  // Flip animation direction of selected edges
  const flipEdgeDirection = useCallback(() => {
    if (selectedEdges.length === 0) return;
    
    const selectedIds = new Set(selectedEdges.map(e => e.id));
    
    setEdges((eds) =>
      eds.map((e) => {
        if (selectedIds.has(e.id)) {
          const currentDirection = e.data?.animationDirection || 'forward';
          const newDirection = currentDirection === 'forward' ? 'reverse' : 'forward';
          
          return {
            ...e,
            data: {
              ...e.data,
              animationDirection: newDirection
            },
            animated: true, // Keep animation on
            // Don't change style - only animation direction changes via CSS
          };
        }
        return e;
      })
    );
    
    // Update selected edges references
    setSelectedEdges((prev) =>
      prev.map((edge) => {
        const currentDirection = edge.data?.animationDirection || 'forward';
        const newDirection = currentDirection === 'forward' ? 'reverse' : 'forward';
        return {
          ...edge,
          data: {
            ...edge.data,
            animationDirection: newDirection
          }
        };
      })
    );
  }, [selectedEdges, setEdges]);
  
  // Delete selected edges
  const deleteSelectedEdges = useCallback(() => {
    if (selectedEdges.length === 0) return;
    
    const selectedIds = new Set(selectedEdges.map(e => e.id));
    setEdges((eds) => eds.filter((e) => !selectedIds.has(e.id)));
    setSelectedEdges([]);
    setMenuPosition(null);
  }, [selectedEdges, setEdges]);
  
  // Handle keyboard Delete for selected edges and nodes
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if user is not typing in an input field
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }
      
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        
        // Delete selected edges
        if (selectedEdges.length > 0) {
          deleteSelectedEdges();
        }
        
        // Delete selected nodes
        const selectedNodes = nodes.filter((n) => n.selected);
        if (selectedNodes.length > 0) {
          const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));
          setNodes((nds) => nds.filter((n) => !selectedNodeIds.has(n.id)));
          // Also delete edges connected to deleted nodes
          setEdges((eds) =>
            eds.filter((e) => !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target))
          );
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEdges, nodes, deleteSelectedEdges, setNodes, setEdges]);

  // Note: Edge reconnection handlers removed - not supported in this ReactFlow version

  // Handle drag over for drop from palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Delete a specific node (defined before onDrop to avoid initialization error)
  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((node) => node.id !== nodeId));
      setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    },
    [setNodes, setEdges]
  );

  // Rename node (defined before onDrop to avoid initialization error)
  const renameNode = useCallback(
    (nodeId: string, newName: string) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, label: newName } }
            : node
        )
      );
    },
    [setNodes]
  );

  // Copy/duplicate a node with slight offset
  const copyNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const original = nds.find((n) => n.id === nodeId);
        if (!original) return nds;
        const offset = 32;
        const newId = `${nodeId}_copy_${Date.now()}`;
        const newNode: Node = {
          ...original,
          id: newId,
          position: {
            x: (original.position?.x ?? 0) + offset,
            y: (original.position?.y ?? 0) + offset,
          },
          data: {
            ...(original.data as any),
            label: `${(original.data as any)?.label || 'Copy'}`,
          },
        };
        return [...nds, newNode];
      });
    },
    [setNodes]
  );

  // Handle drop from palette
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const componentData = event.dataTransfer.getData('application/reactflow');
      if (!componentData) return;

      const component = JSON.parse(componentData);
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds || !reactFlowInstance) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

    const isBoundary = component.id?.startsWith('account_boundary');
      const boundaryColors: Record<string, string> = {
        account_boundary_snowflake: '#29B5E8',
        account_boundary_aws: '#FF9900',
        account_boundary_azure: '#0089D6',
        account_boundary_gcp: '#4285F4',
      };
    const boundaryColor = boundaryColors[component.id] || '#94A3B8';
    const boundaryFill = fillAlpha;
    const rgb = hexToRgbUtil(boundaryColor) || { r: 41, g: 181, b: 232 };
    const rgbFill = hexToRgbUtil(fillColor) || { r: 41, g: 181, b: 232 };
    const labelColor = getLabelColor(fillColor, fillAlpha, isDarkMode);

      const newNode: Node = {
        id: `${component.id}_${Date.now()}`,
        type: 'snowflakeNode',
        position,
        style: {
          width: isBoundary ? 360 : 180,
          height: isBoundary ? 240 : 140,
        border: isBoundary ? `2px dashed ${boundaryColor}` : `2px solid ${fillColor}`,
          background: isBoundary
            ? `rgba(${rgb.r},${rgb.g},${rgb.b},${boundaryFill})`
            : `rgba(${rgbFill.r},${rgbFill.g},${rgbFill.b},${fillAlpha})`,
          borderRadius: isBoundary ? cornerRadius : cornerRadius,
          color: labelColor,
        },
        data: {
          label: component.name,
          icon: component.icon,
          componentType: component.id,
          background: isBoundary
            ? `rgba(${rgb.r},${rgb.g},${rgb.b},${boundaryFill})`
            : `rgba(${rgbFill.r},${rgbFill.g},${rgbFill.b},${fillAlpha})`,
          fillColor: isBoundary ? boundaryColor : fillColor,
          fillAlpha: fillAlpha,
          cornerRadius: cornerRadius,
          labelColor,
        hideBorder: false,
        showHandles: false,
          borderRadius: cornerRadius,
          onDelete: (id: string) => deleteNode(id),
          onRename: (id: string, newName: string) => renameNode(id, newName),
          isDarkMode,
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes, isDarkMode, deleteNode, renameNode, fillColor, fillAlpha, cornerRadius]
  );

  // Update all existing nodes when dark mode changes
  React.useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isDarkMode,
          labelColor: (node.data as any)?.labelColor
            || (isDarkMode ? '#E5EDF5' : '#0F172A'),
          onDelete: deleteNode,
          onRename: renameNode,
        },
      }))
    );
  }, [isDarkMode, setNodes, deleteNode, renameNode]);

  // Recompute label colors on theme change to ensure contrast
  React.useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        const data: any = node.data || {};
        const fill = data.fillColor || '#29B5E8';
        const alpha = typeof data.fillAlpha === 'number' ? data.fillAlpha : 0;
        const labelColor = getLabelColor(fill, alpha, isDarkMode);
        return {
          ...node,
          style: {
            ...(node.style || {}),
            color: labelColor,
          },
          data: {
            ...data,
            labelColor,
            isDarkMode,
          },
        };
      })
    );
  }, [isDarkMode, setNodes]);

  // Handle drag start from palette (keep real preview; add green glow)
  const onDragStart = (event: React.DragEvent, component: any) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(component));
    event.dataTransfer.effectAllowed = 'move';

    const card = event.currentTarget as HTMLElement | null;
    if (card) {
      card.classList.add(styles.componentCardDragging);
      const rect = card.getBoundingClientRect();
      event.dataTransfer.setDragImage(card, rect.width / 2, rect.height / 2);
    }
  };

  const onDragEnd = (event: React.DragEvent) => {
    const card = event.currentTarget as HTMLElement | null;
    if (card) {
      card.classList.remove(styles.componentCardDragging);
    }
  };

  // Clear all nodes and edges (inline confirmation)
  const handleClear = () => {
    setShowClearConfirm(true);
  };

  const confirmClear = () => {
    setNodes([]);
    setEdges([]);
    setShowClearConfirm(false);
  };

  const cancelClear = () => {
    setShowClearConfirm(false);
  };

  // Export as Mermaid (.mmd)
  const exportMermaid = () => {
    const mermaidCode = generateMermaidFromDiagram(nodes, edges);
    const blob = new Blob([mermaidCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snowgram_${Date.now()}.mmd`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export as SVG
  const exportSVG = () => {
    if (!reactFlowInstance) return;
    
    // BUG-004 FIX: Query full SVG element, not just viewport group
    const svgElement = document.querySelector('.react-flow svg');
    if (!svgElement) return;

    let url: string | null = null;
    let a: HTMLAnchorElement | null = null;
    try {
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgElement);
      
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      url = URL.createObjectURL(blob);
      a = document.createElement('a');
      document.body.appendChild(a);
      a.href = url;
      a.download = `snowgram_${Date.now()}.svg`;
      a.click();
    } catch (error) {
      console.error('SVG export error:', error);
      alert('SVG export failed. Please try again.');
    } finally {
      // BUG-004 FIX: Ensure cleanup even on error
      if (url) URL.revokeObjectURL(url);
      if (a && a.parentNode) a.parentNode.removeChild(a);
    }
  };

  // Export as PNG
  const exportPNG = async () => {
    if (!reactFlowInstance) return;

    const svgElement = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!svgElement) return;

    try {
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgElement);

      const bounds = svgElement.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = bounds.width * scale;
      canvas.height = bounds.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const img = new Image();
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (!blob) return;
          const pngUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = pngUrl;
          a.download = `snowgram_${Date.now()}.png`;
          a.click();
          URL.revokeObjectURL(pngUrl);
        }, 'image/png');
      };
      img.src = url;
    } catch (error) {
      console.error('PNG export error:', error);
      alert('PNG export failed. Please try SVG export instead.');
    }
  };

  // Export as JSON
  const exportJSON = () => {
    const diagramData = {
      nodes,
      edges,
      timestamp: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(diagramData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snowgram_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const callAgent = async (query: string): Promise<AgentResult> => {
    // All agent calls go through the secure backend proxy
    const resp = await fetch('/api/agent/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!resp.ok) {
      throw new Error('Unable to generate architecture. Please try again later.');
    }
    const data: AgentResult = await resp.json();
    return data;
  };

  const formatAgentReply = (data?: AgentResult) => {
    if (!data) return 'Updated the diagram. Ask for refinements or more changes.';
    const stripCode = (text: string) =>
      text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`/g, '')
        .replace(/[*_#>-]/g, ' ')
        .replace(/\s+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\[DONE\]/gi, '')
        .trim();
    
    // Deduplicate text by splitting into sentences and removing consecutive duplicates
    const dedupe = (text: string) => {
      const sentences = text.split(/(?<=[.!?])\s+/);
      const seen = new Set<string>();
      return sentences.filter(s => {
        const norm = s.trim().toLowerCase().substring(0, 100);
        if (seen.has(norm)) return false;
        seen.add(norm);
        return true;
      }).join(' ');
    };
    
    const parts: string[] = [];
    if (data.overview) {
      parts.push(dedupe(stripCode(data.overview)));
    }
    const best = (data.bestPractices || []).filter(Boolean).slice(0, 3);
    if (best.length) {
      parts.push(`Best practices:\n${best.map((b, i) => `${i + 1}. ${b}`).join('\n')}`);
    }
    const anti = (data.antiPatterns || []).filter(Boolean).slice(0, 2);
    if (anti.length) {
      parts.push(`Watch-outs:\n${anti.map((a, i) => `${i + 1}. ${a}`).join('\n')}`);
    }
    const comps = (data.components || []).filter(Boolean).slice(0, 3);
    if (comps.length) {
      parts.push(
        `Key components:\n${comps
          .map((c, i) => {
            const detail = c.purpose || c.configuration || c.bestPractice || '';
            return `${i + 1}. ${c.name}${detail ? ` — ${detail}` : ''}`;
          })
          .join('\n')}`
      );
    }
    const cites = (data as any)?.citations || [];
    if (Array.isArray(cites) && cites.length) {
      parts.push(
        `Sources:\n${cites
          .slice(0, 2)
          .map((c: any, i: number) => `${i + 1}. ${c.title || c.url || 'link'}`)
          .join('\n')}`
      );
    }
    // Fallback: if no structured parts, show a simple success message (don't use rawResponse - it may duplicate)
    if (!parts.length) {
      return 'Diagram updated successfully. Review the canvas for the complete architecture.';
    }
    return parts.join('\n\n');
  };

// Ensure CSP resources stay inside their provider boundary
const fitCspNodesIntoBoundaries = (nodes: Node[]) => fitAllBoundaries(nodes);

// Ensure core medallion nodes and edges exist (Bronze/Silver/Gold + streams + Analytics)
// BUG-002 FIX: Work with local copies to avoid mutating input arrays (React immutability)
const ensureMedallionCompleteness = (inputNodes: Node[], inputEdges: Edge[]) => {
  // Create mutable local copies - never mutate the original arrays
  let nodes = [...inputNodes];
  let edges = [...inputEdges];
  
  const normalizeLabel = (s: string) => 
    s.toLowerCase()
      .replace(/[→\-\s]+/g, '') // Remove arrows, dashes, spaces
      .replace(/to/g, '') // Remove "to" (e.g., "Bronze to Silver")
      .replace(/[^a-z0-9]/g, '');
  
  // If agent's output is severely incomplete, allow forced additions
  // Layer-based diagrams have fewer nodes (3 layers + CDC/Transform vs 9 granular nodes)
  const isSeverelyIncomplete = nodes.length < 3 || edges.length < 2;
  
  // Detect dark mode from existing nodes
  const isDark = nodes.length > 0 && (nodes[0].data as any)?.isDarkMode === true;
  
  // Helper to detect medallion layer and get colors
  const getLayerColors = (id: string, label: string) => {
    const text = `${id} ${label}`.toLowerCase();
    
    // Bronze layer
    if (text.includes('bronze') || text.includes('raw') || text.includes('landing') ||
        text.includes('ingest') || text.includes('source') || text.includes('staging')) {
      return LAYER_COLORS.bronze;
    }
    
    // Silver layer
    if (text.includes('silver') || text.includes('clean') || text.includes('conform') ||
        text.includes('transform') || text.includes('standardize') || text.includes('validated')) {
      return LAYER_COLORS.silver;
    }
    
    // Gold layer
    if (text.includes('gold') || text.includes('curated') || text.includes('refined') ||
        text.includes('aggregate') || text.includes('business') || text.includes('dim_') ||
        text.includes('fact_') || text.includes('mart')) {
      return LAYER_COLORS.gold;
    }
    
    // External sources
    if (text.includes('s3') || text.includes('aws') || text.includes('kafka') ||
        text.includes('api') || text.includes('external') || text.includes('lake')) {
      return LAYER_COLORS.external;
    }
    
    // BI/Analytics
    if (text.includes('analytics') || text.includes('dashboard') || text.includes('report') ||
        text.includes('bi_') || text.includes('tableau') || text.includes('powerbi')) {
      return LAYER_COLORS.bi;
    }
    
    return LAYER_COLORS.snowflake; // Default
  };
  
  const addNode = (id: string, label: string, componentType: string, force = false) => {
    // Get layer-specific colors
    const layerColors = getLayerColors(id, label);
    const borderColor = layerColors.border;
    const backgroundColor = isDark ? layerColors.backgroundDark : layerColors.background;
    
    // If force mode or severely incomplete, add without checking
    if (force || isSeverelyIncomplete) {
      const existing = nodes.find((n) => n.id === id);
      if (existing) {
        // Update existing node to ensure correct type AND colors
        (existing.data as any).label = label;
        (existing.data as any).componentType = componentType;
        // Update style with layer colors
        existing.style = {
          ...existing.style,
          border: `2px solid ${borderColor}`,
          background: backgroundColor,
          color: isDark ? '#e5f2ff' : '#1a1a1a',
        };
        return;
      }
      nodes.push({
        id,
        type: 'snowflakeNode',
        position: { x: 0, y: 0 },
        data: {
          label,
          componentType,
          showHandles: true,
          isDarkMode: isDark,
          labelColor: isDark ? '#e5f2ff' : '#1a1a1a',
          onRename: renameNode,
          onDelete: deleteNode,
          onCopy: copyNode,
        },
        style: {
          border: `2px solid ${borderColor}`,
          background: backgroundColor,
          borderRadius: 8,
          color: isDark ? '#e5f2ff' : '#1a1a1a',
        },
      });
      return;
    }
    
    // Check for semantic equivalence (same label or same componentType)
    const normLabel = normalizeLabel(label);
    const exists = nodes.some((n) => {
      if (n.id === id) return true;
      const nLabel = normalizeLabel((n.data as any)?.label || '');
      const nComp = ((n.data as any)?.componentType || '').toString().toLowerCase();
      // Match by label similarity or exact componentType (for medallion-specific types)
      if (nLabel === normLabel) return true;
      if (componentType === nComp) return true;
      return false;
    });
    if (exists) return;
    nodes.push({
      id,
      type: 'snowflakeNode',
      position: { x: 0, y: 0 },
      data: {
        label,
        componentType,
        showHandles: true,
        isDarkMode: isDark,
        labelColor: isDark ? '#e5f2ff' : '#1a1a1a',
        onRename: renameNode,
        onDelete: deleteNode,
        onCopy: copyNode,
      },
      style: {
        border: `2px solid ${borderColor}`,
        background: backgroundColor,
        borderRadius: 8,
        color: isDark ? '#e5f2ff' : '#1a1a1a',
      },
    });
  };
  debugLog('[Completeness] Input:', { nodeCount: nodes.length, edgeCount: edges.length, isSeverelyIncomplete });
  
  // FIRST, remap any agent-generated node IDs to canonical medallion IDs
  // (e.g., agent might use "stream1", "bronze_raw_tables", "silver_clean_tables" instead of canonical IDs)
  // This must run BEFORE addNode so addNode can properly detect existing nodes
  const idMap: Record<string, string> = {};
  const findNodeByLabelOrId = (targetLabel: string, idPatterns: string[]): Node | undefined => {
    const normTarget = normalizeLabel(targetLabel);
    // First try label match
    let found = nodes.find((n) => normalizeLabel((n.data as any)?.label || '') === normTarget);
    // If not found, try ID pattern match
    if (!found) {
      for (const pattern of idPatterns) {
        found = nodes.find((n) => n.id.toLowerCase().includes(pattern));
        if (found) break;
      }
    }
    return found;
  };
  const remapId = (canonicalId: string, targetLabel: string, idPatterns: string[] = []) => {
    const existing = findNodeByLabelOrId(targetLabel, idPatterns);
    if (existing && existing.id !== canonicalId) {
      debugLog(`[Completeness] Remapping ${existing.id} → ${canonicalId}`);
      idMap[existing.id] = canonicalId;
      existing.id = canonicalId;
      // Also update componentType to canonical medallion type if needed
      const d: any = existing.data || {};
      if (canonicalId === 'bronze_db') d.componentType = 'bronze_db';
      else if (canonicalId === 'bronze_schema') d.componentType = 'bronze_schema';
      else if (canonicalId === 'bronze_tables') d.componentType = 'bronze_tables';
      else if (canonicalId === 'silver_db') d.componentType = 'silver_db';
      else if (canonicalId === 'silver_schema') d.componentType = 'silver_schema';
      else if (canonicalId === 'silver_tables') d.componentType = 'silver_tables';
      else if (canonicalId === 'gold_db') d.componentType = 'gold_db';
      else if (canonicalId === 'gold_schema') d.componentType = 'gold_schema';
      else if (canonicalId === 'gold_tables') d.componentType = 'gold_tables';
      else if (canonicalId === 'stream_bronze_silver' || canonicalId === 'stream_silver_gold') d.componentType = 'stream';
      else if (canonicalId === 'analytics_views') d.componentType = 'analytics_views';
    }
  };
  
  // =====================================================================
  // LAYER-BASED REMAPPING (Modern Agent Output)
  // Agent returns abstract layers (Bronze Layer, Silver Layer, Gold Layer)
  // Do NOT remap these to granular components (Tables, Schema, DB)
  // =====================================================================
  
  // External sources - keep as-is
  remapId('s3', 'S3 Data Lake', ['s3', 'data_lake']);
  remapId('snowpipe', 'Snowpipe', ['pipe1', 'snowpipe']);
  remapId('kafka', 'Kafka', ['kafka_stream', 'kafka_source']);
  remapId('stage', 'Stage', ['sf_stage', 'staging']);
  
  // LAYER-BASED COMPONENTS (preferred - agent should use these)
  remapId('bronze_layer', 'Bronze Layer', ['sf_bronze_layer', 'bronze_layer']);
  remapId('silver_layer', 'Silver Layer', ['sf_silver_layer', 'silver_layer']);
  remapId('gold_layer', 'Gold Layer', ['sf_gold_layer', 'gold_layer']);
  
  // CDC/Transform components
  remapId('cdc_stream', 'CDC Stream', ['sf_cdc_stream', 'cdc_stream', 'stream_bronze', 'stream_silver']);
  remapId('transform_task', 'Transform Task', ['sf_transform_task', 'transform_task', 'etl_task']);
  
  // Analytics layer
  remapId('analytics_views', 'Analytics Views', ['sf_analytics_views', 'analytics', 'reporting_views']);
  remapId('compute_wh', 'Compute Warehouse', ['sf_warehouse', 'compute', 'warehouse', 'bi_warehouse']);
  
  // BI tools
  remapId('tableau', 'Tableau', ['tableau_dashboard', 'powerbi', 'bi_tool']);

  // BUG-012 FIX: Create new edge objects instead of mutating in-place (React immutability)
  // Update all edge references to use canonical IDs
  const remappedEdges = edges.map(e => ({
    ...e,
    source: idMap[e.source] || e.source,
    target: idMap[e.target] || e.target,
  }));
  edges = remappedEdges;
  
  debugLog('[Completeness] After remapping:', { nodeCount: nodes.length });

  // SECOND, handle external sources (S3 vs Kafka)
  // CRITICAL FDE FIX: NEVER add S3/Snowpipe if user asked for Kafka
  // Check if Kafka was explicitly requested or returned by agent
  const hasKafka = nodes.some(n => {
    const label = ((n.data as any)?.label || '').toLowerCase();
    const id = n.id.toLowerCase();
    return label.includes('kafka') || id.includes('kafka');
  });
  
  const hasExplicitS3 = nodes.some(n => {
    const label = ((n.data as any)?.label || '').toLowerCase();
    const id = n.id.toLowerCase();
    const compType = ((n.data as any)?.componentType || '').toLowerCase();
    // Only match EXPLICIT S3 references
    return (label === 's3' || label === 's3 data lake' || label.startsWith('s3 ') ||
            id === 's3' || compType === 's3');
  });
  
  const hasExplicitSnowpipe = nodes.some(n => {
    const label = ((n.data as any)?.label || '').toLowerCase();
    const id = n.id.toLowerCase();
    return label === 'snowpipe' || label.includes('snowpipe') || id === 'snowpipe' || id === 'pipe1';
  });
  
  // FDE: If Kafka is present, REMOVE any S3/Snowpipe nodes (they shouldn't coexist)
  if (hasKafka) {
    debugLog('[Completeness] Kafka detected - removing any S3/Snowpipe nodes');
    const kafkaFiltered = nodes.filter(n => {
      const label = ((n.data as any)?.label || '').toLowerCase();
      const id = n.id.toLowerCase();
      const isS3 = label.includes('s3') || id === 's3';
      const isSnowpipe = label.includes('snowpipe') || id === 'snowpipe' || id === 'pipe1';
      if (isS3 || isSnowpipe) {
        debugLog(`[Completeness] Removing ${id} (incompatible with Kafka)`);
        return false;
      }
      return true;
    });
    // BUG-002 FIX: Reassign local variable instead of mutating array
    nodes = kafkaFiltered;
  } else if (hasExplicitS3 || hasExplicitSnowpipe) {
    // Only add S3/Snowpipe if they were explicitly in agent output (not if Kafka is present)
    debugLog('[Completeness] Keeping existing S3/Snowpipe (no Kafka detected)');
    if (hasExplicitS3) addNode('s3', 'S3 Data Lake', 's3', true);
    if (hasExplicitSnowpipe) addNode('snowpipe', 'Snowpipe', 'snowpipe', true);
  } else {
    debugLog('[Completeness] NO external source detected - not adding S3/Snowpipe');
  }
  
  // =====================================================================
  // LAYER-BASED COMPLETENESS (Modern Agent Output)
  // ALWAYS ensure Bronze, Silver, Gold Layer nodes exist
  // These are the core of medallion architecture
  // =====================================================================
  
  // Helper to check if a specific layer exists (more inclusive matching)
  const hasLayerNode = (layerName: string) => {
    const lowerLayer = layerName.toLowerCase(); // e.g., 'bronze', 'silver', 'gold'
    return nodes.some(n => {
      const id = n.id.toLowerCase();
      const label = ((n.data as any)?.label || '').toLowerCase();
      // Match: bronze_layer, bronze layer, bronze, sf_bronze_layer, etc.
      const hasInId = id.includes(lowerLayer);
      const hasInLabel = label.includes(lowerLayer);
      return hasInId || hasInLabel;
    });
  };
  
  // Log what layers exist before adding
  debugLog('[Completeness] Layer check:', {
    hasBronze: hasLayerNode('bronze'),
    hasSilver: hasLayerNode('silver'),
    hasGold: hasLayerNode('gold'),
    nodeIds: nodes.map(n => n.id),
    nodeLabels: nodes.map(n => (n.data as any)?.label)
  });
  
  // ALWAYS add core layer nodes if they don't exist with ANY bronze/silver/gold reference
  if (!hasLayerNode('bronze')) {
    debugLog('[Completeness] Adding missing Bronze Layer');
    addNode('bronze_layer', 'Bronze Layer', 'sf_bronze_layer', true);
  }
  if (!hasLayerNode('silver')) {
    debugLog('[Completeness] Adding missing Silver Layer');
    addNode('silver_layer', 'Silver Layer', 'sf_silver_layer', true);
  }
  if (!hasLayerNode('gold')) {
    debugLog('[Completeness] Adding missing Gold Layer');
    addNode('gold_layer', 'Gold Layer', 'sf_gold_layer', true);
  }
  
  // Analytics layer - only if missing
  const hasAnalytics = nodes.some(n => {
    const id = n.id.toLowerCase();
    const label = ((n.data as any)?.label || '').toLowerCase();
    return id.includes('analytics') || label.includes('analytics') || 
           id.includes('views') || label.includes('views');
  });
  if (!hasAnalytics) {
    addNode('analytics_views', 'Analytics Views', 'sf_analytics_views', true);
  }
  
  // DON'T force-add: CDC Stream, Transform Task, Warehouse, Tableau
  // Let the agent decide if these are needed based on the use case
  
  debugLog('[Completeness] After addNode:', { 
    nodeCount: nodes.length,
    nodeIds: nodes.map(n => n.id)
  });

  debugLog('[Completeness] Input edges:', edges.map(e => `${e.source}->${e.target}`));
  
  // CLEAN UP: Remove backwards/invalid edges that violate medallion logic
  // LAYER-BASED: Allow flexible agent-defined edges, just block obvious backwards flows
  // Don't enforce rigid edge patterns - let agent define the flow
  
  // Just define what nodes are valid in the medallion context
  const medallionNodePatterns = [
    's3', 'snowpipe', 'kafka', 'stage',
    'bronze_layer', 'silver_layer', 'gold_layer',
    'cdc_stream', 'transform_task',
    'analytics_views', 'compute_wh', 'tableau'
  ];
  
  // Check if a node is a valid medallion node
  const isValidMedallionNode = (nodeId: string) => {
    const normalized = nodeId.toLowerCase().replace(/[^a-z0-9]/g, '');
    return medallionNodePatterns.some(p => normalized.includes(p.replace(/[^a-z0-9]/g, '')));
  };
  
  // Add common invalid patterns to explicitly block (catch any casing/whitespace variations)
  const normalizeEdgeId = (id: string) => id.toLowerCase().replace(/[^a-z0-9]/g, '');
  const invalidPatterns = [
    // Backwards flows - data should flow forward only
    'goldlayerbronzelayer', // No backwards
    'goldlayersilverlayer', // No backwards  
    'silverlayerbronzelayer', // No backwards
    'analyticsbronze', // No backwards
    'analyticssilver', // No backwards
    'analyticsgold', // No backwards (analytics is terminal)
  ];
  const invalidSet = new Set(invalidPatterns.map(normalizeEdgeId));
  
  // Remove edges that:
  // 1. Go backwards in the medallion flow
  // 2. Connect medallion nodes in invalid ways
  const cleanedEdges = edges.filter((e) => {
    const key = `${e.source}->${e.target}`;
    const normalizedKey = normalizeEdgeId(key);
    
    // Explicitly reject known invalid patterns (normalized for robustness)
    if (invalidSet.has(normalizedKey)) {
      debugWarn(`🚫 [Completeness] Blocked invalid edge: ${key} (normalized: ${normalizedKey})`);
      return false;
    }
    
    // Allow all other edges - let agent define the flow
    return true;
  });
  
  // BUG-002 FIX: Reassign local variable instead of mutating array
  const beforeCount = edges.length;
  edges = cleanedEdges;
  debugLog('[Completeness] Cleaned edges:', { before: beforeCount, after: cleanedEdges.length, removed: beforeCount - cleanedEdges.length });
  debugLog('[Completeness] Cleaned edges list:', cleanedEdges.map(e => `${e.source}->${e.target}`));

  // Now, ensure all required edges exist (using canonical IDs)
  const edgeMap = new Set(edges.map((e) => `${e.source}->${e.target}`));
  const ensureEdge = (source: string, target: string) => {
    const key = `${source}->${target}`;
    if (edgeMap.has(key)) return;
    edgeMap.add(key);
    const edge: Edge = {
      id: key,
      source,
      target,
      type: 'straight',  // Direct line between handles (no routing kinks)
      animated: true,
      sourceHandle: 'right-source',
      targetHandle: 'left-target',
      style: { stroke: '#60A5FA', strokeWidth: 2.5 },
    };
    edges.push(edge);
  };
  
  // =====================================================================
  // LAYER-BASED EDGES - Ensure proper flow connections
  // =====================================================================
  
  // External source edges based on what's present
  if (hasKafka) {
    // Kafka -> Bronze Layer
    ensureEdge('kafka', 'bronze_layer');
  } else if (hasExplicitS3 || hasExplicitSnowpipe) {
    // S3 -> Snowpipe -> Bronze Layer
    if (hasExplicitS3 && hasExplicitSnowpipe) {
      ensureEdge('s3', 'snowpipe');
      ensureEdge('snowpipe', 'bronze_layer');
    } else if (hasExplicitS3) {
      ensureEdge('s3', 'bronze_layer');
    } else if (hasExplicitSnowpipe) {
      ensureEdge('snowpipe', 'bronze_layer');
    }
  }
  
  // Core layer edges - ALWAYS ensure these exist for medallion flow
  const nodeIds = new Set(nodes.map(n => n.id.toLowerCase()));
  debugLog('[Completeness] Node IDs for edge logic:', Array.from(nodeIds));
  
  // Bronze -> Silver (direct or via CDC/Transform)
  if (nodeIds.has('bronze_layer') && nodeIds.has('silver_layer')) {
    const hasBronzeToSilverEdge = edges.some(e => {
      const src = e.source.toLowerCase();
      const tgt = e.target.toLowerCase();
      return (src.includes('bronze') && (tgt.includes('silver') || tgt.includes('cdc') || tgt.includes('transform')));
    });
    if (!hasBronzeToSilverEdge) {
      debugLog('[Completeness] Adding bronze_layer -> silver_layer edge');
      ensureEdge('bronze_layer', 'silver_layer');
    }
  }
  
  // Silver -> Gold (direct or via CDC/Transform)
  if (nodeIds.has('silver_layer') && nodeIds.has('gold_layer')) {
    const hasSilverToGoldEdge = edges.some(e => {
      const src = e.source.toLowerCase();
      const tgt = e.target.toLowerCase();
      return (src.includes('silver') && (tgt.includes('gold') || tgt.includes('cdc') || tgt.includes('transform')));
    });
    if (!hasSilverToGoldEdge) {
      debugLog('[Completeness] Adding silver_layer -> gold_layer edge');
      ensureEdge('silver_layer', 'gold_layer');
    }
  }
  
  // Gold -> Analytics
  if (nodeIds.has('gold_layer') && nodeIds.has('analytics_views')) {
    const hasGoldToAnalyticsEdge = edges.some(e => {
      const src = e.source.toLowerCase();
      const tgt = e.target.toLowerCase();
      return src.includes('gold') && tgt.includes('analytics');
    });
    if (!hasGoldToAnalyticsEdge) {
      debugLog('[Completeness] Adding gold_layer -> analytics_views edge');
      ensureEdge('gold_layer', 'analytics_views');
    }
  }

  // FILTER OUT ORPHAN NODES: Nodes that have no connections are likely extraneous agent hallucinations
  // Only keep nodes that are either:
  // 1. Core layer nodes (always needed)
  // 2. Connected to at least one edge
  // 3. Boundary nodes (special case)
  const coreNodeIds = new Set([
    's3', 'snowpipe', 'kafka', 'stage',
    'bronze_layer', 'silver_layer', 'gold_layer',
    'cdc_stream', 'cdc_stream_1', 'cdc_stream_2',
    'transform_task', 'transform_task_1', 'transform_task_2',
    'analytics_views', 'compute_wh', 'tableau'
  ]);
  
  // Explicitly unwanted nodes that should never appear (agent hallucinations)
  // These are "invented" tasks/components that create visual noise
  const unwantedPatterns = [
    // Aggregation tasks (not standard medallion)
    'aggregation task', 'aggregation_task', 'agg task', 'agg_task',
    'silver gold aggregation', 'silver_gold_agg', 'bronze silver aggregation',
    // Cleansing/validation tasks (not standard)
    'cleansing task', 'cleaning task', 'validation task',
    'quality check', 'data quality',
    // Processing nodes (vague names)
    'bronze to silver', 'silver to gold', 'gold to analytics',
    'processing task', 'processing job', 'etl job',
    // OLD GRANULAR NODES - no longer used, filter if agent returns them
    'bronze db', 'bronze_db', 'bronze schema', 'bronze_schema', 'bronze tables', 'bronze_tables',
    'silver db', 'silver_db', 'silver schema', 'silver_schema', 'silver tables', 'silver_tables',
    'gold db', 'gold_db', 'gold schema', 'gold_schema', 'gold tables', 'gold_tables',
    // Filter hallucinated BI "views"
    'bi analytics views', 'bi views',
    'performance materialized views', 'performance views', 'materialized view',
    'secure reporting views', 'reporting views', 'secure views',
    // Filter extra dashboards/reports
    'executive dashboard', 'executive report',
  ];
  
  // Build set of nodes that appear in edges
  const connectedNodeIds = new Set<string>();
  edges.forEach(e => {
    connectedNodeIds.add(e.source);
    connectedNodeIds.add(e.target);
  });
  
  // WHITELIST: Only these node IDs are allowed in medallion diagrams
  // This prevents agent hallucinations from appearing
  const medallionWhitelist = new Set([
    // External sources (only if explicitly requested)
    's3', 'snowpipe', 'kafka', 'stage',
    // Layer-based components (modern agent output)
    'bronze_layer', 'silver_layer', 'gold_layer',
    // CDC and Transform components
    'cdc_stream', 'cdc_stream_1', 'cdc_stream_2',
    'transform_task', 'transform_task_1', 'transform_task_2',
    // Core analytics
    'analytics_views', 'compute_wh',
    // BI tools (external consumers)
    'tableau', 'powerbi', 'streamlit',
  ]);
  
  // Also allow nodes that match these patterns (for flexibility)
  const allowedPatterns = [
    'bronze', 'silver', 'gold', 'layer',
    'stream', 'cdc', 'task', 'transform',
    'warehouse', 'wh', 'analytics', 'views',
    'tableau', 'powerbi', 'streamlit', 'dashboard',
    'kafka', 'stage', 'snowpipe',
    'account_boundary'
  ];
  
  // Filter out orphans AND unwanted patterns
  const beforeOrphanFilter = nodes.length;
  const filteredNodes = nodes.filter(n => {
    const id = n.id.toLowerCase();
    const label = ((n.data as any)?.label || '').toLowerCase();
    const compType = ((n.data as any)?.componentType || '').toLowerCase();
    const text = `${id} ${label} ${compType}`;
    
    // Always keep boundaries
    if (compType.startsWith('account_boundary')) return true;
    
    // PRIORITY 1: Always keep core medallion nodes (never filter these)
    if (coreNodeIds.has(id)) return true;
    
    // PRIORITY 2: Keep if in whitelist
    if (medallionWhitelist.has(id)) return true;
    
    // PRIORITY 3: Filter out explicitly unwanted patterns (hallucinations)
    const isUnwanted = unwantedPatterns.some(p => text.includes(p.toLowerCase()));
    if (isUnwanted) {
      debugWarn(`🚫 [Completeness] Filtering unwanted hallucinated node: ${n.id} / "${label}"`);
      return false;
    }
    
    // Keep if matches allowed patterns
    if (allowedPatterns.some(p => text.includes(p))) return true;
    
    // Keep if connected to any edge AND is a warehouse/BI tool
    if (connectedNodeIds.has(n.id) && (text.includes('warehouse') || text.includes('tableau') || text.includes('bi'))) {
      return true;
    }
    
    // Otherwise, filter it out (don't keep random orphans or hallucinations)
    debugWarn(`🚫 [Completeness] Filtering non-core node: ${n.id} / "${label}"`);
    return false;
  });
  
  debugLog('[Completeness] Orphan filter:', { 
    before: beforeOrphanFilter, 
    after: filteredNodes.length, 
    removed: beforeOrphanFilter - filteredNodes.length 
  });
  
  // DEDUPLICATION: Remove multiple "transform" type nodes - keep only ONE
  // The agent sometimes creates both "Data Transform Task" and "Data Transformation Task"
  const transformNodes = filteredNodes.filter(n => {
    const label = ((n.data as any)?.label || '').toLowerCase();
    return label.includes('transform') || label.includes('etl');
  });
  
  let finalFilteredNodes = filteredNodes;
  if (transformNodes.length > 1) {
    debugWarn(`[Completeness] Found ${transformNodes.length} transform nodes - keeping only first`);
    // Keep only the first transform node (typically 'transform_task')
    const keepTransformId = transformNodes[0].id;
    finalFilteredNodes = filteredNodes.filter(n => {
      const label = ((n.data as any)?.label || '').toLowerCase();
      if (label.includes('transform') || label.includes('etl')) {
        return n.id === keepTransformId;
      }
      return true;
    });
  }
  
  debugLog('[Completeness] Output:', { nodeCount: finalFilteredNodes.length, edgeCount: edges.length, nodeIds: finalFilteredNodes.map(n => n.id) });
  
  return { nodes: finalFilteredNodes, edges };
};

  // Handle AI generation (single shot)
  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) return;
    lastUserPromptRef.current = aiPrompt.trim(); // Store for external source detection
    setIsGenerating(true);
    try {
      const data = await callAgent(aiPrompt);
      if (data) await parseMermaidAndCreateDiagram(data.mermaidCode, data.spec);
    } catch (error) {
      console.error('AI generation error:', error);
      alert('Failed to generate diagram. Ensure PAT or backend proxy is configured.');
    } finally {
      setIsGenerating(false);
      setAiPrompt('');
    }
  };

  // Chat send handler (multi-turn)
  const handleSendChat = async () => {
    if (!chatInput.trim() || chatSending) return;
    const userMessage = chatInput.trim();
    lastUserPromptRef.current = userMessage; // Store for external source detection
    setChatSending(true);
    const history = [...chatMessages, { role: 'user' as const, text: userMessage }];
    setChatMessages(history);
    setChatInput('');

    const transcript = history
      .map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.text}`)
      .join('\n');

    // Provide current canvas state (mermaid) to the agent before the prompt
    const enrichedPrompt = `You are the SnowGram Cortex Agent. First review the existing canvas before making changes. Here is the current diagram in Mermaid (derived from the live canvas):\n\n${currentMermaid}\n\nThen continue the conversation below and apply updates based on the user's new request. If needed, adjust or refine the existing layout rather than recreating from scratch.\n\nConversation:\n${transcript}\nAgent:`;

    try {
      const data = await callAgent(enrichedPrompt);
      if (data) {
        await parseMermaidAndCreateDiagram(data.mermaidCode, data.spec);
        const reply = formatAgentReply(data);
        setChatMessages((msgs) => [...msgs, { role: 'assistant', text: reply }]);
      } else {
        setChatMessages((msgs) => [
          ...msgs,
          { role: 'assistant', text: 'I could not generate a response. Try again.' },
        ]);
      }
    } catch (err: any) {
      console.error('Chat generation error:', err);
      setChatMessages((msgs) => [
        ...msgs,
        { role: 'assistant', text: 'Error generating diagram. Please try again.' },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  const handleClearChat = () => {
    const seed = [{ role: 'assistant', text: 'Tell me what to build. I will refine the diagram and keep context.' }] as typeof chatMessages;
    setChatMessages(seed);
    setChatInput('');
  };

  // Chat drag
  const onChatDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    chatDragOffset.current = { x: e.clientX - chatPos.x, y: e.clientY - chatPos.y };
    setChatDragging(true);
  };

  useEffect(() => {
    if (!chatDragging) return;
    const onMove = (e: MouseEvent) => {
      setChatPos({ x: e.clientX - chatDragOffset.current.x, y: e.clientY - chatDragOffset.current.y });
    };
    const onUp = () => setChatDragging(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [chatDragging, setChatPos]);

  // Convert Mermaid to ReactFlow using shared component catalog
  const parseMermaidAndCreateDiagram = async (mermaidCode: string, spec?: { nodes: any[]; edges: any[]; layout?: any }) => {
    // BUG-007 FIX: Abort any previous parsing operation to prevent race conditions
    if (parseAbortControllerRef.current) {
      parseAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    parseAbortControllerRef.current = abortController;
    
    // Helper to check if this operation was aborted
    const isAborted = () => abortController.signal.aborted;
    
    if (spec?.nodes?.length) {
      // ================================================================
      // BACKEND-DRIVEN LAYOUT: Check if agent provided positions
      // If positions exist, use them directly (skip frontend layout logic)
      // This enables cleaner, more consistent diagram generation
      // Manual editing (dragging) still works after initial render
      // ================================================================
      const hasBackendPositions = spec.nodes.some((n: any) => 
        n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number'
      );
      
      if (hasBackendPositions) {
        debugLog(`[Backend Layout] Agent provided positions - using directly (manual editing preserved)`);
        // Debug: Log actual positions being used
        const positionSample = spec.nodes.slice(0, 3).map((n: any) => ({ id: n.id, pos: n.position }));
        debugLog(`[Backend Layout] Sample positions:`, positionSample);
      }
      
      // Build from spec
      let specNodes: Node[] = spec.nodes.map((n: any, idx: number) => {
        const rawType = n.componentType || n.label || 'Table';
        const nodeId = n.id || `node-${idx}`;
        const compType = normalizeBoundaryType(rawType, n.label, nodeId) || rawType;
        const isBoundary = compType.toLowerCase().startsWith('account_boundary');
        
        // Debug boundary nodes from agent
        if (isBoundary) {
          debugLog(`[Pipeline] Agent sent boundary node:`, {
            id: nodeId,
            rawType,
            compType,
            label: n.label,
            agentIcon: n.icon,
            isBoundary
          });
        }
        
        // Use backend position if available, otherwise fallback to grid
        const position = (n.position && typeof n.position.x === 'number') 
          ? { x: n.position.x, y: n.position.y }
          : { x: (idx % 4) * 260, y: Math.floor(idx / 4) * 200 };
        
        return {
          id: n.id || `node-${idx}`,
          type: 'snowflakeNode',
          data: {
            label: n.label || n.componentType || n.id,
            componentType: compType,
            icon: isBoundary ? undefined : getIconForComponentType(compType, n.label, n.flowStageOrder),
            labelColor: getLabelColor(fillColor, fillAlpha, isDarkMode),
            isDarkMode,
            showHandles: !isBoundary,
            fillColor,
            fillAlpha,
            cornerRadius,
            hideBorder,
            layer: n.layer, // Preserve layer info from backend
            flowStageOrder: n.flowStageOrder, // Preserve for ELK layout + stage coloring
            onRename: renameNode,
            onDelete: deleteNode,
            onCopy: copyNode,
          },
          position,
          style: {
            border: `2px solid ${isDarkMode ? '#4a9eff' : '#0F4C75'}`,
            borderRadius: cornerRadius,
            // Use backend-provided dimensions if available
            width: n.style?.width,
            height: n.style?.height,
            // background handled by CustomNode.tsx based on isDarkMode
            color: isDarkMode ? '#e5f2ff' : '#0F172A',
          },
        };
      });

      // Preserve agent-provided boundaries with proper IDs, strip malformed ones
      const isProperBoundary = (n: Node) => {
        const id = n.id.toLowerCase();
        const compType = ((n.data as any)?.componentType || '').toString().toLowerCase();
        // Keep boundaries with proper IDs (account_boundary_*)
        return id.startsWith('account_boundary_') && compType.startsWith('account_boundary_');
      };
      
      const beforeStripCount = specNodes.length;
      const properBoundaries = specNodes.filter(isProperBoundary);
      const nonBoundaries = specNodes.filter(n => !isProperBoundary(n) && 
        !(((n.data as any)?.componentType || '').toString().toLowerCase().startsWith('account_boundary'))
      );
      
      // Filter out nodes that are just boundary labels appearing as regular nodes
      // These are artifacts from Mermaid parsing where "AWS Account" or "Snowflake Account" 
      // become nodes instead of being recognized as boundary labels
      const boundaryLabelPatterns = ['aws account', 'snowflake account', 'azure account', 'gcp account'];
      const filteredNonBoundaries = nonBoundaries.filter(n => {
        const label = ((n.data as any)?.label || '').toLowerCase().trim();
        const isBoundaryLabel = boundaryLabelPatterns.some(p => label === p);
        if (isBoundaryLabel) {
          debugLog(`[Pipeline] Filtering out boundary-label-as-node: "${label}" (id: ${n.id})`);
        }
        return !isBoundaryLabel;
      });
      
      specNodes = [...properBoundaries, ...filteredNonBoundaries];
      const strippedCount = beforeStripCount - specNodes.length;
      if (strippedCount > 0) {
        debugLog(`[Pipeline] Stripped ${strippedCount} malformed boundary node(s) from spec`);
      }
      if (properBoundaries.length > 0) {
        debugLog(`[Pipeline] Preserved ${properBoundaries.length} agent-provided boundary node(s):`, 
          properBoundaries.map(b => b.id));
      }

      // ===========================================================================
      // FDE FIX: Remove external cloud components when user didn't ask for them
      // This is a critical guardrail - even if the agent's tools return S3/AWS/Azure,
      // we strip them out unless the user EXPLICITLY mentioned external data sources
      // ===========================================================================
      const userPrompt = lastUserPromptRef.current.toLowerCase();
      const externalKeywords = ['s3', 'aws', 'azure', 'gcp', 'kafka', 'external', 'data lake', 'cloud storage', 'ingest from', 'load from', 'pull from'];
      const userWantsExternal = externalKeywords.some(k => userPrompt.includes(k));
      
      if (!userWantsExternal) {
        const externalPatterns = ['s3', 'aws', 'snowpipe', 'pipe', 'kafka', 'azure', 'gcp', 'lake', 'external', 'ingest'];
        const beforeExtFilter = specNodes.length;
        
        specNodes = specNodes.filter(n => {
          const id = n.id.toLowerCase();
          const label = ((n.data as any)?.label || '').toLowerCase();
          const compType = ((n.data as any)?.componentType || '').toLowerCase();
          const text = `${id} ${label} ${compType}`;
          
          // Keep boundary nodes
          if (compType.startsWith('account_boundary')) return true;
          
          // Check if this is an external component
          const isExternal = externalPatterns.some(p => {
            // More precise matching to avoid false positives
            if (p === 's3') return text.includes('s3') && !text.includes('s3_bucket_used_correctly');
            if (p === 'aws') return text.includes('aws');
            if (p === 'snowpipe' || p === 'pipe') return text.includes('pipe') || text.includes('snowpipe');
            if (p === 'lake') return text.includes('lake') && !text.includes('data lakehouse');
            return text.includes(p);
          });
          
          if (isExternal) {
            debugWarn(`🚫 [FDE Filter] Removing unwanted external component: ${id} / ${label} (user prompt: "${lastUserPromptRef.current.substring(0, 50)}...")`);
            return false;
          }
          return true;
        });
        
        const extFilterCount = beforeExtFilter - specNodes.length;
        if (extFilterCount > 0) {
          debugLog(`[FDE Filter] Removed ${extFilterCount} external component(s) - user didn't request them`);
        }
        
        // Also filter out AWS-related boundaries
        specNodes = specNodes.filter(n => {
          const id = n.id.toLowerCase();
          const compType = ((n.data as any)?.componentType || '').toLowerCase();
          if (id.includes('aws') || compType.includes('aws')) {
            debugWarn(`🚫 [FDE Filter] Removing AWS boundary: ${id}`);
            return false;
          }
          return true;
        });
      } else {
        debugLog(`[FDE Filter] User requested external sources - keeping all components`);
      }
      // ===========================================================================

      const specEdges: Edge[] = (spec.edges || []).map((e: any, i: number) => ({
        id: `${e.source || 's'}-${e.target || 't'}-${i}`,
        source: e.source,
        target: e.target,
        type: 'straight',  // Direct line between handles (no routing kinks)
        animated: true,
        sourceHandle: e.sourceHandle || 'right-source',
        targetHandle: e.targetHandle || 'left-target',
        style: { stroke: isDarkMode ? '#60A5FA' : '#29B5E8', strokeWidth: 2.5 },  // Phase 3: Increased strokeWidth,
        deletable: true,
      }));

      // AGENT-FIRST: Trust the agent output - frontend is a pure renderer
      // Previously: ensureMedallionCompleteness manipulated nodes/edges
      // Now: Pass through as-is, let agent control content
      debugLog('[Pipeline] Agent-first mode: trusting agent output (no ensureMedallionCompleteness)');
      const cleanedSpecEdges = specEdges.map((e) => ({
        ...e,
        sourceHandle: e.sourceHandle || 'right-source',
        targetHandle: e.targetHandle || 'left-target',
        type: 'straight',  // Direct line between handles (no routing kinks)
      }));

      // Add icons to ALL nodes AFTER completeness (including newly created medallion nodes)
      // BUT skip icons for boundary nodes
      specNodes = specNodes.map((n) => {
        const rawType = ((n.data as any)?.componentType || '').toString();
        const normalizedType = normalizeBoundaryType(rawType, (n.data as any)?.label, n.id) || rawType;
        const isBoundary = normalizedType.toLowerCase().startsWith('account_boundary');
        const base = {
          ...n,
          data: {
            ...(n.data as any),
            componentType: normalizedType,
            icon: isBoundary ? undefined : getIconForComponentType(normalizedType, (n.data as any)?.label, (n.data as any)?.flowStageOrder),
            showHandles: isBoundary ? false : (n.data as any)?.showHandles,
            onRename: renameNode,
            onDelete: deleteNode,
            onCopy: copyNode,
          },
        };
        return isBoundary ? ensureBoundaryStyle(base, isDarkMode) : base;
      });

      // Separate boundaries from regular nodes before layout
      // Boundaries stay as-is from agent, regular nodes go through layout
      // Filter out agent boundary nodes — they have placeholder positions.
      // addAccountBoundaries will create properly positioned boundaries after ELK layout.
      specNodes = specNodes.filter((n) => {
        const compType = ((n.data as any)?.componentType || '').toString().toLowerCase();
        return !compType.startsWith('account_boundary_');
      });
      debugLog(`[Pipeline] Filtered agent boundaries, ${specNodes.length} nodes for layout`);

      // ================================================================
      // STAGE-BASED GRID LAYOUT: Groups nodes by flowStageOrder into
      // neat rows and columns. Wraps long pipelines into multiple rows.
      // Manual dragging still works after render (ReactFlow handles it)
      // ================================================================
      let laidOut: { nodes: Node[]; edges: Edge[] };
      
      // Always use grid layout — agent positions are simplistic grid hints.
      // Stage-based layout produces neat rows/columns using flowStageOrder values.
      debugLog(`[Layout] Using stage-based grid for automatic positioning`);
      
      // Enrich nodes with flowStageOrder if not provided by agent
      const enrichedNodes = enrichNodesWithFlowOrder(specNodes);
      
      try {
        const elkResult = await layoutWithELK(enrichedNodes, cleanedSpecEdges);
        laidOut = elkResult;
        debugLog(`[Layout] Positioned ${elkResult.nodes.length} nodes, ${elkResult.edges.length} edges`);
        if (elkResult.edges.length !== cleanedSpecEdges.length) {
          debugWarn(`[Layout] Edge count changed: ${cleanedSpecEdges.length} → ${elkResult.edges.length}`);
        }
      } catch (elkError) {
        debugWarn(`[Layout] Error, falling back to deterministic:`, elkError);
        // Fallback to existing layout if ELK fails
        laidOut = isMedallion(specNodes)
          ? layoutMedallionDeterministic(specNodes)
          : { nodes: layoutNodes(specNodes, cleanedSpecEdges), edges: cleanedSpecEdges };
      }
      // Always auto-create boundaries from node keywords.
      // Agent boundaries have placeholder positions {x:0, y:0} — addAccountBoundaries
      // produces properly positioned/sized boundaries with external nodes (Kafka/AWS)
      // placed OUTSIDE the Snowflake boundary.
      const withBoundaries = addAccountBoundaries(laidOut.nodes);
      debugLog(`[Pipeline] After boundaries: ${withBoundaries.length} nodes`);
      const fitted = fitCspNodesIntoBoundaries(withBoundaries);
      debugLog(`[Pipeline] After fitting: ${fitted.length} nodes`);
      const normalizedFinal = normalizeGraph(fitted, laidOut.edges);
      debugLog(`[Pipeline] After normalize: ${normalizedFinal.nodes.length} nodes, ${normalizedFinal.edges.length} edges`);
      if (normalizedFinal.edges.length !== laidOut.edges.length) {
        debugWarn(`[Pipeline] Edge loss in normalizeGraph: ${laidOut.edges.length} → ${normalizedFinal.edges.length}`);
      }
      const enforcedBoundaries = enforceAccountBoundaries(normalizedFinal.nodes, normalizedFinal.edges, isDarkMode);
      debugLog(`[Pipeline] After enforce: ${enforcedBoundaries.nodes.length} nodes, ${enforcedBoundaries.edges.length} edges`);
      if (enforcedBoundaries.edges.length !== normalizedFinal.edges.length) {
        debugWarn(`[Pipeline] Edge loss in enforceAccountBoundaries: ${normalizedFinal.edges.length} → ${enforcedBoundaries.edges.length}`);
      }
      
      // CRITICAL: Enforce consistent node sizes for handle alignment
      // All non-boundary nodes must have identical dimensions
      const STANDARD_NODE_WIDTH = 150;
      const STANDARD_NODE_HEIGHT = 130;
      
      const normalizedNodesWithSize = enforcedBoundaries.nodes.map(n => {
        const isBoundary = ((n.data as any)?.componentType || '').toLowerCase().startsWith('account_boundary');
        if (isBoundary) return n; // Keep boundary sizes as-is
        
        // Phase 5: Apply flowStageOrder-based coloring
        const flowStage = (n.data as any)?.flowStageOrder;
        const stageColor = getStageColor(flowStage, isDarkMode);
        
        return {
          ...n,
          style: {
            ...(n.style || {}),
            width: STANDARD_NODE_WIDTH,
            height: STANDARD_NODE_HEIGHT,
            // Apply stage-based colors (overrides previous styling)
            border: `2px solid ${stageColor.border}`,
            background: stageColor.background,
          },
        };
      });
      
      const nodeMap = new Map<string, Node>(normalizedNodesWithSize.map(n => [n.id, n]));
      
      const pickHandle = (fromId: string, toId: string) => {
        const from = nodeMap.get(fromId);
        const to = nodeMap.get(toId);
        if (!from || !to) {
          return { sourceHandle: 'right-source', targetHandle: 'left-target' };
        }
        const { width: w1, height: h1 } = getNodeSize(from);
        const { width: w2, height: h2 } = getNodeSize(to);
        const c1 = { x: from.position.x + w1 / 2, y: from.position.y + h1 / 2 };
        const c2 = { x: to.position.x + w2 / 2, y: to.position.y + h2 / 2 };
        const dx = c2.x - c1.x;
        const dy = c2.y - c1.y;

        // FIXED: Use magnitude comparison instead of absolute threshold
        // This matches the logic in layoutMedallionDeterministic.makeEdge
        // and prevents diagonal edges in grid layouts
        
        // If vertical distance is GREATER than horizontal → vertical flow
        if (Math.abs(dy) > Math.abs(dx)) {
          return {
            sourceHandle: dy >= 0 ? 'bottom-source' : 'top-source',
            targetHandle: dy >= 0 ? 'top-target' : 'bottom-target',
          };
        }
        
        // Otherwise (horizontal distance >= vertical) → horizontal flow
        return {
          sourceHandle: dx >= 0 ? 'right-source' : 'left-source',
          targetHandle: dx >= 0 ? 'left-target' : 'right-target',
        };
      };

      let finalEdges = enforcedBoundaries.edges.map((e) => {
        // PRESERVE handles from ELK layout if they exist
        // Only use pickHandle as fallback for edges without handles
        const hasExistingHandles = e.sourceHandle && e.targetHandle;
        const handles = hasExistingHandles 
          ? { sourceHandle: e.sourceHandle, targetHandle: e.targetHandle }
          : pickHandle(e.source, e.target);
        
        // Use 'step' edges — right-angle orthogonal routing with sharp corners.
        // 'smoothstep' rounds corners; 'straight' draws diagonals.
        const edgeType = 'step';
        
        return {
          ...e,
          ...handles,
          type: edgeType,
          animated: true,
          style: { stroke: isDarkMode ? '#60A5FA' : '#29B5E8', strokeWidth: 2.5 },
        };
      });
      let finalNodes = normalizedNodesWithSize
        .map((n) =>
          ensureBoundaryStyle(
            n,
            (n.data as any)?.isDarkMode ?? isDarkMode
          )
        )
        .map(applyThemeToNode);
      
      // Debug final nodes before rendering
      const boundaries = finalNodes.filter(n => 
        ((n.data as any)?.componentType || '').toLowerCase().startsWith('account_boundary')
      );
      const snowflakeLabeled = finalNodes.filter(n =>
        ((n.data as any)?.label || '').toLowerCase().includes('snowflake account')
      );
      debugLog(`[Pipeline] Final nodes to render: ${finalNodes.length} total, ${boundaries.length} boundaries, ${snowflakeLabeled.length} with 'Snowflake Account' label`);
      boundaries.forEach(b => {
        debugLog(`[Pipeline] Final boundary ${b.id}:`, {
          componentType: (b.data as any)?.componentType,
          icon: (b.data as any)?.icon,
          label: (b.data as any)?.label,
          showHandles: (b.data as any)?.showHandles,
          styleBorder: (b.style as any)?.border,
          styleBackground: (b.style as any)?.background
        });
      });
      if (snowflakeLabeled.length > 1) {
        debugWarn(`[Pipeline] ⚠️ Multiple nodes with 'Snowflake Account' label detected:`);
        snowflakeLabeled.forEach(n => {
          debugLog(`  - ${n.id}: componentType="${(n.data as any)?.componentType}", icon=${(n.data as any)?.icon ? 'YES' : 'NO'}`);
        });
      }
      
      // =============================================================================
      // FINAL FDE GUARDRAIL: Strip AWS/external components if user didn't request them
      // This is the LAST line of defense before rendering - catches any components
      // that slipped through previous filters (agent hallucinations, completeness logic, etc.)
      // =============================================================================
      const userPromptFinal = lastUserPromptRef.current.toLowerCase();
      const externalKeywordsFinal = ['s3', 'aws', 'azure', 'gcp', 'kafka', 'external', 'data lake', 'cloud storage', 'ingest from', 'load from', 'pull from'];
      const userWantsExternalFinal = externalKeywordsFinal.some(k => userPromptFinal.includes(k));
      
      if (!userWantsExternalFinal) {
        const beforeFinalFilter = finalNodes.length;
        finalNodes = finalNodes.filter(n => {
          const id = n.id.toLowerCase();
          const label = ((n.data as any)?.label || '').toLowerCase();
          const compType = ((n.data as any)?.componentType || '').toLowerCase();
          
          // Remove AWS/S3/Snowpipe related nodes
          if (id === 's3' || id === 'pipe1' || id === 'snowpipe' ||
              label.includes('s3 data lake') || label === 'snowpipe' ||
              compType === 's3' || compType === 'snowpipe' ||
              compType.includes('account_boundary_aws') || id.includes('aws')) {
            debugWarn(`🚫 [FINAL GUARDRAIL] Removing: ${id} / ${label}`);
            return false;
          }
          return true;
        });
        
        // Also remove edges that reference removed nodes
        const validNodeIds = new Set(finalNodes.map(n => n.id));
        const beforeEdgeFilter = finalEdges.length;
        finalEdges = finalEdges.filter(e => validNodeIds.has(e.source) && validNodeIds.has(e.target));
        
        if (beforeFinalFilter !== finalNodes.length || beforeEdgeFilter !== finalEdges.length) {
          debugLog(`[FINAL GUARDRAIL] Removed ${beforeFinalFilter - finalNodes.length} nodes, ${beforeEdgeFilter - finalEdges.length} edges`);
        }
      }
      // =============================================================================
      
      // BUG-007 FIX: Check if aborted before state updates
      if (isAborted()) {
        debugLog('[Pipeline] Parsing aborted - skipping state update');
        return;
      }
      
      debugLog(`[Pipeline] Final render: ${finalNodes.length} nodes, ${finalEdges.length} edges`);
      setNodes(finalNodes);
      setEdges(finalEdges);
      return;
    }

    const { nodes: newNodes, edges: newEdges } = convertMermaidToFlow(
      mermaidCode,
      COMPONENT_CATEGORIES,
      isDarkMode
    );
    debugLog(`[Pipeline] After mermaid parse: ${newNodes.length} nodes, ${newEdges.length} edges`);
    // Ensure medallion completeness FIRST (before normalization to preserve edges)
    const nonBoundaryNodes = newNodes.filter(
      (n) => !(((n.data as any)?.componentType || '').toString().toLowerCase().startsWith('account_boundary'))
    );
    const completed = ensureMedallionCompleteness(nonBoundaryNodes, newEdges);
    debugLog(`[Pipeline] After completeness: ${completed.nodes.length} nodes, ${completed.edges.length} edges`);
    const nodeMap = new Map<string, Node>(completed.nodes.map(n => [n.id, n]));
    const pickHandle = (fromId: string, toId: string) => {
      const from = nodeMap.get(fromId);
      const to = nodeMap.get(toId);
      if (!from || !to) {
        return { sourceHandle: 'right-source', targetHandle: 'left-target' };
      }
      const { width: w1, height: h1 } = getNodeSize(from);
      const { width: w2, height: h2 } = getNodeSize(to);
      const c1 = { x: from.position.x + w1 / 2, y: from.position.y + h1 / 2 };
      const c2 = { x: to.position.x + w2 / 2, y: to.position.y + h2 / 2 };
      const dx = c2.x - c1.x;
      const dy = c2.y - c1.y;

      // For medallion architectures: ALWAYS prefer vertical handles if there's ANY vertical distance
      // This prevents horizontal handle selection that routes edges off-canvas
      if (Math.abs(dy) > 20) {
        // There's meaningful vertical distance - use vertical handles
        return {
          sourceHandle: dy >= 0 ? 'bottom-source' : 'top-source',
          targetHandle: dy >= 0 ? 'top-target' : 'bottom-target',
        };
      }
      
      // Only use horizontal handles if nodes are on the same horizontal level
      return {
        sourceHandle: dx >= 0 ? 'right-source' : 'left-source',
        targetHandle: dx >= 0 ? 'left-target' : 'right-target',
      };
    };

    const completedEdges = completed.edges.map((e) => {
      // Pick handles based purely on alignment
      const handles = pickHandle(e.source, e.target);
      
      // Use 'straight' for direct lines between handles (no routing kinks)
      const edgeType = 'straight';
      
      return {
        ...e,
        ...handles,
        type: edgeType,
        animated: true,
        style: { stroke: isDarkMode ? '#60A5FA' : '#29B5E8', strokeWidth: 2.5 },  // Phase 3: Increased strokeWidth
      };
    });
    // Add icons to ALL nodes AFTER completeness (including newly created medallion nodes)
    const nodesWithIcons = completed.nodes.map((n) => {
      const rawType = ((n.data as any)?.componentType || '').toString();
      const normalizedType = normalizeBoundaryType(rawType, (n.data as any)?.label, n.id) || rawType;
      const isBoundary = normalizedType.toLowerCase().startsWith('account_boundary');
      const base = {
        ...n,
        data: {
          ...(n.data as any),
          componentType: normalizedType,
          icon: isBoundary ? undefined : getIconForComponentType(normalizedType, (n.data as any)?.label, (n.data as any)?.flowStageOrder),
          showHandles: isBoundary ? false : (n.data as any)?.showHandles,
          onRename: renameNode,
          onDelete: deleteNode,
          onCopy: copyNode,
        },
      };
      return isBoundary ? ensureBoundaryStyle(base, isDarkMode) : applyThemeToNode(base);
    });
    // Separate boundaries from regular nodes before layout
    const mermaidBoundariesRaw = nodesWithIcons.filter((n) => {
      const id = n.id.toLowerCase();
      const compType = ((n.data as any)?.componentType || '').toString().toLowerCase();
      return id.startsWith('account_boundary_') && compType.startsWith('account_boundary_');
    });
    // Ensure boundaries are properly styled with no icons
    const mermaidBoundaries = mermaidBoundariesRaw.map(b => {
      const styled = ensureBoundaryStyle(b, isDarkMode);
      debugLog(`[Pipeline] Mermaid boundary ${b.id} icon:`, (styled.data as any)?.icon, 'showHandles:', (styled.data as any)?.showHandles);
      return styled;
    });
    const finalNodes = nodesWithIcons.filter((n) => {
      const id = n.id.toLowerCase();
      const compType = ((n.data as any)?.componentType || '').toString().toLowerCase();
      return !(id.startsWith('account_boundary_') && compType.startsWith('account_boundary_'));
    });
    if (mermaidBoundaries.length > 0) {
      debugLog(`[Pipeline] Preserved ${mermaidBoundaries.length} agent boundaries from mermaid:`, 
        mermaidBoundaries.map(b => b.id));
    }
    debugLog(`[Pipeline] After separating boundaries (mermaid): ${finalNodes.length} nodes for layout`);

    const laidOut = isMedallion(finalNodes)
      ? layoutMedallionDeterministic(finalNodes)
      : { nodes: layoutNodes(finalNodes, completedEdges), edges: completedEdges };
    debugLog(`[Pipeline] After layout: ${laidOut.nodes.length} nodes`);
    // Add back agent-provided boundaries before addAccountBoundaries
    const nodesWithMermaidBoundaries = [...mermaidBoundaries, ...laidOut.nodes];
    debugLog(`[Pipeline] After layout + mermaid boundaries: ${nodesWithMermaidBoundaries.length} nodes (${mermaidBoundaries.length} from agent)`);
    const withBoundaries = addAccountBoundaries(nodesWithMermaidBoundaries);
    debugLog(`[Pipeline] After boundaries: ${withBoundaries.length} nodes`);
    const fitted = fitCspNodesIntoBoundaries(withBoundaries);
    debugLog(`[Pipeline] After fitting: ${fitted.length} nodes`);
    const normalizedFinal = normalizeGraph(fitted, laidOut.edges);
    debugLog(`[Pipeline] After normalize (FINAL): ${normalizedFinal.nodes.length} nodes, ${normalizedFinal.edges.length} edges`);
    const enforcedBoundaries = enforceAccountBoundaries(normalizedFinal.nodes, normalizedFinal.edges, isDarkMode);
    
    // CRITICAL: Enforce consistent node sizes for handle alignment (Mermaid path)
    // All non-boundary nodes must have identical dimensions
    const STANDARD_WIDTH_MERMAID = 150;
    const STANDARD_HEIGHT_MERMAID = 130;
    
    // Enrich mermaid nodes with flowStageOrder for consistent coloring
    const enrichedMermaidNodes = enrichNodesWithFlowOrder(enforcedBoundaries.nodes);
    
    const normalizedNodesWithSizeMermaid = enrichedMermaidNodes.map(n => {
      const isBoundary = ((n.data as any)?.componentType || '').toLowerCase().startsWith('account_boundary');
      if (isBoundary) return n; // Keep boundary sizes as-is
      
      // Phase 5: Apply flowStageOrder-based coloring (Mermaid path)
      const flowStage = (n.data as any)?.flowStageOrder;
      const stageColor = getStageColor(flowStage, isDarkMode);
      
      return {
        ...n,
        style: {
          ...(n.style || {}),
          width: STANDARD_WIDTH_MERMAID,
          height: STANDARD_HEIGHT_MERMAID,
          // Apply stage-based colors
          border: `2px solid ${stageColor.border}`,
          background: stageColor.background,
        },
      };
    });
    
    const finalNodesWithStyle = normalizedNodesWithSizeMermaid.map((n) =>
      ensureBoundaryStyle(
        n,
        (n.data as any)?.isDarkMode ?? isDarkMode
      )
    );
    const finalEdges = enforcedBoundaries.edges.map((e) => ({
      ...e,
      sourceHandle: e.sourceHandle || 'right-source',
      targetHandle: e.targetHandle || 'left-target',
      type: 'straight',  // Direct line between handles (no routing kinks)
      animated: true,
      style: { stroke: isDarkMode ? '#60A5FA' : '#29B5E8', strokeWidth: 2.5 },  // Phase 3: Increased strokeWidth,
    }));
    
    // =============================================================================
    // FINAL FDE GUARDRAIL (Mermaid Path): Strip AWS/external components
    // =============================================================================
    const userPromptFinal2 = lastUserPromptRef.current.toLowerCase();
    const externalKeywordsFinal2 = ['s3', 'aws', 'azure', 'gcp', 'kafka', 'external', 'data lake', 'cloud storage', 'ingest from', 'load from', 'pull from'];
    const userWantsExternalFinal2 = externalKeywordsFinal2.some(k => userPromptFinal2.includes(k));
    
    let filteredNodesWithStyle = finalNodesWithStyle;
    let filteredEdges = finalEdges;
    
    if (!userWantsExternalFinal2) {
      const beforeFinalFilter2 = filteredNodesWithStyle.length;
      filteredNodesWithStyle = filteredNodesWithStyle.filter(n => {
        const id = n.id.toLowerCase();
        const label = ((n.data as any)?.label || '').toLowerCase();
        const compType = ((n.data as any)?.componentType || '').toLowerCase();
        
        if (id === 's3' || id === 'pipe1' || id === 'snowpipe' ||
            label.includes('s3 data lake') || label === 'snowpipe' ||
            compType === 's3' || compType === 'snowpipe' ||
            compType.includes('account_boundary_aws') || id.includes('aws')) {
          debugWarn(`🚫 [FINAL GUARDRAIL 2] Removing: ${id} / ${label}`);
          return false;
        }
        return true;
      });
      
      const validNodeIds2 = new Set(filteredNodesWithStyle.map(n => n.id));
      filteredEdges = filteredEdges.filter(e => validNodeIds2.has(e.source) && validNodeIds2.has(e.target));
      
      if (beforeFinalFilter2 !== filteredNodesWithStyle.length) {
        debugLog(`[FINAL GUARDRAIL 2] Removed ${beforeFinalFilter2 - filteredNodesWithStyle.length} unwanted nodes`);
      }
    }
    // =============================================================================
    
    // BUG-007 FIX: Check if aborted before state updates (Mermaid path)
    if (isAborted()) {
      debugLog('[Pipeline] Parsing aborted (Mermaid path) - skipping state update');
      return;
    }
    
    setNodes(filteredNodesWithStyle);
    setEdges(filteredEdges);
  };

  return (
    <div className={`${styles.container} ${isDarkMode ? styles.darkMode : ''}`}>
      {/* Left Sidebar - Component Palette */}
      <div className={styles.sidebar}>
        <div className={styles.header}>
          <div className={styles.headerContent}>
            <div className={styles.logoContainer}>
              <img
                src="/icons/Snowflake_ICON_Cortex.svg"
                alt="SnowGram"
                className={styles.logo}
              />
              <div>
                <h1 className={styles.title}>SnowGram</h1>
                <p className={styles.subtitle}>Architecture Builder</p>
              </div>
            </div>
            
            {/* NEW: Dark Mode Toggle */}
            <button
              className={styles.themeToggle}
              onClick={() => setIsDarkMode(!isDarkMode)}
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDarkMode ? (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="4" fill="currentColor"/>
                  <path d="M10 1V3M10 17V19M19 10H17M3 10H1M16.364 3.636L14.95 5.05M5.05 14.95L3.636 16.364M16.364 16.364L14.95 14.95M5.05 5.05L3.636 3.636" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" fill="currentColor"/>
                </svg>
              )}
            </button>
          </div>
          
          {/* NEW: Search + Collapse/Expand Row */}
          <div className={styles.searchRow}>
            <div className={styles.searchContainer}>
              <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M7 13A6 6 0 1 0 7 1a6 6 0 0 0 0 12zM15 15l-3.35-3.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search components..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search components"
              />
              {searchQuery && (
                <button
                  className={styles.searchClear}
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
            <button
              className={styles.collapseIconButton}
              onClick={allExpanded ? collapseAll : expandAll}
              title={allExpanded ? 'Collapse All Categories' : 'Expand All Categories'}
              aria-label={allExpanded ? 'Collapse All Categories' : 'Expand All Categories'}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 14 14"
                fill="none"
                className={styles.expandChevron}
                style={{
                  transform: allExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease',
                }}
              >
                <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className={styles.componentPalette}>
          {Object.entries(COMPONENT_CATEGORIES).map(([category, components]) => {
            const isCollapsed = collapsedCategories.has(category);
            const filteredComponents = filterComponents(components, searchQuery);
            
            // Skip category if no matches in search
            if (searchQuery && filteredComponents.length === 0) return null;
            
            return (
              <div key={category} className={styles.paletteSection}>
                {/* Collapsible Category Header */}
                <div 
                  className={styles.sectionHeader}
                  onClick={() => toggleCategory(category)}
                >
                  <span className={styles.collapseIcon}>
                    {isCollapsed ? '▶' : '▼'}
                  </span>
                  <h3 className={styles.sectionTitle}>{category}</h3>
                </div>
                
                {/* Component grid with smooth collapse animation */}
                <div 
                  className={styles.componentGrid}
                  data-collapsed={isCollapsed ? 'true' : 'false'}
                >
                  {filteredComponents.map((component) => (
                    <div
                      key={component.id}
                      className={styles.componentCard}
                      draggable
                      onDragStart={(e) => onDragStart(e, component)}
                      onDragEnd={onDragEnd}
                      tabIndex={0}
                      role="button"
                      aria-label={`Drag ${component.name} component to canvas`}
                    >
                      <img
                        src={component.icon}
                        alt={component.name}
                          className={styles.componentIcon}
                        />
                        <div className={styles.componentName}>{component.name}</div>
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
          
          {/* No results message */}
          {searchQuery && Object.values(COMPONENT_CATEGORIES).every(components => 
            filterComponents(components, searchQuery).length === 0
          ) && (
            <div className={styles.noResults}>
              <p>No components found for "{searchQuery}"</p>
              <button onClick={() => setSearchQuery('')} className={styles.clearSearchBtn}>
                Clear search
              </button>
            </div>
          )}
        </div>

        <div className={styles.aiSection} />
      </div>

      {/* Right Canvas - Diagram Builder with ReactFlow */}
      <div className={styles.canvas} ref={reactFlowWrapper}>
        <ReactFlow
          style={{ background: isDarkMode ? '#0F172A' : '#F8FAFC' }}
          nodes={nodes}
          edges={edges.map(edge => {
            const isSelected = selectedEdges.some(e => e.id === edge.id);
            const isReversed = edge.data?.animationDirection === 'reverse';
            const baseStroke = edge.style?.stroke || (isDarkMode ? '#FFFFFF' : '#29B5E8');
            const glowColor = isDarkMode ? '255,255,255' : '41,181,232';
            return {
              ...edge,
              // Highlight selected edges with strong yellow/orange glow
              selected: isSelected,
              className: isReversed ? 'edge-reversed' : '',
              style: {
                ...edge.style,
                stroke: isSelected ? (isDarkMode ? '#FFFFFF' : '#29B5E8') : baseStroke,
                strokeWidth: isSelected ? 4 : 2, // Thicker for more visibility
                filter: isSelected 
                  ? `drop-shadow(0 0 4px rgba(${glowColor},0.85)) drop-shadow(0 0 10px rgba(${glowColor},0.65)) drop-shadow(0 0 16px rgba(${glowColor},0.5))`
                  : `drop-shadow(0 0 3px rgba(${glowColor},0.55)) drop-shadow(0 0 8px rgba(${glowColor},0.35))`,
              }
            };
          })}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onNodeContextMenu={onNodeContextMenu}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeDragStop={onNodeDragStop}
          onInit={setReactFlowInstance}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          isValidConnection={() => true}
          fitView
        proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
          selectNodesOnDrag={false}
          multiSelectionKeyCode="Shift"
          defaultEdgeOptions={{
            type: 'straight',  // Direct line between handles (no routing kinks)
            animated: true,
        style: { stroke: isDarkMode ? '#FFFFFF' : '#29B5E8', strokeWidth: 2.5 },  // Phase 3: Increased strokeWidth,
            deletable: true,
          }}
          onMove={onMove}
        >
          <Background 
            color={isDarkMode ? '#374151' : '#e5e7eb'} 
            gap={16}
            style={{ backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }}
          />
          <Controls className={styles.controls} />
          <MiniMap
            className={styles.minimap}
            nodeColor={(node) => '#29B5E8'}
            maskColor={isDarkMode ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.1)'}
            style={{ backgroundColor: isDarkMode ? '#374151' : '#f9fafb' }}
          />
          
          {/* Top Panel with Actions */}
          <Panel position="top-right" className={styles.panelActions}>
            <button className={`${styles.actionButton} ${styles.actionButtonClear}`} onClick={handleClear}>
              <img src="/icons/Snowflake_ICON_No.svg" alt="Clear" className={styles.btnIcon} />
              Clear
            </button>
            <button className={`${styles.actionButton} ${styles.actionButtonExport}`} onClick={() => setShowExportModal(true)}>
              <img src="/icons/download.svg" alt="Export" className={styles.btnIcon} />
              Export
            </button>
          </Panel>

          {/* Style controls (fill, alpha, corners) for selected nodes */}
          {stylePanelPos && (
            <div
              className={styles.boundaryPanel}
              style={{
                left: stylePanelPos.x,
                top: stylePanelPos.y,
                transform: 'translate(-50%, -100%)'
              }}
            >
              <div className={styles.styleGroupRow}>
                <img src="/icons/format_color_fill.svg" alt="Fill color" className={styles.iconLabelImg} />
              <input
                type="color"
                value={fillColor}
                onChange={(e) => {
                  const newColor = e.target.value;
                  setFillColor(newColor);
                  const { r, g, b } = hexToRgbUtil(newColor) || { r: 41, g: 181, b: 232 };
                  const labelColor = getLabelColor(newColor, fillAlpha, isDarkMode);
                  setNodes((nds) =>
                    nds.map((n) => {
                      if (n.selected) {
                        const hideBorder = (n.data as any)?.hideBorder;
                        const isBoundary = (n.data as any)?.componentType?.startsWith('account_boundary');
                        const boundaryColors: Record<string, string> = {
                          account_boundary_snowflake: '#29B5E8',
                          account_boundary_aws: '#FF9900',
                          account_boundary_azure: '#0089D6',
                          account_boundary_gcp: '#4285F4',
                        };
                        const boundaryColor = boundaryColors[(n.data as any)?.componentType] || '#94A3B8';
                        const borderStyle = hideBorder
                          ? 'none'
                          : isBoundary
                            ? `2px dashed ${boundaryColor}`
                            : `2px solid ${newColor}`;
                        return {
                          ...n,
                          style: {
                            ...(n.style || {}),
                            background: `rgba(${r},${g},${b},${fillAlpha})`,
                            border: borderStyle,
                            color: labelColor,
                          },
                          data: {
                            ...(n.data || {}),
                            background: `rgba(${r},${g},${b},${fillAlpha})`,
                            fillColor: newColor,
                            fillAlpha: fillAlpha,
                            cornerRadius: cornerRadius,
                            labelColor,
                          },
                        };
                      }
                      return n;
                    })
                  );
                }}
                className={styles.boundaryColor}
                style={{
                  borderColor: fillColor,
                  boxShadow: `inset 0 1px 2px rgba(0,0,0,0.25)`
                }}
                aria-label="Boundary color"
              />
              </div>
              <div className={styles.styleGroupRow}>
                <img src="/icons/contrast.svg" alt="Fill alpha / opacity" className={styles.iconLabelImg} />
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(fillAlpha * 100)}
                onChange={(e) => {
                  const val = Number(e.target.value) / 100;
                  setFillAlpha(val);
                  // apply to selected nodes
                  setNodes((nds) =>
                    nds.map((n) => {
                      if (n.selected) {
                        const { r, g, b } = hexToRgbUtil(fillColor) || { r: 41, g: 181, b: 232 };
                        const hideBorder = (n.data as any)?.hideBorder;
                        const isBoundary = (n.data as any)?.componentType?.startsWith('account_boundary');
                        const boundaryColors: Record<string, string> = {
                          account_boundary_snowflake: '#29B5E8',
                          account_boundary_aws: '#FF9900',
                          account_boundary_azure: '#0089D6',
                          account_boundary_gcp: '#4285F4',
                        };
                        const boundaryColor = boundaryColors[(n.data as any)?.componentType] || '#94A3B8';
                        const borderStyle = hideBorder
                          ? 'none'
                          : isBoundary
                            ? `2px dashed ${boundaryColor}`
                            : `2px solid ${(n.data as any)?.fillColor || '#29B5E8'}`;
                        const labelColor = getLabelColor(fillColor, val, isDarkMode);
                        return {
                          ...n,
                          style: {
                            ...(n.style || {}),
                            background: `rgba(${r},${g},${b},${val})`,
                            border: borderStyle,
                            color: labelColor,
                          },
                          data: {
                            ...(n.data || {}),
                            background: `rgba(${r},${g},${b},${val})`,
                            fillColor: fillColor,
                            fillAlpha: val,
                            cornerRadius: cornerRadius,
                            labelColor,
                          },
                        };
                      }
                      return n;
                    })
                  );
                }}
                className={styles.boundarySlider}
                style={{
                  accentColor: fillColor,
                  background: `linear-gradient(90deg, ${fillColor} 0%, ${fillColor} ${Math.round(fillAlpha * 100)}%, #4B5563 ${Math.round(fillAlpha * 100)}%, #4B5563 100%)`,
                  '--thumb-color': fillColor,
                } as React.CSSProperties}
                aria-label="Boundary fill alpha"
              />
              </div>

              {/* Border visibility toggle */}
              <div className={styles.styleGroupRow}>
                <button
                  className={`${styles.boundaryToggle} ${ (nodes.find((n) => n.selected)?.data as any)?.hideBorder ? styles.boundaryToggleGreen : styles.boundaryToggleBlue}`}
                  onClick={() => {
                    setNodes((nds) =>
                      nds.map((n) => {
                        if (n.selected) {
                          const isBoundary = (n.data as any)?.componentType?.startsWith('account_boundary');
                          const hideBorder = !(n.data as any)?.hideBorder;
                          const boundaryColors: Record<string, string> = {
                            account_boundary_snowflake: '#29B5E8',
                            account_boundary_aws: '#FF9900',
                            account_boundary_azure: '#0089D6',
                            account_boundary_gcp: '#4285F4',
                          };
                          const boundaryColor = boundaryColors[(n.data as any)?.componentType] || '#94A3B8';
                          const borderStyle = hideBorder
                            ? 'none'
                            : isBoundary
                              ? `2px dashed ${boundaryColor}`
                              : `2px solid ${(n.data as any)?.fillColor || '#29B5E8'}`;
                          return {
                            ...n,
                            style: {
                              ...(n.style || {}),
                              border: borderStyle,
                            },
                            data: {
                              ...(n.data || {}),
                              hideBorder,
                            },
                          };
                        }
                        return n;
                      })
                    );
                  }}
                  title={(nodes.find((n) => n.selected)?.data as any)?.hideBorder ? 'Show border' : 'Hide border'}
                  aria-label={(nodes.find((n) => n.selected)?.data as any)?.hideBorder ? 'Show border' : 'Hide border'}
                >
                  {(nodes.find((n) => n.selected)?.data as any)?.hideBorder ? (
                    <img src="/icons/visibility_off.svg" alt="Border hidden" className={styles.iconLabelImg} />
                  ) : (
                    <img src="/icons/visibility.svg" alt="Border visible" className={styles.iconLabelImg} />
                  )}
                </button>
              </div>

              <div className={styles.styleGroupRow}>
              <button
                  className={`${styles.boundaryToggle} ${cornerRadius > 0 ? styles.boundaryToggleGreen : styles.boundaryToggleBlue}`}
                onClick={() => {
                    const nextRadius = cornerRadius > 0 ? 0 : 10;
                  setCornerRadius(nextRadius);
                  setNodes((nds) =>
                    nds.map((n) => {
                      if (n.selected) {
                        const isBoundary = (n.data as any)?.componentType?.startsWith('account_boundary');
                        const hideBorder = (n.data as any)?.hideBorder;
                        const boundaryColors: Record<string, string> = {
                          account_boundary_snowflake: '#29B5E8',
                          account_boundary_aws: '#FF9900',
                          account_boundary_azure: '#0089D6',
                          account_boundary_gcp: '#4285F4',
                        };
                        const boundaryColor = boundaryColors[(n.data as any)?.componentType] || '#94A3B8';
                        const borderStyle = hideBorder
                          ? 'none'
                          : isBoundary
                            ? `2px dashed ${boundaryColor}`
                            : `2px solid ${(n.data as any)?.fillColor || '#29B5E8'}`;
                        return {
                          ...n,
                          style: {
                            ...(n.style || {}),
                            borderRadius: nextRadius,
                            border: borderStyle,
                          },
                          data: {
                            ...(n.data || {}),
                            cornerRadius: nextRadius,
                            borderRadius: nextRadius,
                          },
                        };
                      }
                      return n;
                    })
                  );
                }}
                  aria-label={cornerRadius > 0 ? 'Use sharp corners' : 'Use rounded corners'}
                  title={cornerRadius > 0 ? 'Use sharp corners' : 'Use rounded corners'}
              >
                  {cornerRadius > 0 ? (
                    <img src="/icons/trip_origin.svg" alt="Rounded corners" className={styles.iconLabelImg} />
                ) : (
                    <img src="/icons/crop_square.svg" alt="Sharp corners" className={styles.iconLabelImg} />
                )}
              </button>
              </div>

              <div className={styles.layerInline}>
                <button className={styles.layerIconButton} onClick={bringToFront} title="Bring to Front" aria-label="Bring to Front">
                  <img src="/icons/arrow-up.svg" alt="Front" />
                </button>
                <button className={styles.layerIconButton} onClick={bringForward} title="Bring Forward" aria-label="Bring Forward">
                  <img src="/icons/arrow-up-1x.svg" alt="Forward" />
                </button>
                <button className={styles.layerIconButton} onClick={sendBackward} title="Send Backward" aria-label="Send Backward">
                  <img src="/icons/arrow-down-1x.svg" alt="Backward" />
                </button>
                <button className={styles.layerIconButton} onClick={sendToBack} title="Send to Back" aria-label="Send to Back">
                  <img src="/icons/arrow-down.svg" alt="Back" />
                </button>
              </div>
            </div>
          )}

          {/* Inline, non-modal Clear confirmation (centered overlay) */}
          {showClearConfirm && (
            <div className={styles.clearConfirmOverlay}>
              <div className={styles.clearConfirm}>
                <div className={styles.clearConfirmText}>Clear all components and connections?</div>
                <div className={styles.clearConfirmActions}>
                  <button className={styles.clearCancel} onClick={cancelClear}>Cancel</button>
                  <button className={styles.clearOk} onClick={confirmClear}>Clear</button>
                </div>
              </div>
            </div>
          )}
          
          {/* Minimal Edge Actions - Icon buttons only, positioned on edge */}
          {selectedEdges.length > 0 && menuPosition && (
            <div 
              className={styles.edgeActionsMinimal}
              style={{
                position: 'absolute',
                left: `${menuPosition.x}px`,
                top: `${menuPosition.y}px`,
                transform: 'translate(-50%, -50%)',
                zIndex: 1000,
                pointerEvents: 'auto'
              }}
            >
              {/* Flip Direction Button - Light Blue with Swap Icon */}
              <button 
                className={`${styles.edgeIconButton} ${styles.edgeIconButtonFlip}`}
                onClick={flipEdgeDirection}
                title={`Flip animation direction (${selectedEdges.length} edge${selectedEdges.length > 1 ? 's' : ''})`}
                aria-label={`Flip animation direction for ${selectedEdges.length} edge${selectedEdges.length > 1 ? 's' : ''}`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <path d="M7 16V4M7 4L3 8M7 4L11 8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M17 8V20M17 20L21 16M17 20L13 16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              
              {/* Delete Button - Red */}
              <button 
                className={`${styles.edgeIconButton} ${styles.edgeIconButtonDelete}`}
                onClick={deleteSelectedEdges}
                title={`Delete ${selectedEdges.length} connection${selectedEdges.length > 1 ? 's' : ''}`}
                aria-label={`Delete ${selectedEdges.length} connection${selectedEdges.length > 1 ? 's' : ''}`}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M3 5h14M6 5V4a1 1 0 011-1h6a1 1 0 011 1v1m2 0v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5h12z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 9v6M12 9v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          )}

          {/* Node context menu (copy/delete) */}
          {nodeMenu && (
            <div
              className={styles.edgeActionsMinimal}
              style={{
                position: 'absolute',
                left: `${nodeMenu.x}px`,
                top: `${nodeMenu.y}px`,
                transform: 'translate(-50%, -50%)',
                zIndex: 1000,
                pointerEvents: 'auto',
              }}
            >
              <button
                className={`${styles.edgeIconButton}`}
                onClick={() => {
                  if (!nodeMenu) return;
                  copyNode(nodeMenu.nodeId);
                  setNodeMenu(null);
                }}
                title="Copy node"
                aria-label="Copy node"
              >
                Copy
              </button>
              <button
                className={`${styles.edgeIconButton} ${styles.edgeIconButtonDelete}`}
                onClick={() => {
                  if (!nodeMenu) return;
                  deleteNode(nodeMenu.nodeId);
                  setNodeMenu(null);
                }}
                title="Delete node"
                aria-label="Delete node"
              >
                Delete
              </button>
            </div>
          )}
          
          {/* Top-Left Panel with Instructions */}
          <Panel
            position="top-left"
            className={`${styles.instructionsPanel} ${showQuickTips ? styles.quickTipsOpen : styles.quickTipsClosed}`}
            onClick={() => setShowQuickTips((v) => !v)}
          >
            <div className={styles.quickTipsHeader}>
              <strong>Quick Tips</strong>
            </div>
            <div
              className={styles.quickTipsBody}
              data-open={showQuickTips ? 'true' : 'false'}
            >
            <div className={styles.instructionItem}>
              • Drag components from left sidebar
            </div>
            <div className={styles.instructionItem}>
              • <span className={styles.highlight}>Double-click label to rename</span>
            </div>
            <div className={styles.instructionItem}>
              • <span className={styles.highlight}>Click node → resize handles appear</span>
            </div>
            <div className={styles.instructionItem}>
              • Drag from connection points to link
            </div>
            <div className={styles.instructionItem}>
              • <span className={styles.highlight}>Shift+click nodes for multi-select</span>
            </div>
            <div className={styles.instructionItem}>
              • <span className={styles.highlight}>Click edge → Shift+click more</span>
            </div>
            <div className={styles.instructionItem}>
              • Press Delete to remove selected
              </div>
            </div>
          </Panel>

          {/* Empty State */}
          {nodes.length === 0 && (
            <Panel position="top-center" className={styles.emptyPanel}>
              <div className={styles.emptyState}>
                <img
                  src="/icons/Snowflake_ICON_Architecture.svg"
                  alt="Start"
                  className={styles.emptyIcon}
                />
                <h3 className={styles.emptyTitle}>Build Your Architecture</h3>
                <p className={styles.emptyText}>
                  Drag components from the left or use AI to generate a diagram
                </p>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {/* Agent Chat Panel */}
      <div className={styles.chatAnchor} style={{ left: chatPos.x, top: chatPos.y }}>
        <button
          className={`${styles.chatHandle} ${chatOpen ? styles.chatHandleOpen : ''}`}
          title={chatOpen ? 'Collapse chat' : 'Open Agent Chat'}
          onMouseDown={onChatDragStart}
          onClick={() => setChatOpen((v) => !v)}
        >
          <img
            key={`icon-${chatOpen}`}
            src="/icons/Snowflake_ICON_AI_Star.svg"
            alt="Agent"
            className={`${styles.chatToggleIcon} ${chatOpen ? styles.chatToggleIconSpinCW : styles.chatToggleIconSpinCCW}`}
          />
        </button>
        <div
          className={`${styles.chatPanel} ${chatOpen ? `${styles.chatPanelOpen} ${styles.chatEntered}` : `${styles.chatPanelCollapsed} ${styles.chatExited}`} ${showDebug ? styles.chatPanelDebugOpen : ''}`}
          style={{ left: 0, top: 0 }}
          aria-hidden={!chatOpen}
        >
          <div className={styles.chatContent}>
            <div className={styles.chatHeader}>
              <div className={styles.chatHeaderLeft}>
                <div className={`${styles.chatTitle} ${chatOpen ? styles.textShimmer : ''}`}>
                  <span className={styles.titleBrand}>SnowGram</span> Design Assistant
                </div>
                <div className={`${styles.chatSubtitle} ${chatOpen ? styles.textShimmer : ''}`}>Powered by Cortex</div>
              </div>
              <div className={styles.chatHeaderActions}>
                <button
                  className={styles.chatAction}
                  onClick={() => {
                    setClearSpin(true);
                    handleClearChat();
                    setTimeout(() => setClearSpin(false), 600);
                  }}
                  title="Clear chat"
                >
                  <img
                    src="/icons/Snowflake_ICON_Refresh.svg"
                    alt="Clear"
                    className={`${styles.chatActionIcon} ${clearSpin ? styles.chatToggleIconSpinCW : ''}`}
                  />
                </button>
                <button className={styles.chatAction} onClick={() => setChatOpen(false)} title="Collapse chat">
                  ×
                </button>
              </div>
            </div>
            <div className={styles.chatMessages}>
              {chatMessages.map((m, idx) => (
                <div
                  key={idx}
                  className={m.role === 'user' ? styles.chatMessageUser : styles.chatMessageAssistant}
                >
                  <div className={styles.chatBubble}>
                    <strong>{m.role === 'user' ? 'You' : 'SnowGram'}:</strong> {m.text}
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.chatInputRow}>
              <textarea
                className={styles.chatInput}
                placeholder="Ask the agent to refine or extend the diagram..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                rows={3}
                disabled={chatSending}
                aria-label="Chat with AI agent"
                tabIndex={chatOpen ? 0 : -1}
              />
              <button
                className={styles.chatSend}
                onClick={handleSendChat}
                disabled={!chatInput.trim() || chatSending}
                aria-label="Send message"
                tabIndex={chatOpen ? 0 : -1}
              >
                <img src="/icons/arrow-up-1x.svg" alt="Send" className={styles.chatSendIcon} />
                <span className={styles.sendDots} aria-hidden="true">...</span>
              </button>
            </div>

            <div className={styles.debugSection}>
              <button
                className={styles.debugToggle}
                onClick={() => setShowDebug((v) => !v)}
                aria-expanded={showDebug}
              >
                <svg
                  className={`${styles.debugIcon} ${
                    showDebug === true ? styles.debugIconSpinCW : showDebug === false ? styles.debugIconSpinCCW : ''
                  }`}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.32-.02-.64-.07-.95l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7.03 7.03 0 00-1.64-.95l-.36-2.54A.5.5 0 0014.28 2h-4.56a.5.5 0 00-.5.43l-.36 2.54c-.6.24-1.16.56-1.68.95l-2.39-.96a.5.5 0 00-.6.22L2.67 8.5a.5.5 0 00.12.64l2.03 1.58c-.05.31-.07.63-.07.95 0 .31.02.63.06.94l-2.04 1.58a.5.5 0 00-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.52.39 1.08.71 1.68.95l.36 2.54c.04.25.25.43.5.43h4.56c.25 0 .46-.18.5-.43l.36-2.54c.6-.24 1.16-.56 1.68-.95l2.39.96c.25.12.54.02.68-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Debug</span>
                <span className={`${styles.debugChevron} ${showDebug ? styles.debugChevronOpen : ''}`}>▾</span>
              </button>
              <div className={`${styles.debugBody} ${showDebug ? styles.debugBodyOpen : ''}`} aria-hidden={!showDebug}>
                <div className={styles.debugRow}>
                  <span>Nodes: {nodes.length}</span>
                  <span>Edges: {edges.length}</span>
                </div>
                <div className={styles.debugMermaidLabel}>Current Mermaid</div>
                <pre className={styles.debugMermaid}>{currentMermaid}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className={styles.modalOverlay} onClick={() => setShowExportModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <img
                src="/icons/Snowflake_ICON_Copy.svg"
                alt="Export"
                className={styles.modalIcon}
              />
              <h3 className={styles.modalTitle}>Export Diagram</h3>
            </div>
            <div className={styles.exportOptions}>
              <button
                className={styles.exportOption}
                onClick={() => { exportMermaid(); setShowExportModal(false); }}
              >
                <img src="/icons/Snowflake_ICON_Code.svg" alt="Mermaid" className={styles.exportIcon} />
                <div>
                  <div className={styles.exportTitle}>Mermaid (.mmd)</div>
                  <div className={styles.exportDesc}>Text-based diagram code</div>
                </div>
              </button>

              <button
                className={styles.exportOption}
                onClick={() => { exportSVG(); setShowExportModal(false); }}
              >
                <img src="/icons/Snowflake_ICON_Architecture.svg" alt="SVG" className={styles.exportIcon} />
                <div>
                  <div className={styles.exportTitle}>SVG (.svg)</div>
                  <div className={styles.exportDesc}>Scalable vector graphics</div>
                </div>
              </button>

              <button
                className={styles.exportOption}
                onClick={() => { exportPNG(); setShowExportModal(false); }}
              >
                <img src="/icons/Snowflake_ICON_Mulitmedia.svg" alt="PNG" className={styles.exportIcon} />
                <div>
                  <div className={styles.exportTitle}>PNG (.png)</div>
                  <div className={styles.exportDesc}>Raster image (screenshot)</div>
                </div>
              </button>

              <button
                className={styles.exportOption}
                onClick={() => { exportJSON(); setShowExportModal(false); }}
              >
                <img src="/icons/Snowflake_ICON_JSON.svg" alt="JSON" className={styles.exportIcon} />
                <div>
                  <div className={styles.exportTitle}>JSON (.json)</div>
                  <div className={styles.exportDesc}>Diagram data for re-import</div>
                </div>
              </button>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.modalButtonSecondary}
                onClick={() => setShowExportModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
