"""Admin-only routes: User Management + Email Management."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session

from db import get_session
from models import UserProfile
from auth_deps import require_admin
from supertokens_python.asyncio import get_users_oldest_first
from email_client import send_email_via_web

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


class BulkEmailRecipient(BaseModel):
    user_id: str
    email: str


class BulkEmailPreviewResponse(BaseModel):
    targeted: int
    recipients: List[BulkEmailRecipient]


class BulkEmailSendRequest(BaseModel):
    subject: str
    body: str
    cta_url: Optional[str] = None
    cta_label: Optional[str] = None
    require_communication_email: bool = False


class BulkEmailSendResponse(BaseModel):
    targeted: int
    sent: int
    failed: int
    failed_user_ids: List[str] = []


async def _build_bulk_email_recipients(
    db: Session, require_communication_email: bool = False
) -> List[BulkEmailRecipient]:
    users_response = await get_users_oldest_first("public")
    recipients: list[BulkEmailRecipient] = []

    for u in users_response.users:
        user_id = getattr(u, "user_id", None) or getattr(u, "id", None)
        if not user_id:
            continue

        profile = db.get(UserProfile, str(user_id))
        if profile and profile.blocked:
            continue

        notifications_opt_in = (
            profile.notifications_opt_in if profile is not None else True
        )
        if not notifications_opt_in:
            continue

        communication_email = (
            (profile.communication_email or "").strip()
            if profile and profile.communication_email
            else ""
        )
        auth_email = ""
        emails = getattr(u, "emails", None) or []
        if emails:
            auth_email = str(emails[0]).strip()
        else:
            maybe_email = getattr(u, "email", None)
            if maybe_email:
                auth_email = str(maybe_email).strip()

        recipient_email = (
            communication_email
            if require_communication_email
            else (communication_email or auth_email)
        )
        if not recipient_email:
            continue

        recipients.append(
            BulkEmailRecipient(user_id=str(user_id), email=recipient_email)
        )

    return recipients


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


@router.get("/email/bulk/preview", response_model=BulkEmailPreviewResponse)
async def admin_email_bulk_preview(
    require_communication_email: bool = False,
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    recipients = await _build_bulk_email_recipients(
        db, require_communication_email=require_communication_email
    )
    return BulkEmailPreviewResponse(
        targeted=len(recipients),
        recipients=recipients[:25],  # preview sample only
    )


@router.post("/email/bulk-send", response_model=BulkEmailSendResponse)
async def admin_email_bulk_send(
    body: BulkEmailSendRequest,
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    subject = body.subject.strip()
    message_body = body.body.strip()
    if not subject or not message_body:
        raise HTTPException(status_code=400, detail="subject and body are required")

    recipients = await _build_bulk_email_recipients(
        db, require_communication_email=body.require_communication_email
    )
    failed_user_ids: list[str] = []
    sent_count = 0

    for recipient in recipients:
        ok = await send_email_via_web(
            type="notification",
            email=recipient.email,
            title=subject,
            body=message_body,
            ctaUrl=body.cta_url or "",
            ctaLabel=body.cta_label or "",
        )
        if ok:
            sent_count += 1
        else:
            failed_user_ids.append(recipient.user_id)

    return BulkEmailSendResponse(
        targeted=len(recipients),
        sent=sent_count,
        failed=len(failed_user_ids),
        failed_user_ids=failed_user_ids,
    )
