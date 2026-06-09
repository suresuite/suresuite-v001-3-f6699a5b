from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

class SupplyChainNode(BaseModel):
    """Supply chain node representation"""
    node_id: str = Field(..., description="Unique node identifier")
    node_type: str = Field(..., description="Node type (supplier, material, product, customer)")
    node_group: Optional[str] = Field(default=None, description="Node grouping category")
    
    # Location and description
    location_text: Optional[str] = Field(default=None, description="Human-readable location")
    description_text: Optional[str] = Field(default=None, description="Node description")
    latitude: Optional[float] = Field(default=None, description="Geographic latitude")
    longitude: Optional[float] = Field(default=None, description="Geographic longitude")
    
    # Criticality and predictions
    is_critical_node: Optional[bool] = Field(default=False, description="Whether node is critical")
    critical_node_score: Optional[float] = Field(default=None, ge=0, le=1, description="Criticality score")
    prediction_timestamp: Optional[datetime] = Field(default=None, description="Last prediction update")

class SupplyChainEdge(BaseModel):
    """Supply chain relationship/flow"""
    from_location: str = Field(..., description="Source node ID")
    to_location: str = Field(..., description="Destination node ID")
    data_source: str = Field(..., description="Data source (inbound, outbound, bom)")
    
    # Flow characteristics
    material_consumption_rate: Optional[float] = Field(default=None, ge=0, description="Material flow rate")
    sourcing_ratio: Optional[float] = Field(default=None, ge=0, le=1, description="Sourcing percentage")
    weighted: Optional[float] = Field(default=None, description="Edge weight/importance")
    
    # Criticality
    is_critical_node: Optional[bool] = Field(default=False, description="Whether edge involves critical nodes")
    critical_node_score: Optional[float] = Field(default=None, description="Associated criticality score")

class SupplyChainNetwork(BaseModel):
    """Complete supply chain network representation"""
    project_id: str = Field(..., description="Project identifier")
    plant_name: str = Field(..., description="Plant name")
    
    nodes: List[SupplyChainNode] = Field(..., description="Network nodes")
    edges: List[SupplyChainEdge] = Field(..., description="Network edges")
    
    # Network metrics
    total_nodes: int = Field(..., description="Total number of nodes")
    total_edges: int = Field(..., description="Total number of edges")
    network_density: Optional[float] = Field(default=None, description="Network density metric")
    clustering_coefficient: Optional[float] = Field(default=None, description="Network clustering")
    
    # Metadata
    last_updated: datetime = Field(..., description="Last network update")
    data_quality_score: Optional[float] = Field(default=None, ge=0, le=1, description="Data quality assessment")

class DisruptionScenario(BaseModel):
    """Complete disruption scenario definition"""
    scenario_id: str = Field(..., description="Scenario identifier")
    scenario_name: str = Field(..., description="Scenario name")
    description: Optional[str] = Field(default=None, description="Scenario description")
    
    # Affected targets
    affected_nodes: List[str] = Field(default_factory=list, description="List of affected node IDs")
    affected_edges: List[Dict[str, str]] = Field(default_factory=list, description="List of affected edges")
    
    # Disruption effects
    capacity_reduction_percent: Optional[float] = Field(default=0, ge=0, le=100)
    time_delay_days: Optional[float] = Field(default=0, ge=0)
    cost_increase_percent: Optional[float] = Field(default=0, ge=0)
    
    # Advanced effects
    effects: List[Dict[str, Any]] = Field(default_factory=list, description="Detailed effect definitions")
    
    # Temporal aspects
    disruption_start_day: Optional[int] = Field(default=0, description="Start day in simulation")
    disruption_end_day: Optional[int] = Field(default=None, description="End day in simulation")
    
    # Recovery characteristics
    recovery_function: Optional[str] = Field(default="linear", description="Recovery pattern")
    recovery_rate: Optional[float] = Field(default=0.1, ge=0, le=1, description="Daily recovery rate")

