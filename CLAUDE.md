# CLAUDE.md — MovieShakerV2

## Service Identity
MovieShaker is a film production management platform.
It helps production teams run projects end-to-end:
scripts, budgeting, scheduling, crew, casting, moodboards,
shot lists, visualization, AI generation, and festival strategy.

**This is a live production platform with real users.**
Every change carries production risk. Treat accordingly.

- **Frontend**: Next.js 16, React 19, App Router (`web/`)
- **Backend**: FastAPI engine (`engine/`) — flat file structure
- **Database**: PostgreSQL
- **Cache**: Valkey
- **Storage**: DigitalOcean Spaces
- **Auth**: SuperTokens (proxied via `api.movieshaker.com/auth/*`)
- **Email**: Resend
- **AI Gateway**: `https://models.rapidmvp.io` (openrouter-gateway)
- **Media Processing**: `https://media.rapidmvp.io` (media-handler)

## Structure

### Web (`web/src/`)
```
app/
  (marketing)/              ← Public marketing pages (no auth required)
    about, careers, contact, privacy, terms, cookies
    auditions-info, budgeting-info, crew-info, moodboard-info,
    scheduling-info, shotlist-info
  auth/[[...path]]/         ← SuperTokens auth UI
  project/[projectId]/      ← Project workspace (auth required)
    budgeting/              ← Budget management
    castmanagement/         ← Cast and character management
    film-in-a-box/          ← AI script/film generation
    moodboard/              ← Visual development + AI image generation
    objects/                ← Props and object management
    projectadministration/  ← Project settings and members
    scene-costs/            ← Scene cost breakdown
    scheduling/             ← Shoot day scheduling
    script/[scriptId]/      ← Script viewer and breakdown
    shotlist/               ← Shot list planning
    submit-funding/         ← Funding submission
    the-film-festival/      ← Festival strategy and analysis
    visualize/              ← Scene visualization (AI image-to-video)
  actor-role/[projectId]/[scriptId]/[characterId]/  ← Public casting page
  admin/                    ← Admin panel (auth + role required)
    auth, chatbot, email, users
  profile/                  ← User profile
  projects/                 ← Project list
  api/internal/send-email/  ← Internal email route (engine → web)

components/
  ui/                       ← shadcn/ui components
  project/                  ← Project nav (sidebar + mobile)
  providers/                ← SuperTokens provider
  DrawingCanvas.tsx         ← Moodboard drawing
  ScriptTextRenderer.tsx    ← Raw script display
  StructuredScriptRenderer.tsx ← Parsed script display

emails/                     ← React Email templates
  VerificationEmail.tsx
  WelcomeEmail.tsx
  RegistrationConfirmationEmail.tsx
  PasswordResetConfirmationEmail.tsx
  NotificationEmail.tsx

lib/
  api.ts                    ← API client utilities
  scriptJsonUtils.ts        ← Script JSON parsing
```

### Engine (`engine/`) — flat structure
```
main.py                 ← entry point, all router registrations
config.py               ← environment variable loading
db.py                   ← PostgreSQL connection (SQLModel)
models.py               ← all database models
cache.py                ← Valkey cache utilities
auth_deps.py            ← SuperTokens auth dependencies
storage.py              ← DigitalOcean Spaces utilities
email_client.py         ← Resend email client
gateway_client.py       ← openrouter-gateway client
media_handler_client.py ← media-handler client
model_catalog.py        ← AI model metadata catalog

--- Feature routers ---
projects.py             ← project CRUD and membership
scripts.py              ← script upload, parsing, scene breakdown
budget.py               ← budget management
scene_costs.py          ← scene cost calculations
scheduling.py (tram_lines.py) ← shoot day scheduling
characters.py           ← character and cast management
moodboard.py            ← moodboard + AI image generation
shotlist (part of scripts/scenes)
storage_routes.py       ← file upload/download routes
video_history.py        ← generated video history
compiled_videos.py      ← video compilation management
visualize_config.py     ← AI visualization settings
film_in_a_box.py        ← AI script/film generation (large)
ai_assistant.py         ← AI chat assistant (NEW)
profile.py              ← user profile management
credits.py              ← credit system (AI usage billing)
notifications.py        ← notification system
contact.py              ← contact form
admin.py                ← admin routes (user management)
email_stats.py          ← email delivery statistics
email_webhooks.py       ← Resend webhook handler

tests/
  test_config_contact_and_errors.py
  test_film_in_a_box.py
  test_scripts_json.py
```

## Rules — Read Before Every Task

### Scope — Most Important Rule
- Only modify the file(s) explicitly named in the request
- NEVER cross the `web/` ↔ `engine/` boundary unless both are named
- Do not modify `docker-compose.yml` or `docker-compose.prod.yml` without confirmation
- Do not modify `caddy/` without confirmation
- Do not modify `DEPLOYMENT_RULES.md` under any circumstances
- Do not modify `init-scripts/` under any circumstances
- Do not modify `engine/tests/` unless explicitly asked

