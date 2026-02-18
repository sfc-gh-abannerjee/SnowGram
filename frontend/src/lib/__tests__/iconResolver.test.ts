/**
 * Tests for iconResolver — the 4-tier icon resolution system.
 *
 * These tests verify:
 *  - Tier 1: Exact match on SNOWFLAKE_ICONS keys (after normalise)
 *  - Tier 2: Keyword scoring (prefix 80pts > contains 60pts)
 *  - Tier 3: Semantic fallback by flowStageOrder
 *  - Tier 4: Generic data icon fallback
 *  - Agent prefix stripping (sf_, ext_, src_, tgt_)
 *  - Compound keyword resolution (cdc_stream, transform_task, etc.)
 */
import { describe, it, expect } from 'vitest';
import { resolveIcon } from '../iconResolver';
import { SNOWFLAKE_ICONS } from '../../components/iconMap';

// ---------------------------------------------------------------------------
// Tier 1: Exact match after normalisation
// ---------------------------------------------------------------------------
describe('Tier 1 — exact match', () => {
  it('resolves "warehouse" to the warehouse icon', () => {
    expect(resolveIcon('warehouse')).toBe(SNOWFLAKE_ICONS.warehouse);
  });

  it('resolves "table" to the table icon', () => {
    expect(resolveIcon('table')).toBe(SNOWFLAKE_ICONS.table);
  });

  it('resolves "stream" to the stream icon', () => {
    expect(resolveIcon('stream')).toBe(SNOWFLAKE_ICONS.stream);
  });

  it('resolves "task" to the task icon', () => {
    expect(resolveIcon('task')).toBe(SNOWFLAKE_ICONS.task);
  });

  it('resolves "view" to the view icon', () => {
    expect(resolveIcon('view')).toBe(SNOWFLAKE_ICONS.view);
  });

  it('resolves "database" to the database icon', () => {
    expect(resolveIcon('database')).toBe(SNOWFLAKE_ICONS.database);
  });

  it('resolves "kafka" to the kafka icon', () => {
    expect(resolveIcon('kafka')).toBe(SNOWFLAKE_ICONS.kafka);
  });
});

// ---------------------------------------------------------------------------
// Agent prefix stripping (sf_, ext_) → Tier 1
// ---------------------------------------------------------------------------
describe('Agent prefix stripping → Tier 1', () => {
  it('strips sf_ prefix: "sf_warehouse" → warehouse icon', () => {
    expect(resolveIcon('sf_warehouse')).toBe(SNOWFLAKE_ICONS.warehouse);
  });

  it('strips ext_ prefix: "ext_kafka" → kafka icon', () => {
    expect(resolveIcon('ext_kafka')).toBe(SNOWFLAKE_ICONS.kafka);
  });

  it('strips sf_ prefix: "sf_table" → table icon', () => {
    expect(resolveIcon('sf_table')).toBe(SNOWFLAKE_ICONS.table);
  });

  it('strips sf_ prefix: "sf_stream" → stream icon', () => {
    expect(resolveIcon('sf_stream')).toBe(SNOWFLAKE_ICONS.stream);
  });

  it('strips src_ prefix: "src_database" → database icon', () => {
    expect(resolveIcon('src_database')).toBe(SNOWFLAKE_ICONS.database);
  });

  it('strips tgt_ prefix: "tgt_view" → view icon', () => {
    expect(resolveIcon('tgt_view')).toBe(SNOWFLAKE_ICONS.view);
  });
});

// ---------------------------------------------------------------------------
// Tier 2: Keyword scoring — compound agent names
// ---------------------------------------------------------------------------
describe('Tier 2 — compound keyword scoring', () => {
  it('resolves "sf_cdc_stream" to stream icon (not workload_data_eng)', () => {
    expect(resolveIcon('sf_cdc_stream')).toBe(SNOWFLAKE_ICONS.stream);
  });

  it('resolves "sf_transform_task" to task icon (not workload_data_eng)', () => {
    expect(resolveIcon('sf_transform_task')).toBe(SNOWFLAKE_ICONS.task);
  });

  it('resolves "sf_bronze_layer" to database icon (consistent layer icon)', () => {
    expect(resolveIcon('sf_bronze_layer')).toBe(SNOWFLAKE_ICONS.database);
  });

  it('resolves "sf_silver_layer" to database icon (consistent layer icon)', () => {
    expect(resolveIcon('sf_silver_layer')).toBe(SNOWFLAKE_ICONS.database);
  });

  it('resolves "sf_gold_layer" to database icon (consistent layer icon)', () => {
    expect(resolveIcon('sf_gold_layer')).toBe(SNOWFLAKE_ICONS.database);
  });

  it('resolves "sf_analytics_views" to analytics icon', () => {
    expect(resolveIcon('sf_analytics_views')).toBe(SNOWFLAKE_ICONS.analytics);
  });

  it('resolves "cdc_stream" (no prefix) to stream icon', () => {
    expect(resolveIcon('cdc_stream')).toBe(SNOWFLAKE_ICONS.stream);
  });

  it('resolves "transform_task" (no prefix) to task icon', () => {
    expect(resolveIcon('transform_task')).toBe(SNOWFLAKE_ICONS.task);
  });

  it('resolves "bronze_layer" (no prefix) to database icon (consistent layer icon)', () => {
    expect(resolveIcon('bronze_layer')).toBe(SNOWFLAKE_ICONS.database);
  });
});

