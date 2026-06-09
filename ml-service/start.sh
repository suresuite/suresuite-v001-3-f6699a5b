#!/bin/bash

# ML Service Production Startup Script
# Make executable with: chmod +x start.sh
set -e

echo "Starting ML Service..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Warning: .env file not found. Using environment variables."
fi

# Set default port if not provided
export PORT=${PORT:-8000}

# Start the application with gunicorn
exec gunicorn app.main:app \
    --bind 0.0.0.0:$PORT \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers ${WORKERS:-2} \
    --timeout ${TIMEOUT:-300} \
    --access-logfile - \
    --error-logfile - \
    --log-level ${LOG_LEVEL:-info}