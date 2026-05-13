# ELK Architecture Diagram Generator

Standalone tool that generates a high-quality PNG architecture diagram for the **Creator Commerce ML Demo**. Uses ELK (Eclipse Layout Kernel) for orthogonal edge routing and matplotlib for rendering.

> This tool is self-contained within `backend/elk_diagram/`. It has no imports from or runtime dependencies on the SnowGram GUI application.

## Quick Start

```bash
cd backend/elk_diagram
python3 generate_arch_diagram_elk.py
```

Output: `output/architecture_diagram_elk.png` (full absolute path printed to stdout).

## Prerequisites

| Dependency | Version | Purpose |
|---|---|---|
| Python 3.11+ | 3.11 | Runtime |
| matplotlib | 3.10+ | Rendering (figures, patches, text) |
| Pillow | 12.0+ | Icon loading (PNG → numpy array) |
| numpy | 2.x | Array operations for icon data |
| Node.js | 20+ | ELK layout engine (`elk_layout/layout.mjs`) |
| elkjs | 0.10+ | Node.js ELK library (vendored in `elk_layout/node_modules/`) |

## File Structure

```
elk_diagram/
├── generate_arch_diagram_elk.py   # Main generator (single file, ~820 lines)
├── icons/                         # Pre-rendered 512x512 Snowflake icon PNGs
│   ├── raw_events.png
│   ├── dynamic_table.png
│   └── ... (11 icons total)
├── elk_layout/
│   ├── layout.mjs                 # Node.js ELK bridge script
│   ├── graph.json                 # Generated ELK input graph
│   ├── layouted.json              # ELK output with coordinates
│   ├── package.json
│   └── node_modules/elkjs/        # Vendored ELK library
├── output/
│   └── architecture_diagram_elk.png  # Generated diagram
├── README.md                      # This file
├── ARCHITECTURE.md                # Technical deep dive
└── PLAN.md                        # Version history and roadmap
```

## Pipeline

```
Node/Edge definitions (Python dicts)
        │
        ▼
   build_elk_graph()  →  graph.json
        │
        ▼
   Node.js: layout.mjs  →  layouted.json  (ELK orthogonal routing)
        │
        ▼
   matplotlib rendering  →  architecture_diagram_elk.png
```

## Deeper Reading

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Pipeline internals, icon system, edge routing, design decisions
- **[PLAN.md](PLAN.md)** — Version history, research findings, future roadmap
