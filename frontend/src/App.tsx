/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @next/next/no-img-element, react-hooks/exhaustive-deps */
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
import { SnowgramAgentClient } from './lib/snowgram-agent-client';
import { convertMermaidToFlow, LAYER_COLORS } from './lib/mermaidToReactFlow';
import { layoutWithELK, enrichNodesWithFlowOrder } from './lib/elkLayout';

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
const getIconForComponentType = (componentType?: string) => {
  const key = (componentType || '').toLowerCase();
  // NEVER return icons for account boundaries
  if (key.startsWith('account_boundary')) return undefined;
  const directMap: Record<string, string> = {
    database: SNOWFLAKE_ICONS.database,
    schema: SNOWFLAKE_ICONS.schema,
    table: SNOWFLAKE_ICONS.table,
    view: SNOWFLAKE_ICONS.view,
    analytics_views: SNOWFLAKE_ICONS.view,
    analytics: SNOWFLAKE_ICONS.view,
    warehouse: SNOWFLAKE_ICONS.warehouse,
    compute_wh: SNOWFLAKE_ICONS.warehouse,
    compute_warehouse: SNOWFLAKE_ICONS.warehouse,
    bi_warehouse: SNOWFLAKE_ICONS.warehouse,
    bi_wh: SNOWFLAKE_ICONS.warehouse,
    analytics_wh: SNOWFLAKE_ICONS.warehouse,
    'data wh': SNOWFLAKE_ICONS.warehouse_data,
    datawh: SNOWFLAKE_ICONS.warehouse_data,
    'virtual wh': SNOWFLAKE_ICONS.warehouse,
    virtualwh: SNOWFLAKE_ICONS.warehouse,
    'snowpark wh': SNOWFLAKE_ICONS.warehouse_snowpark,
    'adaptive wh': SNOWFLAKE_ICONS.warehouse_adaptive,
    stream: SNOWFLAKE_ICONS.stream,
    stream_bronze_silver: SNOWFLAKE_ICONS.stream,
    stream_silver_gold: SNOWFLAKE_ICONS.stream,
    snowpipe: SNOWFLAKE_ICONS.snowpipe,
    task: SNOWFLAKE_ICONS.task,
    bronze_db: SNOWFLAKE_ICONS.database,
    silver_db: SNOWFLAKE_ICONS.database,
    gold_db: SNOWFLAKE_ICONS.database,
    bronze_schema: SNOWFLAKE_ICONS.schema,
    silver_schema: SNOWFLAKE_ICONS.schema,
    gold_schema: SNOWFLAKE_ICONS.schema,
    bronze_tables: SNOWFLAKE_ICONS.table,
    silver_tables: SNOWFLAKE_ICONS.table,
    gold_tables: SNOWFLAKE_ICONS.table,
    bronze: SNOWFLAKE_ICONS.database,
    silver: SNOWFLAKE_ICONS.database,
    gold: SNOWFLAKE_ICONS.database,
  };

  if (directMap[key]) return directMap[key];

  const exact = ALL_COMPONENTS.find(
    (c) => c.id.toLowerCase() === key || c.name.toLowerCase() === key
  );
  if (exact) return exact.icon;

  const contains = ALL_COMPONENTS.find(
    (c) => key.includes(c.id.toLowerCase()) || key.includes(c.name.toLowerCase())
  );
  return contains?.icon || SNOWFLAKE_ICONS.table;
};

// Safe no-op callbacks for nodes that should not expose edit/delete (e.g., boundaries)
const boundaryCallbacks = {
  onRename: (_id: string, _newName: string) => {},
  onDelete: (_id: string) => {},
  onCopy: (_id: string) => {},
};

const normalizeBoundaryType = (raw?: string, label?: string, id?: string) => {
  const rawLower = (raw || '').toLowerCase();
  const idLower = (id || '').toLowerCase();
  
  // Check if this is explicitly a boundary node (by ID or componentType)
  const isBoundaryNode = idLower.startsWith('account_boundary_') || 
                         rawLower.includes('boundary') || 
                         rawLower.startsWith('account_');
  
  if (!isBoundaryNode) {
    return raw; // Regular component, don't convert
  }
  
  // Normalize to canonical boundary type
  const text = `${rawLower} ${(label || '').toLowerCase()} ${idLower}`;
  if (text.includes('snowflake')) return 'account_boundary_snowflake';
  if (text.includes('aws') || text.includes('amazon')) return 'account_boundary_aws';
  if (text.includes('azure')) return 'account_boundary_azure';
  if (text.includes('gcp') || text.includes('google')) return 'account_boundary_gcp';
  
  return raw;
};

