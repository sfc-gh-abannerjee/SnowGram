/**
 * Tests for layout utility functions — bounding box, DAG layout, boundary fitting.
 *
 * These tests verify spacing, positioning, and boundary sizing logic extracted
 * from App.tsx for deterministic, testable layout behaviour.
 */
import { describe, it, expect } from 'vitest';
import {
  boundingBox,
  layoutDAG,
  fitNodesIntoBoundary,
  fitAllBoundaries,
  LAYOUT_CONSTANTS,
  PROVIDER_KEYWORDS,
  EXTERNAL_PROVIDERS,
} from '../layoutUtils';

// ---------------------------------------------------------------------------
// Helper to build minimal node objects for tests
// ---------------------------------------------------------------------------
const makeNode = (
  id: string,
  x: number,
  y: number,
  opts?: { width?: number; height?: number; componentType?: string; label?: string },
) => ({
  id,
  position: { x, y },
  data: {
    label: opts?.label || id,
    componentType: opts?.componentType || 'table',
  },
  style: {
    width: opts?.width ?? LAYOUT_CONSTANTS.STANDARD_NODE_WIDTH,
    height: opts?.height ?? LAYOUT_CONSTANTS.STANDARD_NODE_HEIGHT,
  },
});

const makeEdge = (source: string, target: string) => ({
  id: `${source}->${target}`,
  source,
  target,
});

