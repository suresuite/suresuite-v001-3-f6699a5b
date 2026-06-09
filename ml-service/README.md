# ML Service for Supply Chain Resilience

This is a FastAPI-based machine learning service that provides critical node prediction and supply chain simulation capabilities for supply chain resilience assessment.

## Features

- Critical node prediction using ML models
- Supply chain simulation with scenario analysis
- Job queue management for batch processing
- Redis caching for performance optimization
- Supabase integration for data persistence
- Production-ready with Gunicorn and environment-based configuration

## Setup

### Local Development

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Update `.env` with your configuration values:**
   - Set your Supabase URL and service role key
   - Generate a secure API key
   - Configure other settings as needed

4. **Run the service:**
   ```bash
   python -m app.main
   ```

### Production Deployment (Render)

1. **Create a new Web Service on Render**
2. **Connect your GitHub repository**
3. **Use these settings:**
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `./start.sh`
   - **Environment**: Python 3.11

4. **Set environment variables in Render dashboard:**
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key
   - `SIMULATION_API_KEY`: Secure API key for authentication
   - Other variables as needed (see Environment Variables section)

5. **Optional: Add Redis add-on for caching**

Your ML service URL will be: `https://your-service-name.onrender.com`

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| SUPABASE_URL | Supabase project URL | Yes | - |
| SUPABASE_SERVICE_ROLE_KEY | Supabase service role key | Yes | - |
| SIMULATION_API_KEY | API key for authentication | Yes | - |
| PORT | Server port | No | 8000 |
| LOG_LEVEL | Logging level (DEBUG, INFO, WARNING, ERROR) | No | INFO |
| REDIS_URL | Redis connection URL | No | redis://localhost:6379 |
| DEBUG | Enable debug mode | No | false |
| MAX_WORKERS | Maximum worker processes | No | 4 |
| ALLOWED_ORIGINS | CORS allowed origins | No | * |

## API Endpoints

### Health Check
- `GET /health` - Service health status and model version

### Critical Node Prediction
- `POST /predict` - Predict critical nodes in supply chain network

### Supply Chain Simulation
- `POST /simulation/submit` - Submit simulation job for processing
- `GET /simulation/status/{job_id}` - Get simulation job status
- `GET /simulation/results/{job_id}` - Get completed simulation results
- `POST /simulation/batch` - Submit multiple simulations as batch
- `DELETE /simulation/cancel/{job_id}` - Cancel running simulation
- `GET /simulation/queue` - Get job queue information
- `POST /simulation/template` - Run simulation using predefined template

### Cache Management
- `GET /cache/stats` - Get cache statistics and performance metrics
- `DELETE /cache/clear` - Clear simulation cache

## Authentication

All endpoints (except `/health`) require an API key passed as `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key" http://localhost:8000/health
```

## Request/Response Examples

### Critical Node Prediction

**Request:**
```json
{
  "nodes": [
    {
      "id": "node-1",
      "location_name": "Warehouse A",
      "node_type": "warehouse",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "capacity": 1000.0,
      "current_utilization": 0.8,
      "risk_factor": 0.3,
      "connectivity_score": 0.9
    }
  ]
}
```

**Response:**
```json
{
  "predictions": [
    {
      "id": "node-1",
      "is_critical": true,
      "score": 0.8543
    }
  ],
  "model_version": "1.0.0",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Simulation Submission

**Request:**
```json
{
  "project_id": "uuid-here",
  "scenario_ids": ["scenario-uuid"],
  "simulation_parameters": {
    "simulation_horizon_days": 30,
    "monte_carlo_runs": 1000
  },
  "job_type": "baseline_scenario",
  "priority": "normal"
}
```

## Docker Support

Build and run with Docker:

```bash
docker build -t ml-service .
docker run -p 8000:8000 --env-file .env ml-service
```

## Integrating Your ML Model

### Step 1: Replace the Placeholder Model

The current implementation in `app/inference.py` contains a placeholder model. Replace the `MLPredictor` class with your actual ML model:

```python
import joblib
import numpy as np

class MLPredictor:
    def __init__(self):
        # Load your trained model
        self.model = joblib.load('/app/models/critical_node_model.pkl')
        self.scaler = joblib.load('/app/models/scaler.pkl')
        
    def predict(self, nodes):
        # Your actual prediction logic
        X = self.preprocess_data(nodes)
        X_scaled = self.scaler.transform(X)
        probabilities = self.model.predict_proba(X_scaled)
        scores = probabilities[:, 1]
        is_critical = scores > 0.5
        # ... format and return results
```

### Step 2: Add Model Files

Create a `models/` directory and add your trained model files:

```
ml-service/
├── app/
├── models/
│   ├── critical_node_model.pkl
│   ├── scaler.pkl
│   └── feature_encoder.pkl
├── requirements.txt
└── Dockerfile
```

## Development

Run tests:
```bash
pytest
```

Format code:
```bash
black app/
```

Lint code:
```bash
flake8 app/
```

## Security Considerations

1. **API Key Authentication:** All endpoints require valid API key
2. **Environment Variables:** Sensitive data stored in environment variables
3. **HTTPS:** Always use HTTPS in production
4. **Input Validation:** All inputs validated using Pydantic models
5. **CORS:** Configurable CORS settings

## Integration with Main Application

The service is designed to be called from Supabase Edge Functions. Make sure to:

1. Deploy the ML service to Render
2. Set the `ML_SERVICE_URL` environment variable in your main application
3. Set the `ML_API_KEY` to match your service's API key
4. The Edge Functions will handle communication with this service

## Troubleshooting

### Common Issues

1. **Environment variables not loaded:** Ensure `.env` file exists and is properly formatted
2. **Supabase connection errors:** Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
3. **API key errors:** Check that `SIMULATION_API_KEY` is set and matches client requests
4. **Port binding issues:** Ensure `PORT` environment variable is set correctly
5. **Redis connection errors:** Verify Redis configuration or disable Redis features

### Logs

Check application logs:
```bash
# Local development
python -m app.main

# Docker
docker logs <container-id>

# Render
Check logs in Render dashboard
```

## Performance Optimization

1. **Redis Caching:** Enable Redis for simulation result caching
2. **Worker Processes:** Adjust `MAX_WORKERS` based on your server capacity
3. **Database Connection Pooling:** Configured automatically with Supabase client
4. **Model Optimization:** Consider model quantization or pruning for faster inference

## Next Steps

1. Replace the placeholder model with your actual ML implementation
2. Test locally with sample data
3. Deploy to Render
4. Update your main application with the ML service URL
5. Test the full integration through your supply chain application