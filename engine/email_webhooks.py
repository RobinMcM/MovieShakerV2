"""Webhook ingestion endpoints for email provider events."""

import json
import os
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session
from svix.webhooks import Webhook, WebhookVerificationError

from db import get_session
from models import EmailWebhookEvent
from email_stats import apply_provider_event_to_send_status

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text).replace(tzinfo=None)
    except Exception:
        return None


@router.post("/resend")
async def ingest_resend_webhook(
    request: Request,
    db: Session = Depends(get_session),
):
    webhook_secret = (os.getenv("RESEND_WEBHOOK_SECRET") or "").strip()
    if not webhook_secret:
        raise HTTPException(status_code=503, detail="Webhook secret is not configured")

    raw_body = await request.body()
    payload = raw_body.decode("utf-8")
    headers = request.headers
    svix_id = headers.get("svix-id")
    svix_timestamp = headers.get("svix-timestamp")
    svix_signature = headers.get("svix-signature")

    if not svix_id or not svix_timestamp or not svix_signature:
        raise HTTPException(status_code=400, detail="Missing required svix headers")

    try:
        Webhook(webhook_secret).verify(
            payload,
            {
                "svix-id": svix_id,
                "svix-timestamp": svix_timestamp,
                "svix-signature": svix_signature,
            },
        )
    except WebhookVerificationError:
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        body = json.loads(payload)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook payload")

    event_type = str(body.get("type") or "unknown")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    provider_message_id = (
        str(data.get("email_id")).strip() if data and data.get("email_id") else None
    )
    event_timestamp = _parse_iso_datetime(body.get("created_at")) or _parse_iso_datetime(
        data.get("created_at") if isinstance(data, dict) else None
    )

    event = EmailWebhookEvent(
        provider="resend",
        provider_message_id=provider_message_id,
        event_type=event_type,
        dedupe_key=svix_id,
        event_timestamp=event_timestamp,
        signature_valid=True,
        payload_json=payload,
    )

    try:
        db.add(event)
        db.commit()
    except IntegrityError:
        db.rollback()
        return {"ok": True, "duplicate": True}

    if provider_message_id:
        apply_provider_event_to_send_status(
            db,
            provider_message_id=provider_message_id,
            event_type=event_type,
        )

    return {"ok": True, "event_type": event_type, "provider_message_id": provider_message_id}
