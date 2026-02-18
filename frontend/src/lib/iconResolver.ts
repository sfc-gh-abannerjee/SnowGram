/**
 * Scored keyword-based icon resolver for SnowGram architecture diagrams.
 *
 * 4-tier resolution:
 *   1. Exact match against SNOWFLAKE_ICONS keys (after normalisation)
 *   2. Keyword scoring across KEYWORD_MAP (prefix 80pts, contains 60pts)
 *   3. Semantic fallback by flowStageOrder
 *   4. Generic data icon fallback
 *
 * normalise() lowercases, converts separators to underscores, and strips
 * agent prefixes (sf_, ext_) so "sf_warehouse" → "warehouse" hits Tier 1.
 * Compound keywords ("transform_task", "analytics_views") are placed first
 * in KEYWORD_MAP so they win over partial matches in Tier 2.
 */
import { SNOWFLAKE_ICONS } from '../components/iconMap';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeywordMapping {
  keywords: string[];
  iconKey: keyof typeof SNOWFLAKE_ICONS;
}

// ---------------------------------------------------------------------------
// Keyword map – ordered by specificity (most specific first within groups)
// Compound names (e.g. "transform_task") MUST appear before their individual
// parts so they are scored with a single, unambiguous prefix match.
// ---------------------------------------------------------------------------

