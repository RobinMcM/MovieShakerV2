import json
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.session.framework.fastapi import verify_session

from db import get_session
from gateway_client import GatewayClient, GatewayClientError
from config import load_settings
from models import FilmInABoxItem, Project, ProjectMember, UserProfile


router = APIRouter(prefix="/api/film-in-a-box", tags=["film-in-a-box"])
settings = load_settings()
PRODUCER_TIER_LIMITS = {"standard": 5, "indie": 25, "production_company": 999}
FILM_IN_A_BOX_MODEL = "google/gemma-3-12b-it:free"


class GenerateBody(BaseModel):
    title: str
    prompt: str
    type: str  # FILM | DOC
    previousContent: Optional[Any] = None
    model: Optional[str] = None


class SaveBody(BaseModel):
    projectId: str
    title: str
    type: str  # FILM | DOC
    content: Any
    prompt: Optional[str] = None


class CreateProjectBody(BaseModel):
    title: str
    type: str  # FILM | DOC
    content: Any
    prompt: Optional[str] = None


def _ensure_project_member(db: Session, project_id: str, user_id: str) -> None:
    try:
        project_uuid = uuid.UUID(project_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid project id")
    member = db.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_uuid,
            ProjectMember.user_id == user_id,
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this project")


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

    # Common gateway format: {"result": {"choices":[{"message":{"content":"..."}}]}}
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

    data = response.get("data")
    if isinstance(data, dict):
        for key in ("text", "result", "output", "content", "message"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    choices = response.get("choices")
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

    return ""


def _extract_json_block(raw: str) -> Optional[dict]:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        snippet = raw[start : end + 1]
        try:
            parsed = json.loads(snippet)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


def _film_prompt(title: str, prompt: str, previous: Optional[Any]) -> str:
    if previous:
        return (
            f"Continue refining this short film screenplay for '{title}'.\n"
            "Respect existing tone, character voices, and structure. Improve pacing and visual storytelling.\n"
            "Return screenplay text only.\n\n"
            f"Existing Draft:\n{previous}\n\n"
            f"New Direction:\n{prompt}"
        )
    return (
        f"Write a short film screenplay draft titled '{title}'.\n"
        "Use professional screenplay style with scene headings, action, and dialogue.\n"
        "Keep it concise but complete, emotionally coherent, and production-aware.\n"
        "Return screenplay text only.\n\n"
        f"Idea / Synopsis:\n{prompt}"
    )


def _doc_prompt(title: str, prompt: str, previous: Optional[Any]) -> str:
    base = (
        "Generate a documentary development package as strict JSON.\n"
        "Return ONLY valid JSON with this exact top-level shape:\n"
        "{\n"
        '  "logline": string,\n'
        '  "thematicStatement": string,\n'
        '  "chapters": [{"chapterNumber": number, "title": string, "summary": string, "visuals": string}],\n'
        '  "interviewCandidates": [{"role": string, "description": string}],\n'
        '  "visualStyle": string,\n'
        '  "bRollWishlist": [string],\n'
        '  "script": string or array of {"VIDEO": string, "AUDIO": string}\n'
        "}\n"
    )
    if previous:
        return (
            f"{base}\n"
            f"Title: {title}\n"
            "Refine and continue from previous JSON while preserving structure.\n"
            f"Previous JSON/content:\n{previous}\n\n"
            f"New direction:\n{prompt}\n"
        )
    return f"{base}\nTitle: {title}\nBrief:\n{prompt}\n"


def _normalize_doc_result(candidate: Any) -> dict:
    if not isinstance(candidate, dict):
        return {
            "logline": "",
            "thematicStatement": "",
            "chapters": [],
            "interviewCandidates": [],
            "visualStyle": "",
            "bRollWishlist": [],
            "script": str(candidate or ""),
        }
    return {
        "logline": candidate.get("logline", ""),
        "thematicStatement": candidate.get("thematicStatement", ""),
        "chapters": candidate.get("chapters", []) if isinstance(candidate.get("chapters"), list) else [],
        "interviewCandidates": candidate.get("interviewCandidates", [])
        if isinstance(candidate.get("interviewCandidates"), list)
        else [],
        "visualStyle": candidate.get("visualStyle", ""),
        "bRollWishlist": candidate.get("bRollWishlist", [])
        if isinstance(candidate.get("bRollWishlist"), list)
        else [],
        "script": candidate.get("script", ""),
    }


def _build_gateway_messages(prompt: str, want_json: bool) -> list[dict[str, str]]:
    system = (
        "You are a professional film development assistant."
        " Keep responses practical and production-oriented."
    )
    if want_json:
        system += " Return strict JSON only with no markdown."
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]


@router.post("/generate")
def generate(
    body: GenerateBody,
    session: SessionContainer = Depends(verify_session()),
):
    _ = session.get_user_id()
    content_type = (body.type or "").strip().upper()
    if content_type not in {"FILM", "DOC"}:
        raise HTTPException(status_code=400, detail="type must be FILM or DOC")
    if not body.title.strip() or not body.prompt.strip():
        raise HTTPException(status_code=400, detail="Title and prompt are required")
    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")

    try:
        selected_model = (body.model or FILM_IN_A_BOX_MODEL).strip()
        if not selected_model:
            raise HTTPException(status_code=400, detail="Model is required")

        if content_type == "FILM":
            prompt = _film_prompt(body.title.strip(), body.prompt.strip(), body.previousContent)
            gateway_response = _gateway_client().execute_text(
                model=selected_model,
                messages=_build_gateway_messages(prompt, want_json=False),
            )
            text = _extract_text_from_gateway(gateway_response)
            if not text:
                raise HTTPException(status_code=502, detail="Gateway returned empty film content")
            return {"result": text}

        prompt = _doc_prompt(body.title.strip(), body.prompt.strip(), body.previousContent)
        gateway_response = _gateway_client().execute_text(
            model=selected_model,
            messages=_build_gateway_messages(prompt, want_json=True),
        )
        raw_text = _extract_text_from_gateway(gateway_response)
        json_candidate = _extract_json_block(raw_text)
        if json_candidate is None and isinstance(gateway_response, dict):
            json_candidate = gateway_response.get("result") if isinstance(gateway_response.get("result"), dict) else None
            if json_candidate is None:
                json_candidate = gateway_response.get("data") if isinstance(gateway_response.get("data"), dict) else None
        normalized = _normalize_doc_result(json_candidate if json_candidate is not None else raw_text)
        return {"result": normalized}
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/save")
def save_generation(
    body: SaveBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_project_member(db, body.projectId, user_id)
    row = FilmInABoxItem(
        user_id=user_id,
        project_id=uuid.UUID(body.projectId),
        name=body.title.strip() or "Untitled",
        content_type=(body.type or "FILM").strip().upper(),
        content_json=json.dumps(body.content),
        prompt=(body.prompt or "").strip() or None,
    )
    db.add(row)
    db.commit()
    return {"success": True}


@router.post("/create-project")
def create_project_from_generation(
    body: CreateProjectBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = db.get(UserProfile, user_id)
    if not profile:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    if profile.blocked:
        raise HTTPException(status_code=403, detail="Account is blocked")
    if profile.role != "admin":
        limit = PRODUCER_TIER_LIMITS.get(profile.producer_tier, 5)
        count = db.exec(select(Project).where(Project.owner_id == user_id)).all()
        if len(count) >= limit:
            raise HTTPException(
                status_code=403,
                detail=f"Project limit reached for your plan ({limit} projects). Contact support to upgrade.",
            )

    project = Project(name=body.title.strip() or "Untitled Project", owner_id=user_id)
    db.add(project)
    db.commit()
    db.refresh(project)

    member = ProjectMember(project_id=project.id, user_id=user_id, role="owner")
    db.add(member)

    row = FilmInABoxItem(
        user_id=user_id,
        project_id=project.id,
        name=body.title.strip() or "Untitled",
        content_type=(body.type or "FILM").strip().upper(),
        content_json=json.dumps(body.content),
        prompt=(body.prompt or "").strip() or None,
    )
    db.add(row)
    db.commit()
    return {"projectId": str(project.id)}


@router.get("/list")
def list_items(
    projectId: Optional[str] = Query(default=None),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    statement = select(FilmInABoxItem).where(FilmInABoxItem.user_id == user_id)

    if projectId:
        _ensure_project_member(db, projectId, user_id)
        statement = statement.where(FilmInABoxItem.project_id == uuid.UUID(projectId))

    rows = list(db.exec(statement.order_by(FilmInABoxItem.created_at.desc())).all())
    return {
        "list": [
            {
                "id": str(r.id),
                "name": r.name,
                "type": r.content_type,
                "project_id": str(r.project_id) if r.project_id else None,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]
    }


@router.get("/content/{item_id}")
def get_item_content(
    item_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    try:
        item_uuid = uuid.UUID(item_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid item id")

    row = db.get(FilmInABoxItem, item_uuid)
    if not row:
        raise HTTPException(status_code=404, detail="Item not found")
    if row.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized for this item")
    if row.project_id:
        _ensure_project_member(db, str(row.project_id), user_id)

    try:
        content = json.loads(row.content_json) if row.content_json else {}
    except Exception:
        content = row.content_json
    return {"type": row.content_type, "content": content}
