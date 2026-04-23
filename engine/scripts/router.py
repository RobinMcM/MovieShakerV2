"""
Scripts API: list by project, create+upload (multipart), stats, stream file, delete.
Parse: POST /scripts/:id/parse to extract scenes/characters from PDF or JSON.
Storage path: STORAGE_ROOT/{user_id}/{project_id}/{script_id}/script.pdf
Valkey cache: scripts:list:{project_id}, scripts:stats:{script_id}
"""
import io
import json
import logging
import re
import uuid
from datetime import datetime
from typing import List, Optional, Tuple

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import text
from sqlmodel import Session, select, update
from pydantic import BaseModel

from config import load_settings
from credits import ensure_user_can_generate
from db import get_session
from gateway_client import GatewayClient, GatewayClientError
from models import Character, Project, ProjectMember, Scene, SceneCharacter, Script
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from cache import (
    cache_get,
    cache_set,
    cache_delete,
    scripts_list_key,
    scripts_stats_key,
    SCRIPTS_LIST_TTL,
    SCRIPTS_STATS_TTL,
)
from storage import (
    relative_file_path,
    save_script_file,
    get_script_file_path,
    get_script_file_stream,
    delete_script_dir,
    script_json_path,
    uses_spaces,
    MAX_UPLOAD_BYTES,
)
from script_parser import (
    parse_pdf, parse_json_v1, document_to_bytes,
    derive_db_data, ParseError,
)
from scripts.analysis import compute_production_metrics
from scripts.prompts.analysis import ANALYSIS_SYSTEM_PROMPT, build_analysis_user_prompt

logger = logging.getLogger(__name__)
settings = load_settings()

ANALYSIS_MODEL = "anthropic/claude-3.7-sonnet"
DECISIONS_MODEL = "google/gemma-3-12b-it:free"
SHOTLIST_MODEL = "anthropic/claude-3.7-sonnet"
_ANALYSIS_LOCK_TTL = 120

router = APIRouter(tags=["scripts"])


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


class ScriptAnalysisResponse(BaseModel):
    script_id: str
    act_structure: Optional[dict] = None
    location_map: Optional[dict] = None
    cast_summary: Optional[dict] = None
    risk_scores: Optional[dict] = None
    production_metrics: Optional[dict] = None
    raw_analysis: Optional[str] = None
    analysed_at: Optional[datetime] = None
    model_used: Optional[str] = None


class ProductionDecisionItem(BaseModel):
    decision_type: str
    summary: str
    detail: Optional[str] = None
    scene_refs: Optional[list] = None
    created_at: Optional[str] = None


class ProductionDecisionsResponse(BaseModel):
    script_id: str
    decisions: dict  # keyed by decision_type, each value is List[ProductionDecisionItem]
    total: int


class ScriptResponse(BaseModel):
    id: str
    project_id: str
    name: str
    file_url: str  # relative path for compatibility; frontend uses GET /scripts/:id/file to view
    uploaded_at: datetime
    is_current: bool
    series: Optional[str] = None
    episode: Optional[str] = None
    description: Optional[str] = None
    is_locked: bool = False
    page_count: Optional[int] = None


class ScriptListResponse(BaseModel):
    scripts: List[ScriptResponse]


class StatsResponse(BaseModel):
    stats: dict  # { "scenes": n, "characters": n }


class SceneResponse(BaseModel):
    id: str
    heading: str
    page_number: str
    length_in_eighths: Optional[int] = None
    scene_number: Optional[int] = None
    shooting_day: Optional[str] = None
    time_of_day_id: Optional[str] = None
    continuity_day: Optional[int] = None
    scene_location: Optional[str] = None
    scene_details: Optional[str] = None
    location_details: Optional[str] = None


class CharacterResponse(BaseModel):
    id: str
    name: str
    script_id: Optional[str] = None
    type: Optional[str] = None
    casting_notes: Optional[str] = None
    character_image_url: Optional[str] = None
    hide_from_view: Optional[bool] = None
    aspect_ratio: Optional[str] = None
    series_group: Optional[str] = None


class SceneCharacterResponse(BaseModel):
    id: str
    scene_id: str
    character_id: str
    status: Optional[str] = None
    notes: Optional[str] = None


class PublicActorRoleCharacter(BaseModel):
    name: str
    character_image_url: Optional[str] = None


class PublicActorRoleScene(BaseModel):
    id: str
    scene_number: Optional[str] = None
    heading: str
    description: str
    page_number: str


class PublicActorRoleScriptElement(BaseModel):
    type: str
    text: str
    character: Optional[str] = None


class PublicActorRoleResponse(BaseModel):
    character: PublicActorRoleCharacter
    project: str
    script: str
    script_json_url: Optional[str] = None
    scenes: List[PublicActorRoleScene]
    script_elements: List[PublicActorRoleScriptElement]


def _ensure_project_member(db: Session, project_id: str, user_id: str) -> None:
    member = db.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == uuid.UUID(project_id),
            ProjectMember.user_id == user_id,
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this project")


def _get_script_and_ensure_access(
    db: Session, script_id: str, user_id: str
) -> Script:
    script = db.get(Script, uuid.UUID(script_id))
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    _ensure_project_member(db, str(script.project_id), user_id)
    return script


def _script_to_response(s: Script) -> ScriptResponse:
    return ScriptResponse(
        id=str(s.id),
        project_id=str(s.project_id),
        name=s.name,
        file_url=s.file_path,
        uploaded_at=s.uploaded_at,
        is_current=s.is_current,
        series=s.series,
        episode=s.episode,
        description=s.description,
        is_locked=getattr(s, "is_locked", False),
        page_count=getattr(s, "page_count", None),
    )


def _safe_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Not found") from exc


