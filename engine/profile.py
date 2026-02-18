from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from db import get_session
from models import UserProfile
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from sqlmodel import Session

router = APIRouter(prefix="/profile", tags=["profile"])


class ProfileResponse(BaseModel):
    user_id: str
    name: Optional[str] = None
    company: Optional[str] = None
    auth_email_masked: Optional[str] = None  # Login email (masked); from SuperTokens
    communication_email: Optional[str] = None
    username: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    admin: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    communication_email: Optional[str] = None
    username: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None


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


@router.get("", response_model=ProfileResponse)
@router.get("/", response_model=ProfileResponse)
async def get_profile(
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = db.get(UserProfile, user_id)

    auth_email_masked = await _get_auth_email_masked(user_id)

    if not profile:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)

    return ProfileResponse(
        user_id=profile.user_id,
        name=profile.name,
        company=profile.company,
        auth_email_masked=auth_email_masked,
        communication_email=profile.communication_email,
        username=profile.username,
        phone=profile.phone,
        address=profile.address,
        admin=profile.admin,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
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

    data = body.model_dump() if hasattr(body, "model_dump") else body.dict(exclude_unset=True)
    for key, value in data.items():
        setattr(profile, key, value)
    profile.updated_at = datetime.utcnow()
    db.add(profile)
    db.commit()
    db.refresh(profile)

    auth_email_masked = await _get_auth_email_masked(user_id)

    return ProfileResponse(
        user_id=profile.user_id,
        name=profile.name,
        company=profile.company,
        auth_email_masked=auth_email_masked,
        communication_email=profile.communication_email,
        username=profile.username,
        phone=profile.phone,
        address=profile.address,
        admin=profile.admin,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )
