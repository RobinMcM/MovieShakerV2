from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import JSONResponse
from supertokens_python import init, InputAppInfo, SupertokensConfig, AppInfo, get_all_cors_headers
from supertokens_python.recipe import emailpassword, session, dashboard
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.framework.fastapi import get_middleware
from supertokens_python.asyncio import get_users_oldest_first
from starlette.middleware.cors import CORSMiddleware
import uvicorn
import os
import logging

logger = logging.getLogger(__name__)

# Local imports
from db import init_db
from projects import router as projects_router
from profile import router as profile_router
from scripts import router as scripts_router

# --- Configuration ---
# TODO: Move to config.py
API_PORT = 8000
WEB_PORT = 5173

init(
    app_info=InputAppInfo(
        app_name="MovieShaker Engine",
        api_domain=f"http://localhost:{API_PORT}",
        website_domain=f"http://localhost:{WEB_PORT}",
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

# Allowed web origins for CORS (5173 default Vite, 5174 when 5173 in use)
_CORS_ORIGINS = [f"http://localhost:{WEB_PORT}", "http://localhost:5174"]


def _cors_headers():
    # Use first allowed origin for single-value response (e.g. error handler)
    return {
        "Access-Control-Allow-Origin": _CORS_ORIGINS[0],
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
        headers=_cors_headers(),
    )


# --- Startup Events ---
@app.on_event("startup")
def on_startup():
    init_db()

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
app.include_router(projects_router)
app.include_router(profile_router)
app.include_router(scripts_router)

# --- Routes ---
@app.get("/")
def read_root():
    return {"status": "MovieShaker Engine Running", "mode": "Indie"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.get("/users")
async def get_users():
    # Retrieve all users (no pagination for now, simple implementation)
    # Default tenant_id is "public"
    users_response = await get_users_oldest_first("public")
    return {"users": users_response.users}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=API_PORT)
