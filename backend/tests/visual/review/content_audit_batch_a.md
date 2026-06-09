# Content Audit — Batch A: Architectural Accuracy Review

**Auditor:** Cortex Code (Batch A agent)
**Date:** 2026-05-14
**Scope:** 5 templates audited against reference architecture PDFs (reference_page1–9.png)

---

## STREAMING_DATA_STACK

**Reference image used:** reference_page2.png and reference_page3.png (rationale: page2 shows the full streaming data stack with Producer App, 4 ingestion lanes 1a/1b/1c/1d, numbered Snowflake sections 2–6, and Consumer App — this is the canonical streaming architecture. Page3 provides supplemental detail on the same architecture.)

**Architectural accuracy: MINOR ISSUES**

### Findings

1. **Missing "Snowpipe Streaming" in path 1b terminus:** In the reference diagram, path 1b (CSP Stream Processing via Kinesis/Event Hubs/Pub/Sub → Compute) terminates at "Snowpipe Streaming" via the SDK. The Mermaid correctly routes `compute -->|"Streaming"| snowpipe_streaming`, which is accurate. No issue here.

2. **Amazon Data Firehose placement is slightly off:** In the reference, Amazon Data Firehose is shown as a parallel option alongside Kafka in path 1a, not as a sequential step before Kafka. The Mermaid has `prod_app --> firehose --> kafka --> kafka_connector`, implying Firehose feeds into Kafka, which is architecturally incorrect. Firehose is an alternative streaming delivery mechanism that can write directly to Snowflake (via Snowpipe Streaming) or to S3 — it does not feed into Kafka.

3. **Missing "Data Lake" / S3 landing in path 1a:** The reference shows that the Kafka path can also land data in S3/Data Lake before being picked up by Snowpipe. The Mermaid only shows the direct Kafka Connector → Snowpipe Streaming path, missing this alternative landing.

4. **Section 5 (Consumption) is missing key components:** The reference diagram shows section 5 includes "Cortex ML/LLM", "Streamlit", and "Notebooks" alongside Python SPs, Snowpark, and SPCS. The Mermaid only has `python_sp`, `snowpark`, and `spcs` — missing Cortex AI functions, Streamlit in Snowflake, and Notebooks.

5. **Section 6 (Analytics) is too thin:** The reference shows "In-app Analytics" with specific callouts for dashboards, BI tools, and data applications. The Mermaid has a single `analytics["In-app Analytics"]` node with no sub-components.

6. **Excessive spacer/label scaffolding:** The template contains ~20 invisible spacer subgraphs and label areas used for layout positioning. While not architecturally wrong, this adds significant noise and fragility. These are layout hacks rather than architectural content.

7. **Native connector path (1d) is accurate:** Industry Sources → Marketplace → Native App Connector correctly represents the reference.

### Proposed Mermaid edits

- **Fix Firehose placement:** Replace `prod_app -->|"Streaming"| firehose` and `firehose -->|"Streaming"| kafka` with `prod_app -->|"Streaming"| kafka` and `prod_app -->|"Streaming"| firehose`, then add `firehose -->|"Streaming"| snowpipe_streaming` (rationale: Firehose is a parallel ingestion path to Kafka, not a sequential predecessor)
- **Add missing Section 5 components:** After `spcs["Snowpark Container Services"]`, add:
  ```
  cortex_ai["Cortex AI<br/>ML & LLM Functions"]
  streamlit_sis["Streamlit in Snowflake"]
  notebooks["Snowflake Notebooks"]
  ```
  And add connections: `scalability -->|"Process"| cortex_ai`, `scalability -->|"Process"| streamlit_sis`, `scalability -->|"Process"| notebooks` (rationale: reference diagram includes these as consumption-layer components)
- **Add Cortex/Streamlit/Notebooks to analytics connections:** Add `cortex_ai -->|"Analyze"| analytics`, `streamlit_sis -->|"Analyze"| analytics`, `notebooks -->|"Analyze"| analytics` (rationale: all consumption components feed analytics in the reference)

### Confidence
**MEDIUM** — The Firehose sequencing issue is clear from the reference. The missing Section 5 components are visible in reference_page2.png but some detail is hard to read at the image resolution.

---

## MEDALLION_LAKEHOUSE

**Reference image used:** reference_page4.png (rationale: page4 shows a classic Bronze/Silver/Gold medallion lakehouse architecture with layered data refinement, which directly maps to this template)

**Architectural accuracy: MINOR ISSUES**

### Findings

1. **Missing multiple source types:** The reference shows multiple data sources feeding the Bronze layer — not just S3. It includes streaming sources, application databases, and file-based sources. The Mermaid only has a single `s3["AWS S3<br/>Data Lake"]` source node.

2. **Bronze layer missing Snowpipe Streaming:** The reference shows both Snowpipe (batch) and Snowpipe Streaming as ingestion mechanisms into Bronze. The Mermaid only has `pipe["Snowpipe<br/>Auto-Ingest<br/>Separate from Streaming"]` — the label acknowledges streaming exists but doesn't model it.

3. **Silver layer transformation is accurate:** Stream → Serverless Task → Cleaned Tables with SCD Type 2 is architecturally sound and matches the reference's CDC-driven cleansing pattern.

4. **Gold layer Dynamic Tables usage is correct:** The use of Dynamic Tables with `TARGET_LAG=DOWNSTREAM` is a best-practice detail that aligns with the reference's emphasis on declarative transformations.

5. **Missing Data Sharing / Secure Views in Gold layer:** The reference diagram shows the Gold layer also feeds Secure Data Sharing and Marketplace listings. The Mermaid has no sharing components.

6. **Missing Governance layer:** The reference shows a cross-cutting governance layer with masking policies, row-level security, and tagging. The Mermaid has no governance/security subgraph.

7. **Warehouse strategy is reasonable but disconnected:** `wh_load -.-> pipe` is correct, but `wh_transform -.-> dyn_table` is misleading — Dynamic Tables manage their own refresh warehouse. The dotted connection implies a separate warehouse controls DT refresh, which is partially correct (DTs use a dedicated warehouse) but could be clearer.

### Proposed Mermaid edits

- **Add streaming source:** After `s3["AWS S3<br/>Data Lake"]`, add `streaming_src["Streaming Sources<br/>Kafka, Kinesis"]` inside the `source` subgraph (rationale: reference shows multiple source types)
- **Add Snowpipe Streaming to Bronze:** After `pipe["Snowpipe<br/>Auto-Ingest<br/>Separate from Streaming"]`, add `pipe_streaming["Snowpipe Streaming<br/>Low-Latency"]` inside the `bronze` subgraph. Add connection `streaming_src --> pipe_streaming` and `pipe_streaming --> bronze_raw` (rationale: reference shows dual ingestion paths)
- **Add Data Sharing subgraph:** After the `bi` subgraph, add:
  ```
  subgraph sharing["Data Sharing"]
      secure_share["Secure Shares<br/>Zero-Copy"]
      marketplace_listing["Marketplace<br/>Listings"]
  end
  ```
  Add connections: `gold_agg --> secure_share` and `gold_agg --> marketplace_listing` (rationale: reference includes sharing as a Gold-layer consumer)
- **Clarify DT warehouse label:** Replace `wh_transform["WH_TRANSFORM<br/>DT Refresh"]` with `wh_transform["WH_DT_REFRESH<br/>Dynamic Table<br/>Dedicated Warehouse"]` (rationale: emphasize that DTs need a dedicated warehouse, per best practices)

### Confidence
**HIGH** — The medallion pattern is well-documented and the reference image clearly shows the missing components.

---

## BATCH_DATA_WAREHOUSE

**Reference image used:** reference_page5.png (rationale: page5 shows a traditional batch ELT data warehouse with dimensional modeling, staging, transformation, and BI consumption — the classic Snowflake DW pattern)

**Architectural accuracy: GOOD**

### Findings

