# 🔬 Comprehensive ML Service Testing Guide

This guide provides detailed URL-based testing instructions for the ML simulation service. All tests can be performed using web browsers, REST clients, or the provided Python script.

## 📋 Prerequisites

1. **Service Running**: ML service running on `http://localhost:8000`
2. **API Key**: Generate your API key using the provided script
3. **Environment**: Ensure `.env` file is properly configured

## 🔑 Generate API Key

First, generate a secure API key for testing:

```python
# In Python console or save as generate_api_key.py
import secrets
import base64

def generate_api_key():
    # Generate 32 random bytes
    random_bytes = secrets.token_bytes(32)
    # Encode to base64 and decode to string
    api_key = base64.b64encode(random_bytes).decode('utf-8')
    return api_key

api_key = generate_api_key()
print(f"SIMULATION_API_KEY={api_key}")
```

Add this to your `.env` file:
```bash
SIMULATION_API_KEY=Ia6XnJzaQfFYWM3H3RIlKZbRU7B2Cpg6iOBkWHpox2I
```

## 🧪 Test Endpoints

### 1. Health Check (No Auth Required)

**URL**: `GET http://localhost:8000/health`

**Expected Response**:
```json
{
  "service": "Supply Chain ML Service",
  "version": "1.0.0",
  "status": "healthy",
  "timestamp": "2025-01-14T10:30:00Z",
  "components": {
    "database": {"status": "connected"},
    "ml_model": {"status": "loaded", "version": "v1.0.0"}
  }
}
```

**Browser Test**: Simply visit `http://localhost:8000/health`

---

### 2. Model Information (Auth Required)

**URL**: `GET http://localhost:8000/model/info`

**Headers Required**:
```
X-API-Key: Ia6XnJzaQfFYWM3H3RIlKZbRU7B2Cpg6iOBkWHpox2I
```

**Expected Response**:
```json
{
  "model_name": "Critical Node Predictor",
  "version": "1.0.0",
  "model_type": "ensemble",
  "features": ["revenue", "capacity", "lead_time", "network_centrality"],
  "training_date": "2024-01-01",
  "accuracy_metrics": {
    "precision": 0.89,
    "recall": 0.92,
    "f1_score": 0.90
  }
}
```

---

### 3. Critical Node Prediction (Auth Required)

**URL**: `POST http://localhost:8000/predict`

**Headers**:
```
X-API-Key: Ia6XnJzaQfFYWM3H3RIlKZbRU7B2Cpg6iOBkWHpox2I
Content-Type: application/json
```

**Sample Request Body**:
```json
{
  "nodes": [
    {
      "id": "supplier_1",
      "name": "Steel Supplier Co",
      "type": "supplier",
      "location": "Pittsburgh, PA",
      "revenue": 1000000,
      "capacity": 5000,
      "lead_time": 14
    },
    {
      "id": "manufacturer_1",
      "name": "Auto Manufacturing Plant", 
      "type": "manufacturer",
      "location": "Detroit, MI",
      "revenue": 50000000,
      "capacity": 20000,
      "lead_time": 7
    }
  ]
}
```

**Expected Response**:
```json
{
  "predictions": [
    {
      "node_id": "supplier_1",
      "is_critical": true,
      "criticality_score": 0.87,
      "risk_factors": ["high_revenue_impact", "limited_alternatives"]
    },
    {
      "node_id": "manufacturer_1",
      "is_critical": false,
      "criticality_score": 0.23,
      "risk_factors": []
    }
  ],
  "model_version": "1.0.0",
  "prediction_timestamp": "2025-01-14T10:30:00Z"
}
```

---

### 4. Simulation Queue Status

**URL**: `GET http://localhost:8000/simulation/queue`

**Headers**:
```
X-API-Key: Ia6XnJzaQfFYWM3H3RIlKZbRU7B2Cpg6iOBkWHpox2I
```

**Expected Response**:
```json
{
  "total_jobs": 0,
  "pending_jobs": 0,
  "running_jobs": 0,
  "completed_jobs": 0,
  "failed_jobs": 0,
  "estimated_wait_time": null,
  "average_execution_time": 300.0
}
```

---

### 5. Submit Simulation Job

**URL**: `POST http://localhost:8000/simulation/submit`

**Headers**:
```
X-API-Key: Ia6XnJzaQfFYWM3H3RIlKZbRU7B2Cpg6iOBkWHpox2I
Content-Type: application/json
```

**Sample Request Body**:
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "plant_name": "Detroit Manufacturing Plant",
  "job_type": "baseline_scenario",
  "scenario_ids": [],
  "simulation_horizon_days": 30,
  "monte_carlo_runs": 100,
  "baseline_enabled": true,
  "user_id": "550e8400-e29b-41d4-a716-446655440001",
  "user_email": "test@example.com",
  "priority": 1
}
```

**Expected Response**:
```json
{
  "job_id": "job_123456789",
  "status": "queued",
  "job_type": "baseline_scenario",
  "created_at": "2025-01-14T10:30:00Z",
  "progress": 0.0,
  "estimated_completion": null
}
```

**Save the `job_id` for subsequent status/results checks!**

---

### 6. Check Simulation Status

**URL**: `GET http://localhost:8000/simulation/status/{job_id}`

Replace `{job_id}` with the actual job ID from step 5.

