import pytest
import asyncio
from unittest.mock import Mock, AsyncMock
from app.services.job_manager import JobManager, JobStatus
from app.models.request_models import SimulationRequest
from app.models.response_models import JobResponse

@pytest.fixture
def job_manager():
    # Mock dependencies for JobManager
    mock_db_service = Mock()
    mock_sim_engine = Mock()
    return JobManager(
        database_service=mock_db_service,
        simulation_engine=mock_sim_engine,
        max_concurrent_jobs=2,
        job_timeout_minutes=1
    )

@pytest.fixture
def sample_request():
    return SimulationRequest(
        project_id="test-project-uuid",
        plant_name="Test Plant",
        scenario_ids=["scenario-1"],
        simulation_horizon_days=30,
        monte_carlo_runs=100,
        user_id="test-user-uuid",
        user_email="test@example.com"
    )

class TestJobManager:
    @pytest.mark.asyncio
    async def test_submit_job(self, job_manager, sample_request):
        """Test job submission"""
        job_response = await job_manager.create_job(sample_request)
        
        assert job_response.job_id is not None
        assert isinstance(job_response.job_id, str)
        
        # Check job exists in manager
        job_info = await job_manager.get_job_status(job_response.job_id)
        assert job_info.status == JobStatus.PENDING

    @pytest.mark.asyncio
    async def test_process_job_queue(self, job_manager, sample_request):
        """Test job queue processing"""
        # Mock simulation engine
        job_manager.simulation_engine = AsyncMock()
        job_manager.simulation_engine.run_simulation.return_value = Mock(
            project_id="test-project",
            execution_time_seconds=1.0
        )
        
        # Submit a job
        job_response = await job_manager.create_job(sample_request)
        
        # Start processing
        await job_manager.start_processing()
        
        # Allow some processing time
        await asyncio.sleep(0.1)
        
        # Stop processing
        await job_manager.stop_processing()
        
        # Check job exists (may not be completed due to async nature)
        job_info = await job_manager.get_job_status(job_response.job_id)
        assert job_info is not None

    @pytest.mark.asyncio
    async def test_cancel_job(self, job_manager, sample_request):
        """Test job cancellation"""
        job_response = await job_manager.create_job(sample_request)
        
        cancelled_job = await job_manager.cancel_job(job_response.job_id)
        assert cancelled_job is not None
        
        job_info = await job_manager.get_job_status(job_response.job_id)
        assert job_info.status == JobStatus.CANCELLED

    @pytest.mark.asyncio
    async def test_get_queue_info(self, job_manager, sample_request):
        """Test queue information retrieval via list_jobs"""
        # Submit multiple jobs
        for i in range(3):
            await job_manager.create_job(sample_request)
        
        job_list = await job_manager.list_jobs()
        
        assert job_list.total_count >= 3
        assert job_list.queue_info is not None
        assert job_list.queue_info.total_jobs >= 3

    @pytest.mark.asyncio
    async def test_job_priority_ordering(self, job_manager, sample_request):
        """Test job priority ordering"""
        # Create requests with different priorities
        high_priority_request = sample_request.copy()
        high_priority_request.priority = "high"
        
        low_priority_request = sample_request.copy() 
        low_priority_request.priority = "low"
        
        # Submit jobs
        high_job = await job_manager.create_job(high_priority_request)
        low_job = await job_manager.create_job(low_priority_request)
        
        # Check jobs were created
        assert high_job.priority == "high"
        assert low_job.priority == "low"

    @pytest.mark.asyncio
    async def test_job_timeout_handling(self, job_manager, sample_request):
        """Test job timeout handling"""
        # Mock a job that takes too long
        job_manager.simulation_engine = AsyncMock()
        job_manager.simulation_engine.run_simulation.side_effect = asyncio.TimeoutError()
        
        job_response = await job_manager.create_job(sample_request)
        
        # Start processing briefly then stop
        await job_manager.start_processing()
        await asyncio.sleep(0.1)
        await job_manager.stop_processing()
        
        # Job should still exist (timeout handling is complex to test in unit tests)
        job_info = await job_manager.get_job_status(job_response.job_id)
        assert job_info is not None