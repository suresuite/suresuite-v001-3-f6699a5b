import asyncio
import logging
import time
import random
import math
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd
import networkx as nx
from scipy import stats
import structlog

from app.models.data_models import (
    SupplyChainNetwork, SupplyChainNode, SupplyChainEdge,
    DisruptionScenario, SimulationParameters, BaselineResults,
    ScenarioResults, CombinedSimulationResults
)
from app.models.request_models import SimulationRequest, ScenarioDefinition
from app.services.database_service import DatabaseService
from app.services.cache_manager import CacheManager

logger = structlog.get_logger(__name__)

class SimulationEngine:
    """Core simulation engine for supply chain resilience analysis"""
    
    def __init__(
        self,
        database_service: DatabaseService,
        cache_manager: CacheManager,
        max_workers: int = 4
    ):
        self.database_service = database_service
        self.cache_manager = cache_manager
        self.max_workers = max_workers
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        
        # Simulation components
        self.baseline_simulator = BaselineSimulator()
        self.disruption_simulator = DisruptionSimulator()
        self.kpi_calculator = KPICalculator()
        
        logger.info("SimulationEngine initialized", max_workers=max_workers)
    
    async def run_simulation(
        self,
        request: SimulationRequest,
        job_id: str,
        progress_callback: Optional[callable] = None
    ) -> CombinedSimulationResults:
        """Run complete simulation with baseline and scenarios"""
        
        start_time = time.time()
        logger.info("Starting simulation", job_id=job_id, project_id=request.project_id)
        
        try:
            # Update progress
            if progress_callback:
                await progress_callback(job_id, 5.0, "Loading supply chain data")
            
            # Load supply chain network
            network = await self._load_supply_chain_network(
                request.project_id, request.plant_name, request.user_id, request.user_email
            )
            
            if progress_callback:
                await progress_callback(job_id, 15.0, "Preparing simulation parameters")
            
            # Prepare simulation parameters
            sim_params = self._prepare_simulation_parameters(request)
            
            # Run baseline simulation
            baseline_results = None
            if request.baseline_enabled:
                if progress_callback:
                    await progress_callback(job_id, 20.0, "Running baseline simulation")
                
                baseline_results = await self._run_baseline_simulation(
                    network, sim_params, request, job_id
                )
            
            # Run scenario simulations
            scenario_results = []
            if request.scenario_ids:
                if progress_callback:
                    await progress_callback(job_id, 50.0, "Loading disruption scenarios")
                
                scenarios = await self._load_scenarios(
                    request.scenario_ids, request.user_id, request.user_email
                )
                
                for i, scenario in enumerate(scenarios):
                    progress = 50.0 + (40.0 * (i + 1) / len(scenarios))
                    if progress_callback:
                        await progress_callback(job_id, progress, f"Running scenario: {scenario.scenario_name}")
                    
                    scenario_result = await self._run_scenario_simulation(
                        network, scenario, sim_params, baseline_results, job_id
                    )
                    scenario_results.append(scenario_result)
            
            if progress_callback:
                await progress_callback(job_id, 90.0, "Finalizing results")
            
            # Combine results
            combined_results = CombinedSimulationResults(
                project_id=request.project_id,
                plant_name=request.plant_name,
                baseline=baseline_results,
                scenarios=scenario_results,
                simulation_parameters=sim_params,
                execution_time_seconds=time.time() - start_time,
                generated_at=datetime.now()
            )
            
            # Perform comparative analysis
            if baseline_results and scenario_results:
                combined_results.scenario_comparison = self._perform_comparative_analysis(
                    baseline_results, scenario_results
                )
                combined_results.risk_assessment = self._assess_risk_metrics(
                    baseline_results, scenario_results
                )
            
            if progress_callback:
                await progress_callback(job_id, 100.0, "Simulation completed")
            
            logger.info("Simulation completed successfully", 
                       job_id=job_id, 
                       execution_time=combined_results.execution_time_seconds)
            
            return combined_results
            
        except Exception as e:
            logger.error("Simulation failed", job_id=job_id, error=str(e))
            raise
    
    async def _load_supply_chain_network(
        self, project_id: str, plant_name: str, user_id: str, user_email: str
    ) -> SupplyChainNetwork:
        """Load and construct supply chain network from database"""
        
        # Try cache first
        cache_key = f"network_{project_id}_{plant_name}"
        cached_network = await self.cache_manager.get(cache_key)
        
        if cached_network:
            logger.debug("Using cached network data", project_id=project_id)
            return SupplyChainNetwork(**cached_network)
        
        # Load from database
        network_data = await self.database_service.get_supply_chain_data(
            project_id, plant_name, user_id, user_email
        )
        
        # Process and construct network
        nodes = {}
        edges = []
        
        for record in network_data:
            # Process nodes
            for node_id in [record.get('from_location'), record.get('to_location')]:
                if node_id and node_id not in nodes:
                    # Get additional node info from node_list if available
                    node_info = await self.database_service.get_node_info(project_id, node_id)
                    
                    nodes[node_id] = SupplyChainNode(
                        node_id=node_id,
                        node_type=node_info.get('node_type', 'unknown'),
                        node_group=node_info.get('node_group'),
                        location_text=node_info.get('location_text'),
                        description_text=node_info.get('description_text'),
                        latitude=node_info.get('latitude'),
                        longitude=node_info.get('longitude'),
                        is_critical_node=node_info.get('is_critical_node', False),
                        critical_node_score=node_info.get('critical_node_score'),
                        prediction_timestamp=node_info.get('prediction_timestamp')
                    )
            
            # Process edges
            if record.get('from_location') and record.get('to_location'):
                edges.append(SupplyChainEdge(
                    from_location=record['from_location'],
                    to_location=record['to_location'],
                    data_source=record.get('data_source', 'unknown'),
                    material_consumption_rate=record.get('material_consumption_rate'),
                    sourcing_ratio=record.get('sourcing_ratio'),
                    weighted=record.get('weighted'),
                    is_critical_node=record.get('is_critical_node', False),
                    critical_node_score=record.get('critical_node_score')
                ))
        
        # Calculate network metrics
        G = nx.DiGraph()
        for edge in edges:
            G.add_edge(edge.from_location, edge.to_location, 
                      weight=edge.weighted or 1.0)
        
        network_density = nx.density(G) if G.number_of_nodes() > 1 else 0.0
        clustering_coefficient = nx.average_clustering(G.to_undirected()) if G.number_of_nodes() > 2 else 0.0
        
        network = SupplyChainNetwork(
            project_id=project_id,
            plant_name=plant_name,
            nodes=list(nodes.values()),
            edges=edges,
            total_nodes=len(nodes),
            total_edges=len(edges),
            network_density=network_density,
            clustering_coefficient=clustering_coefficient,
            last_updated=datetime.now(),
            data_quality_score=self._assess_data_quality(nodes, edges)
        )
        
        # Cache the network
        await self.cache_manager.set(cache_key, network.dict(), ttl_hours=4)
        
        return network
    
    def _prepare_simulation_parameters(self, request: SimulationRequest) -> SimulationParameters:
        """Prepare simulation parameters from request"""
        
        return SimulationParameters(
            simulation_horizon_days=request.simulation_horizon_days,
            monte_carlo_runs=request.monte_carlo_runs,
            random_seed=request.random_seed,
            start_date=datetime.now().date(),
            enabled_kpis=["fill_rate", "revenue", "profit", "delivery_on_time", "backlog"],
            demand_volatility=0.15,  # Default values, could be configurable
            supply_volatility=0.10,
            price_volatility=0.05,
            cascade_effects_enabled=True,
            resilience_mechanisms_enabled=True
        )
    
    async def _run_baseline_simulation(
        self,
        network: SupplyChainNetwork,
        sim_params: SimulationParameters,
        request: SimulationRequest,
        job_id: str
    ) -> BaselineResults:
        """Run baseline simulation without disruptions"""
        
        # Check cache for baseline results
        cache_key = f"baseline_{network.project_id}_{network.plant_name}_{sim_params.simulation_horizon_days}_{sim_params.monte_carlo_runs}"
        
        if request.use_cache and not request.force_refresh:
            cached_baseline = await self.cache_manager.get(cache_key)
            if cached_baseline:
                logger.debug("Using cached baseline results", job_id=job_id)
                return BaselineResults(**cached_baseline)
        
        logger.info("Computing baseline simulation", job_id=job_id)
        
        # Run Monte Carlo simulation
        baseline_results = await self.baseline_simulator.simulate(
            network, sim_params
        )
        
        # Cache results
        await self.cache_manager.set(cache_key, baseline_results.dict(), ttl_hours=24)
        
        return baseline_results
    
    async def _load_scenarios(
        self, scenario_ids: List[str], user_id: str, user_email: str
    ) -> List[DisruptionScenario]:
        """Load disruption scenarios from database"""
        
        scenarios = []
        for scenario_id in scenario_ids:
            scenario_data = await self.database_service.get_disruption_scenario(
                scenario_id, user_id, user_email
            )
            
            if scenario_data:
                # Convert database format to DisruptionScenario
                scenario = DisruptionScenario(
                    scenario_id=scenario_data['scenario_id'],
                    scenario_name=scenario_data['scenario_name'],
                    description=scenario_data.get('description'),
                    affected_nodes=scenario_data.get('affected_nodes', []),
                    capacity_reduction_percent=scenario_data.get('capacity_reduction_percent', 0),
                    time_delay_days=scenario_data.get('time_delay_days', 0),
                    effects=scenario_data.get('effects', []),
                    disruption_start_day=0,  # Could be configurable
                    recovery_function="exponential",
                    recovery_rate=0.1
                )
                scenarios.append(scenario)
        
        return scenarios
    
    async def _run_scenario_simulation(
        self,
        network: SupplyChainNetwork,
        scenario: DisruptionScenario,
        sim_params: SimulationParameters,
        baseline_results: BaselineResults,
        job_id: str
    ) -> ScenarioResults:
        """Run simulation with disruption scenario"""
        
        logger.info("Running scenario simulation", 
                   job_id=job_id, 
                   scenario_id=scenario.scenario_id)
        
        # Run disrupted simulation
        scenario_results = await self.disruption_simulator.simulate(
            network, scenario, sim_params, baseline_results
        )
        
        return scenario_results
    
    def _perform_comparative_analysis(
        self, baseline: BaselineResults, scenarios: List[ScenarioResults]
    ) -> Dict[str, Dict[str, float]]:
        """Perform comparative analysis between baseline and scenarios"""
        
        comparison = {}
        
        for scenario_result in scenarios:
            scenario_id = scenario_result.scenario_id
            comparison[scenario_id] = {}
            
            # Compare each KPI
            for kpi_name in baseline.summary_statistics:
                baseline_value = baseline.summary_statistics[kpi_name]
                scenario_value = scenario_result.summary_statistics.get(kpi_name, 0)
                
                if baseline_value != 0:
                    impact_percent = ((scenario_value - baseline_value) / baseline_value) * 100
                    comparison[scenario_id][kpi_name] = impact_percent
                else:
                    comparison[scenario_id][kpi_name] = 0.0
        
        return comparison
    
    def _assess_risk_metrics(
        self, baseline: BaselineResults, scenarios: List[ScenarioResults]
    ) -> Dict[str, float]:
        """Assess risk metrics across all scenarios"""
        
        # Calculate Value at Risk (VaR) and other risk metrics
        risk_metrics = {}
        
        # Collect impact data for each KPI
        for kpi_name in baseline.summary_statistics:
            impacts = []
            baseline_value = baseline.summary_statistics[kpi_name]
            
            for scenario_result in scenarios:
                scenario_value = scenario_result.summary_statistics.get(kpi_name, baseline_value)
                if baseline_value != 0:
                    impact = (scenario_value - baseline_value) / baseline_value
                    impacts.append(impact)
            
            if impacts:
                # Calculate risk metrics
                risk_metrics[f"{kpi_name}_var_95"] = np.percentile(impacts, 5)  # 95% VaR
                risk_metrics[f"{kpi_name}_cvar_95"] = np.mean([x for x in impacts if x <= np.percentile(impacts, 5)])
                risk_metrics[f"{kpi_name}_max_loss"] = min(impacts)
                risk_metrics[f"{kpi_name}_volatility"] = np.std(impacts)
        
        return risk_metrics
    
    def _assess_data_quality(self, nodes: Dict, edges: List) -> float:
        """Assess data quality score for the network"""
        
        total_checks = 0
        passed_checks = 0
        
        # Check node data completeness
        for node in nodes.values():
            total_checks += 4
            if node.node_type and node.node_type != 'unknown':
                passed_checks += 1
            if node.location_text:
                passed_checks += 1
            if node.latitude is not None and node.longitude is not None:
                passed_checks += 1
            if node.description_text:
                passed_checks += 1
        
        # Check edge data completeness
        for edge in edges:
            total_checks += 3
            if edge.material_consumption_rate is not None:
                passed_checks += 1
            if edge.sourcing_ratio is not None:
                passed_checks += 1
            if edge.weighted is not None:
                passed_checks += 1
        
        return passed_checks / total_checks if total_checks > 0 else 0.0

