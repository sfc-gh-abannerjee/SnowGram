#!/usr/bin/env python3
"""
SnowGram Agent Test Harness

Run agent tests defined in test_cases.yaml and generate reports.

Usage:
    python run_tests.py                    # Run all tests
    python run_tests.py --test medallion   # Run tests matching 'medallion'
    python run_tests.py --quick            # Run first 3 tests only
    python run_tests.py --report           # Generate HTML report
"""

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import yaml

# Add parent paths for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

try:
    import snowflake.connector
    from snowflake.connector import DictCursor
except ImportError:
    print("Error: snowflake-connector-python required. Install with: pip install snowflake-connector-python")
    sys.exit(1)


@dataclass
class TestResult:
    """Result of a single test case."""
    name: str
    query: str
    status: str  # PASS, FAIL, ERROR
    duration_ms: float = 0.0
    response: str = ""
    tools_used: list = field(default_factory=list)
    validation_results: dict = field(default_factory=dict)
    error_message: str = ""


@dataclass
class TestReport:
    """Aggregated test report."""
    suite_name: str
    timestamp: str
    total: int = 0
    passed: int = 0
    failed: int = 0
    errors: int = 0
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


def call_agent(conn, agent_name: str, database: str, schema: str, query: str) -> dict:
    """Call a Cortex Agent and return the response."""
    import requests
    
    # Get connection details for REST API
    connections = load_config()
    conn_config = connections.get('se_demo', {})
    
    host = conn_config.get('host', conn_config.get('account', '') + '.snowflakecomputing.com')
    if not host.endswith('.snowflakecomputing.com'):
        host = host + '.snowflakecomputing.com'
    
    account_url = f"https://{host}"
    
    # Get session token from active connection
    cursor = conn.cursor()
    cursor.execute("SELECT SYSTEM$GET_SNOWFLAKE_PLATFORM_INFO()")
    
    # Use password-based auth for REST API
    password = conn_config.get('password')
    user = conn_config.get('user')
    
    # Create auth session
    auth_url = f"{account_url}/session/v1/login-request"
    auth_data = {
        "data": {
            "ACCOUNT_NAME": conn_config.get('account', '').split('.')[0],
            "LOGIN_NAME": user,
            "PASSWORD": password,
        }
    }
    
    auth_response = requests.post(auth_url, json=auth_data, headers={"Content-Type": "application/json"})
    
    if auth_response.status_code != 200:
        raise Exception(f"Auth failed: {auth_response.text}")
    
    auth_result = auth_response.json()
    token = auth_result.get('data', {}).get('token')
    
    if not token:
        raise Exception(f"No token in auth response: {auth_result}")
    
    # Call agent
    run_url = f"{account_url}/api/v2/databases/{database}/schemas/{schema}/agents/{agent_name}:run"
    
    headers = {
        'Authorization': f'Snowflake Token="{token}"',
        'Content-Type': 'application/json',
        'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
    }
    
    request_body = {
        "messages": [
            {
                "role": "user",
                "content": [{"type": "text", "text": query}]
            }
        ]
    }
    
    response = requests.post(run_url, json=request_body, headers=headers, stream=True)
    
    if response.status_code != 200:
        raise Exception(f"Agent call failed: {response.status_code} - {response.text[:500]}")
    
    # Parse streaming response
    full_response = ""
    tools_used = []
    
    for line in response.iter_lines():
        if line:
            line = line.decode('utf-8')
            if line.startswith('data:'):
                data = line[5:].strip()
                if data:
                    try:
                        event = json.loads(data)
                        if event.get('type') == 'content_block_delta':
                            delta = event.get('delta', {})
                            if delta.get('type') == 'text_delta':
                                full_response += delta.get('text', '')
                        elif event.get('type') == 'content_block_start':
                            block = event.get('content_block', {})
                            if block.get('type') == 'tool_use':
                                tools_used.append(block.get('name', 'unknown'))
                    except json.JSONDecodeError:
                        pass
    
    return {
        'response': full_response,
        'tools_used': tools_used
    }


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
    
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    
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
    
    return results


def run_test(test_case: dict, agent_config: dict, output_dir: Path) -> TestResult:
    """Run a single test case."""
    name = test_case['name']
    query = test_case['query']
    validations = test_case.get('validations', [])
    
    result = TestResult(name=name, query=query, status='ERROR')
    
    output_file = output_dir / f"{name}.json"
    
    start_time = time.time()
    
    try:
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
        
        # Determine pass/fail
        all_passed = all(result.validation_results.values())
        result.status = 'PASS' if all_passed else 'FAIL'
        
    except Exception as e:
        result.status = 'ERROR'
        result.error_message = str(e)
        result.duration_ms = (time.time() - start_time) * 1000
    
    return result


