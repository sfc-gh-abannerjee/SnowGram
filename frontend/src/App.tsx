import React, { useState, useCallback, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Connection,
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

const nodeTypes: NodeTypes = {
  snowflakeNode: CustomNode,
};

interface AIResponse {
  mermaid_code: string;
  explanation: string;
  components_used: string[];
}

const App: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  // const edgeReconnectSuccessful = useRef(true); // Not used - reconnection not supported in this version
  const { getNodes, getEdges } = useReactFlow();
  
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

  // NEW: Clear confirmation state (inline)
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // NEW: Combined style/layer controls (screen coords + state)
  const [stylePanelPos, setStylePanelPos] = useState<{ x: number; y: number } | null>(null);
  const [fillColor, setFillColor] = useState('#29B5E8');
  const [fillAlpha, setFillAlpha] = useState(0);
  const [cornerRadius, setCornerRadius] = useState(8);
  const [isConnecting, setIsConnecting] = useState(false);

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
  const base = isDark ? { r: 15, g: 23, b: 42 } : { r: 249, g: 250, b: 251 }; // light/dark backing
  const { r, g, b } = hexToRgb(fill) || { r: 41, g: 181, b: 232 };
  const effLum = alpha * luminance(r, g, b) + (1 - alpha) * luminance(base.r, base.g, base.b);
  return effLum > 0.5 ? '#0F172A' : '#E5EDF5';
};

  // Helper: get current z-index for a node
  const getZ = (n: Node) => (n.style as any)?.zIndex ?? 0;

  // Grid snapping parameters (only snap when close)
  const GRID_SIZE = 16;
  const SNAP_THRESHOLD_X = 5;  // grid snap when within 5px horizontally
  const SNAP_THRESHOLD_Y = 8;  // grid snap when within 8px vertically
  const SNAP_NODE_THRESHOLD_X = 6;  // neighbor snap when within 6px horizontally
  const SNAP_NODE_THRESHOLD_Y = 10; // neighbor snap when within 10px vertically
  
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
  const onNodeDragStop = useCallback((_event, node: Node) => {
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
      
      const newEdge: Edge = {
        ...params,
        id: `${params.source}-${params.target}-${Date.now()}`,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#29B5E8', strokeWidth: 2 },
        deletable: true,
        data: {
          // Track animation direction: 'forward' = source -> target, 'reverse' = target -> source
          animationDirection: 'forward'
        }
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
  }, [nodes, reactFlowInstance, updateEdgeMenuPosition]);
  
  // Handle canvas click to deselect edges and nodes
  const onPaneClick = useCallback(() => {
    setSelectedEdges([]);
    setMenuPosition(null);
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
      if (!isConnecting) return;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id
            ? {
                ...n,
                data: {
                  ...(n.data || {}),
                  showHandles: true,
                },
              }
            : n
        )
      );
    },
    [isConnecting]
  );

  const onNodeMouseLeave = useCallback(
    (_event: any, node: Node) => {
      if (!isConnecting) return;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id
            ? {
                ...n,
                data: {
                  ...(n.data || {}),
                  showHandles: !!n.selected,
                },
              }
            : n
        )
      );
    },
    [isConnecting]
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

  // Handle drag start from palette
  const onDragStart = (event: React.DragEvent, component: any) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(component));
    event.dataTransfer.effectAllowed = 'move';
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

  // Generate Mermaid code from current diagram
  const generateMermaidFromDiagram = (currentNodes: Node[], currentEdges: Edge[]): string => {
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
  };

  // Handle AI generation
  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) return;

    setIsGenerating(true);
    setShowAIModal(false);

    try {
      const response = await fetch('/api/diagram/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_query: aiPrompt }),
      });

      if (!response.ok) throw new Error('Failed to generate diagram');

      const data: AIResponse = await response.json();
      
      // Parse Mermaid and create nodes/edges
      parseMermaidAndCreateDiagram(data.mermaid_code, data.components_used);
      
    } catch (error) {
      console.error('AI generation error:', error);
      alert('Failed to generate diagram. Make sure the Cortex Agent is configured and backend is running.');
    } finally {
      setIsGenerating(false);
      setAiPrompt('');
    }
  };

  // Enhanced Mermaid parser
  const parseMermaidAndCreateDiagram = (mermaidCode: string, components: string[]) => {
    const lines = mermaidCode.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const nodeMap = new Map<string, { label: string; position: { x: number; y: number } }>();

    let xOffset = 100;
    let yOffset = 100;
    const xGap = 250;
    const yGap = 150;
    let col = 0;

    // Parse node definitions
    lines.forEach((line) => {
      // Match: A[Label], A(Label), A{Label}, A((Label)), etc.
      const nodeRegex = /(\w+)[\[\(\{]([^\]\)\}]+)[\]\)\}]/g;
      let match;

      while ((match = nodeRegex.exec(line)) !== null) {
        const [, nodeId, label] = match;
        
        if (!nodeMap.has(nodeId)) {
          nodeMap.set(nodeId, {
            label: label.trim(),
            position: {
              x: xOffset + (col % 3) * xGap,
              y: yOffset + Math.floor(col / 3) * yGap,
            },
          });
          col++;
        }
      }
    });

    // Parse connections: A --> B, A -- text --> B, A -.-> B, A ==> B
    lines.forEach((line) => {
      // Match various arrow types
      const connectionRegex = /(\w+)\s*(-+>?|-+\|[^|]+\|->?|=+>?|\.-+>?)\s*(\w+)/g;
      let match;

      while ((match = connectionRegex.exec(line)) !== null) {
        const [, source, arrow, target] = match;
        
        if (source && target && nodeMap.has(source) && nodeMap.has(target)) {
          // Determine edge style based on arrow type
          let edgeStyle: any = {
            stroke: '#29B5E8',
            strokeWidth: 2,
          };
          let animated = true;
          
          if (arrow.includes('=')) {
            // Thick arrow
            edgeStyle.strokeWidth = 4;
          } else if (arrow.includes('.')) {
            // Dotted arrow
            edgeStyle.strokeDasharray = '5,5';
            animated = false;
          }

          newEdges.push({
            id: `${source}-${target}-${Date.now()}`,
            source,
            target,
            type: 'smoothstep',
            animated,
            style: edgeStyle,
          });
        }
      }
    });

    // Create ReactFlow nodes from parsed data
    nodeMap.forEach((data, nodeId) => {
      const componentType = inferComponentType(data.label);
      const icon = SNOWFLAKE_ICONS[componentType] || SNOWFLAKE_ICONS.database;

      newNodes.push({
        id: nodeId,
        type: 'snowflakeNode',
        position: data.position,
        style: {
          width: 180,
          height: 140,
        },
        data: {
          label: data.label,
          icon,
          componentType,
          onDelete: (id: string) => deleteNode(id),
          onRename: (id: string, newName: string) => renameNode(id, newName),
          isDarkMode,
        },
      });
    });

    // Add to existing diagram or replace
    if (window.confirm('Replace current diagram with AI-generated one?')) {
      setNodes(newNodes);
      setEdges(newEdges);
    } else {
      // Offset new nodes to avoid overlap
      const offsetNodes = newNodes.map(node => ({
        ...node,
        position: {
          x: node.position.x + 400,
          y: node.position.y + 200,
        },
      }));
      setNodes((nds) => [...nds, ...offsetNodes]);
      setEdges((eds) => [...eds, ...newEdges]);
    }

    // Fit view after a short delay
    setTimeout(() => {
      if (reactFlowInstance) {
        reactFlowInstance.fitView({ padding: 0.2, duration: 800 });
      }
    }, 100);
  };

  // Infer component type from label
  const inferComponentType = (label: string): string => {
    const lower = label.toLowerCase();
    
    // Check keywords in order of specificity
    if (lower.includes('warehouse') || lower.includes('wh')) return 'warehouse';
    if (lower.includes('cortex') && lower.includes('search')) return 'cortex_search';
    if (lower.includes('cortex') || lower.includes('analyst')) return 'cortex_analyst';
    if (lower.includes('snowpipe') || lower.includes('pipe')) return 'snowpipe';
    if (lower.includes('external') && lower.includes('stage')) return 'external_stage';
    if (lower.includes('stage')) return 'external_stage';
    if (lower.includes('dynamic') && lower.includes('table')) return 'dynamic_table';
    if (lower.includes('external') && lower.includes('table')) return 'external_table';
    if (lower.includes('iceberg')) return 'iceberg_table';
    if (lower.includes('hybrid')) return 'hybrid_table';
    if (lower.includes('table')) return 'table';
    if (lower.includes('materialized') && lower.includes('view')) return 'materialized_view';
    if (lower.includes('secure') && lower.includes('view')) return 'secure_view';
    if (lower.includes('view')) return 'view';
    if (lower.includes('stream')) return 'stream';
    if (lower.includes('task')) return 'task';
    if (lower.includes('database') || lower.includes('db')) return 'database';
    if (lower.includes('schema')) return 'schema';
    if (lower.includes('kafka')) return 'kafka';
    if (lower.includes('s3') || lower.includes('bucket')) return 's3';
    if (lower.includes('ml') || lower.includes('model')) return 'ml_model';
    if (lower.includes('notebook')) return 'notebook';
    if (lower.includes('function') || lower.includes('udf')) return 'udf';
    if (lower.includes('procedure') || lower.includes('sproc')) return 'stored_proc';
    if (lower.includes('api')) return 'api';
    if (lower.includes('share')) return 'share';
    if (lower.includes('notification') || lower.includes('alert')) return 'notification';
    
    return 'database'; // default
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
          
          {/* NEW: Search Box */}
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
          
          {/* NEW: Collapse/Expand All Button */}
          <div className={styles.collapseAllContainer}>
            <button
              className={styles.collapseAllButton}
              onClick={allCollapsed ? expandAll : collapseAll}
              title={allCollapsed ? 'Expand All Categories' : 'Collapse All Categories'}
              aria-label={allCollapsed ? 'Expand All Categories' : 'Collapse All Categories'}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                {allCollapsed ? (
                  // Expand icon (chevrons pointing down)
                  <>
                    <path d="M3 4L7 8L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M3 8L7 12L11 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </>
                ) : (
                  // Collapse icon (chevrons pointing up)
                  <>
                    <path d="M11 10L7 6L3 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M11 6L7 2L3 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </>
                )}
              </svg>
              <span>{allCollapsed ? 'Expand All' : 'Collapse All'}</span>
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

        <div className={styles.aiSection}>
          <button
            className={styles.aiButton}
            onClick={() => setShowAIModal(true)}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <span className={styles.spinner} />
                Generating...
              </>
            ) : (
              <>
                <img
                  src="/icons/Snowflake_ICON_AI_Star_Triple.svg"
                  alt="AI"
                  className={styles.aiIcon}
                />
                Generate with AI
              </>
            )}
          </button>
        </div>
      </div>

      {/* Right Canvas - Diagram Builder with ReactFlow */}
      <div className={styles.canvas} ref={reactFlowWrapper}>
        <ReactFlow
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
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeDragStop={onNodeDragStop}
          onInit={setReactFlowInstance}
          nodeTypes={nodeTypes}
          connectionMode="loose"
          isValidConnection={() => true}
          fitView
          attributionPosition="bottom-right"
          deleteKeyCode={null}
          selectNodesOnDrag={false}
          multiSelectionKeyCode="Shift"
          defaultEdgeOptions={{
            type: 'smoothstep',
            animated: true,
        style: { stroke: isDarkMode ? '#FFFFFF' : '#29B5E8', strokeWidth: 2 },
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
            <button className={styles.actionButton} onClick={handleClear}>
              <img src="/icons/Snowflake_ICON_No.svg" alt="Clear" className={styles.btnIcon} />
              Clear
            </button>
            <button className={styles.actionButton} onClick={() => setShowExportModal(true)}>
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
          
          {/* Top-Left Panel with Instructions */}
          <Panel position="top-left" className={styles.instructionsPanel}>
            <div className={styles.instructionItem}>
              <strong>Quick Tips:</strong>
            </div>
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

      {/* AI Generation Modal */}
      {showAIModal && (
        <div className={styles.modalOverlay} onClick={() => setShowAIModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <img
                src="/icons/Snowflake_ICON_Copilot.svg"
                alt="AI"
                className={styles.modalIcon}
              />
              <h3 className={styles.modalTitle}>Generate with AI</h3>
            </div>
            <textarea
              className={styles.modalInput}
              placeholder="Describe your Snowflake architecture... (e.g., 'Create a real-time IoT pipeline with Kafka, Snowpipe, Stream, Task, and Warehouse')"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={5}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button
                className={styles.modalButtonSecondary}
                onClick={() => setShowAIModal(false)}
              >
                Cancel
              </button>
              <button
                className={styles.modalButtonPrimary}
                onClick={handleAIGenerate}
                disabled={!aiPrompt.trim()}
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      )}

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
