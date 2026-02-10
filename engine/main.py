from fastapi import FastAPI
from supertokens_python import init, InputAppInfo, SupertokensConfig, AppInfo, get_all_cors_headers
from supertokens_python.recipe import emailpassword, session, dashboard
from supertokens_python.framework.fastapi import get_middleware
from starlette.middleware.cors import CORSMiddleware
import uvicorn
import os

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

# --- Middleware ---
app.add_middleware(get_middleware())

app.add_middleware(
    CORSMiddleware,
    allow_origins=[f"http://localhost:{WEB_PORT}"],
    allow_credentials=True,
    allow_methods=["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["Content-Type"] + get_all_cors_headers(),
)

# --- Routes ---
@app.get("/")
def read_root():
    return {"status": "MovieShaker Engine Running", "mode": "Indie"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from fastapi import Depends
from supertokens_python.asyncio import get_users_oldest_first

# ... (existing routes)

@app.get("/users")
async def get_users():
    # Retrieve all users (no pagination for now, simple implementation)
    # Default tenant_id is "public"
    users_response = await get_users_oldest_first("public")
    return {"users": users_response.users}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=API_PORT)
