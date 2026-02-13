#!/usr/bin/env python3
"""
SnowGram Agent Test Harness (Optimized)

Fast, modular test execution for iterative development.

Usage:
    python run_tests.py                      # Run smoke tests (fast ~2min)
    python run_tests.py --all                # Run all tests
    python run_tests.py --category flowstage # Run specific category
    python run_tests.py --cached             # Validate against cached responses (instant)
    python run_tests.py --failed             # Re-run only previously failed tests
    python run_tests.py --parallel 3         # Run 3 tests concurrently

Categories: smoke, core, flowstage, tools, e2e, layout
"""

import argparse
import json
import os
import re
import sys
import time
import concurrent.futures
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional, List

import yaml

# Add parent paths for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

try:
    import snowflake.connector
    from snowflake.connector import DictCursor
except ImportError:
    print("Error: snowflake-connector-python required. Install with: pip install snowflake-connector-python")
    sys.exit(1)


# Test categories for modular execution
CATEGORIES = {
    'smoke': ['medallion_internal', 'iot_kafka', 'component_types'],  # ~2 min
    'core': ['medallion_internal', 'medallion_with_s3', 'medallion_bi', 'iot_kafka', 
             'streaming_snowpipe', 'component_types', 'dynamic_tables'],
    'flowstage': ['flowstage_all_nodes', 'flowstage_ordering'],
    'tools': ['tool_classify_unknown', 'tool_map_known', 'tool_docs_search', 'tool_best_practice'],
    'e2e': ['e2e_full_pipeline', 'e2e_internal_only'],
    'layout': ['layout_grid'],
    'validation': ['component_recommendations', 'best_practices', 'ambiguous_request', 'complex_request'],
}


@dataclass
class TestResult:
    """Result of a single test case."""
    name: str
    query: str
    status: str  # PASS, FAIL, ERROR, SKIP
    duration_ms: float = 0.0
    response: str = ""
    tools_used: list = field(default_factory=list)
    validation_results: dict = field(default_factory=dict)
    error_message: str = ""
    cached: bool = False


@dataclass
class TestReport:
    """Aggregated test report."""
    suite_name: str
    timestamp: str
    total: int = 0
    passed: int = 0
    failed: int = 0
    errors: int = 0
    skipped: int = 0
    duration_ms: float = 0
    results: list = field(default_factory=list)


