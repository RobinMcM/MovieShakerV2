"""Admin-only routes: User Management + Email Management."""
from datetime import datetime
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session, select
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

from db import get_session
from models import UserProfile, AuthConfig, ChatbotPromptConfig, EmailSendLog, EmailWebhookEvent
from auth_deps import require_admin
from supertokens_python.asyncio import get_users_oldest_first
from email_client import send_email_via_web
from email_stats import record_email_send

router = APIRouter(prefix="/admin", tags=["admin"])
MAX_CHATBOT_TEXT_LENGTH = 20000
HEX_COLOR_REGEX = re.compile(r"^#[0-9a-fA-F]{6}$")
CHATBOT_ROOT_SELECTIONS: dict[str, str] = {
    "the-film-festival": "The Film Festival",
}
CHATBOT_LAYOUT_SCHEMAS: dict[str, dict] = {
    "the-film-festival": {
        "page_title": "The Film Festival",
        "tabs": [
            {
                "tab_key": "positioning",
                "tab_label": "Positioning",
                "fields": [
                    {"field_key": "writer", "field_label": "Writer"},
                    {"field_key": "format", "field_label": "Format"},
                    {"field_key": "genre", "field_label": "Genre & Tone"},
                    {"field_key": "whyNow", "field_label": "Why this film now?"},
                    {"field_key": "comps", "field_label": "Comps"},
                    {"field_key": "targetAudience", "field_label": "Target Audience"},
                ],
            },
            {
                "tab_key": "funding",
                "tab_label": "Funding",
                "fields": [
                    {"field_key": "budgetMvp", "field_label": "MVP"},
                    {"field_key": "budgetTarget", "field_label": "Target"},
                    {"field_key": "budgetStretch", "field_label": "Stretch"},
                    {"field_key": "sourceGrants", "field_label": "Grants & Public Funds"},
                    {"field_key": "sourcePrivate", "field_label": "Private Investment"},
                    {"field_key": "sourceCrowd", "field_label": "Crowdfunding"},
                    {"field_key": "sourceInKind", "field_label": "In-kind Support"},
                ],
            },
            {
                "tab_key": "marketing",
                "tab_label": "Marketing",
                "fields": [
                    {"field_key": "logline", "field_label": "Logline"},
                    {"field_key": "synopsis", "field_label": "Synopsis"},
                    {"field_key": "visualTone", "field_label": "Visual Tone"},
                    {"field_key": "contentPlan", "field_label": "Content Plan"},
                    {"field_key": "channels", "field_label": "Channels"},
                    {"field_key": "pressOutlets", "field_label": "Press Outlets"},
                ],
            },
            {
                "tab_key": "festivals",
                "tab_label": "Festivals",
                "fields": [
                    {"field_key": "tier1", "field_label": "Tier 1"},
                    {"field_key": "tier2", "field_label": "Tier 2"},
                    {"field_key": "tier3", "field_label": "Tier 3"},
                    {"field_key": "distribution", "field_label": "Distribution"},
                ],
            },
        ],
    }
}


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


class ChatbotPromptConfigResponse(BaseModel):
    selection_key: str
    selection_label: str
    prompt_information: str
    prompt_rules: str
    accent_color: Optional[str] = None
    updated_at: datetime


class ChatbotPromptConfigUpdate(BaseModel):
    selection_key: str
    prompt_information: str
    prompt_rules: str
    accent_color: Optional[str] = None


class ChatbotContextStatusResponse(BaseModel):
    selection_key: str
    configured: bool
    selection_label: str
    prompt_information: str
    prompt_rules: str
    accent_color: Optional[str] = None


class ChatbotSelectionItem(BaseModel):
    selection_key: str
    selection_label: str


class ChatbotSelectionsResponse(BaseModel):
    selections: List[ChatbotSelectionItem]


class ChatbotLayoutField(BaseModel):
    field_key: str
    field_label: str


class ChatbotLayoutTab(BaseModel):
    tab_key: str
    tab_label: str
    fields: List[ChatbotLayoutField]


class ChatbotLayoutSchemaResponse(BaseModel):
    selection_key: str
    selection_label: str
    page_title: str
    tabs: List[ChatbotLayoutTab]
    generated_at: datetime


class GenerateSubSectionsRequest(BaseModel):
    selection_key: str


class GenerateSubSectionsResponse(BaseModel):
    root_selection_key: str
    created_or_updated: List[ChatbotSelectionItem]


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