**Example**: `GET http://localhost:8000/simulation/status/job_123456789`

**Headers**:
```
X-API-Key: Ia6XnJzaQfFYWM3H3RIlKZbRU7B2Cpg6iOBkWHpox2I
```

**Expected Response**:
```json
{
  "job_id": "job_123456789",
  "status": "running",
  "job_type": "baseline_scenario",
  "created_at": "2025-01-14T10:30:00Z",
  "started_at": "2025-01-14T10:30:15Z",
  "progress": 45.5,
  "current_stage": "Running Monte Carlo simulation",
  "estimated_completion": "2025-01-14T10:32:00Z"
}
```

**Status Values**: `pending`, `queued`, `running`, `completed`, `failed`, `cancelled`

---

### 7. Get Simulation Results

**URL**: `GET http://localhost:8000/simulation/results/{job_id}`

**Headers**:
```
X-API-Key: Ia6XnJzaQfFYWM3H3RIlKZbRU7B2Cpg6iOBkWHpox2I
```

**Expected Response** (when job is completed):
```json
{
  "job_id": "job_123456789",
  "status": "completed",
  "simulation_result_id": "result_abc123",
  "metrics": {
    "simulation_period": {"start_day": 0, "end_day": 30},
    "available_kpis": ["fill_rate", "revenue", "profit"],
    "baseline": {
      "fill_rate": [
        {"day": 0, "value": 0.95},
        {"day": 15, "value": 0.96},
        {"day": 30, "value": 0.94}
      ],
      "revenue": [
        {"day": 0, "value": 120000},
        {"day": 15, "value": 125000}, 
        {"day": 30, "value": 118000}
      ]
    },
    "impact_analysis": {
      "fill_rate_impact": -0.12,
      "revenue_impact": -0.08
    }
  },
  "performance": {
    "execution_time_seconds": 85.2,
    "convergence_iterations": 100,
    "cache_hit_ratio": 0.75
  }
}
```

---

### 8. Submit Batch Simulation

**URL**: `POST http://localhost:8000/simulation/batch`

**Headers**:
```
X-API-Key: Ia6XnJzaQfFYWM3H3RIlKZbRU7B2Cpg6iOBkWHpox2I
Content-Type: application/json
```

**Sample Request Body**:
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "plant_name": "Detroit Manufacturing Plant",
  "scenarios": [
    {
      "scenario_id": "550e8400-e29b-41d4-a716-446655440002",
      "scenario_name": "Supply Disruption Test 1"
    },
    {
      "scenario_id": "550e8400-e29b-41d4-a716-446655440003", 
      "scenario_name": "Demand Surge Test 1"
    }
  ],
  "simulation_horizon_days": 30,
  "monte_carlo_runs": 50,
  "baseline_enabled": true,
  "user_id": "550e8400-e29b-41d4-a716-446655440001",
  "user_email": "test@example.com"
}
```

**Expected Response**:
```json
{
  "batch_id": "batch_789012345",
  "total_jobs": 2,
  "job_ids": ["job_987654321", "job_876543210"],
  "estimated_total_time": 120
}
```

---

### 9. Cancel Simulation Job

**URL**: `DELETE http://localhost:8000/simulation/cancel/{job_id}`

**Headers**:
```
X-API-Key: Ia6XnJzaQfFYWM3H3RIlKZbRU7B2Cpg6iOBkWHpox2I
```

**Expected Response**:
```json
{
  "job_id": "job_123456789",
  "status": "cancelled",
  "message": "Job cancelled successfully"
}
```

---

## 🛠️ Testing Tools

### Option 1: Python Script (Recommended)

Use the provided comprehensive testing script:

```bash
cd ml-service
python test_simulation_comprehensive.py
```

### Option 2: Browser + REST Client

1. **Browser**: Use for GET endpoints without auth (health check)
2. **REST Client**: Use Postman, Insomnia, or VS Code REST Client extension
3. **curl**: If you prefer command line (though URLs are easier)

### Option 3: Manual URL Testing

For GET endpoints, you can construct URLs manually:

```
# Health Check
http://localhost:8000/health

# Queue Status (add API key as header)
http://localhost:8000/simulation/queue

# Job Status (replace with actual job ID)
http://localhost:8000/simulation/status/job_123456789
```

## 🔍 Troubleshooting

### Common Issues:

1. **Connection Refused**: Service not running
   - Start with: `cd ml-service && python -m uvicorn app.main:app --reload --port 8000`

2. **Unauthorized (401)**: Invalid API key
   - Check `X-API-Key` header matches `.env` file

3. **Bad Request (400)**: Invalid request format
   - Check JSON syntax and required fields

4. **Internal Error (500)**: Service error
   - Check service logs for details

### Expected Error Responses:

```json
{
  "detail": "Invalid API key"
}
```

```json
{
  "detail": "Job not found"
}
```

```json
{
  "error": "validation_error",
  "message": "Invalid request format",
  "details": {...}
}
```

## 🚀 Production Deployment

Once local testing passes:

1. **Deploy to Render**: Push to your Git repository
2. **Set Environment Variables**: Configure in Render dashboard
3. **Test Production URLs**: Replace `localhost:8000` with your Render URL
4. **Monitor Logs**: Use Render dashboard for monitoring

Your production URL will be: `https://your-service-name.onrender.com`

---

**Happy Testing! 🎉**