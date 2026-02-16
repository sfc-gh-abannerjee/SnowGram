/**
 * Integration test: traces the exact pipeline from agent output through ELK,
 * addAccountBoundaries, fitAllBoundaries, normalizeGraph to final output.
 * 
 * Purpose: identify where edges are lost and where layout flattens.
 */
import { describe, it, expect } from 'vitest';
import { layoutWithELK, enrichNodesWithFlowOrder } from '../elkLayout';
import { normalizeGraph } from '../graphNormalize';
import { fitAllBoundaries, boundingBox } from '../layoutUtils';
import { Node, Edge } from 'reactflow';

// Simulate the agent's Kafka medallion output AFTER specNodes construction
// (flowStageOrder NOT in data, matching the real pipeline)
function buildSpecNodes(): Node[] {
  const rawNodes = [
    { id: 'kafka', label: 'Kafka', componentType: 'ext_kafka', position: { x: 100, y: 180 } },
    { id: 'bronze_layer', label: 'Bronze Layer', componentType: 'sf_bronze_layer', position: { x: 300, y: 180 } },
    { id: 'cdc_stream_1', label: 'CDC Stream', componentType: 'sf_cdc_stream', position: { x: 500, y: 180 } },
    { id: 'transform_task_1', label: 'Transform Task', componentType: 'sf_transform_task', position: { x: 700, y: 180 } },
    { id: 'silver_layer', label: 'Silver Layer', componentType: 'sf_silver_layer', position: { x: 900, y: 180 } },
    { id: 'cdc_stream_2', label: 'CDC Stream', componentType: 'sf_cdc_stream', position: { x: 1100, y: 180 } },
    { id: 'transform_task_2', label: 'Transform Task', componentType: 'sf_transform_task', position: { x: 1300, y: 180 } },
    { id: 'gold_layer', label: 'Gold Layer', componentType: 'sf_gold_layer', position: { x: 1500, y: 180 } },
    { id: 'analytics_views', label: 'Analytics Views', componentType: 'sf_analytics_views', position: { x: 1700, y: 180 } },
    { id: 'warehouse', label: 'Warehouse', componentType: 'sf_warehouse', position: { x: 1300, y: 330 } },
  ];

  return rawNodes.map(n => ({
    id: n.id,
    type: 'snowflakeNode',
    position: n.position,
    data: {
      label: n.label,
      componentType: n.componentType,
      // NOTE: flowStageOrder intentionally NOT included — matches real pipeline
    },
  } as Node));
}

function buildSpecEdges(): Edge[] {
  const rawEdges = [
    { source: 'kafka', target: 'bronze_layer' },
    { source: 'bronze_layer', target: 'cdc_stream_1' },
    { source: 'cdc_stream_1', target: 'transform_task_1' },
    { source: 'transform_task_1', target: 'silver_layer' },
    { source: 'silver_layer', target: 'cdc_stream_2' },
    { source: 'cdc_stream_2', target: 'transform_task_2' },
    { source: 'transform_task_2', target: 'gold_layer' },
    { source: 'gold_layer', target: 'analytics_views' },
    { source: 'warehouse', target: 'transform_task_1' },
    { source: 'warehouse', target: 'transform_task_2' },
  ];

  return rawEdges.map((e, i) => ({
    id: `${e.source}-${e.target}-${i}`,
    source: e.source,
    target: e.target,
    sourceHandle: 'right-source',
    targetHandle: 'left-target',
    type: 'straight',
  } as Edge));
}

