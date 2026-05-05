---
name: snowgram-architect
description: "[DEPRECATED] Snowflake architecture diagram generation. Superseded by snowflake-architecture-diagram, which adds standalone (no-deploy), connected-cli, connected-ui, and from-lineage modes. Triggers: architecture diagram, snowflake architecture, medallion, lakehouse, snowgram, draw architecture."
---

# snowgram-architect (deprecated)

This skill is **superseded** by `snowflake-architecture-diagram`, which adds:

- **Standalone mode** — generate diagrams with no Snowflake deploy required
- **From-lineage mode** — reverse-engineer diagrams from real deployed objects
- **Connected-CLI mode** — uses `cortex agents run` directly (no frontend needed)
- **Connected-UI mode** — full SnowGram frontend at localhost:3002
- **Bootstrap mode** — deploy SnowGram into a clean account

## What to do

Load `snowflake-architecture-diagram` instead:

```
skill: snowflake-architecture-diagram
```

The new skill auto-detects the right mode (standalone vs connected-cli vs connected-ui vs from-lineage) and routes accordingly. It is co-developed in the SnowGram repo at `skills/snowflake-architecture-diagram/` and ships with bundled templates, a Python Mermaid composer (verified byte-for-byte against the deployed UDF), a self-contained viewer, and an installer that symlinks into `~/.snowflake/cortex/skills/`.

Run `<repo>/skills/snowflake-architecture-diagram/install.sh` once to make it discoverable user-globally.

## Migration notes

| Old behavior | New behavior |
|---|---|
| Always required `SNOWGRAM_AGENT` deployed | Standalone mode works without it |
| Hand-off to `localhost:3002` only | Multiple render paths (lightweight viewer + live frontend) |
| Single-shot agent call | Adds doc citations, semantic-view enrichment, lineage walks |
| 14 templates referenced via SQL | 14 templates bundled as JSON snapshots |
