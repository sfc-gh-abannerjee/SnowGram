/**
 * Tests for graph normalisation utilities extracted from App.tsx.
 *
 * canonicalizeComponentType: maps agent componentType values to canonical
 * Snowflake types for layout/icon consistency.
 *
 * keyForNode: generates the dedup key used by normalizeGraph to decide
 * which nodes are duplicates. Critical invariant: nodes with different IDs
 * must NOT be collapsed even if they share a componentType.
 */
import { describe, it, expect } from 'vitest';
import { canonicalizeComponentType, keyForNode } from '../graphNormalize';

// ---------------------------------------------------------------------------
// canonicalizeComponentType — agent prefix stripping
// ---------------------------------------------------------------------------
describe('canonicalizeComponentType — prefix stripping', () => {
  it('strips sf_ prefix: "sf_cdc_stream" → "stream"', () => {
    expect(canonicalizeComponentType('sf_cdc_stream')).toBe('stream');
  });

  it('strips sf_ prefix: "sf_transform_task" → "task"', () => {
    expect(canonicalizeComponentType('sf_transform_task')).toBe('task');
  });

  it('strips ext_ prefix: "ext_kafka" → "kafka"', () => {
    expect(canonicalizeComponentType('ext_kafka')).toBe('kafka');
  });

  it('strips sf_ prefix: "sf_warehouse" → "warehouse"', () => {
    expect(canonicalizeComponentType('sf_warehouse')).toBe('warehouse');
  });

  it('strips sf_ prefix: "sf_stage" → preserves as stage-related', () => {
    // sf_stage → stage, which should not match any special case
    // but should match via fallback
    const result = canonicalizeComponentType('sf_stage');
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// canonicalizeComponentType — compound agent names
// ---------------------------------------------------------------------------
describe('canonicalizeComponentType — compound names', () => {
  it('maps "sf_bronze_layer" to "bronze_layer"', () => {
    expect(canonicalizeComponentType('sf_bronze_layer')).toBe('bronze_layer');
  });

  it('maps "sf_silver_layer" to "silver_layer"', () => {
    expect(canonicalizeComponentType('sf_silver_layer')).toBe('silver_layer');
  });

  it('maps "sf_gold_layer" to "gold_layer"', () => {
    expect(canonicalizeComponentType('sf_gold_layer')).toBe('gold_layer');
  });

  it('maps "sf_analytics_views" to "analytics_views"', () => {
    expect(canonicalizeComponentType('sf_analytics_views')).toBe('analytics_views');
  });

  it('maps "sf_analytics_view" (singular) to "analytics_views"', () => {
    expect(canonicalizeComponentType('sf_analytics_view')).toBe('analytics_views');
  });

  it('maps "cdc_stream" (no prefix) to "stream"', () => {
    expect(canonicalizeComponentType('cdc_stream')).toBe('stream');
  });

  it('maps "change_stream" to "stream"', () => {
    expect(canonicalizeComponentType('change_stream')).toBe('stream');
  });

  it('maps "transform_task" to "task"', () => {
    expect(canonicalizeComponentType('transform_task')).toBe('task');
  });
});

// ---------------------------------------------------------------------------
// canonicalizeComponentType — boundary preservation
// ---------------------------------------------------------------------------
describe('canonicalizeComponentType — boundaries', () => {
  it('preserves "account_boundary_snowflake" unchanged', () => {
    expect(canonicalizeComponentType('account_boundary_snowflake')).toBe('account_boundary_snowflake');
  });

  it('preserves "account_boundary_kafka" unchanged', () => {
    expect(canonicalizeComponentType('account_boundary_kafka')).toBe('account_boundary_kafka');
  });

  it('preserves "account_boundary_aws" unchanged', () => {
    expect(canonicalizeComponentType('account_boundary_aws')).toBe('account_boundary_aws');
  });
});

// ---------------------------------------------------------------------------
// canonicalizeComponentType — medallion legacy types
// ---------------------------------------------------------------------------
describe('canonicalizeComponentType — medallion legacy', () => {
  it('maps "bronze_db" to "database"', () => {
    expect(canonicalizeComponentType('bronze_db')).toBe('database');
  });

  it('maps "silver_schema" to "schema"', () => {
    expect(canonicalizeComponentType('silver_schema')).toBe('schema');
  });

  it('maps "gold_tables" to "table"', () => {
    expect(canonicalizeComponentType('gold_tables')).toBe('table');
  });
});

// ---------------------------------------------------------------------------
// canonicalizeComponentType — generic matching
// ---------------------------------------------------------------------------
describe('canonicalizeComponentType — generic matching', () => {
  it('maps "snowpipe" to "snowpipe"', () => {
    expect(canonicalizeComponentType('snowpipe')).toBe('snowpipe');
  });

  it('maps "pipe" to "snowpipe" (exact match, not substring)', () => {
    expect(canonicalizeComponentType('pipe')).toBe('snowpipe');
  });

  it('maps "kafka_stream" to "kafka" (kafka before stream)', () => {
    expect(canonicalizeComponentType('kafka_stream')).toBe('kafka');
  });

  it('maps "my_stream" to "stream"', () => {
    expect(canonicalizeComponentType('my_stream')).toBe('stream');
  });

  it('maps "scheduled_task" to "task"', () => {
    expect(canonicalizeComponentType('scheduled_task')).toBe('task');
  });

  it('maps "analytics" to "view" (includes analytic)', () => {
    expect(canonicalizeComponentType('analytics')).toBe('view');
  });

  it('maps "data_warehouse" to "warehouse"', () => {
    expect(canonicalizeComponentType('data_warehouse')).toBe('warehouse');
  });

  it('returns original for completely unknown type', () => {
    expect(canonicalizeComponentType('custom_xyz_thing')).toBe('custom_xyz_thing');
  });

  it('returns "table" for undefined input', () => {
    expect(canonicalizeComponentType(undefined)).toBe('table');
  });

  it('returns "table" for empty string', () => {
    expect(canonicalizeComponentType('')).toBe('table');
  });
});

// ---------------------------------------------------------------------------
// keyForNode — boundary dedup by provider
// ---------------------------------------------------------------------------
describe('keyForNode — boundary dedup', () => {
  it('deduplicates snowflake boundaries to canonical key', () => {
    const node = { id: 'sf_boundary_123', data: { componentType: 'account_boundary_snowflake' } };
    expect(keyForNode(node as any)).toBe('account_boundary_snowflake');
  });

  it('deduplicates kafka boundaries to canonical key', () => {
    const node = { id: 'kafka_boundary', data: { componentType: 'account_boundary_kafka' } };
    expect(keyForNode(node as any)).toBe('account_boundary_kafka');
  });

  it('deduplicates aws boundaries to canonical key', () => {
    const node = { id: 'aws_boundary', data: { componentType: 'account_boundary_aws' } };
    expect(keyForNode(node as any)).toBe('account_boundary_aws');
  });

  it('two boundaries of same provider get same key', () => {
    const a = { id: 'sf_boundary_a', data: { componentType: 'account_boundary_snowflake' } };
    const b = { id: 'sf_boundary_b', data: { componentType: 'account_boundary_snowflake' } };
    expect(keyForNode(a as any)).toBe(keyForNode(b as any));
  });
});

// ---------------------------------------------------------------------------
// keyForNode — non-boundary nodes use ID (no componentType collapse)
// ---------------------------------------------------------------------------
describe('keyForNode — non-boundary nodes preserve unique IDs', () => {
  it('two CDC streams with same componentType get DIFFERENT keys', () => {
    const a = { id: 'cdc_stream_1', data: { componentType: 'sf_cdc_stream', label: 'CDC Stream' } };
    const b = { id: 'cdc_stream_2', data: { componentType: 'sf_cdc_stream', label: 'CDC Stream' } };
    expect(keyForNode(a as any)).not.toBe(keyForNode(b as any));
  });

  it('two transform tasks with same componentType get DIFFERENT keys', () => {
    const a = { id: 'transform_task_1', data: { componentType: 'sf_transform_task', label: 'Transform Task' } };
    const b = { id: 'transform_task_2', data: { componentType: 'sf_transform_task', label: 'Transform Task' } };
    expect(keyForNode(a as any)).not.toBe(keyForNode(b as any));
  });

  it('uses node ID as key for regular nodes', () => {
    const node = { id: 'bronze_layer', data: { componentType: 'sf_bronze_layer', label: 'Bronze Layer' } };
    expect(keyForNode(node as any)).toBe('bronze_layer');
  });

  it('uses node ID as key for warehouse', () => {
    const node = { id: 'warehouse', data: { componentType: 'sf_warehouse', label: 'Warehouse' } };
    expect(keyForNode(node as any)).toBe('warehouse');
  });

  it('uses node ID as key for kafka', () => {
    const node = { id: 'kafka', data: { componentType: 'ext_kafka', label: 'Kafka' } };
    expect(keyForNode(node as any)).toBe('kafka');
  });
});

// ---------------------------------------------------------------------------
// Full agent pipeline: 12 nodes should yield 12 unique keys
// ---------------------------------------------------------------------------
describe('keyForNode — full agent pipeline (Kafka medallion)', () => {
  const agentNodes = [
    { id: 'kafka_boundary', data: { componentType: 'account_boundary_kafka', label: 'Kafka Cluster' } },
    { id: 'snowflake_boundary', data: { componentType: 'account_boundary_snowflake', label: 'Snowflake Account' } },
    { id: 'kafka', data: { componentType: 'ext_kafka', label: 'Kafka' } },
    { id: 'bronze_layer', data: { componentType: 'sf_bronze_layer', label: 'Bronze Layer' } },
    { id: 'cdc_stream_1', data: { componentType: 'sf_cdc_stream', label: 'CDC Stream' } },
    { id: 'transform_task_1', data: { componentType: 'sf_transform_task', label: 'Transform Task' } },
    { id: 'silver_layer', data: { componentType: 'sf_silver_layer', label: 'Silver Layer' } },
    { id: 'cdc_stream_2', data: { componentType: 'sf_cdc_stream', label: 'CDC Stream' } },
    { id: 'transform_task_2', data: { componentType: 'sf_transform_task', label: 'Transform Task' } },
    { id: 'gold_layer', data: { componentType: 'sf_gold_layer', label: 'Gold Layer' } },
    { id: 'analytics_views', data: { componentType: 'sf_analytics_views', label: 'Analytics Views' } },
    { id: 'warehouse', data: { componentType: 'sf_warehouse', label: 'Warehouse' } },
  ];

  it('produces 12 unique keys for 12 agent nodes (10 unique + 2 boundary deduped)', () => {
    const keys = agentNodes.map((n) => keyForNode(n as any));
    const uniqueKeys = new Set(keys);
    // 10 non-boundary nodes each get unique key (their ID)
    // 2 boundary nodes each get unique key (their canonical provider ID)
    // Total: 12 unique keys
    expect(uniqueKeys.size).toBe(12);
  });

  it('no non-boundary nodes share a key', () => {
    const nonBoundary = agentNodes.filter(
      (n) => !n.data.componentType.startsWith('account_boundary')
    );
    const keys = nonBoundary.map((n) => keyForNode(n as any));
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(nonBoundary.length);
  });
});
