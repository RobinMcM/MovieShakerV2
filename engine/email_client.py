"""Send emails via the Next.js internal send-email API (Resend + React Email)."""
import os
import logging
import httpx

logger = logging.getLogger(__name__)

WEB_INTERNAL_URL = os.getenv("WEB_INTERNAL_URL", "http://localhost:3000").rstrip("/")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
APP_ENV = (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or "development").lower()


async def send_email_via_web(
    *,
    type: str,
    email: str,
    **payload,
) -> bool:
    """
    POST to Next.js /api/internal/send-email. Requires INTERNAL_API_KEY and WEB_INTERNAL_URL.
    For type='verification': pass verifyUrl=...
    For type='notification': pass title=..., body=..., and optionally ctaUrl=..., ctaLabel=...
    For type='registration_confirmation', 'welcome_email', or 'password_reset_confirmation': email is required.
    """
    if not INTERNAL_API_KEY:
        logger.warning("INTERNAL_API_KEY not set; skipping send_email_via_web")
        return False
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
                return False
            return True
    except Exception as e:
        logger.exception("send_email_via_web error: %s", e)
        return False
