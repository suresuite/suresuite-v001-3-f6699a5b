import asyncio
import uuid
from typing import Dict, List, Optional, Any
from datetime import datetime
from dataclasses import dataclass

import structlog

from app.config import settings
from app.models.request_models import (
    SimulationRequest, BatchSimulationRequest, JobType, JobPriority
)
from app.models.response_models import (
    JobResponse, BatchJobResponse, JobListResponse, JobStatus,
    JobPerformanceMetrics, QueueInfo
)
from app.services.simulation_engine import SimulationEngine
from app.services.database_service import DatabaseService

logger = structlog.get_logger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Internal data
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class JobInfo:
    """Internal job information structure"""
    job_id: str
    status: JobStatus
    job_type: JobType
    priority: JobPriority
    project_id: str
    plant_name: str

    # Request data
    request_data: Dict[str, Any]

    # Timing (UTC)
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    # Progress (0–100)
    progress: float = 0.0
    current_stage: Optional[str] = None

    # Results
    simulation_result_id: Optional[str] = None
    results: Optional[Dict[str, Any]] = None

    # Error handling
    error_message: Optional[str] = None
    error_details: Optional[Dict[str, Any]] = None

    # Performance
    performance_metrics: Optional[JobPerformanceMetrics] = None


# ──────────────────────────────────────────────────────────────────────────────
# Job Manager
# ──────────────────────────────────────────────────────────────────────────────

