#!/usr/bin/env python3
"""
Comprehensive Simulation Testing Script

This script provides URL-based testing for all simulation endpoints
without requiring curl. Run this to test the ML simulation service locally.

Usage:
    python test_simulation_comprehensive.py
    
Requirements:
    - ML service running on localhost:8000
    - Valid SIMULATION_API_KEY set in .env file
"""

import requests
import json
import time
import uuid
from typing import Dict, Any, Optional

# Configuration
BASE_URL = "http://localhost:8000"
API_KEY = "Ia6XnJzaQfFYWM3H3RIlKZbRU7B2Cpg6iOBkWHpox2I"  # Use your generated API key

HEADERS = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json"
}

class SimulationTester:
    def __init__(self, base_url: str = BASE_URL, api_key: str = API_KEY):
        self.base_url = base_url
        self.headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
        
    def test_health_check(self) -> bool:
        """Test basic health endpoint (no auth required)"""
        print("\n🏥 Testing Health Check...")
        try:
            url = f"{self.base_url}/health"
            print(f"GET {url}")
            
            response = requests.get(url, timeout=10)
            
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text}")
            
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    
    def test_model_info(self) -> bool:
        """Test model info endpoint (requires auth)"""
        print("\n🤖 Testing Model Info...")
        try:
            url = f"{self.base_url}/model/info"
            print(f"GET {url}")
            print(f"Headers: {self.headers}")
            
            response = requests.get(url, headers=self.headers, timeout=10)
            
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text}")
            
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    
    def test_critical_node_prediction(self) -> bool:
        """Test critical node prediction endpoint"""
        print("\n🎯 Testing Critical Node Prediction...")
        try:
            url = f"{self.base_url}/predict"
            print(f"POST {url}")
            
            # Sample supply chain data
            payload = {
                "nodes": [
                    {
                        "id": "supplier_1",
                        "name": "Steel Supplier Co",
                        "type": "supplier",
                        "location": "Pittsburgh, PA",
                        "revenue": 1000000,
                        "capacity": 5000,
                        "lead_time": 14
                    },
                    {
                        "id": "manufacturer_1", 
                        "name": "Auto Manufacturing Plant",
                        "type": "manufacturer",
                        "location": "Detroit, MI",
                        "revenue": 50000000,
                        "capacity": 20000,
                        "lead_time": 7
                    },
                    {
                        "id": "customer_1",
                        "name": "Regional Distributor",
                        "type": "customer", 
                        "location": "Chicago, IL",
                        "revenue": 25000000,
                        "capacity": 10000,
                        "lead_time": 3
                    }
                ]
            }
            
            print(f"Payload: {json.dumps(payload, indent=2)}")
            
            response = requests.post(url, headers=self.headers, json=payload, timeout=30)
            
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text}")
            
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    
    def test_simulation_queue(self) -> bool:
        """Test simulation queue endpoint"""
        print("\n📊 Testing Simulation Queue...")
        try:
            url = f"{self.base_url}/simulation/queue"
            print(f"GET {url}")
            
            response = requests.get(url, headers=self.headers, timeout=10)
            
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text}")
            
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    
    def test_simulation_submit(self) -> Optional[str]:
        """Test simulation submission endpoint"""
        print("\n🚀 Testing Simulation Submit...")
        try:
            url = f"{self.base_url}/simulation/submit"
            print(f"POST {url}")
            
            # Sample simulation request
            payload = {
                "project_id": str(uuid.uuid4()),
                "plant_name": "Detroit Manufacturing Plant",
                "job_type": "baseline_scenario",
                "scenario_ids": [],
                "simulation_horizon_days": 30,
                "monte_carlo_runs": 100,
                "baseline_enabled": True,
                "user_id": str(uuid.uuid4()),
                "user_email": "test@example.com",
                "priority": "normal"
            }
            
            print(f"Payload: {json.dumps(payload, indent=2)}")
            
            response = requests.post(url, headers=self.headers, json=payload, timeout=30)
            
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text}")
            
            if response.status_code == 200:
                result = response.json()
                job_id = result.get('job_id')
                print(f"✅ Job Created: {job_id}")
                return job_id
            
            return None
        except Exception as e:
            print(f"❌ Error: {e}")
            return None
    
    def test_simulation_status(self, job_id: str) -> bool:
        """Test simulation status endpoint"""
        print(f"\n📈 Testing Simulation Status for job: {job_id}")
        try:
            url = f"{self.base_url}/simulation/status/{job_id}"
            print(f"GET {url}")
            
            response = requests.get(url, headers=self.headers, timeout=10)
            
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text}")
            
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    
    def test_simulation_results(self, job_id: str) -> bool:
        """Test simulation results endpoint"""
        print(f"\n📋 Testing Simulation Results for job: {job_id}")
        try:
            url = f"{self.base_url}/simulation/results/{job_id}"
            print(f"GET {url}")
            
            response = requests.get(url, headers=self.headers, timeout=10)
            
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text}")
            
            # Results might not be ready yet - that's OK
            return response.status_code in [200, 404]
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    
    def test_batch_simulation(self) -> bool:
        """Test batch simulation endpoint"""
        print("\n🎯 Testing Batch Simulation...")
        try:
            url = f"{self.base_url}/simulation/batch"
            print(f"POST {url}")
            
            # Sample batch request  
            payload = {
                "project_id": str(uuid.uuid4()),
                "plant_name": "Detroit Manufacturing Plant",
                "scenarios": [
                    {
                        "scenario_id": str(uuid.uuid4()),
                        "scenario_name": "Supply Disruption Test 1"
                    },
                    {
                        "scenario_id": str(uuid.uuid4()),
                        "scenario_name": "Demand Surge Test 1"
                    }
                ],
                "simulation_horizon_days": 30,
                "monte_carlo_runs": 100,
                "baseline_enabled": True,
                "user_id": str(uuid.uuid4()),
                "user_email": "test@example.com"
            }
            
            print(f"Payload: {json.dumps(payload, indent=2)}")
            
            response = requests.post(url, headers=self.headers, json=payload, timeout=30)
            
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text}")
            
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    
    def run_comprehensive_test(self):
        """Run all simulation tests"""
        print("🔬 Starting Comprehensive Simulation Testing")
        print("=" * 60)
        
        results = {}
        
        # Test 1: Health Check
        results['health'] = self.test_health_check()
        
        # Test 2: Model Info 
        results['model_info'] = self.test_model_info()
        
        # Test 3: Critical Node Prediction
        results['prediction'] = self.test_critical_node_prediction()
        
        # Test 4: Queue Info
        results['queue'] = self.test_simulation_queue()
        
        # Test 5: Submit Simulation
        job_id = self.test_simulation_submit()
        results['submit'] = job_id is not None
        
        # Test 6: Check Status (if job was created)
        if job_id:
            results['status'] = self.test_simulation_status(job_id)
            results['results'] = self.test_simulation_results(job_id)
        else:
            results['status'] = False
            results['results'] = False
        
        # Test 7: Batch Simulation
        results['batch'] = self.test_batch_simulation()
        
        # Summary
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for v in results.values() if v)
        total = len(results)
        
        for test_name, result in results.items():
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"{test_name:20} : {status}")
        
        print(f"\nOverall: {passed}/{total} tests passed")
        
        if passed == total:
            print("🎉 All tests passed! Your simulation service is ready!")
        else:
            print("⚠️  Some tests failed. Check the logs above for details.")
        
        return results

def main():
    """Main test runner"""
    # Set UTF-8 encoding for Windows compatibility
    import sys
    import io
    if sys.platform == "win32":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
    
    # Use test config for API key
    from test_config import get_test_config
    config = get_test_config()
    
    print("🚀 Simulation Service Tester")
    print(f"Testing service at: {config['base_url']}")
    print(f"Using API Key: {config['api_key'][:20]}...")
    
    tester = SimulationTester(base_url=config['base_url'], api_key=config['api_key'])
    results = tester.run_comprehensive_test()
    
    # Exit code based on results
    if all(results.values()):
        exit(0)  # Success
    else:
        exit(1)  # Failure

if __name__ == "__main__":
    main()