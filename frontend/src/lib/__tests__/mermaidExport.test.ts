/**
 * Tests for Mermaid diagram export utility.
 *
 * generateMermaidFromDiagram: converts ReactFlow nodes + edges into
 * valid Mermaid flowchart LR syntax.
 */
import { describe, it, expect } from 'vitest';
import { generateMermaidFromDiagram } from '../mermaidExport';

describe('generateMermaidFromDiagram', () => {
  const makeNode = (id: string, label: string) => ({
    id,
    data: { label },
    position: { x: 0, y: 0 },
  });

  const makeEdge = (source: string, target: string) => ({
    id: `${source}->${target}`,
    source,
    target,
  });

  it('produces valid flowchart LR header', () => {
    const result = generateMermaidFromDiagram([], []);
    expect(result).toContain('flowchart LR');
  });

  it('includes node definitions with labels', () => {
    const nodes = [makeNode('kafka', 'Kafka Source')];
    const result = generateMermaidFromDiagram(nodes as any, []);
    expect(result).toContain('kafka[Kafka Source]');
  });

  it('includes edge connections with arrows', () => {
    const nodes = [
      makeNode('a', 'Source'),
      makeNode('b', 'Target'),
    ];
    const edges = [makeEdge('a', 'b')];
    const result = generateMermaidFromDiagram(nodes as any, edges as any);
    expect(result).toContain('a --> b');
  });

  it('sanitises labels by removing brackets and parens', () => {
    const nodes = [makeNode('x', 'Table [raw] (test)')];
    const result = generateMermaidFromDiagram(nodes as any, []);
    expect(result).not.toContain('[raw]');
    expect(result).not.toContain('(test)');
    expect(result).toContain('Table raw test');
  });

  it('falls back to node ID when label is missing', () => {
    const nodes = [{ id: 'my_node', data: {}, position: { x: 0, y: 0 } }];
    const result = generateMermaidFromDiagram(nodes as any, []);
    expect(result).toContain('my_node[my_node]');
  });

  it('produces correct output for a 3-node pipeline', () => {
    const nodes = [
      makeNode('kafka', 'Kafka'),
      makeNode('stream', 'CDC Stream'),
      makeNode('table', 'Bronze Table'),
    ];
    const edges = [
      makeEdge('kafka', 'stream'),
      makeEdge('stream', 'table'),
    ];
    const result = generateMermaidFromDiagram(nodes as any, edges as any);

    // Verify structure
    const lines = result.split('\n').filter((l) => l.trim());
    expect(lines[0]).toBe('flowchart LR');
    // Should have 3 node definitions and 2 edge definitions
    const nodeDefs = lines.filter((l) => l.includes('['));
    const edgeDefs = lines.filter((l) => l.includes('-->'));
    expect(nodeDefs).toHaveLength(3);
    expect(edgeDefs).toHaveLength(2);
  });

  it('handles empty nodes and edges', () => {
    const result = generateMermaidFromDiagram([], []);
    expect(result).toBe('flowchart LR\n\n');
  });
});