class SimulationParameters(BaseModel):
    """Complete simulation configuration"""
    # Time horizon
    simulation_horizon_days: int = Field(..., ge=1, le=365, description="Simulation duration")
    start_date: Optional[datetime] = Field(default=None, description="Simulation start date")
    
    # Monte Carlo configuration
    monte_carlo_runs: int = Field(..., ge=100, le=10000, description="Number of MC simulations")
    random_seed: Optional[int] = Field(default=None, description="Random seed for reproducibility")
    
    # KPI configuration
    enabled_kpis: List[str] = Field(default_factory=lambda: ["fill_rate", "revenue", "profit"], description="KPIs to calculate")
    custom_kpi_definitions: Dict[str, Any] = Field(default_factory=dict, description="Custom KPI formulas")
    
    # Volatility and uncertainty
    demand_volatility: float = Field(default=0.1, ge=0, le=1, description="Demand uncertainty")
    supply_volatility: float = Field(default=0.05, ge=0, le=1, description="Supply uncertainty")
    price_volatility: float = Field(default=0.03, ge=0, le=1, description="Price uncertainty")
    
    # Network effects
    cascade_effects_enabled: bool = Field(default=True, description="Enable disruption cascading")
    resilience_mechanisms_enabled: bool = Field(default=True, description="Enable resilience responses")
    
    # Performance parameters
    convergence_threshold: float = Field(default=0.001, gt=0, description="Convergence criteria")
    max_iterations: int = Field(default=1000, ge=100, description="Maximum simulation iterations")

class BaselineResults(BaseModel):
    """Baseline simulation results"""
    kpi_data: Dict[str, List[Dict[str, float]]] = Field(..., description="KPI time series data")
    summary_statistics: Dict[str, float] = Field(..., description="Summary stats per KPI")
    
    # Network health metrics
    network_health_score: Optional[float] = Field(default=None, ge=0, le=1)
    supply_chain_complexity: Optional[float] = Field(default=None, ge=0)
    resilience_index: Optional[float] = Field(default=None, ge=0, le=1)
    
    # Performance metrics
    simulation_metadata: Dict[str, Any] = Field(default_factory=dict, description="Simulation run metadata")

class ScenarioResults(BaseModel):
    """Scenario-specific simulation results"""
    scenario_id: str = Field(..., description="Associated scenario ID")
    kpi_data: Dict[str, List[Dict[str, float]]] = Field(..., description="KPI time series data")
    summary_statistics: Dict[str, float] = Field(..., description="Summary stats per KPI")
    
    # Impact analysis
    impact_percentages: Dict[str, float] = Field(default_factory=dict, description="Impact vs baseline")
    recovery_timeline: Optional[Dict[str, float]] = Field(default=None, description="Recovery progression")
    
    # Disruption propagation
    affected_nodes_timeline: Optional[Dict[int, List[str]]] = Field(default=None, description="Propagation over time")
    cascade_analysis: Optional[Dict[str, Any]] = Field(default=None, description="Cascade effect analysis")

class CombinedSimulationResults(BaseModel):
    """Complete simulation results combining baseline and scenarios"""
    project_id: str = Field(..., description="Project identifier")
    plant_name: str = Field(..., description="Plant name")
    
    # Results data
    baseline: BaselineResults = Field(..., description="Baseline simulation results")
    scenarios: List[ScenarioResults] = Field(default_factory=list, description="Scenario results")
    
    # Comparative analysis
    scenario_comparison: Optional[Dict[str, Dict[str, float]]] = Field(default=None, description="Cross-scenario comparison")
    risk_assessment: Optional[Dict[str, float]] = Field(default=None, description="Risk metrics")
    
    # Simulation metadata
    simulation_parameters: SimulationParameters = Field(..., description="Used simulation parameters")
    execution_time_seconds: float = Field(..., description="Total execution time")
    generated_at: datetime = Field(..., description="Results generation timestamp")