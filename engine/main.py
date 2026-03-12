from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import JSONResponse
from supertokens_python import init, InputAppInfo, SupertokensConfig, get_all_cors_headers
from supertokens_python.recipe import emailpassword, session, dashboard
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.framework.fastapi import get_middleware
from supertokens_python.asyncio import get_users_oldest_first
from starlette.middleware.cors import CORSMiddleware
import uvicorn
import logging

logger = logging.getLogger(__name__)

# Local imports
from config import load_settings
from db import init_db
from projects import router as projects_router
from profile import router as profile_router, verify_router
from scripts import router as scripts_router
from notifications import router as notifications_router
from budget import router as budget_router
from scene_costs import router as scene_costs_router
from tram_lines import router as tram_lines_router
from moodboard import router as moodboard_router
from characters import router as characters_router
from storage_routes import router as storage_router
from auth_deps import require_admin
from admin import router as admin_router
from contact import router as contact_router

settings = load_settings()

init(
    app_info=InputAppInfo(
        app_name="MovieShaker Engine",
        api_domain=settings.api_base_url,
        website_domain=settings.website_domain,
        api_base_path="/auth",
        website_base_path="/auth"
    ),
    supertokens_config=SupertokensConfig(
        connection_uri=settings.supertokens_connection_uri,
        # api_key="<YOUR_API_KEY>"
    ),
    framework='fastapi',
    recipe_list=[
        emailpassword.init(),
        session.init(),
        dashboard.init()
    ]
)

app = FastAPI(title="MovieShaker Engine (Indie)")

_CORS_ORIGINS = settings.cors_origins


def _cors_headers(request=None):
    # Use request Origin if allowed, else first allowed origin (for error responses).
    origin = request.headers.get("origin") if request else None
    allow_origin = origin if origin and origin in _CORS_ORIGINS else _CORS_ORIGINS[0]
    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS, PATCH",
        "Access-Control-Allow-Headers": "Content-Type, " + ", ".join(get_all_cors_headers()),
    }


@app.exception_handler(Exception)
def global_exception_handler(request, exc):
    """Return 500 with CORS headers so the client can read the error."""
    if isinstance(exc, HTTPException):
        raise exc  # Use default FastAPI handling (keeps status code)
    logger.exception("Unhandled exception: %s", exc)
    # Never leak raw exception details in production responses.
    error_detail = "Internal server error"
    if not settings.is_production:
        error_detail = f"Internal server error: {exc}"
    return JSONResponse(
        status_code=500,
        content={"detail": error_detail},
        headers=_cors_headers(request),
    )


# --- Startup Events ---
@app.on_event("startup")
def on_startup():
    init_db()
    logger.info(
        "Environment=%s SuperTokens api_domain=%s website_domain=%s",
        settings.app_env,
        settings.api_base_url,
        settings.website_domain,
    )
    logger.info("CORS allowed origins (%d): %s", len(_CORS_ORIGINS), _CORS_ORIGINS)

# --- Middleware ---
app.add_middleware(get_middleware())

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["Content-Type"] + get_all_cors_headers(),
)

# --- Routers ---
app.include_router(verify_router)
app.include_router(projects_router)
app.include_router(profile_router)
app.include_router(notifications_router)
app.include_router(scripts_router)
app.include_router(budget_router)
app.include_router(scene_costs_router)
app.include_router(tram_lines_router)
app.include_router(moodboard_router)
app.include_router(characters_router)
app.include_router(storage_router)
app.include_router(admin_router)
app.include_router(contact_router)

# --- Routes ---
@app.get("/")
def read_root():
    return {"status": "MovieShaker Engine Running", "mode": "Indie"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.get("/users")
async def get_users(_admin: None = Depends(require_admin)):
    # Admin only. Default tenant_id is "public"
    users_response = await get_users_oldest_first("public")
    return {"users": users_response.users}


# Reference data for scheduling (time of day)
TIME_OF_DAY_OPTIONS = [
    {"id": "day", "name": "Day", "sort_order": 1},
    {"id": "night", "name": "Night", "sort_order": 2},
    {"id": "dawn", "name": "Dawn", "sort_order": 3},
    {"id": "dusk", "name": "Dusk", "sort_order": 4},
    {"id": "morning", "name": "Morning", "sort_order": 5},
    {"id": "afternoon", "name": "Afternoon", "sort_order": 6},
    {"id": "evening", "name": "Evening", "sort_order": 7},
    {"id": "continuous", "name": "Continuous", "sort_order": 8},
]


@app.get("/reference/time-of-day")
def get_time_of_day_options():
    """Return time-of-day reference list for scheduling."""
    return {"data": TIME_OF_DAY_OPTIONS}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=settings.api_port)