const KEYWORD_MAP: KeywordMapping[] = [
  // ── Compound agent names (from SUGGEST_COMPONENTS_FOR_USE_CASE) ────
  // These MUST come first so "transform_task" scores as task (160pts)
  // rather than being split into "transform" (80pts workload_data_eng)
  // vs "task" (60pts task).
  { keywords: ['transform_task'],                                                         iconKey: 'task' },
  { keywords: ['cdc_stream', 'change_stream'],                                            iconKey: 'stream' },
  { keywords: ['analytics_views', 'analytics_view'],                                      iconKey: 'analytics' },
  // AGENTIC: All medallion layers use same icon - differentiated by label, not icon
  { keywords: ['bronze_layer'],                                                           iconKey: 'database' },
  { keywords: ['silver_layer'],                                                           iconKey: 'database' },
  { keywords: ['gold_layer'],                                                             iconKey: 'database' },

  // ── External Data Sources ─────────────────────────────────────────────
  { keywords: ['kafka', 'confluent', 'kinesis', 'event_hub', 'eventgrid', 'msk'],       iconKey: 'kafka' },
  { keywords: ['s3', 'aws', 'amazon', 'bucket'],                                         iconKey: 's3' },
  { keywords: ['azure', 'adls', 'blob'],                                                 iconKey: 's3' },
  { keywords: ['gcp', 'gcs', 'bigquery', 'pubsub'],                                      iconKey: 's3' },
  { keywords: ['postgres', 'mysql', 'oracle', 'sqlserver', 'rds', 'mariadb', 'sql_server'], iconKey: 'database' },
  { keywords: ['mongodb', 'dynamodb', 'cosmos', 'cassandra', 'redis', 'nosql'],          iconKey: 'database' },
  { keywords: ['hadoop', 'hdfs', 'hive', 'hbase'],                                       iconKey: 'hadoop' },
  { keywords: ['iot', 'sensor', 'device', 'telemetry'],                                  iconKey: 'iot' },
  { keywords: ['api', 'rest', 'graphql', 'webhook', 'endpoint'],                         iconKey: 'api' },

  // ── BI & Analytics Tools ──────────────────────────────────────────────
  { keywords: ['tableau', 'powerbi', 'power_bi', 'looker', 'metabase', 'mode'],          iconKey: 'analytics' },
  { keywords: ['sigma', 'thoughtspot', 'qlik', 'domo', 'sisense'],                       iconKey: 'analytics' },
  { keywords: ['excel', 'sheets', 'csv', 'spreadsheet'],                                 iconKey: 'spreadsheet' },
  { keywords: ['streamlit', 'dash', 'gradio'],                                           iconKey: 'streamlit' },

  // ── ETL / ELT & Orchestration ─────────────────────────────────────────
  { keywords: ['dbt', 'fivetran', 'airbyte', 'matillion', 'stitch', 'etl', 'elt'],       iconKey: 'data_engineering' },
  { keywords: ['airflow', 'dagster', 'prefect', 'mage', 'orchestrat'],                   iconKey: 'task' },
  { keywords: ['spark', 'databricks', 'emr'],                                            iconKey: 'spark_connect' },

  // ── ML & AI ───────────────────────────────────────────────────────────
  { keywords: ['cortex_search', 'search_service'],                                       iconKey: 'cortex_search' },
  { keywords: ['cortex_analyst', 'analyst'],                                              iconKey: 'cortex_analyst' },
  { keywords: ['cortex', 'llm', 'gpt', 'claude', 'gemini', 'mistral'],                   iconKey: 'cortex' },
  { keywords: ['ml', 'model', 'predict', 'inference', 'embedding', 'classification'],    iconKey: 'ai_star' },
  { keywords: ['ml_model', 'registry', 'feature_store'],                                 iconKey: 'ml_model' },
  { keywords: ['notebook', 'jupyter', 'colab'],                                          iconKey: 'notebook' },
  { keywords: ['document_ai', 'docai'],                                                  iconKey: 'document_ai' },

  // ── Snowflake Objects ─────────────────────────────────────────────────
  { keywords: ['dynamic_table', 'dt'],                                                   iconKey: 'dynamic_table' },
  { keywords: ['iceberg', 'iceberg_table'],                                              iconKey: 'iceberg_table' },
  { keywords: ['hybrid_table'],                                                          iconKey: 'hybrid_table' },
  { keywords: ['external_table'],                                                        iconKey: 'external_table' },
  { keywords: ['materialized_view', 'mat_view', 'mview'],                                iconKey: 'materialized_view' },
  { keywords: ['secure_view'],                                                           iconKey: 'secure_view' },
  { keywords: ['stream', 'cdc', 'change_capture'],                                       iconKey: 'stream' },
  { keywords: ['task', 'job', 'schedule', 'cron'],                                       iconKey: 'task' },
  { keywords: ['pipe', 'snowpipe', 'ingest', 'load'],                                    iconKey: 'snowpipe' },
  { keywords: ['warehouse', 'wh', 'compute'],                                            iconKey: 'warehouse' },
  { keywords: ['stage', 'landing_zone'],                                                 iconKey: 'external_stage' },
  { keywords: ['stored_proc', 'procedure', 'sproc'],                                     iconKey: 'stored_proc' },
  { keywords: ['function', 'udf', 'udtf'],                                               iconKey: 'function' },
  { keywords: ['view'],                                                                  iconKey: 'view' },
  { keywords: ['table'],                                                                 iconKey: 'table' },
  { keywords: ['database', 'db'],                                                        iconKey: 'database' },
  { keywords: ['schema'],                                                                iconKey: 'schema' },
  { keywords: ['volume'],                                                                iconKey: 'volume' },

  // ── Apps & Services ───────────────────────────────────────────────────
  { keywords: ['snowpark_container', 'spcs', 'container'],                                iconKey: 'snowpark_container' },
  { keywords: ['snowpark'],                                                              iconKey: 'snowpark' },
  { keywords: ['native_app'],                                                            iconKey: 'native_app' },
  { keywords: ['web_app', 'webapp'],                                                     iconKey: 'web_app' },
  { keywords: ['application', 'app'],                                                    iconKey: 'application' },
  { keywords: ['marketplace'],                                                           iconKey: 'marketplace' },

  // ── Sharing & Collaboration ───────────────────────────────────────────
  { keywords: ['share', 'sharing', 'listing'],                                           iconKey: 'share' },
  { keywords: ['exchange', 'private_exchange'],                                          iconKey: 'private_exchange' },

  // ── Security & Governance ─────────────────────────────────────────────
  { keywords: ['policy', 'masking', 'row_access'],                                       iconKey: 'policy' },
  { keywords: ['role', 'rbac'],                                                          iconKey: 'role' },
  { keywords: ['security', 'governance'],                                                iconKey: 'security' },
  { keywords: ['tag', 'classification'],                                                 iconKey: 'tag' },
  { keywords: ['alert', 'notification'],                                                 iconKey: 'notification' },

  // ── Medallion Architecture (generic terms) ─────────────────────────────
  // AGENTIC: All medallion layers use same icon - differentiated by label, not icon
  { keywords: ['bronze', 'raw', 'landing'],                                              iconKey: 'database' },
  { keywords: ['silver', 'clean', 'conform'],                                            iconKey: 'database' },
  { keywords: ['gold', 'curated', 'mart', 'business', 'presentation'],                   iconKey: 'database' },

  // ── File Formats ──────────────────────────────────────────────────────
  { keywords: ['parquet'],                                                               iconKey: 'file_parquet' },
  { keywords: ['avro'],                                                                  iconKey: 'file_avro' },
  { keywords: ['json'],                                                                  iconKey: 'file_json' },
  { keywords: ['xml'],                                                                   iconKey: 'file_xml' },
];