def _get_or_create_chatbot_prompt_config(
    db: Session,
    selection_key: str,
    selection_label: Optional[str] = None,
    updated_by: Optional[str] = None,
) -> ChatbotPromptConfig:
    config = db.get(ChatbotPromptConfig, selection_key)
    if config:
        return config
    resolved_label = (
        selection_label
        or CHATBOT_ROOT_SELECTIONS.get(selection_key)
        or selection_key.replace("-", " ").replace("|", " | ").title()
    )
    config = ChatbotPromptConfig(
        selection_key=selection_key,
        selection_label=resolved_label,
        prompt_information="Please let us know more about your film.",
        prompt_rules=(
            "You are a film festival advisor. Ask focused questions relevant to this page "
            "and keep suggestions practical and concise."
        ),
        updated_by=updated_by,
        updated_at=datetime.utcnow(),
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def _resolve_root_selection_key(selection_key: str) -> Optional[str]:
    if selection_key in CHATBOT_ROOT_SELECTIONS:
        return selection_key
    if "::" in selection_key:
        possible_root = selection_key.split("::", 1)[0]
        if possible_root in CHATBOT_ROOT_SELECTIONS:
            return possible_root
    return None


def _derive_selection_label(selection_key: str) -> str:
    root_selection_key = _resolve_root_selection_key(selection_key)
    if root_selection_key is None:
        return selection_key
    root_label = CHATBOT_ROOT_SELECTIONS[root_selection_key]
    if selection_key == root_selection_key:
        return root_label
    if "::" in selection_key:
        tab_key = selection_key.split("::", 1)[1]
        layout = CHATBOT_LAYOUT_SCHEMAS.get(root_selection_key)
        if layout:
            matched_tab = next((tab for tab in layout["tabs"] if tab["tab_key"] == tab_key), None)
            if matched_tab:
                return f"{root_label} | {matched_tab['tab_label']}"
    return root_label


def _normalize_accent_color_or_none(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    if not HEX_COLOR_REGEX.match(normalized):
        raise HTTPException(status_code=400, detail="accent_color must be a hex value like #2563eb")
    return normalized


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


@router.get("/chatbot/config", response_model=ChatbotPromptConfigResponse)
async def admin_get_chatbot_prompt_config(
    selection: str = "the-film-festival",
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    selection_key = (selection or "").strip()
    if not selection_key:
        raise HTTPException(status_code=400, detail="selection is required")
    existing = db.get(ChatbotPromptConfig, selection_key)
    if existing is None and selection_key not in CHATBOT_ROOT_SELECTIONS:
        raise HTTPException(status_code=400, detail="Unsupported selection key")
    config = _get_or_create_chatbot_prompt_config(
        db, selection_key=selection_key, updated_by=_admin.user_id
    )
    return ChatbotPromptConfigResponse(
        selection_key=config.selection_key,
        selection_label=config.selection_label,
        prompt_information=config.prompt_information,
        prompt_rules=config.prompt_rules,
        accent_color=config.accent_color,
        updated_at=config.updated_at,
    )


@router.put("/chatbot/config", response_model=ChatbotPromptConfigResponse)
async def admin_update_chatbot_prompt_config(
    body: ChatbotPromptConfigUpdate,
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    selection_key = (body.selection_key or "").strip()
    if not selection_key:
        raise HTTPException(status_code=400, detail="selection_key is required")
    existing = db.get(ChatbotPromptConfig, selection_key)
    if existing is None and selection_key not in CHATBOT_ROOT_SELECTIONS:
        raise HTTPException(status_code=400, detail="Unsupported selection key")

    prompt_information = (body.prompt_information or "").strip()
    prompt_rules = (body.prompt_rules or "").strip()
    if not prompt_information:
        raise HTTPException(status_code=400, detail="prompt_information is required")
    if not prompt_rules:
        raise HTTPException(status_code=400, detail="prompt_rules is required")
    if len(prompt_information) > MAX_CHATBOT_TEXT_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"prompt_information must be <= {MAX_CHATBOT_TEXT_LENGTH} characters",
        )
    if len(prompt_rules) > MAX_CHATBOT_TEXT_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"prompt_rules must be <= {MAX_CHATBOT_TEXT_LENGTH} characters",
        )
    accent_color = _normalize_accent_color_or_none(body.accent_color)

    config = _get_or_create_chatbot_prompt_config(
        db, selection_key=selection_key, updated_by=_admin.user_id
    )
    if selection_key in CHATBOT_ROOT_SELECTIONS:
        config.selection_label = CHATBOT_ROOT_SELECTIONS[selection_key]
    config.prompt_information = prompt_information
    config.prompt_rules = prompt_rules
    config.accent_color = accent_color
    config.updated_by = _admin.user_id
    config.updated_at = datetime.utcnow()
    db.add(config)
    db.commit()
    db.refresh(config)
    return ChatbotPromptConfigResponse(
        selection_key=config.selection_key,
        selection_label=config.selection_label,
        prompt_information=config.prompt_information,
        prompt_rules=config.prompt_rules,
        accent_color=config.accent_color,
        updated_at=config.updated_at,
    )


@router.get("/chatbot/context-status", response_model=ChatbotContextStatusResponse)
async def get_chatbot_context_status(
    selection: str = "the-film-festival",
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = db.get(UserProfile, user_id)
    if profile and profile.blocked:
        raise HTTPException(status_code=403, detail="Account is blocked")

    selection_key = (selection or "").strip()
    root_selection_key = _resolve_root_selection_key(selection_key)
    if root_selection_key is None:
        return ChatbotContextStatusResponse(
            selection_key=selection_key,
            configured=False,
            selection_label=selection_key or "Unknown context",
            prompt_information="",
            prompt_rules="",
            accent_color=None,
        )

    config = db.get(ChatbotPromptConfig, selection_key)
    configured = bool(
        config
        and isinstance(config.prompt_information, str)
        and config.prompt_information.strip()
        and isinstance(config.prompt_rules, str)
        and config.prompt_rules.strip()
    )

    return ChatbotContextStatusResponse(
        selection_key=selection_key,
        configured=configured,
        selection_label=config.selection_label if config else _derive_selection_label(selection_key),
        prompt_information=config.prompt_information.strip() if configured else "",
        prompt_rules=config.prompt_rules.strip() if configured else "",
        accent_color=config.accent_color if config else None,
    )


@router.get("/chatbot/selections", response_model=ChatbotSelectionsResponse)
async def admin_get_chatbot_selections(
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    for key, label in CHATBOT_ROOT_SELECTIONS.items():
        _get_or_create_chatbot_prompt_config(
            db,
            selection_key=key,
            selection_label=label,
            updated_by=_admin.user_id,
        )
    rows = list(db.exec(select(ChatbotPromptConfig)).all())
    rows.sort(key=lambda row: row.selection_label.lower())
    return ChatbotSelectionsResponse(
        selections=[
            ChatbotSelectionItem(
                selection_key=row.selection_key,
                selection_label=row.selection_label,
            )
            for row in rows
        ]
    )


@router.post("/chatbot/generate-subsections", response_model=GenerateSubSectionsResponse)
async def admin_generate_chatbot_subsections(
    body: GenerateSubSectionsRequest,
    _admin: UserProfile = Depends(require_admin),
    db: Session = Depends(get_session),
):
    selection_key = (body.selection_key or "").strip()
    root_selection_key = _resolve_root_selection_key(selection_key)
    if root_selection_key is None:
        raise HTTPException(status_code=400, detail="Unsupported selection key")

    root_label = CHATBOT_ROOT_SELECTIONS[root_selection_key]
    layout = CHATBOT_LAYOUT_SCHEMAS.get(root_selection_key)
    if layout is None:
        raise HTTPException(status_code=404, detail="No layout schema configured")

    created_or_updated: list[ChatbotSelectionItem] = []

    root_config = _get_or_create_chatbot_prompt_config(
        db,
        selection_key=root_selection_key,
        selection_label=f"{root_label} | Root",
        updated_by=_admin.user_id,
    )
    root_config.selection_label = f"{root_label} | Root"
    root_config.updated_by = _admin.user_id
    root_config.updated_at = datetime.utcnow()
    db.add(root_config)
    created_or_updated.append(
        ChatbotSelectionItem(
            selection_key=root_config.selection_key,
            selection_label=root_config.selection_label,
        )
    )

    for tab in layout["tabs"]:
        tab_key = tab["tab_key"]
        tab_label = tab["tab_label"]
        sub_selection_key = f"{root_selection_key}::{tab_key}"
        sub_selection_label = f"{root_label} | {tab_label}"
        sub_config = _get_or_create_chatbot_prompt_config(
            db,
            selection_key=sub_selection_key,
            selection_label=sub_selection_label,
            updated_by=_admin.user_id,
        )
        sub_config.selection_label = sub_selection_label
        sub_config.updated_by = _admin.user_id
        sub_config.updated_at = datetime.utcnow()
        db.add(sub_config)
        created_or_updated.append(
            ChatbotSelectionItem(
                selection_key=sub_config.selection_key,
                selection_label=sub_config.selection_label,
            )
        )

    db.commit()
    return GenerateSubSectionsResponse(
        root_selection_key=root_selection_key,
        created_or_updated=created_or_updated,
    )


@router.get("/chatbot/layout", response_model=ChatbotLayoutSchemaResponse)
async def admin_get_chatbot_layout_schema(
    selection: str = "the-film-festival",
    _admin: UserProfile = Depends(require_admin),
):
    selection_key = (selection or "").strip()
    root_selection_key = _resolve_root_selection_key(selection_key)
    if root_selection_key is None:
        raise HTTPException(status_code=400, detail="Unsupported selection key")
    layout = CHATBOT_LAYOUT_SCHEMAS.get(root_selection_key)
    if layout is None:
        raise HTTPException(status_code=404, detail="No layout schema configured")
    tabs = layout["tabs"]
    page_title = layout["page_title"]
    if "::" in selection_key:
        tab_key = selection_key.split("::", 1)[1]
        matched_tab = next((tab for tab in tabs if tab["tab_key"] == tab_key), None)
        if matched_tab is None:
            raise HTTPException(status_code=404, detail="No layout tab configured")
        tabs = [matched_tab]
        page_title = f"{layout['page_title']} | {matched_tab['tab_label']}"
    return ChatbotLayoutSchemaResponse(
        selection_key=selection_key,
        selection_label=(
            CHATBOT_ROOT_SELECTIONS[root_selection_key]
            if selection_key == root_selection_key
            else selection_key.replace("::", " | ").replace("-", " ").title()
        ),
        page_title=page_title,
        tabs=[ChatbotLayoutTab(**tab) for tab in tabs],
        generated_at=datetime.utcnow(),
    )
