import json
from datetime import datetime, timezone
from typing import Any, Optional

from sqlmodel import Session, select

from email_client import EmailSendResult
from models import EmailSendLog


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def record_email_send(
    db: Session,
    *,
    email: str,
    email_type: str,
    send_result: EmailSendResult,
    subject: Optional[str] = None,
    user_id: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> EmailSendLog:
    now = _utcnow_naive()
    status = "sent" if send_result.ok else "failed"
    row = EmailSendLog(
        user_id=user_id,
        email=email,
        email_type=email_type,
        subject=subject,
        provider="resend",
        provider_message_id=send_result.provider_message_id,
        status=status,
        error=send_result.error,
        metadata_json=json.dumps(metadata or {}),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def apply_provider_event_to_send_status(
    db: Session,
    *,
    provider_message_id: str,
    event_type: str,
) -> None:
    statement = select(EmailSendLog).where(
        EmailSendLog.provider_message_id == provider_message_id
    )
    rows = db.exec(statement).all()
    if not rows:
        return

    lowered = event_type.lower()
    status = lowered
    if lowered.startswith("email."):
        status = lowered.split(".", 1)[1]
    if status == "sent":
        status = "sent"
    if status in {"delivered", "opened", "clicked", "bounced", "complained"}:
        normalized = status
    elif status in {"delivery_delayed", "delivery.attempted"}:
        normalized = "delayed"
    else:
        normalized = status

    now = _utcnow_naive()
    for row in rows:
        row.status = normalized
        row.updated_at = now
        db.add(row)
    db.commit()
