# SnowGram Icon System Redesign Plan

**Date:** 2026-02-15  
**Status:** Complete

---

## Problem Statement

The current icon selection system in `App.tsx` has several limitations:

1. **Limited Coverage**: Only ~40 hardcoded mappings in `directMap` despite having 150+ icons available
2. **Fragile Matching**: Uses simple `includes()` which can match wrong icons
3. **Missing Synonyms**: Doesn't handle common variations (dbt, tableau, powerbi, etc.)
4. **No Scoring**: First match wins, not best match
5. **Poor Fallback**: Falls back to generic table icon for everything unknown

---

## Solution: Scored Keyword-Based Icon Resolver

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    resolveIcon(componentType, label, flowStage)                    │
├─────────────────────────────────────────────────────────────┤
│  1. Exact Match (score: 100)                                │
│     - Direct lookup in SNOWFLAKE_ICONS                      │
│     - "kafka" → SNOWFLAKE_ICONS.kafka                       │
├─────────────────────────────────────────────────────────────┤
│  2. Keyword Scoring (score: 60-80)                          │
│     - Match against comprehensive KEYWORD_MAP               │
│     - Prefix match: 80 points                               │
│     - Contains match: 60 points                             │
│     - Accumulate scores for multiple keyword hits           │
├─────────────────────────────────────────────────────────────┤
│  3. Semantic Fallback by flowStage (score: 40)              │
│     - source(0) → s3/kafka icon                             │
│     - transform(3) → task icon                              │
│     - serve(5) → view icon                                  │
├─────────────────────────────────────────────────────────────┤
│  4. Ultimate Fallback                                       │
│     - Return SNOWFLAKE_ICONS.data (generic data icon)       │
└─────────────────────────────────────────────────────────────┘
```

---

## Comprehensive Keyword Map

### External Data Sources
| Keywords | Icon | Notes |
|----------|------|-------|
| kafka, confluent, kinesis, event_hub, msk | `kafka` | Apache Kafka connector icon |
| s3, aws, amazon, bucket, lake | `s3` | Cloud storage icon |
| azure, adls, blob, event_grid | `s3` | Generic cloud (no Azure-specific icon) |
| gcp, gcs, bigquery, pubsub | `s3` | Generic cloud |
| postgres, mysql, oracle, sqlserver, rds | `database` | Relational DB |
| mongodb, dynamodb, cosmos, cassandra | `database` | NoSQL |

### BI & Analytics Tools
| Keywords | Icon | Notes |
|----------|------|-------|
| tableau, powerbi, looker, metabase, mode | `analytics` | BI visualization |
| sigma, thoughtspot, qlik, domo | `analytics` | BI tools |
| excel, sheets, csv | `spreadsheet` | Spreadsheet apps |

### ETL/ELT & Orchestration
| Keywords | Icon | Notes |
|----------|------|-------|
| dbt, fivetran, airbyte, matillion, stitch | `data_engineering` | ETL tools |
| airflow, dagster, prefect, mage | `task` | Orchestrators |
| spark, databricks, emr | `spark_connect` | Spark processing |

### ML & AI
| Keywords | Icon | Notes |
|----------|------|-------|
| cortex, llm, gpt, claude, gemini | `cortex` | Cortex AI |
| ml, model, predict, inference, embedding | `ai_star` | ML models |
| notebook, jupyter, colab | `notebook` | Notebooks |

### Snowflake Objects
| Keywords | Icon | Notes |
|----------|------|-------|
| stream, cdc, change, capture | `stream` | Streams |
| task, job, schedule, cron | `task` | Tasks |
| pipe, snowpipe, ingest, load | `snowpipe` | Snowpipe |
| warehouse, wh, compute | `warehouse` | Warehouses |
| dynamic_table, dt | `dynamic_table` | Dynamic Tables |
| iceberg | `iceberg_table` | Iceberg Tables |
| stage, landing | `external_stage` | Stages |

### Medallion Architecture
| Keywords | Icon | Notes |
|----------|------|-------|
| bronze, raw, landing, ingest | `workload_data_lake` | Bronze layer |
| silver, clean, transform, conform | `workload_data_eng` | Silver layer |
| gold, curated, mart, business | `workload_data_warehouse` | Gold layer |

---

## Semantic Fallbacks by flowStage

| flowStageOrder | Stage Name | Default Icon |
|----------------|------------|--------------|
| 0 | source | `s3` |
| 1 | ingest | `snowpipe` |
| 2 | raw | `workload_data_lake` |
| 3 | transform | `task` |
| 4 | refined | `workload_data_warehouse` |
| 5 | serve | `view` |
| 6 | consume | `analytics` |

---

## Implementation Files

### New File: `frontend/src/lib/iconResolver.ts`

```typescript
import { SNOWFLAKE_ICONS } from '../components/iconMap';

interface KeywordMapping {
  keywords: string[];
  icon: string;
  category: string;
  priority: number; // Higher = checked first (for ordering)
}

const KEYWORD_MAP: KeywordMapping[] = [
  // External Sources (priority 100 - most specific)
  { keywords: ['kafka', 'confluent', 'kinesis', 'event_hub'], icon: SNOWFLAKE_ICONS.kafka, category: 'source', priority: 100 },
  { keywords: ['s3', 'aws', 'amazon', 'bucket'], icon: SNOWFLAKE_ICONS.s3, category: 'source', priority: 100 },
  // ... 50+ more entries
];

const STAGE_DEFAULTS: Record<number, string> = {
  0: SNOWFLAKE_ICONS.s3,           // source
  1: SNOWFLAKE_ICONS.snowpipe,     // ingest
  2: SNOWFLAKE_ICONS.workload_data_lake,  // raw
  3: SNOWFLAKE_ICONS.task,         // transform
  4: SNOWFLAKE_ICONS.workload_data_warehouse, // refined
  5: SNOWFLAKE_ICONS.view,         // serve
  6: SNOWFLAKE_ICONS.analytics,    // consume
};

export function resolveIcon(
  componentType?: string,
  label?: string,
  flowStageOrder?: number
): string {
  // Implementation details...
}
```

### Modified: `frontend/src/App.tsx`

Replace `getIconForComponentType` with import from `iconResolver.ts`:

```typescript
import { resolveIcon } from './lib/iconResolver';

// Replace all calls to getIconForComponentType with:
// resolveIcon(componentType, label, flowStageOrder)
```

---

## Testing Checklist

- [ ] Kafka nodes show Kafka connector icon
- [ ] S3/AWS nodes show cloud icon
- [ ] dbt/Fivetran/Airbyte show data engineering icon
- [ ] Tableau/PowerBI/Looker show analytics icon
- [ ] Bronze Layer shows data lake workload icon
- [ ] Silver Layer shows data engineering workload icon
- [ ] Gold Layer shows data warehouse workload icon
- [ ] Unknown components get appropriate fallback based on flowStage
- [ ] No components show table icon unless actually tables

---

## Migration Notes

1. `getIconForComponentType` will be deprecated but kept for backwards compatibility
2. New `resolveIcon` function accepts optional `flowStageOrder` for smarter fallbacks
3. All 150+ icons in `SNOWFLAKE_ICONS` can now be resolved via keywords
