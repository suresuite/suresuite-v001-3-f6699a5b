import pytest
import asyncio
from unittest.mock import Mock, AsyncMock
from app.services.simulation_engine import SimulationEngine
from app.models.data_models import SimulationParameters, SupplyChainNetwork, DisruptionScenario
from app.models.request_models import SimulationRequest

@pytest.fixture
def simulation_engine():
    # Mock dependencies for SimulationEngine
    mock_db_service = Mock()
    mock_cache_manager = Mock()
    return SimulationEngine(
        database_service=mock_db_service,
        cache_manager=mock_cache_manager,
        max_workers=2
    )

@pytest.fixture
def sample_network():
    return SupplyChainNetwork(
        project_id="test-123",
        plant_name="Test Plant",
        nodes=[],
        edges=[],
        total_nodes=0,
        total_edges=0,
        last_updated=datetime.now()
    )

@pytest.fixture
def sample_scenario():
    return DisruptionScenario(
        scenario_id="test-scenario",
        scenario_name="Test Disruption",
        affected_nodes=["node-1"],
        capacity_reduction_percent=20.0,
        duration_days=7
    )

@pytest.fixture
def sample_parameters():
    return SimulationParameters(
        simulation_horizon_days=30,
        monte_carlo_runs=100,
        enabled_kpis=["fill_rate", "revenue"]
    )

class TestSimulationEngine:
    @pytest.mark.asyncio
    async def test_run_baseline_simulation(self, simulation_engine, sample_network, sample_parameters):
        """Test baseline simulation execution"""
        # Mock the request for context
        request = SimulationRequest(
            project_id="test-project",
            plant_name="Test Plant", 
            user_id="test-user",
            user_email="test@example.com"
        )
        
        result = await simulation_engine._run_baseline_simulation(
            network=sample_network,
            sim_params=sample_parameters,
            request=request,
            job_id="test-job"
        )
        
        assert result is not None
        assert hasattr(result, 'kpi_data')
        assert hasattr(result, 'summary_statistics')

    @pytest.mark.asyncio
    async def test_run_scenario_simulation(self, simulation_engine, sample_network, sample_scenario, sample_parameters):
        """Test scenario simulation execution"""
        # Mock baseline results
        baseline_results = BaselineResults(
            kpi_data={"fill_rate": []},
            summary_statistics={"fill_rate": 0.95}
        )
        
        result = await simulation_engine._run_scenario_simulation(
            network=sample_network,
            scenario=sample_scenario,
            sim_params=sample_parameters,
            baseline_results=baseline_results,
            job_id="test-job"
        )
        
        assert result is not None
        assert hasattr(result, 'scenario_id')
        assert hasattr(result, 'kpi_data')

    @pytest.mark.asyncio
    async def test_process_simulation_request(self, simulation_engine):
        """Test end-to-end simulation request processing"""
        request = SimulationRequest(
            project_id="test-project",
            plant_name="Test Plant",
            scenario_ids=["scenario-1"],
            simulation_horizon_days=30,
            monte_carlo_runs=100,
            user_id="test-user",
            user_email="test@example.com"
        )
        
        # Mock database service methods
        simulation_engine.database_service = AsyncMock()
        simulation_engine.database_service.get_supply_chain_data.return_value = []
        simulation_engine.database_service.get_disruption_scenario.return_value = {
            'scenario_id': 'scenario-1',
            'scenario_name': 'Test',
            'affected_nodes': [],
            'capacity_reduction_percent': 10.0,
            'time_delay_days': 5
        }
        
        result = await simulation_engine.run_simulation(request, "test-job")
        
        assert result is not None
        assert hasattr(result, 'project_id')
        assert hasattr(result, 'execution_time_seconds')

    def test_comparative_analysis(self, simulation_engine):
        """Test comparative analysis between baseline and scenarios"""
        baseline_results = BaselineResults(
            kpi_data={"fill_rate": []},
            summary_statistics={"fill_rate": 0.95}
        )
        
        scenario_results = [ScenarioResults(
            scenario_id="test-scenario",
            kpi_data={"fill_rate": []},
            summary_statistics={"fill_rate": 0.85}
        )]
        
        comparison = simulation_engine._perform_comparative_analysis(baseline_results, scenario_results)
        
        assert "test-scenario" in comparison
        assert "fill_rate" in comparison["test-scenario"]
        assert comparison["test-scenario"]["fill_rate"] < 0  # Should show negative impact

    def test_data_quality_assessment(self, simulation_engine):
        """Test data quality assessment"""
        nodes = {
            "node1": type('MockNode', (), {
                'node_type': 'supplier', 
                'location_text': 'Test Location',
                'latitude': 45.0,
                'longitude': -75.0,
                'description_text': 'Test description'
            })()
        }
        edges = [
            type('MockEdge', (), {
                'material_consumption_rate': 100.0,
                'sourcing_ratio': 0.8,
                'weighted': 1.0
            })()
        ]
        
        quality_score = simulation_engine._assess_data_quality(nodes, edges)
        
        assert 0.0 <= quality_score <= 1.0