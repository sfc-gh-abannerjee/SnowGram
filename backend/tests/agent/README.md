# SnowGram Agent Test Harness

Fast, modular test execution for iterative development of the SnowGram architecture diagram agent.

## Quick Start

```bash
cd backend/tests/agent

# Run smoke tests (~2 min) - default
python run_tests.py

# Run all tests (~13 min)
python run_tests.py --all

# Instant validation against cached responses
python run_tests.py --cached --all

# List available tests
python run_tests.py --list
```

## Execution Modes

| Mode | Command | Time | Use Case |
|------|---------|------|----------|
| **Smoke** (default) | `python run_tests.py` | ~2 min | Quick sanity check |
| **Cached** | `python run_tests.py --cached --all` | < 1 sec | Test validation logic changes |
| **Category** | `python run_tests.py -c flowstage` | ~1-2 min | Test specific features |
| **Failed only** | `python run_tests.py --failed` | Varies | Fix and re-test failures |
| **Full suite** | `python run_tests.py --all` | ~13 min | Full regression |
| **Parallel** | `python run_tests.py --all -p 2` | ~7 min | Faster full run |

## Test Categories

| Category | Tests | Purpose |
|----------|-------|---------|
| `smoke` | 3 | Quick sanity (medallion_internal, iot_kafka, component_types) |
| `core` | 7 | Core architecture patterns |
| `flowstage` | 2 | ELK.js layout metadata validation |
| `tools` | 4 | Agent tool coverage (map_component, classify_component, cortex_search) |
| `e2e` | 2 | Full end-to-end integration |
| `layout` | 1 | Grid positioning |
| `validation` | 4 | Edge cases and ambiguous requests |

## CLI Options

```
python run_tests.py [OPTIONS]

Options:
  -t, --test PATTERN     Run tests matching pattern (e.g., -t medallion)
  -c, --category CAT     Run tests from category (smoke|core|flowstage|tools|e2e|layout|validation)
  -a, --all              Run all tests
  --cached               Use cached responses (instant validation)
  -f, --failed           Re-run only previously failed tests
  -p, --parallel N       Run N tests concurrently
  -v, --verbose          Show detailed validation output
  -r, --report           Generate HTML report
  -l, --list             List all available tests
  -o, --output DIR       Output directory (default: results)
```

## Development Workflow

### 1. Working on Validation Logic
When modifying `run_tests.py` validation functions:
```bash
# Instant feedback - uses cached agent responses
python run_tests.py --cached --all -v
```

### 2. Working on Agent Behavior
When modifying the agent (tools, prompts, etc.):
```bash
# Quick smoke test
python run_tests.py

# Test specific category
python run_tests.py -c tools -v
```

### 3. Before Committing
```bash
# Run relevant category
python run_tests.py -c <your-feature>

# Or full suite if major changes
python run_tests.py --all --report
```

### 4. Fixing Failures
```bash
# Re-run only failed tests
python run_tests.py --failed -v
```

## Test Configuration

Tests are defined in `test_cases.yaml`:

```yaml
test_cases:
  - name: "test_name"
    description: "What this test validates"
    query: "The prompt sent to the agent"
    expected_tools:           # Optional: tools that should be called
      - map_component
      - classify_component
    validations:              # Required: checks to run on response
      - has_json              # Response contains ```json block
      - has_mermaid           # Response contains ```mermaid block
      - json_has_nodes        # JSON has non-empty nodes array
      - json_has_edges        # JSON has non-empty edges array
      - json_has_flowstage    # All nodes have flowStage/flowStageOrder
      - json_flowstage_ordered # Edges flow source->target by flowStageOrder
      - has_external_sources  # Contains external systems (S3, Kafka, etc.)
      - no_external_sources   # No external systems
      - contains:             # Response contains these terms
          - "Dynamic"
          - "Table"
      - not_contains:         # Response doesn't contain these terms
          - "error"
```

## Available Validations

| Validation | Description |
|------------|-------------|
| `has_json` | Response contains a ```json code block |
| `has_mermaid` | Response contains a ```mermaid code block |
| `json_has_nodes` | JSON has non-empty `nodes` array |
| `json_has_edges` | JSON has non-empty `edges` array |
| `json_has_flowstage` | All nodes have `flowStage` and `flowStageOrder` |
| `json_flowstage_ordered` | 80%+ of edges flow from lower to higher flowStageOrder |
| `has_external_sources` | Response mentions external systems (S3, Kafka, Azure, GCP) |
| `no_external_sources` | Response doesn't mention external systems |
| `contains: [terms]` | Response contains all specified terms (case-insensitive) |
| `not_contains: [terms]` | Response doesn't contain any specified terms |
| `expected_tools: [tools]` | Specified tools were called during execution |

## Output Structure

```
results/
  20260213_100812/           # Timestamp directory
    medallion_internal.json  # Raw agent response
    iot_kafka.json
    ...
    report.json              # Test results summary
    report.html              # HTML report (with --report flag)
```

## Adding New Tests

1. Add test case to `test_cases.yaml`
2. Assign to appropriate category in `run_tests.py` CATEGORIES dict
3. Run with cached mode to verify validations work:
   ```bash
   python run_tests.py -t your_new_test --cached
   ```
4. Run live to generate cache:
   ```bash
   python run_tests.py -t your_new_test -v
   ```

## Troubleshooting

### Tests timeout
- Default timeout is 180s per test
- Complex queries may need longer - check agent logs

### Cached mode shows SKIP
- No cached response found for that test
- Run the test live first to generate cache

### Parallel mode issues
- Agent API may have rate limits
- Try reducing parallelism: `-p 2` instead of `-p 4`

### Validation fails but response looks correct
- Check if agent format changed (node-level vs data-nested)
- Run with `-v` to see which specific check failed
- Use `--cached` to iterate on validation logic quickly
