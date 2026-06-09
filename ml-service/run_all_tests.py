#!/usr/bin/env python3
"""
Master Test Runner for ML Simulation Service
Runs all test suites in sequence: unit tests, API tests, integration tests, and Supabase tests.
"""

import subprocess
import sys
import time
import asyncio
from pathlib import Path
from typing import Dict, List, Any, Optional

# Import integration tests for direct execution
try:
    from test_integration_comprehensive import run_integration_tests
    from test_config import get_test_config, validate_test_config, print_test_config
    INTEGRATION_AVAILABLE = True
except ImportError:
    INTEGRATION_AVAILABLE = False

def run_command(command: str, description: str) -> bool:
    """Run a command and return success status"""
    print(f"\n🚀 {description}")
    print("-" * 60)
    
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=Path(__file__).parent
        )
        
        if result.returncode == 0:
            print(result.stdout)
            print(f"✅ {description} - PASSED")
            return True
        else:
            print(f"❌ {description} - FAILED")
            print("STDOUT:", result.stdout)
            print("STDERR:", result.stderr)
            return False
            
    except Exception as e:
        print(f"❌ {description} - ERROR: {e}")
        return False

async def run_integration_tests_direct() -> Dict[str, Any]:
    """Run integration tests directly using imported module"""
    try:
        if not INTEGRATION_AVAILABLE:
            print("⚠️  Integration test module not available, falling back to subprocess")
            return {"success": False, "error": "Module import failed"}
        
        print("\n🚀 ML Service Integration Tests (Direct)")
        print("-" * 60)
        
        # Run integration tests with quiet mode for orchestrator use
        results = await run_integration_tests(verbose=True)
        
        if results["success"]:
            print(f"✅ ML Service Integration Tests - PASSED ({results['passed_tests']}/{results['total_tests']})")
        else:
            print(f"❌ ML Service Integration Tests - FAILED ({results['passed_tests']}/{results['total_tests']})")
            
        return results
        
    except Exception as e:
        print(f"❌ ML Service Integration Tests - ERROR: {e}")
        return {"success": False, "error": str(e)}

def check_service_health() -> bool:
    """Check if the ML service is running"""
    try:
        import requests
        response = requests.get("http://localhost:8000/health", timeout=5)
        return response.status_code == 200
    except:
        return False

async def main():
    """Run all test suites"""
    print("ML SIMULATION SERVICE - COMPREHENSIVE TEST SUITE")
    print("=" * 80)
    print(f"Started at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)
    
    results = []
    
    # Check if service is running
    print("\nChecking ML Service Status...")
    if check_service_health():
        print("✅ ML Service is running and healthy")
        service_running = True
    else:
        print("❌ ML Service is not running or not healthy")
        print("   Some tests may fail. Start the service with: python -m uvicorn app.main:app --host 0.0.0.0 --port 8000")
        service_running = False
    
    # Test Suite 1: Unit Tests
    print("\n" + "=" * 80)
    print("PHASE 1: UNIT TESTS")
    print("=" * 80)
    
    unit_tests = [
        ("python -m pytest app/tests/test_inference.py -v", "ML Model Unit Tests"),
        ("python -m pytest app/tests/test_job_manager.py -v", "Job Manager Unit Tests"),
        ("python -m pytest app/tests/test_simulation_engine.py -v", "Simulation Engine Unit Tests"),
    ]
    
    for command, description in unit_tests:
        success = run_command(command, description)
        results.append((description, success))
    
    # Test Suite 2: API Tests (only if service is running)
    if service_running:
        print("\n" + "=" * 80)
        print("PHASE 2: API TESTS")
        print("=" * 80)
        
        api_tests = [
            ("python test_simulation_comprehensive.py", "Comprehensive API Tests"),
        ]
        
        for command, description in api_tests:
            success = run_command(command, description)
            results.append((description, success))
    else:
        print("\n⏭️  Skipping API tests - service not running")
        results.append(("API Tests", False))
    
    # Test Suite 3: Integration Tests (only if service is running)
    if service_running:
        print("\n" + "=" * 80)
        print("PHASE 3: INTEGRATION TESTS")
        print("=" * 80)
        
        # Try direct integration first, fallback to subprocess
        if INTEGRATION_AVAILABLE:
            integration_results = await run_integration_tests_direct()
            success = integration_results.get("success", False)
            results.append(("ML Service Integration Tests (Direct)", success))
        else:
            # Fallback to subprocess
            integration_tests = [
                ("python test_integration_comprehensive.py --quiet", "ML Service Integration Tests"),
            ]
            
            for command, description in integration_tests:
                success = run_command(command, description)
                results.append((description, success))
    else:
        print("\n⏭️  Skipping integration tests - service not running")
        results.append(("Integration Tests", False))
    
    # Test Suite 4: Supabase Tests
    print("\n" + "=" * 80)
    print("PHASE 4: DATABASE INTEGRATION TESTS")
    print("=" * 80)
    
    db_tests = [
        ("python test_supabase_integration.py", "Supabase Integration Tests"),
    ]
    
    for command, description in db_tests:
        success = run_command(command, description)
        results.append((description, success))
    
    # Final Results
    print("\n" + "=" * 80)
    print("COMPREHENSIVE TEST RESULTS")
    print("=" * 80)
    
    total_tests = len(results)
    passed_tests = sum(1 for _, success in results if success)
    
    print(f"Overall Results: {passed_tests}/{total_tests} test suites passed")
    print(f"Completed at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # Detailed results
    for test_name, success in results:
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{test_name:35} : {status}")
    
    print("\n" + "=" * 80)
    
    if passed_tests == total_tests:
        print("ALL TEST SUITES PASSED!")
        print("   Your ML Simulation Service is fully functional and ready for production.")
        exit_code = 0
    else:
        failed_tests = total_tests - passed_tests
        print(f"{failed_tests} test suite(s) failed.")
        print("   Review the detailed output above to identify and fix issues.")
        
        if not service_running:
            print("\nQuick Fix: Start the ML service to enable API and integration tests:")
            print("   cd ml-service")
            print("   python -m uvicorn app.main:app --host 0.0.0.0 --port 8000")
        
        exit_code = 1
    
    print("=" * 80)
    
    # Exit with appropriate code
    sys.exit(exit_code)

if __name__ == "__main__":
    asyncio.run(main())

# This duplicate code has been removed