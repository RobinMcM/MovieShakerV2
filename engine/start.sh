#!/bin/bash

# Start Redis in the background
redis-server --daemonize yes

# Start the FastAPI application via Uvicorn
# Host 0.0.0.0 is required for Docker networking
exec uvicorn main:app --host 0.0.0.0 --port 8000