class BaselineSimulator:
    """Handles baseline simulation without disruptions"""
    
    async def simulate(
        self, network: SupplyChainNetwork, sim_params: SimulationParameters
    ) -> BaselineResults:
        """Run baseline Monte Carlo simulation"""
        
        logger.info("Starting baseline simulation", 
                   nodes=network.total_nodes, 
                   edges=network.total_edges,
                   monte_carlo_runs=sim_params.monte_carlo_runs)
        
        # Initialize results storage
        kpi_data = {kpi: [] for kpi in sim_params.enabled_kpis}
        
        # Run Monte Carlo simulations
        for day in range(sim_params.simulation_horizon_days):
            day_results = {}
            
            # Generate KPI values with volatility and trends
            for kpi in sim_params.enabled_kpis:
                values = []
                
                for run in range(sim_params.monte_carlo_runs):
                    # Base value with trend and seasonality
                    base_value = self._generate_kpi_baseline_value(
                        kpi, day, sim_params, network
                    )
                    
                    # Add volatility
                    volatility = self._get_kpi_volatility(kpi, sim_params)
                    noise = np.random.normal(0, volatility)
                    value = base_value * (1 + noise)
                    
                    # Ensure realistic bounds
                    value = max(0, value)
                    if kpi in ["fill_rate", "delivery_on_time"]:
                        value = min(1.0, value)
                    
                    values.append(value)
                
                # Store daily average
                day_results[kpi] = np.mean(values)
            
            # Store day results
            for kpi, value in day_results.items():
                kpi_data[kpi].append({"day": day, "value": value})
        
        # Calculate summary statistics
        summary_stats = {}
        for kpi, data_points in kpi_data.items():
            values = [point["value"] for point in data_points]
            summary_stats[kpi] = np.mean(values)
        
        # Calculate network health metrics
        network_health_score = self._calculate_network_health(network)
        supply_chain_complexity = network.network_density * network.clustering_coefficient
        resilience_index = self._calculate_resilience_index(network)
        
        return BaselineResults(
            kpi_data=kpi_data,
            summary_statistics=summary_stats,
            network_health_score=network_health_score,
            supply_chain_complexity=supply_chain_complexity,
            resilience_index=resilience_index,
            simulation_metadata={
                "monte_carlo_runs": sim_params.monte_carlo_runs,
                "simulation_horizon_days": sim_params.simulation_horizon_days,
                "generated_at": datetime.now().isoformat()
            }
        )
    
    def _generate_kpi_baseline_value(
        self, kpi: str, day: int, sim_params: SimulationParameters, network: SupplyChainNetwork
    ) -> float:
        """Generate baseline value for a specific KPI on a given day"""
        
        # Base values by KPI type
        base_values = {
            "fill_rate": 0.95,
            "revenue": 100000.0,
            "profit": 20000.0,
            "delivery_on_time": 0.92,
            "backlog": 500.0,
            "resilience_cost": 5000.0
        }
        
        base_value = base_values.get(kpi, 1000.0)
        
        # Add trend (slight improvement over time)
        trend_factor = 1 + (day * 0.001)  # 0.1% daily improvement
        
        # Add seasonality (weekly cycle)
        seasonal_factor = 1 + 0.05 * np.sin(2 * np.pi * day / 7)
        
        # Network complexity factor
        complexity_factor = 1 - (network.supply_chain_complexity * 0.1)
        
        return base_value * trend_factor * seasonal_factor * complexity_factor
    
    def _get_kpi_volatility(self, kpi: str, sim_params: SimulationParameters) -> float:
        """Get volatility factor for specific KPI"""
        
        volatilities = {
            "fill_rate": 0.05,
            "revenue": 0.10,
            "profit": 0.15,
            "delivery_on_time": 0.08,
            "backlog": 0.20,
            "resilience_cost": 0.12
        }
        
        return volatilities.get(kpi, 0.10)
    
    def _calculate_network_health(self, network: SupplyChainNetwork) -> float:
        """Calculate overall network health score"""
        
        # Factors: data quality, connectivity, criticality distribution
        data_quality = network.data_quality_score or 0.5
        
        # Connectivity health (prefer moderate density)
        optimal_density = 0.15
        density_health = 1 - abs(network.network_density - optimal_density) / optimal_density
        density_health = max(0, min(1, density_health))
        
        # Criticality distribution (prefer fewer critical nodes)
        critical_nodes = sum(1 for node in network.nodes if node.is_critical_node)
        criticality_health = max(0, 1 - (critical_nodes / len(network.nodes)))
        
        return (data_quality * 0.4 + density_health * 0.3 + criticality_health * 0.3)
    
    def _calculate_resilience_index(self, network: SupplyChainNetwork) -> float:
        """Calculate network resilience index"""
        
        # Simplified resilience calculation
        # In practice, this would consider redundancy, flexibility, visibility
        
        redundancy_score = network.clustering_coefficient
        flexibility_score = min(1.0, network.network_density * 2)
        
        return (redundancy_score * 0.5 + flexibility_score * 0.5)

