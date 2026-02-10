# MovieShaker: The Mean Indie Machine

## Architecture
- **Web**: React + Vite (Static Site on Prod)
- **Engine**: FastAPI + Python (Docker Worker on Prod)
- **Auth**: SuperTokens Core (Docker Worker on Prod / Local Container)
- **DB**: PostgreSQL (Managed on Prod / Local Container)
- **Storage**: S3 / DigitalOcean Spaces

## Prerequisites ⚠️
This architecture runs on **Docker**. You must install Docker Desktop to run the backend and authentication services locally.

**[Install Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/)**
1.  Download the `.dmg` file.
2.  Drag Docker to Applications.
3.  Open Docker Desktop and follow the setup.
4.  Verify in terminal: `docker --version`.

## Quick Start (Local Dev)
Once Docker is installed:

```bash
# 1. Start the entire stack (Database + Auth + API + Web)
docker-compose up -d --build

# 2. Access the apps
# Web App: http://localhost:5173
# API Engine: http://localhost:8000
# SuperTokens Dashboard: http://localhost:3567
```

## Running Without Docker (Web Only)
If you only want to work on the Frontend design while Docker installs:

```bash
cd web
npm install
npm run dev
```
*Note: Authentication and API features will not work until Docker is running.*
