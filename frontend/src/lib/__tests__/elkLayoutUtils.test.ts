/**
 * Tests for ELK layout utilities — flow stage inference, port selection.
 *
 * getFlowStageOrder: infers a node's position in the data flow pipeline
 * (0=source … 6=consume) from agent metadata or keyword patterns.
 *
 * selectPorts: picks correct source/target handles based on relative
 * flow positions so edges point in the right direction.
 */
import { describe, it, expect } from 'vitest';
import { getFlowStageOrder, selectPorts } from '../elkLayoutUtils';

// ---------------------------------------------------------------------------
// getFlowStageOrder — agent-provided values
// ---------------------------------------------------------------------------
describe('getFlowStageOrder — agent-provided', () => {
  it('uses agent-provided flowStageOrder when keywords do not match', () => {
    const node = { id: 'x', data: { flowStageOrder: 2 } };
    expect(getFlowStageOrder(node as any)).toBe(2);
  });

  it('keywords take priority over agent-provided flowStageOrder', () => {
    // Agent says 3 (transform), but keyword "silver" infers 3.5
    const node = { id: 'silver_layer', data: { flowStageOrder: 3, label: 'Silver Layer', componentType: 'sf_silver_layer' } };
    expect(getFlowStageOrder(node as any)).toBe(3.5);
  });

  it('prefers agent flowStageOrder over flowStage string when no keywords match', () => {
    const node = { id: 'x', data: { flowStageOrder: 5, flowStage: 'source' } };
    expect(getFlowStageOrder(node as any)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// getFlowStageOrder — flowStage string
// ---------------------------------------------------------------------------
describe('getFlowStageOrder — flowStage string', () => {
  const stages = [
    ['source', 0],
    ['ingest', 1],
    ['raw', 2],
    ['transform', 3],
    ['refined', 4],
    ['serve', 5],
    ['consume', 6],
  ] as const;

  stages.forEach(([stage, order]) => {
    it(`maps flowStage="${stage}" → ${order}`, () => {
      const node = { id: 'x', data: { flowStage: stage } };
      expect(getFlowStageOrder(node as any)).toBe(order);
    });
  });
});

// ---------------------------------------------------------------------------
// getFlowStageOrder — keyword inference
// ---------------------------------------------------------------------------
describe('getFlowStageOrder — keyword inference', () => {
  it('infers source(0) from "kafka" in label', () => {
    const node = { id: 'x', data: { label: 'Kafka Cluster', componentType: 'ext_kafka' } };
    expect(getFlowStageOrder(node as any)).toBe(0);
  });

  it('infers source(0) from "s3" in componentType', () => {
    const node = { id: 'x', data: { label: 'Data Lake', componentType: 's3_bucket' } };
    expect(getFlowStageOrder(node as any)).toBe(0);
  });

  it('infers ingest(1) from "snowpipe" in label', () => {
    const node = { id: 'x', data: { label: 'Snowpipe Loader', componentType: 'pipe' } };
    expect(getFlowStageOrder(node as any)).toBe(1);
  });

  it('infers raw(2) from "bronze" in label', () => {
    const node = { id: 'x', data: { label: 'Bronze Layer', componentType: 'sf_bronze_layer' } };
    expect(getFlowStageOrder(node as any)).toBe(2);
  });

  it('infers cdc(2.5) from "cdc_stream" in componentType', () => {
    const node = { id: 'x', data: { label: 'CDC Stream', componentType: 'sf_cdc_stream' } };
    expect(getFlowStageOrder(node as any)).toBe(2.5);
  });

  it('infers transform(3) from "transform_task" in componentType', () => {
    const node = { id: 'x', data: { label: 'Transform Task', componentType: 'sf_transform_task' } };
    expect(getFlowStageOrder(node as any)).toBe(3);
  });

  it('infers silver(3.5) from "silver" in label', () => {
    const node = { id: 'x', data: { label: 'Silver Layer', componentType: 'sf_silver_layer' } };
    expect(getFlowStageOrder(node as any)).toBe(3.5);
  });

  it('infers refined(4) from "gold" in label', () => {
    const node = { id: 'x', data: { label: 'Gold Layer', componentType: 'sf_gold_layer' } };
    expect(getFlowStageOrder(node as any)).toBe(4);
  });

  it('infers serve(5) from "warehouse" in label', () => {
    const node = { id: 'x', data: { label: 'Compute Warehouse', componentType: 'sf_warehouse' } };
    expect(getFlowStageOrder(node as any)).toBe(5);
  });

  it('infers consume(6) from "tableau" in label', () => {
    const node = { id: 'x', data: { label: 'Tableau', componentType: 'tableau' } };
    expect(getFlowStageOrder(node as any)).toBe(6);
  });

  it('defaults to transform(3) for unrecognised labels', () => {
    const node = { id: 'x', data: { label: 'Custom Component', componentType: 'custom_xyz' } };
    expect(getFlowStageOrder(node as any)).toBe(3);
  });

  it('uses node ID in keyword matching', () => {
    // If the id itself contains "kafka", it should match source
    const node = { id: 'kafka_topic', data: { label: '', componentType: '' } };
    expect(getFlowStageOrder(node as any)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// selectPorts — edge handle direction
// ---------------------------------------------------------------------------
describe('selectPorts', () => {
  it('forward flow (source < target) uses right→left', () => {
    const { sourcePort, targetPort } = selectPorts('a', 'b', 0, 3);
    expect(sourcePort).toBe('a-right');
    expect(targetPort).toBe('b-left');
  });

  it('backward flow (source > target) uses left→right', () => {
    const { sourcePort, targetPort } = selectPorts('a', 'b', 5, 2);
    expect(sourcePort).toBe('a-left');
    expect(targetPort).toBe('b-right');
  });

  it('same layer defaults to right→left', () => {
    const { sourcePort, targetPort } = selectPorts('a', 'b', 3, 3);
    expect(sourcePort).toBe('a-right');
    expect(targetPort).toBe('b-left');
  });

  it('includes correct node IDs in port names', () => {
    const { sourcePort, targetPort } = selectPorts('kafka', 'bronze_layer', 0, 2);
    expect(sourcePort).toContain('kafka');
    expect(targetPort).toContain('bronze_layer');
  });
});
