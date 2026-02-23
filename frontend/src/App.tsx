/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @next/next/no-img-element */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
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
import TextBoxNode from './components/TextBoxNode';
import ShapeNode from './components/ShapeNode';
import StickyNoteNode from './components/StickyNoteNode';
// SnowgramAgentClient removed - PAT must never be exposed in client-side bundle
import { convertMermaidToFlow, LAYER_COLORS, getStageColor } from './lib/mermaidToReactFlow';
import { layoutWithELK, enrichNodesWithFlowOrder, layoutWithLanes } from './lib/elkLayout';
import { resolveIcon } from './lib/iconResolver';
import { canonicalizeComponentType, keyForNode, normalizeBoundaryType, normalizeGraph } from './lib/graphNormalize';
import { hexToRgb as hexToRgbUtil, getLabelColor } from './lib/colorUtils';
import { generateMermaidFromDiagram } from './lib/mermaidExport';
import { boundingBox, layoutDAG, fitAllBoundaries, LAYOUT_CONSTANTS } from './lib/layoutUtils';
import { getFlowStageOrder } from './lib/elkLayoutUtils';
// PERF: Lazy load heavy markdown/syntax dependencies (~150KB bundle savings)
const ReactMarkdown = dynamic(() => import('react-markdown'), { ssr: false });
const SyntaxHighlighter = dynamic(
  () => import('react-syntax-highlighter').then(mod => mod.Prism),
  { ssr: false }
);
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { useSessionStorage, type ChatMessage, type SavedSession, type ToolResult } from './hooks/useSessionStorage';
// Material Icons for professional UI
import PsychologyIcon from '@mui/icons-material/Psychology';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import DataObjectIcon from '@mui/icons-material/DataObject';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AutorenewIcon from '@mui/icons-material/Autorenew';
// Multi-tab support
import { TabBar } from './components/TabBar';
import { useDiagramTabsStore, type DiagramTab } from './store/diagramTabsStore';

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
  // Conversation persistence - enables multi-turn dialogue
  threadId?: number;
  messageId?: number;
};

// Lane label node component for streaming architecture diagrams
const LaneLabelNode: React.FC<{ data: { label: string; backgroundColor?: string; textColor?: string } }> = ({ data }) => {
  // DEBUG: Log what data the component receives
  console.log(`[LaneLabelNode] Rendering label="${data.label}", backgroundColor="${data.backgroundColor}", textColor="${data.textColor}"`);
  
  const bgColor = data.backgroundColor || '#7C3AED';  // Default to PURPLE if not provided
  
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 4,
        background: bgColor,
        color: data.textColor || '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 'bold',
        fontSize: '14px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      }}
    >
      {data.label}
    </div>
  );
};

