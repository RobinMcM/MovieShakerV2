#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "Starting web service..."
docker compose up -d web

echo ""
echo "Web should be available at http://localhost:3000"
echo "Streaming recent logs (Ctrl+C to stop logs only)..."
echo ""

docker compose logs -f --tail 80 web