// ---------------------------------------------------------------------------
// Tier 2: Keyword scoring — external sources
// ---------------------------------------------------------------------------
describe('Tier 2 — external source keywords', () => {
  it('resolves "s3_bucket" to s3 icon', () => {
    expect(resolveIcon('s3_bucket')).toBe(SNOWFLAKE_ICONS.s3);
  });

  it('resolves "postgres" to database icon', () => {
    expect(resolveIcon('postgres')).toBe(SNOWFLAKE_ICONS.database);
  });

  it('resolves "tableau" to analytics icon', () => {
    expect(resolveIcon('tableau')).toBe(SNOWFLAKE_ICONS.analytics);
  });

  it('resolves "streamlit" to streamlit icon', () => {
    expect(resolveIcon('streamlit')).toBe(SNOWFLAKE_ICONS.streamlit);
  });
});

// ---------------------------------------------------------------------------
// Tier 2: Keyword scoring — Snowflake objects
// ---------------------------------------------------------------------------
describe('Tier 2 — Snowflake object keywords', () => {
  it('resolves "dynamic_table" to dynamic_table icon', () => {
    expect(resolveIcon('dynamic_table')).toBe(SNOWFLAKE_ICONS.dynamic_table);
  });

  it('resolves "snowpipe" to snowpipe icon', () => {
    expect(resolveIcon('snowpipe')).toBe(SNOWFLAKE_ICONS.snowpipe);
  });

  it('resolves "stored_proc" to stored_proc icon', () => {
    expect(resolveIcon('stored_proc')).toBe(SNOWFLAKE_ICONS.stored_proc);
  });
});

// ---------------------------------------------------------------------------
// Tier 2: Label fallback when componentType has no match
// ---------------------------------------------------------------------------
describe('Tier 2 — label fallback scoring', () => {
  it('uses label when componentType has no match', () => {
    expect(resolveIcon('unknown_xyz', 'warehouse')).toBe(SNOWFLAKE_ICONS.warehouse);
  });

  it('prefers higher-scoring componentType over lower-scoring label', () => {
    // componentType "kafka_connector" → kafka (prefix 80)
    // label "some database" → database (contains 60)
    expect(resolveIcon('kafka_connector', 'some database')).toBe(SNOWFLAKE_ICONS.kafka);
  });
});

// ---------------------------------------------------------------------------
// Tier 3: flowStageOrder fallback
// ---------------------------------------------------------------------------
describe('Tier 3 — flowStageOrder fallback', () => {
  it('returns s3 icon for stage 0 (source)', () => {
    expect(resolveIcon('completely_unknown_type', undefined, 0)).toBe(SNOWFLAKE_ICONS.s3);
  });

  it('returns snowpipe icon for stage 1 (ingest)', () => {
    expect(resolveIcon('completely_unknown_type', undefined, 1)).toBe(SNOWFLAKE_ICONS.snowpipe);
  });

  it('returns analytics icon for stage 6 (consume)', () => {
    expect(resolveIcon('completely_unknown_type', undefined, 6)).toBe(SNOWFLAKE_ICONS.analytics);
  });

  it('uses stage fallback when componentType and label are empty', () => {
    expect(resolveIcon('', '', 4)).toBe(SNOWFLAKE_ICONS.workload_data_warehouse);
  });
});

// ---------------------------------------------------------------------------
// Tier 4: Generic fallback
// ---------------------------------------------------------------------------
describe('Tier 4 — generic fallback', () => {
  it('returns generic data icon for completely unknown type', () => {
    expect(resolveIcon('completely_unknown_type')).toBe(SNOWFLAKE_ICONS.data);
  });

  it('returns generic data icon for empty inputs', () => {
    expect(resolveIcon()).toBe(SNOWFLAKE_ICONS.data);
  });

  it('returns generic data icon for undefined inputs', () => {
    expect(resolveIcon(undefined, undefined, undefined)).toBe(SNOWFLAKE_ICONS.data);
  });
});