class JobManager:
    """Manages simulation job lifecycle and execution"""

    def __init__(
        self,
        database_service: Optional[DatabaseService] = None,
        simulation_engine: Optional[SimulationEngine] = None,
        max_concurrent_jobs: Optional[int] = None,
        job_timeout_minutes: Optional[int] = None,
    ):
        # DI with sane defaults
        self.database_service = database_service or DatabaseService()
        self.simulation_engine = simulation_engine or SimulationEngine()

        # Pull defaults from settings if not provided
        self.max_concurrent_jobs = max_concurrent_jobs or settings.max_workers
        self.job_timeout_minutes = job_timeout_minutes or settings.job_timeout_minutes

        # Job storage and management
        self.active_jobs: Dict[str, JobInfo] = {}
        self.job_queue: asyncio.Queue[str] = asyncio.Queue()
        self.running_jobs: Dict[str, asyncio.Task] = {}

        # Processing control
        self.processing_enabled = False
        self.processor_tasks: List[asyncio.Task] = []

        # Statistics
        self.total_jobs_processed = 0
        self.total_jobs_failed = 0

        logger.info(
            "JobManager initialized",
            max_concurrent_jobs=self.max_concurrent_jobs,
            job_timeout_minutes=self.job_timeout_minutes,
        )

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def initialize(self):
        """Initialize job manager and recover any existing jobs (mark as failed if mid-run)."""
        try:
            existing_jobs = await self.database_service.get_active_jobs()
            recovered = 0
            for job_data in existing_jobs or []:
                job_info = self._create_job_info_from_db(job_data)
                self.active_jobs[job_info.job_id] = job_info
                if job_info.status == JobStatus.RUNNING:
                    job_info.status = JobStatus.FAILED
                    job_info.error_message = "Service restarted during execution"
                    job_info.completed_at = datetime.utcnow()
                    await self._update_job_in_database(job_info)
                    recovered += 1

            logger.info("JobManager initialize complete", recovered_jobs=recovered, active=len(self.active_jobs))
        except Exception as e:
            logger.error("JobManager initialize failed", error=str(e))
            raise

    async def start_processing(self):
        """Start background job processing."""
        if self.processing_enabled:
            return
        self.processing_enabled = True
        # Spin up N processors
        for i in range(self.max_concurrent_jobs):
            task = asyncio.create_task(self._job_processor(f"processor-{i}"))
            self.processor_tasks.append(task)
        logger.info("Job processing started", processors=len(self.processor_tasks))

    async def stop_processing(self):
        """Stop background job processing."""
        if not self.processing_enabled:
            return
        self.processing_enabled = False

        # Cancel all running job tasks
        for job_id, task in list(self.running_jobs.items()):
            task.cancel()
            job_info = self.active_jobs.get(job_id)
            if job_info:
                job_info.status = JobStatus.CANCELLED
                job_info.error_message = "Service shutdown"
                job_info.completed_at = datetime.utcnow()
                await self._update_job_in_database(job_info)

        # Stop processors
        for task in self.processor_tasks:
            task.cancel()
        await asyncio.gather(*self.processor_tasks, return_exceptions=True)
        self.processor_tasks.clear()

        logger.info("Job processing stopped")

    # ── public API ───────────────────────────────────────────────────────────

    async def create_job(self, request: SimulationRequest) -> JobResponse:
        """Create a new simulation job and enqueue it."""
        try:
            job_id = str(uuid.uuid4())
            # Store request payload as plain dict (Pydantic v2)
            req_payload = request.model_dump()

            job_info = JobInfo(
                job_id=job_id,
                status=JobStatus.PENDING,
                job_type=JobType(request.job_type),
                priority=JobPriority(request.priority),
                project_id=str(request.project_id),
                plant_name=request.plant_name,
                request_data=req_payload,
                created_at=datetime.utcnow(),
            )

            self.active_jobs[job_id] = job_info
            await self._save_job_to_database(job_info)

            # Enqueue and mark queued
            await self.job_queue.put(job_id)
            job_info.status = JobStatus.QUEUED
            await self._update_job_in_database(job_info)

            logger.info(
                "Job created",
                job_id=job_id,
                project_id=job_info.project_id,
                job_type=job_info.job_type.value,
            )
            return self._create_job_response(job_info)
        except Exception as e:
            logger.error("Failed to create job", error=str(e))
            raise

    async def create_batch_jobs(self, request: BatchSimulationRequest) -> BatchJobResponse:
        """Create multiple jobs for batch processing."""
        try:
            batch_id = str(uuid.uuid4())
            job_ids: List[str] = []

            for i, scenario_def in enumerate(request.scenarios):
                sim_request = SimulationRequest(
                    project_id=request.project_id,
                    plant_name=request.plant_name,
                    job_type=JobType.SCENARIO_ONLY,
                    scenario_ids=[scenario_def.scenario_id],
                    simulation_horizon_days=request.simulation_horizon_days,
                    monte_carlo_runs=request.monte_carlo_runs,
                    baseline_enabled=(request.baseline_enabled and i == 0),  # First job runs baseline
                    user_id=request.user_id,
                    user_email=request.user_email,
                )
                job_response = await self.create_job(sim_request)
                job_ids.append(job_response.job_id)

            # ~60s per job placeholder
            estimated_time = len(job_ids) * 60

            logger.info("Batch jobs created", batch_id=batch_id, total_jobs=len(job_ids))
            return BatchJobResponse(
                batch_id=batch_id,
                total_jobs=len(job_ids),
                job_ids=job_ids,
                estimated_total_time=estimated_time,
            )
        except Exception as e:
            logger.error("Failed to create batch jobs", error=str(e))
            raise

    async def get_job_status(self, job_id: str) -> Optional[JobResponse]:
        """Get status for a specific job."""
        job_info = self.active_jobs.get(job_id)
        if not job_info:
            job_data = await self.database_service.get_job_by_id(job_id)
            if not job_data:
                return None
            job_info = self._create_job_info_from_db(job_data)
            self.active_jobs[job_id] = job_info
        return self._create_job_response(job_info)

    async def list_jobs(
        self,
        project_id: Optional[str] = None,
        status_filter: Optional[List[str]] = None,
        limit: int = 10,
        offset: int = 0,
    ) -> JobListResponse:
        """List jobs with filtering and pagination."""
        try:
            jobs_data = await self.database_service.list_jobs(
                project_id=project_id,
                status_filter=status_filter,
                limit=limit,
                offset=offset,
            )

            jobs: List[JobResponse] = []
            for jd in jobs_data or []:
                ji = self.active_jobs.get(jd['job_id']) or self._create_job_info_from_db(jd)
                jobs.append(self._create_job_response(ji))

            total_count = await self.database_service.count_jobs(
                project_id=project_id,
                status_filter=status_filter,
            )
            queue_info = await self._get_queue_info()

            return JobListResponse(jobs=jobs, total_count=total_count, queue_info=queue_info)
        except Exception as e:
            logger.error("Failed to list jobs", error=str(e))
            raise

    async def cancel_job(self, job_id: str) -> JobResponse:
        """Cancel a running or queued job."""
        job_info = self.active_jobs.get(job_id)
        if not job_info:
            raise ValueError(f"Job {job_id} not found")

        if job_info.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
            raise ValueError(f"Job {job_id} cannot be cancelled (status: {job_info.status})")

        try:
            if job_id in self.running_jobs:
                self.running_jobs[job_id].cancel()

            job_info.status = JobStatus.CANCELLED
            job_info.completed_at = datetime.utcnow()
            job_info.error_message = "Job cancelled by user"

            await self._update_job_in_database(job_info)
            logger.info("Job cancelled", job_id=job_id)
            return self._create_job_response(job_info)
        except Exception as e:
            logger.error("Failed to cancel job", job_id=job_id, error=str(e))
            raise

    # ── processors ────────────────────────────────────────────────────────────

    async def _job_processor(self, processor_name: str):
        """Background job processor loop."""
        logger.info("Job processor started", processor=processor_name)
        while self.processing_enabled:
            try:
                job_id = await asyncio.wait_for(self.job_queue.get(), timeout=5.0)
                await self._process_job(job_id, processor_name)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Job processor error", processor=processor_name, error=str(e))
                continue
        logger.info("Job processor stopped", processor=processor_name)

    async def _process_job(self, job_id: str, processor_name: str):
        """Process a single job end-to-end."""
        job_info = self.active_jobs.get(job_id)
        if not job_info:
            logger.warning("Job not found in active jobs", job_id=job_id)
            return

        start_time = datetime.utcnow()

        try:
            if job_info.status not in (JobStatus.QUEUED, JobStatus.PENDING):
                logger.warning("Job status invalid for processing", job_id=job_id, status=job_info.status)
                return

            logger.info("Processing job", job_id=job_id, processor=processor_name, job_type=job_info.job_type.value)

            job_info.status = JobStatus.RUNNING
            job_info.started_at = start_time
            job_info.current_stage = "Initializing"
            await self._update_job_in_database(job_info)

            # Progress callback normalizes [0,1] -> [0,100]
            async def progress_callback(jid: str, progress: float, stage: str):
                pct = float(progress)
                if pct <= 1.0:  # most engines report 0..1
                    pct *= 100.0
                job_info.progress = max(0.0, min(100.0, pct))
                job_info.current_stage = stage
                await self._update_job_progress(jid, job_info.progress, stage)

            # Recreate request
            sim_request = SimulationRequest(**job_info.request_data)

            # Kick off simulation
            task = asyncio.create_task(
                self.simulation_engine.run_simulation(
                    sim_request, job_id, progress_callback
                )
            )
            self.running_jobs[job_id] = task

            # Wait with timeout
            timeout_seconds = int(self.job_timeout_minutes * 60)
            results = await asyncio.wait_for(task, timeout=timeout_seconds)

            # Success
            job_info.status = JobStatus.COMPLETED
            job_info.completed_at = datetime.utcnow()
            job_info.progress = 100.0
            job_info.current_stage = "Completed"

            # Pydantic v2 safe dump
            job_info.results = results.model_dump() if hasattr(results, "model_dump") else (
                results.dict() if hasattr(results, "dict") else results
            )

            # Performance metrics
            execution_time = (job_info.completed_at - job_info.started_at).total_seconds() if job_info.started_at else None
            job_info.performance_metrics = JobPerformanceMetrics(
                execution_time_seconds=execution_time or 0.0,
                convergence_iterations=sim_request.monte_carlo_runs,
            )

            # Persist results
            result_id = await self.database_service.save_simulation_results(results)
            job_info.simulation_result_id = result_id

            await self._update_job_in_database(job_info)
            self.total_jobs_processed += 1

            logger.info(
                "Job completed",
                job_id=job_id,
                execution_time_seconds=execution_time,
                result_id=result_id,
            )

        except asyncio.TimeoutError:
            job_info.status = JobStatus.FAILED
            job_info.completed_at = datetime.utcnow()
            job_info.error_message = f"Job timed out after {self.job_timeout_minutes} minutes"
            await self._update_job_in_database(job_info)
            self.total_jobs_failed += 1
            logger.warning("Job timed out", job_id=job_id, timeout_minutes=self.job_timeout_minutes)

        except asyncio.CancelledError:
            job_info.status = JobStatus.CANCELLED
            job_info.completed_at = datetime.utcnow()
            job_info.error_message = "Job was cancelled"
            await self._update_job_in_database(job_info)
            logger.info("Job was cancelled", job_id=job_id)

        except Exception as e:
            job_info.status = JobStatus.FAILED
            job_info.completed_at = datetime.utcnow()
            job_info.error_message = str(e)
            job_info.error_details = {"error_type": type(e).__name__}
            await self._update_job_in_database(job_info)
            self.total_jobs_failed += 1
            logger.error("Job failed", job_id=job_id, error=str(e))

        finally:
            # Cleanup
            task = self.running_jobs.pop(job_id, None)
            if task and not task.cancelled() and not task.done():
                task.cancel()

    # ── DB helpers ────────────────────────────────────────────────────────────

    async def _update_job_progress(self, job_id: str, progress_pct: float, stage: str):
        """Update job progress in database (expects 0–100)."""
        try:
            await self.database_service.update_job_progress(job_id, progress_pct, stage)
        except Exception as e:
            logger.warning("Failed to update job progress", job_id=job_id, error=str(e))

    async def _save_job_to_database(self, job_info: JobInfo):
        """Save job to database."""
        job_data = {
            "job_id": job_info.job_id,
            "status": job_info.status.value,
            "job_type": job_info.job_type.value,
            "priority": job_info.priority.value,
            "project_id": job_info.project_id,
            "plant_name": job_info.plant_name,
            "config": job_info.request_data,
            "created_at": job_info.created_at,
            "progress": job_info.progress,
            "current_stage": job_info.current_stage,
        }
        await self.database_service.save_job(job_data)

    async def _update_job_in_database(self, job_info: JobInfo):
        """Update job in database."""
        job_data = {
            "job_id": job_info.job_id,
            "status": job_info.status.value,
            "progress": job_info.progress,
            "current_stage": job_info.current_stage,
            "started_at": job_info.started_at,
            "completed_at": job_info.completed_at,
            "simulation_result_id": job_info.simulation_result_id,
            "error_message": job_info.error_message,
            "error_details": job_info.error_details,
            "performance_metrics": (
                job_info.performance_metrics.model_dump()
                if job_info.performance_metrics and hasattr(job_info.performance_metrics, "model_dump")
                else (job_info.performance_metrics.dict() if job_info.performance_metrics else None)
            ),
        }
        await self.database_service.update_job(job_data)

    # ── conversions ───────────────────────────────────────────────────────────

    def _create_job_info_from_db(self, job_data: Dict[str, Any]) -> JobInfo:
        """Create JobInfo from database data (tolerant to missing fields)."""
        perf = job_data.get("performance_metrics")
        perf_obj = None
        if perf:
            # Accept dicts with either v1/v2 pydantic shapes
            perf_obj = JobPerformanceMetrics(**perf) if isinstance(perf, dict) else perf

        # Handle priority conversion from DB integer to enum
        priority_value = job_data.get("priority", 1)
        if isinstance(priority_value, int):
            # Map integer priorities to enum values
            priority_map = {1: JobPriority.LOW, 2: JobPriority.NORMAL, 3: JobPriority.HIGH, 4: JobPriority.URGENT}
            priority = priority_map.get(priority_value, JobPriority.NORMAL)
        else:
            priority = JobPriority(priority_value) if priority_value else JobPriority.NORMAL

        return JobInfo(
            job_id=job_data["job_id"],
            status=JobStatus(job_data["status"]),
            job_type=JobType(job_data.get("job_type", JobType.BASELINE_SCENARIO.value)),
            priority=priority,
            project_id=str(job_data["project_id"]),
            plant_name=job_data.get("plant_name", ""),
            request_data=job_data.get("config", {}) or {},
            created_at=job_data.get("created_at") or datetime.utcnow(),
            started_at=job_data.get("started_at"),
            completed_at=job_data.get("completed_at"),
            progress=float(job_data.get("progress", 0.0)),
            current_stage=job_data.get("current_stage"),
            simulation_result_id=job_data.get("simulation_result_id"),
            error_message=job_data.get("error_message"),
            error_details=job_data.get("error_details"),
            performance_metrics=perf_obj,
        )

    def _create_job_response(self, job_info: JobInfo) -> JobResponse:
        """Create JobResponse from JobInfo."""
        estimated_completion = None
        if job_info.status == JobStatus.RUNNING and job_info.started_at and job_info.progress > 0.0:
            elapsed = datetime.utcnow() - job_info.started_at
            # naive estimate: elapsed / progress% → total
            total_estimated = elapsed * (100.0 / job_info.progress)
            estimated_completion = job_info.started_at + total_estimated

        return JobResponse(
            job_id=job_info.job_id,
            status=job_info.status,
            job_type=job_info.job_type.value,
            created_at=job_info.created_at,
            started_at=job_info.started_at,
            completed_at=job_info.completed_at,
            estimated_completion=estimated_completion,
            progress=job_info.progress,
            current_stage=job_info.current_stage,
            simulation_result_id=job_info.simulation_result_id,
            error_message=job_info.error_message,
            error_details=job_info.error_details,
            performance=job_info.performance_metrics,
        )

    # ── queue diagnostics ─────────────────────────────────────────────────────

    async def _get_queue_info(self) -> QueueInfo:
        """Get current queue information."""
        pending_jobs = sum(1 for j in self.active_jobs.values() if j.status == JobStatus.PENDING)
        queued_jobs = sum(1 for j in self.active_jobs.values() if j.status == JobStatus.QUEUED)
        running_jobs = len(self.running_jobs)

        # Convert enum to string for database queries
        recent_completed = await self.database_service.count_recent_jobs(JobStatus.COMPLETED.value)
        recent_failed = await self.database_service.count_recent_jobs(JobStatus.FAILED.value)

        estimated_wait_time = None
        if queued_jobs > 0:
            avg_execution_time = 300.0  # seconds; TODO: compute rolling average
            # capacity = max concurrent – currently running (avoid zero)
            capacity = max(1, self.max_concurrent_jobs - running_jobs)
            estimated_wait_time = int((queued_jobs * avg_execution_time) // capacity)

        return QueueInfo(
            total_jobs=len(self.active_jobs),
            pending_jobs=pending_jobs,
            running_jobs=running_jobs,
            completed_jobs=recent_completed,
            failed_jobs=recent_failed,
            estimated_wait_time=estimated_wait_time,
            average_execution_time=300.0,
        )
