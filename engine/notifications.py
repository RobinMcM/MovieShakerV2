"""Create in-app notifications and send notification emails via the web (Resend + React Email)."""
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from db import get_session
from models import UserProfile, Notification
from email_client import send_email_via_web
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationResponse(BaseModel):
    id: uuid.UUID
    type: str
    title: str
    body: Optional[str] = None
    payload: Optional[str] = None
    read_at: Optional[datetime] = None
    created_at: datetime


@router.get("", response_model=list[NotificationResponse])
@router.get("/", response_model=list[NotificationResponse])
def list_notifications(
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """List notifications for the current user, newest first."""
    user_id = session.get_user_id()
    statement = (
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(100)
    )
    rows = db.exec(statement).all()
    return [
        NotificationResponse(
            id=r.id,
            type=r.type,
            title=r.title,
            body=r.body,
            payload=r.payload,
            read_at=r.read_at,
            created_at=r.created_at,
        )
        for r in rows
    ]


async def send_notification_email(
    db: Session,
    user_id: str,
    type: str,
    title: str,
    body: str,
    *,
    cta_url: Optional[str] = None,
    cta_label: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
) -> Optional[uuid.UUID]:
    """
    Create a Notification row and send an email to the user's communication_email (or auth email).
    Returns the notification id, or None if no email could be resolved or send failed.
    """
    # Resolve recipient: prefer UserProfile.communication_email
    profile = db.get(UserProfile, user_id)
    email = None
    if profile and profile.communication_email:
        email = profile.communication_email
    if not email:
        try:
            from supertokens_python.recipe.emailpassword.asyncio import get_user_by_id
            user = await get_user_by_id(user_id)
            if user and getattr(user, "email", None):
                email = user.email
        except Exception:
            pass
    if not email:
        logger.warning("send_notification_email: no email for user_id=%s", user_id)
        return None

    payload_json = json.dumps(payload) if payload else None
    notification = Notification(
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        payload=payload_json,
    )
    db.add(notification)
    db.commit()
    db.refresh(notification)

    ok = await send_email_via_web(
        type="notification",
        email=email,
        title=title,
        body=body,
        ctaUrl=cta_url or "",
        ctaLabel=cta_label or "",
    )
    if not ok:
        logger.warning("send_notification_email: web send failed for user_id=%s", user_id)
    return notification.id