describe('Kafka Medallion Pipeline Integration', () => {
  const specNodes = buildSpecNodes();
  const specEdges = buildSpecEdges();

  it('Step 1: enrichNodesWithFlowOrder adds flowStageOrder via keyword inference', () => {
    const enriched = enrichNodesWithFlowOrder(specNodes);
    
    const stages = enriched.map(n => ({
      id: n.id,
      stage: (n.data as any).flowStageOrder,
    }));
    
    console.log('Enriched stages:', stages);
    
    // Verify each node gets a stage
    stages.forEach(s => {
      expect(s.stage).toBeDefined();
      expect(typeof s.stage).toBe('number');
    });
    
    // Verify kafka is stage 0 (source)
    expect(stages.find(s => s.id === 'kafka')?.stage).toBe(0);
    // Verify bronze is stage 2
    expect(stages.find(s => s.id === 'bronze_layer')?.stage).toBe(2);
    // Verify CDC streams are stage 2.5
    expect(stages.find(s => s.id === 'cdc_stream_1')?.stage).toBe(2.5);
    // Verify silver is 3.5
    expect(stages.find(s => s.id === 'silver_layer')?.stage).toBe(3.5);
    // Verify gold is 4
    expect(stages.find(s => s.id === 'gold_layer')?.stage).toBe(4);
  });

  it('Step 2: layoutWithELK produces non-flat layout with all edges', async () => {
    const enriched = enrichNodesWithFlowOrder(specNodes);
    const result = await layoutWithELK(enriched, specEdges);
    
    console.log('ELK positions:', result.nodes.map(n => ({
      id: n.id,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
    })));
    console.log('ELK edges:', result.edges.length);
    
    // All 10 nodes present
    expect(result.nodes.length).toBe(10);
    // All 10 edges present
    expect(result.edges.length).toBe(10);
    
    // Layout should NOT be flat — multiple unique Y values
    const yValues = [...new Set(result.nodes.map(n => Math.round(n.position.y)))];
    console.log('Unique Y values:', yValues);
    expect(yValues.length).toBeGreaterThan(1);
  });

  it('Step 2b: single-node stages are vertically centered (no staircase)', async () => {
    const enriched = enrichNodesWithFlowOrder(specNodes);
    const result = await layoutWithELK(enriched, specEdges);

    // Stages with 1 node (e.g. kafka=0, bronze=2, silver=3.5, gold=4)
    // should be vertically centered relative to stages with 2 nodes
    // (e.g. cdc_stream at 2.5, transform at 3).
    // Before the fix, single-node stages all started at y=rowY (top-aligned),
    // creating a staircase pattern.

    // Group by stage to find single-node vs multi-node stages in row 0
    const nodesByStage = new Map<number, typeof result.nodes>();
    result.nodes.forEach(n => {
      const stage = (n.data as any).flowStageOrder as number;
      if (!nodesByStage.has(stage)) nodesByStage.set(stage, []);
      nodesByStage.get(stage)!.push(n);
    });

    // Find a single-node stage and a multi-node stage in the same row (row 0)
    // CDC streams (stage 2.5) have 2 nodes; bronze (stage 2) has 1 node
    const bronzeNodes = nodesByStage.get(2) || [];
    const cdcNodes = nodesByStage.get(2.5) || [];
    expect(bronzeNodes.length).toBe(1);
    expect(cdcNodes.length).toBe(2);

    // Bronze (single node) should be vertically centered between the two CDC nodes
    const bronzeY = Math.round(bronzeNodes[0].position.y);
    const cdcY0 = Math.round(cdcNodes[0].position.y);
    const cdcY1 = Math.round(cdcNodes[1].position.y);
    const cdcMidpoint = Math.round((cdcY0 + cdcY1) / 2);

    console.log(`Bronze Y=${bronzeY}, CDC Y0=${cdcY0}, CDC Y1=${cdcY1}, CDC midpoint=${cdcMidpoint}`);

    // Bronze should be at or near the midpoint of the CDC stack (within half a node height)
    expect(Math.abs(bronzeY - cdcMidpoint)).toBeLessThanOrEqual(65);
  });

  it('Step 3: normalizeGraph preserves all edges when node IDs match', async () => {
    const enriched = enrichNodesWithFlowOrder(specNodes);
    const elkResult = await layoutWithELK(enriched, specEdges);
    
    const normalized = normalizeGraph(elkResult.nodes, elkResult.edges);
    
    console.log('Post-normalize: nodes=', normalized.nodes.length, 'edges=', normalized.edges.length);
    console.log('Node IDs:', normalized.nodes.map(n => n.id));
    console.log('Edge pairs:', normalized.edges.map(e => `${e.source}->${e.target}`));
    
    // All 10 nodes preserved (no boundaries to dedup)
    expect(normalized.nodes.length).toBe(10);
    // All 10 edges preserved (no orphans)
    expect(normalized.edges.length).toBe(10);
  });

  it('Step 4: fitAllBoundaries preserves positions for Snowflake nodes', async () => {
    const enriched = enrichNodesWithFlowOrder(specNodes);
    const elkResult = await layoutWithELK(enriched, specEdges);
    
    // Record ELK positions before fitting
    const elkPositions = new Map(elkResult.nodes.map(n => [n.id, { ...n.position }]));
    
    const fitted = fitAllBoundaries(elkResult.nodes);
    
    // Snowflake nodes should keep their ELK positions (repositionNodes=false for snowflake)
    const snowflakeIds = ['bronze_layer', 'cdc_stream_1', 'transform_task_1', 'silver_layer',
                          'cdc_stream_2', 'transform_task_2', 'gold_layer', 'analytics_views', 'warehouse'];
    
    snowflakeIds.forEach(id => {
      const fitted_n = fitted.find(n => n.id === id);
      const elk_pos = elkPositions.get(id);
      if (fitted_n && elk_pos) {
        console.log(`${id}: ELK=(${Math.round(elk_pos.x)},${Math.round(elk_pos.y)}) fitted=(${Math.round(fitted_n.position.x)},${Math.round(fitted_n.position.y)})`);
        // Snowflake nodes should NOT be repositioned
        expect(Math.round(fitted_n.position.x)).toBe(Math.round(elk_pos.x));
        expect(Math.round(fitted_n.position.y)).toBe(Math.round(elk_pos.y));
      }
    });
  });

  it('Full pipeline: enrichment → ELK → normalizeGraph preserves all edges', async () => {
    const enriched = enrichNodesWithFlowOrder(specNodes);
    const elkResult = await layoutWithELK(enriched, specEdges);
    const normalized = normalizeGraph(elkResult.nodes, elkResult.edges);
    
    // Final check
    expect(normalized.nodes.length).toBe(10);
    expect(normalized.edges.length).toBe(10);
    
    // Verify no flat layout
    const yValues = [...new Set(normalized.nodes.map(n => Math.round(n.position.y)))];
    expect(yValues.length).toBeGreaterThan(1);
    
    console.log('FINAL: nodes=', normalized.nodes.length, 'edges=', normalized.edges.length, 'yLayers=', yValues.length);
  });
});
