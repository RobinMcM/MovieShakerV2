from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import JSONResponse
from supertokens_python import init, InputAppInfo, SupertokensConfig, get_all_cors_headers
from supertokens_python.recipe import emailpassword, session
from supertokens_python.types import GeneralErrorResponse
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.framework.fastapi import get_middleware
from supertokens_python.asyncio import get_users_oldest_first
from starlette.middleware.cors import CORSMiddleware
import uvicorn
import logging
from typing import Any, Optional
from datetime import datetime, timedelta
import re
import secrets
from sqlmodel import Session as SQLSession

logger = logging.getLogger(__name__)

# Local imports
from config import load_settings
from db import init_db, engine
from email_client import send_email_via_web
from models import AuthConfig, UserProfile, EmailVerificationToken
from email_stats import record_email_send
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
from video_history import router as video_history_router
from compiled_videos import router as compiled_videos_router
from visualize_config import router as visualize_config_router
from auth_deps import require_admin
from admin import router as admin_router
from email_webhooks import router as email_webhooks_router
from contact import router as contact_router
from film_in_a_box import router as film_in_a_box_router
from ai_assistant import router as ai_assistant_router
from moodboard_generator import router as moodboard_generator_router
from backgrounds import router as backgrounds_router
from page_chat import router as page_chat_router
from documentary import router as documentary_router
from editorial import router as editorial_router
from production_sync import router as production_sync_router

settings = load_settings()


def _extract_email_from_form_fields(form_fields: Any) -> Optional[str]:
    if not isinstance(form_fields, list):
        return None
    for field in form_fields:
        field_id = None
        field_value = None
        if isinstance(field, dict):
            field_id = field.get("id")
            field_value = field.get("value")
        else:
            field_id = getattr(field, "id", None)
            field_value = getattr(field, "value", None)
        if field_id == "email" and isinstance(field_value, str) and field_value.strip():
            return field_value.strip()
    return None


def _extract_form_field(form_fields: Any, target_id: str) -> Optional[str]:
    if not isinstance(form_fields, list):
        return None
    for field in form_fields:
        field_id = field.get("id") if isinstance(field, dict) else getattr(field, "id", None)
        field_value = field.get("value") if isinstance(field, dict) else getattr(field, "value", None)
        if field_id == target_id and isinstance(field_value, str):
            return field_value
    return None


def _load_auth_config() -> AuthConfig:
    with SQLSession(engine) as db:
        config = db.get(AuthConfig, 1)
        if config:
            return config
        config = AuthConfig(id=1, updated_at=datetime.utcnow())
        db.add(config)
        db.commit()
        db.refresh(config)
        return config


def _validate_password(value: str, config: AuthConfig) -> Optional[str]:
    password = value or ""
    if len(password) < max(6, int(config.password_min_length or 8)):
        return f"Password must be at least {max(6, int(config.password_min_length or 8))} characters."
    if config.password_require_uppercase and not re.search(r"[A-Z]", password):
        return "Password must include at least one uppercase letter."
    if config.password_require_lowercase and not re.search(r"[a-z]", password):
        return "Password must include at least one lowercase letter."
    if config.password_require_number and not re.search(r"\d", password):
        return "Password must include at least one number."
    if config.password_require_special and not re.search(r"[^A-Za-z0-9]", password):
        return "Password must include at least one special character."
    return None


async def _send_signup_verification_email(user_id: str, email: str) -> None:
    normalized_email = (email or "").strip().lower()
    if not normalized_email:
        return

    with SQLSession(engine) as db:
        profile = db.get(UserProfile, user_id)
        if not profile:
            profile = UserProfile(user_id=user_id, communication_email=normalized_email)
            db.add(profile)
        else:
            if not profile.communication_email:
                profile.communication_email = normalized_email
            if profile.communication_email and profile.communication_email.lower() == normalized_email:
                profile.email_verified_at = None
            profile.updated_at = datetime.utcnow()
            db.add(profile)

        token = secrets.token_urlsafe(32)
        expires_at = datetime.utcnow() + timedelta(hours=24)
        db.add(
            EmailVerificationToken(
                user_id=user_id,
                email=normalized_email,
                token=token,
                expires_at=expires_at,
            )
        )
        db.commit()

    verify_url = f"{settings.api_base_url.rstrip('/')}/verify-email?token={token}"
    result = await send_email_via_web(type="verification", email=normalized_email, verifyUrl=verify_url)
    with SQLSession(engine) as db:
        record_email_send(
            db,
            email=normalized_email,
            email_type="verification",
            send_result=result,
            subject="Verify your email - MovieShaker",
            user_id=user_id,
            metadata={"source": "signup_hook", "verify_url": verify_url},
        )


