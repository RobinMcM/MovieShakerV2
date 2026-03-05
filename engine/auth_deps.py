"""Dependencies for role-based access. Requires session and loads UserProfile."""
from fastapi import Depends, HTTPException

from db import get_session
from models import UserProfile
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from sqlmodel import Session


async def require_admin(
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
) -> UserProfile:
    """Load current user's profile; raise 403 if not admin or if blocked."""
    user_id = session.get_user_id()
    profile = db.get(UserProfile, user_id)
    if not profile:
        raise HTTPException(status_code=403, detail="Profile not found")
    if profile.blocked:
        raise HTTPException(status_code=403, detail="Account is blocked")
    if profile.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return profile