1. **Source layer is too narrow:** The reference shows multiple source systems (ERP, CRM, flat files, APIs) feeding the warehouse. The Mermaid only has `s3["AWS S3<br/>Data Lake"]`. A batch DW typically ingests from diverse operational systems, not just a data lake.

2. **Ingestion pipeline is architecturally sound:** External Stage → Snowpipe → Staging Table with VARIANT for JSON is a correct pattern for batch loading.

3. **Transformation layer is accurate:** Stream-based CDC → Serverless Task → Clean Table correctly models incremental batch processing.

4. **Dimensional model is well-structured:** DIM_CUSTOMER with SCD Type 2, DIM_PRODUCT, and FACT_SALES clustered by date are textbook dimensional modeling. The Task-based orchestration for dimensions and facts is correct.

5. **Security layer is comprehensive:** Dynamic Masking, Row Access Policy, and functional roles (ANALYST, MANAGER) represent a solid security posture. This is actually more detailed than many reference architectures show.

6. **Warehouse strategy is correct:** Separate warehouses for loading, transformation, and BI analytics with multi-cluster standard scaling is best practice.

7. **BI layer is too narrow:** Only Power BI is shown. The reference typically shows multiple BI tools (Tableau, Looker, etc.) or a generic "BI Tools" node.

8. **Missing monitoring/observability:** The reference includes resource monitors and query profiling as part of the warehouse strategy. Not present in Mermaid.

### Proposed Mermaid edits

- **Broaden source layer:** Replace `s3["AWS S3<br/>Data Lake"]` with `s3["AWS S3<br/>Data Lake"]` plus add `erp["ERP / CRM<br/>Source Systems"]` inside the `source` subgraph, and add connection `erp --> stage` (rationale: batch DWs ingest from multiple source systems)
- **Broaden BI layer:** Replace `powerbi["Power BI"]` with `bi_tools["BI Tools<br/>Power BI, Tableau"]` (rationale: avoid vendor lock-in appearance; reference shows generic BI tools)
- **Add monitoring node to compute:** After `wh_bi`, add `resource_mon["Resource Monitors<br/>Cost Control"]` inside the `compute` subgraph. Add `resource_mon -.-> wh_load & wh_transform & wh_bi` (rationale: resource monitors are a standard DW governance component in the reference)

### Confidence
**HIGH** — This is the most architecturally sound template of the batch. The issues are minor completeness gaps rather than structural errors.

---

## CUSTOMER_360

**Reference image used:** reference_page6.png (rationale: page6 shows a customer data platform architecture with multiple sources, identity resolution, unified profiles, data sharing, and ML — matching the Customer 360 use case)

**Architectural accuracy: MINOR ISSUES**

### Findings

1. **Missing Identity Resolution / Entity Resolution component:** The core value proposition of a Customer 360 is identity resolution — matching records across sources to create a unified customer ID. The Mermaid jumps from `raw_data` to `enriched_data["Customer 360 View<br/>Unified Profile"]` with no identity resolution step. The reference shows an explicit ID resolution / entity matching component.

2. **Data Sharing subgraph is well-modeled:** Secure Shares → Reader Accounts with zero-copy semantics correctly represents Snowflake's sharing model. Native Apps with no data movement is accurate.

3. **External Access is a good inclusion:** External Network Rules with egress control and Cloud Healthcare API show awareness of Snowflake's external access integration feature. However, the Healthcare API is oddly specific for a generic Customer 360 template — this should be more generic (e.g., "External APIs<br/>Enrichment Services").

4. **Missing Snowflake Marketplace as a data source:** The reference shows Marketplace as a source for third-party enrichment data (demographics, firmographics). The Mermaid has `third_party["Third-Party Data<br/>Native Apps"]` feeding into `native_app`, but doesn't explicitly show the Marketplace.

5. **ML subgraph is reasonable but missing Cortex:** The reference shows Cortex ML functions (Sentiment, Classification) as part of the ML layer. The Mermaid only has generic `ml_training["ML Models<br/>Propensity Scoring"]` with no Cortex-specific components.

