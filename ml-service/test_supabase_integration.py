#!/usr/bin/env python3
"""
Supabase Integration Test for ML Service
Tests direct database operations and RLS policy compliance.
"""

import asyncio
import aiohttp
import json
from typing import Dict, List, Any
from datetime import datetime, timezone
import uuid

# Configuration
SUPABASE_CONFIG = {
    "url": "https://wckdrutwkytwcomrlpib.supabase.co",
    "anon_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indja2RydXR3a3l0d2NvbXJscGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyOTMyNDQsImV4cCI6MjA3MDg2OTI0NH0.YREwEcTbzQYEJw5f3NVQvH0133PUglwuwU6KjHBx21Q",
    "project_id": "2bc18b3c-971d-45eb-96e1-9376ce82103c",
    "user_id": "6fb76f62-876b-4616-b926-006691742c49",
    "user_email": "modeler1@gmail.com"
}

class SupabaseIntegrationTester:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.session = None
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            headers={
                "apikey": self.config["anon_key"],
                "Authorization": f"Bearer {self.config['anon_key']}",
                "Content-Type": "application/json"
            }
        )
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

    async def set_user_context(self):
        """Set user context for RLS policies"""
        payload = {
            "user_id": self.config["user_id"],
            "user_email": self.config["user_email"]
        }
        
        async with self.session.post(
            f"{self.config['url']}/rest/v1/rpc/set_current_user_context",
            json=payload
        ) as resp:
            if resp.status != 200:
                print(f"❌ Failed to set user context: {resp.status}")
                return False
            return True

    async def test_read_projects(self) -> bool:
        """Test reading projects table with RLS"""
        try:
            async with self.session.get(
                f"{self.config['url']}/rest/v1/projects",
                params={"id": f"eq.{self.config['project_id']}"}
            ) as resp:
                data = await resp.json()
                
                if resp.status == 200 and len(data) > 0:
                    project = data[0]
                    print(f"Successfully read project: {project['name']}")
                    return True
                else:
                    print(f"❌ Failed to read project: {resp.status}")
                    return False
        except Exception as e:
            print(f"❌ Error reading projects: {e}")
            return False

    async def test_read_supply_chain_data(self) -> bool:
        """Test reading supply chain data with RLS"""
        try:
            async with self.session.get(
                f"{self.config['url']}/rest/v1/supply_chain_data",
                params={
                    "project_id": f"eq.{self.config['project_id']}",
                    "limit": "10"
                }
            ) as resp:
                data = await resp.json()
                
                if resp.status == 200:
                    print(f"Successfully read {len(data)} supply chain records")
                    return True
                else:
                    print(f"❌ Failed to read supply chain data: {resp.status}")
                    return False
        except Exception as e:
            print(f"❌ Error reading supply chain data: {e}")
            return False

    async def test_read_disruption_scenarios(self) -> bool:
        """Test reading disruption scenarios with RLS"""
        try:
            async with self.session.get(
                f"{self.config['url']}/rest/v1/disruption_scenario_profiles",
                params={
                    "project_id": f"eq.{self.config['project_id']}",
                    "limit": "5"
                }
            ) as resp:
                data = await resp.json()
                
                if resp.status == 200:
                    print(f"Successfully read {len(data)} disruption scenarios")
                    return True
                else:
                    print(f"❌ Failed to read disruption scenarios: {resp.status}")
                    return False
        except Exception as e:
            print(f"❌ Error reading disruption scenarios: {e}")
            return False

    async def test_create_simulation_result(self) -> str:
        """Test creating a simulation result"""
        try:
            test_result = {
                "project_id": self.config["project_id"],
                "plant_name": "Test Plant",
                "status": "running",
                "scenario_ids": [str(uuid.uuid4())],  # Dummy scenario ID
                "started_at": datetime.now(timezone.utc).isoformat(),
                "metrics": {
                    "test": True,
                    "created_by": "integration_test"
                },
                "result_data": {
                    "baseline": {"fill_rate": [{"day": 0, "value": 0.95}]},
                    "scenario": {"fill_rate": [{"day": 0, "value": 0.85}]}
                }
            }
            
            async with self.session.post(
                f"{self.config['url']}/rest/v1/simulation_results",
                json=test_result
            ) as resp:
                data = await resp.json()
                
                if resp.status == 201:
                    result_id = data[0]["id"] if isinstance(data, list) else data["id"]
                    print(f"Successfully created simulation result: {result_id}")
                    return result_id
                else:
                    print(f"❌ Failed to create simulation result: {resp.status}")
                    print(f"   Response: {data}")
                    return None
        except Exception as e:
            print(f"❌ Error creating simulation result: {e}")
            return None

    async def test_update_simulation_result(self, result_id: str) -> bool:
        """Test updating a simulation result"""
        try:
            update_data = {
                "status": "completed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "metrics": {
                    "test": True,
                    "updated_by": "integration_test",
                    "completion_time": datetime.now(timezone.utc).isoformat()
                }
            }
            
            async with self.session.patch(
                f"{self.config['url']}/rest/v1/simulation_results",
                params={"id": f"eq.{result_id}"},
                json=update_data
            ) as resp:
                if resp.status == 204:
                    print(f"Successfully updated simulation result: {result_id}")
                    return True
                else:
                    data = await resp.json()
                    print(f"❌ Failed to update simulation result: {resp.status}")
                    print(f"   Response: {data}")
                    return False
        except Exception as e:
            print(f"❌ Error updating simulation result: {e}")
            return False

    async def test_create_simulation_job(self) -> str:
        """Test creating a simulation job"""
        try:
            test_job = {
                "project_id": self.config["project_id"],
                "job_type": "baseline_scenario",
                "status": "pending",
                "priority": 1,
                "config": {
                    "simulation_horizon_days": 30,
                    "monte_carlo_runs": 100,
                    "baseline_enabled": True
                },
                "scenario_ids": [str(uuid.uuid4())],
                "queued_at": datetime.now(timezone.utc).isoformat()
            }
            
            async with self.session.post(
                f"{self.config['url']}/rest/v1/simulation_jobs",
                json=test_job
            ) as resp:
                data = await resp.json()
                
                if resp.status == 201:
                    job_id = data[0]["id"] if isinstance(data, list) else data["id"]
                    print(f"Successfully created simulation job: {job_id}")
                    return job_id
                else:
                    print(f"❌ Failed to create simulation job: {resp.status}")
                    print(f"   Response: {data}")
                    return None
        except Exception as e:
            print(f"❌ Error creating simulation job: {e}")
            return None

    async def test_simulation_cache_operations(self) -> bool:
        """Test simulation cache operations"""
        try:
            # Test cache write
            cache_data = {
                "project_id": self.config["project_id"],
                "cache_key": "test_baseline_data",
                "cache_type": "baseline_data",
                "data": {
                    "nodes": 10,
                    "edges": 15,
                    "test_cache": True
                },
                "data_hash": "test_hash_123",
                "expires_at": datetime.now(timezone.utc).replace(hour=23, minute=59).isoformat()
            }
            
            async with self.session.post(
                f"{self.config['url']}/rest/v1/simulation_cache",
                json=cache_data
            ) as resp:
                data = await resp.json()
                
                if resp.status == 201:
                    cache_id = data[0]["id"] if isinstance(data, list) else data["id"]
                    print(f"Successfully created cache entry: {cache_id}")
                    
                    # Test cache read
                    async with self.session.get(
                        f"{self.config['url']}/rest/v1/simulation_cache",
                        params={
                            "project_id": f"eq.{self.config['project_id']}",
                            "cache_key": "eq.test_baseline_data"
                        }
                    ) as read_resp:
                        read_data = await read_resp.json()
                        
                        if read_resp.status == 200 and len(read_data) > 0:
                            print(f"Successfully read cache entry")
                            return True
                        else:
                            print(f"❌ Failed to read cache entry: {read_resp.status}")
                            return False
                else:
                    print(f"❌ Failed to create cache entry: {resp.status}")
                    print(f"   Response: {data}")
                    return False
                    
        except Exception as e:
            print(f"❌ Error with cache operations: {e}")
            return False

    async def cleanup_test_data(self):
        """Clean up test data created during tests"""
        try:
            # Clean up simulation results created by tests
            async with self.session.delete(
                f"{self.config['url']}/rest/v1/simulation_results",
                params={"metrics->test": "eq.true"}
            ) as resp:
                print(f"🧹 Cleaned up test simulation results: {resp.status}")
            
            # Clean up simulation jobs created by tests
            async with self.session.delete(
                f"{self.config['url']}/rest/v1/simulation_jobs",
                params={"config->test": "eq.true"}
            ) as resp:
                print(f"🧹 Cleaned up test simulation jobs: {resp.status}")
            
            # Clean up test cache entries
            async with self.session.delete(
                f"{self.config['url']}/rest/v1/simulation_cache",
                params={"cache_key": "eq.test_baseline_data"}
            ) as resp:
                print(f"Cleaned up test cache entries: {resp.status}")
                
        except Exception as e:
            print(f"Error during cleanup: {e}")

