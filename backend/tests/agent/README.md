# SnowGram Agent Test Harness

Automated testing framework for the SnowGram Cortex Agent.

## Quick Start

```bash
# Run all tests
python run_tests.py

# Run quick smoke test (3 tests)
python run_tests.py --quick

# Run specific tests
python run_tests.py --test medallion

# Generate HTML report
python run_tests.py --report

# Verbose output
python run_tests.py -v
```

## Requirements

- Python 3.9+
- `pyyaml` - For test case parsing
- `snowflake-connector-python` - For Snowflake connection
- `uv` - For running the agent skill scripts

Install dependencies:
```bash
pip install pyyaml snowflake-connector-python
```

## Test Cases

Test cases are defined in `test_cases.yaml`:

```yaml
test_cases:
  - name: "medallion_internal"
    description: "Medallion architecture without external sources"
    query: "Create a simple medallion architecture"
    validations:
      - has_json           # Response contains ```json``` block
      - has_mermaid        # Response contains ```mermaid``` block
      - json_has_nodes     # JSON has nodes array
      - no_external_sources # No S3/Kafka/Azure mentioned
    expected_tools:
      - map_component      # Should use this tool
```

### Available Validations

| Validation | Description |
|------------|-------------|
| `has_json` | Response contains a ```json``` code block |
| `has_mermaid` | Response contains a ```mermaid``` code block |
| `json_has_nodes` | JSON block has a `nodes` array with items |
| `json_has_edges` | JSON block has an `edges` array with items |
| `no_external_sources` | Response doesn't mention S3/Kafka/Azure |
| `has_external_sources` | Response mentions external sources |
| `contains: [list]` | Response contains all specified terms |
| `not_contains: [list]` | Response doesn't contain specified terms |

## Output

Test results are saved to `results/<timestamp>/`:

```
results/20260213_223000/
├── medallion_internal.json   # Raw agent response
├── medallion_with_s3.json
├── iot_kafka.json
├── report.json               # Machine-readable results
└── report.html               # Human-readable report (if --report)
```

## Adding Tests

1. Edit `test_cases.yaml`
2. Add a new test case:

```yaml
  - name: "my_new_test"
    description: "Description of what this tests"
    query: "The question to ask the agent"
    validations:
      - has_json
      - contains:
          - "expected_term"
```

3. Run: `python run_tests.py --test my_new_test`

## CI/CD Integration

```bash
# Run tests and exit with non-zero on failure
python run_tests.py --quick

# Check exit code
if [ $? -eq 0 ]; then
    echo "Tests passed!"
else
    echo "Tests failed!"
    exit 1
fi
```

## Test Categories

| Category | Tests | Purpose |
|----------|-------|---------|
| Medallion | 3 | Verify medallion architecture generation |
| Streaming | 2 | Test Kafka/IoT pipelines |
| Components | 2 | Verify component type validation |
| Documentation | 2 | Test CKE search integration |
| Edge Cases | 2 | Ambiguous and complex requests |
| Layout | 1 | Verify positioning and grid layout |