def print_result(result: TestResult, verbose: bool = False):
    """Print a single test result."""
    status_icon = {'PASS': '✅', 'FAIL': '❌', 'ERROR': '💥'}.get(result.status, '?')
    
    print(f"\n{status_icon} {result.name} ({result.duration_ms:.0f}ms)")
    print(f"   Query: {result.query[:60]}...")
    
    if result.tools_used:
        print(f"   Tools: {', '.join(result.tools_used)}")
    
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
        .summary-grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }}
        .metric {{ text-align: center; }}
        .metric-value {{ font-size: 2em; font-weight: bold; }}
        .metric-label {{ color: #666; }}
        .pass {{ color: #22c55e; }}
        .fail {{ color: #ef4444; }}
        .error {{ color: #f59e0b; }}
        table {{ width: 100%; border-collapse: collapse; margin: 20px 0; }}
        th, td {{ padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }}
        th {{ background: #29B5E8; color: white; }}
        tr:hover {{ background: #f5f5f5; }}
        .status-pass {{ background: #dcfce7; }}
        .status-fail {{ background: #fee2e2; }}
        .status-error {{ background: #fef3c7; }}
        .tools {{ font-size: 0.85em; color: #666; }}
        .validations {{ font-size: 0.85em; }}
        .check-pass {{ color: #22c55e; }}
        .check-fail {{ color: #ef4444; }}
    </style>
</head>
<body>
    <h1>🏔️ SnowGram Agent Test Report</h1>
    
    <div class="summary">
        <div class="summary-grid">
            <div class="metric">
                <div class="metric-value">{report.total}</div>
                <div class="metric-label">Total Tests</div>
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
        status_icon = {'PASS': '✅', 'FAIL': '❌', 'ERROR': '💥'}.get(result.status)
        
        tools_html = ', '.join(result.tools_used) if result.tools_used else '-'
        
        validations_html = ''
        for check, passed in result.validation_results.items():
            icon = '✓' if passed else '✗'
            cls = 'check-pass' if passed else 'check-fail'
            validations_html += f'<span class="{cls}">{icon} {check}</span><br>'
        
        if result.error_message:
            validations_html = f'<span class="check-fail">{result.error_message[:50]}...</span>'
        
        html += f"""
            <tr class="{status_class}">
                <td>{status_icon} {result.status}</td>
                <td><strong>{result.name}</strong><br><small>{result.query[:50]}...</small></td>
                <td>{result.duration_ms:.0f}ms</td>
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


def main():
    parser = argparse.ArgumentParser(description='SnowGram Agent Test Harness')
    parser.add_argument('--test', '-t', help='Run only tests matching this pattern')
    parser.add_argument('--quick', '-q', action='store_true', help='Run only first 3 tests')
    parser.add_argument('--verbose', '-v', action='store_true', help='Show detailed output')
    parser.add_argument('--report', '-r', action='store_true', help='Generate HTML report')
    parser.add_argument('--config', '-c', default='test_cases.yaml', help='Test cases config file')
    parser.add_argument('--output', '-o', default='results', help='Output directory')
    args = parser.parse_args()
    
    # Load test cases
    config_path = Path(__file__).parent / args.config
    if not config_path.exists():
        print(f"Error: Config file not found: {config_path}")
        sys.exit(1)
    
    with open(config_path) as f:
        config = yaml.safe_load(f)
    
    suite_config = config['test_suite']
    test_cases = config['test_cases']
    
    # Filter tests if pattern provided
    if args.test:
        test_cases = [t for t in test_cases if args.test.lower() in t['name'].lower()]
    
    # Limit tests if quick mode
    if args.quick:
        test_cases = test_cases[:3]
    
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
    
    print("=" * 70)
    print(f"🏔️  SnowGram Agent Test Harness")
    print(f"   Suite: {suite_config['name']}")
    print(f"   Tests: {len(test_cases)}")
    print(f"   Output: {output_dir}")
    print("=" * 70)
    
    start_time = time.time()
    
    # Run tests
    for i, test_case in enumerate(test_cases, 1):
        print(f"\n[{i}/{len(test_cases)}] Running: {test_case['name']}...")
        
        result = run_test(test_case, suite_config['agent'], output_dir)
        report.results.append(result)
        
        if result.status == 'PASS':
            report.passed += 1
        elif result.status == 'FAIL':
            report.failed += 1
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
            'duration_ms': report.duration_ms,
            'results': [
                {
                    'name': r.name,
                    'query': r.query,
                    'status': r.status,
                    'duration_ms': r.duration_ms,
                    'tools_used': r.tools_used,
                    'validations': r.validation_results,
                    'error': r.error_message
                }
                for r in report.results
            ]
        }, f, indent=2)
    print(f"\n📁 JSON report saved to: {report_json}")
    
    # Exit with appropriate code
    sys.exit(0 if report.failed == 0 and report.errors == 0 else 1)


if __name__ == '__main__':
    main()
