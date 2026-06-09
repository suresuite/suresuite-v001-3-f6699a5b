#!/usr/bin/env python3
"""
Main test runner for the simulation service.
Run this script to execute all tests and validate the service functionality.
"""

import sys
import asyncio
import subprocess
from pathlib import Path

def run_pytest():
    """Run pytest for unit tests"""
    print("🧪 Running unit tests with pytest...")
    
    try:
        result = subprocess.run([
            sys.executable, "-m", "pytest", 
            "app/tests/", 
            "-v", 
            "--tb=short",
            "--disable-warnings"
        ], capture_output=True, text=True)
        
        print(result.stdout)
        if result.stderr:
            print("Errors:")
            print(result.stderr)
        
        return result.returncode == 0
    except Exception as e:
        print(f"❌ Failed to run pytest: {e}")
        return False

async def run_integration_tests():
    """Run integration tests"""
    print("\n🔗 Running integration tests...")
    
    try:
        # Import and run the test script
        from scripts.test_simulation import SimulationTester
        
        tester = SimulationTester()
        results = await tester.run_comprehensive_test()
        
        passed = sum(1 for result in results.values() if result)
        total = len(results)
        
        print(f"\nIntegration test results: {passed}/{total} passed")
        return passed == total
        
    except Exception as e:
        print(f"❌ Integration tests failed: {e}")
        return False

async def run_performance_benchmarks():
    """Run performance benchmarks"""
    print("\n⚡ Running performance benchmarks...")
    
    try:
        from benchmarks.performance_test import PerformanceBenchmark
        
        benchmark = PerformanceBenchmark()
        
        # Run a quick benchmark
        result = await benchmark.benchmark_concurrent_simulations(5)
        
        print(f"Benchmark completed:")
        print(f"  Success rate: {result.success_rate:.1%}")
        print(f"  Avg response time: {result.average_response_time:.3f}s")
        print(f"  Throughput: {result.throughput_rps:.2f} RPS")
        
        return result.success_rate > 0.8
        
    except Exception as e:
        print(f"❌ Performance benchmarks failed: {e}")
        return False

def validate_service_structure():
    """Validate that all required files exist"""
    print("📁 Validating service structure...")
    
    required_files = [
        "app/__init__.py",
        "app/main.py",
        "app/config.py",
        "app/models/request_models.py",
        "app/models/response_models.py", 
        "app/models/data_models.py",
        "app/services/simulation_engine.py",
        "app/services/job_manager.py",
        "app/services/database_service.py",
        "app/services/cache_manager.py",
        "app/utils/logging_config.py",
        "app/utils/monitoring.py",
        "requirements.txt",
        "Dockerfile",
        "docker-compose.yml"
    ]
    
    missing_files = []
    
    for file_path in required_files:
        if not Path(file_path).exists():
            missing_files.append(file_path)
    
    if missing_files:
        print(f"❌ Missing files: {', '.join(missing_files)}")
        return False
    else:
        print("✅ All required files present")
        return True

async def main():
    """Main test runner"""
    print("🚀 Running comprehensive validation for Simulation Service")
    print("=" * 60)
    
    test_results = {}
    
    # 1. Validate structure
    test_results["Structure"] = validate_service_structure()
    
    # 2. Run unit tests
    test_results["Unit Tests"] = run_pytest()
    
    # 3. Run integration tests (only if structure is valid)
    if test_results["Structure"]:
        test_results["Integration Tests"] = await run_integration_tests()
    else:
        test_results["Integration Tests"] = False
        print("⚠️ Skipping integration tests due to structural issues")
    
    # 4. Run performance benchmarks (only if other tests pass)
    if all([test_results["Structure"], test_results["Unit Tests"]]):
        test_results["Performance"] = await run_performance_benchmarks()
    else:
        test_results["Performance"] = False
        print("⚠️ Skipping performance tests due to previous failures")
    
    # Generate summary
    print("\n" + "=" * 60)
    print("📊 VALIDATION SUMMARY")
    print("=" * 60)
    
    passed_tests = sum(1 for result in test_results.values() if result)
    total_tests = len(test_results)
    
    for test_name, result in test_results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name:<20} {status}")
    
    print("-" * 60)
    print(f"Overall: {passed_tests}/{total_tests} tests passed ({(passed_tests/total_tests)*100:.1f}%)")
    
    if passed_tests == total_tests:
        print("\n🎉 ALL VALIDATIONS PASSED! Service is ready for deployment.")
        return 0
    else:
        print(f"\n⚠️ {total_tests - passed_tests} validations failed. Please review and fix issues.")
        return 1

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)