# GET /scripts/{script_id}
@router.get("/scripts/{script_id}")
def get_script(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    data = _script_to_response(script)
    return {"success": True, "data": data.model_dump()}


# GET /public/actor-role/{project_id}/{script_id}/{character_id}
@router.get(
    "/public/actor-role/{project_id}/{script_id}/{character_id}",
    response_model=PublicActorRoleResponse,
)
def get_public_actor_role(
    project_id: str,
    script_id: str,
    character_id: str,
    db: Session = Depends(get_session),
):
    project_uuid = _safe_uuid(project_id)
    script_uuid = _safe_uuid(script_id)
    character_uuid = _safe_uuid(character_id)

    project = db.get(Project, project_uuid)
    script = db.get(Script, script_uuid)
    character = db.get(Character, character_uuid)

    # Return a generic 404 for any mismatch to avoid leaking entity existence.
    if not project or not script or not character:
        raise HTTPException(status_code=404, detail="Not found")
    if script.project_id != project.id:
        raise HTTPException(status_code=404, detail="Not found")
    if character.script_id != script.id:
        raise HTTPException(status_code=404, detail="Not found")
    if (character.type or "character").lower() != "character":
        raise HTTPException(status_code=404, detail="Not found")
    if bool(getattr(character, "hide_from_view", False)):
        raise HTTPException(status_code=404, detail="Not found")

    links_stmt = select(SceneCharacter).where(SceneCharacter.character_id == character.id)
    scene_links = list(db.exec(links_stmt).all())
    scene_ids = [link.scene_id for link in scene_links]

    scenes_stmt = (
        select(Scene)
        .where(Scene.script_id == script.id)
        .order_by(Scene.scene_number.asc(), Scene.id.asc())
    )
    if scene_ids:
        scenes_stmt = scenes_stmt.where(Scene.id.in_(scene_ids))
    scenes = list(db.exec(scenes_stmt).all())

    # Fallback: if mappings are missing, expose script scenes to keep rehearsal functional.
    if not scenes:
        fallback_stmt = (
            select(Scene)
            .where(Scene.script_id == script.id)
            .order_by(Scene.scene_number.asc(), Scene.id.asc())
        )
        scenes = list(db.exec(fallback_stmt).all())

    script_elements: List[PublicActorRoleScriptElement] = []
    parsed = _read_script_json(script)
    if parsed:
        raw_elements, _metadata = parsed
        for el in raw_elements:
            if not isinstance(el, dict):
                continue
            text = str(el.get("text") or "").strip()
            if not text:
                continue
            el_type = str(el.get("type") or "action").strip().lower()
            role_character = el.get("character")
            script_elements.append(
                PublicActorRoleScriptElement(
                    type=el_type,
                    text=text,
                    character=str(role_character).strip() if isinstance(role_character, str) else None,
                )
            )

    return PublicActorRoleResponse(
        character=PublicActorRoleCharacter(
            name=character.name,
            character_image_url=getattr(character, "character_image_url", None),
        ),
        project=project.name,
        script=script.name,
        script_json_url=None,
        scenes=[
            PublicActorRoleScene(
                id=str(scene.id),
                scene_number=str(scene.scene_number) if scene.scene_number is not None else None,
                heading=scene.heading or "Untitled Scene",
                description=getattr(scene, "scene_details", None) or "",
                page_number=scene.page_number or "",
            )
            for scene in scenes
        ],
        script_elements=script_elements,
    )


# GET /projects/{project_id}/scripts
@router.get("/projects/{project_id}/scripts", response_model=ScriptListResponse)
def list_scripts(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    cache_key = scripts_list_key(project_id)
    cached = cache_get(cache_key)
    if cached is not None:
        try:
            data = json.loads(cached)
            out_cached = []
            for item in data:
                d = dict(item)
                if isinstance(d.get("uploaded_at"), str) and d["uploaded_at"]:
                    d["uploaded_at"] = datetime.fromisoformat(
                        d["uploaded_at"].replace("Z", "+00:00")
                    )
                out_cached.append(ScriptResponse(**d))
            return ScriptListResponse(scripts=out_cached)
        except Exception:
            pass

    stmt = select(Script).where(Script.project_id == uuid.UUID(project_id)).order_by(Script.uploaded_at.desc())
    scripts = list(db.exec(stmt).all())
    out = [_script_to_response(s) for s in scripts]
    payload = [getattr(s, "model_dump", lambda: s.dict())() for s in out]
    try:
        cache_set(cache_key, json.dumps(payload, default=str), SCRIPTS_LIST_TTL)
    except Exception:
        pass
    return ScriptListResponse(scripts=out)


# POST /projects/{project_id}/scripts
@router.post("/projects/{project_id}/scripts", response_model=ScriptResponse, status_code=201)
def create_script_upload(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
    file: UploadFile = File(...),
    name: str = Form(...),
    description: Optional[str] = Form(None),
    series: Optional[str] = Form(None),
    episode: Optional[str] = Form(None),
):
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF file required")
    content_type = file.content_type or ""
    if "pdf" not in content_type.lower():
        raise HTTPException(status_code=400, detail="Content-Type must be application/pdf")

    script_id = uuid.uuid4()
    rel_path = relative_file_path(user_id, project_id, str(script_id), "script.pdf")

    try:
        contents = file.file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e!s}")
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File size must be less than 50MB")

    import io
    save_script_file(
        user_id,
        project_id,
        str(script_id),
        "script.pdf",
        io.BytesIO(contents),
        len(contents),
    )

    # If this is the first script for the project, set is_current
    existing = db.exec(select(Script).where(Script.project_id == uuid.UUID(project_id))).first()
    is_current = existing is None

    script = Script(
        id=script_id,
        project_id=uuid.UUID(project_id),
        user_id=user_id,
        name=name.strip(),
        description=description.strip() if description else None,
        series=series.strip() if series else None,
        episode=episode.strip() if episode else None,
        file_path=rel_path,
        is_current=is_current,
    )
    db.add(script)
    db.commit()
    db.refresh(script)

    cache_delete(scripts_list_key(project_id))
    return _script_to_response(script)


# GET /scripts/{script_id}/stats
@router.get("/scripts/{script_id}/stats", response_model=StatsResponse)
def get_script_stats(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)

    cache_key = scripts_stats_key(script_id)
    cached = cache_get(cache_key)
    if cached is not None:
        try:
            data = json.loads(cached)
            return StatsResponse(stats=data)
        except Exception:
            pass

    scenes = 0
    characters = 0
    total_eighths = 0

    parsed = _read_script_json(script)
    if parsed is not None:
        elements, metadata = parsed
        char_names: set[str] = set()
        for el in elements:
            if not isinstance(el, dict):
                continue
            el_type = (el.get("type") or "").strip().lower()
            if el_type == "scene_heading":
                scenes += 1
                total_eighths += el.get("eighths", 1)
                for cname in (el.get("characters") or []):
                    if cname:
                        char_names.add(cname)
            elif el_type == "character":
                from script_parser import _clean_character_name
                name = _clean_character_name(el.get("text") or "")
                if name:
                    char_names.add(name)
        characters = len(char_names)

    stats = {
        "scenes": scenes,
        "characters": characters,
        "total_eighths": total_eighths,
    }
    try:
        cache_set(cache_key, json.dumps(stats), SCRIPTS_STATS_TTL)
    except Exception:
        pass
    return StatsResponse(stats=stats)


# GET /scripts/{script_id}/file
@router.get("/scripts/{script_id}/file")
def get_script_file(
    script_id: str,
    variant: Optional[str] = None,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)

    if variant == "json":
        if uses_spaces():
            json_key = relative_file_path(script.user_id, str(script.project_id), str(script.id), "script.json")
            stream_result = get_script_file_stream(json_key)
            if stream_result is None:
                raise HTTPException(status_code=404, detail="Script JSON not found. Parse the script first.")
            body, _ = stream_result
            return Response(content=body, media_type="application/json")
        path = script_json_path(script.user_id, str(script.project_id), str(script.id))
        if not path.exists():
            raise HTTPException(status_code=404, detail="Script JSON not found. Parse the script first.")
        return FileResponse(path, media_type="application/json")
    else:
        if uses_spaces():
            stream_result = get_script_file_stream(script.file_path)
            if stream_result is None:
                raise HTTPException(status_code=404, detail="Script file not found")
            body, content_type = stream_result
            return Response(
                content=body,
                media_type=content_type,
                headers={"Content-Disposition": 'inline; filename="script.pdf"'},
            )
        path = get_script_file_path(script.file_path)
        if not path.exists():
            raise HTTPException(status_code=404, detail="Script file not found")
        return FileResponse(
            path,
            media_type="application/pdf",
            filename="script.pdf",
        )


# GET /scripts/{script_id}/scenes
@router.get("/scripts/{script_id}/scenes")
def get_script_scenes(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)
    stmt = (
        select(Scene)
        .where(Scene.script_id == uuid.UUID(script_id))
        .order_by(Scene.scene_number.asc(), Scene.id.asc())
    )
    scenes = list(db.exec(stmt).all())
    data = [
        SceneResponse(
            id=str(s.id),
            heading=s.heading,
            page_number=s.page_number or "",
            length_in_eighths=s.length_in_eighths,
            scene_number=s.scene_number,
            shooting_day=getattr(s, "shooting_day", None),
            time_of_day_id=getattr(s, "time_of_day_id", None),
            continuity_day=getattr(s, "continuity_day", None),
            scene_location=getattr(s, "scene_location", None),
            scene_details=getattr(s, "scene_details", None),
            location_details=getattr(s, "location_details", None),
        )
        for s in scenes
    ]
    return {"success": True, "data": data}


# GET /scripts/{script_id}/characters
@router.get("/scripts/{script_id}/characters")
def get_script_characters(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)
    stmt = (
        select(Character)
        .where(Character.script_id == uuid.UUID(script_id))
        .order_by(Character.name.asc())
    )
    characters = list(db.exec(stmt).all())
    data = [
        CharacterResponse(
            id=str(c.id),
            name=c.name,
            script_id=str(c.script_id),
            type=getattr(c, "type", None) or "character",
            casting_notes=getattr(c, "casting_notes", None),
            character_image_url=getattr(c, "character_image_url", None),
            hide_from_view=getattr(c, "hide_from_view", False),
            aspect_ratio=getattr(c, "aspect_ratio", None),
            series_group=getattr(c, "series_group", None),
        )
        for c in characters
    ]
    return {"success": True, "data": data}


class CreateCharacterBody(BaseModel):
    name: str
    type: Optional[str] = "character"  # "character" | "object" | "scene"
    casting_notes: Optional[str] = None
    aspect_ratio: Optional[str] = None
    series_group: Optional[str] = None


# POST /scripts/{script_id}/characters
@router.post("/scripts/{script_id}/characters", status_code=201)
def create_script_character(
    script_id: str,
    body: CreateCharacterBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    char_type = (body.type or "character").lower()
    if char_type not in ("character", "object", "scene"):
        char_type = "character"
    character = Character(
        script_id=uuid.UUID(script_id),
        user_id=user_id,
        name=body.name.strip(),
        type=char_type,
        casting_notes=body.casting_notes.strip() if body.casting_notes else None,
        aspect_ratio=body.aspect_ratio or None,
        series_group=body.series_group or None,
    )
    db.add(character)
    db.commit()
    db.refresh(character)
    return {
        "success": True,
        "data": CharacterResponse(
            id=str(character.id),
            name=character.name,
            script_id=str(character.script_id),
            type=character.type,
            casting_notes=character.casting_notes,
            character_image_url=character.character_image_url,
            hide_from_view=character.hide_from_view,
            aspect_ratio=character.aspect_ratio,
            series_group=character.series_group,
        ),
    }


# GET /scripts/{script_id}/scene-characters
@router.get("/scripts/{script_id}/scene-characters")
def get_script_scene_characters(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)
    # Join scene_character -> scene to filter by script_id
    stmt = (
        select(SceneCharacter)
        .join(Scene, SceneCharacter.scene_id == Scene.id)
        .where(Scene.script_id == uuid.UUID(script_id))
    )
    rows = list(db.exec(stmt).all())
    data = [
        SceneCharacterResponse(
            id=str(r.id),
            scene_id=str(r.scene_id),
            character_id=str(r.character_id),
            status=getattr(r, "status", None),
            notes=getattr(r, "notes", None),
        )
        for r in rows
    ]
    return {"success": True, "data": data}


# PUT /scenes/{scene_id}
class SceneUpdateBody(BaseModel):
    shooting_day: Optional[str] = None
    time_of_day_id: Optional[str] = None
    continuity_day: Optional[int] = None
    scene_location: Optional[str] = None
    scene_details: Optional[str] = None
    location_details: Optional[str] = None


@router.put("/scenes/{scene_id}")
def update_scene(
    scene_id: str,
    body: SceneUpdateBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    scene = db.get(Scene, uuid.UUID(scene_id))
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    _get_script_and_ensure_access(db, str(scene.script_id), user_id)
    updates = body.model_dump(exclude_unset=True)
    for k, v in updates.items():
        if hasattr(scene, k):
            setattr(scene, k, v)
    db.add(scene)
    db.commit()
    db.refresh(scene)
    return {
        "success": True,
        "data": SceneResponse(
            id=str(scene.id),
            heading=scene.heading,
            page_number=scene.page_number or "",
            length_in_eighths=scene.length_in_eighths,
            scene_number=scene.scene_number,
            shooting_day=getattr(scene, "shooting_day", None),
            time_of_day_id=getattr(scene, "time_of_day_id", None),
            continuity_day=getattr(scene, "continuity_day", None),
            scene_location=getattr(scene, "scene_location", None),
            scene_details=getattr(scene, "scene_details", None),
            location_details=getattr(scene, "location_details", None),
        ),
    }


# PUT /scenes/bulk-update
class BulkSceneUpdateBody(BaseModel):
    scene_ids: list[str]
    updates: dict  # e.g. {"scene_location": "Studio"}


@router.put("/scenes/bulk-update")
def bulk_update_scenes(
    body: BulkSceneUpdateBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    allowed = {"shooting_day", "time_of_day_id", "continuity_day", "scene_location", "scene_details", "location_details"}
    updates = {k: v for k, v in body.updates.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No allowed fields to update")
    for scene_id in body.scene_ids:
        scene = db.get(Scene, uuid.UUID(scene_id))
        if not scene:
            continue
        try:
            _get_script_and_ensure_access(db, str(scene.script_id), user_id)
        except HTTPException:
            continue
        for k, v in updates.items():
            if hasattr(scene, k):
                setattr(scene, k, v)
        db.add(scene)
    db.commit()
    return {"success": True, "message": "Scenes updated"}


# PUT /scripts/scene-characters/{scene_character_id}
class SceneCharacterUpdateBody(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None


@router.put("/scripts/scene-characters/{scene_character_id}")
def update_scene_character(
    scene_character_id: str,
    body: SceneCharacterUpdateBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    sc = db.get(SceneCharacter, uuid.UUID(scene_character_id))
    if not sc:
        raise HTTPException(status_code=404, detail="Scene character not found")
    scene = db.get(Scene, sc.scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    _get_script_and_ensure_access(db, str(scene.script_id), user_id)
    updates = body.model_dump(exclude_unset=True)
    for k, v in updates.items():
        if hasattr(sc, k):
            setattr(sc, k, v)
    db.add(sc)
    db.commit()
    db.refresh(sc)
    return {
        "success": True,
        "data": SceneCharacterResponse(
            id=str(sc.id),
            scene_id=str(sc.scene_id),
            character_id=str(sc.character_id),
            status=getattr(sc, "status", None),
            notes=getattr(sc, "notes", None),
        ),
    }


# POST /scripts/{script_id}/set-current
@router.post("/scripts/{script_id}/set-current")
def set_script_current(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    project_id = str(script.project_id)
    db.exec(update(Script).where(Script.project_id == script.project_id).values(is_current=False))
    script.is_current = True
    db.add(script)
    db.commit()
    db.refresh(script)
    cache_delete(scripts_list_key(project_id))
    return {"success": True, "message": "Script set as current"}


# POST /scripts/{script_id}/set-lock
class SetLockBody(BaseModel):
    is_locked: bool


@router.post("/scripts/{script_id}/set-lock")
def set_script_lock(
    script_id: str,
    body: SetLockBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    script.is_locked = body.is_locked
    db.add(script)
    db.commit()
    db.refresh(script)
    data = _script_to_response(script)
    return {"success": True, "data": data.model_dump()}


def _get_script_file_bytes(script: Script) -> Tuple[bytes, bool]:
    """Return (body, is_pdf). Raises HTTPException if file not found."""
    if uses_spaces():
        result = get_script_file_stream(script.file_path)
        if result is None:
            raise HTTPException(status_code=404, detail="Script file not found")
        body, _ = result
        return (body, body[:5].strip().startswith(b"%PDF-"))
    path = get_script_file_path(script.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Script file not found")
    body = path.read_bytes()
    return (body, body[:5].strip().startswith(b"%PDF-"))


# Canonical script.json types (source of truth)
SCRIPT_JSON_TYPES = frozenset(
    {"scene_heading", "scene_number", "action", "character", "dialogue", "parenthetical", "transition", "page_number", "general"}
)


def _read_script_json(script: Script) -> Optional[Tuple[List[dict], dict]]:
    """Read current script.json from storage. Returns (elements, metadata) or None if not found."""
    json_key = relative_file_path(script.user_id, str(script.project_id), str(script.id), "script.json")
    if uses_spaces():
        result = get_script_file_stream(json_key)
        if result is None:
            return None
        body, _ = result
    else:
        path = script_json_path(script.user_id, str(script.project_id), str(script.id))
        if not path.exists():
            return None
        body = path.read_bytes()
    data = json.loads(body.decode("utf-8", errors="replace"))
    elements = data.get("elements")
    metadata = data.get("metadata") or {}
    if not isinstance(elements, list):
        return None
    return (elements, metadata)


# PUT /scripts/{script_id}/json - update script.json (source of truth) from client e.g. ScriptViewer save
class ScriptJsonBody(BaseModel):
    elements: List[dict]  # [ {"type": str, "text": str}, ... ]
    metadata: Optional[dict] = None  # e.g. page_count, title, author


@router.put("/scripts/{script_id}/json")
def update_script_json(
    script_id: str,
    body: ScriptJsonBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Full replace of script.json. Normalises to schema v2. Does not re-populate DB."""
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    if not body.elements:
        raise HTTPException(
            status_code=400, detail="elements array is required and must not be empty"
        )
    metadata = body.metadata or {}
    metadata.setdefault("page_count", 1)

    payload_bytes = json.dumps(
        {"schema_version": "1.0", "metadata": metadata, "elements": body.elements}
    ).encode()
    doc = parse_json_v1(payload_bytes)
    if doc is None:
        raise HTTPException(status_code=400, detail="Invalid elements")

    json_bytes = document_to_bytes(doc)
    save_script_file(
        script.user_id,
        str(script.project_id),
        str(script.id),
        "script.json",
        io.BytesIO(json_bytes),
        len(json_bytes),
    )
    return {"success": True, "message": "Script JSON updated"}


# POST /scripts/{script_id}/json/elements - append elements to script.json (e.g. during production)
class AppendElementsBody(BaseModel):
    elements: List[dict]  # [ {"type": str, "text": str}, ... ] - will be appended to existing


@router.post("/scripts/{script_id}/json/elements")
def append_script_json_elements(
    script_id: str,
    body: AppendElementsBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Append elements to script.json. Use during production to add extra elements. Fails if script.json does not exist (parse first)."""
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    current = _read_script_json(script)
    if current is None:
        raise HTTPException(
            status_code=404,
            detail="Script JSON not found. Parse the script first to create script.json.",
        )
    existing_elements, metadata = current
    if not body.elements:
        return {"success": True, "message": "No elements to append", "elements_count": len(existing_elements)}
    new_els = [{"type": (e.get("type") or "action").strip().lower(), "text": (e.get("text") or "").strip()} for e in body.elements]
    combined = existing_elements + new_els
    json_bytes = _script_json_to_bytes(combined, metadata)
    save_script_file(
        script.user_id,
        str(script.project_id),
        str(script.id),
        "script.json",
        io.BytesIO(json_bytes),
        len(json_bytes),
    )
    return {"success": True, "message": "Elements appended", "elements_count": len(combined)}


# POST /scripts/{script_id}/parse
@router.post("/scripts/{script_id}/parse")
def parse_script(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    if getattr(script, "is_locked", False):
        raise HTTPException(status_code=403, detail="Script is locked. Unlock it to re-parse.")

    body, is_pdf = _get_script_file_bytes(script)

    doc: Optional[dict] = None

    if is_pdf:
        try:
            doc = parse_pdf(body, script_name=script.name or "")
        except ParseError as exc:
            raise HTTPException(status_code=422, detail=f"Failed to parse PDF: {exc}")
        except Exception:
            raise HTTPException(
                status_code=422,
                detail="Failed to parse PDF. Ensure the file is a valid screenplay PDF.",
            )
    elif body[:1].strip() in (b"{", b"["):
        doc = parse_json_v1(body)
        if doc is None:
            raise HTTPException(
                status_code=400,
                detail="Invalid script JSON. Expected elements[] array.",
            )
    else:
        raise HTTPException(
            status_code=400,
            detail="File format not recognised. Upload a PDF or valid script JSON.",
        )

    elements = doc["elements"]
    metadata = doc["metadata"]
    page_count = metadata.get("page_count", 1)

    headings, unique_characters, scene_char_map, page_count = derive_db_data(
        elements, page_count
    )

    script_uuid = script.id

    from models import SceneCost
    existing_scenes = list(db.exec(select(Scene).where(Scene.script_id == script_uuid)).all())
    for scene in existing_scenes:
        for sc in db.exec(select(SceneCharacter).where(SceneCharacter.scene_id == scene.id)).all():
            db.delete(sc)
        for cost in db.exec(select(SceneCost).where(SceneCost.scene_id == scene.id)).all():
            db.delete(cost)
    db.flush()
    for s in existing_scenes:
        db.delete(s)
    for c in db.exec(select(Character).where(Character.script_id == script_uuid)).all():
        db.delete(c)
    db.commit()

    char_id_by_name = {}
    for name in unique_characters:
        ch = Character(script_id=script_uuid, user_id=user_id, name=name)
        db.add(ch)
        db.flush()
        char_id_by_name[name] = ch.id

    for i, h in enumerate(headings):
        sc = Scene(
            script_id=script_uuid,
            user_id=user_id,
            heading=h["heading"],
            page_number=h.get("page_number", ""),
            length_in_eighths=h.get("length_in_eighths", 1),
            scene_number=h.get("scene_number", i + 1),
            scene_location=h.get("scene_location") or None,
            location_type=h.get("location_type") or None,
            location_details=h.get("location_details") or None,
        )
        db.add(sc)
        db.flush()
        raw_conn = db.connection().connection
        with raw_conn.cursor() as cur:
            cur.execute(
                "UPDATE scenes SET characters = %s::jsonb WHERE id = %s",
                (h.get("characters_json", "[]"), str(sc.id)),
            )
        for cname in scene_char_map.get(i, set()):
            cid = char_id_by_name.get(cname)
            if cid:
                db.add(SceneCharacter(scene_id=sc.id, character_id=cid, user_id=user_id))

    script.page_count = page_count
    db.add(script)
    db.commit()

    cache_delete(scripts_stats_key(script_id))

    json_bytes = document_to_bytes(doc)
    save_script_file(
        script.user_id,
        str(script.project_id),
        str(script.id),
        "script.json",
        io.BytesIO(json_bytes),
        len(json_bytes),
    )

    script.file_path = f"{script.user_id}/{script.project_id}/{script.id}/script.json"
    db.add(script)
    db.commit()

    return {
        "success": True,
        "data": {
            "scenes": len(headings),
            "characters": len(unique_characters),
            "total_eighths": metadata.get("total_eighths", 0),
            "page_count": page_count,
            "schema_version": doc.get("schema_version"),
        },
    }


# ── ingest-json models and helpers ───────────────────────────────────────────

class IngestJsonBody(BaseModel):
    schema_version: str
    elements: List[dict]
    metadata: Optional[dict] = None


class IngestJsonResponse(BaseModel):
    script_id: str
    chat_id: str
    scenes_upserted: int


class SceneIndexItem(BaseModel):
    id: str
    scene_number: Optional[int] = None
    heading: str
    page_number: str
    length_in_eighths: Optional[int] = None
    location_type: Optional[str] = None
    scene_location: Optional[str] = None
    location_details: Optional[str] = None
    is_night_shoot: Optional[bool] = None
    has_stunts: Optional[bool] = None
    has_vfx: Optional[bool] = None
    characters: Optional[list] = None
    shooting_day: Optional[str] = None
    time_of_day_id: Optional[str] = None


class SceneIndexResponse(BaseModel):
    scenes: List[SceneIndexItem]


class SceneElementsResponse(BaseModel):
    scene_number: int
    elements: List[dict]


def _get_or_create_chat(db: Session, script_id: uuid.UUID, user_id: str) -> str:
    """Return chat_id for script, creating a script_chats row if none exists."""
    result = db.execute(
        text("SELECT id FROM script_chats WHERE script_id = :script_id LIMIT 1"),
        {"script_id": str(script_id)},
    ).first()
    if result:
        return str(result[0])
    row = db.execute(
        text(
            "INSERT INTO script_chats (id, script_id, user_id) "
            "VALUES (gen_random_uuid(), :script_id, :user_id) "
            "RETURNING id"
        ),
        {"script_id": str(script_id), "user_id": user_id},
    ).first()
    db.commit()
    return str(row[0])


def _set_scene_characters(db: Session, scene_id: uuid.UUID, characters: list) -> None:
    """Write characters list into the JSONB column (not tracked by SQLModel)."""
    db.execute(
        text("UPDATE scenes SET characters = :chars WHERE id = :id"),
        {"chars": json.dumps(characters), "id": str(scene_id)},
    )


def _run_analysis(script_id: str, db: Session) -> Optional[dict]:
    """Run the full script analysis pass. Returns None if a run is already in progress."""
    lock_key = f"analysis_running:{script_id}"
    if cache_get(lock_key):
        return None
    cache_set(lock_key, "1", ttl_seconds=_ANALYSIS_LOCK_TTL)
    try:
        context = compute_production_metrics(script_id, db)
        user_prompt = build_analysis_user_prompt(context)
        messages = [
            {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]
        gateway_response = _gateway_client().execute_text(
            model=ANALYSIS_MODEL,
            messages=messages,
        )
        raw_text = _extract_text_from_gateway(gateway_response)
        parsed = _extract_json_block(raw_text)
        if parsed is None:
            logger.warning("Script analysis for %s returned unparseable JSON: %s", script_id, raw_text[:200])
            return None

        db.execute(
            text("""
                INSERT INTO script_analysis (
                    id, script_id, act_structure, location_map, cast_summary,
                    risk_scores, production_metrics, raw_analysis,
                    analysed_at, model_used
                )
                VALUES (
                    gen_random_uuid(), :script_id,
                    cast(:act_structure as jsonb), cast(:location_map as jsonb),
                    cast(:cast_summary as jsonb), cast(:risk_scores as jsonb),
                    cast(:production_metrics as jsonb), :raw_analysis,
                    NOW(), :model_used
                )
                ON CONFLICT (script_id) DO UPDATE SET
                    act_structure = EXCLUDED.act_structure,
                    location_map = EXCLUDED.location_map,
                    cast_summary = EXCLUDED.cast_summary,
                    risk_scores = EXCLUDED.risk_scores,
                    production_metrics = EXCLUDED.production_metrics,
                    raw_analysis = EXCLUDED.raw_analysis,
                    analysed_at = NOW(),
                    model_used = EXCLUDED.model_used
            """),
            {
                "script_id": script_id,
                "act_structure": json.dumps(parsed.get("act_structure")),
                "location_map": json.dumps(parsed.get("location_map")),
                "cast_summary": json.dumps(parsed.get("cast_summary")),
                "risk_scores": json.dumps(parsed.get("risk_scores")),
                "production_metrics": json.dumps(parsed.get("production_metrics")),
                "raw_analysis": raw_text,
                "model_used": ANALYSIS_MODEL,
            },
        )
        db.commit()

        row = db.execute(
            text("SELECT * FROM script_analysis WHERE script_id = :script_id"),
            {"script_id": script_id},
        ).first()
        return dict(row._mapping) if row else None
    except GatewayClientError as exc:
        logger.warning("Script analysis gateway error for %s: %s", script_id, exc)
        return None
    except Exception as exc:
        logger.exception("Script analysis unexpected error for %s: %s", script_id, exc)
        return None
    finally:
        cache_delete(lock_key)


# POST /scripts/{script_id}/ingest-json
@router.post("/scripts/{script_id}/ingest-json", response_model=IngestJsonResponse)
def ingest_script_json(
    script_id: str,
    body: IngestJsonBody,
    background_tasks: BackgroundTasks,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()

    if body.schema_version != "2.0":
        raise HTTPException(status_code=400, detail="schema_version must be '2.0'")

    script = _get_script_and_ensure_access(db, script_id, user_id)
    script_uuid = script.id
    db.expunge_all()
    scenes_upserted = 0

    for el in body.elements:
        if el.get("type") != "scene_heading":
            continue
        scene_number = el.get("scene_number")
        if scene_number is None:
            continue

        time_of_day = (el.get("time_of_day") or "").strip().lower() or None
        raw_characters = el.get("characters")
        if isinstance(raw_characters, list):
            characters = [
                {
                    "name": c.get("name", c) if isinstance(c, dict) else str(c),
                    "character_type": c.get("character_type", "supporting") if isinstance(c, dict) else "supporting",
                    "scene_function": c.get("scene_function", "") if isinstance(c, dict) else "",
                }
                for c in raw_characters
            ]
        else:
            characters = None

        db.execute(
            text("""
                INSERT INTO scenes (
                    id, script_id, user_id, scene_number, heading, page_number,
                    length_in_eighths, location_type, scene_location,
                    location_details, is_night_shoot, characters, time_of_day_id
                )
                VALUES (
                    gen_random_uuid(), :script_id, :user_id, :scene_number,
                    :heading, :page_number, :length_in_eighths, :location_type,
                    :scene_location, :location_details, :is_night_shoot,
                    cast(:characters as jsonb), :time_of_day_id
                )
                ON CONFLICT (script_id, scene_number)
                DO UPDATE SET
                    heading = EXCLUDED.heading,
                    page_number = EXCLUDED.page_number,
                    length_in_eighths = EXCLUDED.length_in_eighths,
                    location_type = EXCLUDED.location_type,
                    scene_location = EXCLUDED.scene_location,
                    location_details = EXCLUDED.location_details,
                    is_night_shoot = EXCLUDED.is_night_shoot,
                    characters = EXCLUDED.characters,
                    time_of_day_id = EXCLUDED.time_of_day_id
            """),
            {
                "script_id": str(script_uuid),
                "user_id": user_id,
                "scene_number": scene_number,
                "heading": el.get("text") or "",
                "page_number": str(el.get("page") or ""),
                "length_in_eighths": el.get("eighths"),
                "location_type": el.get("int_ext"),
                "scene_location": el.get("location"),
                "location_details": el.get("sub_location"),
                "is_night_shoot": (time_of_day == "night") if time_of_day else None,
                "characters": json.dumps(characters),
                "time_of_day_id": time_of_day,
            },
        )
        scenes_upserted += 1

    db.commit()
    chat_id = _get_or_create_chat(db, script_uuid, user_id)
    background_tasks.add_task(_run_analysis, str(script_uuid), db)

    return IngestJsonResponse(
        script_id=str(script_uuid),
        chat_id=chat_id,
        scenes_upserted=scenes_upserted,
    )


# POST /scripts/{script_id}/analyse
@router.post("/scripts/{script_id}/analyse", response_model=ScriptAnalysisResponse)
def analyse_script(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)
    db.expunge_all()

    lock_key = f"analysis_running:{script_id}"
    if cache_get(lock_key):
        return JSONResponse(status_code=202, content={"status": "already_running"})

    result = _run_analysis(script_id, db)
    if result is None:
        return JSONResponse(status_code=202, content={"status": "already_running"})

    return ScriptAnalysisResponse(
        script_id=str(result.get("script_id") or script_id),
        act_structure=result.get("act_structure"),
        location_map=result.get("location_map"),
        cast_summary=result.get("cast_summary"),
        risk_scores=result.get("risk_scores"),
        production_metrics=result.get("production_metrics"),
        raw_analysis=result.get("raw_analysis"),
        analysed_at=result.get("analysed_at"),
        model_used=result.get("model_used"),
    )


# GET /scripts/{script_id}/analysis
@router.get("/scripts/{script_id}/analysis", response_model=ScriptAnalysisResponse)
def get_script_analysis(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)
    db.expunge_all()

    row = db.execute(
        text("SELECT * FROM script_analysis WHERE script_id = :script_id"),
        {"script_id": script_id},
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="No analysis found. Run POST /analyse first.")

    r = dict(row._mapping)
    return ScriptAnalysisResponse(
        script_id=str(r.get("script_id") or script_id),
        act_structure=r.get("act_structure"),
        location_map=r.get("location_map"),
        cast_summary=r.get("cast_summary"),
        risk_scores=r.get("risk_scores"),
        production_metrics=r.get("production_metrics"),
        raw_analysis=r.get("raw_analysis"),
        analysed_at=r.get("analysed_at"),
        model_used=r.get("model_used"),
    )


# GET /scripts/{script_id}/scenes/index
@router.get("/scripts/{script_id}/scenes/index", response_model=SceneIndexResponse)
def get_script_scenes_index(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)
    rows = db.execute(
        text("""
            SELECT id, scene_number, heading, page_number, length_in_eighths,
                   location_type, scene_location, location_details, is_night_shoot,
                   has_stunts, has_vfx, characters, shooting_day, time_of_day_id
            FROM scenes
            WHERE script_id = :script_id
            ORDER BY scene_number ASC
        """),
        {"script_id": str(uuid.UUID(script_id))},
    ).fetchall()
    data = [
        SceneIndexItem(
            id=str(row[0]),
            scene_number=row[1],
            heading=row[2] or "",
            page_number=row[3] or "",
            length_in_eighths=row[4],
            location_type=row[5],
            scene_location=row[6],
            location_details=row[7],
            is_night_shoot=row[8],
            has_stunts=row[9],
            has_vfx=row[10],
            characters=row[11],
            shooting_day=row[12],
            time_of_day_id=row[13],
        )
        for row in rows
    ]
    return SceneIndexResponse(scenes=data)


# GET /scripts/{script_id}/scenes/{scene_number}/elements
@router.get(
    "/scripts/{script_id}/scenes/{scene_number}/elements",
    response_model=SceneElementsResponse,
)
def get_scene_elements(
    script_id: str,
    scene_number: int,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)

    parsed = _read_script_json(script)
    if parsed is None:
        raise HTTPException(
            status_code=404,
            detail="Script JSON not found. Parse the script first.",
        )

    elements, _ = parsed
    scene_elements: List[dict] = []
    in_scene = False
    for el in elements:
        if el.get("type") == "scene_heading":
            if el.get("scene_number") == scene_number:
                in_scene = True
            elif in_scene:
                break
        if in_scene:
            scene_elements.append(el)

    if not scene_elements:
        raise HTTPException(status_code=404, detail="Scene not found")

    return SceneElementsResponse(scene_number=scene_number, elements=scene_elements)


class ShotSuggestion(BaseModel):
    line_number: str      # scene-prefixed label e.g. "1A", "7B"
    color: str
    shot_type: str
    camera_direction: str
    start_element_text: str
    end_element_text: str
    rationale: str        # one sentence explaining this shot choice
    is_insert: bool       # True only for tight detail shots (props, hands, text on screen)
    overlaps: List[str]   # line_number labels of shots this overlaps; [] if none


class SuggestShotsResponse(BaseModel):
    script_id: str
    scene_number: int
    suggestions: List[ShotSuggestion]


_SUGGEST_SHOTS_UPPER_TYPES = frozenset({"scene_heading", "character", "transition"})


def _render_element_text(el: dict) -> str:
    """Return element text exactly as parseSceneContent renders it into data-line-text."""
    el_type = (el.get("type") or "").strip().lower()
    text = (el.get("text") or "").strip()
    if not text:
        return ""
    if el_type in _SUGGEST_SHOTS_UPPER_TYPES:
        return text.upper()
    return text


def _build_suggest_shots_user_prompt(scene_elements: list, scene_number: int) -> str:
    lines = [
        f"SCENE NUMBER: {scene_number}",
        f"Use line_number prefix \"{scene_number}\" — e.g. \"{scene_number}A\", \"{scene_number}B\", \"{scene_number}C\"",
        "",
        "RENDERED SCENE ELEMENTS (exact data-line-text values as shown in the shotlist UI):",
        "",
    ]
    for el in scene_elements:
        el_type = (el.get("type") or "").strip().lower()
        rendered = _render_element_text(el)
        if rendered:
            lines.append(f"[{el_type.upper()}] {rendered}")
    lines += ["", "Propose shot tramlines for this scene. Return ONLY the JSON object."]
    return "\n".join(lines)


# POST /scripts/{script_id}/scenes/{scene_number}/suggest-shots
@router.post(
    "/scripts/{script_id}/scenes/{scene_number}/suggest-shots",
    response_model=SuggestShotsResponse,
)
def suggest_shots(
    script_id: str,
    scene_number: int,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    from scripts.prompts.system_prompt_builder import SHOTLIST_SYSTEM_PROMPT

    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)

    parsed = _read_script_json(script)
    if parsed is None:
        raise HTTPException(
            status_code=404,
            detail="Script JSON not found. Parse the script first.",
        )

    elements, _ = parsed
    scene_elements: List[dict] = []
    in_scene = False
    for el in elements:
        if el.get("type") == "scene_heading":
            if el.get("scene_number") == scene_number:
                in_scene = True
            elif in_scene:
                break
        if in_scene:
            scene_elements.append(el)

    if not scene_elements:
        raise HTTPException(status_code=404, detail="Scene not found")

    user_prompt = _build_suggest_shots_user_prompt(scene_elements, scene_number)

    try:
        gw_response = _gateway_client().execute_text(
            model=SHOTLIST_MODEL,
            messages=[
                {"role": "system", "content": SHOTLIST_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=f"AI gateway error: {exc}")

    raw_text = _extract_text_from_gateway(gw_response)
    parsed_json = _extract_json_block(raw_text)
    if not isinstance(parsed_json, dict):
        raise HTTPException(
            status_code=502,
            detail="Gateway did not return a valid JSON object for shot suggestions",
        )

    raw_suggestions = parsed_json.get("suggestions")
    if not isinstance(raw_suggestions, list):
        raise HTTPException(
            status_code=502,
            detail="Gateway response missing 'suggestions' array",
        )

    suggestions: List[ShotSuggestion] = []
    for item in raw_suggestions:
        if not isinstance(item, dict):
            continue
        line_number = str(item.get("line_number") or "").strip()
        color = str(item.get("color") or "").strip()
        shot_type = str(item.get("shot_type") or "").strip()
        camera_direction = str(item.get("camera_direction") or "").strip()
        start_text = str(item.get("start_element_text") or "").strip()
        end_text = str(item.get("end_element_text") or "").strip()
        rationale = str(item.get("rationale") or "").strip()
        is_insert = item.get("is_insert")
        overlaps = item.get("overlaps")
        # Required string fields must be non-empty
        if not (line_number and color and shot_type and start_text and end_text):
            continue
        # is_insert and overlaps must be present and correctly typed;
        # False and [] are valid values so we check type, not truthiness
        if not isinstance(is_insert, bool) or not isinstance(overlaps, list):
            continue
        suggestions.append(
            ShotSuggestion(
                line_number=line_number,
                color=color,
                shot_type=shot_type,
                camera_direction=camera_direction,
                start_element_text=start_text,
                end_element_text=end_text,
                rationale=rationale,
                is_insert=is_insert,
                overlaps=[str(o) for o in overlaps if isinstance(o, str)],
            )
        )

    return SuggestShotsResponse(
        script_id=script_id,
        scene_number=scene_number,
        suggestions=suggestions,
    )


def _extract_decisions(
    script_id: str,
    chat_id: str,
    message: str,
    db: Session,
) -> list:
    """Extract production decisions from an assistant message and persist them."""
    system_prompt = (
        "You are a production decision extractor. Return ONLY valid JSON. "
        "No preamble, no markdown."
    )
    user_prompt = (
        "Read this assistant message and identify any production decisions "
        "that were made or recommended. A production decision is a concrete "
        "actionable choice about: location, schedule, cast, budget, or creative direction.\n\n"
        f"Message: {message}\n\n"
        "Return a JSON array. Each item:\n"
        '{\n'
        '  "decision_type": "location|schedule|cast|budget|creative",\n'
        '  "summary": "one sentence max",\n'
        '  "detail": "fuller explanation or empty string",\n'
        '  "scene_refs": [list of integer scene numbers affected, or []]\n'
        '}\n\n'
        "Return [] if no decisions are present. Return ONLY the JSON array."
    )

    try:
        gateway_response = _gateway_client().execute_text(
            model=DECISIONS_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
    except GatewayClientError as exc:
        logger.warning("Decision extraction gateway error for %s: %s", script_id, exc)
        return []

    raw_text = _extract_text_from_gateway(gateway_response)
    if not raw_text:
        return []

    # Strip markdown fences if present
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned.strip())

    try:
        parsed = json.loads(cleaned)
    except (ValueError, TypeError):
        start = cleaned.find("[")
        end = cleaned.rfind("]")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(cleaned[start : end + 1])
            except (ValueError, TypeError):
                logger.warning("Decision extraction unparseable response for %s: %s", script_id, cleaned[:200])
                return []
        else:
            logger.warning("Decision extraction no JSON array found for %s: %s", script_id, cleaned[:200])
            return []

    if not isinstance(parsed, list) or not parsed:
        return []

    valid_types = {"location", "schedule", "cast", "budget", "creative"}
    decisions = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        decision_type = str(item.get("decision_type") or "").strip().lower()
        if decision_type not in valid_types:
            continue
        summary = str(item.get("summary") or "").strip()
        if not summary:
            continue
        detail = str(item.get("detail") or "").strip()
        scene_refs = item.get("scene_refs")
        if not isinstance(scene_refs, list):
            scene_refs = []
        scene_refs = [int(r) for r in scene_refs if isinstance(r, (int, float))]

        db.execute(
            text("""
                INSERT INTO production_decisions
                  (id, script_id, chat_id, decision_type, summary, detail,
                   scene_refs, created_at, created_by)
                VALUES
                  (gen_random_uuid(), :script_id, :chat_id, :decision_type,
                   :summary, :detail, cast(:scene_refs as jsonb), NOW(), :created_by)
            """),
            {
                "script_id": script_id,
                "chat_id": chat_id,
                "decision_type": decision_type,
                "summary": summary,
                "detail": detail,
                "scene_refs": json.dumps(scene_refs),
                "created_by": "assistant",
            },
        )
        decisions.append({
            "decision_type": decision_type,
            "summary": summary,
            "detail": detail,
            "scene_refs": scene_refs,
        })

    if decisions:
        db.commit()

    return decisions


# GET /scripts/{script_id}/decisions
@router.get("/scripts/{script_id}/decisions", response_model=ProductionDecisionsResponse)
def get_script_decisions(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)

    rows = db.execute(
        text("""
            SELECT decision_type, summary, detail, scene_refs, created_at
            FROM production_decisions
            WHERE script_id = :script_id
            ORDER BY created_at ASC
        """),
        {"script_id": script_id},
    ).fetchall()

    grouped: dict = {t: [] for t in ("location", "schedule", "cast", "budget", "creative")}
    for row in rows:
        decision_type, summary, detail, scene_refs, created_at = row
        if decision_type not in grouped:
            grouped[decision_type] = []
        grouped[decision_type].append(
            ProductionDecisionItem(
                decision_type=decision_type,
                summary=summary,
                detail=detail,
                scene_refs=scene_refs if isinstance(scene_refs, list) else [],
                created_at=str(created_at) if created_at else None,
            ).model_dump()
        )

    return ProductionDecisionsResponse(
        script_id=script_id,
        decisions=grouped,
        total=len(rows),
    )


# ── Script chat helpers ───────────────────────────────────────────────────────

_CHAT_SCENE_PATTERNS = [
    re.compile(r'\bscene\s+(\d+)\b', re.IGNORECASE),
    re.compile(r'\bsc\.?\s+(\d+)\b', re.IGNORECASE),
]


def _extract_chat_scene_refs(text: str) -> list[int]:
    refs: list[int] = []
    for pattern in _CHAT_SCENE_PATTERNS:
        for m in pattern.finditer(text):
            n = int(m.group(1))
            if n not in refs:
                refs.append(n)
    refs.sort()
    return refs


def _build_script_chat_system_prompt(ctx: "ChatContext") -> str:  # type: ignore[name-defined]
    lines = [
        "You are a script production assistant for MovieShaker, "
        "helping production teams with physical production planning.",
        f'\nScript: "{ctx.title}"  |  Pages: {ctx.page_count}  |  Scenes: {len(ctx.scene_index)}',
    ]

    if ctx.scene_index:
        lines.append("\nSCENE INDEX:")
        for s in ctx.scene_index:
            parts = [f"  Scene {s.get('scene_number', '?')}: {s.get('heading', '')}"]
            if s.get('location_type'):
                parts.append(f"[{s['location_type']}]")
            if s.get('is_night_shoot'):
                parts.append("[NIGHT]")
            lines.append(" ".join(parts))

    if ctx.analysis_summary:
        lines.append("\nANALYSIS:")
        risk = ctx.analysis_summary.get("risk_scores")
        if risk and isinstance(risk, dict):
            risk_parts = []
            for k in ("schedule", "budget", "vfx", "stunt", "location"):
                entry = risk.get(k)
                if entry and isinstance(entry, dict):
                    risk_parts.append(f"{k.capitalize()}: {entry.get('score', '?')}/10")
            if risk_parts:
                lines.append("  Risks — " + ", ".join(risk_parts))

    if ctx.production_decisions:
        lines.append(f"\nPRODUCTION DECISIONS ({len(ctx.production_decisions)}):")
        for d in ctx.production_decisions[:10]:
            lines.append(f"  [{d.get('decision_type', '')}] {d.get('summary', '')}")

    if ctx.full_scenes:
        lines.append("\nFULL SCENE CONTENT:")
        for fs in ctx.full_scenes:
            lines.append(f"\n--- Scene {fs['scene_number']} ---")
            for el in fs.get('elements', []):
                el_type = el.get('type', '')
                text_val = (el.get('text') or '').strip()
                if text_val and el_type in (
                    'scene_heading', 'action', 'dialogue',
                    'character', 'parenthetical', 'transition',
                ):
                    lines.append(text_val)

    if ctx.budget_context:
        total = ctx.budget_context.get('total_budget')
        currency = ctx.budget_context.get('currency', 'GBP')
        if total is not None:
            lines.append(f"\nBUDGET: {currency} {total}")

    if ctx.schedule_context:
        days = ctx.schedule_context.get('shooting_days', {})
        if days:
            lines.append(f"\nSCHEDULE: {len(days)} shooting day(s) planned.")

    lines.append(
        "\nAnswer specifically using actual scene numbers, character names, and locations. "
        "Be concise and production-focused."
    )
    return "\n".join(lines)


# ── Script chat Pydantic models ───────────────────────────────────────────────

class ScriptChatBody(BaseModel):
    message: str
    chat_id: Optional[str] = None
    context_mode: Optional[str] = None


class ScriptChatResponse(BaseModel):
    reply: str
    chat_id: str
    scene_refs: list
    model_used: str


class ScriptMessageItem(BaseModel):
    role: str
    content: str
    scene_refs: list
    model_used: Optional[str] = None
    created_at: Optional[str] = None


class ScriptMessagesResponse(BaseModel):
    chat_id: str
    messages: list[ScriptMessageItem]


# POST /scripts/{script_id}/chat
@router.post("/scripts/{script_id}/chat", response_model=ScriptChatResponse)
def script_chat(
    script_id: str,
    body: ScriptChatBody,
    background_tasks: BackgroundTasks,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    # Lazy imports avoid circular dependency
    # (context_assembler imports _read_script_json from this module)
    from scripts.context_assembler import assemble_chat_context, get_message_history
    from scripts.routing import select_model, log_routing_decision

    user_id = session.get_user_id()
    # Fetch profile — same pattern as film_in_a_box.py / ai_assistant.py
    profile = ensure_user_can_generate(db, user_id)
    user_model = (profile.model_fiab_text or settings.film_in_a_box_model).strip()
    if not user_model:
        raise HTTPException(status_code=400, detail="No model configured for this account")

    script = _get_script_and_ensure_access(db, script_id, user_id)
    script_uuid = script.id
    db.expunge_all()

    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # Resolve chat_id — verify ownership if one was provided
    if body.chat_id:
        chat_row = db.execute(
            text("SELECT id FROM script_chats WHERE id = :cid AND script_id = :sid"),
            {"cid": body.chat_id, "sid": str(script_uuid)},
        ).first()
        chat_id = str(chat_row[0]) if chat_row else _get_or_create_chat(db, script_uuid, user_id)
    else:
        chat_id = _get_or_create_chat(db, script_uuid, user_id)

    ctx = assemble_chat_context(script_id, message, db)
    history = get_message_history(chat_id, db)
    model, routing_reason = select_model(message, ctx, user_model)
    log_routing_decision(message, model, routing_reason)

    from scripts.prompts.system_prompt_builder import build_system_prompt
    system_prompt = build_system_prompt(
        context_mode=body.context_mode or "scripts",
        context=ctx,
        db=db,
        user_id=user_id,
    )
    gateway_messages = [{"role": "system", "content": system_prompt}]
    for h in history:
        gateway_messages.append({"role": h["role"], "content": h["content"]})
    gateway_messages.append({"role": "user", "content": message})

    try:
        gw_response = _gateway_client().execute_text(model=model, messages=gateway_messages)
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=f"AI gateway error: {exc}")

    reply_text = _extract_text_from_gateway(gw_response)
    if not reply_text:
        raise HTTPException(status_code=502, detail="Gateway returned an empty response")

    scene_refs = _extract_chat_scene_refs(reply_text)

    db.execute(
        text(
            "INSERT INTO script_messages "
            "  (id, chat_id, role, content, scene_refs, model_used, created_at) "
            "VALUES "
            "  (gen_random_uuid(), :chat_id, 'user', :content, cast('[]' as jsonb), NULL, NOW())"
        ),
        {"chat_id": chat_id, "content": message},
    )
    db.execute(
        text(
            "INSERT INTO script_messages "
            "  (id, chat_id, role, content, scene_refs, model_used, created_at) "
            "VALUES "
            "  (gen_random_uuid(), :chat_id, 'assistant', :content, "
            "   cast(:scene_refs as jsonb), :model_used, NOW())"
        ),
        {
            "chat_id": chat_id,
            "content": reply_text,
            "scene_refs": json.dumps(scene_refs),
            "model_used": model,
        },
    )
    db.commit()

    background_tasks.add_task(_extract_decisions, script_id, chat_id, reply_text, db)

    return ScriptChatResponse(
        reply=reply_text,
        chat_id=chat_id,
        scene_refs=scene_refs,
        model_used=model,
    )


# GET /scripts/{script_id}/messages
@router.get("/scripts/{script_id}/messages", response_model=ScriptMessagesResponse)
def get_script_messages(
    script_id: str,
    chat_id: str = Query(..., description="The chat session ID"),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)

    chat_row = db.execute(
        text("SELECT id FROM script_chats WHERE id = :cid AND script_id = :sid"),
        {"cid": chat_id, "sid": script_id},
    ).first()
    if not chat_row:
        raise HTTPException(status_code=404, detail="Chat session not found for this script")

    rows = db.execute(
        text(
            "SELECT role, content, scene_refs, model_used, created_at "
            "FROM script_messages WHERE chat_id = :chat_id ORDER BY created_at ASC"
        ),
        {"chat_id": chat_id},
    ).fetchall()

    messages = [
        ScriptMessageItem(
            role=row[0],
            content=row[1],
            scene_refs=row[2] if isinstance(row[2], list) else [],
            model_used=row[3],
            created_at=str(row[4]) if row[4] else None,
        )
        for row in rows
    ]
    return ScriptMessagesResponse(chat_id=chat_id, messages=messages)


# ── Schedule endpoints ────────────────────────────────────────────────────────

class ScheduleAssignment(BaseModel):
    scene_number: int
    shooting_day: int


class ScheduleCommitBody(BaseModel):
    assignments: List[ScheduleAssignment]


# POST /scripts/{script_id}/schedule/commit
@router.post("/scripts/{script_id}/schedule/commit")
def commit_schedule(
    script_id: str,
    body: ScheduleCommitBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)
    committed = 0
    for a in body.assignments:
        result = db.execute(
            text("""
                UPDATE scenes
                SET continuity_day = :shooting_day
                WHERE script_id = :script_id
                AND scene_number = :scene_number
            """),
            {
                "shooting_day": a.shooting_day,
                "script_id": str(uuid.UUID(script_id)),
                "scene_number": a.scene_number,
            },
        )
        committed += result.rowcount
    db.commit()
    return {"committed": committed, "script_id": script_id}


# POST /scripts/{script_id}/schedule/generate
@router.post("/scripts/{script_id}/schedule/generate")
def generate_schedule(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)

    rows = db.execute(
        text("""
            SELECT scene_number, heading, length_in_eighths,
                   scene_location, location_type, is_night_shoot,
                   has_stunts, has_vfx, characters
            FROM scenes
            WHERE script_id = :script_id
            ORDER BY scene_number ASC
        """),
        {"script_id": str(uuid.UUID(script_id))},
    ).fetchall()

    scenes_data = []
    for row in rows:
        chars_raw = row[8]
        if isinstance(chars_raw, str):
            try:
                chars = json.loads(chars_raw)
            except Exception:
                chars = []
        elif isinstance(chars_raw, list):
            chars = chars_raw
        else:
            chars = []
        scenes_data.append({
            "scene_number": row[0],
            "heading": row[1],
            "length_in_eighths": row[2],
            "scene_location": row[3],
            "location_type": row[4],
            "is_night_shoot": row[5],
            "has_stunts": row[6],
            "has_vfx": row[7],
            "characters": [
                c.get("name", c) if isinstance(c, dict) else str(c)
                for c in chars
            ],
        })

    from scripts.prompts.system_prompt_builder import SCHEDULING_SYSTEM_PROMPT
    user_prompt = (
        f"Generate a shooting schedule for the following {len(scenes_data)} scenes. "
        "Return ONLY a valid JSON array, no preamble.\n\n"
        + json.dumps(scenes_data, indent=2)
    )

    try:
        gw_response = _gateway_client().execute_text(
            model=ANALYSIS_MODEL,
            messages=[
                {"role": "system", "content": SCHEDULING_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=f"AI gateway error: {exc}")

    raw_text = _extract_text_from_gateway(gw_response)
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned.strip())

    assignments_list: Optional[list] = None
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            assignments_list = parsed
    except (ValueError, TypeError):
        pass

    if assignments_list is None:
        start = cleaned.find("[")
        end = cleaned.rfind("]")
        if start >= 0 and end > start:
            try:
                assignments_list = json.loads(cleaned[start : end + 1])
            except (ValueError, TypeError):
                pass

    if not isinstance(assignments_list, list):
        raise HTTPException(
            status_code=502,
            detail="Gateway did not return a valid JSON schedule array",
        )

    committed = 0
    for a in assignments_list:
        if not isinstance(a, dict):
            continue
        scene_number = a.get("scene_number")
        shooting_day = a.get("shooting_day")
        if scene_number is None or shooting_day is None:
            continue
        try:
            result = db.execute(
                text("""
                    UPDATE scenes
                    SET continuity_day = :shooting_day
                    WHERE script_id = :script_id
                    AND scene_number = :scene_number
                """),
                {
                    "shooting_day": int(shooting_day),
                    "script_id": str(uuid.UUID(script_id)),
                    "scene_number": int(scene_number),
                },
            )
            committed += result.rowcount
        except Exception:
            continue
    db.commit()

    updated_rows = db.execute(
        text("""
            SELECT id, scene_number, heading, page_number, length_in_eighths,
                   shooting_day, time_of_day_id, continuity_day, scene_location,
                   scene_details, location_details
            FROM scenes
            WHERE script_id = :script_id
            ORDER BY scene_number ASC
        """),
        {"script_id": str(uuid.UUID(script_id))},
    ).fetchall()

    data = [
        SceneResponse(
            id=str(row[0]),
            scene_number=row[1],
            heading=row[2] or "",
            page_number=row[3] or "",
            length_in_eighths=row[4],
            shooting_day=row[5],
            time_of_day_id=row[6],
            continuity_day=row[7],
            scene_location=row[8],
            scene_details=row[9],
            location_details=row[10],
        )
        for row in updated_rows
    ]
    return {
        "committed": committed,
        "script_id": script_id,
        "scenes": [d.model_dump() for d in data],
    }


# DELETE /scripts/{script_id}
@router.delete("/scripts/{script_id}")
def delete_script(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)

    delete_script_dir(script.user_id, str(script.project_id), str(script.id))
    db.delete(script)
    db.commit()

    cache_delete(scripts_list_key(str(script.project_id)))
    cache_delete(scripts_stats_key(script_id))
    return {"success": True}
