# CLAUDE.md — MovieShakerV2

## Service Identity
Film production management platform. Projects, scripts, budgeting, scheduling,
crew workflows, and production operations.
- **Frontend**: Next.js 16, React 19, App Router (`web/`)
- **Backend**: FastAPI engine (`engine/`)
- **Database**: PostgreSQL
- **Cache**: Valkey
- **Storage**: DigitalOcean Spaces (S3-compatible)
- **Auth**: SuperTokens (proxied via `api.movieshaker.com/auth/*`)
- **Email**: Resend
- **AI Gateway**: `https://models.rapidmvp.io` (openrouter-gateway)

## Structure
```
web/                     ← Next.js 16 frontend (DO NOT touch engine files from here)
  app/                   ← App Router pages and layouts
  components/            ← React components
  lib/                   ← client utilities
engine/                  ← FastAPI backend (DO NOT touch web files from here)
  app/                   ← FastAPI application
  tests/                 ← pytest tests
caddy/                   ← reverse proxy config (DO NOT modify without explicit request)
init-scripts/            ← database init (DO NOT modify without explicit request)
scripts/                 ← go-live and maintenance scripts
docker-compose.yml       ← local dev orchestration
docker-compose.prod.yml  ← production orchestration
```

## Rules — Read Before Every Task

### Scope — Most Important Rule
- Only modify the file(s) explicitly named in the request
- NEVER cross the `web/` ↔ `engine/` boundary unless both are explicitly named
- Do not modify `docker-compose.yml` or `docker-compose.prod.yml` unless explicitly asked
- Do not modify `caddy/` config unless explicitly asked
- Do not modify `DEPLOYMENT_RULES.md` under any circumstances
- Do not modify `init-scripts/` under any circumstances

### Git
- Do NOT run any git commands
- Do NOT stage, commit, or push changes
- Developer handles all git operations via VS Code built-in git panel

### Docker
- Do NOT run docker or docker compose commands
- Do NOT attempt to build images
- Do NOT attempt to start or stop services
- If a docker operation is needed, suggest the command and wait

### Running the Application
- Do NOT run `npm run dev`, `npm run build`, or any npm scripts
- Do NOT run uvicorn or any Python server
- Do NOT run any shell scripts in `scripts/`

### Dependencies
- Do NOT modify `package.json`, `requirements.txt`, or lock files without explicit confirmation
- Do NOT install packages automatically

### Testing
- Do NOT run pytest or any test runner automatically
- If tests are relevant, suggest the command: `pytest engine/tests -q`

## Gateway Integration (AI — Phase 1 Build)
The engine connects to openrouter-gateway via these env vars:
- `GATEWAY_BASE_URL` = `https://models.rapidmvp.io`
- `GATEWAY_INTERNAL_API_KEY` = shared secret
- `GATEWAY_TIMEOUT_SECONDS` = default 45
- `GATEWAY_VERIFY_TLS` = true in production

Gateway calls are made engine-side only. The web layer NEVER calls the gateway directly.
New gateway integration code belongs in `engine/app/` only.

## Auth Architecture
- SuperTokens session cookies (HTTP-only)
- Auth proxied: `api.movieshaker.com/auth/*` → `auth.rapidmvp.io/auth/*`
- Do NOT move auth routes off `api.movieshaker.com`
- Do NOT attempt cross-app cookie sharing

## Production Topology
- Web: Vercel or static host
- Engine: DO Droplet via Docker (`docker-compose.prod.yml`)
- Gateway: `https://models.rapidmvp.io` (separate DO Droplet)
- Node version: 20.x (use `nvm use 20`)

## Security
- `INTERNAL_API_KEY` is used for engine ↔ web internal email route
- `GATEWAY_INTERNAL_API_KEY` is used for engine → gateway
- Never log or expose any key values
- CORS is environment-controlled — do not hardcode origins

## If Uncertain
Ask before proceeding. Do not infer intent and act.
One task at a time. Wait for confirmation before moving to the next step.