// Enforce single boundary per provider; remap edges to canonical boundary ids; restyle boundaries
const enforceAccountBoundaries = (nodes: Node[], edges: Edge[], isDark: boolean) => {
  const providerId = (ct?: string) => {
    const t = (ct || '').toLowerCase();
    if (t.includes('account_boundary_snowflake')) return 'account_boundary_snowflake';
    if (t.includes('account_boundary_aws')) return 'account_boundary_aws';
    if (t.includes('account_boundary_azure')) return 'account_boundary_azure';
    if (t.includes('account_boundary_gcp')) return 'account_boundary_gcp';
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
  };

  const brandFill = brandColors[compType] || '#29B5E8';
  const toRgb = (hex: string) => {
    const m = hex.replace('#', '');
    if (m.length === 3) {
      return {
        r: parseInt(m[0] + m[0], 16),
        g: parseInt(m[1] + m[1], 16),
        b: parseInt(m[2] + m[2], 16),
      };
    }
    if (m.length === 6) {
      return {
        r: parseInt(m.substring(0, 2), 16),
        g: parseInt(m.substring(2, 4), 16),
        b: parseInt(m.substring(4, 6), 16),
      };
    }
    return { r: 41, g: 181, b: 232 };
  };

  const fillColor = ((node.data as any)?.fillColor as string) || brandFill;
  const alpha =
    typeof (node.data as any)?.fillAlpha === 'number'
      ? (node.data as any)?.fillAlpha
      : isDark
        ? 0.15
        : 0.08;
  const { r, g, b } = toRgb(fillColor);
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
  console.log(`[addAccountBoundaries] Called with ${nodes.length} nodes`);
  const lowered = (s?: string) => (s || '').toLowerCase();
  const hasKeyword = (n: Node, keywords: string[]) =>
    keywords.some((k) => lowered((n.data as any)?.label).includes(k) || lowered((n.data as any)?.componentType).includes(k));

  const isBoundary = (n: Node) => lowered((n.data as any)?.componentType).startsWith('account_boundary');

  const cloudSets = {
    // Only match truly AWS-specific keywords (NOT 'lake' which could mean lakehouse)
    aws: ['s3', 'aws', 's3_bucket', 'aws_'],
    azure: ['azure', 'adls', 'blob'],
    gcp: ['gcp', 'gcs', 'google', 'bigquery', 'bq'],
  };

  const existingBoundary = (nodes || []).reduce<Record<string, boolean>>((acc, n) => {
    const ct = lowered((n.data as any)?.componentType);
    if (ct.startsWith('account_boundary')) {
      acc[ct] = true;
      console.log(`[addAccountBoundaries] Detected existing boundary: ${ct} (id: ${n.id})`);
    }
    return acc;
  }, {});
  
  console.log(`[addAccountBoundaries] Existing boundaries:`, Object.keys(existingBoundary));

  // Partition nodes by cloud vs snowflake (exclude boundaries from the working set)
  const nonBoundaryNodes = nodes.filter((n) => !isBoundary(n));
  const awsNodes = nonBoundaryNodes.filter((n) => hasKeyword(n, cloudSets.aws));
  const azureNodes = nonBoundaryNodes.filter((n) => hasKeyword(n, cloudSets.azure));
  const gcpNodes = nonBoundaryNodes.filter((n) => hasKeyword(n, cloudSets.gcp));

  // Snowflake nodes = everything else that's not a cloud node or boundary
  const cloudNodeIds = new Set([...awsNodes, ...azureNodes, ...gcpNodes].map((n) => n.id));
  const snowflakeNodes = nonBoundaryNodes.filter((n) => !cloudNodeIds.has(n.id));
  
  console.log(`[addAccountBoundaries] AWS nodes: ${awsNodes.length}, Snowflake nodes: ${snowflakeNodes.length}, Azure: ${azureNodes.length}, GCP: ${gcpNodes.length}`);

  const bbox = (list: Node[]) => {
    if (!list.length) return null;
    const xs = list.map((n) => n.position.x);
    const ys = list.map((n) => n.position.y);
    const widths = list.map((n) => ((n.style as any)?.width as number) || 180);
    const heights = list.map((n) => ((n.style as any)?.height as number) || 140);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...list.map((n, i) => xs[i] + widths[i]));
    const maxY = Math.max(...list.map((n, i) => ys[i] + heights[i]));
    return { minX, minY, maxX, maxY };
  };

  // Padding for boundaries - TOP needs extra space for label
  const padX = 24;
  const padYTop = 70;  // Phase 2: Increased from 50 for boundary label room
  const padYBottom = 24;
  const padY = 30; // Average padding for non-Snowflake boundaries

  const makeBoundary = (canonicalType: string, label: string, color: string, box: { minX: number; minY: number; maxX: number; maxY: number }, isDark: boolean = false) => {
    // Convert hex to RGB for proper alpha blending
    const hexToRgbBoundary = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 41, g: 181, b: 232 };
    };
    const rgb = hexToRgbBoundary(color);
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
    console.log(`[addAccountBoundaries] Sample Snowflake nodes:`, sample);
  }
  
  const snowBox = bbox(snowflakeNodes);
  console.log(`[addAccountBoundaries] Snowflake box:`, snowBox, `existing:`, existingBoundary['account_boundary_snowflake']);
  if (snowBox && !existingBoundary['account_boundary_snowflake']) {
    console.log(`[addAccountBoundaries] ✅ Creating Snowflake boundary (not provided by agent)`);
    boundaries.push(makeBoundary('account_boundary_snowflake', 'Snowflake Account', '#29B5E8', snowBox, isDark));
  } else if (existingBoundary['account_boundary_snowflake']) {
    console.log(`[addAccountBoundaries] ⏭️  Skipping Snowflake boundary (already exists from agent)`);
  }

  const awsBoxRaw = bbox(awsNodes);
  console.log(`[addAccountBoundaries] AWS box:`, awsBoxRaw, `existing:`, existingBoundary['account_boundary_aws']);
  if (awsBoxRaw && !existingBoundary['account_boundary_aws']) {
    console.log(`[addAccountBoundaries] ✅ Creating AWS boundary (not provided by agent)`);
    // Position AWS box to the left of Snowflake box when both exist to avoid overlap
    const width = (awsBoxRaw.maxX - awsBoxRaw.minX) + padX * 2;
    const height = (awsBoxRaw.maxY - awsBoxRaw.minY) + padY * 2;
    const leftX = snowBox ? snowBox.minX - width - 40 : awsBoxRaw.minX - padX;
    const box = snowBox
      ? { minX: leftX, minY: awsBoxRaw.minY - padY, maxX: leftX + width, maxY: awsBoxRaw.maxY + padY }
      : awsBoxRaw;
    boundaries.push(makeBoundary('account_boundary_aws', 'AWS Account', '#FF9900', box, isDark));
  } else if (existingBoundary['account_boundary_aws']) {
    console.log(`[addAccountBoundaries] ⏭️  Skipping AWS boundary (already exists from agent)`);
  }

  const azureBox = bbox(azureNodes);
  if (azureBox && !existingBoundary['account_boundary_azure']) {
    console.log(`[addAccountBoundaries] ✅ Creating Azure boundary (not provided by agent)`);
    boundaries.push(makeBoundary('account_boundary_azure', 'Azure Account', '#0089D6', azureBox, isDark));
  } else if (existingBoundary['account_boundary_azure']) {
    console.log(`[addAccountBoundaries] ⏭️  Skipping Azure boundary (already exists from agent)`);
  }

  const gcpBox = bbox(gcpNodes);
  if (gcpBox && !existingBoundary['account_boundary_gcp']) {
    console.log(`[addAccountBoundaries] ✅ Creating GCP boundary (not provided by agent)`);
    boundaries.push(makeBoundary('account_boundary_gcp', 'GCP Account', '#4285F4', gcpBox, isDark));
  } else if (existingBoundary['account_boundary_gcp']) {
    console.log(`[addAccountBoundaries] ⏭️  Skipping GCP boundary (already exists from agent)`);
  }

  // Collect existing boundaries from input
  const existingBoundaryNodes = nodes.filter((n) => isBoundary(n));
  
  console.log(`[addAccountBoundaries] Created ${boundaries.length} new boundaries, found ${existingBoundaryNodes.length} existing boundaries`);
  
  // Calculate bounding boxes for recalculation
  const snowBoxCalc = bbox(snowflakeNodes);
  const awsBoxCalc = bbox(awsNodes);
  const azureBoxCalc = bbox(azureNodes);
  const gcpBoxCalc = bbox(gcpNodes);
  
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
    }
    
    if (!rawBox) {
      console.log(`[addAccountBoundaries] No box for ${compType}, keeping original dimensions`);
      return boundary;
    }
    
    console.log(`[addAccountBoundaries] Recalculating ${compType} boundary from ${containedNodes.length} nodes`);
    
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
      // Position AWS to the left of Snowflake boundary with 40px gap
      const leftX = snowflakeBoundaryLeft - awsWidth - 40;
      finalPosition = { x: leftX, y: rawBox.minY - padY };
      console.log(`[addAccountBoundaries] Repositioning AWS: snowflake nodes minX=${snowBoxCalc.minX}, snowflake boundary left=${snowflakeBoundaryLeft}, awsWidth=${awsWidth}, final leftX=${leftX}`);
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
  
  console.log(`[addAccountBoundaries] Total boundaries: ${allBoundaries.length} (${boundaries.length} new + ${recalculatedBoundaries.length} recalculated)`);
  
  // Push boundaries behind everything else
  return [...allBoundaries, ...nonBoundaryNodes];
};

// Compact DAG layout: layers by dependency, wrapped columns to avoid extreme width/height
const layoutNodes = (nodes: Node[], edges: Edge[]) => {
  const nodeMap = new Map<string, Node>();
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
        // For cycles, still try to increase depth
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

  const X_SPACING = 200;
  const Y_SPACING = 150;
  const MAX_COLS = 4;
  const ROW_HEIGHT = Y_SPACING * 6; // allows up to ~6 rows per block before overlap

  const laidOut = nodes.map((n) => {
    const l = level.get(n.id) ?? 0;
    const siblings = grouped.get(l) || [];
    const idx = siblings.indexOf(n.id);
    const col = l % MAX_COLS;
    const blockRow = Math.floor(l / MAX_COLS);
    return {
      ...n,
      position: {
        x: col * X_SPACING,
        y: blockRow * ROW_HEIGHT + idx * Y_SPACING,
      },
    };
  });

  return laidOut;
};

