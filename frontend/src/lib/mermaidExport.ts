/**
 * Mermaid diagram export utility for SnowGram.
 *
 * Extracted from App.tsx for testability. Converts ReactFlow nodes + edges
 * into valid Mermaid flowchart LR syntax.
 */

interface NodeLike {
  id: string;
  data: { label?: string };
}

interface EdgeLike {
  source: string;
  target: string;
}

export function generateMermaidFromDiagram(nodes: NodeLike[], edges: EdgeLike[]): string {
  let mermaid = 'flowchart LR\n';

  // Add node definitions
  nodes.forEach((node) => {
    const label = node.data.label || node.id;
    const sanitizedLabel = label.replace(/[[\]()]/g, '');
    mermaid += `    ${node.id}[${sanitizedLabel}]\n`;
  });

  mermaid += '\n';

  // Add connections
  edges.forEach((edge) => {
    mermaid += `    ${edge.source} --> ${edge.target}\n`;
  });

  return mermaid;
}
