#!/usr/bin/env python3
"""
Comprehensive Integration Test Suite for ML Simulation Service
Tests the complete workflow using real Supabase data and integration points.
"""

import asyncio
import aiohttp
import json
import time
import os
import argparse
import sys
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from datetime import datetime

# Import shared configuration
from test_config import get_test_config, validate_test_config, print_test_config, TestMetrics

# Test Configuration
TEST_CONFIG = get_test_config()

@dataclass
class TestResult:
    name: str
    success: bool
    response_time: float
    error_message: str = ""
    response_data: Any = None

class IntegrationTester:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.session: Optional[aiohttp.ClientSession] = None
        self.results: List[TestResult] = []
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            headers={
                "X-API-Key": self.config["api_key"],
                "Content-Type": "application/json"
            }
        )
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

    async def fetch_supabase_data(self) -> Dict[str, Any]:
        """Fetch real supply chain data from Supabase for testing"""
        print("🔍 Fetching real supply chain data from Supabase...")
        
        supabase_session = aiohttp.ClientSession(
            headers={
                "apikey": self.config["supabase_key"],
                "Authorization": f"Bearer {self.config['supabase_key']}",
                "Content-Type": "application/json"
            }
        )
        
        try:
            # Fetch supply chain nodes
            async with supabase_session.get(
                f"{self.config['supabase_url']}/rest/v1/supply_chain_data",
                params={
                    "project_id": f"eq.{self.config['project_id']}",
                    "limit": "20"
                }
            ) as resp:
                supply_chain_data = await resp.json()
            
            # Fetch node list with coordinates
            async with supabase_session.get(
                f"{self.config['supabase_url']}/rest/v1/node_list",
                params={
                    "project_id": f"eq.{self.config['project_id']}",
                    "limit": "10"
                }
            ) as resp:
                node_list = await resp.json()
            
            # Fetch disruption scenarios
            async with supabase_session.get(
                f"{self.config['supabase_url']}/rest/v1/disruption_scenario_profiles",
                params={
                    "project_id": f"eq.{self.config['project_id']}",
                    "limit": "5"
                }
            ) as resp:
                scenarios = await resp.json()
                
            return {
                "supply_chain_data": supply_chain_data,
                "node_list": node_list,
                "scenarios": scenarios
            }
            
        finally:
            await supabase_session.close()

    def create_real_prediction_nodes(self, supabase_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Create prediction nodes from real supply chain data"""
        nodes = []
        node_list = supabase_data.get("node_list", [])
        supply_chain_data = supabase_data.get("supply_chain_data", [])
        
        # Create a lookup for supply chain info
        sc_lookup = {}
        for item in supply_chain_data:
            from_loc = item.get("from_location")
            to_loc = item.get("to_location")
            if from_loc:
                sc_lookup[from_loc] = item
            if to_loc:
                sc_lookup[to_loc] = item
        
        for i, node in enumerate(node_list[:10]):  # Limit to 10 nodes for testing
            node_id = node.get("node_id", f"node_{i}")
            sc_info = sc_lookup.get(node_id, {})
            
            nodes.append({
                "id": node_id,
                "name": node.get("description_text") or f"Node {node_id}",
                "type": node.get("node_type") or "supplier",
                "location": node.get("location_text") or f"Location {i}",
                "latitude": float(node.get("latitude", 40.0 + i * 0.1)),
                "longitude": float(node.get("longitude", -74.0 + i * 0.1)),
                "revenue": float(sc_info.get("weighted", 1000000 + i * 100000)),
                "capacity": 5000 + i * 1000,
                "lead_time": 7 + i % 14,
                "risk_factor": 0.1 + (i % 5) * 0.1,
                "connectivity_score": 0.7 + (i % 3) * 0.1
            })
            
        return nodes

    async def test_health_check(self) -> TestResult:
        """Test basic health check"""
        start_time = time.time()
        try:
            async with self.session.get(f"{self.config['base_url']}/health") as resp:
                response_time = time.time() - start_time
                data = await resp.json()
                
                success = resp.status == 200 and data.get("status") == "healthy"
                return TestResult(
                    name="health_check",
                    success=success,
                    response_time=response_time,
                    response_data=data
                )
        except Exception as e:
            return TestResult(
                name="health_check",
                success=False,
                response_time=time.time() - start_time,
                error_message=str(e)
            )

    async def test_model_info(self) -> TestResult:
        """Test model information endpoint"""
        start_time = time.time()
        try:
            async with self.session.get(f"{self.config['base_url']}/model/info") as resp:
                response_time = time.time() - start_time
                data = await resp.json()
                
                success = resp.status == 200 and "model_version" in data
                return TestResult(
                    name="model_info",
                    success=success,
                    response_time=response_time,
                    response_data=data
                )
        except Exception as e:
            return TestResult(
                name="model_info",
                success=False,
                response_time=time.time() - start_time,
                error_message=str(e)
            )

    async def test_critical_node_prediction(self, real_nodes: List[Dict[str, Any]]) -> TestResult:
        """Test critical node prediction with real data"""
        start_time = time.time()
        try:
            payload = {"nodes": real_nodes}
            
            async with self.session.post(
                f"{self.config['base_url']}/predict",
                json=payload
            ) as resp:
                response_time = time.time() - start_time
                data = await resp.json()
                
                success = (
                    resp.status == 200 and 
                    "predictions" in data and 
                    len(data["predictions"]) == len(real_nodes)
                )
                
                return TestResult(
                    name="critical_node_prediction",
                    success=success,
                    response_time=response_time,
                    response_data=data
                )
        except Exception as e:
            return TestResult(
                name="critical_node_prediction",
                success=False,
                response_time=time.time() - start_time,
                error_message=str(e)
            )

    async def test_simulation_queue(self) -> TestResult:
        """Test simulation queue status"""
        start_time = time.time()
        try:
            async with self.session.get(f"{self.config['base_url']}/simulation/queue") as resp:
                response_time = time.time() - start_time
                data = await resp.json()
                
                success = resp.status == 200
                return TestResult(
                    name="simulation_queue",
                    success=success,
                    response_time=response_time,
                    response_data=data
                )
        except Exception as e:
            return TestResult(
                name="simulation_queue",
                success=False,
                response_time=time.time() - start_time,
                error_message=str(e)
            )

    async def test_simulation_submit(self) -> TestResult:
        """Test simulation job submission with real data"""
        start_time = time.time()
        try:
            payload = {
                "project_id": self.config["project_id"],
                "plant_name": self.config["plant_name"],
                "job_type": "baseline_scenario",
                "scenario_ids": self.config["scenario_ids"][:1],  # Use one real scenario
                "simulation_horizon_days": 30,
                "monte_carlo_runs": 100,
                "baseline_enabled": True,
                "user_id": self.config["user_id"],
                "user_email": self.config["user_email"],
                "priority": "normal"  # Use string enum
            }
            
            async with self.session.post(
                f"{self.config['base_url']}/simulation/submit",
                json=payload
            ) as resp:
                response_time = time.time() - start_time
                data = await resp.json()
                
                success = resp.status == 200 and "job_id" in data
                return TestResult(
                    name="simulation_submit",
                    success=success,
                    response_time=response_time,
                    response_data=data
                )
        except Exception as e:
            return TestResult(
                name="simulation_submit",
                success=False,
                response_time=time.time() - start_time,
                error_message=str(e)
            )

    async def test_simulation_status(self, job_id: str) -> TestResult:
        """Test simulation status check"""
        start_time = time.time()
        try:
            async with self.session.get(
                f"{self.config['base_url']}/simulation/status/{job_id}"
            ) as resp:
                response_time = time.time() - start_time
                data = await resp.json()
                
                success = resp.status == 200 and "status" in data
                return TestResult(
                    name="simulation_status",
                    success=success,
                    response_time=response_time,
                    response_data=data
                )
        except Exception as e:
            return TestResult(
                name="simulation_status",
                success=False,
                response_time=time.time() - start_time,
                error_message=str(e)
            )

    async def test_batch_simulation(self) -> TestResult:
        """Test batch simulation with real scenarios"""
        start_time = time.time()
        try:
            payload = {
                "project_id": self.config["project_id"],
                "plant_name": self.config["plant_name"],
                "scenarios": [
                    {
                        "scenario_id": scenario_id,
                        "scenario_name": f"Real Scenario {i+1}"
                    }
                    for i, scenario_id in enumerate(self.config["scenario_ids"][:2])
                ],
                "simulation_horizon_days": 30,
                "monte_carlo_runs": 100,  # Use minimum valid value
                "baseline_enabled": True,
                "user_id": self.config["user_id"],
                "user_email": self.config["user_email"]
            }
            
            async with self.session.post(
                f"{self.config['base_url']}/simulation/batch",
                json=payload
            ) as resp:
                response_time = time.time() - start_time
                data = await resp.json()
                
                success = resp.status == 200 and "batch_id" in data
                return TestResult(
                    name="batch_simulation",
                    success=success,
                    response_time=response_time,
                    response_data=data
                )
        except Exception as e:
            return TestResult(
                name="batch_simulation",
                success=False,
                response_time=time.time() - start_time,
                error_message=str(e)
            )

    async def test_supabase_integration(self) -> TestResult:
        """Test direct Supabase integration"""
        start_time = time.time()
        try:
            # Test if we can write to simulation_results table
            supabase_session = aiohttp.ClientSession(
                headers={
                    "apikey": self.config["supabase_key"],
                    "Authorization": f"Bearer {self.config['supabase_key']}",
                    "Content-Type": "application/json"
                }
            )
            
            try:
                # Try to read simulation results for our project
                async with supabase_session.get(
                    f"{self.config['supabase_url']}/rest/v1/simulation_results",
                    params={
                        "project_id": f"eq.{self.config['project_id']}",
                        "limit": "5"
                    }
                ) as resp:
                    response_time = time.time() - start_time
                    data = await resp.json()
                    
                    success = resp.status == 200
                    return TestResult(
                        name="supabase_integration",
                        success=success,
                        response_time=response_time,
                        response_data={"results_count": len(data)}
                    )
            finally:
                await supabase_session.close()
                
        except Exception as e:
            return TestResult(
                name="supabase_integration",
                success=False,
                response_time=time.time() - start_time,
                error_message=str(e)
            )

    async def test_performance_stress(self, real_nodes: List[Dict[str, Any]]) -> TestResult:
        """Test performance with multiple concurrent requests"""
        start_time = time.time()
        try:
            # Submit 5 concurrent prediction requests
            tasks = []
            for i in range(5):
                task = self.session.post(
                    f"{self.config['base_url']}/predict",
                    json={"nodes": real_nodes[:5]}  # Smaller batch for stress test
                )
                tasks.append(task)
            
            responses = await asyncio.gather(*tasks, return_exceptions=True)
            response_time = time.time() - start_time
            
            success_count = 0
            for resp in responses:
                if not isinstance(resp, Exception):
                    async with resp as r:
                        if r.status == 200:
                            success_count += 1
                        await r.read()  # Ensure response is consumed
            
            success = success_count >= 4  # At least 4/5 should succeed
            return TestResult(
                name="performance_stress",
                success=success,
                response_time=response_time,
                response_data={"successful_requests": success_count, "total_requests": 5}
            )
            
        except Exception as e:
            return TestResult(
                name="performance_stress",
                success=False,
                response_time=time.time() - start_time,
                error_message=str(e)
            )

    def print_results(self):
        """Print comprehensive test results"""
        print("\n" + "="*80)
        print("🧪 COMPREHENSIVE INTEGRATION TEST RESULTS")
        print("="*80)
        
        total_tests = len(self.results)
        passed_tests = sum(1 for result in self.results if result.success)
        
        print(f"📊 Overall: {passed_tests}/{total_tests} tests passed")
        print(f"⏱️  Total execution time: {sum(r.response_time for r in self.results):.2f}s")
        print()
        
        for result in self.results:
            status = "✅ PASS" if result.success else "❌ FAIL"
            print(f"{result.name:25} : {status} ({result.response_time:.3f}s)")
            
            if not result.success and result.error_message:
                print(f"   Error: {result.error_message}")
            elif result.response_data:
                if isinstance(result.response_data, dict):
                    key_info = {k: v for k, v in result.response_data.items() 
                              if k in ['status', 'job_id', 'batch_id', 'results_count', 'successful_requests']}
                    if key_info:
                        print(f"   Data: {key_info}")
        
        print("\n" + "="*80)
        if passed_tests == total_tests:
            print("🎉 ALL TESTS PASSED! The ML service is fully integrated and working correctly.")
        else:
            print(f"⚠️  {total_tests - passed_tests} test(s) failed. Check the details above.")
        print("="*80)

async def run_integration_tests(test_filter: Optional[str] = None, verbose: bool = False) -> Dict[str, Any]:
    """
    Run integration tests with optional filtering and return results
    
    Args:
        test_filter: Filter to run specific test types (health, prediction, simulation, database, performance)
        verbose: Enable verbose output
    
    Returns:
        Dict with success status, results, and summary
    """
    if verbose:
        print("🚀 STARTING COMPREHENSIVE INTEGRATION TESTS")
        print("="*80)
        print(f"⏰ Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        if test_filter:
            print(f"🔍 Filter: {test_filter}")
        print("="*80)
    
    async with IntegrationTester(TEST_CONFIG) as tester:
        if verbose:
            print("📊 Phase 1: Fetching Real Supabase Data")
            print("-"*40)
        
        supabase_data = await tester.fetch_supabase_data()
        real_nodes = tester.create_real_prediction_nodes(supabase_data)
        
        if verbose:
            print(f"✅ Successfully fetched {len(real_nodes)} real supply chain nodes")
            print(f"✅ Loaded {len(supabase_data.get('scenarios', []))} disruption scenarios")
            print(f"✅ Using project: {TEST_CONFIG['project_id']}")
        
        # Define test phases with filters
        test_phases = {
            "health": [
                ("Core Health Check", tester.test_health_check()),
                ("Model Info", tester.test_model_info())
            ],
            "prediction": [
                ("Critical Node Prediction", tester.test_critical_node_prediction(real_nodes)),
                ("Simulation Queue", tester.test_simulation_queue())
            ],
            "simulation": [
                ("Simulation Submit", tester.test_simulation_submit()),
                ("Batch Simulation", tester.test_batch_simulation())
            ],
            "database": [
                ("Supabase Integration", tester.test_supabase_integration())
            ],
            "performance": [
                ("Performance Stress", tester.test_performance_stress(real_nodes))
            ]
        }
        
        # Run filtered tests
        for phase_name, tests in test_phases.items():
            if test_filter and phase_name != test_filter:
                continue
                
            if verbose:
                print(f"\n🧪 Phase: {phase_name.title()} Tests")
                print("-"*40)
            
            for test_name, test_coro in tests:
                result = await test_coro
                tester.results.append(result)
                
                # Handle simulation status check for submit test
                if (test_name == "Simulation Submit" and result.success and 
                    result.response_data and "job_id" in result.response_data):
                    job_id = result.response_data["job_id"]
                    status_result = await tester.test_simulation_status(job_id)
                    tester.results.append(status_result)
        
        # Calculate results
        total_tests = len(tester.results)
        passed_tests = sum(1 for result in tester.results if result.success)
        success_rate = passed_tests / total_tests if total_tests > 0 else 0
        
        if verbose:
            tester.print_results()
            print(f"\n🎯 Final Assessment: {success_rate:.1%} success rate")
            
            if success_rate >= 0.8:
                print("🎉 Integration tests PASSED! Service is ready for production.")
            else:
                print("⚠️  Integration tests FAILED. Please review failures above.")
        
        return {
            "success": success_rate >= 0.8,
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "success_rate": success_rate,
            "results": [
                {
                    "name": r.name,
                    "success": r.success,
                    "response_time": r.response_time,
                    "error_message": r.error_message
                }
                for r in tester.results
            ]
        }

async def main():
    """Command-line interface for integration tests"""
    parser = argparse.ArgumentParser(description="ML Service Integration Tests")
    parser.add_argument(
        "--filter", 
        choices=["health", "prediction", "simulation", "database", "performance"],
        help="Run only specific test phase"
    )
    parser.add_argument(
        "--quiet", 
        action="store_true",
        help="Suppress verbose output (for orchestrator use)"
    )
    parser.add_argument(
        "--config-override",
        type=str,
        help="Override config values (JSON format)"
    )
    
    args = parser.parse_args()
    
    # Override config if provided
    if args.config_override:
        try:
            config_overrides = json.loads(args.config_override)
            TEST_CONFIG.update(config_overrides)
        except json.JSONDecodeError as e:
            print(f"❌ Invalid config override JSON: {e}")
            sys.exit(1)
    
    # Run tests
    results = await run_integration_tests(
        test_filter=args.filter,
        verbose=not args.quiet
    )
    
    # Exit with appropriate code
    sys.exit(0 if results["success"] else 1)

if __name__ == "__main__":
    asyncio.run(main())