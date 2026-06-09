#!/usr/bin/env python3
"""
Performance benchmarking for the simulation service.
This module provides comprehensive performance testing and analysis capabilities.
"""

import asyncio
import time
import statistics
import httpx
import json
import sys
from typing import Dict, List, Any, Tuple
from dataclasses import dataclass, asdict
from pathlib import Path
import matplotlib.pyplot as plt
import pandas as pd

@dataclass
class BenchmarkResult:
    test_name: str
    total_requests: int
    successful_requests: int
    failed_requests: int
    total_time: float
    average_response_time: float
    min_response_time: float
    max_response_time: float
    p95_response_time: float
    p99_response_time: float
    throughput_rps: float
    success_rate: float
    error_details: List[str]

class PerformanceBenchmark:
    def __init__(self, service_url: str = "http://localhost:8000", api_key: str = "benchmark-key"):
        self.service_url = service_url
        self.api_key = api_key
        self.headers = {
            "X-API-Key": api_key,
            "Content-Type": "application/json"
        }
        self.results = []
    
    async def benchmark_concurrent_simulations(self, 
                                             num_concurrent: int = 10, 
                                             simulation_params: Dict[str, Any] = None) -> BenchmarkResult:
        """Benchmark concurrent simulation submissions"""
        
        if simulation_params is None:
            simulation_params = {
                "simulation_horizon_days": 7,
                "monte_carlo_runs": 10,
                "kpi_definitions": ["fill_rate", "revenue"]
            }
        
        print(f"🔥 Benchmarking {num_concurrent} concurrent simulations...")
        
        response_times = []
        errors = []
        successful = 0
        
        async def submit_simulation(sim_id: int) -> Tuple[bool, float, str]:
            """Submit a single simulation and return success, response time, and error"""
            start_time = time.time()
            
            request = {
                "project_id": f"benchmark-{sim_id}",
                "scenario_ids": [f"scenario-{sim_id}"],
                "simulation_parameters": simulation_params,
                "job_type": "baseline_scenario",
                "priority": "normal"
            }
            
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        f"{self.service_url}/simulation/submit",
                        headers=self.headers,
                        json=request
                    )
                    
                    response_time = time.time() - start_time
                    
                    if response.status_code == 200:
                        return True, response_time, ""
                    else:
                        return False, response_time, f"HTTP {response.status_code}: {response.text}"
                        
            except Exception as e:
                response_time = time.time() - start_time
                return False, response_time, str(e)
        
        # Execute concurrent requests
        start_time = time.time()
        tasks = [submit_simulation(i) for i in range(num_concurrent)]
        results = await asyncio.gather(*tasks)
        total_time = time.time() - start_time
        
        # Process results
        for success, response_time, error in results:
            response_times.append(response_time)
            if success:
                successful += 1
            else:
                errors.append(error)
        
        # Calculate statistics
        return BenchmarkResult(
            test_name=f"Concurrent Simulations (n={num_concurrent})",
            total_requests=num_concurrent,
            successful_requests=successful,
            failed_requests=num_concurrent - successful,
            total_time=total_time,
            average_response_time=statistics.mean(response_times),
            min_response_time=min(response_times),
            max_response_time=max(response_times),
            p95_response_time=statistics.quantiles(response_times, n=20)[18] if len(response_times) > 1 else response_times[0],
            p99_response_time=statistics.quantiles(response_times, n=100)[98] if len(response_times) > 1 else response_times[0],
            throughput_rps=successful / total_time if total_time > 0 else 0,
            success_rate=successful / num_concurrent,
            error_details=errors[:5]  # Keep only first 5 errors
        )
    
    async def benchmark_load_test(self, 
                                rps_targets: List[int] = [1, 5, 10, 20],
                                duration_seconds: int = 30) -> List[BenchmarkResult]:
        """Benchmark service under different load levels (requests per second)"""
        
        results = []
        
        for target_rps in rps_targets:
            print(f"🚦 Load testing at {target_rps} RPS for {duration_seconds} seconds...")
            
            response_times = []
            errors = []
            successful = 0
            total_requests = 0
            
            start_time = time.time()
            end_time = start_time + duration_seconds
            
            async def controlled_submission():
                nonlocal successful, total_requests
                
                while time.time() < end_time:
                    request_start = time.time()
                    
                    request = {
                        "project_id": f"load-test-{int(time.time()*1000)}",
                        "scenario_ids": ["load-scenario"],
                        "simulation_parameters": {
                            "simulation_horizon_days": 5,
                            "monte_carlo_runs": 5
                        }
                    }
                    
                    try:
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            response = await client.post(
                                f"{self.service_url}/simulation/submit",
                                headers=self.headers,
                                json=request
                            )
                            
                            response_time = time.time() - request_start
                            response_times.append(response_time)
                            total_requests += 1
                            
                            if response.status_code == 200:
                                successful += 1
                            else:
                                errors.append(f"HTTP {response.status_code}")
                                
                    except Exception as e:
                        response_time = time.time() - request_start
                        response_times.append(response_time)
                        total_requests += 1
                        errors.append(str(e))
                    
                    # Control rate
                    expected_interval = 1.0 / target_rps
                    actual_time = time.time() - request_start
                    if actual_time < expected_interval:
                        await asyncio.sleep(expected_interval - actual_time)
            
            await controlled_submission()
            actual_duration = time.time() - start_time
            
            if response_times:
                result = BenchmarkResult(
                    test_name=f"Load Test ({target_rps} RPS)",
                    total_requests=total_requests,
                    successful_requests=successful,
                    failed_requests=total_requests - successful,
                    total_time=actual_duration,
                    average_response_time=statistics.mean(response_times),
                    min_response_time=min(response_times),
                    max_response_time=max(response_times),
                    p95_response_time=statistics.quantiles(response_times, n=20)[18] if len(response_times) > 1 else response_times[0],
                    p99_response_time=statistics.quantiles(response_times, n=100)[98] if len(response_times) > 1 else response_times[0],
                    throughput_rps=successful / actual_duration if actual_duration > 0 else 0,
                    success_rate=successful / total_requests if total_requests > 0 else 0,
                    error_details=list(set(errors[:5]))
                )
                results.append(result)
            
            # Wait between tests
            await asyncio.sleep(5)
        
        return results
    
    async def benchmark_memory_scaling(self, 
                                     monte_carlo_runs: List[int] = [10, 50, 100, 500, 1000]) -> List[BenchmarkResult]:
        """Benchmark simulation performance with different Monte Carlo run counts"""
        
        results = []
        
        for mc_runs in monte_carlo_runs:
            print(f"🧮 Testing with {mc_runs} Monte Carlo runs...")
            
            request = {
                "project_id": f"memory-test-{mc_runs}",
                "scenario_ids": ["memory-scenario"],
                "simulation_parameters": {
                    "simulation_horizon_days": 30,
                    "monte_carlo_runs": mc_runs,
                    "kpi_definitions": ["fill_rate", "revenue", "delivery_on_time"]
                }
            }
            
            start_time = time.time()
            
            try:
                async with httpx.AsyncClient(timeout=120.0) as client:
                    response = await client.post(
                        f"{self.service_url}/simulation/submit",
                        headers=self.headers,
                        json=request
                    )
                    
                    response_time = time.time() - start_time
                    
                    if response.status_code == 200:
                        result = BenchmarkResult(
                            test_name=f"Memory Scaling ({mc_runs} MC runs)",
                            total_requests=1,
                            successful_requests=1,
                            failed_requests=0,
                            total_time=response_time,
                            average_response_time=response_time,
                            min_response_time=response_time,
                            max_response_time=response_time,
                            p95_response_time=response_time,
                            p99_response_time=response_time,
                            throughput_rps=1 / response_time,
                            success_rate=1.0,
                            error_details=[]
                        )
                    else:
                        result = BenchmarkResult(
                            test_name=f"Memory Scaling ({mc_runs} MC runs)",
                            total_requests=1,
                            successful_requests=0,
                            failed_requests=1,
                            total_time=response_time,
                            average_response_time=response_time,
                            min_response_time=response_time,
                            max_response_time=response_time,
                            p95_response_time=response_time,
                            p99_response_time=response_time,
                            throughput_rps=0,
                            success_rate=0.0,
                            error_details=[f"HTTP {response.status_code}: {response.text}"]
                        )
                        
            except Exception as e:
                response_time = time.time() - start_time
                result = BenchmarkResult(
                    test_name=f"Memory Scaling ({mc_runs} MC runs)",
                    total_requests=1,
                    successful_requests=0,
                    failed_requests=1,
                    total_time=response_time,
                    average_response_time=response_time,
                    min_response_time=response_time,
                    max_response_time=response_time,
                    p95_response_time=response_time,
                    p99_response_time=response_time,
                    throughput_rps=0,
                    success_rate=0.0,
                    error_details=[str(e)]
                )
            
            results.append(result)
            await asyncio.sleep(2)  # Cool down between tests
        
        return results
    
    def generate_report(self, results: List[BenchmarkResult], output_file: str = "benchmark_report.json"):
        """Generate a comprehensive benchmark report"""
        
        print("\n" + "=" * 80)
        print("📊 PERFORMANCE BENCHMARK REPORT")
        print("=" * 80)
        
        # Summary statistics
        all_successful = sum(r.successful_requests for r in results)
        all_total = sum(r.total_requests for r in results)
        overall_success_rate = all_successful / all_total if all_total > 0 else 0
        
        print(f"Overall Success Rate: {overall_success_rate:.2%}")
        print(f"Total Requests: {all_total}")
        print(f"Successful Requests: {all_successful}")
        print(f"Failed Requests: {all_total - all_successful}")
        
        print("\n📈 Individual Test Results:")
        print("-" * 80)
        
        for result in results:
            print(f"\n{result.test_name}")
            print(f"  Requests: {result.total_requests} (Success: {result.success_rate:.1%})")
            print(f"  Response Time: avg={result.average_response_time:.3f}s, p95={result.p95_response_time:.3f}s, p99={result.p99_response_time:.3f}s")
            print(f"  Throughput: {result.throughput_rps:.2f} RPS")
            if result.error_details:
                print(f"  Errors: {', '.join(result.error_details[:3])}")
        
        # Save detailed results
        report_data = {
            "timestamp": time.time(),
            "service_url": self.service_url,
            "summary": {
                "total_requests": all_total,
                "successful_requests": all_successful,
                "overall_success_rate": overall_success_rate
            },
            "detailed_results": [asdict(r) for r in results]
        }
        
        with open(output_file, 'w') as f:
            json.dump(report_data, f, indent=2)
        
        print(f"\n💾 Detailed report saved to: {output_file}")
        
        return report_data
    
    async def run_comprehensive_benchmark(self):
        """Run all benchmark tests"""
        
        print("🚀 Starting Comprehensive Performance Benchmark")
        print("=" * 60)
        
        all_results = []
        
        # Test 1: Concurrent simulations
        concurrency_tests = [5, 10, 20, 50]
        for concurrency in concurrency_tests:
            try:
                result = await self.benchmark_concurrent_simulations(concurrency)
                all_results.append(result)
                print(f"✅ Completed concurrency test: {concurrency}")
            except Exception as e:
                print(f"❌ Failed concurrency test {concurrency}: {e}")
        
        # Test 2: Load testing
        try:
            load_results = await self.benchmark_load_test([1, 5, 10])
            all_results.extend(load_results)
            print("✅ Completed load testing")
        except Exception as e:
            print(f"❌ Load testing failed: {e}")
        
        # Test 3: Memory scaling
        try:
            memory_results = await self.benchmark_memory_scaling([10, 50, 100])
            all_results.extend(memory_results)
            print("✅ Completed memory scaling tests")
        except Exception as e:
            print(f"❌ Memory scaling tests failed: {e}")
        
        # Generate report
        self.generate_report(all_results)
        
        return all_results

async def main():
    """Main benchmark runner"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Benchmark the simulation service")
    parser.add_argument("--url", default="http://localhost:8000", help="Service URL")
    parser.add_argument("--api-key", default="benchmark-key", help="API key")
    parser.add_argument("--test", choices=["concurrent", "load", "memory", "all"], 
                       default="all", help="Specific benchmark to run")
    parser.add_argument("--output", default="benchmark_report.json", help="Output file for results")
    
    args = parser.parse_args()
    
    benchmark = PerformanceBenchmark(args.url, args.api_key)
    
    if args.test == "all":
        await benchmark.run_comprehensive_benchmark()
    elif args.test == "concurrent":
        result = await benchmark.benchmark_concurrent_simulations(10)
        benchmark.generate_report([result], args.output)
    elif args.test == "load":
        results = await benchmark.benchmark_load_test([1, 5, 10])
        benchmark.generate_report(results, args.output)
    elif args.test == "memory":
        results = await benchmark.benchmark_memory_scaling([10, 50, 100])
        benchmark.generate_report(results, args.output)

if __name__ == "__main__":
    asyncio.run(main())