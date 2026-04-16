# MovieShakerV2

Film production management platform.
Helps production teams run projects end-to-end — scripts, budgeting,
scheduling, crew, casting, moodboards, shot lists, visualization,
AI generation, and festival strategy.

## Architecture

```
web/        Next.js 16 frontend    → movieshaker.com
engine/     FastAPI backend        → api.movieshaker.com
```

External services:
```
models.rapidmvp.io   openrouter-gateway   AI text + media generation
media.rapidmvp.io    media-handler        FFmpeg video processing
auth.rapidmvp.io     SuperTokens core     Authentication
```

## Quick Start

### Full stack (recommended)
```bash
docker compose up -d --build
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| Engine API | http://localhost:8000 |
| SuperTokens | http://localhost:3567 |

### Frontend only
```bash
cd web && npm install && npm run dev
```

### Backend only
```bash
docker compose up -d db supertokens valkey engine
```

## Platform Features

### Project Management
Create and manage film projects. Invite team members. Track project status.

### Scripts
Upload screenplays (PDF/FDX). Parse into scenes, characters, and headings.
View structured script with scene breakdown.

### Budgeting
Line-item production budgeting. Scene cost breakdown.
Budget vs actual tracking.

### Scheduling
Shoot day planning via tram lines. Scene ordering by location and time of day.
Day-out-of-days management.

### Characters & Cast
Character management from script breakdown.
Casting workflow with public actor role pages.
Audition tracking.

### Moodboard
Visual development boards with drawing canvas.
AI image generation via openrouter-gateway.

### Shot List
Shot-by-shot planning per scene.
Camera, lens, and movement specifications.

### Visualize
AI-powered scene visualization.
Image-to-video generation via FAL models through openrouter-gateway.

### Film in a Box
AI-assisted script and film generation.
Powered by OpenRouter text models via openrouter-gateway.

### Film Festival
AI festival strategy and analysis.
Submission planning and targeting.

### AI Assistant
Context-aware virtual co-production assistant.
Embedded chatbot with mode-specific system prompts.
Powered by openrouter-gateway via engine `/api/ai/chat`.

### Objects
Props and production object management.

### Submit Funding
Funding application management.

### Admin
User management, email statistics, chatbot configuration,
auth configuration. Role-restricted.

## Engine API

The engine (`engine/`) is a flat FastAPI application.
Each feature is a separate router file.

### Adding a new feature
1. Create `engine/new_feature.py` — router + models + logic
2. Add to `engine/main.py`:
   ```python
   from new_feature import router as new_feature_router
   app.include_router(new_feature_router)
   ```

### Key engine files

| File | Purpose |
|------|---------|
| `main.py` | Entry point, all router registrations |
| `models.py` | All database models |
| `gateway_client.py` | AI gateway client |
| `media_handler_client.py` | FFmpeg service client |
| `model_catalog.py` | AI model metadata |
| `credits.py` | AI usage credit system |
| `film_in_a_box.py` | AI generation features |
| `ai_assistant.py` | AI chat assistant |

## Environment Variables

### Backend (engine)
```
DATABASE_URL
SUPERTOKENS_CONNECTION_URI
API_BASE_URL
WEBSITE_DOMAIN
GATEWAY_BASE_URL=https://models.rapidmvp.io
GATEWAY_INTERNAL_API_KEY
GATEWAY_TIMEOUT_SECONDS
GATEWAY_VERIFY_TLS
DO_SPACES_ENDPOINT
DO_SPACES_REGION
DO_SPACES_BUCKET
DO_SPACES_ACCESS_KEY_ID
DO_SPACES_SECRET_ACCESS_KEY
RESEND_API_KEY
RESEND_WEBHOOK_SECRET
INTERNAL_API_KEY
```

### Frontend (web/.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WEBSITE_DOMAIN=http://localhost:3000
```

## Auth

SuperTokens email/password auth.
Auth proxied: `api.movieshaker.com/auth/*` → `auth.rapidmvp.io/auth/*`

Reference implementation for shared auth across:
- movieshaker.com
- afilminabox.com
- reelinvesting.com
- ooocreatives.com

## Production

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

See `DEPLOYMENT_RULES.md` and `scripts/go-live/RUNBOOK.md`.

## Testing

```bash
pytest engine/tests -q
```

## Troubleshooting

**Node version**: use Node 20 (`nvm use 20`)

**CORS / session refresh failures**:
- Verify `API_BASE_URL`, `WEBSITE_DOMAIN`, `CORS_ORIGINS`
- Restart engine after env changes

**Gateway not responding**:
- Check `GATEWAY_BASE_URL` and `GATEWAY_INTERNAL_API_KEY`
- Verify `https://models.rapidmvp.io/health`

**Media handler errors**:
- Rebuild both `media-handler` image and `ffmpeg-api` service together
- Verify `/api/instructions` after rebuild