// ---------------------------------------------------------------------------
// Normalisation edge cases
// ---------------------------------------------------------------------------
describe('normalisation edge cases', () => {
  it('handles dashes: "dynamic-table" → dynamic_table icon', () => {
    expect(resolveIcon('dynamic-table')).toBe(SNOWFLAKE_ICONS.dynamic_table);
  });

  it('handles spaces: "dynamic table" → dynamic_table icon', () => {
    expect(resolveIcon('dynamic table')).toBe(SNOWFLAKE_ICONS.dynamic_table);
  });

  it('handles mixed case: "Warehouse" → warehouse icon', () => {
    expect(resolveIcon('Warehouse')).toBe(SNOWFLAKE_ICONS.warehouse);
  });

  it('handles UPPER CASE: "KAFKA" → kafka icon', () => {
    expect(resolveIcon('KAFKA')).toBe(SNOWFLAKE_ICONS.kafka);
  });

  it('handles slashes: "ext/kafka" → kafka icon', () => {
    expect(resolveIcon('ext/kafka')).toBe(SNOWFLAKE_ICONS.kafka);
  });
});

// ---------------------------------------------------------------------------
// Full agent pipeline simulation
// ---------------------------------------------------------------------------
describe('full agent pipeline — Kafka medallion', () => {
  // Simulates the exact componentType values the deployed agent returns
  const agentNodes = [
    { componentType: 'account_boundary_kafka', expected: undefined }, // boundaries get no icon
    { componentType: 'account_boundary_snowflake', expected: undefined },
    { componentType: 'ext_kafka', expected: SNOWFLAKE_ICONS.kafka },
    { componentType: 'sf_bronze_layer', expected: SNOWFLAKE_ICONS.database },  // consistent layer icon
    { componentType: 'sf_cdc_stream', expected: SNOWFLAKE_ICONS.stream },
    { componentType: 'sf_transform_task', expected: SNOWFLAKE_ICONS.task },
    { componentType: 'sf_silver_layer', expected: SNOWFLAKE_ICONS.database },  // consistent layer icon
    { componentType: 'sf_cdc_stream', expected: SNOWFLAKE_ICONS.stream },
    { componentType: 'sf_transform_task', expected: SNOWFLAKE_ICONS.task },
    { componentType: 'sf_gold_layer', expected: SNOWFLAKE_ICONS.database },  // consistent layer icon
    { componentType: 'sf_analytics_views', expected: SNOWFLAKE_ICONS.analytics },
    { componentType: 'sf_warehouse', expected: SNOWFLAKE_ICONS.warehouse },
  ];

  agentNodes.forEach(({ componentType, expected }) => {
    if (expected) {
      it(`agent "${componentType}" → correct icon`, () => {
        expect(resolveIcon(componentType)).toBe(expected);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Label-based Tier 1 fallback
// ---------------------------------------------------------------------------
describe('Label-based Tier 1 fallback', () => {
  it('resolves via label when componentType misses Tier 1', () => {
    // componentType "sf_bronze_layer" normalises to "bronze_layer" — not in SNOWFLAKE_ICONS
    // but label "Snowpipe" normalises to "snowpipe" — IS in SNOWFLAKE_ICONS
    expect(resolveIcon('some_unknown_type', 'Snowpipe')).toBe(SNOWFLAKE_ICONS.snowpipe);
  });

  it('resolves label "Kafka" via Tier 1 when componentType has no match', () => {
    expect(resolveIcon('unknown', 'Kafka')).toBe(SNOWFLAKE_ICONS.kafka);
  });
});

// ---------------------------------------------------------------------------
// Tier 3: flowStageOrder with fractional stages
// ---------------------------------------------------------------------------
describe('Tier 3 — fractional flowStageOrder fallback', () => {
  it('fractional stage 2.5 falls back to stage 2 (raw/bronze) icon', () => {
    expect(resolveIcon(undefined, undefined, 2.5)).toBe(SNOWFLAKE_ICONS.workload_data_lake);
  });

  it('fractional stage 3.5 falls back to stage 3 (transform) icon', () => {
    expect(resolveIcon(undefined, undefined, 3.5)).toBe(SNOWFLAKE_ICONS.task);
  });

  it('integer stage 0 returns source icon', () => {
    expect(resolveIcon(undefined, undefined, 0)).toBe(SNOWFLAKE_ICONS.s3);
  });
});

// ---------------------------------------------------------------------------
// Combined componentType + label with flowStageOrder
// ---------------------------------------------------------------------------
describe('Combined resolution with all arguments', () => {
  it('agent bronze_layer with label and flowStageOrder resolves correctly', () => {
    expect(resolveIcon('sf_bronze_layer', 'Bronze Layer', 2)).toBe(SNOWFLAKE_ICONS.database);
  });

  it('agent silver_layer with label and flowStageOrder resolves correctly', () => {
    expect(resolveIcon('sf_silver_layer', 'Silver Layer', 3.5)).toBe(SNOWFLAKE_ICONS.database);
  });

  it('agent gold_layer with label and flowStageOrder resolves correctly', () => {
    expect(resolveIcon('sf_gold_layer', 'Gold Layer', 4)).toBe(SNOWFLAKE_ICONS.database);
  });

  it('agent snowpipe with label resolves correctly', () => {
    expect(resolveIcon('sf_snowpipe', 'Snowpipe', 1)).toBe(SNOWFLAKE_ICONS.snowpipe);
  });
});
