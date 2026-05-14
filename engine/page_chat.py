"""
Per-page chat sessions for non-script pages (scheduling, budgets, shotlist, objects, etc.).
Each page type within a project gets its own chat thread, persisted across navigation.

Tables: page_chat_sessions, page_chat_messages (created via db.init_db)
"""
import json
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session

from config import load_settings
from credits import ensure_user_can_generate, apply_credit_cost
from db import get_session
from gateway_client import GatewayClient, GatewayClientError
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

logger = logging.getLogger(__name__)
settings = load_settings()
router = APIRouter()

_VALID_AGENTS = {"cowriter", "coproducer", "codirector", "codesigner"}


def _gateway_client() -> GatewayClient:
    return GatewayClient(
        base_url=settings.gateway_base_url,
        api_key=settings.gateway_internal_api_key,
    )


def _get_or_create_session(db: Session, project_id: str, page_type: str, user_id: str) -> str:
    row = db.execute(
        text("""
            SELECT id FROM page_chat_sessions
            WHERE project_id = :pid AND page_type = :pt AND user_id = :uid
            LIMIT 1
        """),
        {"pid": project_id, "pt": page_type, "uid": user_id},
    ).first()
    if row:
        return str(row[0])
    result = db.execute(
        text("""
            INSERT INTO page_chat_sessions (project_id, page_type, user_id)
            VALUES (:pid, :pt, :uid)
            RETURNING id
        """),
        {"pid": project_id, "pt": page_type, "uid": user_id},
    ).first()
    db.commit()
    return str(result[0])


def _get_message_history(session_id: str, db: Session, max_turns: int = 20) -> list:
    rows = db.execute(
        text("""
            SELECT role, content FROM page_chat_messages
            WHERE session_id = :sid
            ORDER BY created_at ASC
            LIMIT :limit
        """),
        {"sid": session_id, "limit": max_turns * 2},
    ).fetchall()
    return [{"role": r[0], "content": r[1]} for r in rows]


def _get_current_script_for_project(project_id: str, db: Session) -> str | None:
    row = db.execute(
        text("""
            SELECT id FROM script
            WHERE project_id = :pid AND is_current = TRUE
            LIMIT 1
        """),
        {"pid": project_id},
    ).first()
    if not row:
        row = db.execute(
            text("SELECT id FROM script WHERE project_id = :pid ORDER BY created_at DESC LIMIT 1"),
            {"pid": project_id},
        ).first()
    return str(row[0]) if row else None


class PageChatBody(BaseModel):
    message: str
    session_id: str | None = None
    page_type: str = "general"
    active_agent: str | None = None
    context_mode: str | None = None


class PageChatResponse(BaseModel):
    reply: str
    session_id: str
    model_used: str
    agent: str


class PageChatSessionResponse(BaseModel):
    session_id: str | None
    messages: list


@router.get("/projects/{project_id}/chat/session", response_model=PageChatSessionResponse)
def get_page_chat_session(
    project_id: str,
    page_type: str = "general",
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    row = db.execute(
        text("""
            SELECT id FROM page_chat_sessions
            WHERE project_id = :pid AND page_type = :pt AND user_id = :uid
            LIMIT 1
        """),
        {"pid": project_id, "pt": page_type, "uid": user_id},
    ).first()
    if not row:
        return PageChatSessionResponse(session_id=None, messages=[])
    session_id = str(row[0])
    msgs = db.execute(
        text("""
            SELECT role, content, model_used, created_at
            FROM page_chat_messages
            WHERE session_id = :sid ORDER BY created_at ASC
        """),
        {"sid": session_id},
    ).fetchall()
    return PageChatSessionResponse(
        session_id=session_id,
        messages=[
            {
                "role": m[0],
                "content": m[1],
                "model_used": m[2],
                "created_at": m[3].isoformat() if m[3] else None,
            }
            for m in msgs
        ],
    )


@router.post("/projects/{project_id}/chat", response_model=PageChatResponse)
def project_page_chat(
    project_id: str,
    body: PageChatBody,
    background_tasks: BackgroundTasks,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    from scripts.context_assembler import assemble_chat_context, ChatContext
    from scripts.prompts.system_prompt_builder import build_system_prompt
    from scripts.routing import select_model, log_routing_decision

    user_id = session.get_user_id()
    profile = ensure_user_can_generate(db, user_id)
    user_model = (profile.model_fiab_text or settings.film_in_a_box_model).strip()
    if not user_model:
        raise HTTPException(status_code=400, detail="No model configured for this account")

    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    page_type = body.page_type or "general"
    context_mode = body.context_mode or page_type

    session_id = body.session_id or _get_or_create_session(db, project_id, page_type, user_id)

    # Assemble context from current script if available
    script_id = _get_current_script_for_project(project_id, db)
    if script_id:
        ctx = assemble_chat_context(script_id, message, db)
    else:
        from dataclasses import field
        ctx = ChatContext(
            script_id="",
            title="",
            page_count=0,
            scene_index=[],
            analysis_summary={},
            production_decisions=[],
        )

    history = _get_message_history(session_id, db)
    model, routing_reason = select_model(message, ctx, user_model)
    log_routing_decision(message, model, routing_reason)

    agent = "coproducer"
    if body.active_agent and body.active_agent.lower() in _VALID_AGENTS:
        agent = body.active_agent.lower()

    system_prompt = build_system_prompt(
        context_mode=context_mode,
        context=ctx,
        db=db,
        user_id=user_id,
        agent=agent,
    )

    gateway_messages = [{"role": "system", "content": system_prompt}]
    for h in history:
        gateway_messages.append({"role": h["role"], "content": h["content"]})
    gateway_messages.append({"role": "user", "content": message})

    try:
        gw_response = _gateway_client().execute_text(model=model, messages=gateway_messages)
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=f"AI gateway error: {exc}")

    # Extract reply text — gateway wraps OpenRouter result in a "result" envelope
    reply_text = ""
    if isinstance(gw_response, dict):
        result_block = gw_response.get("result") or gw_response
        choices = result_block.get("choices") if isinstance(result_block, dict) else []
        if isinstance(choices, list) and choices:
            reply_text = choices[0].get("message", {}).get("content", "")
        if not reply_text:
            for key in ("text", "output", "content"):
                reply_text = result_block.get(key, "") if isinstance(result_block, dict) else ""
                if reply_text:
                    break
    if not reply_text:
        raise HTTPException(status_code=502, detail="Gateway returned an empty response")

    db.execute(
        text("""
            INSERT INTO page_chat_messages (session_id, role, content, model_used)
            VALUES (:sid, 'user', :content, NULL)
        """),
        {"sid": session_id, "content": message},
    )
    db.execute(
        text("""
            INSERT INTO page_chat_messages (session_id, role, content, model_used)
            VALUES (:sid, 'assistant', :content, :model)
        """),
        {"sid": session_id, "content": reply_text, "model": model},
    )
    db.execute(
        text("UPDATE page_chat_sessions SET updated_at = NOW() WHERE id = :sid"),
        {"sid": session_id},
    )
    db.commit()

    # Deduct credits in background
    background_tasks.add_task(
        apply_credit_cost, db, user_id,
        _estimate_credit_cost(gw_response),
    )

    return PageChatResponse(
        reply=reply_text,
        session_id=session_id,
        model_used=model,
        agent=agent,
    )


def _estimate_credit_cost(gw_response: dict) -> int:
    """Reuse the gateway's reported cost if present, otherwise 1 credit per call."""
    try:
        from credits import extract_credit_cost
        return extract_credit_cost(gw_response)
    except Exception:
        return 1
