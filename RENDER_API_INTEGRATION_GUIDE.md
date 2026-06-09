# Render API Integration Guide

This document provides detailed guidance for implementing the Render API endpoints that integrate with the enhanced simulation system.

## Overview

The new simulation system creates separate baseline and scenario jobs, with intelligent availability checking to avoid redundant calculations. Your Render API will be called only when new simulations are needed.

## Required API Endpoints

### 1. POST /api/simulation/execute

**Purpose**: Execute a simulation job and save results to the database

**Input**:
```json
{
  "id": "uuid-of-simulation-job"
}
```

**Process**:
1. Fetch job details from `simulation_jobs` table using the provided `id`
2. Fetch project and supply chain data based on job configuration
3. Run ML simulation based on job type (`baseline` or `scenarios`)
4. Save results to `simulation_results` table
5. Update job status to `completed`

**Output**:
```json
{
  "success": boolean,
  "result_id": "uuid-of-simulation-result"
}
```

## Database Integration Details

### Key Tables and Fields

#### simulation_jobs
- `id`: Primary key (UUID) - this is what your API receives
- `project_id`: Link to project data
- `job_type`: Either "baseline" or "scenarios"
- `scenario_ids`: Array of scenario UUIDs (empty for baseline jobs)
- `simulation_result_id`: Pre-created result record to populate
- `status`: Update to 'running', then 'completed' or 'failed'
- `config`: Simulation parameters (days, thresholds, etc.)

#### simulation_results
- `id`: Primary key (UUID) - use the `simulation_result_id` from the job
- `metrics`: JSONB field to store simulation output data
- `status`: Update to 'completed' when done
- `completed_at`: Set timestamp when finished

### Expected Data Flow

1. **Receive Job ID**: API receives simulation job UUID
2. **Fetch Job Details**:
   ```sql
   SELECT * FROM simulation_jobs WHERE id = $1
   ```
3. **Get Supply Chain Data**:
   ```sql
   SELECT * FROM supply_chain_data WHERE project_id = $project_id
   ```
4. **Run Simulation**: Execute your ML models based on job type
5. **Save Results**:
   ```sql
   UPDATE simulation_results 
   SET metrics = $metrics, status = 'completed', completed_at = NOW()
   WHERE id = $simulation_result_id
   ```
6. **Update Job Status**:
   ```sql
   UPDATE simulation_jobs 
   SET status = 'completed', completed_at = NOW(), progress = 100
   WHERE id = $job_id
   ```

## Job Types

### Baseline Jobs (`job_type = 'baseline'`)
- **Input**: Supply chain data, simulation parameters
- **Process**: Run baseline simulation without disruptions
- **Output**: Baseline KPI data (fill_rate, revenue, profit, etc.)
- **Result Structure**:
  ```json
  {
    "baseline": {
      "fill_rate": [{"day": 1, "value": 95.2}, ...],
      "revenue": [{"day": 1, "value": 150000}, ...],
      // ... other KPIs
    },
    "available_kpis": ["fill_rate", "revenue", "profit", ...],
    "simulation_period": {"start_day": 1, "end_day": 60}
  }
  ```

### Scenario Jobs (`job_type = 'scenarios'`)
- **Input**: Supply chain data, scenario configurations, simulation parameters
- **Process**: Run disruption scenarios using existing baseline as reference
- **Output**: Scenario KPI data showing disruption impacts
- **Scenario Data Fetch**:
  ```sql
  SELECT sp.*, se.*, st.*
  FROM disruption_scenario_profiles sp
  JOIN disruption_scenario_effects se ON se.profile_id = sp.id
  JOIN disruption_scenario_targets st ON st.profile_id = sp.id
  WHERE sp.id = ANY($scenario_ids)
  ```
- **Result Structure**:
  ```json
  {
    "scenario": {
      "fill_rate": [{"day": 1, "value": 90.1}, ...],
      "revenue": [{"day": 1, "value": 140000}, ...],
      // ... other KPIs showing disruption impact
    },
    "available_kpis": ["fill_rate", "revenue", "profit", ...],
    "simulation_period": {"start_day": 1, "end_day": 60}
  }
  ```

## Error Handling

### On Simulation Failure
1. Update job status:
   ```sql
   UPDATE simulation_jobs 
   SET status = 'failed', error_message = $error, completed_at = NOW()
   WHERE id = $job_id
   ```
2. Update result status:
   ```sql
   UPDATE simulation_results 
   SET status = 'failed', completed_at = NOW()
   WHERE id = $simulation_result_id
   ```
3. Return error response:
   ```json
   {
     "success": false,
     "error": "Detailed error message"
   }
   ```

## Performance Considerations

### Caching Strategy
- Baseline results are automatically cached by the edge function
- Your API should focus on pure computation without additional caching
- Cache keys are generated deterministically based on supply chain data

### Concurrent Job Handling
- Multiple jobs can run simultaneously
- Each job is independent with its own result record
- Use the job `priority` field to handle resource allocation

### Progress Updates (Optional)
You can optionally update job progress during long-running simulations:
```sql
UPDATE simulation_jobs 
SET progress = $progress_percentage, partial_results = $intermediate_data
WHERE id = $job_id
```

## Security Considerations

### Database Access
- Use connection strings with appropriate permissions
- Ensure Row Level Security (RLS) is respected in your queries
- Validate that job belongs to requesting user's organization

### Input Validation
- Validate job ID format (UUID)
- Ensure job status is 'queued' before processing
- Verify simulation_result_id exists and is linked to the job

## Testing Strategy

### Unit Tests
- Mock database connections
- Test each job type independently
- Validate result data structure

### Integration Tests
- Test complete flow: job creation → API call → result storage
- Verify error handling scenarios
- Test concurrent job processing

### Performance Tests
- Measure simulation execution time
- Test with various supply chain data sizes
- Validate memory usage and cleanup

## Example Implementation Structure

```python
# Example Python/FastAPI structure
from fastapi import FastAPI
import asyncpg
from typing import Dict, Any

app = FastAPI()

@app.post("/api/simulation/execute")
async def execute_simulation(request: Dict[str, Any]):
    job_id = request["id"]
    
    # 1. Fetch job details
    job = await fetch_job_details(job_id)
    
    # 2. Get supply chain data  
    supply_chain_data = await fetch_supply_chain_data(job["project_id"])
    
    # 3. Run simulation based on job type
    if job["job_type"] == "baseline":
        results = await run_baseline_simulation(supply_chain_data, job["config"])
    else:  # scenarios
        scenario_data = await fetch_scenario_details(job["scenario_ids"])
        results = await run_scenario_simulation(supply_chain_data, scenario_data, job["config"])
    
    # 4. Save results
    await save_simulation_results(job["simulation_result_id"], results)
    await update_job_status(job_id, "completed")
    
    return {"success": True, "result_id": job["simulation_result_id"]}
```

## Deployment Notes

### Environment Variables
- Database connection strings for Supabase
- API authentication if required
- Resource limits and timeouts

### Monitoring
- Log all job executions with timing data
- Monitor error rates and failure patterns  
- Track resource usage per simulation type

### Scaling
- Consider horizontal scaling for concurrent jobs
- Use job queues if needed for high-volume scenarios
- Implement circuit breakers for database connections