def load_config():
    """Load Snowflake connection config from ~/.snowflake/config.toml."""
    config_path = Path.home() / ".snowflake" / "config.toml"
    
    if not config_path.exists():
        raise FileNotFoundError(f"Config not found: {config_path}")
    
    try:
        import toml
        config = toml.load(config_path)
        return config.get('connections', {})
    except ImportError:
        # Parse TOML manually for basic cases
        config = {}
        current_section = None
        with open(config_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith('[') and line.endswith(']'):
                    section = line[1:-1]
                    if '.' in section:
                        parts = section.split('.')
                        if parts[0] == 'connections':
                            current_section = parts[1]
                            config[current_section] = {}
                elif '=' in line and current_section:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    config[current_section][key] = value
        return config


def get_snowflake_connection(connection_name: str):
    """Get a Snowflake connection."""
    connections = load_config()
    
    if connection_name not in connections:
        raise ValueError(f"Connection '{connection_name}' not found in config")
    
    conn_config = connections[connection_name]
    
    return snowflake.connector.connect(
        account=conn_config.get('account'),
        user=conn_config.get('user'),
        password=conn_config.get('password'),
        warehouse=conn_config.get('warehouse', 'COMPUTE_WH'),
        database=conn_config.get('database'),
        schema=conn_config.get('schema'),
        role=conn_config.get('role'),
    )


def call_agent_via_skill(agent_name: str, database: str, schema: str, 
                         connection: str, query: str, output_file: str) -> dict:
    """Call agent using the bundled skill script (more reliable)."""
    import subprocess
    
    skill_dir = Path.home() / ".local/share/cortex" 
    
    # Find the skill directory
    for d in skill_dir.iterdir():
        if d.is_dir() and 'bundled_skills' in str(list(d.iterdir())):
            skill_dir = d / "bundled_skills/agent_optimization"
            break
    else:
        # Try common path
        for d in skill_dir.iterdir():
            test_path = d / "bundled_skills/agent_optimization"
            if test_path.exists():
                skill_dir = test_path
                break
    
    if not skill_dir.exists():
        raise FileNotFoundError(f"Skill directory not found under {Path.home() / '.local/share/cortex'}")
    
    cmd = [
        "uv", "run", "--project", str(skill_dir),
        "python", str(skill_dir / "scripts/test_agent.py"),
        "--agent-name", agent_name,
        "--question", query,
        "--output-file", output_file,
        "--database", database,
        "--schema", schema,
        "--connection", connection
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    
    if result.returncode != 0:
        raise Exception(f"Agent call failed: {result.stderr}")
    
    # Read the output file
    with open(output_file) as f:
        response_data = json.load(f)
    
    # Extract response text and tools used
    response_text = ""
    tools_used = []
    
    for item in response_data.get('content', []):
        if item.get('type') == 'text':
            response_text += item.get('text', '')
        elif item.get('type') == 'tool_use':
            tools_used.append(item.get('tool_use', {}).get('name', 'unknown'))
    
    return {
        'response': response_text,
        'tools_used': tools_used
    }


def load_cached_response(cache_dir: Path, test_name: str) -> Optional[dict]:
    """Load cached response for a test if available."""
    # Search in recent result directories for cached response
    results_dir = cache_dir.parent
    if not results_dir.exists():
        return None
    
    # Get most recent results directory
    result_dirs = sorted([d for d in results_dir.iterdir() if d.is_dir()], reverse=True)
    
    for result_dir in result_dirs[:5]:  # Check last 5 runs
        cache_file = result_dir / f"{test_name}.json"
        if cache_file.exists():
            try:
                with open(cache_file) as f:
                    data = json.load(f)
                # Extract response from cached file
                response_text = ""
                tools_used = []
                for item in data.get('content', []):
                    if item.get('type') == 'text':
                        response_text += item.get('text', '')
                    elif item.get('type') == 'tool_use':
                        tools_used.append(item.get('tool_use', {}).get('name', 'unknown'))
                
                if response_text:
                    return {
                        'response': response_text,
                        'tools_used': tools_used,
                        'cache_source': str(cache_file)
                    }
            except (json.JSONDecodeError, KeyError):
                continue
    
    return None


def validate_response(response: str, validations: list, tools_used: list = None) -> dict:
    """Run validation checks on agent response."""
    results = {}
    
    for validation in validations:
        if isinstance(validation, str):
            check_name = validation
            check_params = None
        elif isinstance(validation, dict):
            check_name = list(validation.keys())[0]
            check_params = validation[check_name]
        else:
            continue
        
        if check_name == 'has_json':
            results['has_json'] = '```json' in response
            
        elif check_name == 'has_mermaid':
            results['has_mermaid'] = '```mermaid' in response
            
        elif check_name == 'json_has_nodes':
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response)
            if json_match:
                try:
                    data = json.loads(json_match.group(1))
                    results['json_has_nodes'] = 'nodes' in data and len(data['nodes']) > 0
                except json.JSONDecodeError:
                    results['json_has_nodes'] = False
            else:
                results['json_has_nodes'] = False
                
        elif check_name == 'json_has_edges':
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response)
            if json_match:
                try:
                    data = json.loads(json_match.group(1))
                    results['json_has_edges'] = 'edges' in data and len(data['edges']) > 0
                except json.JSONDecodeError:
                    results['json_has_edges'] = False
            else:
                results['json_has_edges'] = False
                
        elif check_name == 'no_external_sources':
            external_patterns = ['S3', 'AWS S3', 'Kafka', 'Azure', 'GCP', 'Snowpipe Streaming']
            has_external = any(p.lower() in response.lower() for p in external_patterns)
            results['no_external_sources'] = not has_external
            
        elif check_name == 'has_external_sources':
            external_patterns = ['S3', 'AWS S3', 'Kafka', 'Azure', 'GCP', 'Snowpipe']
            has_external = any(p.lower() in response.lower() for p in external_patterns)
            results['has_external_sources'] = has_external
            
        elif check_name == 'contains':
            if check_params:
                for term in check_params:
                    key = f'contains_{term}'
                    results[key] = term.lower() in response.lower()
                    
        elif check_name == 'not_contains':
            if check_params:
                for term in check_params:
                    key = f'not_contains_{term}'
                    results[key] = term.lower() not in response.lower()
        
        elif check_name == 'json_has_flowstage':
            # Check that all nodes have flowStage and flowStageOrder
            # Note: Agent returns these at node level, frontend wraps in data
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response)
            if json_match:
                try:
                    data = json.loads(json_match.group(1))
                    nodes = data.get('nodes', [])
                    if not nodes:
                        results['json_has_flowstage'] = False
                    else:
                        # Check each node has flowStage and flowStageOrder
                        # Check both top-level (agent format) and data nested (frontend format)
                        all_have_flowstage = all(
                            ('flowStage' in node and 'flowStageOrder' in node) or
                            ('flowStage' in node.get('data', {}) and 'flowStageOrder' in node.get('data', {}))
                            for node in nodes
                        )
                        results['json_has_flowstage'] = all_have_flowstage
                except json.JSONDecodeError:
                    results['json_has_flowstage'] = False
            else:
                results['json_has_flowstage'] = False
        
        elif check_name == 'json_flowstage_ordered':
            # Verify edges flow from lower to higher flowStageOrder
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response)
            if json_match:
                try:
                    data = json.loads(json_match.group(1))
                    nodes = data.get('nodes', [])
                    edges = data.get('edges', [])
                    
                    if not nodes or not edges:
                        results['json_flowstage_ordered'] = False
                    else:
                        # Build node ID to flowStageOrder mapping
                        # Check both top-level (agent) and nested data (frontend) format
                        node_order = {}
                        for node in nodes:
                            node_id = node.get('id')
                            flow_order = node.get('flowStageOrder') or node.get('data', {}).get('flowStageOrder')
                            if node_id is not None and flow_order is not None:
                                node_order[node_id] = flow_order
                        
                        # Check each edge flows in correct direction (source <= target)
                        # Allow equal for same-layer connections
                        valid_count = 0
                        total_edges = 0
                        for edge in edges:
                            source = edge.get('source')
                            target = edge.get('target')
                            if source in node_order and target in node_order:
                                total_edges += 1
                                if node_order[source] <= node_order[target]:
                                    valid_count += 1
                        
                        # Pass if >= 80% of edges are valid (allow some variation)
                        if total_edges > 0:
                            results['json_flowstage_ordered'] = (valid_count / total_edges) >= 0.8
                        else:
                            results['json_flowstage_ordered'] = False
                except json.JSONDecodeError:
                    results['json_flowstage_ordered'] = False
            else:
                results['json_flowstage_ordered'] = False
        
        elif check_name == 'expected_tools_called':
            # Check if specific tools were called during agent execution
            if check_params and tools_used:
                for tool in check_params:
                    key = f'tool_called_{tool}'
                    results[key] = any(tool.lower() in t.lower() for t in tools_used)
            elif check_params:
                for tool in check_params:
                    key = f'tool_called_{tool}'
                    results[key] = False  # No tools tracked
    
    return results


