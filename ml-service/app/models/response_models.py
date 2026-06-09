from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime
from enum import Enum

class JobStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class KPIDataPoint(BaseModel):
    """Single KPI data point with day and value"""
    day: int = Field(..., description="Day number in simulation")
    value: float = Field(..., description="KPI value for this day")

class KPIData(BaseModel):
    """Collection of KPI data points for a specific metric"""
    metric_name: str = Field(..., description="Name of the KPI metric")
    unit: str = Field(..., description="Unit of measurement")
    data_points: List[KPIDataPoint] = Field(..., description="Time series data")
    
class SimulationMetrics(BaseModel):
    """Complete simulation results with baseline and scenario data"""
    simulation_period: Dict[str, int] = Field(..., description="Start and end days")
    available_kpis: List[str] = Field(..., description="List of available KPI names")
    
    # Main results
    baseline: Dict[str, List[KPIDataPoint]] = Field(..., description="Baseline KPI data")
    scenario: Optional[Dict[str, List[KPIDataPoint]]] = Field(default=None, description="Scenario KPI data")
    
    # Summary statistics
    baseline_summary: Dict[str, float] = Field(default_factory=dict, description="Baseline summary stats")
    scenario_summary: Optional[Dict[str, float]] = Field(default=None, description="Scenario summary stats")
    
    # Impact analysis
    impact_analysis: Optional[Dict[str, float]] = Field(default=None, description="Impact percentages")

class JobPerformanceMetrics(BaseModel):
    """Performance metrics for a simulation job"""
    execution_time_seconds: Optional[float] = Field(default=None)
    data_processing_time_seconds: Optional[float] = Field(default=None)
    monte_carlo_time_seconds: Optional[float] = Field(default=None)
    
    memory_usage_mb: Optional[float] = Field(default=None)
    cpu_usage_percent: Optional[float] = Field(default=None)
    
    cache_hit_ratio: Optional[float] = Field(default=None)
    database_queries: Optional[int] = Field(default=0)
    
    convergence_iterations: Optional[int] = Field(default=None)
    accuracy_score: Optional[float] = Field(default=None)

class JobResponse(BaseModel):
    """Response for job creation and status"""
    job_id: str = Field(..., description="Unique job identifier")
    status: JobStatus = Field(..., description="Current job status")
    job_type: str = Field(..., description="Type of simulation job")
    
    # Timing information
    created_at: datetime = Field(..., description="Job creation time")
    started_at: Optional[datetime] = Field(default=None, description="Job start time")
    completed_at: Optional[datetime] = Field(default=None, description="Job completion time")
    estimated_completion: Optional[datetime] = Field(default=None, description="Estimated completion time")
    
    # Progress and status
    progress: float = Field(default=0.0, ge=0.0, le=100.0, description="Completion percentage")
    current_stage: Optional[str] = Field(default=None, description="Current processing stage")
    
    # Results (when available)
    simulation_result_id: Optional[str] = Field(default=None, description="Associated result ID")
    metrics: Optional[SimulationMetrics] = Field(default=None, description="Simulation results")
    
    # Error information
    error_message: Optional[str] = Field(default=None, description="Error message if failed")
    error_details: Optional[Dict[str, Any]] = Field(default=None, description="Detailed error info")
    
    # Performance metrics
    performance: Optional[JobPerformanceMetrics] = Field(default=None, description="Performance data")

class QueueInfo(BaseModel):
    """Information about the simulation job queue"""
    total_jobs: int = Field(default=0, description="Total jobs in system")
    pending_jobs: int = Field(default=0, description="Jobs waiting to start")
    running_jobs: int = Field(default=0, description="Currently running jobs")
    completed_jobs: int = Field(default=0, description="Completed jobs (recent)")
    failed_jobs: int = Field(default=0, description="Failed jobs (recent)")
    
    estimated_wait_time: Optional[int] = Field(default=None, description="Estimated wait time in seconds")
    average_execution_time: Optional[float] = Field(default=None, description="Average job execution time")

class BatchJobResponse(BaseModel):
    """Response for batch job creation"""
    batch_id: str = Field(..., description="Unique batch identifier")
    total_jobs: int = Field(..., description="Total number of jobs in batch")
    job_ids: List[str] = Field(..., description="List of individual job IDs")
    estimated_total_time: Optional[int] = Field(default=None, description="Estimated total time in seconds")

class JobListResponse(BaseModel):
    """Response for job listing requests"""
    jobs: List[JobResponse] = Field(..., description="List of jobs")
    total_count: int = Field(..., description="Total number of jobs matching filter")
    queue_info: QueueInfo = Field(..., description="Current queue status")
    
    # Performance insights
    performance_insights: Optional[Dict[str, Any]] = Field(default=None, description="Performance analytics")

class CacheStats(BaseModel):
    """Cache statistics and information"""
    total_entries: int = Field(default=0, description="Total cache entries")
    active_entries: int = Field(default=0, description="Non-expired entries")
    expired_entries: int = Field(default=0, description="Expired entries")
    
    total_size_mb: Optional[float] = Field(default=None, description="Total cache size")
    hit_rate_percent: Optional[float] = Field(default=None, description="Cache hit rate")
    
    cache_types: Dict[str, int] = Field(default_factory=dict, description="Entries by type")

class CacheResponse(BaseModel):
    """Response for cache operations"""
    action: str = Field(..., description="Performed action")
    success: bool = Field(..., description="Operation success status")
    
    # For get operations
    data: Optional[Dict[str, Any]] = Field(default=None, description="Cached data")
    cache_info: Optional[Dict[str, Any]] = Field(default=None, description="Cache metadata")
    
    # For set operations
    cache_id: Optional[str] = Field(default=None, description="Cache entry ID")
    expires_at: Optional[datetime] = Field(default=None, description="Cache expiration time")
    
    # For stats operations
    stats: Optional[CacheStats] = Field(default=None, description="Cache statistics")
    
    # General info
    message: Optional[str] = Field(default=None, description="Operation message")

class HealthCheckResponse(BaseModel):
    """Health check response"""
    service: str = Field(..., description="Service name")
    version: str = Field(..., description="Service version")
    status: str = Field(..., description="Overall health status")
    timestamp: datetime = Field(..., description="Check timestamp")
    
    # Component status
    components: Dict[str, Dict[str, Any]] = Field(default_factory=dict, description="Component health")
    
    # Performance metrics
    uptime_seconds: Optional[float] = Field(default=None, description="Service uptime")
    memory_usage_mb: Optional[float] = Field(default=None, description="Current memory usage")
    cpu_usage_percent: Optional[float] = Field(default=None, description="Current CPU usage")
    
    # Warnings and errors
    warnings: List[str] = Field(default_factory=list, description="Health warnings")
    errors: List[str] = Field(default_factory=list, description="Health errors")

class ErrorResponse(BaseModel):
    """Standard error response format"""
    error: str = Field(..., description="Error type or code")
    message: str = Field(..., description="Human-readable error message")
    details: Optional[Dict[str, Any]] = Field(default=None, description="Additional error details")
    timestamp: datetime = Field(default_factory=datetime.now, description="Error timestamp")
    request_id: Optional[str] = Field(default=None, description="Request identifier for tracking")