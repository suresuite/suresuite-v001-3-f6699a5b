#!/usr/bin/env python3
"""
Basic simulation example demonstrating how to use the simulation service.
This example shows how to:
1. Set up a simple supply chain network
2. Define disruption scenarios
3. Run simulations
4. Analyze results
"""

import asyncio
import httpx
import json
from typing import Dict, Any

# Configuration
SERVICE_URL = "http://localhost:8000"
API_KEY = "your-api-key-here"

async def create_sample_simulation_request() -> Dict[str, Any]:
    """Create a sample simulation request"""
    return {
        "project_id": "example-project-123",
        "scenario_ids": ["disruption-scenario-1"],
        "simulation_parameters": {
            "simulation_horizon_days": 30,
            "monte_carlo_runs": 100,
            "kpi_definitions": ["fill_rate", "revenue", "delivery_on_time"],
            "volatility_factor": 0.1,
            "enable_cascade_effects": True
        },
        "job_type": "baseline_scenario",
        "priority": "normal",
        "user_context": {
            "user_id": "user-123",
            "organization": "example-org"
        }
    }

async def run_simulation_example():
    """Run a complete simulation example"""
    
    headers = {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json"
    }
    
    async with httpx.AsyncClient() as client:
        # 1. Check service health
        print("🔍 Checking service health...")
        health_response = await client.get(f"{SERVICE_URL}/health")
        print(f"Service status: {health_response.json()}")
        
        # 2. Submit simulation job
        print("\n📤 Submitting simulation job...")
        simulation_request = await create_sample_simulation_request()
        
        job_response = await client.post(
            f"{SERVICE_URL}/simulation/submit",
            headers=headers,
            json=simulation_request
        )
        
        if job_response.status_code != 200:
            print(f"❌ Failed to submit job: {job_response.text}")
            return
        
        job_data = job_response.json()
        job_id = job_data["job_id"]
        print(f"✅ Job submitted successfully. Job ID: {job_id}")
        
        # 3. Monitor job progress
        print(f"\n👀 Monitoring job progress...")
        while True:
            status_response = await client.get(
                f"{SERVICE_URL}/simulation/status/{job_id}",
                headers=headers
            )
            
            status_data = status_response.json()
            print(f"Job status: {status_data['status']} - Progress: {status_data.get('progress', 0)}%")
            
            if status_data["status"] in ["completed", "failed", "cancelled"]:
                break
            
            await asyncio.sleep(2)
        
        # 4. Get results if completed
        if status_data["status"] == "completed":
            print(f"\n📊 Retrieving simulation results...")
            
            results_response = await client.get(
                f"{SERVICE_URL}/simulation/results/{job_id}",
                headers=headers
            )
            
            results = results_response.json()
            print(f"✅ Simulation completed successfully!")
            
            # Display key metrics
            if "results" in results and "metrics" in results["results"]:
                metrics = results["results"]["metrics"]
                print(f"\n📈 Key Results:")
                
                if "baseline" in metrics:
                    baseline = metrics["baseline"]
                    print(f"  Baseline Fill Rate: {baseline.get('fill_rate', {}).get('mean', 'N/A')}")
                    print(f"  Baseline Revenue: ${baseline.get('revenue', {}).get('mean', 'N/A'):,.2f}")
                
                if "scenario" in metrics:
                    scenario = metrics["scenario"]
                    print(f"  Scenario Fill Rate: {scenario.get('fill_rate', {}).get('mean', 'N/A')}")
                    print(f"  Scenario Revenue: ${scenario.get('revenue', {}).get('mean', 'N/A'):,.2f}")
                
                # Calculate impact
                if "baseline" in metrics and "scenario" in metrics:
                    baseline_revenue = metrics["baseline"].get("revenue", {}).get("mean", 0)
                    scenario_revenue = metrics["scenario"].get("revenue", {}).get("mean", 0)
                    
                    if baseline_revenue > 0:
                        impact = ((scenario_revenue - baseline_revenue) / baseline_revenue) * 100
                        print(f"  💸 Revenue Impact: {impact:+.1f}%")
        
        else:
            print(f"❌ Job failed: {status_data.get('error_message', 'Unknown error')}")

async def batch_simulation_example():
    """Example of running multiple simulations in batch"""
    
    print("\n🔄 Running batch simulation example...")
    
    headers = {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json"
    }
    
    batch_request = {
        "project_id": "example-project-123",
        "scenarios": [
            {
                "scenario_id": "scenario-1",
                "scenario_name": "Supply Disruption",
                "description": "Major supplier disruption",
                "effects": [
                    {
                        "effect_type": "capacity_reduction",
                        "magnitude": 50,
                        "unit": "percent"
                    }
                ]
            },
            {
                "scenario_id": "scenario-2", 
                "scenario_name": "Demand Spike",
                "description": "Unexpected demand increase",
                "effects": [
                    {
                        "effect_type": "demand_increase",
                        "magnitude": 30,
                        "unit": "percent"
                    }
                ]
            }
        ],
        "simulation_parameters": {
            "simulation_horizon_days": 30,
            "monte_carlo_runs": 50
        }
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{SERVICE_URL}/simulation/batch",
            headers=headers,
            json=batch_request
        )
        
        if response.status_code == 200:
            batch_data = response.json()
            print(f"✅ Batch job submitted: {batch_data['batch_id']}")
            print(f"📊 Total jobs: {batch_data['total_jobs']}")
        else:
            print(f"❌ Batch submission failed: {response.text}")

async def performance_benchmark():
    """Run performance benchmarks"""
    
    print("\n⚡ Running performance benchmark...")
    
    start_time = asyncio.get_event_loop().time()
    
    # Run multiple simulations concurrently
    tasks = []
    for i in range(5):
        task = run_quick_simulation(f"benchmark-{i}")
        tasks.append(task)
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    end_time = asyncio.get_event_loop().time()
    duration = end_time - start_time
    
    successful = sum(1 for r in results if not isinstance(r, Exception))
    
    print(f"📊 Benchmark Results:")
    print(f"  Total simulations: {len(tasks)}")
    print(f"  Successful: {successful}")
    print(f"  Total time: {duration:.2f} seconds")
    print(f"  Average time per simulation: {duration/len(tasks):.2f} seconds")

async def run_quick_simulation(simulation_id: str):
    """Run a quick simulation for benchmarking"""
    
    headers = {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json"
    }
    
    request = {
        "project_id": f"benchmark-{simulation_id}",
        "scenario_ids": ["quick-scenario"],
        "simulation_parameters": {
            "simulation_horizon_days": 7,
            "monte_carlo_runs": 10
        }
    }
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{SERVICE_URL}/simulation/submit",
            headers=headers,
            json=request
        )
        return response.status_code == 200

if __name__ == "__main__":
    print("🚀 Supply Chain Simulation Service - Examples")
    print("=" * 50)
    
    # Run examples
    asyncio.run(run_simulation_example())
    asyncio.run(batch_simulation_example())
    asyncio.run(performance_benchmark())
    
    print("\n✅ All examples completed!")