// Heuristic grid layout + edge pruning for medallion flows
const layoutMedallion = (nodes: Node[], edges: Edge[]) => {
  const isBoundary = (n: Node) => (((n.data as any)?.componentType || '') as string).toLowerCase().startsWith('account_boundary');
  const nonBoundary = nodes.filter((n) => !isBoundary(n));

  // helper to score and pick best match
  const pick = (keywords: string[]): Node | null => {
    const score = (n: Node) => {
      const s = `${((n.data as any)?.label || '')} ${((n.data as any)?.componentType || '')}`.toLowerCase();
      return keywords.reduce((acc, k) => (s.includes(k) ? acc + 1 : acc), 0);
    };
    return nonBoundary.reduce<{ best: Node | null; sc: number }>(
      (acc, n) => {
        const sc = score(n);
        if (sc > acc.sc) return { best: n, sc };
        return acc;
      },
      { best: null, sc: 0 }
    ).best;
  };

  const cloud = pick(['s3', 'lake', 'aws']);
  const snowpipe = pick(['snowpipe', 'ingest']);
  const bronzeDb = pick(['bronze db', 'bronze database', 'bronze']);
  const bronzeSchema = pick(['raw schema', 'bronze schema', 'raw']);
  const bronzeTables = pick(['raw table', 'bronze table', 'raw tables']);
  const bronzeStream = pick(['bronze to silver', 'bronze stream']);
  const silverDb = pick(['silver db', 'silver database', 'silver']);
  const silverSchema = pick(['cleansed schema', 'silver schema', 'clean schema', 'cleansed']);
  const silverTables = pick(['cleansed table', 'silver table', 'cleansed tables']);
  const silverStream = pick(['silver to gold', 'silver stream']);
  const goldDb = pick(['gold db', 'gold database', 'gold']);
  const goldSchema = pick(['curated schema', 'refined schema', 'gold schema']);
  const goldTables = pick(['curated tables', 'refined tables', 'gold tables']);
  const analytics = pick(['analytics', 'view']);
  const warehouse = pick(['warehouse', 'compute']);

  const X = (c: number) => 200 + c * 190;
  const Y = (r: number) => 80 + r * 120;
  const place = (n: Node | null, c: number, r: number) =>
    n
      ? {
          ...n,
          position: { x: X(c), y: Y(r) },
        }
      : null;

  const positioned: Node[] = [
    place(cloud, 0, 0),
    place(snowpipe, 1, 0),
    place(bronzeDb, 2, 0),
    place(silverDb, 3, 0),
    place(goldDb, 4, 0),
    place(analytics, 5, 2),
    place(warehouse, 6, 0),

    place(bronzeSchema, 2, 1),
    place(silverSchema, 3, 1),
    place(goldSchema, 4, 1),

    place(bronzeTables, 2, 2),
    place(silverTables, 3, 2),
    place(goldTables, 4, 2),

    place(bronzeStream, 2, 3),
    place(silverStream, 3, 3),
  ].filter(Boolean) as Node[];

  const placedIds = new Set(positioned.map((n) => n.id));
  // extras to the right
  let extrasCol = 7;
  nonBoundary
    .filter((n) => !placedIds.has(n.id))
    .forEach((n, idx) => {
      positioned.push({
        ...n,
        position: { x: X(extrasCol), y: Y(idx) },
      });
      if (idx % 4 === 3) extrasCol += 1;
    });

  // rebuild edges to reduce clutter
  const makeEdge = (a: Node | null, b: Node | null, idx: number) =>
    a && b
      ? ({
          id: `m-${a.id}-${b.id}-${idx}`,
          source: a.id,
          target: b.id,
          type: 'smoothstep',  // Phase 3: Changed from 'straight' for better routing
          animated: true,
          style: { stroke: '#29B5E8', strokeWidth: 2.5 },  // Phase 3: Increased strokeWidth
          deletable: true,
        } as Edge)
      : null;

  const newEdges: Edge[] = [
    makeEdge(cloud, snowpipe, 0),
    makeEdge(snowpipe, bronzeDb, 1),
    makeEdge(bronzeDb, silverDb, 2),
    makeEdge(silverDb, goldDb, 3),
    makeEdge(goldDb, analytics, 4),
    makeEdge(analytics, warehouse, 5),

    makeEdge(bronzeDb, bronzeSchema, 6),
    makeEdge(bronzeSchema, bronzeTables, 7),
    makeEdge(bronzeTables, bronzeStream, 8),
    makeEdge(bronzeStream, silverDb, 9),

    makeEdge(silverDb, silverSchema, 10),
    makeEdge(silverSchema, silverTables, 11),
    makeEdge(silverTables, silverStream, 12),
    makeEdge(silverStream, goldDb, 13),

    makeEdge(goldDb, goldSchema, 14),
    makeEdge(goldSchema, goldTables, 15),
    makeEdge(goldTables, analytics, 16),
  ].filter(Boolean) as Edge[];

  // Don't carry forward boundaries - let addAccountBoundaries create them fresh
  console.log(`[layoutMedallion] Returning ${positioned.length} positioned nodes`);
  return { nodes: positioned, edges: newEdges.length ? newEdges : edges };
};

// Deterministic medallion layout: fixed slots + minimal edges + non-overlapping boundaries
const layoutMedallionDeterministic = (nodes: Node[]) => {
  const isBoundary = (n: Node) => (((n.data as any)?.componentType || '') as string).toLowerCase().startsWith('account_boundary');
  const nonBoundary = nodes.filter((n) => !isBoundary(n));
  const boundaries = nodes.filter((n) => isBoundary(n));

  // Exact ID picker - tries to find node by exact ID match first
  const pickById = (id: string): Node | null => {
    return nonBoundary.find(n => n.id === id) || null;
  };

  // Score-based node picker - matches against id, label, and componentType
  const pick = (keywords: string[], preferredId?: string): Node | null => {
    // FIRST: Try exact ID match if provided (most reliable)
    if (preferredId) {
      const exact = pickById(preferredId);
      if (exact) return exact;
    }
    
    const score = (n: Node) => {
      // Check against node id, label, AND componentType for best matching
      const s = `${n.id} ${((n.data as any)?.label || '')} ${((n.data as any)?.componentType || '')}`.toLowerCase();
      return keywords.reduce((acc, k) => (s.includes(k) ? acc + 1 : acc), 0);
    };
    return nonBoundary.reduce<{ best: Node | null; sc: number }>(
      (acc, n) => {
        const sc = score(n);
        if (sc > acc.sc) return { best: n, sc };
        return acc;
      },
      { best: null, sc: 0 }
    ).best;
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
  console.log('[layoutMedallionDeterministic] Picked nodes:', {
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
  console.log('[layoutMedallionDeterministic] Available non-boundary nodes:', nonBoundary.map(n => `${n.id}/${(n.data as any)?.label}`));

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
      console.warn(`[layoutMedallionDeterministic] Skipping duplicate node: ${n.id}`);
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
    console.warn(`[layoutMedallionDeterministic] DISCARDING ${extras.length} extra nodes:`, 
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
  console.log(`[layoutMedallionDeterministic] Returning ${positioned.length} positioned nodes`);
  return { nodes: positioned, edges: newEdges };
};

const isMedallion = (nodes: Node[]) =>
  nodes.some((n) => {
    const lbl = ((n.data as any)?.label || '').toLowerCase();
    const ct = ((n.data as any)?.componentType || '').toLowerCase();
    return ['bronze', 'silver', 'gold'].some((k) => lbl.includes(k) || ct.includes(k));
  });

interface AIResponse {
  mermaid_code: string;
  explanation: string;
  components_used: string[];
}

// Generate Mermaid code from current diagram
function generateMermaidFromDiagram(currentNodes: Node[], currentEdges: Edge[]): string {
  let mermaid = 'flowchart LR\n';

  // Add node definitions
  currentNodes.forEach((node) => {
    const label = node.data.label || node.id;
    const sanitizedLabel = label.replace(/[[\]()]/g, '');
    mermaid += `    ${node.id}[${sanitizedLabel}]\n`;
  });

  mermaid += '\n';

  // Add connections
  currentEdges.forEach((edge) => {
    mermaid += `    ${edge.source} --> ${edge.target}\n`;
  });

  return mermaid;
}

const App: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  // const edgeReconnectSuccessful = useRef(true); // Not used - reconnection not supported in this version
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
        if (parsed.messages) setChatMessages(parsed.messages);
        if (typeof parsed.open === 'boolean') setChatOpen(parsed.open);
        if (parsed.input) setChatInput(parsed.input);
        if (parsed.pos && typeof parsed.pos.x === 'number' && typeof parsed.pos.y === 'number') {
          setChatPos(clampChatPos(parsed.pos));
        }
      }
    } catch (e) {
      console.warn('Failed to load chat from storage', e);
    }
  }, []);

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

// Helper: hex -> rgb
const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const m = hex.replace('#', '');
  if (m.length === 3) {
    const r = parseInt(m[0] + m[0], 16);
    const g = parseInt(m[1] + m[1], 16);
    const b = parseInt(m[2] + m[2], 16);
    return { r, g, b };
  }
  if (m.length === 6) {
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
};

// Helpers: contrast-aware label color
const srgbToLinear = (c: number) => {
  const cS = c / 255;
  return cS <= 0.04045 ? cS / 12.92 : Math.pow((cS + 0.055) / 1.055, 2.4);
};

const luminance = (r: number, g: number, b: number) =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

