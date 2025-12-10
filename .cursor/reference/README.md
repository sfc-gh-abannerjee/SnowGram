# Cursor Agent Reference Documentation

> **Documentation for Cursor agents working on SnowGram - NOT for Cortex Agents within SnowGram**

## 📁 Directory Purpose

This directory contains quick reference documentation for **Cursor AI agents** (like me) that are helping build the SnowGram application. This is separate from:
- `backend/` - Application code (Python, FastAPI)
- `docs/` - Comprehensive deployment guides

## 📚 Contents

- **`CORTEX_AGENTS_REFERENCE.md`** - Quick ref for implementing Cortex Agents (1-page)
- **`SPCS_REFERENCE.md`** - Quick ref for SPCS deployment (30-min checklist)
- **`README.md`** - This file

## 🎯 Usage Guidelines

### For Cursor Agents
- **Start here** for quick lookup
- **Refer to `docs/`** for comprehensive explanations
- **Use as cheat sheets** to avoid re-researching

### Not for Cortex Agents
- Cortex Agents (the AI agents running **inside** SnowGram) don't use these
- They use semantic models, Cortex Search services, and custom tools in `backend/`

## 📖 Documentation Structure

```
SnowGram/
├── .cursor/
│   └── reference/           ← You are here (Cursor agent quick refs)
│       ├── CORTEX_AGENTS_REFERENCE.md
│       ├── SPCS_REFERENCE.md
│       └── README.md
│
├── docs/                    ← Comprehensive guides (deep dives)
│   ├── CORTEX_AGENT_DEPLOYMENT.md        (12,000+ words)
│   ├── CORTEX_AGENT_QUICK_REFERENCE.md   (Command cheat sheet)
│   └── SPCS_DEPLOYMENT_GUIDE.md          (7,000+ words)
│
├── backend/                 ← Application code
│   ├── agent/               (Cortex Agent configuration)
│   ├── api/                 (FastAPI endpoints)
│   ├── semantics/           (Semantic models for Cortex Analyst)
│   └── knowledge/           (Cortex Search setup)
│
└── frontend/                ← React + Next.js UI
```

---

**Created**: November 14, 2025  
**Source**: Snowflake Documentation via MCP Server