def run_test(test_case: dict, agent_config: dict, output_dir: Path, 
             use_cache: bool = False) -> TestResult:
    """Run a single test case."""
    name = test_case['name']
    query = test_case['query']
    validations = test_case.get('validations', [])
    expected_tools = test_case.get('expected_tools', [])
    
    result = TestResult(name=name, query=query, status='ERROR')
    
    output_file = output_dir / f"{name}.json"
    
    start_time = time.time()
    
    try:
        # Try to use cache if enabled
        if use_cache:
            cached = load_cached_response(output_dir, name)
            if cached:
                result.response = cached['response']
                result.tools_used = cached['tools_used']
                result.cached = True
                result.duration_ms = 0  # Instant from cache
            else:
                # No cache available, skip this test
                result.status = 'SKIP'
                result.error_message = "No cached response available"
                return result
        else:
            # Call agent
            response_data = call_agent_via_skill(
                agent_name=agent_config['name'],
                database=agent_config['database'],
                schema=agent_config['schema'],
                connection=agent_config['connection'],
                query=query,
                output_file=str(output_file)
            )
            
            result.response = response_data['response']
            result.tools_used = response_data['tools_used']
            result.duration_ms = (time.time() - start_time) * 1000
        
        # Run validations
        result.validation_results = validate_response(
            result.response, 
            validations,
            result.tools_used
        )
        
        # Check expected tools were called
        if expected_tools:
            for tool in expected_tools:
                key = f'expected_tool_{tool}'
                tool_was_called = any(
                    tool.lower() in t.lower() 
                    for t in (result.tools_used or [])
                )
                result.validation_results[key] = tool_was_called
        
        # Determine pass/fail
        all_passed = all(result.validation_results.values())
        result.status = 'PASS' if all_passed else 'FAIL'
        
    except Exception as e:
        result.status = 'ERROR'
        result.error_message = str(e)
        result.duration_ms = (time.time() - start_time) * 1000
    
    return result


