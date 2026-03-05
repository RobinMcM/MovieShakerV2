"""Admin-only routes: User Management (list users with profile, update role/tier/blocked)."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session

from db import get_session
from models import UserProfile
from auth_deps import require_admin
from supertokens_python.asyncio import get_users_oldest_first

router = APIRouter(prefix="/admin", tags=["admin"])


class UserWithProfileResponse(BaseModel):
    user_id: str
    email: str
    time_joined: int
    phone_number: Optional[str] = None
    role: str = "producer"
    producer_tier: str = "standard"
    blocked: bool = False


class AdminUserUpdate(BaseModel):
    role: Optional[str] = None
    producer_tier: Optional[str] = None
    blocked: Optional[bool] = None


@router.get("/users", response_model=List[UserWithProfileResponse])
async def admin_list_users(
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """List all users with profile (role, producer_tier, blocked). Admin only."""
    users_response = await get_users_oldest_first("public")
    out = []
    for u in users_response.users:
        user_id = getattr(u, "user_id", None) or getattr(u, "id", None)
        if not user_id:
            continue
        emails = getattr(u, "emails", None) or []
        email = emails[0] if emails else (getattr(u, "email", None) or "")
        if isinstance(email, list):
            email = email[0] if email else ""
        time_joined = getattr(u, "time_joined", 0) or 0
        if isinstance(time_joined, float):
            time_joined = int(time_joined)
        phone_numbers = getattr(u, "phone_numbers", None) or []
        phone_number = phone_numbers[0] if phone_numbers else None
        profile = db.get(UserProfile, user_id)
        role = "producer"
        producer_tier = "standard"
        blocked = False
        if profile:
            role = profile.role or "producer"
            producer_tier = profile.producer_tier or "standard"
            blocked = profile.blocked or False
        out.append(
            UserWithProfileResponse(
                user_id=str(user_id),
                email=str(email),
                time_joined=time_joined,
                phone_number=phone_number,
                role=role,
                producer_tier=producer_tier,
                blocked=blocked,
            )
        )
    return out


@router.patch("/users/{user_id}", response_model=UserWithProfileResponse)
async def admin_update_user(
    user_id: str,
    body: AdminUserUpdate,
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Update a user's role, producer_tier, or blocked. Admin only."""
    profile = db.get(UserProfile, user_id)
    if not profile:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    if body.role is not None:
        if body.role not in ("admin", "producer"):
            raise HTTPException(status_code=400, detail="role must be admin or producer")
        profile.role = body.role
    if body.producer_tier is not None:
        if body.producer_tier not in ("standard", "indie", "production_company"):
            raise HTTPException(
                status_code=400,
                detail="producer_tier must be standard, indie, or production_company",
            )
        profile.producer_tier = body.producer_tier
    if body.blocked is not None:
        profile.blocked = body.blocked
    profile.updated_at = datetime.utcnow()
    db.add(profile)
    db.commit()
    db.refresh(profile)

    # Fetch email from SuperTokens for response
    email = ""
    time_joined = 0
    try:
        from supertokens_python.recipe.emailpassword.asyncio import get_user_by_id
        user = await get_user_by_id(user_id)
        if user and getattr(user, "email", None):
            email = user.email
        if user and getattr(user, "time_joined", None):
            time_joined = user.time_joined or 0
    except Exception:
        pass

    return UserWithProfileResponse(
        user_id=profile.user_id,
        email=email,
        time_joined=time_joined,
        role=profile.role,
        producer_tier=profile.producer_tier,
        blocked=profile.blocked,
    )
