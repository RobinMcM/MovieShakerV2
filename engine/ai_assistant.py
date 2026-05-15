import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.session.framework.fastapi import verify_session

from credits import apply_credit_cost, ensure_user_can_generate, extract_credit_cost
from db import get_session
from gateway_client import GatewayClient, GatewayClientError
from config import load_settings
logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai-assistant"])
settings = load_settings()


# ---------------------------------------------------------------------------
# Gateway helpers — identical pattern to film_in_a_box.py
# ---------------------------------------------------------------------------

def _gateway_client() -> GatewayClient:
    return GatewayClient(
        base_url=settings.gateway_base_url,
        api_key=settings.gateway_internal_api_key,
        timeout_seconds=settings.gateway_timeout_seconds,
        verify_tls=settings.gateway_verify_tls,
    )


def _extract_text_from_gateway(response: dict) -> str:
    if not isinstance(response, dict):
        return ""
    result_block = response.get("result")
    if isinstance(result_block, dict):
        choices = result_block.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                message = first.get("message")
                if isinstance(message, dict):
                    content = message.get("content")
                    if isinstance(content, str) and content.strip():
                        return content.strip()
                text_val = first.get("text")
                if isinstance(text_val, str) and text_val.strip():
                    return text_val.strip()
    for key in ("text", "result", "output", "content", "message"):
        value = response.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _build_chat_messages(
    messages: list[dict[str, str]],
    system_prompt: str | None = None,
) -> list[dict[str, str]]:
    """
    Build the message list for the gateway execute_text call.
    Accepts full conversation history (user + assistant turns).
    System message is always prepended.
    """
    system = system_prompt or (
        "You are a helpful assistant for MovieShaker, a film production management platform. "
        "Help users with their film projects, scripts, budgeting, scheduling, and production operations. "
        "Keep responses practical and production-oriented."
    )
    validated = [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)
    ]
    return [{"role": "system", "content": system}] + validated


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str   # "user" or "assistant"
    content: str


class ChatBody(BaseModel):
    messages: list[ChatMessage]
    model: Optional[str] = None
    system_prompt: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/chat")
def chat(
    body: ChatBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """
    Send a conversation to the AI gateway and return the assistant reply.
    The caller is responsible for maintaining and sending the full message
    history on each request (stateless on the engine side for Phase 1).
    Credits are deducted per call based on gateway usage reporting.
    """
    user_id = session.get_user_id()
    profile = ensure_user_can_generate(db, user_id)

    if not body.messages:
        raise HTTPException(status_code=400, detail="messages are required")
    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")

    # Validate roles before sending to gateway
    for msg in body.messages:
        if msg.role not in ("user", "assistant"):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid message role '{msg.role}'. Must be 'user' or 'assistant'.",
            )

    messages = [{"role": m.role, "content": m.content} for m in body.messages]

    try:
        gateway_response = _gateway_client().execute_text_autonomous(
            team="cowriter",
            task="cowriter-text",
            messages=_build_chat_messages(messages, system_prompt=body.system_prompt),
        )
        reply = _extract_text_from_gateway(gateway_response)
        if not reply:
            raise HTTPException(status_code=502, detail="Gateway returned an empty response")
        credits_cost = extract_credit_cost(gateway_response)
        balance = apply_credit_cost(db, user_id, credits_cost)
        db.commit()
        return {
            "reply": reply,
            "credits": {"cost": credits_cost, "balance": balance},
        }
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


