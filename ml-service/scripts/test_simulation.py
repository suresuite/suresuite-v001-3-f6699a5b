#!/usr/bin/env python3
"""
Test script for the simulation service.
This script provides comprehensive testing capabilities for the simulation service.
"""

import asyncio
import httpx
import json
import time
import sys
from typing import Dict, Any, List
from pathlib import Path

# Add the parent directory to the path so we can import from app
sys.path.append(str(Path(__file__).parent.parent))

from examples.control_templates import SimulationTemplates, SimulationType

class SimulationTester:
    def __init__(self, service_url: str = "http://localhost:8000", api_key: str = "test-key"):
        self.service_url = service_url
        self.api_key = api_key
        self.headers = {
            "X-API-Key": api_key,
            "Content-Type": "application/json"
        }
        self.test_results = []
    
    async def test_service_health(self) -> bool:
        """Test if the service is healthy and responding"""
        print("🔍 Testing service health...")
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.service_url}/health")
                
                if response.status_code == 200:
                    health_data = response.json()
                    print(f"✅ Service is healthy: {health_data}")
                    return True
                else:
                    print(f"❌ Service health check failed: {response.status_code}")
                    return False
        except Exception as e:
            print(f"❌ Failed to connect to service: {e}")
            return False
    
    async def test_basic_simulation(self) -> bool:
        """Test basic simulation functionality"""
        print("\n🧪 Testing basic simulation...")
        
        request = {
            "project_id": "test-project-basic",
            "scenario_ids": ["test-scenario-1"],
            "simulation_parameters": {
                "simulation_horizon_days": 7,
                "monte_carlo_runs": 10,
                "kpi_definitions": ["fill_rate", "revenue"]
            },
            "job_type": "baseline_scenario",
            "priority": "normal"
        }
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Submit job
                response = await client.post(
                    f"{self.service_url}/simulation/submit",
                    headers=self.headers,
                    json=request
                )
                
                if response.status_code != 200:
                    print(f"❌ Failed to submit job: {response.text}")
                    return False
                
                job_data = response.json()
                job_id = job_data["job_id"]
                print(f"✅ Job submitted: {job_id}")
                
                # Monitor job
                for _ in range(30):  # Wait up to 60 seconds
                    status_response = await client.get(
                        f"{self.service_url}/simulation/status/{job_id}",
                        headers=self.headers
                    )
                    
                    if status_response.status_code == 200:
                        status_data = status_response.json()
                        print(f"  Status: {status_data['status']} ({status_data.get('progress', 0)}%)")
                        
                        if status_data["status"] == "completed":
                            print("✅ Basic simulation test passed!")
                            return True
                        elif status_data["status"] == "failed":
                            print(f"❌ Simulation failed: {status_data.get('error_message')}")
                            return False
                    
                    await asyncio.sleep(2)
                
                print("❌ Simulation timed out")
                return False
                
        except Exception as e:
            print(f"❌ Basic simulation test failed: {e}")
            return False
    
    async def test_batch_simulation(self) -> bool:
        """Test batch simulation functionality"""
        print("\n🔄 Testing batch simulation...")
        
        batch_request = {
            "project_id": "test-project-batch",
            "scenarios": [
                {
                    "scenario_id": "batch-scenario-1",
                    "scenario_name": "Test Scenario 1",
                    "description": "First test scenario",
                    "effects": [
                        {
                            "effect_type": "capacity_reduction",
                            "magnitude": 20,
                            "unit": "percent"
                        }
                    ]
                },
                {
                    "scenario_id": "batch-scenario-2",
                    "scenario_name": "Test Scenario 2", 
                    "description": "Second test scenario",
                    "effects": [
                        {
                            "effect_type": "time_delay",
                            "magnitude": 2,
                            "unit": "days"
                        }
                    ]
                }
            ],
            "simulation_parameters": {
                "simulation_horizon_days": 7,
                "monte_carlo_runs": 5
            }
        }
        
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.service_url}/simulation/batch",
                    headers=self.headers,
                    json=batch_request
                )
                
                if response.status_code == 200:
                    batch_data = response.json()
                    print(f"✅ Batch simulation submitted: {batch_data.get('batch_id')}")
                    print(f"  Total jobs: {batch_data.get('total_jobs')}")
                    return True
                else:
                    print(f"❌ Batch simulation failed: {response.text}")
                    return False
                    
        except Exception as e:
            print(f"❌ Batch simulation test failed: {e}")
            return False
    
    async def test_template_simulation(self) -> bool:
        """Test simulation using predefined templates"""
        print("\n📋 Testing template-based simulation...")
        
        try:
            # Get resilience template
            template = SimulationTemplates.supply_chain_resilience()
            
            # Create a simplified version for testing
            test_request = {
                "project_id": "test-project-template",
                "template_name": template.name,
                "simulation_parameters": {
                    "simulation_horizon_days": 7,
                    "monte_carlo_runs": 5,
                    "volatility_factor": 0.1
                },
                "scenarios": template.scenarios[:1],  # Just use first scenario
                "expected_kpis": template.expected_kpis[:3]  # First 3 KPIs
            }
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.service_url}/simulation/template",
                    headers=self.headers,
                    json=test_request
                )
                
                if response.status_code == 200:
                    print("✅ Template simulation test passed!")
                    return True
                else:
                    print(f"❌ Template simulation failed: {response.text}")
                    return False
                    
        except Exception as e:
            print(f"❌ Template simulation test failed: {e}")
            return False
    
    async def test_performance(self) -> Dict[str, float]:
        """Test performance with concurrent simulations"""
        print("\n⚡ Testing performance...")
        
        num_concurrent = 3
        start_time = time.time()
        
        async def run_perf_simulation(sim_id: int):
            request = {
                "project_id": f"perf-test-{sim_id}",
                "scenario_ids": [f"perf-scenario-{sim_id}"],
                "simulation_parameters": {
                    "simulation_horizon_days": 5,
                    "monte_carlo_runs": 5
                }
            }
            
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    f"{self.service_url}/simulation/submit",
                    headers=self.headers,
                    json=request
                )
                return response.status_code == 200
        
        # Run concurrent simulations
        tasks = [run_perf_simulation(i) for i in range(num_concurrent)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        end_time = time.time()
        duration = end_time - start_time
        
        successful = sum(1 for r in results if r is True)
        
        performance_metrics = {
            "total_simulations": num_concurrent,
            "successful_simulations": successful,
            "total_time_seconds": duration,
            "avg_time_per_simulation": duration / num_concurrent,
            "success_rate": successful / num_concurrent
        }
        
        print(f"📊 Performance Results:")
        for key, value in performance_metrics.items():
            print(f"  {key}: {value}")
        
        return performance_metrics
    
    async def test_error_handling(self) -> bool:
        """Test error handling with invalid requests"""
        print("\n❌ Testing error handling...")
        
        test_cases = [
            {
                "name": "Missing project_id",
                "request": {
                    "scenario_ids": ["test"],
                    "simulation_parameters": {}
                },
                "expected_status": 400
            },
            {
                "name": "Invalid simulation parameters",
                "request": {
                    "project_id": "test",
                    "scenario_ids": ["test"],
                    "simulation_parameters": {
                        "simulation_horizon_days": -1,
                        "monte_carlo_runs": 0
                    }
                },
                "expected_status": 400
            }
        ]
        
        passed_tests = 0
        
        async with httpx.AsyncClient() as client:
            for test_case in test_cases:
                try:
                    response = await client.post(
                        f"{self.service_url}/simulation/submit",
                        headers=self.headers,
                        json=test_case["request"]
                    )
                    
                    if response.status_code == test_case["expected_status"]:
                        print(f"  ✅ {test_case['name']}: Correctly returned {response.status_code}")
                        passed_tests += 1
                    else:
                        print(f"  ❌ {test_case['name']}: Expected {test_case['expected_status']}, got {response.status_code}")
                        
                except Exception as e:
                    print(f"  ❌ {test_case['name']}: Exception occurred: {e}")
        
        success = passed_tests == len(test_cases)
        if success:
            print("✅ Error handling tests passed!")
        else:
            print(f"❌ Error handling tests failed: {passed_tests}/{len(test_cases)} passed")
        
        return success
    
    async def run_comprehensive_test(self):
        """Run all tests and generate a report"""
        print("🚀 Starting Comprehensive Simulation Service Tests")
        print("=" * 60)
        
        start_time = time.time()
        
        # Run all tests
        tests = [
            ("Service Health", self.test_service_health()),
            ("Basic Simulation", self.test_basic_simulation()),
            ("Batch Simulation", self.test_batch_simulation()),
            ("Template Simulation", self.test_template_simulation()),
            ("Error Handling", self.test_error_handling())
        ]
        
        results = {}
        
        for test_name, test_coro in tests:
            try:
                results[test_name] = await test_coro
            except Exception as e:
                print(f"❌ {test_name} failed with exception: {e}")
                results[test_name] = False
        
        # Run performance test separately
        try:
            performance = await self.test_performance()
            results["Performance"] = performance["success_rate"] > 0.8
        except Exception as e:
            print(f"❌ Performance test failed: {e}")
            results["Performance"] = False
        
        end_time = time.time()
        total_duration = end_time - start_time
        
        # Generate report
        print("\n" + "=" * 60)
        print("📊 TEST REPORT")
        print("=" * 60)
        
        passed_tests = sum(1 for result in results.values() if result)
        total_tests = len(results)
        
        for test_name, result in results.items():
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"{test_name:<20} {status}")
        
        print("-" * 60)
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {passed_tests}")
        print(f"Failed: {total_tests - passed_tests}")
        print(f"Success Rate: {(passed_tests/total_tests)*100:.1f}%")
        print(f"Total Duration: {total_duration:.2f} seconds")
        
        if passed_tests == total_tests:
            print("\n🎉 ALL TESTS PASSED! Service is ready for production.")
        else:
            print(f"\n⚠️ {total_tests - passed_tests} tests failed. Please review and fix issues.")
        
        return results

async def main():
    """Main test runner"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Test the simulation service")
    parser.add_argument("--url", default="http://localhost:8000", help="Service URL")
    parser.add_argument("--api-key", default="test-key", help="API key")
    parser.add_argument("--test", choices=["health", "basic", "batch", "template", "performance", "errors", "all"], 
                       default="all", help="Specific test to run")
    
    args = parser.parse_args()
    
    tester = SimulationTester(args.url, args.api_key)
    
    if args.test == "all":
        await tester.run_comprehensive_test()
    elif args.test == "health":
        await tester.test_service_health()
    elif args.test == "basic":
        await tester.test_basic_simulation()
    elif args.test == "batch":
        await tester.test_batch_simulation()
    elif args.test == "template":
        await tester.test_template_simulation()
    elif args.test == "performance":
        await tester.test_performance()
    elif args.test == "errors":
        await tester.test_error_handling()

if __name__ == "__main__":
    asyncio.run(main())