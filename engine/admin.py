"""Admin-only routes: User Management + Email Management."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session, select

from db import get_session
from models import UserProfile, AuthConfig, EmailSendLog, EmailWebhookEvent
from auth_deps import require_admin
from supertokens_python.asyncio import get_users_oldest_first
from email_client import send_email_via_web
from email_stats import record_email_send

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


class EmailStatsSummaryResponse(BaseModel):
    from_date: Optional[datetime] = None
    to_date: Optional[datetime] = None
    sent: int
    delivered: int
    opened: int
    clicked: int
    bounced: int
    complained: int
    failed: int
    total_events: int


class EmailStatsPoint(BaseModel):
    bucket: str
    sent: int = 0
    delivered: int = 0
    opened: int = 0
    clicked: int = 0
    bounced: int = 0
    complained: int = 0
    failed: int = 0


class EmailStatsTimeseriesResponse(BaseModel):
    from_date: Optional[datetime] = None
    to_date: Optional[datetime] = None
    bucket: str = "day"
    points: List[EmailStatsPoint]


class EmailRecentSend(BaseModel):
    id: str
    created_at: datetime
    email: str
    email_type: str
    subject: Optional[str] = None
    status: str
    provider_message_id: Optional[str] = None
    error: Optional[str] = None


class EmailStatsRecentResponse(BaseModel):
    sends: List[EmailRecentSend]


class AuthConfigResponse(BaseModel):
    email_password_enabled: bool
    allow_sign_up: bool
    password_min_length: int
    password_require_uppercase: bool
    password_require_lowercase: bool
    password_require_number: bool
    password_require_special: bool
    registration_subject: str
    registration_body: str
    welcome_subject: str
    welcome_body: str
    reset_confirmation_subject: str
    reset_confirmation_body: str
    updated_at: datetime


class AuthConfigUpdate(BaseModel):
    email_password_enabled: Optional[bool] = None
    allow_sign_up: Optional[bool] = None
    password_min_length: Optional[int] = None
    password_require_uppercase: Optional[bool] = None
    password_require_lowercase: Optional[bool] = None
    password_require_number: Optional[bool] = None
    password_require_special: Optional[bool] = None
    registration_subject: Optional[str] = None
    registration_body: Optional[str] = None
    welcome_subject: Optional[str] = None
    welcome_body: Optional[str] = None
    reset_confirmation_subject: Optional[str] = None
    reset_confirmation_body: Optional[str] = None


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


def _get_or_create_auth_config(db: Session) -> AuthConfig:
    config = db.get(AuthConfig, 1)
    if config:
        return config
    config = AuthConfig(id=1)
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


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
        result = await send_email_via_web(
            type="notification",
            email=recipient.email,
            title=subject,
            body=message_body,
            ctaUrl=body.cta_url or "",
            ctaLabel=body.cta_label or "",
        )
        record_email_send(
            db,
            email=recipient.email,
            email_type="notification",
            send_result=result,
            subject=subject,
            user_id=recipient.user_id,
            metadata={
                "source": "admin_bulk_send",
                "cta_url": body.cta_url or "",
                "cta_label": body.cta_label or "",
            },
        )
        if result.ok:
            sent_count += 1
        else:
            failed_user_ids.append(recipient.user_id)

    return BulkEmailSendResponse(
        targeted=len(recipients),
        sent=sent_count,
        failed=len(failed_user_ids),
        failed_user_ids=failed_user_ids,
    )


def _filter_send_rows(
    db: Session, from_date: Optional[datetime], to_date: Optional[datetime]
) -> list[EmailSendLog]:
    statement = select(EmailSendLog)
    if from_date is not None:
        statement = statement.where(EmailSendLog.created_at >= from_date)
    if to_date is not None:
        statement = statement.where(EmailSendLog.created_at <= to_date)
    statement = statement.order_by(EmailSendLog.created_at.desc())
    return list(db.exec(statement).all())


@router.get("/email/stats/summary", response_model=EmailStatsSummaryResponse)
async def admin_email_stats_summary(
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    rows = _filter_send_rows(db, from_date, to_date)
    counters = {
        "sent": 0,
        "delivered": 0,
        "opened": 0,
        "clicked": 0,
        "bounced": 0,
        "complained": 0,
        "failed": 0,
    }
    for row in rows:
        status = (row.status or "").lower().strip()
        if status in counters:
            counters[status] += 1
        elif status.startswith("email."):
            key = status.split(".", 1)[1]
            if key in counters:
                counters[key] += 1
    event_statement = select(EmailWebhookEvent)
    if from_date is not None:
        event_statement = event_statement.where(EmailWebhookEvent.created_at >= from_date)
    if to_date is not None:
        event_statement = event_statement.where(EmailWebhookEvent.created_at <= to_date)
    total_events = len(list(db.exec(event_statement).all()))
    return EmailStatsSummaryResponse(
        from_date=from_date,
        to_date=to_date,
        total_events=total_events,
        **counters,
    )


@router.get("/email/stats/timeseries", response_model=EmailStatsTimeseriesResponse)
async def admin_email_stats_timeseries(
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    bucket: str = "day",
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    if bucket not in {"day"}:
        raise HTTPException(status_code=400, detail="Only bucket=day is currently supported")

    rows = _filter_send_rows(db, from_date, to_date)
    points: dict[str, EmailStatsPoint] = {}

    for row in rows:
        key = row.created_at.strftime("%Y-%m-%d")
        if key not in points:
            points[key] = EmailStatsPoint(bucket=key)
        status = (row.status or "").lower().strip()
        if status.startswith("email."):
            status = status.split(".", 1)[1]
        if status in {"sent", "delivered", "opened", "clicked", "bounced", "complained", "failed"}:
            setattr(points[key], status, getattr(points[key], status) + 1)

    ordered = [points[k] for k in sorted(points.keys())]
    return EmailStatsTimeseriesResponse(
        from_date=from_date,
        to_date=to_date,
        bucket="day",
        points=ordered,
    )


@router.get("/email/stats/recent", response_model=EmailStatsRecentResponse)
async def admin_email_stats_recent(
    limit: int = 50,
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    bounded_limit = max(1, min(limit, 200))
    rows = list(
        db.exec(
            select(EmailSendLog)
            .order_by(EmailSendLog.created_at.desc())
            .limit(bounded_limit)
        ).all()
    )
    return EmailStatsRecentResponse(
        sends=[
            EmailRecentSend(
                id=str(row.id),
                created_at=row.created_at,
                email=row.email,
                email_type=row.email_type,
                subject=row.subject,
                status=row.status,
                provider_message_id=row.provider_message_id,
                error=row.error,
            )
            for row in rows
        ]
    )


@router.get("/auth/config", response_model=AuthConfigResponse)
async def admin_get_auth_config(
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    config = _get_or_create_auth_config(db)
    return AuthConfigResponse(
        email_password_enabled=config.email_password_enabled,
        allow_sign_up=config.allow_sign_up,
        password_min_length=config.password_min_length,
        password_require_uppercase=config.password_require_uppercase,
        password_require_lowercase=config.password_require_lowercase,
        password_require_number=config.password_require_number,
        password_require_special=config.password_require_special,
        registration_subject=config.registration_subject,
        registration_body=config.registration_body,
        welcome_subject=config.welcome_subject,
        welcome_body=config.welcome_body,
        reset_confirmation_subject=config.reset_confirmation_subject,
        reset_confirmation_body=config.reset_confirmation_body,
        updated_at=config.updated_at,
    )


@router.put("/auth/config", response_model=AuthConfigResponse)
async def admin_update_auth_config(
    body: AuthConfigUpdate,
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    config = _get_or_create_auth_config(db)
    data = body.model_dump(exclude_unset=True)

    if "password_min_length" in data:
        min_len = int(data["password_min_length"] or 0)
        if min_len < 6:
            raise HTTPException(status_code=400, detail="password_min_length must be at least 6")
        data["password_min_length"] = min_len

    for text_field in (
        "registration_subject",
        "registration_body",
        "welcome_subject",
        "welcome_body",
        "reset_confirmation_subject",
        "reset_confirmation_body",
    ):
        if text_field in data and isinstance(data[text_field], str):
            data[text_field] = data[text_field].strip()

    for key, value in data.items():
        setattr(config, key, value)
    config.updated_at = datetime.utcnow()
    db.add(config)
    db.commit()
    db.refresh(config)

    return AuthConfigResponse(
        email_password_enabled=config.email_password_enabled,
        allow_sign_up=config.allow_sign_up,
        password_min_length=config.password_min_length,
        password_require_uppercase=config.password_require_uppercase,
        password_require_lowercase=config.password_require_lowercase,
        password_require_number=config.password_require_number,
        password_require_special=config.password_require_special,
        registration_subject=config.registration_subject,
        registration_body=config.registration_body,
        welcome_subject=config.welcome_subject,
        welcome_body=config.welcome_body,
        reset_confirmation_subject=config.reset_confirmation_subject,
        reset_confirmation_body=config.reset_confirmation_body,
        updated_at=config.updated_at,
    )