def run_test_parallel(args: tuple) -> TestResult:
    """Wrapper for parallel test execution."""
    test_case, agent_config, output_dir, use_cache = args
    return run_test(test_case, agent_config, output_dir, use_cache)


def print_result(result: TestResult, verbose: bool = False):
    """Print a single test result."""
    status_icon = {'PASS': '✅', 'FAIL': '❌', 'ERROR': '💥', 'SKIP': '⏭️'}.get(result.status, '?')
    cache_indicator = ' 📦' if result.cached else ''
    
    print(f"\n{status_icon} {result.name} ({result.duration_ms:.0f}ms){cache_indicator}")
    print(f"   Query: {result.query[:60]}...")
    
    if result.tools_used and not result.cached:
        # Dedupe and show tool count
        tool_counts = {}
        for t in result.tools_used:
            tool_counts[t] = tool_counts.get(t, 0) + 1
        tools_str = ', '.join(f"{t}({c})" if c > 1 else t for t, c in tool_counts.items())
        print(f"   Tools: {tools_str}")
    
    if result.status == 'FAIL':
        failed = [k for k, v in result.validation_results.items() if not v]
        print(f"   Failed checks: {', '.join(failed)}")
    
    if result.status == 'ERROR':
        print(f"   Error: {result.error_message[:100]}")
    
    if verbose and result.validation_results:
        print("   Validations:")
        for check, passed in result.validation_results.items():
            icon = '✓' if passed else '✗'
            print(f"      {icon} {check}")


def generate_html_report(report: TestReport, output_file: Path):
    """Generate an HTML report."""
    html = f"""<!DOCTYPE html>
<html>
<head>
    <title>SnowGram Agent Test Report</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; }}
        h1 {{ color: #29B5E8; }}
        .summary {{ background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }}
        .summary-grid {{ display: grid; grid-template-columns: repeat(5, 1fr); gap: 20px; }}
        .metric {{ text-align: center; }}
        .metric-value {{ font-size: 2em; font-weight: bold; }}
        .metric-label {{ color: #666; }}
        .pass {{ color: #22c55e; }}
        .fail {{ color: #ef4444; }}
        .error {{ color: #f59e0b; }}
        .skip {{ color: #9ca3af; }}
        table {{ width: 100%; border-collapse: collapse; margin: 20px 0; }}
        th, td {{ padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }}
        th {{ background: #29B5E8; color: white; }}
        tr:hover {{ background: #f5f5f5; }}
        .status-pass {{ background: #dcfce7; }}
        .status-fail {{ background: #fee2e2; }}
        .status-error {{ background: #fef3c7; }}
        .status-skip {{ background: #f3f4f6; }}
        .tools {{ font-size: 0.85em; color: #666; }}
        .validations {{ font-size: 0.85em; }}
        .check-pass {{ color: #22c55e; }}
        .check-fail {{ color: #ef4444; }}
        .cached {{ font-style: italic; opacity: 0.7; }}
    </style>
</head>
<body>
    <h1>🏔️ SnowGram Agent Test Report</h1>
    
    <div class="summary">
        <div class="summary-grid">
            <div class="metric">
                <div class="metric-value">{report.total}</div>
                <div class="metric-label">Total</div>
            </div>
            <div class="metric">
                <div class="metric-value pass">{report.passed}</div>
                <div class="metric-label">Passed</div>
            </div>
            <div class="metric">
                <div class="metric-value fail">{report.failed}</div>
                <div class="metric-label">Failed</div>
            </div>
            <div class="metric">
                <div class="metric-value error">{report.errors}</div>
                <div class="metric-label">Errors</div>
            </div>
            <div class="metric">
                <div class="metric-value">{report.duration_ms/1000:.1f}s</div>
                <div class="metric-label">Duration</div>
            </div>
        </div>
    </div>
    
    <p><strong>Suite:</strong> {report.suite_name}<br>
    <strong>Timestamp:</strong> {report.timestamp}</p>
    
    <table>
        <thead>
            <tr>
                <th>Status</th>
                <th>Test</th>
                <th>Duration</th>
                <th>Tools</th>
                <th>Validations</th>
            </tr>
        </thead>
        <tbody>
"""
    
    for result in report.results:
        status_class = f"status-{result.status.lower()}"
        status_icon = {'PASS': '✅', 'FAIL': '❌', 'ERROR': '💥', 'SKIP': '⏭️'}.get(result.status)
        cached_class = ' cached' if result.cached else ''
        
        tools_html = ', '.join(result.tools_used[:5]) if result.tools_used else '-'
        if len(result.tools_used) > 5:
            tools_html += f' (+{len(result.tools_used) - 5} more)'
        
        validations_html = ''
        for check, passed in result.validation_results.items():
            icon = '✓' if passed else '✗'
            cls = 'check-pass' if passed else 'check-fail'
            validations_html += f'<span class="{cls}">{icon} {check}</span><br>'
        
        if result.error_message:
            validations_html = f'<span class="check-fail">{result.error_message[:50]}...</span>'
        
        html += f"""
            <tr class="{status_class}{cached_class}">
                <td>{status_icon} {result.status}</td>
                <td><strong>{result.name}</strong><br><small>{result.query[:50]}...</small></td>
                <td>{result.duration_ms:.0f}ms{'📦' if result.cached else ''}</td>
                <td class="tools">{tools_html}</td>
                <td class="validations">{validations_html}</td>
            </tr>
"""
    
    html += """
        </tbody>
    </table>
</body>
</html>
"""
    
    with open(output_file, 'w') as f:
        f.write(html)
    
    print(f"\n📊 HTML report saved to: {output_file}")


