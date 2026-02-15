# SnowGram: Cortex-Powered Diagram Generator

> **AI-powered architecture diagramming for Snowflake Solution Engineers**

SnowGram is an intelligent diagram generation application that combines Snowflake Cortex AI/ML services with a modular "Lego block" framework to help users create professional Snowflake-friendly architecture diagrams quickly through natural language conversations.

## 🎯 Key Features

- **Cortex-Powered Intelligence**: Uses Semantic Models, Cortex Analyst, Cortex Search, and Cortex Agents for superior natural language understanding
- **Modular Component Framework**: Build diagrams from reusable Lego-like blocks for consistency and speed
- **Interactive WYSIWYG Editor**: Excalidraw integration with full drag-and-drop editing
- **Mermaid-as-Code**: Generate diagrams programmatically with human-readable syntax
- **Glassmorphic UI**: Modern, beautiful interface with expandable agent sidebar
- **SPCS Deployment**: Runs natively in Snowflake with full security and governance

## 🏗️ Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                     SnowGram SPCS Service                    │
├─────────────────┬───────────────────────────────────────────┤
│  Agent Sidebar  │         Excalidraw Canvas                 │
│  (1/3 width)    │         (2/3 width)                       │
│                 │                                           │
│  Cortex Agent   │  ┌──────────────────────────────────┐   │
│  Chat Interface │  │   Interactive Diagram Editor     │   │
│                 │  │   • Drag & Drop                  │   │
│  Powered by:    │  │   • Zoom & Pan                   │   │
│  • Analyst      │  │   • Icon Import                  │   │
│  • Search       │  │   • Export PNG/SVG               │   │
│  • Custom Tools │  └──────────────────────────────────┘   │
└─────────────────┴───────────────────────────────────────────┘
```

### Cortex Intelligence Stack

1. **Semantic Models (YAML)** - Component ontology and relationships
2. **Semantic Views (SQL)** - Queryable catalogs of blocks, patterns, and templates
3. **Cortex Analyst** - Natural language to SQL queries over semantic views
4. **Cortex Search** - RAG over Snowflake documentation
5. **Cortex Agent** - Orchestrates across all tools with Claude Sonnet 4
6. **Custom Tools** - Mermaid generation, validation, and composition

### Modular Framework (3-Tier Hierarchy)

```text
Component Blocks (Atomic)     Composed Patterns           Full Templates
━━━━━━━━━━━━━━━━━━━━━━      ━━━━━━━━━━━━━━━━━━━━━      ━━━━━━━━━━━━━━━
┌──────────┐                ┌────────────────────┐      ┌─────────────────┐
│ S3 Bucket│                │ S3 to Snowflake    │      │ Real-Time IoT   │
└──────────┘                │ Batch Ingestion    │      │ Pipeline        │
┌──────────┐                │                    │      │                 │
│  Stage   │                │ = S3 + Stage +     │      │ = Kafka +       │
└──────────┘          +     │   Snowpipe + Table │  to  │   Transform +   │
┌──────────┐                └────────────────────┘      │   RBAC          │
│ Snowpipe │                                            └─────────────────┘
└──────────┘
```

## 🚀 Quick Start

### Prerequisites

- Snowflake account with ACCOUNTADMIN or equivalent privileges
- Snowflake CLI installed
- Docker Desktop installed (for local testing)
- Python 3.11+
- Node.js 18+

### 1. Database Setup

```bash
# Connect with svcUser (service account, no MFA)
snow sql -c svcUser

# Run setup script
snow sql -c svcUser -f setup_backend.sql
```

This creates:
- `SNOWGRAM_DB` database
- Schemas: `CORE`, `AGENTS`, `SEMANTICS`, `KNOWLEDGE`
- Tables for component blocks, patterns, and templates
- Compute pool and image repository for SPCS

### 2. Local Development

```bash
# Clone and navigate
cd /Users/abannerjee/Documents/SnowGram

# Start backend and frontend with Docker Compose
docker-compose up --build

# Access at http://localhost:3000
```

### 3. SPCS Deployment

```bash
# Build Docker image
docker build -t snowgram:latest -f docker/Dockerfile .

# Push to Snowflake image repository
snow spcs image-repository upload-image \
  --connection svcUser \
  snowgram:latest

# Deploy service
snow spcs service deploy snowgram_service \
  --connection svcUser \
  --spec-file spec.yml

