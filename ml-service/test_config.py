#!/usr/bin/env python3
"""
Shared Test Configuration for ML Service Testing
Common configuration and utilities used across all test files.
"""

import os
from typing import Dict, Any

# Default test configuration
DEFAULT_TEST_CONFIG = {
    "base_url": "http://localhost:8000",
    "supabase_url": "https://wckdrutwkytwcomrlpib.supabase.co",
    "supabase_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indja2RydXR3a3l0d2NvbXJscGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyOTMyNDQsImV4cCI6MjA3MDg2OTI0NH0.YREwEcTbzQYEJw5f3NVQvH0133PUglwuwU6KjHBx21Q",
    "api_key": os.getenv("SIMULATION_API_KEY", "xVmsbo-WFDqJkCPQQmXGDT40lmBl9gv0p5FGZC5OvAc"),
    # Real test data from Supabase
    "project_id": "2bc18b3c-971d-45eb-96e1-9376ce82103c",
    "plant_name": "Fengtai",
    "user_id": "6fb76f62-876b-4616-b926-006691742c49",
    "user_email": "modeler1@gmail.com",
    "scenario_ids": [
        "e5b35b47-16ca-40f6-b9cf-b3a079aeb882",
        "5aed7bc7-d90c-4b76-9a87-8e10a3bb8c12",
        "16ac5f01-49cb-4ee9-b647-b2fce5a472e7"
    ],
    # Test execution settings
    "timeout_seconds": 30,
    "max_retries": 3,
    "success_threshold": 0.8  # 80% tests must pass
}

def get_test_config(overrides: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    Get test configuration with optional overrides
    
    Args:
        overrides: Dictionary of config values to override
        
    Returns:
        Complete test configuration
    """
    config = DEFAULT_TEST_CONFIG.copy()
    
    # Apply environment variable overrides
    env_overrides = {
        "base_url": os.getenv("TEST_BASE_URL"),
        "api_key": os.getenv("API_KEY"),
        "supabase_url": os.getenv("SUPABASE_URL"),
        "supabase_key": os.getenv("SUPABASE_ANON_KEY")
    }
    
    for key, value in env_overrides.items():
        if value is not None:
            config[key] = value
    
    # Apply manual overrides
    if overrides:
        config.update(overrides)
    
    return config

def validate_test_config(config: Dict[str, Any]) -> bool:
    """
    Validate that required test configuration is present
    
    Args:
        config: Test configuration dictionary
        
    Returns:
        True if valid, False otherwise
    """
    required_keys = [
        "base_url", "api_key", "supabase_url", "supabase_key",
        "project_id", "user_id", "user_email"
    ]
    
    for key in required_keys:
        if not config.get(key):
            print(f"❌ Missing required config: {key}")
            return False
    
    return True

def print_test_config(config: Dict[str, Any], hide_secrets: bool = True):
    """
    Print test configuration (with optional secret hiding)
    
    Args:
        config: Configuration to print
        hide_secrets: Whether to hide sensitive values
    """
    print("🔧 Test Configuration:")
    print("-" * 40)
    
    secret_keys = {"api_key", "supabase_key"}
    
    for key, value in config.items():
        if hide_secrets and key in secret_keys:
            # Show first 8 characters only
            display_value = f"{str(value)[:8]}..." if value else "None"
        else:
            display_value = value
            
        print(f"  {key}: {display_value}")
    print("-" * 40)

# Common test utilities
class TestMetrics:
    """Track test execution metrics"""
    
    def __init__(self):
        self.start_time = None
        self.end_time = None
        self.total_tests = 0
        self.passed_tests = 0
        self.failed_tests = 0
        self.skipped_tests = 0
    
    def start(self):
        """Mark test execution start"""
        import time
        self.start_time = time.time()
    
    def end(self):
        """Mark test execution end"""
        import time
        self.end_time = time.time()
    
    def add_result(self, success: bool):
        """Add a test result"""
        self.total_tests += 1
        if success:
            self.passed_tests += 1
        else:
            self.failed_tests += 1
    
    def skip_test(self):
        """Mark a test as skipped"""
        self.skipped_tests += 1
    
    @property
    def duration(self) -> float:
        """Get total execution duration in seconds"""
        if self.start_time and self.end_time:
            return self.end_time - self.start_time
        return 0.0
    
    @property
    def success_rate(self) -> float:
        """Get success rate as decimal (0.0 to 1.0)"""
        if self.total_tests == 0:
            return 0.0
        return self.passed_tests / self.total_tests
    
    def print_summary(self):
        """Print test metrics summary"""
        print(f"📊 Test Metrics Summary:")
        print(f"   Duration: {self.duration:.2f}s")
        print(f"   Total: {self.total_tests}")
        print(f"   Passed: {self.passed_tests}")
        print(f"   Failed: {self.failed_tests}")
        print(f"   Skipped: {self.skipped_tests}")
        print(f"   Success Rate: {self.success_rate:.1%}")