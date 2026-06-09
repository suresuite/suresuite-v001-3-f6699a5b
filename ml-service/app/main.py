from typing import List, Optional

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
import logging

from .config import settings
from .inference import MLPredictor

# Services & models
from .services.database_service import DatabaseService
from .services.simulation_engine import SimulationEngine
from .services.job_manager import JobManager
from .services.cache_manager import CacheManager  # <-- your file name
from .models.request_models import SimulationRequest, BatchSimulationRequest

# ------------------------------------------------------------------------------
# Logging
# ------------------------------------------------------------------------------
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# ------------------------------------------------------------------------------
# FastAPI app
# ------------------------------------------------------------------------------
app = FastAPI(
    title="Supply Chain ML Service",
    version=settings.service_version,
    description="Machine Learning service for supply chain resilience prediction and simulation",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(",") if settings.allowed_origins != "*" else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------------------
# API Key auth
# ------------------------------------------------------------------------------
def verify_api_key(x_api_key: str = Header(...)):
    if not settings.api_key or x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key

# ------------------------------------------------------------------------------
# Predictor
# ------------------------------------------------------------------------------
predictor = MLPredictor()

# ------------------------------------------------------------------------------
# Schemas for /predict
# ------------------------------------------------------------------------------
class SupplyChainNode(BaseModel):
    id: str
    location_name: Optional[str] = None
    node_type: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    capacity: Optional[float] = None
    current_utilization: Optional[float] = None
    risk_factor: Optional[float] = None
    connectivity_score: Optional[float] = None

class PredictionRequest(BaseModel):
    nodes: List[SupplyChainNode]

class PredictionResult(BaseModel):
    id: str
    is_critical: bool
    score: float

class PredictionResponse(BaseModel):
    # silence "model_" protected namespace warning in pydantic v2
    model_config = ConfigDict(protected_namespaces=())
    predictions: List[PredictionResult]
    model_version: str
    timestamp: str

# ------------------------------------------------------------------------------
# Globals – initialized on startup
# ------------------------------------------------------------------------------
database_service: Optional[DatabaseService] = None
cache_manager: Optional[CacheManager] = None
simulation_engine: Optional[SimulationEngine] = None
job_manager: Optional[JobManager] = None

def require_job_manager() -> JobManager:
    if job_manager is None:
        raise HTTPException(status_code=503, detail="Job manager not initialized")
    return job_manager

def require_database() -> DatabaseService:
    if database_service is None:
        raise HTTPException(status_code=503, detail="Database service not initialized")
    return database_service

# ------------------------------------------------------------------------------
# Lifecycle (on_event – simple, even if deprecated)
# ------------------------------------------------------------------------------
@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    try:
        global database_service, cache_manager, simulation_engine, job_manager

        database_service = DatabaseService()
        await database_service.initialize()

        cache_manager = CacheManager()  # should read Redis DSN from settings internally

        # SimulationEngine requires DI (database_service, cache_manager)
        simulation_engine = SimulationEngine(
            database_service=database_service,
            cache_manager=cache_manager,
        )

        # JobManager requires DI (database_service, simulation_engine)
        job_manager = JobManager(
            database_service=database_service,
            simulation_engine=simulation_engine,
        )
        await job_manager.initialize()
        await job_manager.start_processing()

        logger.info("Services initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize services: {e}")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup services on shutdown"""
    try:
        if job_manager:
            await job_manager.stop_processing()
        if database_service:
            await database_service.close()
        logger.info("Services shutdown successfully")
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")

# ------------------------------------------------------------------------------
# Health & model
# ------------------------------------------------------------------------------
@app.get("/health")
async def health_check():
    return {"status": "healthy", "model_version": predictor.get_model_version()}

@app.get("/model/info")
async def get_model_info(api_key: str = Depends(verify_api_key)):
    return {
        "model_version": predictor.get_model_version(),
        "model_type": predictor.get_model_type(),
        "features": predictor.get_feature_names(),
        "last_trained": predictor.get_last_trained_date(),
    }

# ------------------------------------------------------------------------------
# Prediction endpoint
# ------------------------------------------------------------------------------
@app.post("/predict", response_model=PredictionResponse)
async def predict_critical_nodes(
    request: PredictionRequest,
    api_key: str = Depends(verify_api_key),
):
    """
    Predict critical nodes in the supply chain network.
    """
    try:
        if not request.nodes:
            raise HTTPException(status_code=400, detail="No nodes provided")

        node_data = [n.model_dump() for n in request.nodes]
        predictions = predictor.predict(node_data)

        return PredictionResponse(
            predictions=predictions,
            model_version=predictor.get_model_version(),
            timestamp=predictor.get_timestamp(),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

# ------------------------------------------------------------------------------
# Simulation endpoints (aligned with updated JobManager API)
# ------------------------------------------------------------------------------
@app.post("/simulation/submit")
async def submit_simulation(
    request: SimulationRequest,
    api_key: str = Depends(verify_api_key),
):
    """Submit a simulation job for processing"""
    jm = require_job_manager()
    try:
        job = await jm.create_job(request)
        return {"job_id": job.job_id, "status": job.status.value}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to submit simulation: {str(e)}")

@app.get("/simulation/status/{job_id}")
async def get_simulation_status(
    job_id: str,
    api_key: str = Depends(verify_api_key),
):
    """Get the status of a simulation job"""
    jm = require_job_manager()
    try:
        status = await jm.get_job_status(job_id)
        if not status:
            raise HTTPException(status_code=404, detail="Job not found")
        return status
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Job not found: {str(e)}")

@app.get("/simulation/results/{job_id}")
async def get_simulation_results(
    job_id: str,
    api_key: str = Depends(verify_api_key),
):
    """Get the results of a completed simulation job"""
    jm = require_job_manager()
    db = require_database()
    try:
        status = await jm.get_job_status(job_id)
        if not status:
            raise HTTPException(status_code=404, detail="Job not found")

        if status.status != status.status.COMPLETED:
            # 409: job exists but results not ready
            raise HTTPException(status_code=409, detail=f"Job is {status.status.value}, results not ready")

        # In-memory first
        ji = jm.active_jobs.get(job_id) if hasattr(jm, "active_jobs") else None  # type: ignore[attr-defined]
        if ji and getattr(ji, "results", None):
            return ji.results

        # Fallback: try DB if your DatabaseService supports it
        if hasattr(db, "get_results_for_job"):
            results = await db.get_results_for_job(job_id)  # type: ignore[attr-defined]
            if results:
                return results

        raise HTTPException(status_code=404, detail="Results not found in memory or database")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Results not found: {str(e)}")

@app.post("/simulation/batch")
async def submit_batch_simulation(
    request: BatchSimulationRequest,
    api_key: str = Depends(verify_api_key),
):
    """Submit multiple simulations as a batch job"""
    jm = require_job_manager()
    try:
        batch_result = await jm.create_batch_jobs(request)
        return batch_result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to submit batch job: {str(e)}")

@app.delete("/simulation/cancel/{job_id}")
async def cancel_simulation(
    job_id: str,
    api_key: str = Depends(verify_api_key),
):
    """Cancel a running simulation job"""
    jm = require_job_manager()
    try:
        resp = await jm.cancel_job(job_id)
        return {"job_id": resp.job_id, "status": resp.status.value}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to cancel job: {str(e)}")

@app.get("/simulation/queue")
async def get_queue_info(api_key: str = Depends(verify_api_key)):
    """Get information about the simulation job queue"""
    jm = require_job_manager()
    try:
        listing = await jm.list_jobs(limit=0, offset=0)
        return listing.queue_info
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get queue info: {str(e)}")

@app.post("/simulation/template")
async def run_template_simulation(
    request: dict,
    api_key: str = Depends(verify_api_key),
):
    """Run a simulation using a predefined template"""
    jm = require_job_manager()
    try:
        # Map incoming payload → SimulationRequest (only fields your model supports)
        simulation_request = SimulationRequest(
            project_id=request.get("project_id"),
            plant_name=request.get("plant_name") or "",
            scenario_ids=request.get("scenario_ids", []),
            job_type=request.get("job_type", "baseline_scenario"),
            priority=request.get("priority", "normal"),
        )
        job = await jm.create_job(simulation_request)
        return {"job_id": job.job_id, "template": request.get("template_name"), "status": job.status.value}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to run template simulation: {str(e)}")

# ------------------------------------------------------------------------------
# Cache endpoints – placeholders until you expose CacheManager via an endpoint
# ------------------------------------------------------------------------------
@app.get("/cache/stats")
async def get_cache_stats(api_key: str = Depends(verify_api_key)):
    raise HTTPException(status_code=501, detail="Cache stats not implemented. Wire CacheManager into this endpoint.")

@app.delete("/cache/clear")
async def clear_cache(api_key: str = Depends(verify_api_key)):
    raise HTTPException(status_code=501, detail="Cache clear not implemented. Wire CacheManager into this endpoint.")

# ------------------------------------------------------------------------------
# Dev entrypoint
# ------------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=settings.port,
        log_level=settings.log_level.lower(),
    )
