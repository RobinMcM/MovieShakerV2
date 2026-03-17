import json
import math
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session

from models import UserProfile


def get_or_create_profile(db: Session, user_id: str) -> UserProfile:
    profile = db.get(UserProfile, user_id)
    if profile is None:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        db.flush()
    return profile


def ensure_user_can_generate(db: Session, user_id: str) -> UserProfile:
    profile = get_or_create_profile(db, user_id)
    if profile.ai_credits < 0:
        deficit = abs(profile.ai_credits)
        raise HTTPException(
            status_code=402,
            detail=(
                f"Insufficient credits. Your account is in a {deficit} credit deficit. "
                "Purchase credits to continue generating."
            ),
        )
    return profile


def apply_credit_cost(db: Session, user_id: str, credits_cost: int) -> int:
    profile = get_or_create_profile(db, user_id)
    if credits_cost == 0:
        return profile.ai_credits
    profile.ai_credits -= credits_cost
    db.add(profile)
    db.flush()
    return profile.ai_credits


def _parse_number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except Exception:
            return None
    return None


def _extract_numeric_by_priority(data: Any) -> float | None:
    if isinstance(data, dict):
        priority_keys = (
            "credits",
            "credit_cost",
            "cost_credits",
            "total_credits",
            "cost",
            "total_cost",
            "amount",
            "total",
        )
        for key in priority_keys:
            if key in data:
                parsed = _parse_number(data.get(key))
                if parsed is not None:
                    return parsed

        for key, value in data.items():
            lower = str(key).lower()
            if any(token in lower for token in ("credit", "cost", "amount", "total")):
                parsed = _parse_number(value)
                if parsed is not None:
                    return parsed

        for value in data.values():
            nested = _extract_numeric_by_priority(value)
            if nested is not None:
                return nested
        return None

    if isinstance(data, list):
        for item in data:
            nested = _extract_numeric_by_priority(item)
            if nested is not None:
                return nested
        return None

    return _parse_number(data)


def extract_credit_cost(payload: Any) -> int:
    """
    Extract gateway-reported cost and convert to integer credits.
    Tries usage first, then estimate, then any nested cost/credit fields.
    """
    source = payload
    if isinstance(payload, str):
        try:
            source = json.loads(payload)
        except Exception:
            source = payload

    if isinstance(source, dict):
        for key in ("usage", "actual_usage", "estimate"):
            if key in source:
                value = _extract_numeric_by_priority(source.get(key))
                if value is not None:
                    return max(0, int(math.ceil(value)))

    value = _extract_numeric_by_priority(source)
    if value is None:
        return 0
    return max(0, int(math.ceil(value)))
