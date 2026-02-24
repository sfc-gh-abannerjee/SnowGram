# SnowGram Guardrails

> Lessons learned from failures. Each "Sign" prevents repeated mistakes.

## Signs (Accumulated Wisdom)

<!-- Signs are added automatically when failures are diagnosed -->

### Sign: Repeated structure failure
- **Instruction**: Direct fixes failed 4x. Escalate to bundled skill.
- **Added after**: Iteration 4

### Sign: Repeated structure failure
- **Instruction**: Direct fixes failed 3x. Escalate to bundled skill.
- **Added after**: Iteration 3
<!-- Format: ### Sign: [trigger] - [instruction] - Added iter N -->

## Escalation Rules

| Failure Pattern | Count | Action |
|-----------------|-------|--------|
| Same component error | 3x | Escalate to $cortex-agent |
| Same synonym missing | 3x | Escalate to $semantic-view |
| Same layout defect | 3x | Escalate to $lane-layout-debugger |
| Direct fix failed | 3x | Escalate to project skill |

## Known Anti-Patterns

1. **Never** fall back to direct Mermaid template editing for agent issues
2. **Never** modify frontend code for semantic view gaps
3. **Always** trace component naming issues to agent spec first

### Sign: Missing streaming component synonyms
- **Instruction**: Added 25 synonyms for streaming components (Snowpipe Streaming, Dynamic Table, Producer, Kinesis, Firehose, Event Hubs, Pub/Sub, Container Services, Native App)
- **Added after**: Iteration 5 (manual fix via $semantic-view skill)
- **Fix applied**: INSERT INTO COMPONENT_SYNONYMS with streaming-specific terms