async def main():
    """Run Supabase integration tests"""
    print("Supabase Integration Tester for ML Service")
    print(f"Testing connection to: {SUPABASE_CONFIG['url']}")
    print(f"Using project: {SUPABASE_CONFIG['project_id']}")
    print("="*60)
    
    async with SupabaseIntegrationTester(SUPABASE_CONFIG) as tester:
        results = []
        
        # Set user context
        print("\n👤 Setting user context for RLS...")
        context_set = await tester.set_user_context()
        results.append(("User Context", context_set))
        
        # Test read operations
        print("\n📖 Testing Read Operations...")
        results.append(("Read Projects", await tester.test_read_projects()))
        results.append(("Read Supply Chain Data", await tester.test_read_supply_chain_data()))
        results.append(("Read Disruption Scenarios", await tester.test_read_disruption_scenarios()))
        
        # Test write operations
        print("\n✏️  Testing Write Operations...")
        
        # Test simulation results
        result_id = await tester.test_create_simulation_result()
        if result_id:
            results.append(("Create Simulation Result", True))
            update_success = await tester.test_update_simulation_result(result_id)
            results.append(("Update Simulation Result", update_success))
        else:
            results.append(("Create Simulation Result", False))
            results.append(("Update Simulation Result", False))
        
        # Test simulation jobs
        job_id = await tester.test_create_simulation_job()
        results.append(("Create Simulation Job", job_id is not None))
        
        # Test cache operations
        cache_success = await tester.test_simulation_cache_operations()
        results.append(("Cache Operations", cache_success))
        
        # Cleanup
        print("\n🧹 Cleaning up test data...")
        await tester.cleanup_test_data()
        
        # Print results
        print("\n" + "="*60)
        print("📊 SUPABASE INTEGRATION TEST RESULTS")
        print("="*60)
        
        passed = sum(1 for _, success in results if success)
        total = len(results)
        
        for test_name, success in results:
            status = "PASS" if success else "FAIL"
            print(f"{test_name:25} : {status}")
        
        print(f"\nOverall: {passed}/{total} tests passed")
        
        if passed == total:
            print("All Supabase integration tests passed!")
            print("   The ML service can successfully interact with your Supabase database.")
        else:
            print("Some integration tests failed.")
            print("   Check RLS policies and database permissions.")

if __name__ == "__main__":
    asyncio.run(main())