// ---------------------------------------------------------------------------
// LAYOUT_CONSTANTS — verify values are consistent
// ---------------------------------------------------------------------------
describe('LAYOUT_CONSTANTS', () => {
  it('STANDARD_NODE dimensions match ELK node dimensions', () => {
    expect(LAYOUT_CONSTANTS.STANDARD_NODE_WIDTH).toBe(150);
    expect(LAYOUT_CONSTANTS.STANDARD_NODE_HEIGHT).toBe(130);
  });

  it('DEFAULT_NODE dimensions are >= STANDARD', () => {
    expect(LAYOUT_CONSTANTS.DEFAULT_NODE_WIDTH).toBeGreaterThanOrEqual(
      LAYOUT_CONSTANTS.STANDARD_NODE_WIDTH,
    );
    expect(LAYOUT_CONSTANTS.DEFAULT_NODE_HEIGHT).toBeGreaterThanOrEqual(
      LAYOUT_CONSTANTS.STANDARD_NODE_HEIGHT,
    );
  });

  it('boundary top padding is larger than bottom (room for label)', () => {
    expect(LAYOUT_CONSTANTS.BOUNDARY_PADDING_Y_TOP).toBeGreaterThan(
      LAYOUT_CONSTANTS.BOUNDARY_PADDING_Y_BOTTOM,
    );
  });

  it('boundary gap is positive', () => {
    expect(LAYOUT_CONSTANTS.BOUNDARY_GAP).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// boundingBox — computes axis-aligned bounding rectangle
// ---------------------------------------------------------------------------
describe('boundingBox', () => {
  it('returns null for empty array', () => {
    expect(boundingBox([])).toBeNull();
  });

  it('computes correct box for a single node', () => {
    const nodes = [makeNode('a', 100, 200)];
    const box = boundingBox(nodes as any);
    expect(box).toEqual({
      minX: 100,
      minY: 200,
      maxX: 100 + LAYOUT_CONSTANTS.STANDARD_NODE_WIDTH,
      maxY: 200 + LAYOUT_CONSTANTS.STANDARD_NODE_HEIGHT,
    });
  });

  it('computes correct box for two nodes in a row', () => {
    const nodes = [
      makeNode('a', 0, 0),
      makeNode('b', 300, 0),
    ];
    const box = boundingBox(nodes as any);
    expect(box!.minX).toBe(0);
    expect(box!.maxX).toBe(300 + LAYOUT_CONSTANTS.STANDARD_NODE_WIDTH);
    expect(box!.minY).toBe(0);
    expect(box!.maxY).toBe(LAYOUT_CONSTANTS.STANDARD_NODE_HEIGHT);
  });

  it('computes correct box for nodes at different positions', () => {
    const nodes = [
      makeNode('a', 50, 100),
      makeNode('b', 200, 300),
      makeNode('c', 10, 500),
    ];
    const box = boundingBox(nodes as any);
    expect(box!.minX).toBe(10);
    expect(box!.minY).toBe(100);
    expect(box!.maxX).toBe(200 + LAYOUT_CONSTANTS.STANDARD_NODE_WIDTH);
    expect(box!.maxY).toBe(500 + LAYOUT_CONSTANTS.STANDARD_NODE_HEIGHT);
  });

  it('respects explicit node width/height from style', () => {
    const nodes = [makeNode('big', 0, 0, { width: 400, height: 300 })];
    const box = boundingBox(nodes as any);
    expect(box!.maxX).toBe(400);
    expect(box!.maxY).toBe(300);
  });

  it('falls back to DEFAULT_NODE dimensions when style has no width/height', () => {
    const nodes = [{ id: 'x', position: { x: 0, y: 0 }, data: { label: 'X' }, style: {} }];
    const box = boundingBox(nodes as any);
    expect(box!.maxX).toBe(LAYOUT_CONSTANTS.DEFAULT_NODE_WIDTH);
    expect(box!.maxY).toBe(LAYOUT_CONSTANTS.DEFAULT_NODE_HEIGHT);
  });
});

// ---------------------------------------------------------------------------
// layoutDAG — topological sort-based layout
// ---------------------------------------------------------------------------
describe('layoutDAG', () => {
  it('assigns level 0 to nodes with no incoming edges', () => {
    const nodes = [makeNode('a', 0, 0), makeNode('b', 0, 0)];
    const edges = [makeEdge('a', 'b')];
    const result = layoutDAG(nodes as any, edges as any);
    expect(result.find((n) => n.id === 'a')!.position.x).toBeLessThan(
      result.find((n) => n.id === 'b')!.position.x,
    );
  });

  it('places linear chain in left-to-right order', () => {
    const nodes = [
      makeNode('a', 0, 0),
      makeNode('b', 0, 0),
      makeNode('c', 0, 0),
    ];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const result = layoutDAG(nodes as any, edges as any);
    const xA = result.find((n) => n.id === 'a')!.position.x;
    const xB = result.find((n) => n.id === 'b')!.position.x;
    const xC = result.find((n) => n.id === 'c')!.position.x;
    expect(xA).toBeLessThan(xB);
    expect(xB).toBeLessThan(xC);
  });

  it('nodes at same level are stacked vertically', () => {
    const nodes = [
      makeNode('src', 0, 0),
      makeNode('a', 0, 0),
      makeNode('b', 0, 0),
    ];
    const edges = [makeEdge('src', 'a'), makeEdge('src', 'b')];
    const result = layoutDAG(nodes as any, edges as any);
    const posA = result.find((n) => n.id === 'a')!.position;
    const posB = result.find((n) => n.id === 'b')!.position;
    // Same X (same level), different Y
    expect(posA.x).toBe(posB.x);
    expect(posA.y).not.toBe(posB.y);
  });

  it('handles disconnected nodes (no edges)', () => {
    const nodes = [makeNode('a', 0, 0), makeNode('b', 0, 0)];
    const result = layoutDAG(nodes as any, []);
    // All at level 0 — stacked vertically
    expect(result).toHaveLength(2);
    expect(result[0].position.x).toBe(result[1].position.x);
    expect(result[0].position.y).not.toBe(result[1].position.y);
  });

  it('returns empty array for empty input', () => {
    expect(layoutDAG([], [])).toHaveLength(0);
  });

  it('does not produce negative positions', () => {
    const nodes = [
      makeNode('a', 0, 0),
      makeNode('b', 0, 0),
      makeNode('c', 0, 0),
      makeNode('d', 0, 0),
    ];
    const edges = [
      makeEdge('a', 'b'),
      makeEdge('b', 'c'),
      makeEdge('c', 'd'),
    ];
    const result = layoutDAG(nodes as any, edges as any);
    result.forEach((n) => {
      expect(n.position.x).toBeGreaterThanOrEqual(0);
      expect(n.position.y).toBeGreaterThanOrEqual(0);
    });
  });

  it('spacing between columns is at least X_SPACING', () => {
    const nodes = [
      makeNode('a', 0, 0),
      makeNode('b', 0, 0),
    ];
    const edges = [makeEdge('a', 'b')];
    const result = layoutDAG(nodes as any, edges as any);
    const xA = result.find((n) => n.id === 'a')!.position.x;
    const xB = result.find((n) => n.id === 'b')!.position.x;
    expect(xB - xA).toBeGreaterThanOrEqual(LAYOUT_CONSTANTS.DAG_X_SPACING);
  });

  it('spacing between rows is at least Y_SPACING', () => {
    const nodes = [
      makeNode('src', 0, 0),
      makeNode('a', 0, 0),
      makeNode('b', 0, 0),
    ];
    const edges = [makeEdge('src', 'a'), makeEdge('src', 'b')];
    const result = layoutDAG(nodes as any, edges as any);
    const yA = result.find((n) => n.id === 'a')!.position.y;
    const yB = result.find((n) => n.id === 'b')!.position.y;
    expect(Math.abs(yA - yB)).toBeGreaterThanOrEqual(LAYOUT_CONSTANTS.DAG_Y_SPACING);
  });
});

// ---------------------------------------------------------------------------
// fitNodesIntoBoundary — repositions nodes + sizes boundary
// ---------------------------------------------------------------------------
describe('fitNodesIntoBoundary', () => {
  it('returns original nodes when no boundary exists for provider', () => {
    const nodes = [makeNode('kafka', 100, 200, { componentType: 'ext_kafka' })];
    const result = fitNodesIntoBoundary(nodes as any, 'kafka');
    // No boundary → nodes unchanged
    expect(result.nodes[0].position.x).toBe(100);
    expect(result.nodes[0].position.y).toBe(200);
    expect(result.boundary).toBeNull();
  });

  it('does NOT reposition snowflake nodes (only resizes boundary)', () => {
    const boundary = makeNode('account_boundary_snowflake', 0, 0, {
      componentType: 'account_boundary_snowflake',
      width: 500,
      height: 400,
    });
    const child = makeNode('bronze', 100, 200, { componentType: 'sf_bronze_layer', label: 'Bronze Layer' });
    const nodes = [boundary, child];
    const result = fitNodesIntoBoundary(nodes as any, 'snowflake');
    // Child node position should be UNCHANGED
    const childResult = result.nodes.find((n) => n.id === 'bronze');
    expect(childResult!.position.x).toBe(100);
    expect(childResult!.position.y).toBe(200);
  });

  it('repositions external nodes into vertical stack inside boundary', () => {
    const boundary = makeNode('account_boundary_kafka', 0, 0, {
      componentType: 'account_boundary_kafka',
      width: 300,
      height: 300,
    });
    const k1 = makeNode('kafka_1', 500, 500, { componentType: 'ext_kafka', label: 'Kafka Topic 1' });
    const k2 = makeNode('kafka_2', 600, 600, { componentType: 'ext_kafka', label: 'Kafka Topic 2' });
    const nodes = [boundary, k1, k2];
    const result = fitNodesIntoBoundary(nodes as any, 'kafka');
    const n1 = result.nodes.find((n) => n.id === 'kafka_1')!;
    const n2 = result.nodes.find((n) => n.id === 'kafka_2')!;
    // Both should be inside boundary area
    expect(n1.position.x).toBeGreaterThan(0); // inside boundary
    expect(n2.position.x).toBe(n1.position.x); // same column
    expect(n2.position.y).toBeGreaterThan(n1.position.y); // stacked below
  });

  it('resizes boundary to encompass all child nodes with padding', () => {
    const boundary = makeNode('account_boundary_kafka', 0, 0, {
      componentType: 'account_boundary_kafka',
      width: 100,
      height: 100,
    });
    const k1 = makeNode('kafka', 500, 500, { componentType: 'ext_kafka', label: 'Kafka' });
    const nodes = [boundary, k1];
    const result = fitNodesIntoBoundary(nodes as any, 'kafka');
    const b = result.boundary!;
    const child = result.nodes.find((n) => n.id === 'kafka')!;
    // Boundary should fully contain child with padding
    expect(b.position.x).toBeLessThan(child.position.x);
    expect(b.position.y).toBeLessThan(child.position.y);
    const bRight = b.position.x + ((b.style as any)?.width || 0);
    const bBottom = b.position.y + ((b.style as any)?.height || 0);
    const childRight = child.position.x + LAYOUT_CONSTANTS.STANDARD_NODE_WIDTH;
    const childBottom = child.position.y + LAYOUT_CONSTANTS.STANDARD_NODE_HEIGHT;
    expect(bRight).toBeGreaterThan(childRight);
    expect(bBottom).toBeGreaterThan(childBottom);
  });

  it('stacked nodes have consistent vertical spacing', () => {
    const boundary = makeNode('account_boundary_aws', 0, 0, {
      componentType: 'account_boundary_aws',
      width: 300,
      height: 600,
    });
    const nodes = [
      boundary,
      makeNode('s3_1', 0, 0, { componentType: 's3', label: 'S3 Bucket 1' }),
      makeNode('s3_2', 0, 0, { componentType: 's3', label: 'S3 Bucket 2' }),
      makeNode('s3_3', 0, 0, { componentType: 's3', label: 'S3 Bucket 3' }),
    ];
    const result = fitNodesIntoBoundary(nodes as any, 'aws');
    const children = result.nodes.filter((n) => !n.id.startsWith('account_boundary'));
    // Vertical spacing between each pair should be equal
    const gap1 = children[1].position.y - children[0].position.y;
    const gap2 = children[2].position.y - children[1].position.y;
    expect(gap1).toBe(gap2);
    expect(gap1).toBeGreaterThanOrEqual(LAYOUT_CONSTANTS.STANDARD_NODE_HEIGHT);
  });
});

// ---------------------------------------------------------------------------
// PROVIDER_KEYWORDS — verify exported keyword map
// ---------------------------------------------------------------------------
describe('PROVIDER_KEYWORDS', () => {
  it('contains all expected providers', () => {
    expect(Object.keys(PROVIDER_KEYWORDS)).toEqual(
      expect.arrayContaining(['aws', 'azure', 'gcp', 'kafka', 'snowflake']),
    );
  });

  it('each provider has at least one keyword', () => {
    Object.values(PROVIDER_KEYWORDS).forEach((kws) => {
      expect(kws.length).toBeGreaterThan(0);
    });
  });

  it('snowpipe/pipe/ingest are NOT in snowflake keywords (they match Snowpipe Streaming which belongs in kafka)', () => {
    // These generic terms were removed because they match "Snowpipe Streaming"
    // which belongs in the kafka/streaming source boundary. Including them in
    // snowflake keywords causes the Snowflake boundary to extend and overlap
    // with external boundaries.
    expect(PROVIDER_KEYWORDS.snowflake).not.toContain('snowpipe');
    expect(PROVIDER_KEYWORDS.snowflake).not.toContain('pipe');
    expect(PROVIDER_KEYWORDS.snowflake).not.toContain('ingest');
    expect(PROVIDER_KEYWORDS.snowflake).not.toContain('streaming');
  });

  it('snowpipe is NOT in aws keywords (Snowpipe works with any external stage)', () => {
    expect(PROVIDER_KEYWORDS.aws).not.toContain('snowpipe');
    expect(PROVIDER_KEYWORDS.aws).not.toContain('pipe');
  });

  it('snowpipe_streaming is in KAFKA keywords (it is the ingestion bridge from external streaming sources)', () => {
    // Snowpipe Streaming is the ingestion point FROM Kafka INTO Snowflake.
    // Visually, it belongs in the external/streaming source boundary to prevent
    // the Snowflake boundary from extending leftward and overlapping with Kafka.
    expect(PROVIDER_KEYWORDS.kafka).toContain('snowpipe_streaming');
    expect(PROVIDER_KEYWORDS.snowflake).not.toContain('snowpipe_streaming');
  });

  it('stream is NOT in snowflake keywords (prevents Kafka Stream from being included in Snowflake boundary)', () => {
    // The word 'stream' matches "Kafka Stream" labels, which would cause
    // fitNodesIntoBoundary to incorrectly include Kafka nodes in the Snowflake boundary.
    // Use 'cdc' for CDC streams instead.
    expect(PROVIDER_KEYWORDS.snowflake).not.toContain('stream');
    expect(PROVIDER_KEYWORDS.snowflake).toContain('cdc'); // CDC streams still work
  });

  it('EXTERNAL_PROVIDERS contains all non-snowflake providers for correct processing order', () => {
    // External providers are processed BEFORE snowflake to ensure their nodes
    // aren't claimed by the Snowflake boundary. This prevents boundary overlap.
    expect(EXTERNAL_PROVIDERS).toContain('aws');
    expect(EXTERNAL_PROVIDERS).toContain('azure');
    expect(EXTERNAL_PROVIDERS).toContain('gcp');
    expect(EXTERNAL_PROVIDERS).toContain('kafka');
    expect(EXTERNAL_PROVIDERS).not.toContain('snowflake');
  });
});

// ---------------------------------------------------------------------------
// fitAllBoundaries — multi-provider wrapper
// ---------------------------------------------------------------------------
describe('fitAllBoundaries', () => {
  it('fits nodes into multiple provider boundaries in a single call', () => {
    const nodes = [
      makeNode('account_boundary_aws', 0, 0, {
        componentType: 'account_boundary_aws',
        width: 300,
        height: 400,
      }),
      makeNode('account_boundary_kafka', 400, 0, {
        componentType: 'account_boundary_kafka',
        width: 300,
        height: 400,
      }),
      makeNode('s3_bucket', 50, 50, { componentType: 's3', label: 'S3 Bucket' }),
      makeNode('kafka_topic', 450, 50, { componentType: 'kafka', label: 'Kafka Topic' }),
    ];
    const result = fitAllBoundaries(nodes as any);
    // Both boundaries should exist
    const awsBound = result.find((n) => n.id === 'account_boundary_aws');
    const kafkaBound = result.find((n) => n.id === 'account_boundary_kafka');
    expect(awsBound).toBeDefined();
    expect(kafkaBound).toBeDefined();
    // Child nodes should be repositioned inside their respective boundaries
    const s3 = result.find((n) => n.id === 's3_bucket')!;
    const kafka = result.find((n) => n.id === 'kafka_topic')!;
    expect(s3.position.x).toBeGreaterThanOrEqual(awsBound!.position.x);
    expect(kafka.position.x).toBeGreaterThanOrEqual(kafkaBound!.position.x);
  });

  it('returns unchanged nodes when no boundaries exist', () => {
    const nodes = [
      makeNode('table_1', 0, 0, { componentType: 'table' }),
      makeNode('table_2', 200, 0, { componentType: 'table' }),
    ];
    const result = fitAllBoundaries(nodes as any);
    expect(result).toHaveLength(2);
    expect(result[0].position).toEqual({ x: 0, y: 0 });
    expect(result[1].position).toEqual({ x: 200, y: 0 });
  });

  it('handles snowflake boundary as measure-only (no reposition)', () => {
    const nodes = [
      makeNode('account_boundary_snowflake', 0, 0, {
        componentType: 'account_boundary_snowflake',
        width: 800,
        height: 600,
      }),
      makeNode('bronze_layer', 100, 200, { componentType: 'layer', label: 'Bronze Layer' }),
      makeNode('silver_layer', 300, 200, { componentType: 'layer', label: 'Silver Layer' }),
    ];
    const result = fitAllBoundaries(nodes as any);
    // Snowflake children should NOT be repositioned
    const bronze = result.find((n) => n.id === 'bronze_layer')!;
    const silver = result.find((n) => n.id === 'silver_layer')!;
    expect(bronze.position).toEqual({ x: 100, y: 200 });
    expect(silver.position).toEqual({ x: 300, y: 200 });
    // But the boundary should be resized to fit
    const sfBound = result.find((n) => n.id === 'account_boundary_snowflake')!;
    expect((sfBound.style as any)?.width).toBeGreaterThan(0);
    expect((sfBound.style as any)?.height).toBeGreaterThan(0);
  });

  it('processes all providers even when some have no matching children', () => {
    const nodes = [
      makeNode('account_boundary_aws', 0, 0, {
        componentType: 'account_boundary_aws',
        width: 300,
        height: 400,
      }),
      makeNode('account_boundary_gcp', 400, 0, {
        componentType: 'account_boundary_gcp',
        width: 300,
        height: 400,
      }),
      // Only AWS has children
      makeNode('s3_bucket', 50, 50, { componentType: 's3', label: 'S3 Bucket' }),
    ];
    const result = fitAllBoundaries(nodes as any);
    expect(result).toHaveLength(3);
    // AWS child should be repositioned
    const s3 = result.find((n) => n.id === 's3_bucket')!;
    const awsBound = result.find((n) => n.id === 'account_boundary_aws')!;
    expect(s3.position.x).toBeGreaterThanOrEqual(awsBound.position.x);
  });
});
