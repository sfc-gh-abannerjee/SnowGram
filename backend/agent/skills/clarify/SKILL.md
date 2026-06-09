---
name: clarify_ambiguous_request
description: |
  Asks the user 2-4 targeted clarifying questions BEFORE generating a diagram
  when the request is ambiguous about: data scale, real-time vs batch,
  governance / compliance constraints, source systems, downstream consumers,
  or which Snowflake-native services should anchor the architecture.
  Skip this skill entirely when (a) the user explicitly asks for a named
  reference architecture template, (b) the user is iterating on an existing
  diagram in the conversation thread, or (c) the request already specifies
  source(s), destination(s), and ingestion mode (batch / streaming / CDC).
---

# Clarify ambiguous diagram request

## When to invoke

Invoke this skill BEFORE calling any of the COMPOSE_*, SEARCH_COMPONENT_BLOCKS
or VALIDATE_MERMAID_SYNTAX tools whenever the user's first message in a thread
is a high-level diagram request that lacks enough detail to confidently choose
between meaningfully different reference architectures.

**Trigger patterns** (any one is enough — be liberal, but not blocking):
- The request names only a buzzword: "data platform", "lakehouse", "real-time
  thing", "ML pipeline" without sources / sinks / scale.
- The request implies multiple plausible architectures (e.g. "ingest customer
  data" — could be Streaming, Batch DWH, Customer 360, or CDP).
- The request mentions a use case but no specific Snowflake services
  (e.g. "fraud detection" — could be REALTIME_FINANCIAL_TRANSACTIONS or
  ML_FEATURE_ENGINEERING depending on volume + freshness needs).
- The user appears new to Snowflake (first message in thread, casual phrasing).

**Skip patterns** (do NOT invoke):
- The user names a template: "Streaming Data Stack", "Medallion Lakehouse",
  "Customer 360", any of the 14 reference architectures.
- The user is refining an existing diagram (the conversation thread has
  prior assistant messages with diagrams).
- The user provides 2+ of {source, destination, mode, scale, latency} —
  enough specificity to pick a template confidently.
- The user explicitly says "just generate it" / "I don't care, pick one" /
  "use defaults".

## Output format

When invoked, your response MUST replace the normal Sections 1-5 structure
with this single-purpose response:

1. A short opener acknowledging the request (1 sentence).
2. A markdown bulleted list of 2-4 targeted questions. Each bullet is a
   bold question followed by 2-4 example answers in italics. Examples make
   the question scannable and lower the cognitive load.
3. A closing line: "Once I have these, I'll generate the diagram."

DO NOT emit a ```mermaid``` block, JSON Specification, Component Summary
table, or Stats line. The skill output is conversational only — the actual
diagram comes on the FOLLOW-UP turn after the user answers.

## Question template (pick the most relevant 2-4)

Choose questions that meaningfully change which architecture pattern wins:

- **What's the primary data source?** *e.g. application logs, Salesforce CDC,
  Kafka stream, S3 batch files, IoT sensors*
- **What latency do consumers need?** *e.g. sub-second dashboards, hourly
  refresh, daily reports*
- **What's the data volume?** *e.g. < 100 GB total, hundreds of GB/day,
  TB/day*
- **Who consumes the output?** *e.g. BI dashboards, ML models, embedded
  customer-facing app, internal API*
- **Any governance constraints?** *e.g. PII / HIPAA / GDPR masking, row-level
  security, multi-region, no external sources*
- **Streaming or batch?** *e.g. streaming via Snowpipe Streaming + Dynamic
  Tables, batch via Snowpipe + scheduled Tasks, CDC via Streams + Tasks*

Limit to 4 to avoid overwhelming the user. Order from most-architecturally-
defining first.

## Example invocation

User: "build me a data platform"

Your response:
> Happy to help — a few quick questions to make sure I generate the right
> architecture for your needs:
>
> - **What's the primary data source?** *e.g. application logs, Salesforce
>   CDC, Kafka stream, S3 batch files, IoT sensors*
> - **Streaming or batch ingestion?** *e.g. streaming via Snowpipe Streaming
>   + Dynamic Tables, batch via Snowpipe + scheduled Tasks*
> - **Who consumes the output?** *e.g. BI dashboards, ML models, embedded
>   apps, internal APIs*
> - **Any governance constraints?** *e.g. PII masking, row-level security,
>   multi-region, on-account-only*
>
> Once I have these, I'll generate the diagram.

## Why these questions matter

| Question | Influences |
|---|---|
| Source | Which ingestion components: Snowpipe vs Snowpipe Streaming vs Kafka Connector vs Connectors framework |
| Latency | Dynamic Tables vs scheduled Tasks vs Streams+Tasks |
| Volume | Warehouse sizing, multi-cluster, Hybrid Tables vs Standard Tables |
| Consumer | Cortex Search/Analyst, ML Model Registry, Embedded Analytics with Hybrid Tables |
| Governance | Masking policies, RLS, Trust Center, External Volumes for residency |
| Mode | Streaming Data Stack vs Batch DWH vs CDC patterns |