def get_failed_tests(results_dir: Path) -> List[str]:
    """Get list of failed test names from most recent run."""
    if not results_dir.exists():
        return []
    
    result_dirs = sorted([d for d in results_dir.iterdir() if d.is_dir()], reverse=True)
    
    for result_dir in result_dirs[:1]:
        report_file = result_dir / 'report.json'
        if report_file.exists():
            with open(report_file) as f:
                report = json.load(f)
            return [r['name'] for r in report.get('results', []) if r['status'] in ('FAIL', 'ERROR')]
    
    return []


def main():
    parser = argparse.ArgumentParser(
        description='SnowGram Agent Test Harness (Optimized)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_tests.py                      # Run smoke tests (~2 min)
  python run_tests.py --all                # Run all tests (~13 min)
  python run_tests.py -c flowstage         # Run flowstage tests only
  python run_tests.py --cached             # Validate against cached responses
  python run_tests.py --failed             # Re-run only failed tests
  python run_tests.py -t medallion         # Run tests matching 'medallion'
  python run_tests.py --parallel 2         # Run 2 tests concurrently

Categories: smoke, core, flowstage, tools, e2e, layout, validation
        """
    )
    parser.add_argument('--test', '-t', help='Run only tests matching this pattern')
    parser.add_argument('--category', '-c', choices=list(CATEGORIES.keys()), 
                        help='Run tests from a specific category')
    parser.add_argument('--all', '-a', action='store_true', help='Run all tests')
    parser.add_argument('--cached', action='store_true', 
                        help='Use cached responses (instant validation testing)')
    parser.add_argument('--failed', '-f', action='store_true', 
                        help='Re-run only tests that failed in last run')
    parser.add_argument('--parallel', '-p', type=int, default=1, 
                        help='Number of tests to run in parallel')
    parser.add_argument('--verbose', '-v', action='store_true', help='Show detailed output')
    parser.add_argument('--report', '-r', action='store_true', help='Generate HTML report')
    parser.add_argument('--config', default='test_cases.yaml', help='Test cases config file')
    parser.add_argument('--output', '-o', default='results', help='Output directory')
    parser.add_argument('--list', '-l', action='store_true', help='List available tests and exit')
    args = parser.parse_args()
    
    # Load test cases
    config_path = Path(__file__).parent / args.config
    if not config_path.exists():
        print(f"Error: Config file not found: {config_path}")
        sys.exit(1)
    
    with open(config_path) as f:
        config = yaml.safe_load(f)
    
    suite_config = config['test_suite']
    all_test_cases = config['test_cases']
    
    # List tests if requested
    if args.list:
        print("Available tests:")
        for t in all_test_cases:
            cat = next((c for c, tests in CATEGORIES.items() if t['name'] in tests), 'other')
            print(f"  [{cat:10}] {t['name']}: {t.get('description', t['query'][:50])}")
        print(f"\nCategories: {', '.join(CATEGORIES.keys())}")
        sys.exit(0)
    
    # Determine which tests to run
    test_cases = all_test_cases
    
    # Filter by category
    if args.category:
        category_tests = CATEGORIES.get(args.category, [])
        test_cases = [t for t in test_cases if t['name'] in category_tests]
    # Filter by pattern
    elif args.test:
        test_cases = [t for t in test_cases if args.test.lower() in t['name'].lower()]
    # Re-run failed only
    elif args.failed:
        results_dir = Path(__file__).parent / args.output
        failed_names = get_failed_tests(results_dir)
        if failed_names:
            test_cases = [t for t in test_cases if t['name'] in failed_names]
            print(f"Re-running {len(failed_names)} failed tests: {', '.join(failed_names)}")
        else:
            print("No failed tests to re-run!")
            sys.exit(0)
    # Default to smoke tests unless --all
    elif not args.all:
        smoke_tests = CATEGORIES.get('smoke', [])
        test_cases = [t for t in test_cases if t['name'] in smoke_tests]
    
    if not test_cases:
        print("No tests to run!")
        sys.exit(1)
    
    # Setup output directory
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_dir = Path(__file__).parent / args.output / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Initialize report
    report = TestReport(
        suite_name=suite_config['name'],
        timestamp=datetime.now().isoformat(),
        total=len(test_cases)
    )
    
    mode = "cached" if args.cached else ("parallel" if args.parallel > 1 else "sequential")
    print("=" * 70)
    print(f"🏔️  SnowGram Agent Test Harness")
    print(f"   Suite: {suite_config['name']}")
    print(f"   Tests: {len(test_cases)}")
    print(f"   Mode: {mode}")
    print(f"   Output: {output_dir}")
    print("=" * 70)
    
    start_time = time.time()
    
    # Run tests
    if args.parallel > 1 and not args.cached:
        # Parallel execution
        test_args = [(tc, suite_config['agent'], output_dir, args.cached) for tc in test_cases]
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.parallel) as executor:
            futures = {executor.submit(run_test_parallel, arg): arg[0]['name'] 
                      for arg in test_args}
            
            for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
                test_name = futures[future]
                print(f"\n[{i}/{len(test_cases)}] Completed: {test_name}")
                
                result = future.result()
                report.results.append(result)
                
                if result.status == 'PASS':
                    report.passed += 1
                elif result.status == 'FAIL':
                    report.failed += 1
                elif result.status == 'SKIP':
                    report.skipped += 1
                else:
                    report.errors += 1
                
                print_result(result, args.verbose)
    else:
        # Sequential execution
        for i, test_case in enumerate(test_cases, 1):
            print(f"\n[{i}/{len(test_cases)}] Running: {test_case['name']}...")
            
            result = run_test(test_case, suite_config['agent'], output_dir, args.cached)
            report.results.append(result)
            
            if result.status == 'PASS':
                report.passed += 1
            elif result.status == 'FAIL':
                report.failed += 1
            elif result.status == 'SKIP':
                report.skipped += 1
            else:
                report.errors += 1
            
            print_result(result, args.verbose)
    
    report.duration_ms = (time.time() - start_time) * 1000
    
    # Print summary
    print("\n" + "=" * 70)
    print("📋 SUMMARY")
    print("=" * 70)
    print(f"   Total:   {report.total}")
    print(f"   Passed:  {report.passed} ✅")
    print(f"   Failed:  {report.failed} ❌")
    print(f"   Errors:  {report.errors} 💥")
    if report.skipped > 0:
        print(f"   Skipped: {report.skipped} ⏭️")
    print(f"   Duration: {report.duration_ms/1000:.1f}s")
    print("=" * 70)
    
    # Generate report if requested
    if args.report:
        report_file = output_dir / 'report.html'
        generate_html_report(report, report_file)
    
    # Save JSON report
    report_json = output_dir / 'report.json'
    with open(report_json, 'w') as f:
        json.dump({
            'suite_name': report.suite_name,
            'timestamp': report.timestamp,
            'total': report.total,
            'passed': report.passed,
            'failed': report.failed,
            'errors': report.errors,
            'skipped': report.skipped,
            'duration_ms': report.duration_ms,
            'results': [
                {
                    'name': r.name,
                    'query': r.query,
                    'status': r.status,
                    'duration_ms': r.duration_ms,
                    'tools_used': r.tools_used,
                    'validations': r.validation_results,
                    'error': r.error_message,
                    'cached': r.cached
                }
                for r in report.results
            ]
        }, f, indent=2)
    print(f"\n📁 JSON report saved to: {report_json}")
    
    # Exit with appropriate code
    sys.exit(0 if report.failed == 0 and report.errors == 0 else 1)


if __name__ == '__main__':
    main()