def _override_emailpassword_apis(original_implementation: Any) -> Any:
    original_sign_up_post = getattr(original_implementation, "sign_up_post", None)
    original_sign_in_post = getattr(original_implementation, "sign_in_post", None)
    original_password_reset_post = getattr(original_implementation, "password_reset_post", None)

    if original_sign_up_post is not None:
        async def sign_up_post(*args: Any, **kwargs: Any) -> Any:
            config = _load_auth_config()
            if not config.email_password_enabled:
                return GeneralErrorResponse(message="Email/password login is currently disabled by administrator.")
            if not config.allow_sign_up:
                return GeneralErrorResponse(message="New sign-ups are currently disabled by administrator.")

            form_fields = kwargs.get("form_fields") if "form_fields" in kwargs else (args[0] if len(args) > 0 else None)
            password = _extract_form_field(form_fields, "password") or ""
            password_error = _validate_password(password, config)
            if password_error:
                return GeneralErrorResponse(message=password_error)

            response = await original_sign_up_post(*args, **kwargs)
            try:
                if getattr(response, "status", None) == "OK":
                    email = None
                    user_id = None
                    user = getattr(response, "user", None)
                    if user is not None:
                        email = getattr(user, "email", None)
                        user_id = getattr(user, "id", None) or getattr(user, "user_id", None)
                        if not email:
                            emails = getattr(user, "emails", None) or []
                            if emails:
                                email = str(emails[0])
                    if not email:
                        email = _extract_email_from_form_fields(form_fields)
                    if email:
                        reg_result = await send_email_via_web(
                            type="registration_confirmation",
                            email=email,
                            subject=config.registration_subject,
                            body=config.registration_body,
                        )
                        welcome_result = await send_email_via_web(
                            type="welcome_email",
                            email=email,
                            subject=config.welcome_subject,
                            body=config.welcome_body,
                        )
                        with SQLSession(engine) as db:
                            record_email_send(
                                db,
                                email=email,
                                email_type="registration_confirmation",
                                send_result=reg_result,
                                subject=config.registration_subject,
                                user_id=str(user_id) if user_id else None,
                                metadata={"source": "signup_hook"},
                            )
                            record_email_send(
                                db,
                                email=email,
                                email_type="welcome_email",
                                send_result=welcome_result,
                                subject=config.welcome_subject,
                                user_id=str(user_id) if user_id else None,
                                metadata={"source": "signup_hook"},
                            )
                        if user_id:
                            await _send_signup_verification_email(str(user_id), email)
            except Exception as err:
                logger.warning("registration confirmation email hook failed: %s", err)
            return response

        original_implementation.sign_up_post = sign_up_post

    if original_sign_in_post is not None:
        async def sign_in_post(*args: Any, **kwargs: Any) -> Any:
            config = _load_auth_config()
            if not config.email_password_enabled:
                return GeneralErrorResponse(message="Email/password login is currently disabled by administrator.")
            return await original_sign_in_post(*args, **kwargs)

        original_implementation.sign_in_post = sign_in_post

    if original_password_reset_post is not None:
        async def password_reset_post(*args: Any, **kwargs: Any) -> Any:
            config = _load_auth_config()
            if not config.email_password_enabled:
                return GeneralErrorResponse(message="Password reset is currently disabled by administrator.")

            form_fields = kwargs.get("form_fields") if "form_fields" in kwargs else (args[0] if len(args) > 0 else None)
            maybe_new_password = _extract_form_field(form_fields, "newPassword")
            if maybe_new_password is None:
                maybe_new_password = _extract_form_field(form_fields, "password")
            if maybe_new_password:
                password_error = _validate_password(maybe_new_password, config)
                if password_error:
                    return GeneralErrorResponse(message=password_error)

            response = await original_password_reset_post(*args, **kwargs)
            try:
                if getattr(response, "status", None) == "OK":
                    email = None
                    user = getattr(response, "user", None)
                    if user is not None:
                        email = getattr(user, "email", None)
                        if not email:
                            emails = getattr(user, "emails", None) or []
                            if emails:
                                email = str(emails[0])
                    if not email:
                        email = _extract_email_from_form_fields(form_fields)
                    if email:
                        reset_result = await send_email_via_web(
                            type="password_reset_confirmation",
                            email=email,
                            subject=config.reset_confirmation_subject,
                            body=config.reset_confirmation_body,
                        )
                        with SQLSession(engine) as db:
                            record_email_send(
                                db,
                                email=email,
                                email_type="password_reset_confirmation",
                                send_result=reset_result,
                                subject=config.reset_confirmation_subject,
                                metadata={"source": "password_reset_hook"},
                            )
            except Exception as err:
                logger.warning("password reset confirmation email hook failed: %s", err)
            return response

        original_implementation.password_reset_post = password_reset_post

    return original_implementation

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
        emailpassword.init(
            override=emailpassword.InputOverrideConfig(
                apis=_override_emailpassword_apis
            )
        ),
        session.init(),
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
    logger.info(
        "Gateway target=%s tls_verify=%s timeout_total=%ss connect_timeout=%ss read_timeout=%ss",
        settings.gateway_base_url,
        settings.gateway_verify_tls,
        settings.gateway_timeout_seconds,
        settings.gateway_connect_timeout_seconds,
        settings.gateway_read_timeout_seconds,
    )

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
app.include_router(video_history_router)
app.include_router(compiled_videos_router)
app.include_router(visualize_config_router)
app.include_router(admin_router)
app.include_router(email_webhooks_router)
app.include_router(contact_router)
app.include_router(film_in_a_box_router)
app.include_router(ai_assistant_router)
app.include_router(moodboard_generator_router)
app.include_router(backgrounds_router)
app.include_router(page_chat_router)
app.include_router(documentary_router)
app.include_router(editorial_router)
app.include_router(production_sync_router)

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