class DisruptionSimulator:
    """Handles simulation with disruption scenarios"""
    
    async def simulate(
        self,
        network: SupplyChainNetwork,
        scenario: DisruptionScenario,
        sim_params: SimulationParameters,
        baseline_results: BaselineResults
    ) -> ScenarioResults:
        """Run disrupted simulation"""
        
        logger.info("Starting disruption simulation", scenario_id=scenario.scenario_id)
        
        # Initialize results storage
        kpi_data = {kpi: [] for kpi in sim_params.enabled_kpis}
        
        # Determine disruption impact timeline
        disruption_start = scenario.disruption_start_day or 0
        disruption_end = scenario.disruption_end_day or sim_params.simulation_horizon_days
        
        # Run simulation day by day
        for day in range(sim_params.simulation_horizon_days):
            day_results = {}
            
            # Determine if disruption is active
            disruption_active = disruption_start <= day <= disruption_end
            disruption_intensity = self._calculate_disruption_intensity(
                day, disruption_start, disruption_end, scenario
            )
            
            for kpi in sim_params.enabled_kpis:
                values = []
                
                # Get baseline value for this day
                baseline_day_data = next(
                    (point for point in baseline_results.kpi_data[kpi] if point["day"] == day),
                    {"value": baseline_results.summary_statistics[kpi]}
                )
                baseline_value = baseline_day_data["value"]
                
                for run in range(sim_params.monte_carlo_runs):
                    value = baseline_value
                    
                    if disruption_active:
                        # Apply disruption effects
                        value = self._apply_disruption_effects(
                            value, kpi, scenario, disruption_intensity
                        )
                        
                        # Add cascade effects
                        if sim_params.cascade_effects_enabled:
                            cascade_factor = self._calculate_cascade_effects(
                                network, scenario, day
                            )
                            value *= cascade_factor
                    
                    # Add volatility (higher during disruption)
                    volatility = self._get_disrupted_volatility(kpi, disruption_active)
                    noise = np.random.normal(0, volatility)
                    value *= (1 + noise)
                    
                    # Ensure realistic bounds
                    value = max(0, value)
                    if kpi in ["fill_rate", "delivery_on_time"]:
                        value = min(1.0, value)
                    
                    values.append(value)
                
                # Store daily average
                day_results[kpi] = np.mean(values)
            
            # Store day results
            for kpi, value in day_results.items():
                kpi_data[kpi].append({"day": day, "value": value})
        
        # Calculate summary statistics
        summary_stats = {}
        impact_percentages = {}
        
        for kpi, data_points in kpi_data.items():
            values = [point["value"] for point in data_points]
            summary_stats[kpi] = np.mean(values)
            
            # Calculate impact vs baseline
            baseline_value = baseline_results.summary_statistics[kpi]
            if baseline_value != 0:
                impact_percentages[kpi] = ((summary_stats[kpi] - baseline_value) / baseline_value) * 100
            else:
                impact_percentages[kpi] = 0.0
        
        # Calculate recovery timeline
        recovery_timeline = self._calculate_recovery_timeline(
            kpi_data, baseline_results, scenario
        )
        
        return ScenarioResults(
            scenario_id=scenario.scenario_id,
            kpi_data=kpi_data,
            summary_statistics=summary_stats,
            impact_percentages=impact_percentages,
            recovery_timeline=recovery_timeline
        )
    
    def _calculate_disruption_intensity(
        self, day: int, start_day: int, end_day: int, scenario: DisruptionScenario
    ) -> float:
        """Calculate disruption intensity for given day"""
        
        if day < start_day or day > end_day:
            return 0.0
        
        # Peak intensity at the middle of disruption period
        disruption_duration = end_day - start_day + 1
        midpoint = start_day + disruption_duration / 2
        
        # Intensity follows a bell curve
        distance_from_peak = abs(day - midpoint) / (disruption_duration / 2)
        intensity = np.exp(-distance_from_peak ** 2)
        
        return intensity
    
    def _apply_disruption_effects(
        self, value: float, kpi: str, scenario: DisruptionScenario, intensity: float
    ) -> float:
        """Apply disruption effects to KPI value"""
        
        affected_value = value
        
        # Apply capacity reduction
        if scenario.capacity_reduction_percent > 0:
            reduction_factor = (scenario.capacity_reduction_percent / 100) * intensity
            if kpi in ["fill_rate", "delivery_on_time"]:
                affected_value *= (1 - reduction_factor)
            elif kpi in ["revenue", "profit"]:
                affected_value *= (1 - reduction_factor)
            elif kpi == "backlog":
                affected_value *= (1 + reduction_factor * 2)  # Backlog increases more
        
        # Apply time delays
        if scenario.time_delay_days > 0:
            delay_factor = scenario.time_delay_days * intensity * 0.1
            if kpi == "delivery_on_time":
                affected_value *= (1 - delay_factor)
            elif kpi == "backlog":
                affected_value *= (1 + delay_factor)
        
        # Apply additional effects from scenario.effects
        for effect in scenario.effects:
            effect_type = effect.get("effect_type")
            magnitude = effect.get("magnitude", 0) * intensity
            
            if effect_type == "cost_increase" and kpi == "profit":
                cost_factor = magnitude / 100
                affected_value *= (1 - cost_factor)
        
        return affected_value
    
    def _calculate_cascade_effects(
        self, network: SupplyChainNetwork, scenario: DisruptionScenario, day: int
    ) -> float:
        """Calculate cascade effects through the network"""
        
        # Simplified cascade calculation
        # In practice, this would model network propagation
        
        cascade_factor = 1.0
        
        # If critical nodes are affected, cascade is stronger
        critical_affected = any(
            node.is_critical_node for node in network.nodes
            if node.node_id in scenario.affected_nodes
        )
        
        if critical_affected:
            cascade_factor *= 0.95  # 5% additional impact
        
        # Network density affects cascade spread
        density_factor = network.network_density * 0.1
        cascade_factor *= (1 - density_factor)
        
        return cascade_factor
    
    def _get_disrupted_volatility(self, kpi: str, disruption_active: bool) -> float:
        """Get volatility during disruption (higher than normal)"""
        
        base_volatilities = {
            "fill_rate": 0.05,
            "revenue": 0.10,
            "profit": 0.15,
            "delivery_on_time": 0.08,
            "backlog": 0.20,
            "resilience_cost": 0.12
        }
        
        base_vol = base_volatilities.get(kpi, 0.10)
        
        # Increase volatility during disruption
        if disruption_active:
            base_vol *= 2.0
        
        return base_vol
    
    def _calculate_recovery_timeline(
        self, kpi_data: Dict, baseline_results: BaselineResults, scenario: DisruptionScenario
    ) -> Dict[str, float]:
        """Calculate recovery progression over time"""
        
        recovery_timeline = {}
        
        # For each KPI, find when it returns to baseline levels
        for kpi, data_points in kpi_data.items():
            baseline_value = baseline_results.summary_statistics[kpi]
            
            recovery_day = None
            for point in reversed(data_points):  # Start from end
                if abs(point["value"] - baseline_value) / baseline_value < 0.05:  # Within 5%
                    recovery_day = point["day"]
                    break
            
            if recovery_day is not None:
                recovery_timeline[kpi] = recovery_day
            else:
                recovery_timeline[kpi] = len(data_points)  # Full period
        
        return recovery_timeline

