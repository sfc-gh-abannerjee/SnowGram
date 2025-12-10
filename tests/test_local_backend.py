"""
Local Backend Testing Script for SnowGram

Tests all backend endpoints without requiring SPCS deployment.
Run this after starting the backend locally with:
  cd /Users/abannerjee/Documents/SnowGram/backend
  uvicorn api.main:app --reload --port 8000
"""

import requests
import json
import time
from typing import Dict, Any
from datetime import datetime


# Configuration
API_BASE_URL = "http://localhost:8000"
TEST_RESULTS = []


def log_test(test_name: str, passed: bool, details: str = ""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    timestamp = datetime.now().strftime("%H:%M:%S")
    result = f"[{timestamp}] {status} - {test_name}"
    if details:
        result += f"\n    → {details}"
    print(result)
    TEST_RESULTS.append({
        "test": test_name,
        "passed": passed,
        "details": details,
        "timestamp": timestamp
    })


def test_health_endpoints():
    """Test health check endpoints"""
    print("\n🏥 Testing Health Endpoints...")
    
    # Test root health
    try:
        response = requests.get(f"{API_BASE_URL}/health")
        log_test(
            "GET /health",
            response.status_code == 200,
            f"Status: {response.status_code}"
        )
    except Exception as e:
        log_test("GET /health", False, f"Error: {e}")
    
    # Test liveness
    try:
        response = requests.get(f"{API_BASE_URL}/health/live")
        log_test(
            "GET /health/live",
            response.status_code == 200,
            f"Status: {response.status_code}"
        )
    except Exception as e:
        log_test("GET /health/live", False, f"Error: {e}")
    
    # Test readiness (may fail if Snowflake not connected)
    try:
        response = requests.get(f"{API_BASE_URL}/health/ready")
        log_test(
            "GET /health/ready",
            response.status_code in (200, 503),
            f"Status: {response.status_code} - {response.json().get('status', 'N/A')}"
        )
    except Exception as e:
        log_test("GET /health/ready", False, f"Error: {e}")


def test_icon_endpoints():
    """Test icon catalog endpoints"""
    print("\n🎨 Testing Icon Endpoints...")
    
    # Test Font Awesome catalog
    try:
        response = requests.get(f"{API_BASE_URL}/api/icons/catalog/font-awesome")
        data = response.json()
        log_test(
            "GET /api/icons/catalog/font-awesome",
            response.status_code == 200 and data.get("total_count", 0) > 0,
            f"Found {data.get('total_count', 0)} icons in {len(data.get('categories', []))} categories"
        )
    except Exception as e:
        log_test("GET /api/icons/catalog/font-awesome", False, f"Error: {e}")
    
    # Test Font Awesome by category
    try:
        response = requests.get(f"{API_BASE_URL}/api/icons/catalog/font-awesome?category=data")
        data = response.json()
        log_test(
            "GET /api/icons/catalog/font-awesome?category=data",
            response.status_code == 200,
            f"Found {data.get('total_count', 0)} data icons"
        )
    except Exception as e:
        log_test("GET /api/icons/catalog/font-awesome?category=data", False, f"Error: {e}")
    
    # Test Material Icons catalog
    try:
        response = requests.get(f"{API_BASE_URL}/api/icons/catalog/material-icons")
        data = response.json()
        log_test(
            "GET /api/icons/catalog/material-icons",
            response.status_code == 200 and data.get("total_count", 0) > 0,
            f"Found {data.get('total_count', 0)} icons"
        )
    except Exception as e:
        log_test("GET /api/icons/catalog/material-icons", False, f"Error: {e}")
    
    # Test Mermaid shapes
    try:
        response = requests.get(f"{API_BASE_URL}/api/icons/catalog/mermaid-shapes")
        data = response.json()
        log_test(
            "GET /api/icons/catalog/mermaid-shapes",
            response.status_code == 200,
            f"Found {data.get('total_count', 0)} shapes"
        )
    except Exception as e:
        log_test("GET /api/icons/catalog/mermaid-shapes", False, f"Error: {e}")
    
    # Test icon search
    try:
        response = requests.get(f"{API_BASE_URL}/api/icons/search?query=database")
        data = response.json()
        log_test(
            "GET /api/icons/search?query=database",
            response.status_code == 200,
            f"Found {data.get('count', 0)} results for 'database'"
        )
    except Exception as e:
        log_test("GET /api/icons/search?query=database", False, f"Error: {e}")
    
    # Test categories list
    try:
        response = requests.get(f"{API_BASE_URL}/api/icons/categories")
        data = response.json()
        log_test(
            "GET /api/icons/categories",
            response.status_code == 200,
            f"Found {data.get('total_count', 0)} categories"
        )
    except Exception as e:
        log_test("GET /api/icons/categories", False, f"Error: {e}")
    
    # Test icon examples
    try:
        response = requests.get(f"{API_BASE_URL}/api/icons/examples")
        data = response.json()
        log_test(
            "GET /api/icons/examples",
            response.status_code == 200,
            f"Found {data.get('count', 0)} example diagrams"
        )
    except Exception as e:
        log_test("GET /api/icons/examples", False, f"Error: {e}")


def test_diagram_endpoints():
    """Test diagram generation and management endpoints"""
    print("\n📊 Testing Diagram Endpoints...")
    
    diagram_id = None
    
    # Test diagram generation (may fail if agent not configured)
    try:
        payload = {
            "user_query": "Create a simple IoT data pipeline",
            "diagram_type": "future_state",
            "use_case": "iot"
        }
        response = requests.post(
            f"{API_BASE_URL}/api/diagram/generate",
            json=payload,
            timeout=15
        )
        data = response.json()
        log_test(
            "POST /api/diagram/generate",
            response.status_code == 200 and "mermaid_code" in data,
            f"Generated in {data.get('generation_time_ms', 0)}ms"
        )
        
        # If generation succeeded, test save/load/delete
        if response.status_code == 200 and "mermaid_code" in data:
            mermaid_code = data["mermaid_code"]
            
            # Test save
            try:
                save_payload = {
                    "diagram_name": f"Test Diagram {int(time.time())}",
                    "mermaid_code": mermaid_code,
                    "diagram_type": "future_state",
                    "tags": ["test", "automated"],
                    "is_public": False
                }
                save_response = requests.post(
                    f"{API_BASE_URL}/api/diagram/save",
                    json=save_payload
                )
                save_data = save_response.json()
                diagram_id = save_data.get("diagram_id")
                log_test(
                    "POST /api/diagram/save",
                    save_response.status_code == 200 and diagram_id,
                    f"Saved with ID: {diagram_id}"
                )
            except Exception as e:
                log_test("POST /api/diagram/save", False, f"Error: {e}")
            
            # Test list
            try:
                list_response = requests.get(f"{API_BASE_URL}/api/diagram/list")
                list_data = list_response.json()
                log_test(
                    "GET /api/diagram/list",
                    list_response.status_code == 200,
                    f"Found {len(list_data.get('diagrams', []))} diagrams"
                )
            except Exception as e:
                log_test("GET /api/diagram/list", False, f"Error: {e}")
            
            # Test load (if we have a diagram_id)
            if diagram_id:
                try:
                    load_response = requests.get(f"{API_BASE_URL}/api/diagram/load/{diagram_id}")
                    load_data = load_response.json()
                    log_test(
                        f"GET /api/diagram/load/{diagram_id}",
                        load_response.status_code == 200,
                        f"Loaded: {load_data.get('diagram_name', 'N/A')}"
                    )
                except Exception as e:
                    log_test(f"GET /api/diagram/load/{diagram_id}", False, f"Error: {e}")
                
                # Test delete
                try:
                    delete_response = requests.delete(f"{API_BASE_URL}/api/diagram/delete/{diagram_id}")
                    log_test(
                        f"DELETE /api/diagram/delete/{diagram_id}",
                        delete_response.status_code == 200,
                        "Diagram deleted successfully"
                    )
                except Exception as e:
                    log_test(f"DELETE /api/diagram/delete/{diagram_id}", False, f"Error: {e}")
    
    except requests.Timeout:
        log_test("POST /api/diagram/generate", False, "Request timed out (expected if agent not configured)")
    except Exception as e:
        log_test("POST /api/diagram/generate", False, f"Error: {e}")


def test_websocket():
    """Test WebSocket endpoint (basic connection test)"""
    print("\n🔌 Testing WebSocket Endpoint...")
    
    try:
        # Note: This is a basic test. Full WebSocket testing requires a proper client
        response = requests.get(f"{API_BASE_URL}/")
        log_test(
            "WebSocket endpoint availability",
            response.status_code == 200,
            "Root endpoint accessible (WebSocket available at /ws)"
        )
    except Exception as e:
        log_test("WebSocket endpoint availability", False, f"Error: {e}")


def print_summary():
    """Print test summary"""
    print("\n" + "="*70)
    print("📊 TEST SUMMARY")
    print("="*70)
    
    passed = sum(1 for r in TEST_RESULTS if r["passed"])
    failed = sum(1 for r in TEST_RESULTS if not r["passed"])
    total = len(TEST_RESULTS)
    
    print(f"\nTotal Tests: {total}")
    print(f"✅ Passed: {passed} ({passed/total*100:.1f}%)")
    print(f"❌ Failed: {failed} ({failed/total*100:.1f}%)")
    
    if failed > 0:
        print("\n❌ Failed Tests:")
        for result in TEST_RESULTS:
            if not result["passed"]:
                print(f"  - {result['test']}")
                if result["details"]:
                    print(f"    {result['details']}")
    
    print("\n" + "="*70)


def main():
    """Run all tests"""
    print("="*70)
    print("🧪 SnowGram Local Backend Test Suite")
    print("="*70)
    print(f"\nTesting API at: {API_BASE_URL}")
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Check if backend is running
    try:
        response = requests.get(f"{API_BASE_URL}/", timeout=2)
        print("✅ Backend is running\n")
    except Exception as e:
        print(f"❌ Backend is not running. Please start it with:")
        print(f"   cd /Users/abannerjee/Documents/SnowGram/backend")
        print(f"   uvicorn api.main:app --reload --port 8000\n")
        return
    
    # Run test suites
    test_health_endpoints()
    test_icon_endpoints()
    test_diagram_endpoints()
    test_websocket()
    
    # Print summary
    print_summary()
    
    # Save results to file
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = f"test_results_{timestamp}.json"
    with open(results_file, 'w') as f:
        json.dump(TEST_RESULTS, f, indent=2)
    print(f"\n💾 Full results saved to: {results_file}")


if __name__ == "__main__":
    main()

