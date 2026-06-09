from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, date
from enum import Enum

class JobType(str, Enum):
    BASELINE_ONLY = "baseline_only"
    BASELINE_SCENARIO = "baseline_scenario"
    SCENARIO_ONLY = "scenario_only"
    BATCH_SCENARIOS = "batch_scenarios"

class JobPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"

class SimulationRequest(BaseModel):
    """Main simulation request model"""
    project_id: str = Field(..., description="Project UUID")
    plant_name: str = Field(..., description="Plant name for simulation")
    job_type: JobType = Field(default=JobType.BASELINE_SCENARIO)
    priority: JobPriority = Field(default=JobPriority.NORMAL)
    
    # Scenario configuration
    scenario_ids: List[str] = Field(default_factory=list, description="List of scenario UUIDs")
    baseline_enabled: bool = Field(default=True, description="Whether to compute baseline")
    
    # Simulation parameters
    simulation_horizon_days: int = Field(default=30, ge=1, le=365)
    monte_carlo_runs: int = Field(default=1000, ge=100, le=10000)
    random_seed: Optional[int] = Field(default=None, description="Seed for reproducibility")
    
    # Advanced options
    use_cache: bool = Field(default=True, description="Whether to use cached baseline data")
    force_refresh: bool = Field(default=False, description="Force refresh of cached data")
    include_sensitivity_analysis: bool = Field(default=False)
    
    # User context (for RLS)
    user_id: str = Field(..., description="User UUID for authorization")
    user_email: str = Field(..., description="User email for authorization")

class ScenarioEffect(BaseModel):
    """Individual disruption effect definition"""
    effect_type: str = Field(..., description="Type of disruption effect")
    magnitude: float = Field(..., ge=0, description="Magnitude of the effect")
    unit: str = Field(..., description="Unit of measurement")
    duration_days: Optional[int] = Field(default=None, description="Effect duration in days")
    
class ScenarioTarget(BaseModel):
    """Disruption target definition"""
    target_type: str = Field(default="node", description="Type of target (node, edge, etc.)")
    node_ids: List[str] = Field(default_factory=list, description="List of affected node IDs")
    
class ScenarioDefinition(BaseModel):
    """Complete scenario definition for simulation"""
    scenario_id: str = Field(..., description="Scenario UUID")
    scenario_name: str = Field(..., description="Human-readable scenario name")
    description: Optional[str] = Field(default=None)
    
    # Timing
    disruption_start: Optional[date] = Field(default=None)
    disruption_end: Optional[date] = Field(default=None)
    
    # Effects and targets
    targets: List[ScenarioTarget] = Field(default_factory=list)
    effects: List[ScenarioEffect] = Field(default_factory=list)
    
    # Settings
    settings: Dict[str, Any] = Field(default_factory=dict)

class BatchSimulationRequest(BaseModel):
    """Request for batch simulation processing"""
    project_id: str = Field(..., description="Project UUID")
    plant_name: str = Field(..., description="Plant name")
    scenarios: List[ScenarioDefinition] = Field(..., min_items=1, max_items=50)
    
    # Common simulation parameters
    simulation_horizon_days: int = Field(default=30, ge=1, le=365)
    monte_carlo_runs: int = Field(default=1000, ge=100, le=10000)
    baseline_enabled: bool = Field(default=True)
    
    # User context
    user_id: str = Field(..., description="User UUID")
    user_email: str = Field(..., description="User email")
    
class JobStatusRequest(BaseModel):
    """Request for job status information"""
    job_id: Optional[str] = Field(default=None, description="Specific job ID")
    project_id: Optional[str] = Field(default=None, description="Filter by project")
    user_id: str = Field(..., description="User UUID for authorization")
    user_email: str = Field(..., description="User email for authorization")
    
    # Pagination and filtering
    limit: int = Field(default=10, ge=1, le=100)
    offset: int = Field(default=0, ge=0)
    status_filter: Optional[List[str]] = Field(default=None)

class CacheRequest(BaseModel):
    """Request for cache operations"""
    action: str = Field(..., description="Cache action: get, set, invalidate, stats")
    project_id: str = Field(..., description="Project UUID")
    cache_key: Optional[str] = Field(default=None, description="Specific cache key")
    cache_type: Optional[str] = Field(default="baseline_data", description="Type of cached data")
    
    # For set operations
    data: Optional[Dict[str, Any]] = Field(default=None, description="Data to cache")
    ttl_hours: Optional[int] = Field(default=24, ge=1, le=168, description="Cache TTL in hours")
    
    # User context
    user_id: str = Field(..., description="User UUID")
    user_email: str = Field(..., description="User email")

class HealthCheckRequest(BaseModel):
    """Health check request with optional deep check"""
    deep_check: bool = Field(default=False, description="Perform deep health check")
    include_db: bool = Field(default=True, description="Include database connectivity check")
    include_cache: bool = Field(default=True, description="Include cache connectivity check")