const getLabelColor = (fill: string, alpha: number, isDark: boolean) => {
  // In dark mode, always use light text for better contrast
  if (isDark) return '#e5f2ff';
  // In light mode, calculate based on luminance
  const base = { r: 247, g: 251, b: 255 }; // light mode background
  const { r, g, b } = hexToRgb(fill) || { r: 41, g: 181, b: 232 };
  const effLum = alpha * luminance(r, g, b) + (1 - alpha) * luminance(base.r, base.g, base.b);
  return effLum > 0.5 ? '#0F172A' : '#1a1a1a';
};

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
  
  // NEW: Check if all categories are collapsed
  const allCollapsed = collapsedCategories.size === Object.keys(COMPONENT_CATEGORIES).length;
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
      console.log('🔌 Connection attempt:', params);

      // Guard against incomplete connections
      if (!params.source || !params.target) {
        console.warn('❌ Missing source/target on connect, skipping edge', params);
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
      
      console.log('✅ Adding edge:', newEdge);
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges]
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
  }, [nodes, reactFlowInstance, updateEdgeMenuPosition]);
  
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
  }, []);

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
    []
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
    const rgb = hexToRgb(boundaryColor) || { r: 41, g: 181, b: 232 };
    const rgbFill = hexToRgb(fillColor) || { r: 41, g: 181, b: 232 };
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
    [reactFlowInstance, setNodes, isDarkMode, deleteNode, renameNode]
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
    
    const svgElement = document.querySelector('.react-flow__viewport');
    if (!svgElement) return;

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);
    
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snowgram_${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
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
    // Preferred: backend proxy (no PAT in browser)
    try {
      const resp = await fetch('/api/agent/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!resp.ok) throw new Error('Backend agent proxy failed');
      const data: AgentResult = await resp.json();
      return data;
    } catch (proxyErr) {
      console.warn('Backend proxy failed, attempting direct PAT flow', proxyErr);
    }

    // Fallback: direct PAT (dev only)
    const pat = process.env.NEXT_PUBLIC_SNOWFLAKE_PAT || process.env.REACT_APP_SNOWFLAKE_PAT;
    if (!pat) throw new Error('Missing PAT and backend proxy failed.');
    const client = new SnowgramAgentClient(pat);
    const data = await client.generateArchitecture(query);
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

// Normalize nodes/edges: dedupe nodes by componentType/label, drop orphan/duplicate edges, keep single boundaries
const normalizeGraph = (nodes: Node[], edges: Edge[]) => {
  // Canonical medallion IDs that should NEVER be collapsed
  const canonicalMedallionIds = new Set([
    's3', 'pipe1', 'bronze_db', 'bronze_schema', 'bronze_tables',
    'stream_bronze_silver', 'silver_db', 'silver_schema', 'silver_tables',
    'stream_silver_gold', 'gold_db', 'gold_schema', 'gold_tables', 'analytics_views',
    'transform_task', 'compute_wh', 'bronze_stream', 'secure_views'
  ]);
  
  const keyForNode = (n: Node) => {
    const d: any = n.data || {};
    const rawComp = (d.componentType || '').toString().toLowerCase().trim();
    const label = (d.label || '').toString().toLowerCase().trim();
    const nodeId = n.id.toLowerCase();
    
    // ALWAYS preserve canonical medallion IDs by their exact ID
    if (canonicalMedallionIds.has(n.id)) {
      return n.id;
    }
    
    if (rawComp.startsWith('account_boundary')) {
      // Normalize boundary key to provider (aws|azure|gcp|snowflake|other)
      const provider =
        rawComp.includes('aws') ? 'aws' :
        rawComp.includes('azure') ? 'azure' :
        rawComp.includes('gcp') ? 'gcp' :
        rawComp.includes('snowflake') ? 'snowflake' :
        rawComp.replace(/account_boundary[_-]?/, '') || label || 'boundary';
      return `account_boundary_${provider}`;
    }
    // Preserve medallion-specific components (don't collapse bronze/silver/gold)
    if (rawComp.match(/^(bronze|silver|gold)_(db|schema|tables?)$/)) {
      return rawComp;
    }
    if (rawComp === 'stream_bronze_silver' || rawComp === 'stream_silver_gold') {
      return rawComp;
    }
    if (rawComp === 'analytics_views') {
      return rawComp;
    }
    const comp = rawComp.replace(/_[0-9]+$/, ''); // strip timestamp suffixes
    return comp || label || n.id;
  };

  const dedupedNodes: Node[] = [];
  const seenKeys = new Set<string>();
  const keyToNode = new Map<string, Node>();
  const duplicates: string[] = [];
  
  // First pass: collect all nodes by key
  nodes.forEach((n) => {
    const k = keyForNode(n);
    const existing = keyToNode.get(k);
    
    // Prioritize canonical medallion IDs over agent-generated custom IDs
    if (!existing || canonicalMedallionIds.has(n.id)) {
      keyToNode.set(k, n);
      if (existing) {
        duplicates.push(`${existing.id}(${k}) replaced by ${n.id}`);
      }
    } else {
      duplicates.push(`${n.id}(${k}) replaced by ${existing.id}`);
    }
  });
  
  // Second pass: add unique nodes
  keyToNode.forEach((n, k) => {
    // normalize componentType for icons
    const d: any = n.data || {};
    const canonical = canonicalizeComponentType(d.componentType);
    dedupedNodes.push({
      ...n,
      data: { ...d, componentType: canonical },
    });
  });
  if (duplicates.length > 0) {
    console.warn('🗑️ [Normalize] Removed duplicates:', duplicates);
    duplicates.forEach(d => console.log('   - ' + d));
  }

  const nodeIds = new Set(dedupedNodes.map((n) => n.id));
  const edgeKey = (e: Edge) => `${e.source}->${e.target}`;
  const seenEdges = new Set<string>();
  const dedupedEdges: Edge[] = [];
  const orphanedEdges: string[] = [];
  edges.forEach((e) => {
    if (!e.source || !e.target) return;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      orphanedEdges.push(`${e.source}->${e.target}`);
      return;
    }
    if (e.source === e.target) return;
    const k = edgeKey(e);
    if (seenEdges.has(k)) return;
    seenEdges.add(k);
    dedupedEdges.push(e);
  });
  
  if (orphanedEdges.length > 0) {
    console.log('[Normalize] Removed orphaned edges:', orphanedEdges);
  }
  console.log('[Normalize] Result:', { nodeCount: dedupedNodes.length, edgeCount: dedupedEdges.length });

  return { nodes: dedupedNodes, edges: dedupedEdges };
};

// Canonicalize component types for icons/layout (reuse core Snowflake icons)
const canonicalizeComponentType = (comp?: string) => {
  const c = (comp || '').toLowerCase();
  
  // ALWAYS preserve boundary types unchanged
  if (c.startsWith('account_boundary')) {
    return comp; // Return original casing
  }
  
  // Preserve medallion-specific types
  if (c === 'bronze_db' || c === 'silver_db' || c === 'gold_db') return 'database';
  if (c === 'bronze_schema' || c === 'silver_schema' || c === 'gold_schema') return 'schema';
  if (c === 'bronze_tables' || c === 'silver_tables' || c === 'gold_tables') return 'table';
  if (c === 'analytics_views') return 'view';
  // Generic matching
  if (c.includes('stream')) return 'stream';
  if (c.includes('snowpipe') || c.includes('pipe')) return 'snowpipe';
  if (c.includes('task')) return 'task';
  if (c.includes('schema')) return 'schema';
  if (c.includes('table')) return 'table';
  if (c.includes('view') || c.includes('analytic')) return 'view';
  if (c.includes('warehouse') || c.includes('wh')) return 'warehouse';
  if (c.includes('db') || c.includes('database')) return 'database';
  if (c.includes('s3') || c.includes('lake')) return 'database';
  return comp || 'table';
};

// Ensure CSP resources stay inside their provider boundary
const fitCspNodesIntoBoundaries = (nodes: Node[]) => {
  const result = [...nodes];
  const boundaries: Record<string, Node> = {};
  result.forEach((n) => {
    const comp = ((n.data as any)?.componentType || '').toString().toLowerCase();
    if (comp.startsWith('account_boundary')) {
      const key =
        comp.includes('aws') ? 'aws' :
        comp.includes('azure') ? 'azure' :
        comp.includes('gcp') ? 'gcp' :
        comp.includes('snowflake') ? 'snowflake' : comp;
      boundaries[key] = n;
    }
  });

  const keywords: Record<string, string[]> = {
    aws: ['aws', 's3', 'lake', 'snowpipe'],
    azure: ['azure', 'adls', 'blob'],
    gcp: ['gcp', 'gcs', 'bigquery', 'bq'],
  };

  Object.entries(keywords).forEach(([provider, keys]) => {
    const boundary = boundaries[provider];
    if (!boundary) return;
    const padding = 32;
    const titlePad = 32; // keep content clear of boundary title
    const rowHeight = 170; // match medallion vertical spacing and give more breathing room
    const bx = boundary.position.x + padding;
    const by = boundary.position.y + padding + titlePad;

    let index = 0;
    let maxX = bx;
    let maxY = by;
    result.forEach((n) => {
      const d: any = n.data || {};
      const text = `${(d.label || '').toString().toLowerCase()} ${(d.componentType || '').toString().toLowerCase()}`;
      const matches = keys.some((k) => text.includes(k));
      if (matches && !((d.componentType || '').toString().toLowerCase().startsWith('account_boundary'))) {
        // Use single-column layout (vertical stack) for cloud provider boundaries
        const newPos = { x: bx, y: by + index * rowHeight };
        const nodeWidth = ((n.style as any)?.width as number) || 180;
        const nodeHeight = ((n.style as any)?.height as number) || 140;
        result[result.findIndex((x) => x.id === n.id)] = {
          ...n,
          position: newPos,
        };
        console.log(`[fitCspNodes] Repositioning ${provider} node ${n.id} (${nodeWidth}x${nodeHeight}) to (${newPos.x}, ${newPos.y}) - single column layout`);
        maxX = Math.max(maxX, newPos.x + nodeWidth);
        maxY = Math.max(maxY, newPos.y + nodeHeight);
        index += 1;
      }
    });
    // resize boundary to fit children
    const existingWidth = boundary.style?.width ? Number(boundary.style.width) : 0;
    const existingHeight = boundary.style?.height ? Number(boundary.style.height) : 0;
    const width = Math.max(existingWidth, maxX - boundary.position.x + padding);
    const height = Math.max(existingHeight, maxY - boundary.position.y + padding);
    const idx = result.findIndex((b) => b.id === boundary.id);
    if (idx >= 0) {
      result[idx] = {
        ...boundary,
        style: { ...(boundary.style || {}), width, height },
      };
    }
  });

  return result;
};

// Ensure core medallion nodes and edges exist (Bronze/Silver/Gold + streams + Analytics)
const ensureMedallionCompleteness = (nodes: Node[], edges: Edge[]) => {
  const normalizeLabel = (s: string) => 
    s.toLowerCase()
      .replace(/[→\-\s]+/g, '') // Remove arrows, dashes, spaces
      .replace(/to/g, '') // Remove "to" (e.g., "Bronze to Silver")
      .replace(/[^a-z0-9]/g, '');
  
  // If agent's output is severely incomplete, force complete rebuild
  const isSeverelyIncomplete = nodes.length < 12 || edges.length < 8;
  
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
  console.log('[Completeness] Input:', { nodeCount: nodes.length, edgeCount: edges.length, isSeverelyIncomplete });
  
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
      console.log(`[Completeness] Remapping ${existing.id} → ${canonicalId}`);
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
  
  remapId('s3', 'S3 Data Lake', ['s3', 'data_lake']);
  remapId('pipe1', 'Snowpipe', ['pipe', 'snowpipe']);
  remapId('bronze_db', 'Bronze DB', ['bronze_db', 'bronze database']);
  remapId('bronze_schema', 'Bronze Schema', ['bronze_schema', 'bronze schema', 'raw_schema']);
  remapId('bronze_tables', 'Bronze Tables', ['bronze_raw', 'bronze_table', 'raw_tables']);
  remapId('stream_bronze_silver', 'Bronze→Silver Stream', ['stream_bronze', 'bronze_silver', 'cdc_stream']);
  remapId('silver_db', 'Silver DB', ['silver_db', 'silver database']);
  remapId('silver_schema', 'Silver Schema', ['silver_schema', 'silver schema', 'clean_schema']);
  remapId('silver_tables', 'Silver Tables', ['silver_clean', 'silver_table', 'cleansed_tables']);
  remapId('stream_silver_gold', 'Silver→Gold Stream', ['stream_silver', 'silver_gold']);
  remapId('gold_db', 'Gold DB', ['gold_db', 'gold database']);
  remapId('gold_schema', 'Gold Schema', ['gold_schema', 'gold schema', 'curated_schema']);
  remapId('gold_tables', 'Gold Tables', ['gold_curated', 'gold_table', 'curated_tables', 'business_tables']);
  remapId('analytics_views', 'Analytics Views', ['analytics', 'analytics_view', 'reporting_views']);
  remapId('transform_task', 'Data Transform Task', ['transform_task', 'data_transform', 'etl_task', 'data_cleansing', 'cleansing_task']);
  remapId('compute_wh', 'Compute Warehouse', ['compute', 'warehouse', 'bi_warehouse', 'reporting_wh']);
  remapId('bronze_stream', 'Bronze Stream', ['bronze_stream', 'bronze stream']);
  remapId('secure_views', 'Secure Reporting Views', ['secure', 'secure_reporting', 'executive_dashboard', 'exec_dashboard']);
  // Map BI tools to standard Tableau node for simplicity
  remapId('tableau', 'Tableau Dashboards', ['tableau', 'tableau_dashboard', 'powerbi', 'power_bi', 'bi_tool']);

  // Update all edge references to use canonical IDs
  edges.forEach((e) => {
    if (idMap[e.source]) e.source = idMap[e.source];
    if (idMap[e.target]) e.target = idMap[e.target];
  });
  
  console.log('[Completeness] After remapping:', { nodeCount: nodes.length });

  // SECOND, add all required medallion nodes (skip if they now exist after remapping)
  // CRITICAL FDE FIX: NEVER automatically add S3/Snowpipe - only keep if agent explicitly provided them
  // The hasExternalSource check was incorrectly matching 'lake' (lakehouse) and 'pipe' (pipeline)
  // causing AWS components to appear when user never asked for them
  const hasExplicitS3 = nodes.some(n => {
    const label = ((n.data as any)?.label || '').toLowerCase();
    const id = n.id.toLowerCase();
    const compType = ((n.data as any)?.componentType || '').toLowerCase();
    // Only match EXPLICIT S3/Snowpipe references, NOT 'lake' or 'pipe' substrings
    return (label === 's3' || label === 's3 data lake' || label.startsWith('s3 ') || label.includes(' s3 ') ||
            id === 's3' || compType === 's3' ||
            label === 'snowpipe' || label.includes('snowpipe') ||
            id === 'pipe1' || id === 'snowpipe' || compType === 'snowpipe');
  });
  
  // FDE: Only add S3/Snowpipe if they ALREADY exist (don't create from scratch!)
  // Previous logic added them if ANY node had 'lake' which caused phantom AWS
  if (hasExplicitS3) {
    console.log('[Completeness] Keeping existing S3/Snowpipe - they were explicitly in agent output');
    addNode('s3', 'S3 Data Lake', 's3', true);
    addNode('pipe1', 'Snowpipe', 'snowpipe', true);
  } else {
    console.log('[Completeness] NO explicit S3/Snowpipe found - NOT adding external AWS components');
  }
  // CORE MEDALLION NODES ONLY - no hallucinated extras
  addNode('bronze_db', 'Bronze DB', 'bronze_db', true);
  addNode('bronze_schema', 'Bronze Schema', 'bronze_schema', true);
  addNode('bronze_tables', 'Bronze Tables', 'bronze_tables', true);
  addNode('silver_db', 'Silver DB', 'silver_db', true);
  addNode('silver_schema', 'Silver Schema', 'silver_schema', true);
  addNode('silver_tables', 'Silver Tables', 'silver_tables', true);
  addNode('gold_db', 'Gold DB', 'gold_db', true);
  addNode('gold_schema', 'Gold Schema', 'gold_schema', true);
  addNode('gold_tables', 'Gold Tables', 'gold_tables', true);
  // Minimal BI layer - only analytics views and one warehouse
  addNode('analytics_views', 'Analytics Views', 'analytics_views', true);
  addNode('compute_wh', 'Compute Warehouse', 'compute_wh', true);
  // DON'T add: transform_task, secure_views, bronze_stream, inter-layer streams
  // These create visual clutter and orphaned nodes
  
  console.log('[Completeness] After addNode:', { nodeCount: nodes.length });

  console.log('[Completeness] Input edges:', edges.map(e => `${e.source}->${e.target}`));
  
  // CLEAN UP: Remove backwards/invalid edges that violate medallion logic
  // SIMPLIFIED: Only core medallion edges, no streams/transforms
  const validEdges = hasExplicitS3 
    ? [
        // External → Bronze
        's3->pipe1', 'pipe1->bronze_db',
        // Bronze layer
        'bronze_db->bronze_schema', 'bronze_schema->bronze_tables',
        // Bronze → Silver
        'bronze_tables->silver_db',
        // Silver layer
        'silver_db->silver_schema', 'silver_schema->silver_tables',
        // Silver → Gold
        'silver_tables->gold_db',
        // Gold layer
        'gold_db->gold_schema', 'gold_schema->gold_tables',
        // Gold → Analytics
        'gold_tables->analytics_views', 'analytics_views->compute_wh',
      ]
    : [
        // No external sources - start from bronze_db
        // Bronze layer
        'bronze_db->bronze_schema', 'bronze_schema->bronze_tables',
        // Bronze → Silver
        'bronze_tables->silver_db',
        // Silver layer
        'silver_db->silver_schema', 'silver_schema->silver_tables',
        // Silver → Gold
        'silver_tables->gold_db',
        // Gold layer
        'gold_db->gold_schema', 'gold_schema->gold_tables',
        // Gold → Analytics
        'gold_tables->analytics_views', 'analytics_views->compute_wh',
      ];
  const validSet = new Set(validEdges);
  const medallionNodes = hasExplicitS3
    ? new Set([
        's3', 'pipe1', 'bronze_db', 'bronze_schema', 'bronze_tables',
        'silver_db', 'silver_schema', 'silver_tables',
        'gold_db', 'gold_schema', 'gold_tables', 'analytics_views', 'compute_wh'
      ])
    : new Set([
        'bronze_db', 'bronze_schema', 'bronze_tables',
        'silver_db', 'silver_schema', 'silver_tables',
        'gold_db', 'gold_schema', 'gold_tables', 'analytics_views', 'compute_wh'
      ]);
  
  // Add common invalid patterns to explicitly block (catch any casing/whitespace variations)
  const normalizeEdgeId = (id: string) => id.toLowerCase().replace(/[^a-z0-9]/g, '');
  const invalidPatterns = [
    'silvertablesstreambronzesilver', // Stream feeds INTO silver, not from it
    'goldtablesstreamsilver', // Stream feeds INTO gold, not from it  
    'goldtablesstreamsilvergold', // Stream feeds INTO gold, not from it
    'bronzedbs3', // No backwards flow to S3
    'silverdbbronzedb', // No backwards flow between layers
    'golddbsilverdb', // No backwards flow between layers
    'analyticsgold', // No backwards flow from analytics
    'viewsgold', // No backwards flow from views
    'warehousegold', // Warehouse doesn't feed back
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
      console.warn(`🚫 [Completeness] Blocked invalid edge: ${key} (normalized: ${normalizedKey})`);
      return false;
    }
    
    const sourceIsMedallion = medallionNodes.has(e.source);
    const targetIsMedallion = medallionNodes.has(e.target);
    
    // If both nodes are medallion nodes, only keep valid edges
    if (sourceIsMedallion && targetIsMedallion) {
      const isValid = validSet.has(key);
      if (!isValid) {
        console.warn(`🚫 [Completeness] Blocked invalid medallion edge: ${key}`);
      }
      return isValid;
    }
    
    // Allow edges from/to non-medallion nodes (warehouses, etc.)
    return true;
  });
  
  // Replace edges array with cleaned version
  const beforeCount = edges.length;
  edges.length = 0;
  edges.push(...cleanedEdges);
  console.log('[Completeness] Cleaned edges:', { before: beforeCount, after: cleanedEdges.length, removed: beforeCount - cleanedEdges.length });
  console.log('[Completeness] Cleaned edges list:', cleanedEdges.map(e => `${e.source}->${e.target}`));

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
      style: { stroke: '#60A5FA', strokeWidth: 2.5 },  // Phase 3: Increased strokeWidth,
    };
    edges.push(edge);
  };
  
  // Only add external source edges if the agent included them
  if (hasExplicitS3) {
    ensureEdge('s3', 'pipe1');
    ensureEdge('pipe1', 'bronze_db');
  }
  
  // Core medallion edges (always needed)
  ensureEdge('bronze_db', 'bronze_schema');
  ensureEdge('bronze_schema', 'bronze_tables');
  ensureEdge('bronze_tables', 'stream_bronze_silver');
  ensureEdge('stream_bronze_silver', 'silver_db');
  ensureEdge('silver_db', 'silver_schema');
  ensureEdge('silver_schema', 'silver_tables');
  ensureEdge('silver_tables', 'stream_silver_gold');
  ensureEdge('stream_silver_gold', 'gold_db');
  ensureEdge('gold_db', 'gold_schema');
  ensureEdge('gold_schema', 'gold_tables');
  ensureEdge('gold_tables', 'analytics_views');
  ensureEdge('analytics_views', 'compute_wh');
  ensureEdge('silver_tables', 'transform_task');
  ensureEdge('transform_task', 'gold_tables');
  ensureEdge('bronze_tables', 'bronze_stream');
  ensureEdge('bronze_stream', 'stream_bronze_silver');
  ensureEdge('gold_tables', 'secure_views');

  // FILTER OUT ORPHAN NODES: Nodes that have no connections are likely extraneous agent hallucinations
  // Only keep nodes that are either:
  // 1. Core medallion nodes (always needed)
  // 2. Connected to at least one edge
  // 3. Boundary nodes (special case)
  const coreNodeIds = new Set([
    's3', 'pipe1', 'bronze_db', 'bronze_schema', 'bronze_tables', 'bronze_stream',
    'stream_bronze_silver', 'silver_db', 'silver_schema', 'silver_tables', 'silver_stream',
    'stream_silver_gold', 'gold_db', 'gold_schema', 'gold_tables',
    'analytics_views', 'secure_views', 'transform_task', 'compute_wh'
  ]);
  
  // Explicitly unwanted nodes that should never appear (agent hallucinations)
  // These are "invented" tasks/components that create visual noise
  // FDE FIX: AGGRESSIVELY filter out ALL non-core medallion BI hallucinations
  const unwantedPatterns = [
    // Aggregation tasks
    'aggregation task', 'aggregation_task', 'agg task', 'agg_task',
    'silver gold aggregation', 'silver_gold_agg', 'bronze silver aggregation',
    // Cleansing/validation tasks
    'cleansing task', 'cleaning task', 'validation task',
    'quality check', 'data quality',
    // Transform tasks - filter ALL variants to avoid orphans
    'data transformation task', 'transformation task', 'data transform task',
    'transform task', 'etl task',
    // Processing nodes
    'bronze to silver', 'silver to gold', 'gold to analytics',
    'processing task', 'processing job', 'etl job',
    // CRITICAL: Filter hallucinated BI "views" that aren't part of actual schema
    // NOTE: Do NOT filter 'analytics views' or 'analytics_views' - that's a core medallion node!
    'bi analytics views', 'bi views',
    'performance materialized views', 'performance views', 'materialized view',
    'secure reporting views', 'reporting views', 'secure views',
    // Filter extra dashboards/reports beyond core
    'executive dashboard', 'executive report',
    // Filter orphaned inter-layer streams (keep only intra-layer bronze/silver/gold streams)
    'bronze silver stream', 'silver gold stream',
    'bronze→silver stream', 'silver→gold stream',
    'bronze to silver stream', 'silver to gold stream'
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
    's3', 'pipe1', 'snowpipe',
    // Bronze layer
    'bronze_db', 'bronze_schema', 'bronze_tables', 'bronze_stream',
    // Silver layer  
    'silver_db', 'silver_schema', 'silver_tables', 'silver_stream',
    // Gold layer
    'gold_db', 'gold_schema', 'gold_tables',
    // Core analytics (minimal)
    'analytics_views', 'compute_wh',
    // BI tools (external consumers - user may want these)
    'tableau', 'powerbi', 'streamlit',
  ]);
  
  // Also allow nodes that match these patterns (for flexibility)
  const allowedPatterns = [
    'bronze', 'silver', 'gold', 'stream', 'warehouse', 'wh',
    'tableau', 'powerbi', 'streamlit', 'dashboard',
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
      console.warn(`🚫 [Completeness] Filtering unwanted hallucinated node: ${n.id} / "${label}"`);
      return false;
    }
    
    // Keep if matches allowed patterns
    if (allowedPatterns.some(p => text.includes(p))) return true;
    
    // Keep if connected to any edge AND is a warehouse/BI tool
    if (connectedNodeIds.has(n.id) && (text.includes('warehouse') || text.includes('tableau') || text.includes('bi'))) {
      return true;
    }
    
    // Otherwise, filter it out (don't keep random orphans or hallucinations)
    console.warn(`🚫 [Completeness] Filtering non-core node: ${n.id} / "${label}"`);
    return false;
  });
  
  console.log('[Completeness] Orphan filter:', { 
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
    console.warn(`[Completeness] Found ${transformNodes.length} transform nodes - keeping only first`);
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
  
  console.log('[Completeness] Output:', { nodeCount: finalFilteredNodes.length, edgeCount: edges.length, nodeIds: finalFilteredNodes.map(n => n.id) });
  
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
        console.log(`[Backend Layout] Agent provided positions - using directly (manual editing preserved)`);
      }
      
      // Build from spec
      let specNodes: Node[] = spec.nodes.map((n: any, idx: number) => {
        const rawType = n.componentType || n.label || 'Table';
        const nodeId = n.id || `node-${idx}`;
        const compType = normalizeBoundaryType(rawType, n.label, nodeId) || rawType;
        const isBoundary = compType.toLowerCase().startsWith('account_boundary');
        
        // Debug boundary nodes from agent
        if (isBoundary) {
          console.log(`[Pipeline] Agent sent boundary node:`, {
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
            icon: isBoundary ? undefined : getIconForComponentType(compType),
            labelColor: getLabelColor(fillColor, fillAlpha, isDarkMode),
            isDarkMode,
            showHandles: !isBoundary,
            fillColor,
            fillAlpha,
            cornerRadius,
            hideBorder,
            layer: n.layer, // Preserve layer info from backend
            // background handled by CustomNode.tsx based on isDarkMode
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
          console.log(`[Pipeline] Filtering out boundary-label-as-node: "${label}" (id: ${n.id})`);
        }
        return !isBoundaryLabel;
      });
      
      specNodes = [...properBoundaries, ...filteredNonBoundaries];
      const strippedCount = beforeStripCount - specNodes.length;
      if (strippedCount > 0) {
        console.log(`[Pipeline] Stripped ${strippedCount} malformed boundary node(s) from spec`);
      }
      if (properBoundaries.length > 0) {
        console.log(`[Pipeline] Preserved ${properBoundaries.length} agent-provided boundary node(s):`, 
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
            console.warn(`🚫 [FDE Filter] Removing unwanted external component: ${id} / ${label} (user prompt: "${lastUserPromptRef.current.substring(0, 50)}...")`);
            return false;
          }
          return true;
        });
        
        const extFilterCount = beforeExtFilter - specNodes.length;
        if (extFilterCount > 0) {
          console.log(`[FDE Filter] Removed ${extFilterCount} external component(s) - user didn't request them`);
        }
        
        // Also filter out AWS-related boundaries
        specNodes = specNodes.filter(n => {
          const id = n.id.toLowerCase();
          const compType = ((n.data as any)?.componentType || '').toLowerCase();
          if (id.includes('aws') || compType.includes('aws')) {
            console.warn(`🚫 [FDE Filter] Removing AWS boundary: ${id}`);
            return false;
          }
          return true;
        });
      } else {
        console.log(`[FDE Filter] User requested external sources - keeping all components`);
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

      // Ensure medallion completeness FIRST (before normalization to preserve edges)
      const completed = ensureMedallionCompleteness(specNodes, specEdges);
      specNodes = completed.nodes;
      const cleanedSpecEdges = completed.edges.map((e) => ({
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
            icon: isBoundary ? undefined : getIconForComponentType(normalizedType || (n.data as any)?.label),
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
      const boundariesForLater = specNodes.filter((n) => {
        const compType = ((n.data as any)?.componentType || '').toString().toLowerCase();
        return compType.startsWith('account_boundary_');
      });
      // Double-check boundaries have proper styling with no icons
      const properlyStyledBoundaries = boundariesForLater.map(b => {
        const styled = ensureBoundaryStyle(b, isDarkMode);
        console.log(`[Pipeline] Boundary ${b.id} icon:`, (styled.data as any)?.icon, 'showHandles:', (styled.data as any)?.showHandles);
        return styled;
      });
      specNodes = specNodes.filter((n) => {
        const compType = ((n.data as any)?.componentType || '').toString().toLowerCase();
        return !compType.startsWith('account_boundary_');
      });
      console.log(`[Pipeline] Separated ${properlyStyledBoundaries.length} boundaries for preservation, ${specNodes.length} nodes for layout`);

      // ================================================================
      // ELK-BASED LAYOUT: Use professional graph layout algorithm
      // ELK.js provides automatic positioning based on flowStageOrder
      // This works for ANY architecture pattern and ANY component
      // Manual dragging still works after render (ReactFlow handles it)
      // ================================================================
      let laidOut: { nodes: Node[]; edges: Edge[] };
      
      if (hasBackendPositions) {
        // Backend provided explicit positions - use them directly
        console.log(`[Backend Layout] Using agent-provided positions`);
        laidOut = { nodes: specNodes, edges: cleanedSpecEdges };
      } else {
        // Use ELK.js for automatic layout based on flowStageOrder
        console.log(`[ELK Layout] Using ELK.js for automatic positioning`);
        
        // Enrich nodes with flowStageOrder if not provided by agent
        const enrichedNodes = enrichNodesWithFlowOrder(specNodes);
        
        // Apply ELK layout (async but we'll handle it)
        try {
          const elkResult = await layoutWithELK(enrichedNodes, cleanedSpecEdges);
          laidOut = elkResult;
          console.log(`[ELK Layout] Successfully positioned ${elkResult.nodes.length} nodes`);
        } catch (elkError) {
          console.warn(`[ELK Layout] Error, falling back to deterministic:`, elkError);
          // Fallback to existing layout if ELK fails
          laidOut = isMedallion(specNodes)
            ? layoutMedallionDeterministic(specNodes)
            : { nodes: layoutNodes(specNodes, cleanedSpecEdges), edges: cleanedSpecEdges };
        }
      }
      // Add back agent-provided boundaries (properly styled) before addAccountBoundaries
      const nodesWithAgentBoundaries = [...properlyStyledBoundaries, ...laidOut.nodes];
      console.log(`[Pipeline] After layout + agent boundaries: ${nodesWithAgentBoundaries.length} nodes (${properlyStyledBoundaries.length} from agent)`);
      const withBoundaries = addAccountBoundaries(nodesWithAgentBoundaries);
      console.log(`[Pipeline] After boundaries (spec): ${withBoundaries.length} nodes`);
      const fitted = fitCspNodesIntoBoundaries(withBoundaries);
      console.log(`[Pipeline] After fitting (spec): ${fitted.length} nodes`);
      const normalizedFinal = normalizeGraph(fitted, laidOut.edges);
      const enforcedBoundaries = enforceAccountBoundaries(normalizedFinal.nodes, normalizedFinal.edges, isDarkMode);
      
      // CRITICAL: Enforce consistent node sizes for handle alignment
      // All non-boundary nodes must have identical dimensions
      const STANDARD_NODE_WIDTH = 150;
      const STANDARD_NODE_HEIGHT = 130;
      
      const normalizedNodesWithSize = enforcedBoundaries.nodes.map(n => {
        const isBoundary = ((n.data as any)?.componentType || '').toLowerCase().startsWith('account_boundary');
        if (isBoundary) return n; // Keep boundary sizes as-is
        return {
          ...n,
          style: {
            ...(n.style || {}),
            width: STANDARD_NODE_WIDTH,
            height: STANDARD_NODE_HEIGHT,
          },
        };
      });
      
      const finalNodesWithStyle = normalizedNodesWithSize
        .map((n) =>
          ensureBoundaryStyle(
            n,
            (n.data as any)?.isDarkMode ?? isDarkMode
          )
        )
        .map(applyThemeToNode);
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
        // PRESERVE handles from layoutMedallionDeterministic if they exist
        // Only use pickHandle as fallback for edges without handles
        const hasExistingHandles = e.sourceHandle && e.targetHandle;
        const handles = hasExistingHandles 
          ? { sourceHandle: e.sourceHandle, targetHandle: e.targetHandle }
          : pickHandle(e.source, e.target);
        
        // Use 'straight' edges - they draw direct lines between handles without any routing
        // 'step' edges use a routing algorithm that creates intermediate waypoints (kinks)
        // For clean connections, we rely on proper handle selection (right->left, bottom->top)
        const edgeType = 'straight';
        
        return {
          ...e,
          ...handles,
          type: edgeType,
          animated: true,
          style: { stroke: isDarkMode ? '#60A5FA' : '#29B5E8', strokeWidth: 2.5 },  // Phase 3: Increased strokeWidth
        };
      });
      let finalNodes = enforcedBoundaries.nodes
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
      console.log(`[Pipeline] Final nodes to render: ${finalNodes.length} total, ${boundaries.length} boundaries, ${snowflakeLabeled.length} with 'Snowflake Account' label`);
      boundaries.forEach(b => {
        console.log(`[Pipeline] Final boundary ${b.id}:`, {
          componentType: (b.data as any)?.componentType,
          icon: (b.data as any)?.icon,
          label: (b.data as any)?.label,
          showHandles: (b.data as any)?.showHandles,
          styleBorder: (b.style as any)?.border,
          styleBackground: (b.style as any)?.background
        });
      });
      if (snowflakeLabeled.length > 1) {
        console.warn(`[Pipeline] ⚠️ Multiple nodes with 'Snowflake Account' label detected:`);
        snowflakeLabeled.forEach(n => {
          console.log(`  - ${n.id}: componentType="${(n.data as any)?.componentType}", icon=${(n.data as any)?.icon ? 'YES' : 'NO'}`);
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
            console.warn(`🚫 [FINAL GUARDRAIL] Removing: ${id} / ${label}`);
            return false;
          }
          return true;
        });
        
        // Also remove edges that reference removed nodes
        const validNodeIds = new Set(finalNodes.map(n => n.id));
        const beforeEdgeFilter = finalEdges.length;
        finalEdges = finalEdges.filter(e => validNodeIds.has(e.source) && validNodeIds.has(e.target));
        
        if (beforeFinalFilter !== finalNodes.length || beforeEdgeFilter !== finalEdges.length) {
          console.log(`[FINAL GUARDRAIL] Removed ${beforeFinalFilter - finalNodes.length} nodes, ${beforeEdgeFilter - finalEdges.length} edges`);
        }
      }
      // =============================================================================
      
      setNodes(finalNodes);
      setEdges(finalEdges);
      return;
    }

    const { nodes: newNodes, edges: newEdges } = convertMermaidToFlow(
      mermaidCode,
      COMPONENT_CATEGORIES,
      isDarkMode
    );
    console.log(`[Pipeline] After mermaid parse: ${newNodes.length} nodes, ${newEdges.length} edges`);
    // Ensure medallion completeness FIRST (before normalization to preserve edges)
    const nonBoundaryNodes = newNodes.filter(
      (n) => !(((n.data as any)?.componentType || '').toString().toLowerCase().startsWith('account_boundary'))
    );
    const completed = ensureMedallionCompleteness(nonBoundaryNodes, newEdges);
    console.log(`[Pipeline] After completeness: ${completed.nodes.length} nodes, ${completed.edges.length} edges`);
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
      if (Math.abs(dy) <= 20) {
        return {
          sourceHandle: dx >= 0 ? 'right-source' : 'left-source',
          targetHandle: dx >= 0 ? 'left-target' : 'right-target',
        };
      }
      
      // Fallback (should rarely reach here)
      return {
        sourceHandle: dy >= 0 ? 'bottom-source' : 'top-source',
        targetHandle: dy >= 0 ? 'top-target' : 'bottom-target',
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
          icon: isBoundary ? undefined : getIconForComponentType(normalizedType || (n.data as any)?.label),
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
      console.log(`[Pipeline] Mermaid boundary ${b.id} icon:`, (styled.data as any)?.icon, 'showHandles:', (styled.data as any)?.showHandles);
      return styled;
    });
    const finalNodes = nodesWithIcons.filter((n) => {
      const id = n.id.toLowerCase();
      const compType = ((n.data as any)?.componentType || '').toString().toLowerCase();
      return !(id.startsWith('account_boundary_') && compType.startsWith('account_boundary_'));
    });
    if (mermaidBoundaries.length > 0) {
      console.log(`[Pipeline] Preserved ${mermaidBoundaries.length} agent boundaries from mermaid:`, 
        mermaidBoundaries.map(b => b.id));
    }
    console.log(`[Pipeline] After separating boundaries (mermaid): ${finalNodes.length} nodes for layout`);

    const laidOut = isMedallion(finalNodes)
      ? layoutMedallionDeterministic(finalNodes)
      : { nodes: layoutNodes(finalNodes, completedEdges), edges: completedEdges };
    console.log(`[Pipeline] After layout: ${laidOut.nodes.length} nodes`);
    // Add back agent-provided boundaries before addAccountBoundaries
    const nodesWithMermaidBoundaries = [...mermaidBoundaries, ...laidOut.nodes];
    console.log(`[Pipeline] After layout + mermaid boundaries: ${nodesWithMermaidBoundaries.length} nodes (${mermaidBoundaries.length} from agent)`);
    const withBoundaries = addAccountBoundaries(nodesWithMermaidBoundaries);
    console.log(`[Pipeline] After boundaries: ${withBoundaries.length} nodes`);
    const fitted = fitCspNodesIntoBoundaries(withBoundaries);
    console.log(`[Pipeline] After fitting: ${fitted.length} nodes`);
    const normalizedFinal = normalizeGraph(fitted, laidOut.edges);
    console.log(`[Pipeline] After normalize (FINAL): ${normalizedFinal.nodes.length} nodes, ${normalizedFinal.edges.length} edges`);
    const enforcedBoundaries = enforceAccountBoundaries(normalizedFinal.nodes, normalizedFinal.edges, isDarkMode);
    
    // CRITICAL: Enforce consistent node sizes for handle alignment (Mermaid path)
    // All non-boundary nodes must have identical dimensions
    const STANDARD_WIDTH_MERMAID = 150;
    const STANDARD_HEIGHT_MERMAID = 130;
    
    const normalizedNodesWithSizeMermaid = enforcedBoundaries.nodes.map(n => {
      const isBoundary = ((n.data as any)?.componentType || '').toLowerCase().startsWith('account_boundary');
      if (isBoundary) return n; // Keep boundary sizes as-is
      return {
        ...n,
        style: {
          ...(n.style || {}),
          width: STANDARD_WIDTH_MERMAID,
          height: STANDARD_HEIGHT_MERMAID,
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
          console.warn(`🚫 [FINAL GUARDRAIL 2] Removing: ${id} / ${label}`);
          return false;
        }
        return true;
      });
      
      const validNodeIds2 = new Set(filteredNodesWithStyle.map(n => n.id));
      filteredEdges = filteredEdges.filter(e => validNodeIds2.has(e.source) && validNodeIds2.has(e.target));
      
      if (beforeFinalFilter2 !== filteredNodesWithStyle.length) {
        console.log(`[FINAL GUARDRAIL 2] Removed ${beforeFinalFilter2 - filteredNodesWithStyle.length} unwanted nodes`);
      }
    }
    // =============================================================================
    
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
                  const { r, g, b } = hexToRgb(newColor) || { r: 41, g: 181, b: 232 };
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
                        const { r, g, b } = hexToRgb(fillColor) || { r: 41, g: 181, b: 232 };
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
                  ['--thumb-color' as any]: fillColor,
                }}
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
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M7 16V4M7 4L3 8M7 4L11 8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M17 8V20M17 20L21 16M17 20L13 16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              
              {/* Delete Button - Red */}
              <button 
                className={`${styles.edgeIconButton} ${styles.edgeIconButtonDelete}`}
                onClick={deleteSelectedEdges}
                title={`Delete ${selectedEdges.length} connection${selectedEdges.length > 1 ? 's' : ''}`}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
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
                  copyNode(nodeMenu.nodeId);
                  setNodeMenu(null);
                }}
                title="Copy node"
              >
                Copy
              </button>
              <button
                className={`${styles.edgeIconButton} ${styles.edgeIconButtonDelete}`}
                onClick={() => {
                  deleteNode(nodeMenu.nodeId);
                  setNodeMenu(null);
                }}
                title="Delete node"
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
              />
              <button
                className={styles.chatSend}
                onClick={handleSendChat}
                disabled={!chatInput.trim() || chatSending}
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
