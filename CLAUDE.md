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

## Core Architecture — Single Source of Truth

### The Fundamental Principle
script.json (stored in DO Spaces) is the 
single source of truth for the script.

It is NOT just a copy of the screenplay.
It is the ENRICHED screenplay — every entity 
that appears in the script carries its 
database GUID embedded directly in the JSON.

### Why This Matters
When an agent works on Scene 47 it reads 
the scene elements from script.json.
It sees KADE with his GUID embedded.
It fetches KADE's exact approved image 
from the database using that GUID.
No name matching. No searching. No ambiguity.
Always the correct KADE. Every time.

### The Three Layers

LAYER 1 — script.json (DO Spaces)
  The enriched screenplay.
  Source of truth for story AND identity.
  Every character element has: guid
  Every scene_heading characters array 
  has objects with: name + guid
  Every action line has: entities array
  with guid for each named entity.
  NEVER query the database for identity
  when the script.json has the GUID.
  
  Example character element:
  {
    "type": "character",
    "text": "KADE",
    "guid": "3f4a1b2c-uuid"
  }
  
  Example scene_heading:
  {
    "type": "scene_heading",
    "characters": [
      {"name": "KADE", "guid": "3f4a1b2c-uuid"},
      {"name": "COMMS OFFICER", "guid": "7a9b3d4e-uuid"}
    ]
  }
  
  Example action line:
  {
    "type": "action",
    "text": "TALON-7 descends into the docking bay",
    "entities": [
      {"text": "TALON-7", "guid": "5e2d7c3f-uuid", 
       "type": "vehicle"}
    ]
  }

LAYER 2 — PostgreSQL (database)
  Stores all actual data.
  characters table: images, descriptions, type
  scenes table: production enrichment
  tram_lines: shot coverage
  The database is queried USING the GUID
  from the script.json — never by name.

LAYER 3 — The scene microcosm
  When working inside a scene, everything
  needed is self-contained.
  The scene elements carry their GUIDs.
  One fetch per GUID gets the full entity.
  No joins, no name lookups, no ambiguity.

### The Parse Pipeline
1. PDF uploaded → stored as script.pdf
2. Parse endpoint runs:
   a. Extracts all elements via pdfminer
   b. Identifies unique character names
   c. Inserts Character rows → gets UUIDs
   d. Builds name → GUID map
   e. Walks every element in the JSON
   f. Embeds GUIDs on character elements,
      scene_heading characters arrays,
      and action line entities
   g. Re-writes enriched script.json to Spaces
   h. Updates scenes.characters JSONB with GUIDs
3. file_path points to enriched script.json
4. All downstream features read from this file

### What Agents Must Do
When any agent (CoWriter, CoProducer, 
CoDirector) needs to identify an entity:

  CORRECT:
    Read GUID from script.json element
    SELECT * FROM characters WHERE id = guid
    
  WRONG:
    SELECT * FROM characters WHERE name = 'KADE'
    (name matching is fragile and ambiguous)

### The Moodboard Microcosm
When generating a moodboard for a scene:
  1. Read scene elements from script.json
  2. Collect GUIDs from character elements
     and scene_heading characters array
  3. Fetch character_image_url for each GUID
  4. Place exact approved images in the frame
  5. Never generate a generic character —
     always use the GUID-identified image

### Repair Guide
If character GUIDs are missing from script.json:
  → Re-run POST /scripts/{id}/parse
  → This re-embeds all GUIDs from the 
    current characters table
  → Safe to run multiple times — GUIDs 
    are stable (same name = same UUID)

If a new character appears in a scene rewrite:
  → Parse endpoint creates new Character row
  → New UUID assigned
  → script.json updated with new GUID
  → All downstream features work immediately

If scenes.characters JSONB has empty GUIDs:
  → Characters table was empty during parse
  → Re-parse after confirming characters 
    table has rows for this script_id

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
| CoWriter | `/project/[id]/film-in-a-box` | `film_in_a_box.py` | ✅ text gen |
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