6. **Missing Streamlit for customer dashboards:** The reference shows Streamlit in Snowflake as the visualization/app layer for the Customer 360 view. The Mermaid has no visualization component.

7. **Ingestion layer ordering is slightly off:** `snowpark --> dbt` implies Snowpark orchestrates dbt, which is an unusual pattern. More commonly, dbt runs independently or is orchestrated by an external tool (Airflow, etc.). The reference shows them as parallel transformation tools, not sequential.

### Proposed Mermaid edits

- **Add Identity Resolution:** After `raw_data["Raw Data<br/>Native JSON"]`, add `id_resolution["Identity Resolution<br/>Entity Matching<br/>Snowpark ML"]` inside the `storage` subgraph. Replace `raw_data --> enriched_data` with `raw_data --> id_resolution --> enriched_data` (rationale: identity resolution is the defining capability of a Customer 360 and is shown in the reference)
- **Generalize Healthcare API:** Replace `healthcare["Cloud Healthcare API"]` with `external_apis["External APIs<br/>Enrichment Services"]` (rationale: template should be industry-agnostic)
- **Add Cortex to ML subgraph:** After `batch_results["Batch Predictions"]`, add `cortex_ml["Cortex ML<br/>Sentiment, Classification"]` inside the `ml` subgraph. Add `enriched_data --> cortex_ml` (rationale: reference shows Cortex functions as part of the ML layer)
- **Add Streamlit visualization:** After the `external` subgraph, add:
  ```
  subgraph viz["Visualization"]
      streamlit["Streamlit in Snowflake<br/>Customer Dashboards"]
  end
  ```
  Add connections: `enriched_data --> streamlit` and `batch_results --> streamlit` (rationale: reference shows Streamlit as the app layer)
- **Fix Snowpark/dbt ordering:** Replace `snowpark --> dbt` with `snowpark --> raw_data` and `dbt --> raw_data` as parallel paths (already partially exists). Remove the direct `snowpark --> dbt` edge (rationale: these are parallel tools, not sequential)

### Confidence
**MEDIUM** — The identity resolution gap is architecturally significant. The reference image is somewhat dense and some component labels are hard to read at the resolution provided, so some findings may be imprecise.

---

## ML_FEATURE_ENGINEERING

**Reference image used:** reference_page7.png (rationale: page7 shows an ML/AI architecture with data sources, feature engineering pipelines, model training, model registry, and inference serving — directly mapping to this template)

**Architectural accuracy: MINOR ISSUES**

### Findings

1. **Source-to-ingestion flow has an odd hop:** `app --> streaming & data_lake` implies the Application generates both streaming and data lake data, which is plausible. But `data_lake --> snowpipe & external_table & iceberg` correctly shows three ingestion methods for lake data. This is architecturally sound.

2. **Feature Engineering pipeline is well-structured:** Serverless Tasks → Snowpark Python DataFrame API → Snowpark ML (scikit-learn, XGBoost) is a correct representation of the Snowflake ML feature engineering flow.

3. **Missing Feature Store:** The reference shows a Feature Store as a key component for ML feature engineering — storing, versioning, and serving features. The Mermaid has no Feature Store component. Snowflake's Feature Store (via Snowpark ML) is a critical part of the ML architecture.

4. **Model Training layer conflates training and inference:** `spcs["Snowpark Container Services<br/>GPU Inference"]` is labeled as inference but placed in the "Model Training" subgraph. SPCS can do both training (GPU training) and inference (GPU serving), but the subgraph name implies only training. The reference separates these concerns.

5. **Cortex AI subgraph has incorrect flow:** `snowpark_ml --> cortex_ml` and `cortex_ml --> cortex_llm` implies a linear pipeline from Snowpark ML to Cortex ML to Cortex LLM. In reality, Cortex ML functions (Classification, Forecasting) and Cortex LLM functions (COMPLETE, SUMMARIZE) are independent capabilities, not sequential. They should both connect from the data/feature layer independently.

6. **Missing Data Sharing for ML models:** The reference shows model sharing via Snowflake Marketplace / Native Apps as a distribution mechanism. Not present in the Mermaid.

