from datetime import datetime, timedelta
import os
import secrets
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Optional

from db import get_session
from models import UserProfile, EmailVerificationToken, Project
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from sqlmodel import Session, select
from sqlalchemy import text

from email_client import send_email_via_web
from email_stats import record_email_send

router = APIRouter(prefix="/profile", tags=["profile"])

# Router for public verify-email link (no prefix so path is /verify-email)
verify_router = APIRouter(tags=["auth"])

# Base URL for verification links (engine API). Redirect after verify goes to web.
API_BASE = os.getenv("API_BASE_URL", "http://localhost:8000").rstrip("/")
WEBSITE_DOMAIN = os.getenv("WEBSITE_DOMAIN", "http://localhost:3000").rstrip("/")

# Token TTL for email verification (hours)
VERIFICATION_TOKEN_HOURS = 24


class ProfileResponse(BaseModel):
    user_id: str
    name: Optional[str] = None
    company: Optional[str] = None
    auth_email_masked: Optional[str] = None  # Login email (masked); from SuperTokens
    communication_email: Optional[str] = None
    email_verified_at: Optional[datetime] = None
    username: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    role: str = "producer"
    producer_tier: str = "standard"
    blocked: bool = False
    notifications_opt_in: bool = True
    ai_credits: int = 50
    model_visualize_video: Optional[str] = None
    model_object_image: Optional[str] = None
    model_sound_music: Optional[str] = None
    project_limit: int = 5
    owned_project_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    communication_email: Optional[str] = None
    username: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    notifications_opt_in: Optional[bool] = None
    model_fiab_text: Optional[str] = None
    model_visualize_video: Optional[str] = None
    model_object_image: Optional[str] = None
    model_sound_music: Optional[str] = None


def _mask_email(email: str) -> str:
    if not email or "@" not in email:
        return ""
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        masked_local = "*" * len(local)
    else:
        masked_local = local[0] + "*" * (len(local) - 2) + local[-1]
    return f"{masked_local}@{domain}"


async def _get_auth_email_masked(user_id: str) -> Optional[str]:
    try:
        from supertokens_python.recipe.emailpassword.asyncio import get_user_by_id
        user = await get_user_by_id(user_id)
        if user and getattr(user, "email", None):
            return _mask_email(user.email)
    except Exception:
        pass
    return None


def _profile_project_stats(profile: UserProfile, user_id: str, db: Session) -> tuple[int, int]:
    """Return (project_limit, owned_project_count) for profile."""
    tier_limits = {"standard": 5, "indie": 25, "production_company": 999}
    limit = tier_limits.get(profile.producer_tier, 5) if profile.role != "admin" else 999
    count = len(db.exec(select(Project).where(Project.owner_id == user_id)).all())
    return limit, count


