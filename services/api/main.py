from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
import os
from math import floor
from datetime import datetime
from supabase import create_client, Client

# Environment variables
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

EXPERIMENTS_TABLE = os.getenv("EXPERIMENTS_TABLE", "experiments")
SIM_INPUTS_TABLE = os.getenv("SIM_INPUTS_TABLE", "sim_inputs")
SIM_RESULTS_TABLE = os.getenv("SIM_RESULTS_TABLE", "sim_results")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Supabase credentials are not configured")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI()


class Experiment(BaseModel):
    id: int
    name: str
    material_per_unit: float
    capacity_per_period: float
    scrap_rate: float
    notes: Optional[str] = None


class SimulationInput(BaseModel):
    id: int
    experiment_id: int
    period: int
    material_on_hand: float
    incoming_material: float
    demand: Optional[float] = None
    created_at: Optional[datetime] = None


class SimulationOverrides(BaseModel):
    material_on_hand: Optional[float] = None
    incoming_material: Optional[float] = None
    capacity_per_period: Optional[float] = None
    scrap_rate: Optional[float] = None
    demand: Optional[float] = None
    material_per_unit: Optional[float] = None


class SimulationResult(BaseModel):
    id: int
    experiment_id: int
    period: int
    produced_qty: float
    capacity_used: float
    material_used: float
    material_left: float
    scrap_units: float
    effective_yield_units: float
    demand_capped: bool
    created_at: Optional[datetime] = None


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/simulate/{experiment_id}")
async def simulate(experiment_id: int, overrides: SimulationOverrides | None = None) -> Dict[str, Any]:
    # Fetch experiment configuration
    exp_resp = supabase.table(EXPERIMENTS_TABLE).select("*").eq("id", experiment_id).execute()
    if not exp_resp.data:
        raise HTTPException(status_code=404, detail="Experiment not found")
    experiment = Experiment(**exp_resp.data[0])

    # Fetch latest simulation input
    sim_resp = (
        supabase.table(SIM_INPUTS_TABLE)
        .select("*")
        .eq("experiment_id", experiment_id)
        .order("period", desc=True)
        .limit(1)
        .execute()
    )
    if not sim_resp.data:
        raise HTTPException(status_code=404, detail="Simulation input not found")
    sim_input = SimulationInput(**sim_resp.data[0])

    # Apply overrides
    overrides = overrides or SimulationOverrides()
    effective_input = sim_input.copy(update=overrides.dict(exclude_unset=True))
    effective_experiment = experiment.copy(update=overrides.dict(exclude_unset=True))

    # Simulation logic
    available_material = effective_input.material_on_hand + effective_input.incoming_material
    max_producible_units = floor(available_material / effective_experiment.material_per_unit)
    base_capacity = min(max_producible_units, floor(effective_experiment.capacity_per_period))
    demand = effective_input.demand
    produced_qty = base_capacity
    demand_capped = False
    if demand is not None:
        if demand < base_capacity:
            demand_capped = True
        produced_qty = min(base_capacity, floor(demand))

    material_used = produced_qty * effective_experiment.material_per_unit
    material_left = available_material - material_used
    scrap_units = floor(produced_qty * effective_experiment.scrap_rate)
    effective_yield_units = produced_qty - scrap_units

    result_data = {
        "experiment_id": experiment_id,
        "period": effective_input.period,
        "produced_qty": produced_qty,
        "capacity_used": produced_qty,
        "material_used": material_used,
        "material_left": material_left,
        "scrap_units": scrap_units,
        "effective_yield_units": effective_yield_units,
        "demand_capped": demand_capped,
        "created_at": datetime.utcnow().isoformat(),
    }

    insert_resp = (
        supabase.table(SIM_RESULTS_TABLE)
        .insert(result_data)
        .select("*")
        .execute()
    )
    result_record = SimulationResult(**insert_resp.data[0])

    return {
        "experiment": experiment.dict(),
        "input": sim_input.dict(),
        "overrides": overrides.dict(exclude_unset=True),
        "result": result_record.dict(),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
