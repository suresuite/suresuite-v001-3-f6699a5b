# ML Simulation Service - Testing Guide

This document outlines the comprehensive testing strategy for the ML Simulation Service, covering unit tests, API tests, integration tests, and database tests.

## Quick Start

To run all tests:
```bash
python run_all_tests.py
```

## Test Suites Overview

### 1. Unit Tests
- **Location**: `app/tests/test_*.py`
- **Command**: `pytest app/tests/ -v`
- **Coverage**: Core business logic, job management, simulation engine
- **Prerequisites**: None (uses mocked dependencies)

### 2. API Tests  
- **Location**: `test_simulation_comprehensive.py`
- **Command**: `python test_simulation_comprehensive.py`
- **Coverage**: REST API endpoints, authentication, request/response validation
- **Prerequisites**: ML service running, valid API key

### 3. Integration Tests
- **Location**: `test_integration_comprehensive.py`
- **Command**: `python test_integration_comprehensive.py`
- **Coverage**: End-to-end workflows, Supabase integration, real data processing
- **Prerequisites**: ML service running, Supabase access, valid API key

### 4. Database Integration
- **Location**: `test_supabase_integration.py`
- **Command**: `python test_supabase_integration.py`
- **Coverage**: Database operations, data consistency, Supabase functions
- **Prerequisites**: Supabase credentials

## Setup Instructions

### 1. Start ML Service
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Install Test Dependencies
```bash
pip install -r requirements.txt
```

### 3. Environment Variables
Create a `.env` file or set these environment variables:

```bash
# Required for API and Integration tests
SIMULATION_API_KEY=your-api-key-here

# Required for Supabase integration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional overrides
ML_SERVICE_URL=http://localhost:8000
TEST_PROJECT_ID=your-test-project-id
TEST_USER_ID=your-test-user-id
TEST_USER_EMAIL=test@example.com
```

### 4. Verify Setup
```bash
# Test service health
curl http://localhost:8000/health

# Test authentication (replace with your API key)
curl -H "X-API-Key: your-api-key" http://localhost:8000/model/info
```

## Test Data and Scenarios

### Real Test Data
Integration tests use real data from your Supabase instance:
- **Projects**: Fetches from `projects` table
- **Supply Chain Data**: Uses `supply_chain_data` table
- **Node Lists**: Queries `node_list` for supply chain nodes
- **Disruption Scenarios**: Loads from `disruption_scenarios` table

### API Endpoints Tested
- `GET /health` - Service health check
- `GET /model/info` - Model information
- `POST /predict` - Critical node prediction
- `GET /simulation/queue` - Queue status
- `POST /simulation/submit` - Job submission
- `GET /simulation/status/{job_id}` - Job status
- `GET /simulation/results/{job_id}` - Result retrieval
- `POST /simulation/batch` - Batch job submission

### Database Operations Tested
- Supply chain data fetching
- Node information retrieval
- Disruption scenario loading
- Simulation result storage
- Job status tracking

### Integration Scenarios
1. **Data Loading**: Fetch supply chain network from Supabase
2. **Prediction Pipeline**: Submit nodes for critical analysis
3. **Simulation Workflow**: Submit → Monitor → Retrieve results
4. **Batch Processing**: Multiple scenario simulations
5. **Error Handling**: Invalid requests, timeouts, failures
6. **Performance**: Concurrent request handling

## Test Coverage

### Current Coverage Areas
- ✅ Service health and status
- ✅ Authentication and authorization
- ✅ Critical node prediction
- ✅ Simulation job lifecycle
- ✅ Batch processing
- ✅ Queue management
- ✅ Result retrieval
- ✅ Error handling
- ✅ Supabase integration
- ✅ Performance under load

### Performance Benchmarks
- **API Response Time**: < 200ms for health/info endpoints
- **Prediction Latency**: < 2s for 100 nodes
- **Job Submission**: < 500ms per job
- **Database Queries**: < 1s for network data fetching
- **Concurrent Requests**: Handle 10+ simultaneous requests

## GitHub Actions CI/CD

Tests run automatically on:
- Pull requests to main branch
- Pushes to main branch
- Scheduled daily runs

### CI Pipeline
1. **Setup**: Install dependencies, start services
2. **Unit Tests**: Run pytest with coverage
3. **Integration Tests**: Run against test database
4. **Performance Tests**: Validate benchmarks
5. **Security Tests**: Check for vulnerabilities
6. **Deploy**: Deploy if all tests pass

## Success Criteria

### Unit Test Requirements
- 100% of unit tests must pass
- Code coverage > 80%
- No critical security issues

### Integration Test Requirements
- All API endpoints functional
- Database operations working
- Performance benchmarks met
- Error handling verified

### Production Readiness Checklist
- [ ] All test suites passing
- [ ] Performance benchmarks met
- [ ] Security scan passed
- [ ] Documentation updated
- [ ] Monitoring configured
- [ ] Rollback plan ready

## Troubleshooting

### Common Issues

1. **Service Not Running**
   ```bash
   # Check if service is running
   curl http://localhost:8000/health
   
   # Start service
   uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

2. **Authentication Errors**
   ```bash
   # Verify API key is set
   echo $SIMULATION_API_KEY
   
   # Test with curl
   curl -H "X-API-Key: $SIMULATION_API_KEY" http://localhost:8000/model/info
   ```

3. **Database Connection Issues**
   ```bash
   # Check Supabase credentials
   echo $SUPABASE_URL
   echo $SUPABASE_KEY
   
   # Test connection
   python -c "from supabase import create_client; print('OK')"
   ```

4. **Test Failures**
   ```bash
   # Run tests with verbose output
   python run_all_tests.py --verbose
   
   # Run specific test suite
   python test_integration_comprehensive.py --filter health
   ```

For additional support, check the logs in the ML service console output.