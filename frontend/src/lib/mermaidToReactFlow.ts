import { Edge, Node } from 'reactflow';

/**
 * Lightweight Mermaid flowchart parser to produce ReactFlow nodes/edges.
 * Supports common arrow types: -->, --- , -.->, ==> variants.
 * Layout is a simple grid; callers may re-run layout if desired.
 */
export function convertMermaidToFlow(
  mermaidCode: string,
  componentCatalog: Record<string, any>,
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
      if (m) return m[2];
    }
    return id;
  };

  const ensureNode = (id: string) => {
    if (nodeMap.has(id)) return nodeMap.get(id)!;
    const label = getLabel(id);
    const color = isDarkMode ? '#29B5E8' : '#0F4C75';
    const node: Node = {
      id,
      type: 'snowflakeNode',
      data: {
        label,
        componentType: matchComponent(label, componentCatalog),
        labelColor: isDarkMode ? '#E5EDF5' : '#0F172A',
        isDarkMode,
        showHandles: true,
      },
      position: { x: 0, y: 0 },
      style: {
        border: `2px solid ${color}`,
        borderRadius: 8,
        background: isDarkMode ? '#0F172A' : '#ffffff',
        color: isDarkMode ? '#E5EDF5' : '#0F172A',
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
      ensureNode(source);
      ensureNode(target);
      edges.push({
        id: `${source}-${target}-${edges.length}`,
        source,
        target,
        type: 'smoothstep',
        animated: true,
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

function matchComponent(label: string, catalog: Record<string, any>): string {
  const normalized = label.toLowerCase();
  for (const [_cat, comps] of Object.entries(catalog)) {
    for (const c of comps as any[]) {
      if (c.name?.toLowerCase() === normalized) return c.name;
    }
  }
  return label;
}