const nodeTypes: NodeTypes = {
  snowflakeNode: CustomNode,
  laneLabelNode: LaneLabelNode,
  textBox: TextBoxNode,
  shape: ShapeNode,
  stickyNote: StickyNoteNode,
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

  const isBoundary = (n: Node) => lowered((n.data as any)?.componentType).startsWith('account_boundary');

  // SIMPLIFIED APPROACH: Only two boundaries - External Sources (left) and Snowflake (right)
  // Following reference architecture: Sources → Snowflake (no separate AWS/Azure/GCP boundaries)
  // External keywords - nodes matching these go in "External Sources" boundary (LEFT of Snowflake)
  // IMPORTANT: "connector" and "snowpipe" keywords are Snowflake services, NOT external
  const externalKeywords = [
    's3', 'aws', 'kinesis', 'amazon_kinesis', 'ext_kinesis',
    'azure', 'adls', 'blob', 'event_hub', 'event_hubs', 'eventhub', 'ext_event_hub',
    'gcp', 'gcs', 'google', 'bigquery', 'bq', 'pub_sub', 'pubsub',
    'kafka', 'confluent', 'ext_kafka',
    'external', 'source', 'producer', 'firehose',
  ];
  
  // Snowflake service keywords - these stay INSIDE Snowflake boundary even if they mention external systems
  const snowflakeServiceKeywords = ['connector', 'snowpipe', 'stream', 'task', 'dynamic_table', 'spcs', 'snowpark'];
  
  // Check if node is a Snowflake service (takes priority over external keywords)
  const isSnowflakeService = (n: Node): boolean => {
    const text = `${lowered((n.data as any)?.label)} ${lowered((n.data as any)?.componentType)}`;
    return snowflakeServiceKeywords.some(k => text.includes(k));
  };
  
  // Check if node is external (but NOT if it's a Snowflake service)
  const isExternal = (n: Node): boolean => {
    if (isSnowflakeService(n)) return false; // Snowflake services stay in Snowflake
    const text = `${lowered((n.data as any)?.label)} ${lowered((n.data as any)?.componentType)}`;
    return externalKeywords.some(k => text.includes(k));
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

  // Partition nodes into two groups: External and Snowflake
  // Exclude lane/section label nodes from boundary calculation - they should render OUTSIDE the boundary
  const isLabelNode = (n: Node) => n.type === 'laneLabelNode' || (n.data as any)?.isBadgeNode === true;
  const nonBoundaryNodes = nodes.filter((n) => !isBoundary(n));
  const externalNodes = nonBoundaryNodes.filter(n => isExternal(n));
  const snowflakeNodes = nonBoundaryNodes.filter(n => !isExternal(n) && !isLabelNode(n));
  const labelNodes = nonBoundaryNodes.filter(n => isLabelNode(n));
  
  debugLog(`[addAccountBoundaries] External: ${externalNodes.length}, Snowflake: ${snowflakeNodes.length}, Labels: ${labelNodes.length}`);

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
  const externalBox = bbox(externalNodes);
  
  debugLog(`[addAccountBoundaries] Snowflake box:`, snowBox, `existing:`, existingBoundary['account_boundary_snowflake']);
  debugLog(`[addAccountBoundaries] External box:`, externalBox, `existing:`, existingBoundary['account_boundary_external']);

  // Track repositioning offsets for external node groups
  const nodeOffsets = new Map<string, { dx: number; dy: number }>(); // nodeId → offset

  // Create Snowflake boundary (always on the RIGHT)
  if (snowBox && !existingBoundary['account_boundary_snowflake']) {
    debugLog(`[addAccountBoundaries] ✅ Creating Snowflake boundary (not provided by agent)`);
    boundaries.push(makeBoundary('account_boundary_snowflake', 'Snowflake Account', '#29B5E8', snowBox, isDark));
  } else if (existingBoundary['account_boundary_snowflake']) {
    debugLog(`[addAccountBoundaries] ⏭️  Skipping Snowflake boundary (already exists from agent)`);
  }

  // Create single "External Sources" boundary (always on the LEFT of Snowflake)
  // This replaces the old multiple AWS/Azure/GCP/Kafka boundaries
  if (externalBox && externalNodes.length > 0 && !existingBoundary['account_boundary_external']) {
    debugLog(`[addAccountBoundaries] ✅ Creating External Sources boundary (not provided by agent)`);
    
    // Calculate boundary dimensions
    const width = (externalBox.maxX - externalBox.minX) + padX * 2;
    
    // Position external boundary to the left of Snowflake
    const leftX = snowBox ? snowBox.minX - padX - BOUNDARY_GAP - width : externalBox.minX - padX;
    const box = snowBox
      ? { minX: leftX, minY: externalBox.minY - padY, maxX: leftX + width, maxY: externalBox.maxY + padY }
      : externalBox;
    
    boundaries.push(makeBoundary('account_boundary_external', 'External Sources', '#6B7280', box, isDark));
    
    // Reposition external nodes into the new boundary position
    if (snowBox) {
      const dx = (box.minX + padX) - externalBox.minX;
      externalNodes.forEach(n => nodeOffsets.set(n.id, { dx, dy: 0 }));
    }
  } else if (existingBoundary['account_boundary_external']) {
    debugLog(`[addAccountBoundaries] ⏭️  Skipping External Sources boundary (already exists from agent)`);
  }

  // Collect existing boundaries from input
  const existingBoundaryNodes = nodes.filter((n) => isBoundary(n));
  
  debugLog(`[addAccountBoundaries] Created ${boundaries.length} new boundaries, found ${existingBoundaryNodes.length} existing boundaries`);
  
  // Recalculate positions for agent-provided boundaries based on actual node positions
  const recalculatedBoundaries = existingBoundaryNodes.map(boundary => {
    const compType = lowered((boundary.data as any)?.componentType);
    
    // Find nodes that should be inside this boundary
    let containedNodes: Node[] = [];
    let rawBox: ReturnType<typeof bbox> = null;
    
    if (compType === 'account_boundary_snowflake') {
      containedNodes = snowflakeNodes;
      rawBox = snowBox;
    } else if (compType.includes('external') || compType.includes('source') || compType.includes('kafka') || 
               compType.includes('aws') || compType.includes('azure') || compType.includes('gcp')) {
      // Treat any external-related boundary as containing external nodes
      containedNodes = externalNodes;
      rawBox = externalBox;
    }
    
    if (!rawBox) {
      debugLog(`[addAccountBoundaries] No box for ${compType}, keeping original dimensions`);
      return boundary;
    }
    
    debugLog(`[addAccountBoundaries] Recalculating ${compType} boundary from ${containedNodes.length} nodes`);
    
    // Apply spacing logic: external boundaries positioned to the left of Snowflake
    let finalPosition = { x: rawBox.minX - padX, y: rawBox.minY - padYTop };
    const finalSize = {
      width: (rawBox.maxX - rawBox.minX) + padX * 2,
      height: (rawBox.maxY - rawBox.minY) + padYTop + padYBottom
    };
    
    // Reposition external boundary to LEFT of Snowflake
    const isExternalBoundary = compType !== 'account_boundary_snowflake';
    if (isExternalBoundary && snowBox) {
      const boundaryWidth = (rawBox.maxX - rawBox.minX) + padX * 2;
      const leftX = snowBox.minX - padX - BOUNDARY_GAP - boundaryWidth;
      finalPosition = { x: leftX, y: rawBox.minY - padYTop };
      // Calculate offset for nodes so they move with the boundary
      const dx = (leftX + padX) - rawBox.minX;
      containedNodes.forEach(n => nodeOffsets.set(n.id, { dx, dy: 0 }));
      debugLog(`[addAccountBoundaries] Repositioning ${compType}: final leftX=${leftX}, node dx=${dx}`);
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

// REMOVED: layoutMedallionDeterministic - hardcoded medallion layout
// Now using edge-based layout for ALL architectures (layoutWithELK)
// This enables truly agentic diagram generation where any pattern works

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
  const [showSessionList, setShowSessionList] = useState(false);
  
  // Session storage for multi-turn persistent chat
  const {
    currentSessionId,
    savedSessions,
    isLoadingSession,
    createNewSession,
    loadSession,
    saveSession,
    deleteSession,
    initializeSessions
  } = useSessionStorage();
  
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', text: 'Tell me what to build. I will refine the diagram and keep context.', timestamp: new Date().toISOString() },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  // Track tool calls during streaming for visibility
  const [activeToolCalls, setActiveToolCalls] = useState<string[]>([]);
  // Track which messages have expanded thinking sections
  const [expandedThinking, setExpandedThinking] = useState<Set<number>>(new Set());
  // Track which tool results are expanded (key: "msgIdx-toolIdx")
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  // Track which JSON spec sections are expanded (key: msgIdx)
  const [expandedJsonSpec, setExpandedJsonSpec] = useState<Set<number>>(new Set());
  // Track which Mermaid sections are expanded (key: msgIdx)
  const [expandedMermaid, setExpandedMermaid] = useState<Set<number>>(new Set());
  // Track closing animations
  const [closingThinking, setClosingThinking] = useState<Set<number>>(new Set());
  const [closingTools, setClosingTools] = useState<Set<string>>(new Set());
  const [closingJsonSpec, setClosingJsonSpec] = useState<Set<number>>(new Set());
  const [closingMermaid, setClosingMermaid] = useState<Set<number>>(new Set());
  // Conversation persistence - enables multi-turn dialogue with the agent
  const [conversationThreadId, setConversationThreadId] = useState<number | null>(null);
  const [lastMessageId, setLastMessageId] = useState<number | null>(null);
  const [chatPos, setChatPos] = useState<{ x: number; y: number }>({ x: 120, y: 520 });
  const [chatSize, setChatSize] = useState<{ width: number; height: number }>({ width: 440, height: 520 });
  const [chatDragging, setChatDragging] = useState(false);
  const [chatResizing, setChatResizing] = useState<string | null>(null); // 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'
  const [clearSpin, setClearSpin] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  // Grid snapping - enabled by default, hold Shift for free movement
  const [snapEnabled, setSnapEnabled] = useState(true);
  const chatDragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const chatResizeStart = useRef<{ x: number; y: number; width: number; height: number; posX: number; posY: number }>({ x: 0, y: 0, width: 440, height: 520, posX: 0, posY: 0 });
  // History for multi-step undo
  const historyRef = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const historyIndexRef = useRef(-1);
  const skipHistoryRef = useRef(false);
  const historyLimit = 50;
  const lastSnapshotRef = useRef<string | null>(null);
  
  // BUG-007 FIX: Abort controller for parseMermaidAndCreateDiagram race condition
  const parseAbortControllerRef = useRef<AbortController | null>(null);

  // ============================================
  // MULTI-TAB STATE MANAGEMENT
  // ============================================
  const {
    tabs,
    activeTabId,
    createTab,
    switchTab,
    closeTab,
    updateTabContent,
    updateTabViewport,
    updateTabChat,
    getActiveTab,
  } = useDiagramTabsStore();
  
  // Track if we're in the middle of a tab switch to avoid update loops
  const isTabSwitchingRef = useRef(false);
  // Track the previous active tab ID to detect tab switches
  const prevActiveTabIdRef = useRef<string | null>(null);
  // Debounce timer for tab content updates
  const tabUpdateTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Track hydration state to avoid calling store methods before hydration completes
  const [isHydrated, setIsHydrated] = useState(false);
  
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // TEST HOOK: Expose parseMermaidAndCreateDiagram for visual testing
  // This enables automated visual quality testing via Playwright
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).generateDiagram = async (mermaidCode: string) => {
        try {
          await parseMermaidAndCreateDiagram(mermaidCode);
          return true;
        } catch (e) {
          console.error('[Test Hook] generateDiagram error:', e);
          return false;
        }
      };
      debugLog('[Test Hook] window.generateDiagram registered');
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).generateDiagram;
      }
    };
  }, []);
  
  // Initialize with a default tab if none exist (only after hydration)
  useEffect(() => {
    if (isHydrated && tabs.length === 0) {
      createTab('Untitled');
    }
  }, [isHydrated, tabs.length, createTab]);

  // Sync ReactFlow state with active tab when tab changes
  useEffect(() => {
    if (!activeTabId || activeTabId === prevActiveTabIdRef.current) return;
    
    const activeTab = getActiveTab();
    if (!activeTab) return;
    
    // Mark that we're switching tabs
    isTabSwitchingRef.current = true;
    
    // Restore nodes and edges from the active tab
    setNodes(activeTab.nodes);
    setEdges(activeTab.edges);
    
    // Restore viewport if ReactFlow instance is available
    if (reactFlowInstance && activeTab.viewport) {
      setTimeout(() => {
        reactFlowInstance.setViewport(activeTab.viewport);
      }, 50);
    }
    
    // Restore chat state for this tab
    if (activeTab.threadId !== undefined) {
      setConversationThreadId(activeTab.threadId);
      setLastMessageId(activeTab.lastMessageId);
    }
    
    // Update ref after state changes
    prevActiveTabIdRef.current = activeTabId;
    
    // Clear the switching flag after a short delay
    setTimeout(() => {
      isTabSwitchingRef.current = false;
    }, 100);
  }, [activeTabId, getActiveTab, setNodes, setEdges, reactFlowInstance]);

  // Sync current nodes/edges back to active tab (debounced)
  useEffect(() => {
    // Skip if we're in the middle of a tab switch
    if (isTabSwitchingRef.current || !activeTabId) return;
    
    // Clear existing timer
    if (tabUpdateTimerRef.current) {
      clearTimeout(tabUpdateTimerRef.current);
    }
    
    // Debounce the update to avoid excessive writes during drag operations
    tabUpdateTimerRef.current = setTimeout(() => {
      updateTabContent(activeTabId, nodes, edges);
    }, 300);
    
    return () => {
      if (tabUpdateTimerRef.current) {
        clearTimeout(tabUpdateTimerRef.current);
      }
    };
  }, [nodes, edges, activeTabId, updateTabContent]);

  // Handle tab switch - save viewport before switching
  const handleTabSwitch = useCallback((newTabId: string) => {
    if (activeTabId && reactFlowInstance) {
      // Save current viewport before switching
      const viewport = reactFlowInstance.getViewport();
      updateTabViewport(activeTabId, viewport);
    }
    switchTab(newTabId);
  }, [activeTabId, reactFlowInstance, switchTab, updateTabViewport]);

  // Sync conversation state to active tab when it changes
  useEffect(() => {
    if (activeTabId && conversationThreadId !== null) {
      updateTabChat(activeTabId, conversationThreadId, lastMessageId);
    }
  }, [conversationThreadId, lastMessageId, activeTabId, updateTabChat]);

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

  // Initialize sessions on mount
  useEffect(() => {
    const { sessionData } = initializeSessions();
    if (sessionData) {
      setChatMessages(sessionData.messages.length > 0 ? sessionData.messages : [
        { role: 'assistant', text: 'Tell me what to build. I will refine the diagram and keep context.', timestamp: new Date().toISOString() }
      ]);
      setConversationThreadId(sessionData.threadId);
      setLastMessageId(sessionData.lastMessageId);
      debugLog('[Session] Restored session:', { 
        messageCount: sessionData.messages.length,
        threadId: sessionData.threadId 
      });
    }
    
    // Also restore chat position from localStorage
    try {
      const stored = localStorage.getItem('snowgram.chatPos');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.pos && typeof parsed.pos.x === 'number' && typeof parsed.pos.y === 'number') {
          setChatPos(clampChatPos(parsed.pos));
        }
        if (typeof parsed.open === 'boolean') setChatOpen(parsed.open);
      }
    } catch (e) {
      console.warn('Failed to load chat position from storage', e);
    }
  }, [clampChatPos, initializeSessions]);

  // Auto-save session when messages or thread change
  useEffect(() => {
    if (currentSessionId && !isLoadingSession.current) {
      saveSession(currentSessionId, chatMessages, conversationThreadId, lastMessageId);
    }
  }, [chatMessages, conversationThreadId, lastMessageId, currentSessionId, saveSession]);

  // Save chat position separately (not per-session)
  useEffect(() => {
    try {
      localStorage.setItem('snowgram.chatPos', JSON.stringify({ pos: chatPos, open: chatOpen }));
    } catch (e) {
      console.warn('Failed to persist chat position', e);
    }
  }, [chatPos, chatOpen]);

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

  // Alt/Option key toggles grid snapping (hold Alt for free movement)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setSnapEnabled(false);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setSnapEnabled(true);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

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
        type: 'smoothstep',  // Orthogonal routing with rounded corners
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

  // Update text for TextBox/StickyNote nodes
  const updateNodeText = useCallback(
    (nodeId: string, newText: string) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, text: newText } }
            : node
        )
      );
    },
    [setNodes]
  );

  // Update label for Shape nodes
  const updateShapeLabel = useCallback(
    (nodeId: string, newLabel: string) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, label: newLabel } }
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

      // Check if this is a shape/annotation component (has nodeType property)
      if (component.nodeType) {
        let newNode: Node;
        const nodeId = `${component.nodeType}_${Date.now()}`;
        const rgbFill = hexToRgbUtil(fillColor) || { r: 41, g: 181, b: 232 };

        switch (component.nodeType) {
          case 'textBox':
            newNode = {
              id: nodeId,
              type: 'textBox',
              position,
              style: { width: 200, height: 80 },
              data: {
                text: '',
                fontSize: 14,
                textAlign: 'left',
                showBorder: true,
                borderColor: fillColor,
                backgroundColor: `rgba(${rgbFill.r},${rgbFill.g},${rgbFill.b},${fillAlpha})`,
                showHandles: true,
                isDarkMode,
                onTextChange: updateNodeText,
              },
            };
            break;

          case 'stickyNote':
            newNode = {
              id: nodeId,
              type: 'stickyNote',
              position,
              style: { width: 180, height: 150 },
              data: {
                text: '',
                color: 'yellow',
                fontSize: 13,
                showHandles: true,
                isDarkMode,
                onTextChange: updateNodeText,
              },
            };
            break;

          case 'shape':
            newNode = {
              id: nodeId,
              type: 'shape',
              position,
              style: { width: 120, height: 80 },
              data: {
                shapeType: component.shapeType || 'rectangle',
                label: '',
                width: 120,
                height: 80,
                fillColor: `rgba(${rgbFill.r},${rgbFill.g},${rgbFill.b},${fillAlpha})`,
                strokeColor: fillColor,
                strokeWidth: 2,
                isDarkMode,
                onLabelChange: updateShapeLabel,
              },
            };
            break;

          default:
            return; // Unknown nodeType, skip
        }

        setNodes((nds) => nds.concat(newNode));
        return;
      }

      // Standard Snowflake component handling (existing logic)
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
    [reactFlowInstance, setNodes, isDarkMode, deleteNode, renameNode, fillColor, fillAlpha, cornerRadius, updateNodeText, updateShapeLabel]
  );

  // Update all existing nodes when dark mode changes
  React.useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        const baseData = {
          ...node.data,
          isDarkMode,
        };
        
        // Add appropriate callbacks based on node type
        if (node.type === 'textBox' || node.type === 'stickyNote') {
          return {
            ...node,
            data: {
              ...baseData,
              onTextChange: updateNodeText,
            },
          };
        } else if (node.type === 'shape') {
          return {
            ...node,
            data: {
              ...baseData,
              onLabelChange: updateShapeLabel,
            },
          };
        } else {
          // Standard snowflakeNode
          return {
            ...node,
            data: {
              ...baseData,
              labelColor: (node.data as any)?.labelColor
                || (isDarkMode ? '#E5EDF5' : '#0F172A'),
              onDelete: deleteNode,
              onRename: renameNode,
            },
          };
        }
      })
    );
  }, [isDarkMode, setNodes, deleteNode, renameNode, updateNodeText, updateShapeLabel]);

  // Recompute label colors on theme change to ensure contrast
  React.useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        // Skip shape/annotation nodes - they handle their own colors
        if (node.type === 'textBox' || node.type === 'stickyNote' || node.type === 'shape') {
          return node;
        }
        
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

  const callAgent = async (query: string, threadId?: number): Promise<AgentResult> => {
    // All agent calls go through the secure backend proxy
    // Pass threadId for conversation continuity (multi-turn dialogue)
    const resp = await fetch('/api/agent/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, threadId }),
    });
    if (!resp.ok) {
      throw new Error('Unable to generate architecture. Please try again later.');
    }
    const data: AgentResult = await resp.json();
    
    // Update conversation thread for subsequent messages
    if (data.threadId) {
      setConversationThreadId(data.threadId);
      debugLog('[Chat] Conversation thread:', data.threadId);
    }
    
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