@router.get("", response_model=ProfileResponse)
@router.get("/", response_model=ProfileResponse)
async def get_profile(
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = db.get(UserProfile, user_id)

    if not profile:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    if profile.blocked:
        raise HTTPException(status_code=403, detail="Account is blocked")

    auth_email_masked = await _get_auth_email_masked(user_id)

    project_limit, owned_count = _profile_project_stats(profile, user_id, db)
    return ProfileResponse(
        user_id=profile.user_id,
        name=profile.name,
        company=profile.company,
        auth_email_masked=auth_email_masked,
        communication_email=profile.communication_email,
        email_verified_at=profile.email_verified_at,
        username=profile.username,
        phone=profile.phone,
        address=profile.address,
        role=profile.role,
        producer_tier=profile.producer_tier,
        blocked=profile.blocked,
        notifications_opt_in=profile.notifications_opt_in,
        ai_credits=profile.ai_credits,
        model_visualize_video=profile.model_visualize_video,
        model_object_image=profile.model_object_image,
        model_sound_music=profile.model_sound_music,
        project_limit=project_limit,
        owned_project_count=owned_count,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


@verify_router.get("/verify-email")
async def verify_email_route(token: str, db: Session = Depends(get_session)):
    """Validate token, set email_verified_at on profile, redirect to web success page."""
    if not token:
        return RedirectResponse(f"{WEBSITE_DOMAIN}/profile?verified=error", status_code=302)
    now = datetime.utcnow()
    statement = select(EmailVerificationToken).where(
        EmailVerificationToken.token == token,
        EmailVerificationToken.expires_at > now,
    )
    row = db.exec(statement).first()
    if not row:
        return RedirectResponse(f"{WEBSITE_DOMAIN}/profile?verified=error", status_code=302)
    profile = db.get(UserProfile, row.user_id)
    if profile and profile.communication_email and profile.communication_email.lower() == row.email:
        profile.email_verified_at = now
        profile.updated_at = now
        db.add(profile)
    db.delete(row)
    db.commit()
    return RedirectResponse(f"{WEBSITE_DOMAIN}/profile?verified=1", status_code=302)


@router.post("/send-verification-email", response_model=ProfileResponse)
@router.post("/send-verification-email/", response_model=ProfileResponse)
async def send_verification_email(
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Resend verification email for current profile communication_email."""
    user_id = session.get_user_id()
    profile = db.get(UserProfile, user_id)
    if not profile or not profile.communication_email:
        raise HTTPException(status_code=400, detail="No communication email set")
    await _create_and_send_verification(user_id, profile.communication_email, db)
    db.refresh(profile)
    auth_email_masked = await _get_auth_email_masked(user_id)
    project_limit, owned_count = _profile_project_stats(profile, user_id, db)
    return ProfileResponse(
        user_id=profile.user_id,
        name=profile.name,
        company=profile.company,
        auth_email_masked=auth_email_masked,
        communication_email=profile.communication_email,
        email_verified_at=profile.email_verified_at,
        username=profile.username,
        phone=profile.phone,
        address=profile.address,
        role=profile.role,
        producer_tier=profile.producer_tier,
        blocked=profile.blocked,
        notifications_opt_in=profile.notifications_opt_in,
        ai_credits=profile.ai_credits,
        model_visualize_video=profile.model_visualize_video,
        model_object_image=profile.model_object_image,
        model_sound_music=profile.model_sound_music,
        project_limit=project_limit,
        owned_project_count=owned_count,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


async def _create_and_send_verification(user_id: str, email: str, db: Session) -> None:
    """Create a verification token and send email via web. Caller holds db session."""
    expires_at = datetime.utcnow() + timedelta(hours=VERIFICATION_TOKEN_HOURS)
    token = secrets.token_urlsafe(32)
    row = EmailVerificationToken(
        user_id=user_id,
        email=email.lower().strip(),
        token=token,
        expires_at=expires_at,
    )
    db.add(row)
    db.commit()
    verify_url = f"{API_BASE}/verify-email?token={token}"
    result = await send_email_via_web(type="verification", email=email, verifyUrl=verify_url)
    record_email_send(
        db,
        email=email,
        email_type="verification",
        send_result=result,
        subject="Verify your email - MovieShaker",
        user_id=user_id,
        metadata={"source": "profile_verification", "verify_url": verify_url},
    )


@router.put("", response_model=ProfileResponse)
@router.put("/", response_model=ProfileResponse)
async def update_profile(
    body: ProfileUpdate,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = db.get(UserProfile, user_id)

    if not profile:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)

    if profile.blocked:
        raise HTTPException(status_code=403, detail="Account is blocked")

    data = body.model_dump(exclude_unset=True) if hasattr(body, "model_dump") else body.dict(exclude_unset=True)
    # Only allow updating non-admin fields via self; role/blocked/producer_tier set via User Management
    for k in ("role", "blocked", "producer_tier", "ai_credits"):
        data.pop(k, None)
    new_communication_email = data.get("communication_email")
    if new_communication_email is not None:
        new_communication_email = (new_communication_email or "").strip() or None
        if new_communication_email and new_communication_email != (profile.communication_email or ""):
            profile.email_verified_at = None  # Require re-verify for new address
    for key, value in data.items():
        if key == "communication_email" and value is not None:
            value = (value or "").strip() or None
        setattr(profile, key, value)
    profile.updated_at = datetime.utcnow()
    db.add(profile)
    db.commit()
    db.refresh(profile)

    # Send verification email when communication_email is set or changed
    if new_communication_email is not None and profile.communication_email:
        await _create_and_send_verification(user_id, profile.communication_email, db)

    auth_email_masked = await _get_auth_email_masked(user_id)
    project_limit, owned_count = _profile_project_stats(profile, user_id, db)
    return ProfileResponse(
        user_id=profile.user_id,
        name=profile.name,
        company=profile.company,
        auth_email_masked=auth_email_masked,
        communication_email=profile.communication_email,
        email_verified_at=profile.email_verified_at,
        username=profile.username,
        phone=profile.phone,
        address=profile.address,
        role=profile.role,
        producer_tier=profile.producer_tier,
        blocked=profile.blocked,
        notifications_opt_in=profile.notifications_opt_in,
        ai_credits=profile.ai_credits,
        model_visualize_video=profile.model_visualize_video,
        model_object_image=profile.model_object_image,
        model_sound_music=profile.model_sound_music,
        project_limit=project_limit,
        owned_project_count=owned_count,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


MAX_PROMPT_OVERRIDE_LENGTH = 2000


class PromptOverrideResponse(BaseModel):
    prompt_override: Optional[str] = None
    prompt_override_mode: str = "append"


class PromptOverrideUpdate(BaseModel):
    prompt_override: str
    prompt_override_mode: str


@router.get("/prompt-override", response_model=PromptOverrideResponse)
def get_prompt_override(
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    row = db.execute(
        text(
            "SELECT prompt_override, prompt_override_mode "
            "FROM user_profile WHERE user_id = :user_id"
        ),
        {"user_id": user_id},
    ).first()
    if not row:
        return PromptOverrideResponse()
    return PromptOverrideResponse(
        prompt_override=row[0] or None,
        prompt_override_mode=(row[1] or "append"),
    )


@router.put("/prompt-override", response_model=PromptOverrideResponse)
def update_prompt_override(
    body: PromptOverrideUpdate,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()

    mode = (body.prompt_override_mode or "").strip()
    if mode not in ("append", "prepend"):
        raise HTTPException(
            status_code=400,
            detail="prompt_override_mode must be 'append' or 'prepend'",
        )

    override = (body.prompt_override or "").strip()
    if len(override) > MAX_PROMPT_OVERRIDE_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"prompt_override must be {MAX_PROMPT_OVERRIDE_LENGTH} characters or fewer",
        )

    # Ensure the profile row exists before updating
    profile = db.get(UserProfile, user_id)
    if not profile:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        db.commit()

    db.execute(
        text(
            "UPDATE user_profile "
            "SET prompt_override = :override, prompt_override_mode = :mode "
            "WHERE user_id = :user_id"
        ),
        {"override": override or None, "mode": mode, "user_id": user_id},
    )
    db.commit()

    return PromptOverrideResponse(
        prompt_override=override or None,
        prompt_override_mode=mode,
    )