// ---------------------------------------------------------------------------
// Semantic fallback by flowStageOrder
// ---------------------------------------------------------------------------

const STAGE_DEFAULTS: Record<number, keyof typeof SNOWFLAKE_ICONS> = {
  0: 's3',                    // source
  1: 'snowpipe',              // ingest
  2: 'workload_data_lake',    // raw
  3: 'task',                  // transform
  4: 'workload_data_warehouse', // refined
  5: 'view',                  // serve
  6: 'analytics',             // consume
};

const GENERIC_FALLBACK = SNOWFLAKE_ICONS.data;

// ---------------------------------------------------------------------------
// Normalisation helper
// ---------------------------------------------------------------------------

function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[-\s/\\]+/g, '_')  // dashes, spaces, slashes → underscore
    .replace(/[^a-z0-9_]/g, '') // strip non-alphanumeric
    .replace(/^(sf|ext|src|tgt)_/, ''); // strip SUGGEST_COMPONENTS prefixes
}

// ---------------------------------------------------------------------------
// Scoring engine
// ---------------------------------------------------------------------------

interface ScoredMatch {
  icon: string;
  score: number;
}

function scoreInput(normalised: string): ScoredMatch | null {
  let best: ScoredMatch | null = null;

  for (const mapping of KEYWORD_MAP) {
    let score = 0;

    for (const kw of mapping.keywords) {
      if (normalised.startsWith(kw)) {
        // Prefix match — strong signal
        score += 80;
      } else if (normalised.includes(kw)) {
        // Contains — weaker but still valid
        score += 60;
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { icon: SNOWFLAKE_ICONS[mapping.iconKey], score };
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the best-matching Snowflake icon SVG path for a given component.
 *
 * @param componentType - The component type key (e.g. "kafka", "dynamic_table")
 * @param label         - Optional human-readable label to match against
 * @param flowStageOrder - Optional 0-6 stage index for semantic fallback
 * @returns SVG icon path string
 */
export function resolveIcon(
  componentType?: string,
  label?: string,
  flowStageOrder?: number,
): string {
  // Build a combined input from whatever is available
  const raw = componentType || label || '';
  if (!raw) {
    // Nothing to match – use stage fallback or generic
    if (flowStageOrder != null) {
      const stageKey = STAGE_DEFAULTS[Math.floor(flowStageOrder)];
      if (stageKey) {
        return SNOWFLAKE_ICONS[stageKey];
      }
    }
    return GENERIC_FALLBACK;
  }

  const normalised = normalise(raw);

  // ── Tier 1: Exact match against SNOWFLAKE_ICONS keys ──────────────
  // normalise() strips sf_/ext_ prefixes, so "sf_warehouse" → "warehouse"
  if (normalised in SNOWFLAKE_ICONS) {
    return SNOWFLAKE_ICONS[normalised as keyof typeof SNOWFLAKE_ICONS];
  }

  // Also try Tier 1 on the label (e.g. label "Snowpipe" → "snowpipe" → exact match)
  if (label && label !== componentType) {
    const normLabel = normalise(label);
    if (normLabel in SNOWFLAKE_ICONS) {
      return SNOWFLAKE_ICONS[normLabel as keyof typeof SNOWFLAKE_ICONS];
    }
  }

  // ── Tier 2: Keyword scoring ───────────────────────────────────────
  const scored = scoreInput(normalised);

  // Also score the label separately if it differs from componentType
  let labelScored: ScoredMatch | null = null;
  if (label && label !== componentType) {
    labelScored = scoreInput(normalise(label));
  }

  const bestKeyword = [scored, labelScored]
    .filter((s): s is ScoredMatch => s !== null)
    .sort((a, b) => b.score - a.score)[0];

  if (bestKeyword) {
    return bestKeyword.icon;
  }

  // ── Tier 3: Semantic fallback by flowStageOrder ────────────────────
  // Use Math.floor so fractional stages (e.g. 2.5 for CDC) inherit the nearest lower stage icon
  if (flowStageOrder != null) {
    const stageKey = STAGE_DEFAULTS[Math.floor(flowStageOrder)];
    if (stageKey) {
      return SNOWFLAKE_ICONS[stageKey];
    }
  }

  // ── Tier 4: Generic fallback ──────────────────────────────────────
  return GENERIC_FALLBACK;
}