# Get service endpoint
snow spcs service describe snowgram_service --connection svcUser
```

## 📖 Usage

### Creating a Diagram with Natural Language

1. **Start Conversation**: Open SnowGram and the agent greets you with starter questions
   - "Current state or future state diagram?"
   - "Primary use case?" (ingestion, transformation, security, etc.)
   - "Key Snowflake components?"
   - "External integrations?"

2. **Agent Generates Diagram**: Based on your answers, the agent:
   - Queries semantic models to find relevant component blocks
   - Searches reference templates for similar patterns
   - Composes Mermaid code by stitching together pre-built blocks
   - Returns diagram with explanation

3. **Edit Visually**: The Mermaid code automatically renders in Excalidraw where you can:
   - Drag and reposition components
   - Add custom icons (drag & drop or Cmd/Ctrl+V)
   - Adjust styling (colors, line thickness, labels)
   - Export as PNG, SVG, or PDF

### Example: Kafka to Snowflake Pipeline

**User**: "Create a real-time data pipeline from Kafka to Snowflake with transformation"

**Agent**:
1. Queries `modular_component_catalog`: "Find blocks related to Kafka ingestion"
   - Returns: `KAFKA_CONNECTOR_BLOCK`, `SNOWPIPE_STREAMING_BLOCK`
2. Queries `modular_component_catalog`: "Find transformation patterns"
   - Returns: `STREAM_TASK_TRANSFORMATION` pattern
3. Composes: `KAFKA_STREAMING_INGESTION` + `STREAM_TASK_TRANSFORMATION`
4. Generates Mermaid code and explains components used

**Result**: Complete, production-ready diagram in < 30 seconds

## 🛠️ Development

### Project Structure

```text
SnowGram/
├── .cursor/rules              # Project-specific coding guidelines
├── BUILD_PROGRESS.md          # Detailed build progress tracking
├── setup_backend.sql          # Snowflake object DDL
├── spec.yml                   # SPCS service specification
├── docker/
│   ├── Dockerfile             # Multi-stage build (Python + Node)
│   └── docker-compose.yml     # Local development environment
├── backend/
│   ├── api/                   # FastAPI application
│   ├── agent/                 # Cortex Agent configuration
│   ├── semantics/             # Semantic models (YAML) and views (SQL)
│   ├── modular/               # Component blocks, patterns, templates
│   ├── knowledge/             # Cortex Search setup and doc ingestion
│   └── db/                    # Snowflake connector utilities
├── frontend/
│   └── src/
│       ├── components/        # React components (AgentSidebar, DiagramCanvas, etc.)
│       ├── hooks/             # Custom hooks (Excalidraw, Mermaid converter)
│       ├── lib/               # Utilities (Mermaid parser, icon manager)
│       └── styles/            # Glassmorphic UI styling
└── docs/                      # Architecture documentation
```

### Technology Stack

**Backend**:
- Python 3.11 with FastAPI
- Snowflake Python Connector
- WebSocket support for real-time agent chat

**Frontend**:
- React 18 with TypeScript
- Next.js for SSR and routing
- Excalidraw for diagram editing
- @excalidraw/mermaid-to-excalidraw for conversions

**Snowflake**:
- SPCS (Snowpark Container Services)
- Cortex Agents (Claude Sonnet 4)
- Cortex Analyst (semantic model queries)
- Cortex Search (documentation RAG)

### Running Tests

```bash
# Backend tests
cd backend
pytest

# Frontend tests
cd frontend
npm test

# Integration tests (requires Docker)
docker-compose -f docker-compose.test.yml up
```

## 📊 Component Library

### Pre-Built Component Blocks

- **Ingestion**: S3 Bucket, External Stage, Snowpipe, Kafka Connector
- **Transformation**: Stream, Task, Stored Procedure
- **Storage**: Database, Schema, Table, View
- **Compute**: Warehouse (XS, S, M, L, XL)
- **Security**: Role, User, Grant, Network Policy
- **Integration**: External Function, API Integration

### Pre-Built Patterns

- `S3_TO_SNOWFLAKE_BATCH_INGESTION`
- `STREAM_TASK_TRANSFORMATION`
- `KAFKA_STREAMING_INGESTION`
- `RBAC_SECURITY_LAYER`
- `EXTERNAL_FUNCTION_ENRICHMENT`

### Reference Templates

- `REAL_TIME_IOT_PIPELINE`
- `BATCH_DATA_WAREHOUSE`
- `MULTI_CLOUD_DATA_MESH`
- `SECURE_DATA_SHARING_HUB`

## 🔒 Security

All HIGH severity npm vulnerabilities have been addressed. The frontend uses npm overrides for transitive dependency fixes:

| Override | Version | Reason |
|----------|---------|--------|
| `lodash-es` | 4.17.23 | Prototype pollution fix |
| `nanoid` | ^5.0.9 | Predictable ID generation fix |

See `frontend/DEPENDENCIES.md` for full details on dependency management.

**Requirements:**
- Node.js 18.0.0+ (20.x LTS recommended)

## 📦 Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| Next.js | 15.5.12 | React framework |
| React | 18.2.0 | UI library |
| mermaid | 11.12.2 | Diagram syntax |
| ESLint | 9.x | Code quality |

## 🤝 Contributing

1. Create a feature branch: `git checkout -b feature/new-component-block`
2. Update `BUILD_PROGRESS.md` with your changes
3. Test locally with Docker Compose
4. Submit PR with clear description


## 🆘 Support

- Documentation: See `/docs` directory
- Build Progress: `BUILD_PROGRESS.md`
- Snowflake Docs: https://docs.snowflake.com

***

**Built with ❄️ by Snowflake SEs, for Snowflake SEs**


