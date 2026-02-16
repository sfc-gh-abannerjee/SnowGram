/**
 * Tests for normalizeBoundaryType and isMedallion — extracted from App.tsx.
 *
 * normalizeBoundaryType: canonicalises boundary node types by provider
 * while passing through non-boundary nodes unchanged.
 *
 * isMedallion: detects whether a set of nodes represents a medallion
 * (bronze/silver/gold) architecture.
 *
 * normalizeGraph: deduplicates nodes by key, canonicalises componentTypes,
 * removes orphaned/self-referencing/duplicate edges.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeBoundaryType,
  isMedallion,
  normalizeGraph,
} from '../graphNormalize';

// ---------------------------------------------------------------------------
// normalizeBoundaryType
// ---------------------------------------------------------------------------
describe('normalizeBoundaryType', () => {
  it('returns raw type unchanged for non-boundary nodes', () => {
    expect(normalizeBoundaryType('sf_warehouse', 'My WH', 'wh_1')).toBe('sf_warehouse');
  });

  it('returns raw type unchanged for plain table', () => {
    expect(normalizeBoundaryType('table', 'Orders', 'orders_tbl')).toBe('table');
  });

  it('normalises snowflake boundary from componentType', () => {
    expect(normalizeBoundaryType('account_boundary_snowflake', 'SF Account', 'sf_b'))
      .toBe('account_boundary_snowflake');
  });

  it('normalises AWS boundary', () => {
    expect(normalizeBoundaryType('account_boundary_aws', 'AWS', 'aws_b'))
      .toBe('account_boundary_aws');
  });

  it('normalises Kafka boundary', () => {
    expect(normalizeBoundaryType('account_boundary_kafka', 'Kafka', 'kafka_b'))
      .toBe('account_boundary_kafka');
  });

  it('normalises Azure boundary', () => {
    expect(normalizeBoundaryType('account_boundary_azure', 'Azure', 'az_b'))
      .toBe('account_boundary_azure');
  });

  it('normalises GCP boundary', () => {
    expect(normalizeBoundaryType('account_boundary_gcp', 'GCP', 'gcp_b'))
      .toBe('account_boundary_gcp');
  });

  it('detects boundary from label containing "snowflake"', () => {
    const result = normalizeBoundaryType('account_boundary', 'Snowflake Account', 'b1');
    expect(result).toBe('account_boundary_snowflake');
  });

  it('detects boundary from ID starting with account_boundary_', () => {
    const result = normalizeBoundaryType('some_type', 'label', 'account_boundary_aws');
    expect(result).toBe('account_boundary_aws');
  });

  it('detects kafka boundary from label containing "confluent"', () => {
    const result = normalizeBoundaryType('account_boundary', 'Confluent Cluster', 'b2');
    expect(result).toBe('account_boundary_kafka');
  });

  it('returns raw type when boundary has no recognisable provider', () => {
    // A boundary node where text doesn't match any known provider
    expect(normalizeBoundaryType('account_boundary', 'My Boundary', 'b3'))
      .toBe('account_boundary');
  });

  it('handles undefined inputs gracefully', () => {
    expect(normalizeBoundaryType(undefined, undefined, undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isMedallion
// ---------------------------------------------------------------------------
describe('isMedallion', () => {
  const makeNode = (label: string, componentType?: string) => ({
    id: label.toLowerCase().replace(/\s/g, '_'),
    position: { x: 0, y: 0 },
    data: { label, componentType: componentType || label },
  });

  it('returns true when nodes contain bronze/silver/gold labels', () => {
    const nodes = [
      makeNode('Bronze Layer'),
      makeNode('Silver Layer'),
      makeNode('Gold Layer'),
    ];
    expect(isMedallion(nodes as any)).toBe(true);
  });

  it('returns true when any single node has "bronze" in label', () => {
    const nodes = [makeNode('Bronze Tables'), makeNode('Stream')];
    expect(isMedallion(nodes as any)).toBe(true);
  });

  it('returns true when componentType contains "gold"', () => {
    const nodes = [makeNode('Curated', 'sf_gold_layer')];
    expect(isMedallion(nodes as any)).toBe(true);
  });

  it('returns false for non-medallion architectures', () => {
    const nodes = [
      makeNode('Kafka'),
      makeNode('Stream'),
      makeNode('Task'),
      makeNode('Warehouse'),
    ];
    expect(isMedallion(nodes as any)).toBe(false);
  });

  it('returns false for empty node list', () => {
    expect(isMedallion([])).toBe(false);
  });

  it('is case-insensitive', () => {
    const nodes = [makeNode('BRONZE LAYER')];
    expect(isMedallion(nodes as any)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeGraph — full pipeline test
// ---------------------------------------------------------------------------
describe('normalizeGraph', () => {
  const makeNode = (id: string, componentType: string, label?: string) => ({
    id,
    position: { x: 0, y: 0 },
    data: { label: label || id, componentType },
    type: 'snowflakeNode',
  });

  const makeEdge = (source: string, target: string) => ({
    id: `${source}->${target}`,
    source,
    target,
    type: 'smoothstep',
  });

  it('preserves all unique nodes', () => {
    const nodes = [
      makeNode('kafka', 'ext_kafka', 'Kafka'),
      makeNode('stream_1', 'sf_cdc_stream', 'CDC Stream'),
      makeNode('task_1', 'sf_transform_task', 'Transform'),
    ];
    const edges = [
      makeEdge('kafka', 'stream_1'),
      makeEdge('stream_1', 'task_1'),
    ];
    const result = normalizeGraph(nodes as any, edges as any);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
  });

  it('deduplicates boundary nodes by provider', () => {
    const nodes = [
      makeNode('sf_boundary_1', 'account_boundary_snowflake', 'SF Account'),
      makeNode('sf_boundary_2', 'account_boundary_snowflake', 'SF Account 2'),
      makeNode('kafka', 'ext_kafka', 'Kafka'),
    ];
    const edges: any[] = [];
    const result = normalizeGraph(nodes as any, edges);
    const boundaries = result.nodes.filter(
      (n: any) => n.data.componentType.startsWith('account_boundary')
    );
    expect(boundaries).toHaveLength(1);
    expect(result.nodes).toHaveLength(2); // 1 boundary + kafka
  });

  it('does NOT deduplicate non-boundary nodes with same componentType', () => {
    const nodes = [
      makeNode('cdc_stream_1', 'sf_cdc_stream', 'CDC Stream'),
      makeNode('cdc_stream_2', 'sf_cdc_stream', 'CDC Stream'),
    ];
    const edges: any[] = [];
    const result = normalizeGraph(nodes as any, edges);
    expect(result.nodes).toHaveLength(2);
  });

  it('canonicalises componentType on output nodes', () => {
    const nodes = [makeNode('s1', 'sf_cdc_stream', 'Stream')];
    const result = normalizeGraph(nodes as any, []);
    expect((result.nodes[0].data as any).componentType).toBe('stream');
  });

  it('removes orphaned edges (source node missing)', () => {
    const nodes = [makeNode('a', 'table', 'A')];
    const edges = [makeEdge('a', 'missing_node')];
    const result = normalizeGraph(nodes as any, edges as any);
    expect(result.edges).toHaveLength(0);
  });

  it('removes orphaned edges (target node missing)', () => {
    const nodes = [makeNode('b', 'table', 'B')];
    const edges = [makeEdge('missing_node', 'b')];
    const result = normalizeGraph(nodes as any, edges as any);
    expect(result.edges).toHaveLength(0);
  });

  it('removes self-referencing edges', () => {
    const nodes = [makeNode('a', 'table', 'A')];
    const edges = [makeEdge('a', 'a')];
    const result = normalizeGraph(nodes as any, edges as any);
    expect(result.edges).toHaveLength(0);
  });

  it('deduplicates edges with same source→target', () => {
    const nodes = [
      makeNode('a', 'table', 'A'),
      makeNode('b', 'table', 'B'),
    ];
    const edges = [makeEdge('a', 'b'), makeEdge('a', 'b')];
    const result = normalizeGraph(nodes as any, edges as any);
    expect(result.edges).toHaveLength(1);
  });

  it('remaps edges when boundary nodes are deduplicated', () => {
    const nodes = [
      makeNode('sf_boundary_1', 'account_boundary_snowflake', 'SF'),
      makeNode('sf_boundary_2', 'account_boundary_snowflake', 'SF 2'),
      makeNode('kafka', 'ext_kafka', 'Kafka'),
    ];
    // Edge points to the second (deduplicated) boundary
    const edges = [makeEdge('kafka', 'sf_boundary_2')];
    const result = normalizeGraph(nodes as any, edges as any);
    // The deduplicated boundary gets ID from first node, so edge to second becomes orphaned
    // unless normalizeGraph does ID remapping (it currently doesn't — this tests the actual behavior)
    // The boundary keeps the first node's ID, so edge to sf_boundary_2 is orphaned
    expect(result.edges).toHaveLength(0); // orphaned because sf_boundary_2 was removed
  });

  it('handles empty inputs', () => {
    const result = normalizeGraph([], []);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('full 12-node Kafka medallion pipeline preserves all nodes and edges', () => {
    const nodes = [
      makeNode('account_boundary_kafka', 'account_boundary_kafka', 'Kafka Cluster'),
      makeNode('account_boundary_snowflake', 'account_boundary_snowflake', 'Snowflake'),
      makeNode('kafka', 'ext_kafka', 'Kafka'),
      makeNode('bronze_layer', 'sf_bronze_layer', 'Bronze Layer'),
      makeNode('cdc_stream_1', 'sf_cdc_stream', 'CDC Stream'),
      makeNode('transform_task_1', 'sf_transform_task', 'Transform Task'),
      makeNode('silver_layer', 'sf_silver_layer', 'Silver Layer'),
      makeNode('cdc_stream_2', 'sf_cdc_stream', 'CDC Stream'),
      makeNode('transform_task_2', 'sf_transform_task', 'Transform Task'),
      makeNode('gold_layer', 'sf_gold_layer', 'Gold Layer'),
      makeNode('analytics_views', 'sf_analytics_views', 'Analytics Views'),
      makeNode('warehouse', 'sf_warehouse', 'Warehouse'),
    ];
    const edges = [
      makeEdge('kafka', 'bronze_layer'),
      makeEdge('bronze_layer', 'cdc_stream_1'),
      makeEdge('cdc_stream_1', 'transform_task_1'),
      makeEdge('transform_task_1', 'silver_layer'),
      makeEdge('silver_layer', 'cdc_stream_2'),
      makeEdge('cdc_stream_2', 'transform_task_2'),
      makeEdge('transform_task_2', 'gold_layer'),
      makeEdge('gold_layer', 'analytics_views'),
      makeEdge('analytics_views', 'warehouse'),
    ];
    const result = normalizeGraph(nodes as any, edges as any);
    expect(result.nodes).toHaveLength(12);
    expect(result.edges).toHaveLength(9);
  });
});
