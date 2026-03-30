"""Send emails via the Next.js internal send-email API (Resend + React Email)."""
import os
import logging
import httpx
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

WEB_INTERNAL_URL = os.getenv("WEB_INTERNAL_URL", "http://localhost:3000").rstrip("/")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
APP_ENV = (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or "development").lower()


@dataclass
class EmailSendResult:
    ok: bool
    provider_message_id: Optional[str] = None
    error: Optional[str] = None
    status_code: Optional[int] = None


async def send_email_via_web(
    *,
    type: str,
    email: str,
    **payload,
) -> EmailSendResult:
    """
    POST to Next.js /api/internal/send-email. Requires INTERNAL_API_KEY and WEB_INTERNAL_URL.
    For type='verification': pass verifyUrl=...
    For type='notification': pass title=..., body=..., and optionally ctaUrl=..., ctaLabel=...
    For type='registration_confirmation', 'welcome_email', or 'password_reset_confirmation': email is required.
    """
    if not INTERNAL_API_KEY:
        logger.warning("INTERNAL_API_KEY not set; skipping send_email_via_web")
        return EmailSendResult(ok=False, error="INTERNAL_API_KEY not set")
    if APP_ENV == "production" and "localhost" in WEB_INTERNAL_URL:
        logger.warning("WEB_INTERNAL_URL points to localhost in production; email delivery is likely misconfigured")
    url = f"{WEB_INTERNAL_URL}/api/internal/send-email"
    headers = {"Content-Type": "application/json", "x-internal-api-key": INTERNAL_API_KEY}
    body = {"type": type, "email": email, **payload}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(url, json=body, headers=headers)
            if r.status_code >= 400:
                logger.warning(
                    "send_email_via_web failed: %s %s",
                    r.status_code,
                    r.text[:200],
                )
                return EmailSendResult(
                    ok=False,
                    error=r.text[:500],
                    status_code=r.status_code,
                )
            provider_message_id = None
            try:
                body_json = r.json()
                maybe_id = body_json.get("provider_message_id") or body_json.get("id")
                if isinstance(maybe_id, str) and maybe_id.strip():
                    provider_message_id = maybe_id.strip()
            except Exception:
                provider_message_id = None
            return EmailSendResult(
                ok=True,
                provider_message_id=provider_message_id,
                status_code=r.status_code,
            )
    except Exception as e:
        logger.exception("send_email_via_web error: %s", e)
        return EmailSendResult(ok=False, error=str(e))
