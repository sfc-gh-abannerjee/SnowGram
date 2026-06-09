# Architecture: ELK Diagram Generator

Technical reference for `generate_arch_diagram_elk.py`. Start with [README.md](README.md) for setup.

---

## Pipeline Overview

The generator runs a 3-stage pipeline:

1. **Graph construction** (`build_elk_graph()`) — Python dicts → ELK JSON
2. **Layout** (Node.js + elkjs) — ELK computes x/y coordinates and edge routes
3. **Rendering** (matplotlib) — Positioned graph → styled PNG

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Python: build   │────▶│  Node.js: ELK   │────▶│  Python: render  │
│  ELK graph JSON  │     │  orthogonal     │     │  matplotlib PNG  │
│                  │     │  routing         │     │                  │
│  graph.json      │     │  layouted.json   │     │  output/*.png    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Stage 1: Graph Construction

`build_elk_graph()` (line ~93) creates an ELK compound graph:

- **6 group nodes** — one per column (Ingest, Features, Train, Serve, Observe, App)
- **11 child nodes** — each assigned to a group via `column_index`
- **15 edges** — cross-group connections with tier metadata

The compound graph uses `INCLUDE_CHILDREN` hierarchy handling so ELK treats groups as containers and routes edges in root-space coordinates.

### Stage 2: ELK Layout

`run_elk_layout()` calls `node elk_layout/layout.mjs` as a subprocess. The bridge script:
1. Reads `graph.json`
2. Runs ELK with orthogonal edge routing (`elk.layered`, `POLYLINE` routing)
3. Writes `layouted.json` with absolute (x, y) for each node and bend-point arrays for each edge

### Stage 3: Rendering

`draw_diagram()` reads `layouted.json` and produces the PNG:
- Groups as rounded rectangles with colored backgrounds
- Nodes as white cards with icons, labels, and subtitles
- Edges as routed polylines with 3-tier visual hierarchy
- Column headers as styled text above each group

---

## Icon System

### Source and Resolution

Icons are **pre-rendered 512x512 PNGs** derived from Snowflake SVG icon library. The SVGs live in the SnowGram frontend (`frontend/public/icons/`) but are only used at build time — the generator reads PNGs from `icons/` at runtime.

### Rendering Pipeline

```
icons/*.png (512x512)
    │
    ▼
load_icon(fn, sz=96)          # Pillow LANCZOS downscale: 512→96 (5.3x supersampling)
    │
    ▼
OffsetImage(data, zoom=0.358)  # matplotlib scales for display
    │
    ▼
AnnotationBbox at (x, y)       # Placed at node center-top
    │
    ▼
fig.savefig(dpi=180)           # Final output: ~68px effective icon size
```

### SVG-to-PNG Mapping

All 11 PNGs are verified pixel-matched to their SVG sources:

| PNG filename | Source SVG | Icon description |
|---|---|---|
| `raw_events.png` | `Snowflake_ICON_RA_Data.svg` | Database cylinder |
| `dynamic_table.png` | `Snowflake_ICON_RA_Table_Dynamic.svg` | Table with "DYNAMIC" badge |
| `feature_store.png` | `Snowflake_ICON_Cube.svg` | 3D cube |
| `xgboost.png` | `Snowflake_ICON_Workloads_AI.svg` | Brain/circuit |
| `model_registry.png` | `Snowflake_ICON_RA_Failover_Group_Data_Science.svg` | "DATA SCIENCE" grid |
| `spcs.png` | `Snowflake_ICON_Snowpark_Containers.svg` | Container boxes |
| `cortex_search.png` | `Snowflake_ICON_Universal_Search.svg` | Search magnifier |
| `model_monitor.png` | `Snowflake_ICON_Alert.svg` | Alert triangle |
| `ml_lineage.png` | `Snowflake_ICON_Connected.svg` | Connected nodes |
| `cdp_profiles.png` | `Snowflake_ICON_RA_Table_Dynamic.svg` | Table with "DYNAMIC" badge |
| `streamlit.png` | `Snowflake_ICON_Streamlit_in_Snowflake.svg` | Paper boat hexagon |

### Why Pre-rendered PNGs (not runtime SVG)

matplotlib's `OffsetImage` requires a numpy array — it cannot embed vector graphics. Every runtime SVG rendering approach was evaluated:

| Approach | Result | Why rejected |
|---|---|---|
| cairosvg | Renders correctly | Needs native cairo library + `DYLD_LIBRARY_PATH` hack; not portable |
| svglib + reportlab | Fails to install | Requires pycairo native build (needs pkg-config + cairo headers) |
| skia-python | Renders icons as solid black | Doesn't support CSS `<style>` blocks used in Snowflake SVGs |
| pyvips | Would work | Needs native libvips installation |
| skunk | SVG-in-SVG only | Only works when output format is SVG, not PNG |

Pre-rendering at 512x512 provides 5.3x supersampling at the display size, giving crisp anti-aliased icons with zero runtime dependencies.

### Re-rendering Icons

If icons need to be updated, use cairosvg on a machine with cairo installed:

```bash
DYLD_LIBRARY_PATH=/opt/homebrew/lib python3 -c "
import cairosvg
SVG_DIR = '../../../frontend/public/icons'
mapping = {
    'raw_events': 'Snowflake_ICON_RA_Data.svg',
    'dynamic_table': 'Snowflake_ICON_RA_Table_Dynamic.svg',
    # ... (see full mapping above)
}
for png_name, svg_name in mapping.items():
    cairosvg.svg2png(url=f'{SVG_DIR}/{svg_name}',
                     write_to=f'icons/{png_name}.png',
                     output_width=512, output_height=512)
"
```

---

## Edge Routing

### 3-Tier Visual Hierarchy

Edges use three visual tiers that control line weight, color, and arrow size:

| Tier | Line width | Color | Dash | Arrow scale | Usage |
|---|---|---|---|---|---|
| `primary` | 2.2 | `#2E4057` | solid | 15 | Main data flow path |
| `secondary` | 1.7 | `#4A6B8A` | solid | 13 | Important secondary connections |
| `tertiary` | 1.4 | `#7A9BB5` | `(4,3)` dashed | 11 | Auxiliary connections |

### Post-Layout Overrides

ELK handles most edge routing automatically, but 4 edges required manual correction after layout:

| Edge | Fix | Reason |
|---|---|---|
| e4 (`xgboost→model_registry`) | Force straight horizontal path | Intra-group edge was routed outside group |
| e7 (`model_registry→cdp_profiles`) | Shift label position | Label collided with e6 path |
| e10 (`raw_events→cortex_search`) | Custom 3-segment L-route below diagram | ELK wrapped route through other groups |
| e13 (`cortex_search→streamlit`) | Simplify to 2-segment path | Unnecessary bends in short connection |

These overrides are applied in `draw_edges()` using edge index checks (e.g., `if edge_idx == 4:`).

---

## ELK Configuration

### Compound Graph Structure

```
Root (layoutOptions: layered, POLYLINE routing)
├── Group 0: "Ingest"    → contains: raw_events
├── Group 1: "Features"  → contains: dynamic_table, feature_store
├── Group 2: "Train"     → contains: xgboost, model_registry
├── Group 3: "Serve"     → contains: spcs, cortex_search
├── Group 4: "Observe"   → contains: model_monitor, ml_lineage
└── Group 5: "App"       → contains: cdp_profiles, streamlit
```

### Key Layout Options

- `elk.algorithm`: `layered` (left-to-right hierarchical)
- `elk.direction`: `RIGHT`
- `elk.layered.crossingMinimization.strategy`: `LAYER_SWEEP`
- `elk.hierarchyHandling`: `INCLUDE_CHILDREN` (routes edges through group boundaries)
- `elk.edgeRouting`: `POLYLINE` (orthogonal with bend points)

---

## Key Code Locations

| Function/Section | Line | Purpose |
|---|---|---|
| Node definitions | ~53 | 11-tuple list: (id, label, subtitle, icon_file, column_index) |
| Edge definitions | ~72 | 15-tuple list: (source, target, tier, options) |
| `build_elk_graph()` | ~93 | Constructs ELK compound graph JSON |
| `run_elk_layout()` | ~180 | Calls Node.js subprocess for ELK layout |
| `load_icon()` | ~285 | Loads PNG, resizes with LANCZOS, returns numpy array |
| `draw_node()` | ~740 | Renders single node: card, icon, label, subtitle |
| `draw_edges()` | ~550 | Renders all edges with tier styling + post-layout overrides |
| Edge override: e4 | ~600 | Intra-group straight path fix |
| Edge override: e7 | ~640 | Label collision fix |
| Edge override: e10 | ~680 | Below-diagram L-route |
| Edge override: e13 | ~710 | Simplified 2-segment path |
| Output + path print | ~805 | `fig.savefig()` + absolute path to stdout |

> Line numbers are approximate and may shift between versions.