### Git
- Do NOT run any git commands
- Do NOT stage, commit, or push changes
- Developer handles all git operations via VS Code git panel

### Docker
- Do NOT run docker commands
- Do NOT build images or start/stop services
- Suggest commands and wait for confirmation

### Running the Application
- Do NOT run `npm run dev`, `npm run build`, or npm scripts
- Do NOT run uvicorn or any Python server
- Do NOT run shell scripts

### Dependencies
- Do NOT modify `package.json` or `requirements.txt` without confirmation
- Do NOT install packages automatically

### Testing
- Do NOT run tests automatically
- Suggest: `pytest engine/tests -q`

## Feature Map

| Feature | Web Route | Engine Router | AI? |
|---------|-----------|---------------|-----|
| Projects | `/projects` | `projects.py` | |
| Scripts | `/project/[id]/script/[id]` | `scripts.py` | |
| Budgeting | `/project/[id]/budgeting` | `budget.py` | |
| Scene Costs | `/project/[id]/scene-costs` | `scene_costs.py` | |
| Scheduling | `/project/[id]/scheduling` | `tram_lines.py` | |
| Characters/Cast | `/project/[id]/castmanagement` | `characters.py` | |
| Moodboard | `/project/[id]/moodboard` | `moodboard.py` | ✅ image gen |
| Shotlist | `/project/[id]/shotlist` | `scripts.py` | |
| Objects | `/project/[id]/objects` | N/A | |
| Visualize | `/project/[id]/visualize` | `visualize_config.py` | ✅ image-to-video |
| Film in a Box | `/project/[id]/film-in-a-box` | `film_in_a_box.py` | ✅ text gen |
| Film Festival | `/project/[id]/the-film-festival` | `film_in_a_box.py` | ✅ text gen |
| Submit Funding | `/project/[id]/submit-funding` | TBD | |
| AI Assistant | (chatbot embed) | `ai_assistant.py` | ✅ chat |
| Profile | `/profile` | `profile.py` | |
| Admin | `/admin/*` | `admin.py` | |

## External Service Connections

| Service | URL | Purpose | Client |
|---------|-----|---------|--------|
| openrouter-gateway | `https://models.rapidmvp.io` | AI text + media | `gateway_client.py` |
| media-handler | `https://media.rapidmvp.io` | FFmpeg video processing | `media_handler_client.py` |
| SuperTokens core | `https://auth.rapidmvp.io` | Authentication | `auth_deps.py` |
| DigitalOcean Spaces | `DO_SPACES_ENDPOINT` | File storage | `storage.py` |
| Resend | API | Email delivery | `email_client.py` |
| Valkey | `VALKEY_URL` | Caching | `cache.py` |
| PostgreSQL | `DATABASE_URL` | Primary data store | `db.py` |

## Gateway Integration

Gateway calls are engine-side only. The web layer never calls
the gateway directly.

```
web/ → engine/ → gateway_client.py → models.rapidmvp.io
```

Existing gateway methods in `gateway_client.py`:
- `execute_text()` — text completion (film_in_a_box, ai_assistant)
- `execute_fal()` — FAL media generation (moodboard, visualize)
- `get_models()` — model list
- `get_object_image_models()` — image model list
- `get_sound_music_models()` — audio model list
- `get_status()` — async job status
- `get_result()` — async job result

## Auth Architecture
- SuperTokens session cookies (HTTP-only)
- Auth proxied: `api.movieshaker.com/auth/*` → `auth.rapidmvp.io/auth/*`
- Auth dependencies in engine: `auth_deps.py`
- Do NOT move auth routes off `api.movieshaker.com`

## Adding a New Engine Feature
Pattern (see `projects.py` as reference):
1. Create `engine/new_feature.py` — define router + Pydantic models + logic
2. Add one import + one `app.include_router()` line to `engine/main.py`
3. Nothing else changes

## Production Topology
- Web: hosted frontend (Next.js)
- Engine: DO Droplet, Docker (`docker-compose.prod.yml`)
- Gateway: `https://models.rapidmvp.io` (separate DO Droplet)
- Media: `https://media.rapidmvp.io` (separate DO Droplet)
- Node: 20.x (use `nvm use 20`)

## Security
- `INTERNAL_API_KEY` — engine ↔ web email route
- `GATEWAY_INTERNAL_API_KEY` — engine → gateway
- Never log or expose key values
- CORS is environment-controlled — never hardcode origins

## If Uncertain
Ask before proceeding. Do not infer intent and act.
One task at a time. Wait for confirmation before the next step.
This is a live production platform — caution on every change.
