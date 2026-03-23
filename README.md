# MovieShakerV2

MovieShaker is a film production management platform that helps teams run projects end-to-end: projects, scripts, budgeting, scheduling, crew workflows, and supporting production operations.

This repository contains the Next.js frontend and the FastAPI backend, plus local infrastructure for auth and database services.

## Architecture

- `web/` - Next.js 16 app (React 19, App Router)
- `engine/` - FastAPI service (business APIs)
- `docker-compose.yml` - local orchestration for API, auth, database, cache, and proxy
- `caddy/` - reverse proxy config for `api.movieshaker.com`
- `init-scripts/` - database initialization scripts

### Service interaction

```mermaid
flowchart LR
  browser[Browser]
  web[Next.js web]
  engine[FastAPI engine]
  supertokens[SuperTokens core]
  db[(PostgreSQL)]
  valkey[(Valkey)]
  storage[(DO Spaces / S3)]
  email[Resend]

  browser --> web
  browser --> engine
  web --> engine
  engine --> supertokens
  engine --> db
  engine --> valkey
  engine --> storage
  web --> email
```

## Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin)
- Node.js 20.x (for frontend local build/dev)
- Python 3.11+ (only needed for backend tests outside containers)

## Quick start (full stack, recommended)

From the repository root:

```bash
docker compose up -d --build
```

Local endpoints:

- Web: `http://localhost:3000`
- Engine API: `http://localhost:8000`
- SuperTokens: `http://localhost:3567`
- Health check: `http://localhost:8000/health`

## Run frontend only

Use this when working only on UI and routing:

```bash
cd web
npm install
npm run dev
```

Then open `http://localhost:3000`.

If Docker services are already running and you want a single reliable command for web startup/logs:

```bash
./dev-web.sh
```

## Run backend only (without compose web service)

```bash
docker compose up -d db supertokens valkey engine
```

The API will be available at `http://localhost:8000`.

## Environment variables

Copy `.env.example` to `.env` at repo root, then set values for your environment.

### Core backend/auth variables

- `API_BASE_URL` - external API origin (example: `https://api.movieshaker.com`)
- `WEBSITE_DOMAIN` - external web origin (example: `https://movieshaker.com`)
- `CORS_ORIGINS` - optional extra allowed origins (comma-separated)
- `SQL_ECHO` - optional SQL logging toggle (`false` by default; set `true` only for local debugging)
- `SUPERTOKENS_CONNECTION_URI` - SuperTokens core URI
- `DATABASE_URL` - engine DB URL

### Storage/email variables

- `DO_SPACES_ENDPOINT`
- `DO_SPACES_REGION`
- `DO_SPACES_BUCKET`
- `DO_SPACES_ACCESS_KEY_ID`
- `DO_SPACES_SECRET_ACCESS_KEY`
- `RESEND_API_KEY` (web email route)
- `INTERNAL_API_KEY` (shared secret engine <-> web internal email route)

### Gateway variables (AI source of truth)

- `GATEWAY_BASE_URL` (example: `https://134.209.184.66`)
- `GATEWAY_INTERNAL_API_KEY` (shared secret for engine -> gateway)
- `GATEWAY_TIMEOUT_SECONDS` (optional; default `45`)
- `GATEWAY_VERIFY_TLS` (optional; `false` for self-signed/IP certs)

### Frontend variables (`web/.env.local`)

- `NEXT_PUBLIC_API_URL` (example: `http://localhost:8000`)
- `NEXT_PUBLIC_AUTH_API_URL` (optional override for auth routes; for MovieShaker Option 1 keep unset or set to same value as `NEXT_PUBLIC_API_URL`)
- `NEXT_PUBLIC_WEBSITE_DOMAIN` (example: `http://localhost:3000`)

## Shared auth standard (RapidMVP apps)

MovieShaker is the reference implementation for shared auth across:

- `rapidmvp.io`
- `afilminabox.com`
- `reelinvesting.com`
- `ooocreatives.com`

Canonical identity/auth domain:

- `auth.rapidmvp.io`

Use redirect-based SSO for cross-app authentication. Do not attempt to share a single cookie across different top-level domains. Each app must create and own a first-party local session after successful callback validation.

For MovieShaker Option 1 deployment, keep auth requests first-party by proxying `https://api.movieshaker.com/auth/*` to `https://auth.rapidmvp.io/auth/*` at Caddy. Keep CRUD routes served directly by MovieShaker engine on `api.movieshaker.com`.

The full deployment guardrails, callback allowlist rules, Resend requirements, and cutover checklist are defined in:

- `DEPLOYMENT_RULES.md`

## Testing

Backend tests:

```bash
pip install -r engine/requirements.txt
pytest engine/tests -q
```

## Production notes

- Keep `API_BASE_URL` and `WEBSITE_DOMAIN` set explicitly in production.
- CORS defaults include key production domains; localhost dev origins are only included outside production unless explicitly added via `CORS_ORIGINS`.
- SuperTokens dashboard recipe is disabled in the backend service.
- Resend is required for auth email delivery in shared-auth deployments (`RESEND_API_KEY`, `RESEND_FROM`).
- For auth refresh issues, validate preflight:

```bash
curl -i -X OPTIONS "https://api.movieshaker.com/auth/session/refresh" \
  -H "Origin: https://movieshaker.com" \
  -H "Access-Control-Request-Method: POST"
```

## Common troubleshooting

- **Node version issues**: use Node 20 (`nvm use 20`) for `web` dev/build.
- **CORS/session refresh failures**:
  - verify `API_BASE_URL`, `WEBSITE_DOMAIN`, and `CORS_ORIGINS`
  - redeploy/restart engine after env changes
- **Cross-app SSO rollout issues**:
  - verify `AUTH_BASE_URL` / `NEXT_PUBLIC_AUTH_BASE_URL` point to `https://auth.rapidmvp.io`
  - verify callback and `return_to` URLs are allowlisted
  - run the validation checklist in `DEPLOYMENT_RULES.md`
- **Stuck git operations in Cursor**:
  - stop queued git jobs in the IDE terminal queue
  - retry commit/push