class KPICalculator:
    """Handles KPI calculations and metrics"""
    
    def __init__(self):
        self.kpi_definitions = {
            "fill_rate": "Percentage of demand fulfilled on time",
            "revenue": "Total revenue generated",
            "profit": "Net profit after all costs",
            "delivery_on_time": "Percentage of on-time deliveries",
            "backlog": "Number of unfulfilled orders",
            "resilience_cost": "Cost of resilience measures"
        }
    
    def calculate_kpi(self, kpi_name: str, data: Dict[str, Any]) -> float:
        """Calculate specific KPI value from data"""
        
        # This would contain actual KPI calculation logic
        # For now, return placeholder values
        
        if kpi_name == "fill_rate":
            return self._calculate_fill_rate(data)
        elif kpi_name == "revenue":
            return self._calculate_revenue(data)
        elif kpi_name == "profit":
            return self._calculate_profit(data)
        # Add more KPI calculations as needed
        
        return 0.0
    
    def _calculate_fill_rate(self, data: Dict[str, Any]) -> float:
        """Calculate fill rate from supply chain data"""
        # Placeholder implementation
        return 0.95
    
    def _calculate_revenue(self, data: Dict[str, Any]) -> float:
        """Calculate revenue from supply chain data"""
        # Placeholder implementation
        return 100000.0
    
    def _calculate_profit(self, data: Dict[str, Any]) -> float:
        """Calculate profit from supply chain data"""
        # Placeholder implementation
        return 20000.0