// =============================================================================
// AGENTIC ARCHITECTURE: Pass-through function
// The agent is the source of truth for topology. Frontend just renders.
// This enables "chat with your diagram" - any architecture pattern works.
// =============================================================================
const ensureMedallionCompleteness = (inputNodes: Node[], inputEdges: Edge[]) => {
  // AGENT-FIRST: Trust the agent output completely
  // No forced nodes, no blocked edges, no ID remapping
  // The agent decides what components exist and how they connect
  debugLog('[Completeness] Agent-first mode: passing through nodes/edges unchanged');
  debugLog('[Completeness] Input:', { nodeCount: inputNodes.length, edgeCount: inputEdges.length });
  
  // Simply return the input as-is - the agent is the source of truth
  return { nodes: inputNodes, edges: inputEdges };
};

  // Handle AI generation (single shot)
  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) return;
    lastUserPromptRef.current = aiPrompt.trim(); // Store for external source detection
    setIsGenerating(true);
    try {
      // Pass threadId for conversation continuity even in single-shot mode
      const data = await callAgent(aiPrompt, conversationThreadId ?? undefined);
      if (data) await parseMermaidAndCreateDiagram(data.mermaidCode, data.spec);
    } catch (error) {
      console.error('AI generation error:', error);
      alert('Failed to generate diagram. Ensure PAT or backend proxy is configured.');
    } finally {
      setIsGenerating(false);
      setAiPrompt('');
    }
  };

  // Session management handlers
  const handleNewSession = useCallback(() => {
    createNewSession();
    setChatMessages([
      { role: 'assistant', text: 'Tell me what to build. I will refine the diagram and keep context.', timestamp: new Date().toISOString() }
    ]);
    setConversationThreadId(null);
    setLastMessageId(null);
    setShowSessionList(false);
    setActiveToolCalls([]);
    debugLog('[Session] Started new session');
  }, [createNewSession]);

  const handleSwitchSession = useCallback((sessionId: string) => {
    const sessionData = loadSession(sessionId);
    if (sessionData) {
      setChatMessages(sessionData.messages.length > 0 ? sessionData.messages : [
        { role: 'assistant', text: 'Tell me what to build. I will refine the diagram and keep context.', timestamp: new Date().toISOString() }
      ]);
      setConversationThreadId(sessionData.threadId);
      setLastMessageId(sessionData.lastMessageId);
    } else {
      setChatMessages([
        { role: 'assistant', text: 'Tell me what to build. I will refine the diagram and keep context.', timestamp: new Date().toISOString() }
      ]);
      setConversationThreadId(null);
      setLastMessageId(null);
    }
    setShowSessionList(false);
    setActiveToolCalls([]);
    debugLog('[Session] Switched to session:', sessionId);
  }, [loadSession]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    const newSessionId = deleteSession(sessionId);
    if (newSessionId) {
      handleSwitchSession(newSessionId);
    }
  }, [deleteSession, handleSwitchSession]);

  // Chat send handler (multi-turn) with SSE streaming
  const handleSendChat = async () => {
    if (!chatInput.trim() || chatSending) return;
    const userMessage = chatInput.trim();
    lastUserPromptRef.current = userMessage; // Store for external source detection
    setChatSending(true);
    const userMsg: ChatMessage = { role: 'user', text: userMessage, timestamp: new Date().toISOString() };
    const history = [...chatMessages, userMsg];
    setChatMessages(history);
    setChatInput('');

    const transcript = history
      .map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.text}`)
      .join('\n');

    // Provide current canvas state (mermaid) to the agent before the prompt
    const enrichedPrompt = `You are the SnowGram Cortex Agent. First review the existing canvas before making changes. Here is the current diagram in Mermaid (derived from the live canvas):\n\n${currentMermaid}\n\nThen continue the conversation below and apply updates based on the user's new request. If needed, adjust or refine the existing layout rather than recreating from scratch.\n\nConversation:\n${transcript}\nAgent:`;

    try {
      // Add placeholder for streaming response
      setChatMessages((msgs) => [...msgs, { role: 'assistant', text: '...', timestamp: new Date().toISOString() }]);
      
      const response = await fetch('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: enrichedPrompt, 
          threadId: conversationThreadId,
          parentMessageId: lastMessageId || 0
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[Chat] Stream request failed:', response.status, errorBody);
        throw new Error(`Stream request failed: ${response.status} - ${errorBody}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let streamedText = '';
      let streamedThinking = '';
      let fullText = '';
      let toolExtractedMermaid = '';  // Track Mermaid extracted from tool results

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;

          try {
            const data = JSON.parse(payload);
            
            if (data.type === 'thread' && data.threadId) {
              setConversationThreadId(data.threadId);
              debugLog('[Chat] Thread ID:', data.threadId);
            } else if (data.type === 'thinking' && data.text) {
              // Accumulate thinking text
              streamedThinking += data.text;
              setChatMessages((msgs) => {
                const updated = [...msgs];
                updated[updated.length - 1] = { 
                  ...updated[updated.length - 1],
                  thinking: streamedThinking
                };
                return updated;
              });
            } else if (data.type === 'tool_use' && data.tool) {
              // Track tool calls for visibility (CKE, web search, etc.)
              const toolName = data.tool.name || data.tool.tool_name || 
                (data.tool.tool_calls?.[0]?.name) || 'Tool';
              debugLog('[Chat] Tool use:', toolName, data.tool);
              setActiveToolCalls(prev => [...prev, toolName]);
              // Show tool execution in chat
              setChatMessages((msgs) => {
                const updated = [...msgs];
                const currentTools = updated[updated.length - 1].toolCalls || [];
                if (!currentTools.includes(toolName)) {
                  updated[updated.length - 1] = { 
                    ...updated[updated.length - 1],
                    toolCalls: [...currentTools, toolName]
                  };
                }
                return updated;
              });
            } else if (data.type === 'tool_result' && data.result) {
              // Tool result received - store full result for expandable display
              debugLog('[Chat] Tool result:', data.result);
              const toolName = data.result.name || 'search';
              const rawResult = data.result.result || data.result.content || data.result;
              const toolResult = {
                name: toolName,
                result: rawResult,
                input: data.result.input || data.result.parameters
              };
              
              // Extract JSON spec and Mermaid from COMPOSE_DIAGRAM_FROM_TEMPLATE result
              let extractedJsonSpec: string | undefined;
              let extractedMermaid: string | undefined;
              
              if (toolName === 'COMPOSE_DIAGRAM_FROM_TEMPLATE' && rawResult) {
                const resultStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
                
                // Check if result is raw Mermaid code (common output format)
                const isMermaidCode = resultStr.trim().match(/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart|sankey|block)/i);
                if (isMermaidCode) {
                  extractedMermaid = resultStr.trim();
                } else {
                  // Try to extract Mermaid from fenced block
                  const mermaidMatch = resultStr.match(/```mermaid\s*([\s\S]*?)```/);
                  if (mermaidMatch) {
                    extractedMermaid = mermaidMatch[1].trim();
                  } else if (typeof rawResult === 'object' && rawResult.mermaid) {
                    extractedMermaid = rawResult.mermaid;
                  } else if (typeof rawResult === 'object' && rawResult.mermaid_code) {
                    extractedMermaid = rawResult.mermaid_code;
                  }
                }
                
                // Try to extract JSON block
                const jsonMatch = resultStr.match(/```json\s*([\s\S]*?)```/);
                if (jsonMatch) {
                  extractedJsonSpec = jsonMatch[1].trim();
                } else if (typeof rawResult === 'object' && rawResult.json_spec) {
                  extractedJsonSpec = typeof rawResult.json_spec === 'string' 
                    ? rawResult.json_spec 
                    : JSON.stringify(rawResult.json_spec, null, 2);
                }
              }
              
              // Also extract from other diagram-generating tools
              if ((toolName.includes('COMPOSE') || toolName.includes('DIAGRAM') || toolName.includes('GENERATE')) && rawResult && !extractedMermaid) {
                const resultStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
                const isMermaidCode = resultStr.trim().match(/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart|sankey|block)/i);
                if (isMermaidCode) {
                  extractedMermaid = resultStr.trim();
                }
              }
              
              // CRITICAL: Store extracted Mermaid for use in final diagram processing
              // This ensures tool result Mermaid is used even if agent doesn't include it in text response
              if (extractedMermaid) {
                toolExtractedMermaid = extractedMermaid;
                debugLog('[Chat] Extracted Mermaid from tool result:', extractedMermaid.slice(0, 100) + '...');
              }
              
              // Update the tool call status and store the result
              setChatMessages((msgs) => {
                const updated = [...msgs];
                const lastMsg = updated[updated.length - 1];
                // Add a completion marker and store the full result
                const completedTools = lastMsg.completedTools || [];
                const toolResults = lastMsg.toolResults || [];
                if (!completedTools.includes(toolName)) {
                  updated[updated.length - 1] = { 
                    ...lastMsg,
                    completedTools: [...completedTools, toolName],
                    toolResults: [...toolResults, toolResult],
                    // Store extracted artifacts if found
                    jsonSpec: extractedJsonSpec || lastMsg.jsonSpec,
                    mermaidCode: extractedMermaid || lastMsg.mermaidCode
                  };
                }
                return updated;
              });
            } else if (data.type === 'status' && data.message) {
              // Status update from backend - could show in UI
              debugLog('[Chat] Status:', data.message);
            } else if (data.type === 'tool' && data.tool) {
              // Legacy tool format - same as tool_use
              const toolName = data.tool.name || data.tool.tool_name || 
                (data.tool.tool_calls?.[0]?.name) || 'Tool';
              debugLog('[Chat] Tool call:', toolName, data.tool);
              setActiveToolCalls(prev => [...prev, toolName]);
              setChatMessages((msgs) => {
                const updated = [...msgs];
                const currentTools = updated[updated.length - 1].toolCalls || [];
                if (!currentTools.includes(toolName)) {
                  updated[updated.length - 1] = { 
                    ...updated[updated.length - 1],
                    toolCalls: [...currentTools, toolName]
                  };
                }
                return updated;
              });
            } else if (data.type === 'chunk' && data.text) {
              streamedText += data.text;
              
              // Extract code blocks progressively during streaming for dropdown display
              // Complete JSON block
              const jsonMatch = streamedText.match(/```json\s*([\s\S]*?)```/);
              const streamingJsonSpec = jsonMatch ? jsonMatch[1].trim() : undefined;
              // Incomplete JSON block (still streaming)
              const incompleteJsonMatch = !jsonMatch && streamedText.match(/```json\s*([\s\S]*?)$/);
              const partialJsonSpec = incompleteJsonMatch ? incompleteJsonMatch[1].trim() : undefined;
              
              // Complete Mermaid block
              const mermaidMatch = streamedText.match(/```mermaid\s*([\s\S]*?)```/);
              const streamingMermaidCode = mermaidMatch ? mermaidMatch[1].trim() : undefined;
              // Incomplete Mermaid block (still streaming)
              const incompleteMermaidMatch = !mermaidMatch && streamedText.match(/```mermaid\s*([\s\S]*?)$/);
              const partialMermaidCode = incompleteMermaidMatch ? incompleteMermaidMatch[1].trim() : undefined;
              
              // Use complete or partial code for dropdown display
              const currentJsonSpec = streamingJsonSpec || partialJsonSpec;
              const currentMermaidCode = streamingMermaidCode || partialMermaidCode;
              
              // Strip code blocks from display text (they're shown in dropdowns instead)
              let displayText = streamedText
                .replace(/```json[\s\S]*?```/g, '')
                .replace(/```mermaid[\s\S]*?```/g, '')
                .replace(/```json[\s\S]*/g, '') // Handle incomplete json blocks
                .replace(/```mermaid[\s\S]*/g, '') // Handle incomplete mermaid blocks
                // Strip raw flowchart/graph syntax (not wrapped in fences)
                // Must match anywhere (not just line start) and strip to end of string
                .replace(/(flowchart|graph)\s+(LR|TD|TB|RL|BT)\b[\s\S]*$/i, '')
                // Also strip JSON spec blocks that aren't in code fences
                .replace(/\{\s*"nodes"\s*:\s*\[[\s\S]*$/i, '')
                .trim();
              
              // Show progress indicator when code is streaming into dropdown
              if (!displayText && (currentJsonSpec || currentMermaidCode)) {
                displayText = currentMermaidCode ? 'Generating diagram...' : 'Generating specification...';
              } else if (displayText.length > 2000) {
                // Only truncate very long responses for UI performance
                displayText = displayText.substring(0, 2000) + '...';
              }
              
              setChatMessages((msgs) => {
                const updated = [...msgs];
                const lastMsg = updated[updated.length - 1];
                updated[updated.length - 1] = { 
                  ...lastMsg,
                  role: 'assistant', 
                  text: displayText || 'Thinking...',
                  timestamp: lastMsg.timestamp || new Date().toISOString(),
                  // Update code artifacts progressively for dropdown display
                  jsonSpec: currentJsonSpec || lastMsg.jsonSpec,
                  mermaidCode: currentMermaidCode || lastMsg.mermaidCode
                };
                return updated;
              });
            } else if (data.type === 'done') {
              fullText = data.fullText || streamedText;
              // Capture message_id for multi-turn continuity
              if (data.messageId) {
                setLastMessageId(data.messageId);
                debugLog('[Chat] Message ID captured:', data.messageId);
              }
            } else if (data.type === 'metadata' && data.messageId) {
              // Alternative: capture message_id from metadata event
              setLastMessageId(data.messageId);
              debugLog('[Chat] Message ID from metadata:', data.messageId);
            } else if (data.type === 'error') {
              // Set error message and break out of streaming
              setChatMessages((msgs) => {
                const updated = [...msgs];
                updated[updated.length - 1] = { role: 'assistant', text: `Error: ${data.error}`, timestamp: new Date().toISOString() };
                return updated;
              });
              setChatSending(false);
              return; // Exit early on error
            }
          } catch (parseErr) {
            // Ignore JSON parse errors for malformed chunks - these are expected
            // during streaming when chunks split across JSON boundaries
          }
        }
      }

      // Fallback: use streamedText if no 'done' event was received
      if (!fullText && streamedText) {
        fullText = streamedText;
      }

      // Parse the full response and update diagram
      if (fullText || toolExtractedMermaid) {
        const specMatch = fullText.match(/```json\n([\s\S]*?)\n```/);
        let spec = undefined;
        if (specMatch) {
          try {
            spec = JSON.parse(specMatch[1]);
          } catch {}
        }
        const mermaidMatch = fullText.match(/```mermaid\n([\s\S]*?)\n```/);
        // CRITICAL FIX: Use Mermaid from tool result if not in agent's text response
        const mermaidCode = mermaidMatch ? mermaidMatch[1] : toolExtractedMermaid;
        
        if (spec || mermaidCode) {
          debugLog('[Chat] Rendering diagram - mermaidCode length:', mermaidCode.length, 'from:', mermaidMatch ? 'text response' : 'tool result');
          await parseMermaidAndCreateDiagram(mermaidCode, spec);
        }

        // Extract overview for final message - look for Architecture Overview section
        const overviewMatch = fullText.match(/##\s*Architecture Overview\s*\n([\s\S]*?)(?=\n##\s|```|$)/i);
        const overview = overviewMatch ? overviewMatch[1].trim() : '';
        
        // Final message - preserve markdown formatting for ReactMarkdown to render
        // Strip code blocks and artifact section headers (shown in dropdowns instead)
        let finalMessage = '';
        if (overview) {
          // Use the extracted overview as-is (preserves markdown)
          finalMessage = overview;
        } else {
          // Fallback: strip code blocks but preserve markdown formatting
          finalMessage = fullText
            .replace(/```json[\s\S]*?```/g, '')
            .replace(/```mermaid[\s\S]*?```/g, '')
            .replace(/```[\s\S]*?```/g, '')
            // Strip raw flowchart/graph syntax (not wrapped in fences)
            // Must match anywhere (not just line start) and strip to end of string
            .replace(/(flowchart|graph)\s+(LR|TD|TB|RL|BT)\b[\s\S]*$/i, '')
            // Also strip JSON spec blocks that aren't in code fences
            .replace(/\{\s*"nodes"\s*:\s*\[[\s\S]*$/i, '')
            .trim();
          
          // Only truncate if extremely long (5000+ chars)
          if (finalMessage.length > 5000) {
            finalMessage = finalMessage.substring(0, 5000) + '...';
          }
        }
        
        // Strip redundant section headers (these are shown in expandable dropdowns)
        finalMessage = finalMessage
          .replace(/\*?\*?JSON Specification\*?\*?:?\s*/gi, '')
          .replace(/\*?\*?Mermaid Diagram\*?\*?:?\s*/gi, '')
          .replace(/\*?\*?Mermaid Code\*?\*?:?\s*/gi, '')
          .replace(/#{1,3}\s*JSON Specification\s*/gi, '')
          .replace(/#{1,3}\s*Mermaid Diagram\s*/gi, '')
          .replace(/#{1,3}\s*Mermaid Code\s*/gi, '')
          .replace(/\n{3,}/g, '\n\n')  // Collapse excessive newlines
          .trim();
        
        if (!finalMessage) {
          finalMessage = 'Diagram updated. Review the canvas for the architecture.';
        }
        
        // Include tool calls used in the final message
        const toolsUsed = activeToolCalls.length > 0 
          ? ''  // Tools are now shown in expandable UI, not as text
          : '';
        
        // Extract JSON spec from FULL TEXT (before code blocks were stripped)
        const jsonSpecMatch = fullText.match(/```json\s*([\s\S]*?)```/);
        const extractedJsonSpec = jsonSpecMatch ? jsonSpecMatch[1].trim() : undefined;
        
        // Extract Mermaid diagram from FULL TEXT (before code blocks were stripped)
        const mermaidSpecMatch = fullText.match(/```mermaid\s*([\s\S]*?)```/);
        const extractedMermaid = mermaidSpecMatch ? mermaidSpecMatch[1].trim() : undefined;
        
        setChatMessages((msgs) => {
          const updated = [...msgs];
          const lastMsg = updated[updated.length - 1];
          // Preserve thinking, toolCalls, completedTools, toolResults, and extracted artifacts from streaming
          updated[updated.length - 1] = { 
            role: 'assistant', 
            text: finalMessage + toolsUsed,
            thinking: lastMsg.thinking,
            toolCalls: lastMsg.toolCalls || [...new Set(activeToolCalls)],
            completedTools: lastMsg.completedTools,
            toolResults: lastMsg.toolResults,
            jsonSpec: extractedJsonSpec || lastMsg.jsonSpec,
            mermaidCode: extractedMermaid || lastMsg.mermaidCode,
            timestamp: lastMsg.timestamp || new Date().toISOString()
          };
          return updated;
        });
        
        // Clear active tool calls
        setActiveToolCalls([]);
      }
    } catch (err: any) {
      console.error('Chat streaming error:', err);
      setChatMessages((msgs) => {
        const updated = [...msgs];
                updated[updated.length - 1] = { role: 'assistant', text: 'Error generating diagram. Please try again.', timestamp: new Date().toISOString() };
        return updated;
      });
    } finally {
      setChatSending(false);
      setActiveToolCalls([]); // Clear tool calls for next request
    }
  };

  // Variant that accepts prompt directly (for starter prompts to bypass state timing)
  const handleSendChatWithPrompt = async (prompt: string) => {
    if (!prompt.trim() || chatSending) return;
    const userMessage = prompt.trim();
    lastUserPromptRef.current = userMessage;
    setChatSending(true);
    const userMsg: ChatMessage = { role: 'user', text: userMessage, timestamp: new Date().toISOString() };
    const history = [...chatMessages, userMsg];
    setChatMessages(history);
    setChatInput('');

    const transcript = history
      .map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.text}`)
      .join('\n');

    const enrichedPrompt = `You are the SnowGram Cortex Agent. First review the existing canvas before making changes. Here is the current diagram in Mermaid (derived from the live canvas):\n\n${currentMermaid}\n\nThen continue the conversation below and apply updates based on the user's new request. If needed, adjust or refine the existing layout rather than recreating from scratch.\n\nConversation:\n${transcript}\nAgent:`;

    try {
      setChatMessages((msgs) => [...msgs, { role: 'assistant', text: '...', timestamp: new Date().toISOString() }]);
      
      const response = await fetch('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: enrichedPrompt, 
          threadId: conversationThreadId,
          parentMessageId: lastMessageId || 0
        }),
      });

      if (!response.ok) {
        throw new Error(`Stream request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let streamedText = '';
      let streamedThinking = '';
      let fullText = '';
      let toolExtractedMermaid = '';  // Track Mermaid extracted from tool results

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;

          try {
            const data = JSON.parse(payload);
            
            if (data.type === 'thread' && data.threadId) {
              setConversationThreadId(data.threadId);
            } else if (data.type === 'thinking' && data.text) {
              streamedThinking += data.text;
              setChatMessages((msgs) => {
                const updated = [...msgs];
                updated[updated.length - 1] = { ...updated[updated.length - 1], thinking: streamedThinking };
                return updated;
              });
            } else if (data.type === 'tool_use' && data.tool) {
              const toolName = data.tool.name || data.tool.tool_name || 'Tool';
              setActiveToolCalls(prev => [...prev, toolName]);
              setChatMessages((msgs) => {
                const updated = [...msgs];
                const currentTools = updated[updated.length - 1].toolCalls || [];
                if (!currentTools.includes(toolName)) {
                  updated[updated.length - 1] = { ...updated[updated.length - 1], toolCalls: [...currentTools, toolName] };
                }
                return updated;
              });
            } else if (data.type === 'tool_result' && data.result) {
              const toolName = data.result.name || 'search';
              const rawResult = data.result.result || data.result.content || data.result;
              const toolResult = { name: toolName, result: rawResult, input: data.result.input };
              
              let extractedMermaid: string | undefined;
              if ((toolName === 'COMPOSE_DIAGRAM_FROM_TEMPLATE' || toolName.includes('COMPOSE') || toolName.includes('DIAGRAM')) && rawResult) {
                const resultStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
                const isMermaidCode = resultStr.trim().match(/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram)/i);
                if (isMermaidCode) extractedMermaid = resultStr.trim();
                else {
                  const mermaidMatch = resultStr.match(/```mermaid\s*([\s\S]*?)```/);
                  if (mermaidMatch) extractedMermaid = mermaidMatch[1].trim();
                }
              }
              
              // CRITICAL: Store extracted Mermaid for use in final diagram processing
              if (extractedMermaid) {
                toolExtractedMermaid = extractedMermaid;
              }
              
              setChatMessages((msgs) => {
                const updated = [...msgs];
                const lastMsg = updated[updated.length - 1];
                const completedTools = lastMsg.completedTools || [];
                const toolResults = lastMsg.toolResults || [];
                if (!completedTools.includes(toolName)) {
                  updated[updated.length - 1] = { 
                    ...lastMsg, completedTools: [...completedTools, toolName], toolResults: [...toolResults, toolResult],
                    mermaidCode: extractedMermaid || lastMsg.mermaidCode
                  };
                }
                return updated;
              });
            } else if (data.type === 'chunk' && data.text) {
              streamedText += data.text;
              fullText += data.text;
              setChatMessages((msgs) => {
                const updated = [...msgs];
                updated[updated.length - 1] = { ...updated[updated.length - 1], text: streamedText };
                return updated;
              });
            } else if (data.type === 'done') {
              if (data.messageId) setLastMessageId(data.messageId);
            }
          } catch {}
        }
      }

      // Process final diagram
      const specMatch = fullText.match(/```json\n([\s\S]*?)\n```/);
      const specStr = specMatch ? specMatch[1] : '';
      let spec: { nodes: any[]; edges: any[]; layout?: any } | undefined;
      if (specStr) {
        try {
          spec = JSON.parse(specStr);
        } catch { /* ignore parse errors */ }
      }
      const mermaidMatch = fullText.match(/```mermaid\n([\s\S]*?)\n```/);
      // CRITICAL FIX: Use Mermaid from tool result if not in agent's text response
      const mermaidCode = mermaidMatch ? mermaidMatch[1] : toolExtractedMermaid;
      if (spec || mermaidCode) {
        debugLog('[Chat] Rendering diagram - mermaidCode length:', mermaidCode.length, 'from:', mermaidMatch ? 'text response' : 'tool result');
        await parseMermaidAndCreateDiagram(mermaidCode, spec);
      }

      // Final cleanup
      let finalMessage = fullText.replace(/```json[\s\S]*?```/g, '').replace(/```mermaid[\s\S]*?```/g, '').trim();
      if (!finalMessage) finalMessage = 'Diagram updated. Review the canvas for the architecture.';
      
      setChatMessages((msgs) => {
        const updated = [...msgs];
        const lastMsg = updated[updated.length - 1];
        updated[updated.length - 1] = { 
          ...lastMsg, text: finalMessage,
          jsonSpec: specMatch ? specMatch[1].trim() : lastMsg.jsonSpec,
          mermaidCode: mermaidMatch ? mermaidMatch[1].trim() : (toolExtractedMermaid || lastMsg.mermaidCode)
        };
        return updated;
      });
      setActiveToolCalls([]);
    } catch (err) {
      console.error('Chat error:', err);
      setChatMessages((msgs) => {
        const updated = [...msgs];
        updated[updated.length - 1] = { role: 'assistant', text: 'Error generating diagram. Please try again.', timestamp: new Date().toISOString() };
        return updated;
      });
    } finally {
      setChatSending(false);
      setActiveToolCalls([]);
    }
  };

  const handleClearChat = () => {
    const seed: ChatMessage[] = [{ role: 'assistant', text: 'Tell me what to build. I will refine the diagram and keep context.', timestamp: new Date().toISOString() }];
    setChatMessages(seed);
    setChatInput('');
    // Reset conversation thread to start fresh
    setConversationThreadId(null);
    debugLog('[Chat] Conversation cleared, thread reset');
  };

  // Copy to clipboard helper with visual feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyToClipboard = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

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

  // Chat resize handlers
  const onChatResizeStart = (e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    chatResizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: chatSize.width,
      height: chatSize.height,
      posX: chatPos.x,
      posY: chatPos.y,
    };
    setChatResizing(direction);
  };

  useEffect(() => {
    if (!chatResizing) return;
    const minWidth = 320;
    const minHeight = 380;
    const maxWidth = window.innerWidth - 100;
    const maxHeight = window.innerHeight - 100;

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - chatResizeStart.current.x;
      const dy = e.clientY - chatResizeStart.current.y;
      const dir = chatResizing;

      let newWidth = chatResizeStart.current.width;
      let newHeight = chatResizeStart.current.height;
      let newPosX = chatResizeStart.current.posX;
      let newPosY = chatResizeStart.current.posY;

      // East (right edge)
      if (dir.includes('e')) {
        newWidth = Math.min(maxWidth, Math.max(minWidth, chatResizeStart.current.width + dx));
      }
      // West (left edge)
      if (dir.includes('w')) {
        const proposedWidth = chatResizeStart.current.width - dx;
        if (proposedWidth >= minWidth && proposedWidth <= maxWidth) {
          newWidth = proposedWidth;
          newPosX = chatResizeStart.current.posX + dx;
        }
      }
      // South (bottom edge)
      if (dir.includes('s')) {
        newHeight = Math.min(maxHeight, Math.max(minHeight, chatResizeStart.current.height + dy));
      }
      // North (top edge)
      if (dir.includes('n')) {
        const proposedHeight = chatResizeStart.current.height - dy;
        if (proposedHeight >= minHeight && proposedHeight <= maxHeight) {
          newHeight = proposedHeight;
          newPosY = chatResizeStart.current.posY + dy;
        }
      }

      setChatSize({ width: newWidth, height: newHeight });
      setChatPos({ x: newPosX, y: newPosY });
    };

    const onUp = () => setChatResizing(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [chatResizing]);

  // Header drag for expanded panel
  const onChatHeaderDragStart = (e: React.MouseEvent) => {
    // Only allow drag from header area, not from buttons
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    chatDragOffset.current = { x: e.clientX - chatPos.x, y: e.clientY - chatPos.y };
    setChatDragging(true);
  };

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
    
    // LAYOUT PRESERVATION: Capture current node positions before processing
    // This ensures conversational edits don't reset the user's layout
    const currentNodes = getNodes();
    const existingPositions = new Map<string, { x: number; y: number }>();
    currentNodes.forEach(node => {
      existingPositions.set(node.id, { x: node.position.x, y: node.position.y });
    });
    debugLog(`[Layout Preservation] Captured ${existingPositions.size} existing positions`);
    
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
        
        // LAYOUT PRESERVATION: Priority order for position:
        // 1. Existing canvas position (preserves user's manual layout)
        // 2. Backend-provided position (agent's suggestion)
        // 3. Default grid position (fallback)
        let position: { x: number; y: number };
        const existingPos = existingPositions.get(nodeId);
        
        if (existingPos) {
          // Preserve existing position - user's layout takes priority
          position = existingPos;
          debugLog(`[Layout Preservation] Preserving position for ${nodeId}:`, position);
        } else if (n.position && typeof n.position.x === 'number') {
          // Use backend position for new nodes
          position = { x: n.position.x, y: n.position.y };
        } else {
          // Fallback to grid for nodes without positions
          position = { x: (idx % 4) * 260, y: Math.floor(idx / 4) * 200 };
        }
        
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
      // AGENTIC APPROACH: Trust the agent completely
      // The agent understands context and returns only relevant components.
      // We no longer filter based on keyword matching in user prompts.
      // ===========================================================================
      debugLog('[Pipeline] Agent-first mode: trusting agent output (no FDE filtering)');

      // FIX: Support both agent formats - some use from/to, others use source/target
      const specEdges: Edge[] = (spec.edges || []).map((e: any, i: number) => {
        const source = e.source || e.from;
        const target = e.target || e.to;
        return {
          id: `${source || 's'}-${target || 't'}-${i}`,
          source,
          target,
        type: 'smoothstep',  // Orthogonal routing with rounded corners
          animated: true,
          sourceHandle: e.sourceHandle || 'right-source',
          targetHandle: e.targetHandle || 'left-target',
          style: { stroke: isDarkMode ? '#60A5FA' : '#29B5E8', strokeWidth: 2.5 },  // Phase 3: Increased strokeWidth,
          deletable: true,
        };
      });

      // AGENT-FIRST: Trust the agent output - frontend is a pure renderer
      // Previously: ensureMedallionCompleteness manipulated nodes/edges
      // Now: Pass through as-is, let agent control content
      debugLog('[Pipeline] Agent-first mode: trusting agent output (no ensureMedallionCompleteness)');
      const cleanedSpecEdges = specEdges.map((e) => ({
        ...e,
        sourceHandle: e.sourceHandle || 'right-source',
        targetHandle: e.targetHandle || 'left-target',
        type: 'smoothstep',  // Orthogonal routing with rounded corners
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
        debugWarn(`[Layout] ELK layout error, falling back to DAG layout:`, elkError);
        // Simple fallback - use DAG layout for all architectures
        laidOut = { nodes: layoutNodes(specNodes, cleanedSpecEdges), edges: cleanedSpecEdges };
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
        // This prevents diagonal edges in grid layouts
        
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

      const finalEdges = enforcedBoundaries.edges.map((e) => {
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
      const finalNodes = normalizedNodesWithSize
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
      // AGENTIC APPROACH: No post-processing filters - trust the agent completely
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

    const { nodes: newNodes, edges: newEdges, subgraphs: mermaidSubgraphs, layoutInfo: mermaidLayoutInfo } = convertMermaidToFlow(
      mermaidCode,
      COMPONENT_CATEGORIES,
      isDarkMode
    );
    debugLog(`[Pipeline] After mermaid parse: ${newNodes.length} nodes, ${newEdges.length} edges, subgraphs: ${mermaidSubgraphs?.size || 0}, layoutInfo: ${mermaidLayoutInfo?.size || 0}`);
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
      
      // Use 'smoothstep' for orthogonal routing with rounded corners
      const edgeType = 'smoothstep';
      
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

    // GENERIC SUBGRAPH LAYOUT: Use subgraph-based layout when layout info is present
    // Works for ANY architecture template with subgraphs (streaming, medallion with lanes, etc.)
    let laidOut: { nodes: Node[]; edges: Edge[] };
    if (mermaidLayoutInfo && mermaidLayoutInfo.size > 0) {
      debugLog(`[Pipeline] Using generic subgraph layout for ${mermaidLayoutInfo.size} layout regions`);
      laidOut = layoutWithLanes(finalNodes, completedEdges, mermaidSubgraphs, mermaidLayoutInfo);
    } else if (mermaidSubgraphs && mermaidSubgraphs.size > 0) {
      debugLog(`[Pipeline] Using lane-based layout for ${mermaidSubgraphs.size} subgraphs (legacy)`);
      laidOut = layoutWithLanes(finalNodes, completedEdges, mermaidSubgraphs);
    } else {
      // AGENTIC: Use simple DAG layout for all architectures (no medallion special-casing)
      laidOut = { nodes: layoutNodes(finalNodes, completedEdges), edges: completedEdges };
    }
    debugLog(`[Pipeline] After layout: ${laidOut.nodes.length} nodes`);
    // Helper to log label node positions (includes both elkLayout and mermaid badge formats)
    const logLabelPositions = (stage: string, nodes: Node[]) => {
      const labels = nodes.filter(n => 
        n.id.startsWith('lane_label_') || 
        n.id.startsWith('section_label_') ||
        n.id.startsWith('badge_') ||
        (n.data as any)?.isBadgeNode === true
      );
      if (labels.length > 0) {
        const posStr = labels.map(n => `${n.id}@(${Math.round(n.position.x)},${Math.round(n.position.y)})`).join(', ');
        console.log(`[Pipeline:${stage}] Label/badge positions: ${posStr}`);
      } else {
        console.log(`[Pipeline:${stage}] No label/badge nodes found`);
      }
    };
    logLabelPositions('layout', laidOut.nodes);
    // Add back agent-provided boundaries before addAccountBoundaries
    const nodesWithMermaidBoundaries = [...mermaidBoundaries, ...laidOut.nodes];
    debugLog(`[Pipeline] After layout + mermaid boundaries: ${nodesWithMermaidBoundaries.length} nodes (${mermaidBoundaries.length} from agent)`);
    const withBoundaries = addAccountBoundaries(nodesWithMermaidBoundaries);
    debugLog(`[Pipeline] After boundaries: ${withBoundaries.length} nodes`);
    logLabelPositions('boundaries', withBoundaries);
    
    // Log ALL boundary positions for debugging
    console.log(`[Pipeline:boundary-debug] Total nodes in withBoundaries: ${withBoundaries.length}`);
    const allBoundaries = withBoundaries.filter(n => {
      const ct = ((n.data as any)?.componentType || '').toLowerCase();
      const hasB = ct.includes('boundary') || n.id.toLowerCase().includes('boundary');
      if (hasB) console.log(`[Pipeline:boundary-debug] Found: ${n.id}, componentType=${ct}`);
      return hasB;
    });
    console.log(`[Pipeline:boundary-debug] Found ${allBoundaries.length} boundaries`);
    allBoundaries.forEach(b => {
      const style = b.style as any;
      console.log(`[Pipeline:boundary-debug] ${b.id}: pos=(${Math.round(b.position.x)},${Math.round(b.position.y)}), size=${style?.width}x${style?.height}, type=${(b.data as any)?.componentType}`);
    });
    
    // CRITICAL: Reposition lane labels INSIDE the Snowflake boundary
    // The lane labels should appear at the LEFT EDGE of the Snowflake boundary,
    // not in the gap between External Sources and Snowflake.
    
    // First, find both boundaries to understand their positions
    const allBoundaryNodes = withBoundaries.filter(n => 
      ((n.data as any)?.componentType || '').toLowerCase().includes('boundary') ||
      n.id.toLowerCase().includes('boundary')
    );
    
    const snowflakeBoundary = allBoundaryNodes.find(n => 
      ((n.data as any)?.componentType || '').toLowerCase().includes('account_boundary_snowflake')
    );
    
    const externalBoundary = allBoundaryNodes.find(n => 
      ((n.data as any)?.componentType || '').toLowerCase().includes('account_boundary_external')
    );
    
    if (snowflakeBoundary && externalBoundary) {
      const externalStyle = externalBoundary.style as any;
      const externalRightEdge = externalBoundary.position.x + (externalStyle?.width || 0);
      const snowflakeLeftEdge = snowflakeBoundary.position.x;
      const snowflakeStyle = snowflakeBoundary.style as any;
      
      console.log(`[Pipeline:boundaries-info] External: x=${Math.round(externalBoundary.position.x)}, width=${externalStyle?.width}, rightEdge=${Math.round(externalRightEdge)}`);
      console.log(`[Pipeline:boundaries-info] Snowflake: x=${Math.round(snowflakeLeftEdge)}, width=${snowflakeStyle?.width}`);
      console.log(`[Pipeline:boundaries-info] Gap between boundaries: ${Math.round(snowflakeLeftEdge - externalRightEdge)}px`);
      
      // Debug: Log positions of key nodes to understand the gap
      const debugNodes = ['consumer', 'industry_sources', 'marketplace', 'kafka_connector', 'snowpipe_streaming', 'csp'];
      debugNodes.forEach(nodeId => {
        const node = withBoundaries.find(n => n.id === nodeId);
        if (node) {
          console.log(`[Pipeline:node-pos] ${nodeId}: x=${Math.round(node.position.x)}, y=${Math.round(node.position.y)}`);
        }
      });
      
      // The issue: Snowflake boundary encompasses "gap" nodes like consumer, industry_sources
      // We need to find the VISUAL Snowflake content area - where kafka_connector etc. are
      // Find all content nodes (not boundaries, labels, spacers)
      const contentNodes = withBoundaries.filter(n => {
        const id = n.id.toLowerCase();
        const ct = ((n.data as any)?.componentType || '').toLowerCase();
        return !id.includes('boundary') && 
               !id.startsWith('lane_label_') && 
               !id.startsWith('section_label_') &&
               !id.includes('spacer') &&
               !ct.includes('boundary') &&
               ct !== 'lanelabelnode';
      });
      
      // Find nodes that are clearly INSIDE the visual Snowflake area
      // These are nodes to the RIGHT of the external boundary's right edge + gap
      const BOUNDARY_GAP = 50; // This should match addAccountBoundaries
      const visualSnowflakeStart = externalRightEdge + BOUNDARY_GAP;
      
      // Find leftmost content node that's clearly in the Snowflake visual area
      const snowflakeVisualNodes = contentNodes.filter(n => n.position.x >= visualSnowflakeStart);
      const leftmostVisualX = snowflakeVisualNodes.length > 0 
        ? Math.min(...snowflakeVisualNodes.map(n => n.position.x))
        : snowflakeLeftEdge + 15;
      
      console.log(`[Pipeline:visual-calc] External right edge: ${Math.round(externalRightEdge)}`);
      console.log(`[Pipeline:visual-calc] Visual Snowflake start (ext + gap): ${Math.round(visualSnowflakeStart)}`);
      console.log(`[Pipeline:visual-calc] Leftmost visual Snowflake node: x=${Math.round(leftmostVisualX)}`);
      
      // LANE BADGE REPOSITIONING: Position lane badges in a VERTICAL COLUMN on the far left
      // Reference image shows lane badges (1a, 1b, 1c, 1d) all at the SAME X position,
      // forming a vertical stack, each at the Y-level of its respective lane content
      
      // Group content nodes by their lane
      const laneContentMap = new Map<string, typeof contentNodes>();
      contentNodes.forEach(n => {
        const lane = (n.data as any)?.lane;
        // Handle both number and string lane values, including lane=0
        if (lane !== undefined && lane !== null) {
          const laneKey = String(lane);
          if (!laneContentMap.has(laneKey)) {
            laneContentMap.set(laneKey, []);
          }
          laneContentMap.get(laneKey)!.push(n);
        }
      });
      
      console.log(`[Pipeline:lane-groups] Found ${laneContentMap.size} lanes: ${Array.from(laneContentMap.keys()).join(', ')}`);
      
      // Find the GLOBAL leftmost X across ALL lane content (lanes 0, 1, 2, 3)
      const BADGE_WIDTH = 40;
      const BADGE_MARGIN = 20; // Gap between badge column and content
      let globalLeftmostX = Infinity;
      ['0', '1', '2', '3'].forEach(laneKey => {
        const laneContent = laneContentMap.get(laneKey);
        if (laneContent && laneContent.length > 0) {
          const leftmostX = Math.min(...laneContent.map(node => node.position.x));
          if (leftmostX < globalLeftmostX) {
            globalLeftmostX = leftmostX;
          }
        }
      });
      
      // Calculate the single X position for ALL lane badges
      const laneBadgeX = globalLeftmostX - BADGE_WIDTH - BADGE_MARGIN;
      console.log(`[Pipeline:lane-badge-column] Global leftmost X: ${Math.round(globalLeftmostX)}, badge X: ${Math.round(laneBadgeX)}`);
      
      // Helper to check if node is a lane badge (handles both elkLayout and mermaid badge formats)
      const isLaneBadge = (n: Node) => 
        n.id.startsWith('lane_label_') || 
        ((n.data as any)?.badgeClass === 'laneBadge');
      
      // Helper to check if node is a section badge  
      const isSectionBadge = (n: Node) =>
        n.id.startsWith('section_label_') ||
        ((n.data as any)?.badgeClass === 'sectionBadge');
      
      // For each lane badge, position at laneBadgeX but at the Y-level of its lane content
      withBoundaries.forEach(n => {
        if (isLaneBadge(n)) {
          // Extract lane identifier from badge ID
          // Handle both formats: "lane_label_1A" -> "1A", "badge_1a" -> "1a"
          const laneIdStr = n.id.replace('lane_label_', '').replace('badge_', '');
          
          // Map badge IDs (1A, 1B, 1C, 1D) to numeric lane values (0, 1, 2, 3)
          const laneIdMapping: Record<string, string> = {
            '1A': '0', '1a': '0',
            '1B': '1', '1b': '1', 
            '1C': '2', '1c': '2',
            '1D': '3', '1d': '3'
          };
          const numericLaneId = laneIdMapping[laneIdStr] || laneIdStr;
          const laneContent = laneContentMap.get(numericLaneId);
          
          if (laneContent && laneContent.length > 0) {
            // Calculate vertical center of the lane content
            const yPositions = laneContent.map(node => {
              const nodeHeight = (node.style as any)?.height || 60;
              return node.position.y + nodeHeight / 2;
            });
            const centerY = (Math.min(...yPositions) + Math.max(...yPositions)) / 2;
            
            // Position badge at the GLOBAL laneBadgeX, vertically centered with lane
            const newX = laneBadgeX;
            const newY = centerY - 18; // Badge height ~36, so offset by half
            
            const oldX = n.position.x;
            const oldY = n.position.y;
            n.position = { x: newX, y: newY };
            console.log(`[Pipeline:reposition] ${n.id}: (${Math.round(oldX)},${Math.round(oldY)}) → (${Math.round(newX)},${Math.round(newY)}) (centerY: ${Math.round(centerY)})`);
          } else {
            console.log(`[Pipeline:reposition] ${n.id}: no content found for lane ${laneIdStr}`);
          }
        }
      });
      
      // SECTION BADGE REPOSITIONING: Position section badges above their content columns
      // Group content nodes by their section subgraph
      const sectionContentMap = new Map<string, typeof contentNodes>();
      contentNodes.forEach(n => {
        const subgraph = (n.data as any)?.subgraph as string | undefined;
        // Include both "section_N" and "analytics_section" patterns
        if (subgraph && (subgraph.startsWith('section_') || subgraph === 'analytics_section')) {
          if (!sectionContentMap.has(subgraph)) {
            sectionContentMap.set(subgraph, []);
          }
          sectionContentMap.get(subgraph)!.push(n);
        }
      });
      
      // For each section badge, find its content and center badge above it
      withBoundaries.forEach(n => {
        if (isSectionBadge(n)) {
          // Extract section identifier from badge ID
          // Handle both formats: "section_label_2" -> "2", "badge_5" -> "5"
          const sectionId = n.id.replace('section_label_', '').replace('badge_', '');
          
          // Map badge ID to actual subgraph ID
          // Most sections use "section_N" pattern, but ANALYTICS uses "analytics_section"
          let sectionSubgraphId: string;
          if (sectionId.toUpperCase() === 'ANALYTICS') {
            sectionSubgraphId = 'analytics_section';
          } else {
            sectionSubgraphId = `section_${sectionId}`;
          }
          
          const sectionContent = sectionContentMap.get(sectionSubgraphId);
          
          if (sectionContent && sectionContent.length > 0) {
            // Calculate center X of section content
            const xPositions = sectionContent.map(node => node.position.x + ((node.style as any)?.width || 150) / 2);
            const centerX = (Math.min(...xPositions) + Math.max(...xPositions)) / 2;
            const badgeWidth = 36;
            const newX = centerX - badgeWidth / 2;
            
            // Position Y at top of content column (slightly above topmost content node)
            const yPositions = sectionContent.map(node => node.position.y);
            const topY = Math.min(...yPositions);
            const newY = topY - 50; // 50px above content
            
            const oldX = n.position.x;
            const oldY = n.position.y;
            n.position = { x: newX, y: newY };
            console.log(`[Pipeline:reposition] ${n.id}: (${Math.round(oldX)},${Math.round(oldY)}) → (${Math.round(newX)},${Math.round(newY)}) (content center: ${Math.round(centerX)}, top: ${Math.round(topY)})`);
          } else {
            console.log(`[Pipeline:reposition] ${n.id}: no content found for ${sectionSubgraphId}`);
          }
        }
      });
    } else if (snowflakeBoundary) {
      // Fallback: only Snowflake boundary exists
      const snowflakeLeftEdge = snowflakeBoundary.position.x;
      const LABEL_OFFSET = 15;
      const targetX = snowflakeLeftEdge + LABEL_OFFSET;
      
      console.log(`[Pipeline:reposition] No external boundary, placing labels at Snowflake x=${Math.round(snowflakeLeftEdge)} + ${LABEL_OFFSET}`);
      
      withBoundaries.forEach(n => {
        if (n.id.startsWith('lane_label_')) {
          const oldX = n.position.x;
          n.position = { ...n.position, x: targetX };
          console.log(`[Pipeline:reposition] ${n.id}: x=${oldX} → x=${Math.round(n.position.x)}`);
        }
      });
    }
    logLabelPositions('after-reposition', withBoundaries);
    const fitted = fitCspNodesIntoBoundaries(withBoundaries);
    debugLog(`[Pipeline] After fitting: ${fitted.length} nodes`);
    logLabelPositions('fitted', fitted);
    const normalizedFinal = normalizeGraph(fitted, laidOut.edges);
    debugLog(`[Pipeline] After normalize (FINAL): ${normalizedFinal.nodes.length} nodes, ${normalizedFinal.edges.length} edges`);
    logLabelPositions('normalize', normalizedFinal.nodes);
    const enforcedBoundaries = enforceAccountBoundaries(normalizedFinal.nodes, normalizedFinal.edges, isDarkMode);
    logLabelPositions('enforced', enforcedBoundaries.nodes);
    // Log boundary positions for debugging
    const boundaries = enforcedBoundaries.nodes.filter(n => 
      ((n.data as any)?.componentType || '').toLowerCase().includes('boundary') ||
      n.id.toLowerCase().includes('boundary')
    );
    if (boundaries.length > 0) {
      const boundaryStr = boundaries.map(n => 
        `${n.id}@(${Math.round(n.position.x)},${Math.round(n.position.y)}) w=${(n.style as any)?.width} h=${(n.style as any)?.height}`
      ).join(', ');
      console.log(`[Pipeline:boundaries] Boundary positions: ${boundaryStr}`);
    }
    
    // CRITICAL: Enforce consistent node sizes for handle alignment (Mermaid path)
    // All non-boundary nodes must have identical dimensions
    const STANDARD_WIDTH_MERMAID = 150;
    const STANDARD_HEIGHT_MERMAID = 130;
    
    // Enrich mermaid nodes with flowStageOrder for consistent coloring
    const enrichedMermaidNodes = enrichNodesWithFlowOrder(enforcedBoundaries.nodes);
    
    const normalizedNodesWithSizeMermaid = enrichedMermaidNodes.map(n => {
      const isBoundary = ((n.data as any)?.componentType || '').toLowerCase().startsWith('account_boundary');
      if (isBoundary) return n; // Keep boundary sizes as-is
      
      // Keep lane/section label nodes small (36x36 badges)
      if (n.type === 'laneLabelNode') return n;
      
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
      type: 'smoothstep',  // Orthogonal routing with rounded corners
      animated: true,
      style: { stroke: isDarkMode ? '#60A5FA' : '#29B5E8', strokeWidth: 2.5 },  // Phase 3: Increased strokeWidth,
    }));
    
    // =============================================================================
    // AGENTIC APPROACH: No post-processing filters - trust the agent completely
    // =============================================================================
    
    // BUG-007 FIX: Check if aborted before state updates (Mermaid path)
    if (isAborted()) {
      debugLog('[Pipeline] Parsing aborted (Mermaid path) - skipping state update');
      return;
    }
    
    setNodes(finalNodesWithStyle);
    setEdges(finalEdges);
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

      {/* Right Side - Tab Bar + Canvas */}
      <div className={styles.canvasWrapper}>
        {/* Multi-Tab Bar */}
        <TabBar 
          isDarkMode={isDarkMode} 
          onTabSwitch={handleTabSwitch}
        />
        
        {/* Canvas - Diagram Builder with ReactFlow */}
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
          snapToGrid={snapEnabled}
          snapGrid={[16, 16]}
        proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
          selectNodesOnDrag={false}
          multiSelectionKeyCode="Shift"
          defaultEdgeOptions={{
        type: 'smoothstep',  // Orthogonal routing with rounded corners
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
            <div className={styles.instructionItem}>
              • <span className={styles.highlight}>Hold Alt/⌥ for free movement</span>
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
          style={{ left: 0, top: 0, width: chatOpen ? chatSize.width : undefined, height: chatOpen ? chatSize.height : undefined }}
          aria-hidden={!chatOpen}
        >
          {/* Resize handles - all 8 directions */}
          {chatOpen && (
            <>
              <div className={styles.resizeHandleN} onMouseDown={(e) => onChatResizeStart(e, 'n')} />
              <div className={styles.resizeHandleS} onMouseDown={(e) => onChatResizeStart(e, 's')} />
              <div className={styles.resizeHandleE} onMouseDown={(e) => onChatResizeStart(e, 'e')} />
              <div className={styles.resizeHandleW} onMouseDown={(e) => onChatResizeStart(e, 'w')} />
              <div className={styles.resizeHandleNE} onMouseDown={(e) => onChatResizeStart(e, 'ne')} />
              <div className={styles.resizeHandleNW} onMouseDown={(e) => onChatResizeStart(e, 'nw')} />
              <div className={styles.resizeHandleSE} onMouseDown={(e) => onChatResizeStart(e, 'se')} />
              <div className={styles.resizeHandleSW} onMouseDown={(e) => onChatResizeStart(e, 'sw')} />
            </>
          )}
          <div className={styles.chatContent}>
            <div 
              className={`${styles.chatHeader} ${chatOpen ? styles.chatHeaderDraggable : ''}`}
              onMouseDown={chatOpen ? onChatHeaderDragStart : undefined}
              style={{ cursor: chatOpen ? (chatDragging ? 'grabbing' : 'grab') : undefined }}
            >
              <div className={styles.chatHeaderLeft}>
                <div className={`${styles.chatTitle} ${chatOpen ? styles.textShimmer : ''}`}>
                  <span className={styles.titleBrand}>SnowGram</span> Design Assistant
                </div>
                <div className={`${styles.chatSubtitle} ${chatOpen ? styles.textShimmer : ''}`}>Powered by Cortex</div>
              </div>
              <div className={styles.chatHeaderActions}>
                {/* New Chat button */}
                <button
                  className={styles.chatAction}
                  onClick={handleNewSession}
                  title="New chat"
                  style={{ color: '#10B981' }}
                >
                  <span style={{ fontSize: '18px', fontWeight: 'bold' }}>+</span>
                </button>
                {/* History toggle button */}
                {savedSessions.length > 0 && (
                  <button
                    className={styles.chatAction}
                    onClick={() => setShowSessionList(!showSessionList)}
                    title="Chat history"
                    style={{ color: showSessionList ? '#0EA5E9' : undefined }}
                  >
                    <img
                      src="/icons/Snowflake_ICON_Time.svg"
                      alt="History"
                      className={styles.chatActionIcon}
                      style={{ width: 16, height: 16 }}
                    />
                  </button>
                )}
                {/* Clear/Refresh button */}
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
            
            {/* Session List Panel */}
            {showSessionList && savedSessions.length > 0 && (
              <div className={styles.sessionListPanel}>
                <div className={styles.sessionListHeader}>
                  Recent Conversations ({savedSessions.length})
                </div>
                {savedSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`${styles.sessionItem} ${session.id === currentSessionId ? styles.sessionItemActive : ''}`}
                    onClick={() => handleSwitchSession(session.id)}
                  >
                    <div className={styles.sessionInfo}>
                      <div className={styles.sessionName}>{session.name}</div>
                      <div className={styles.sessionMeta}>
                        {session.messageCount} messages • {new Date(session.timestamp).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      className={styles.sessionDeleteBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Delete this conversation?')) {
                          handleDeleteSession(session.id);
                        }
                      }}
                      title="Delete conversation"
                    >
                      <img
                        src="/icons/Snowflake_ICON_No.svg"
                        alt="Delete"
                        style={{ width: 14, height: 14 }}
                      />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className={styles.chatMessages}>
              {chatMessages.map((m, idx) => (
                <div
                  key={idx}
                  className={m.role === 'user' ? styles.chatMessageUser : styles.chatMessageAssistant}
                >
                  <div className={styles.chatBubble}>
                    <strong>{m.role === 'user' ? 'You' : 'SnowGram'}:</strong>
                    
                    {/* Thinking section - collapsible */}
                    {m.thinking && (
                      <div className={styles.thinkingSection}>
                        <button 
                          className={styles.thinkingToggle}
                          onClick={() => {
                            setExpandedThinking(prev => {
                              const next = new Set(prev);
                              if (next.has(idx)) {
                                // Start closing animation
                                setClosingThinking(p => new Set(p).add(idx));
                                setTimeout(() => {
                                  setExpandedThinking(p => { const n = new Set(p); n.delete(idx); return n; });
                                  setClosingThinking(p => { const n = new Set(p); n.delete(idx); return n; });
                                }, 150);
                              } else {
                                next.add(idx);
                              }
                              return next;
                            });
                          }}
                        >
                          <PsychologyIcon className={styles.thinkingIcon} />
                          <span>Thinking</span>
                          <ExpandMoreIcon className={`${styles.thinkingChevron} ${expandedThinking.has(idx) ? styles.expanded : ''}`} />
                        </button>
                        {expandedThinking.has(idx) && (
                          <div className={`${styles.thinkingContent} ${closingThinking.has(idx) ? styles.expandableContentClosing : styles.expandableContent}`}>
                            <ReactMarkdown>{m.thinking}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Tool calls - expandable with results */}
                    {m.toolCalls && m.toolCalls.length > 0 && (
                      <div className={styles.toolCallsSection}>
                        {m.toolCalls.map((tool, toolIdx) => {
                          const isCompleted = m.completedTools?.includes(tool);
                          const toolResult = m.toolResults?.find(tr => tr.name === tool);
                          const toolKey = `${idx}-${toolIdx}`;
                          const isExpanded = expandedTools.has(toolKey);
                          const isClosing = closingTools.has(toolKey);
                          
                          return (
                            <div key={toolIdx} className={styles.toolCallItem}>
                              <button 
                                className={`${styles.toolCallToggle} ${isCompleted ? styles.toolCompleted : ''}`}
                                onClick={() => {
                                  if (toolResult) {
                                    if (isExpanded) {
                                      // Start closing animation
                                      setClosingTools(p => new Set(p).add(toolKey));
                                      setTimeout(() => {
                                        setExpandedTools(p => { const n = new Set(p); n.delete(toolKey); return n; });
                                        setClosingTools(p => { const n = new Set(p); n.delete(toolKey); return n; });
                                      }, 150);
                                    } else {
                                      setExpandedTools(prev => new Set(prev).add(toolKey));
                                    }
                                  }
                                }}
                                disabled={!toolResult}
                              >
                                <span className={styles.toolIcon}>{isCompleted ? <CheckIcon fontSize="small" /> : <AutorenewIcon fontSize="small" className={styles.spinning} />}</span>
                                <span className={styles.toolLabel}>Tool:</span>
                                <span className={styles.toolName}>{tool}</span>
                                {toolResult && (
                                  <ExpandMoreIcon className={`${styles.toolChevron} ${isExpanded ? styles.expanded : ''}`} fontSize="small" />
                                )}
                              </button>
                              {isExpanded && toolResult && (
                                <div className={`${styles.toolResultContent} ${isClosing ? styles.expandableContentClosing : styles.expandableContent}`}>
                                  {toolResult.input && (
                                    <div className={styles.toolResultInput}>
                                      <div className={styles.toolResultHeader}>
                                        <strong>Input:</strong>
                                        <button 
                                          className={styles.copyButtonSmall}
                                          onClick={() => copyToClipboard(JSON.stringify(toolResult.input, null, 2), `input-${toolKey}`)}
                                          title="Copy input"
                                        >
                                          {copiedKey === `input-${toolKey}` ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                                        </button>
                                      </div>
                                      <SyntaxHighlighter 
                                        language="json" 
                                        style={oneDark}
                                        customStyle={{ margin: '4px 0', borderRadius: '4px', fontSize: '11px' }}
                                      >
                                        {JSON.stringify(toolResult.input, null, 2)}
                                      </SyntaxHighlighter>
                                    </div>
                                  )}
                                  <div className={styles.toolResultOutput}>
                                    <div className={styles.toolResultHeader}>
                                      <strong>Result:</strong>
                                      <button 
                                        className={styles.copyButtonSmall}
                                        onClick={() => copyToClipboard(
                                          typeof toolResult.result === 'string' 
                                            ? toolResult.result 
                                            : JSON.stringify(toolResult.result, null, 2),
                                          `result-${toolKey}`
                                        )}
                                        title="Copy result"
                                      >
                                        {copiedKey === `result-${toolKey}` ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                                      </button>
                                    </div>
                                    <SyntaxHighlighter 
                                      language="json" 
                                      style={oneDark}
                                      customStyle={{ margin: '4px 0', borderRadius: '4px', fontSize: '11px', maxHeight: '300px', overflow: 'auto' }}
                                    >
                                      {typeof toolResult.result === 'string' 
                                        ? toolResult.result 
                                        : JSON.stringify(toolResult.result, null, 2)}
                                    </SyntaxHighlighter>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    
                    {/* JSON Specification - expandable with copy button */}
                    {m.jsonSpec && (
                      <div className={styles.codeArtifactSection}>
                        <div className={styles.codeArtifactHeader}>
                          <button 
                            className={styles.codeArtifactToggle}
                            onClick={() => {
                              if (expandedJsonSpec.has(idx)) {
                                setClosingJsonSpec(p => new Set(p).add(idx));
                                setTimeout(() => {
                                  setExpandedJsonSpec(p => { const n = new Set(p); n.delete(idx); return n; });
                                  setClosingJsonSpec(p => { const n = new Set(p); n.delete(idx); return n; });
                                }, 150);
                              } else {
                                setExpandedJsonSpec(prev => new Set(prev).add(idx));
                              }
                            }}
                          >
                            <DataObjectIcon className={styles.codeArtifactIcon} />
                            <span>JSON Specification</span>
                            <ExpandMoreIcon className={`${styles.codeArtifactChevron} ${expandedJsonSpec.has(idx) ? styles.expanded : ''}`} />
                          </button>
                          <button 
                            className={styles.copyButton}
                            onClick={() => copyToClipboard(m.jsonSpec!, `json-${idx}`)}
                            title="Copy JSON"
                          >
                            {copiedKey === `json-${idx}` ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                          </button>
                        </div>
                        {expandedJsonSpec.has(idx) && (
                          <div className={`${styles.codeArtifactContent} ${closingJsonSpec.has(idx) ? styles.expandableContentClosing : styles.expandableContent}`}>
                            <SyntaxHighlighter 
                              language="json" 
                              style={oneDark}
                              customStyle={{ margin: 0, borderRadius: '0 0 8px 8px', fontSize: '12px', maxHeight: '400px' }}
                              showLineNumbers
                            >
                              {m.jsonSpec}
                            </SyntaxHighlighter>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Mermaid Diagram - expandable with copy button */}
                    {m.mermaidCode && (
                      <div className={styles.codeArtifactSection}>
                        <div className={styles.codeArtifactHeader}>
                          <button 
                            className={styles.codeArtifactToggle}
                            onClick={() => {
                              if (expandedMermaid.has(idx)) {
                                setClosingMermaid(p => new Set(p).add(idx));
                                setTimeout(() => {
                                  setExpandedMermaid(p => { const n = new Set(p); n.delete(idx); return n; });
                                  setClosingMermaid(p => { const n = new Set(p); n.delete(idx); return n; });
                                }, 150);
                              } else {
                                setExpandedMermaid(prev => new Set(prev).add(idx));
                              }
                            }}
                          >
                            <AccountTreeIcon className={styles.codeArtifactIcon} />
                            <span>Mermaid Diagram</span>
                            <ExpandMoreIcon className={`${styles.codeArtifactChevron} ${expandedMermaid.has(idx) ? styles.expanded : ''}`} />
                          </button>
                          <button 
                            className={styles.copyButton}
                            onClick={() => copyToClipboard(m.mermaidCode!, `mermaid-${idx}`)}
                            title="Copy Mermaid"
                          >
                            {copiedKey === `mermaid-${idx}` ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                          </button>
                        </div>
                        {expandedMermaid.has(idx) && (
                          <div className={`${styles.codeArtifactContent} ${closingMermaid.has(idx) ? styles.expandableContentClosing : styles.expandableContent}`}>
                            <SyntaxHighlighter 
                              language="markdown" 
                              style={oneDark}
                              customStyle={{ margin: 0, borderRadius: '0 0 8px 8px', fontSize: '12px', maxHeight: '400px' }}
                              showLineNumbers
                            >
                              {m.mermaidCode}
                            </SyntaxHighlighter>
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className={styles.chatMarkdown}>
                      <ReactMarkdown>{m.text}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Starter prompts - compact chips above input */}
            {chatMessages.length <= 1 && !chatSending && (
              <div className={styles.starterPrompts}>
                <div className={styles.starterHint}>
                  <span>Try a reference architecture</span>
                  <span className={styles.starterHintActions}>click to send • hold ⌥ to edit</span>
                </div>
                <div className={styles.starterChips}>
                  {[
                    { icon: '/icons/Snowflake_ICON_RA_Stream.svg', label: 'Streaming', prompt: 'Generate a Snowflake Streaming Data Stack reference architecture diagram' },
                    { icon: '/icons/Snowflake_ICON_Security.svg', label: 'Security Analytics', prompt: 'Generate a Snowflake Security Analytics architecture diagram' },
                    { icon: '/icons/Snowflake_ICON_Cloud.svg', label: 'Serverless', prompt: 'Generate a Snowflake Serverless Data Stack architecture diagram' },
                    { icon: '/icons/Snowflake_ICON_Users.svg', label: 'Customer 360', prompt: 'Generate a Snowflake Customer 360 architecture diagram' },
                    { icon: '/icons/Snowflake_ICON_Embedded_Analytics.svg', label: 'Embedded Analytics', prompt: 'Generate a Snowflake Embedded Analytics architecture diagram' },
                    { icon: '/icons/Snowflake_ICON_IoT.svg', label: 'IoT', prompt: 'Generate a Snowflake IoT Reference Architecture diagram' },
                    { icon: '/icons/Snowflake_ICON_Workloads_AI.svg', label: 'ML Pipeline', prompt: 'Generate a Snowflake Machine Learning architecture diagram' },
                  ].map((starter, i) => (
                    <button
                      key={i}
                      className={styles.starterChip}
                      onClick={(e) => {
                        if (e.altKey || e.metaKey) {
                          // Alt/Option or Cmd: fill input for editing
                          setChatInput(starter.prompt);
                        } else {
                          // Normal click: send immediately
                          setChatInput(starter.prompt);
                          handleSendChatWithPrompt(starter.prompt);
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setChatInput(starter.prompt);
                      }}
                    >
                      <img src={starter.icon} alt="" className={styles.starterChipIcon} />
                      <span>{starter.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            
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
                className={`${styles.chatSend} ${chatSending ? styles.chatSending : ''}`}
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