7. **Missing Snowflake Notebooks:** The reference includes Notebooks as a key ML development interface alongside Streamlit. The Mermaid only has Streamlit.

8. **Iceberg Tables placement is correct:** Showing Iceberg Tables as an ingestion format alongside External Tables is architecturally sound and reflects Snowflake's open table format support.

### Proposed Mermaid edits

- **Add Feature Store:** After `snowpark_ml["Snowpark ML<br/>scikit-learn<br/>XGBoost"]`, add `feature_store["Feature Store<br/>Feature Views<br/>Training Datasets"]` inside the `processing` subgraph. Add `snowpark_ml --> feature_store` and `feature_store --> snowpark_wh` (rationale: Feature Store is a critical ML component shown in the reference)
- **Fix SPCS label:** Replace `spcs["Snowpark Container Services<br/>GPU Inference"]` with `spcs["Snowpark Container Services<br/>GPU Training & Serving"]` (rationale: SPCS handles both training and inference)
- **Fix Cortex flow:** Replace `snowpark_ml --> cortex_ml` and `cortex_ml --> cortex_llm` with:
  - Remove `snowpark_ml --> cortex_ml`
  - Remove `cortex_ml --> cortex_llm`
  - Add `tasks --> cortex_ml` (Cortex ML operates on ingested data)
  - Add `tasks --> cortex_llm` (Cortex LLM operates on ingested data)
  - Add `cortex_ml --> streamlit` (results go to visualization)
  (rationale: Cortex ML and LLM are independent functions, not a sequential pipeline fed from Snowpark ML)
- **Add Feature Store to registry connection:** Add `feature_store --> model_registry` (rationale: features feed model training which produces registered models)
- **Add Notebooks to viz:** After `streamlit["Streamlit in Snowflake<br/>ML Dashboards"]`, add `notebooks["Snowflake Notebooks<br/>ML Development"]` inside the `viz` subgraph. Add `model_udf --> notebooks` and `cortex_llm --> notebooks` (rationale: reference shows Notebooks as a key ML interface)

### Confidence
**HIGH** — The Feature Store omission and Cortex flow error are clear architectural issues. The reference image clearly shows these components and their relationships.

---

## Summary Matrix

| Template | Accuracy Rating | Critical Issues | Proposed Edits | Confidence |
|---|---|---|---|---|
| STREAMING_DATA_STACK | MINOR ISSUES | Firehose sequencing; missing Section 5 components | 3 edit groups | MEDIUM |
| MEDALLION_LAKEHOUSE | MINOR ISSUES | Missing streaming ingestion; no sharing layer | 4 edit groups | HIGH |
| BATCH_DATA_WAREHOUSE | GOOD | Narrow source/BI layers | 3 edit groups | HIGH |
| CUSTOMER_360 | MINOR ISSUES | Missing identity resolution; Cortex absent | 5 edit groups | MEDIUM |
| ML_FEATURE_ENGINEERING | MINOR ISSUES | Missing Feature Store; incorrect Cortex flow | 5 edit groups | HIGH |

### Cross-Template Observations

1. **Cortex AI is systematically under-represented:** Only ML_FEATURE_ENGINEERING includes Cortex, and even there the flow is incorrect. Cortex ML/LLM functions should appear in CUSTOMER_360, and potentially in STREAMING_DATA_STACK (Section 5).

2. **Streamlit in Snowflake is under-represented:** Only ML_FEATURE_ENGINEERING includes Streamlit. Both CUSTOMER_360 and STREAMING_DATA_STACK should include it as a consumption/visualization layer.

3. **Data Sharing is under-represented:** Only CUSTOMER_360 has sharing components. MEDALLION_LAKEHOUSE Gold layer should also have sharing.

4. **Feature Store is missing globally:** No template includes Snowflake's Feature Store, which is a significant ML capability gap.

5. **STREAMING_DATA_STACK has excessive layout scaffolding:** ~20 invisible spacer subgraphs add complexity without architectural value. Consider simplifying if rendering allows.
