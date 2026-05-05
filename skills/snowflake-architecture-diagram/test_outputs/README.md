# Persona test outputs

End-to-end smoke test of the snowflake-architecture-diagram skill, simulating three synthetic customer prompts:

| Persona | Industry | Prompt summary | Routes to |
|---------|----------|----------------|-----------|
| `sarah` | Acme Retail | Medallion lakehouse from S3 + Kafka, CDC into Silver, Gold for analytics | **compose** (multi-source detected by intent_router) |
| `raj` | MedTech Devices | 50K medical devices via MQTT, real-time → Tableau | compose (IoT pipeline) |
| `maya` | Finovate Bank | Real-time fraud detection: Kafka transactions, fraud-scoring, RLS | compose (fraud pipeline with security) |

## Regenerate

```bash
# All three personas
python3 test_outputs/run_personas.py

# Without taking PNG screenshots (skip Chrome)
python3 test_outputs/run_personas.py --no-screenshot

# Just one persona
python3 test_outputs/run_personas.py --personas sarah
```

The runner exercises the full standalone-mode pipeline:

```
intent_router.py  →  flow_builder.py  →  state.json
                                          │
                                          ▼
                                   render_static.py  →  *_v3.html
                                                            │
                                                            ▼
                                                   (Chrome headless)
                                                            │
                                                            ▼
                                                       *_v3.png
```

## Per-persona artifacts

For each persona under `personas/`:

| File | Purpose | Committed? |
|------|---------|------------|
| `<name>_decision.json` | Intent-router output (template vs compose, confidence, rationale) | ✅ yes — small, useful as fixture |
| `<name>_state.json` | Rich-viewer state (nodes + edges + icon refs + citations) | ✅ yes — small, useful as fixture |
| `<name>_v3.html` | Self-contained HTML with embedded SVGs + libs (~3.3 MB each) | ❌ gitignored — regenerable |
| `<name>_v3.png` | 1900×800 Chrome screenshot for previewing | ✅ yes — small, useful as visual fixture |
| `<name>.mmd` | Mermaid source (legacy/export) | ✅ yes |

## Viewing

Open any `_v3.html` directly in a browser — fully offline-viewable, no HTTP server needed:

```bash
open personas/sarah_v3.html
open personas/raj_v3.html
open personas/maya_v3.html
```

The `*_v3.png` files are good lightweight previews for code review or PR descriptions.

## What's verified by these outputs

- **Sarah's compose** confirms `intent_router.py` correctly detects multi-source prompts (S3 + Kafka) and routes to compose mode rather than picking a single canned template
- **Real Snowflake icons** render in cards (Snowflake_ICON_RA_Pipe.svg, _RA_Stream.svg, _RA_Table.svg, _Kafka_Connectors.svg, etc.)
- **petrohunt design language**: Lato font, gradient header band, color-coded category dots (orange/mid-blue/sf-blue/star-blue), animated dashed-arrow connectors
- **Citations panel** populated from each persona's documentation references
- **Self-contained export** (HTML works without HTTP server or internet)
