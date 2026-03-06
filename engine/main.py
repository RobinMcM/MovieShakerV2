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
import os
import logging
from pathlib import Path
from dotenv import load_dotenv

# Load .env from engine directory and project root (dev CORS_ORIGINS, etc.)
_env_dir = Path(__file__).resolve().parent
load_dotenv(_env_dir / ".env")
load_dotenv(_env_dir.parent / ".env")

logger = logging.getLogger(__name__)

# Local imports
from db import init_db
from projects import router as projects_router
from profile import router as profile_router, verify_router
from scripts import router as scripts_router
from notifications import router as notifications_router
from auth_deps import require_admin
from admin import router as admin_router
from contact import router as contact_router

# --- Configuration ---
# TODO: Move to config.py
API_PORT = int(os.getenv("API_PORT", "8000"))
WEB_PORT = int(os.getenv("WEB_PORT", "5173"))
API_BASE_URL = os.getenv("API_BASE_URL", f"http://localhost:{API_PORT}").rstrip("/")
WEBSITE_DOMAIN = os.getenv(
    "WEBSITE_DOMAIN",
    os.getenv("WEB_HOST", f"http://localhost:{WEB_PORT}"),
).rstrip("/")


def _split_csv_env(name: str) -> list[str]:
    value = os.getenv(name, "").strip()
    if not value:
        return []
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return out

init(
    app_info=InputAppInfo(
        app_name="MovieShaker Engine",
        api_domain=API_BASE_URL,
        website_domain=WEBSITE_DOMAIN,
        api_base_path="/auth",
        website_base_path="/auth"
    ),
    supertokens_config=SupertokensConfig(
        connection_uri=os.getenv("SUPERTOKENS_CONNECTION_URI", "http://supertokens:3567"),
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

# Allowed web origins for CORS. CORS_ORIGINS can add extra origins (comma-separated).
# Keep safe defaults always enabled so production does not break if env is missing/misconfigured.
_DEFAULT_PRODUCTION_ORIGINS = [
    "https://movieshaker.com",
    "https://www.movieshaker.com",
    "https://ooocreatives.com",
    "https://afilminabox.com",
    "https://reelinvesting.com",
    "https://dolphin-app-9dvbj.ondigitalocean.app",
]
_DEV_ORIGINS = [
    f"http://localhost:{WEB_PORT}",
    "http://localhost:5174",
    "http://localhost:3000",
    "http://localhost:3001",
]
_env_origins = _split_csv_env("CORS_ORIGINS")
_CORS_ORIGINS = _dedupe(_DEV_ORIGINS + _DEFAULT_PRODUCTION_ORIGINS + _env_origins + [WEBSITE_DOMAIN])


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
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": str(exc)},
        headers=_cors_headers(request),
    )


# --- Startup Events ---
@app.on_event("startup")
def on_startup():
    init_db()
    logger.info("SuperTokens app_info api_domain=%s website_domain=%s", API_BASE_URL, WEBSITE_DOMAIN)
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

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=API_PORT)
