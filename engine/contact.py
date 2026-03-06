"""Public contact form: POST /contact to store submissions (no auth)."""
import re
import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session

from db import get_session
from models import ContactSubmission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contact", tags=["contact"])


class ContactSubmitBody(BaseModel):
    name: str
    email: str
    message: str
    honeypot: str | None = None

    class Config:
        json_schema_extra = {
            "example": {"name": "Jane", "email": "jane@example.com", "message": "Hello!"},
        }


# Simple in-memory rate limit: IP -> list of timestamps (prune old)
_submission_times: dict[str, list[float]] = {}
RATE_LIMIT_SEC = 60
RATE_LIMIT_COUNT = 3


def _check_rate_limit(ip: str) -> bool:
    import time
    now = time.time()
    if ip not in _submission_times:
        _submission_times[ip] = []
    times = _submission_times[ip]
    times[:] = [t for t in times if now - t < RATE_LIMIT_SEC]
    if len(times) >= RATE_LIMIT_COUNT:
        return False
    times.append(now)
    return True


@router.post("", status_code=201)
def submit_contact(request: Request, body: ContactSubmitBody, db: Session = Depends(get_session)):
    """Store a contact form submission. No auth. Honeypot filled = silent success."""
    if body.honeypot and body.honeypot.strip():
        return {"success": True, "message": "Thank you for your message."}

    name = (body.name or "").strip()
    if not name or len(name) > 100:
        raise HTTPException(status_code=400, detail="Name is required (max 100 characters).")
    email = (body.email or "").strip()
    if not email or len(email) > 255:
        raise HTTPException(status_code=400, detail="Valid email is required.")
    if not re.match(r"^[^@]+@[^@]+\.[^@]+$", email):
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    message = (body.message or "").strip()
    if not message or len(message) < 10:
        raise HTTPException(status_code=400, detail="Message must be at least 10 characters.")
    if len(message) > 10000:
        raise HTTPException(status_code=400, detail="Message must be less than 10000 characters.")

    client_ip = request.client.host if request.client else request.headers.get("x-forwarded-for", "unknown").split(",")[0].strip()
    if not _check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many submissions. Please try again in a minute.")

    sub = ContactSubmission(
        name=name,
        email=email,
        message=message,
        honeypot=body.honeypot[:500] if body.honeypot else None,
    )
    db.add(sub)
    db.commit()
    logger.info("Contact submission from %s (%s)", email, client_ip)
    return {"success": True, "message": "Thank you for your message. We'll get back to you soon."}
