#!/bin/bash
set -x

# Valkey runs as a separate container; engine connects via VALKEY_URL

# Start the FastAPI application via Uvicorn
# Host 0.0.0.0 is required for Docker networking
exec uvicorn main:app --host 0.0.0.0 --port 8000 --log-level debug
