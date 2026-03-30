"""
Scripts API: list by project, create+upload (multipart), stats, stream file, delete.
Parse: POST /scripts/:id/parse to extract scenes/characters from PDF or JSON.
Storage path: STORAGE_ROOT/{user_id}/{project_id}/{script_id}/script.pdf
Valkey cache: scripts:list:{project_id}, scripts:stats:{script_id}
"""
import io
import json
import re
import uuid
from datetime import datetime
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlmodel import Session, select, update
from pydantic import BaseModel

from db import get_session
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

router = APIRouter(tags=["scripts"])


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

    scenes, characters = 0, 0
    json_path = script_json_path(script.user_id, str(script.project_id), str(script.id))
    if json_path.exists():
        try:
            with open(json_path) as f:
                data = json.load(f)
            if isinstance(data.get("scenes"), list):
                scenes = len(data["scenes"])
            if isinstance(data.get("characters"), list):
                characters = len(data["characters"])
            elif "characters" in data and isinstance(data["characters"], dict):
                characters = len(data["characters"])
        except Exception:
            pass

    stats = {"scenes": scenes, "characters": characters}
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


def _derive_db_from_elements(
    elements: List[dict], page_count: int
) -> Tuple[List[dict], List[str], dict, int]:
    """Derive (headings, unique_characters, scene_char_map, page_count) from full elements for DB insert."""
    headings = []
    character_set = set()
    scene_char_map: dict = {}
    for el in elements:
        el_type = (el.get("type") or "action").strip().lower()
        text = (el.get("text") or "").strip()
        if el_type == "scene_heading":
            headings.append({
                "heading": text[:255],
                "page_number": f"Page {len(headings) + 1}",
                "length_in_eighths": 1,
            })
            scene_char_map[len(headings) - 1] = set()
        elif el_type == "character":
            name = re.sub(r"\s*\([^)]*\)", "", text)
            name = re.sub(r"[(),!?:;]", "", name).strip().rstrip(". ")
            if 0 < len(name) < 50:
                character_set.add(name)
                if headings:
                    scene_char_map[len(headings) - 1].add(name)
    return (headings, sorted(character_set), scene_char_map, page_count)


def _parse_json_script(body: bytes) -> Tuple[List[dict], List[str], dict, int]:
    """Parse JSON script. Returns (headings, unique_characters, scene_index_to_characters, page_count)."""
    data = json.loads(body.decode("utf-8", errors="replace"))
    elements = data.get("elements") or []
    page_count = 1
    if isinstance(data.get("metadata"), dict) and "page_count" in data["metadata"]:
        page_count = int(data["metadata"]["page_count"]) or 1
    return _derive_db_from_elements(elements, page_count)


# Canonical script.json types (source of truth)
SCRIPT_JSON_TYPES = frozenset(
    {"scene_heading", "scene_number", "action", "character", "dialogue", "parenthetical", "transition", "page_number", "general"}
)


def _script_json_to_bytes(elements: List[dict], metadata: dict) -> bytes:
    """Serialize script.json document. metadata must include page_count."""
    meta = dict(metadata)
    if "page_count" not in meta:
        meta["page_count"] = 1
    doc = {"metadata": meta, "elements": elements}
    return json.dumps(doc, indent=2).encode("utf-8")


def _build_script_json(
    headings: List[dict], unique_characters: List[str], scene_char_map: dict, page_count: int
) -> bytes:
    """Build reduced script.json (scene_heading + character only) for saving as script.json."""
    elements: List[dict] = []
    for i, h in enumerate(headings):
        elements.append({"type": "scene_heading", "text": h.get("heading", "")})
        for cname in sorted(scene_char_map.get(i, set())):
            elements.append({"type": "character", "text": cname})
    return _script_json_to_bytes(elements, {"page_count": page_count})


def _parse_pdf_script(body: bytes) -> Tuple[List[dict], List[str], dict, int]:
    """Extract scenes and characters from PDF text. Returns same shape as _parse_json_script."""
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(body))
    page_count = len(reader.pages)
    headings = []
    character_set = set()
    scene_char_map = {}
    scene_heading_re = re.compile(r"^(INT\.|EXT\.|INT\./EXT\.|I/E|EST\.)\s", re.IGNORECASE)
    for pagenum, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        for line in lines:
            if scene_heading_re.match(line):
                headings.append({
                    "heading": line[:255],
                    "page_number": f"Page {pagenum}",
                    "length_in_eighths": 1,
                })
                scene_char_map[len(headings) - 1] = set()
            elif line.isupper() and len(line) < 50 and re.match(r"^[A-Z][A-Z\s\-']+$", line):
                name = re.sub(r"\s*\([^)]*\)", "", line).strip().rstrip(". ")
                if name:
                    character_set.add(name)
                    if headings:
                        scene_char_map[len(headings) - 1].add(name)
    unique_characters = sorted(character_set)
    return (headings, unique_characters, scene_char_map, page_count)


def _extract_title_page_metadata(
    page1_lines: List[Tuple[float, float, str]], script_name: str
) -> dict:
    """
    Build metadata from title page (page 1) lines. Each item is (x_center, y_center, text).
    script_name is fallback for title.
    """
    now_iso = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    metadata = {
        "title": script_name or "Untitled",
        "author": "Unknown",
        "created": now_iso,
        "draft": "MovieShaker (Imported)",
    }
    # Centered lines typically 150 < x < 450; title often in upper-mid Y (e.g. 300-500 in pdf coords)
    by_y = sorted(page1_lines, key=lambda t: -t[1])
    found_by = False
    for x, y, text in by_y:
        t = text.strip()
        if not t:
            continue
        is_centered = 100 < x < 450
        if is_centered and not re.match(r"^\d+\.?$", t):
            if re.match(r"^(written\s+by|screenplay\s+by|story\s+by|by)\s*:?$", t, re.I):
                found_by = True
                continue
            if found_by and metadata["author"] == "Unknown":
                metadata["author"] = t
                found_by = False
                continue
            if metadata["title"] == (script_name or "Untitled") and len(t) > 1 and 200 < y < 600:
                metadata["title"] = t
        if re.search(r"\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}", t, re.I):
            metadata["created"] = now_iso  # could parse date; keep simple
        if re.match(r"^(first|second|revised|production|final)\s+draft\.?$", t, re.I):
            metadata["draft"] = t
    return metadata


def _parse_pdf_to_script_document(body: bytes, script_name: str = "") -> Optional[dict]:
    """
    Parse PDF to canonical script.json document per script-rules.md.
    Page 1 = title page (metadata only). Body elements from page 2+.
    Returns {"metadata": {title, author, created, draft, page_count}, "elements": [...]} or None.
    """
    try:
        from pdfminer.converter import PDFPageAggregator
        from pdfminer.layout import LAParams, LTTextBox, LTTextLine
        from pdfminer.pdfpage import PDFPage
        from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
    except ImportError:
        return None
    try:
        rsrc = PDFResourceManager()
        laparams = LAParams()
        device = PDFPageAggregator(rsrc, laparams=laparams)
        interpreter = PDFPageInterpreter(rsrc, device)
        all_lines: List[Tuple[int, float, float, str]] = []  # (page_num, x_left, y, text) — x_left for alignment
        line_height_tol = 5
        for page_num, page in enumerate(PDFPage.get_pages(io.BytesIO(body)), 1):
            interpreter.process_page(page)
            layout = device.get_result()
            for obj in layout:
                if isinstance(obj, LTTextBox):
                    for line in obj:
                        if isinstance(line, LTTextLine):
                            text = (line.get_text() or "").strip()
                            if not text:
                                continue
                            x0, y0, x1, y1 = line.bbox
                            x_left = x0  # Use left edge so left-aligned action isn't misclassified as dialogue
                            y_center = (y0 + y1) / 2
                            all_lines.append((page_num, x_left, y_center, text))
        if not all_lines:
            return None
        page_count = max(t[0] for t in all_lines)
        # Title page (page 1) -> metadata only
        page1_lines = [(x, y, t) for p, x, y, t in all_lines if p == 1]
        metadata = _extract_title_page_metadata(page1_lines, script_name)
        metadata["page_count"] = page_count
        # Body: page 2+ only
        body_lines = [(p, x, y, t) for p, x, y, t in all_lines if p >= 2]
        if not body_lines:
            return {"metadata": metadata, "elements": []}
        body_lines.sort(key=lambda t: (t[0], -t[2], t[1]))
        grouped: List[Tuple[int, float, float, str]] = []
        for page_num, x, y, text in body_lines:
            if grouped and grouped[-1][0] == page_num and abs(grouped[-1][2] - y) <= line_height_tol:
                # Keep leftmost x so wrapped action stays left-aligned
                x_min = min(grouped[-1][1], x)
                grouped[-1] = (page_num, x_min, grouped[-1][2], grouped[-1][3] + " " + text)
            else:
                grouped.append((page_num, x, y, text))
        scene_heading_re = re.compile(r"^(INT\.|EXT\.|INT\./EXT\.|I/E|EST\.)(?:\s|$)", re.IGNORECASE)
        MERGE_Y_TOLERANCE = 20
        elements: List[dict] = []
        last_el: Optional[dict] = None
        last_y: float = -1e9
        scene_num = 0
        # Transition by content (FADE IN:, CUT TO:, etc.) regardless of position
        transition_re = re.compile(r"^FADE\s", re.I)
        for page_num, x, y, text in grouped:
            is_centered = 150 < x < 400  # x is left edge: left-aligned action has small x
            is_parenthetical = text.startswith("(") and text.endswith(")")
            starts_scene = bool(scene_heading_re.match(text))
            is_page_num = bool(re.match(r"^\d+\.?$", text)) and y > 500 and x > 450
            is_upper = text == text.upper() and bool(re.search(r"[A-Z]", text))
            el_type = "action"
            if is_page_num:
                el_type = "page_number"
            elif starts_scene:
                el_type = "scene_heading"
            elif text.endswith("TO:") or transition_re.match(text):
                el_type = "transition"
            elif is_centered and is_upper and not is_parenthetical:
                el_type = "character"
            elif is_centered and is_parenthetical:
                el_type = "parenthetical"
            elif is_centered:
                if last_el and last_el.get("type") in ("character", "parenthetical", "dialogue"):
                    el_type = "dialogue"
                else:
                    el_type = "dialogue"
                # "NAME (cont'd)" only (dialogue on next line) -> character
                if re.match(r"^[A-Z][A-Z0-9\s]+?\s*\(cont'd\)\s*$", text, re.IGNORECASE):
                    el_type = "character"
            else:
                el_type = "action"
            # script-rules: do not merge two scene_headings; do not merge across parenthetical
            # (cont'd) lines are character + dialogue: never merge into previous dialogue
            contd_match = el_type == "dialogue" and re.match(
                r"^([A-Z][A-Z0-9\s]+?)\s*\(cont'd\)\s+(.+)$", text, re.IGNORECASE
            )
            should_merge = (
                not contd_match
                and last_el is not None
                and last_el.get("_page") == page_num
                and last_el.get("type") == el_type
                and abs(last_y - y) <= MERGE_Y_TOLERANCE
                and not (el_type == "scene_heading")
                and el_type != "parenthetical"
                and last_el.get("type") != "parenthetical"
            )
            if should_merge and last_el is not None:
                last_el["text"] = (last_el["text"] or "") + " " + text
            else:
                if el_type == "scene_heading":
                    scene_num += 1
                    last_el = {"type": "scene_heading", "scene": str(scene_num), "text": text, "_page": page_num}
                    elements.append(last_el)
                    last_y = y
                    continue
                # (cont'd) = same character after action: emit character "NAME (cont'd)" then dialogue
                if el_type == "dialogue" and contd_match:
                    m = contd_match
                    name_part = m.group(1).strip() + " (cont'd)"
                    dialogue_part = m.group(2).strip()
                    elements.append({"type": "character", "text": name_part, "_page": page_num})
                    last_el = {"type": "dialogue", "text": dialogue_part, "_page": page_num}
                    elements.append(last_el)
                    last_y = y
                    continue
                last_el = {"type": el_type, "text": text, "_page": page_num}
                elements.append(last_el)
            last_y = y
        for el in elements:
            el.pop("_page", None)
        return {"metadata": metadata, "elements": elements}
    except Exception:
        return None


def _parse_pdf_script_full(body: bytes, script_name: str = "") -> Optional[Tuple[List[dict], dict]]:
    """
    Parse PDF to full elements + metadata per script-rules.md.
    Returns (elements, metadata) or None. Kept for compatibility with parse route.
    """
    doc = _parse_pdf_to_script_document(body, script_name)
    if doc is None:
        return None
    return (doc["elements"], doc["metadata"])


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
    """Update script.json in storage (full replace). Use for saving edits or replacing document. Does not change scenes/characters in DB."""
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    if not body.elements:
        raise HTTPException(status_code=400, detail="elements array is required and must not be empty")
    metadata = body.metadata or {}
    if "page_count" not in metadata:
        metadata = {**metadata, "page_count": 1}
    normalized = [{"type": (e.get("type") or "action").strip().lower(), "text": (e.get("text") or "").strip()} for e in body.elements]
    json_bytes = _script_json_to_bytes(normalized, metadata)
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
    full_elements: Optional[List[dict]] = None
    script_metadata: Optional[dict] = None
    if body[:20].strip().startswith(b"{") or body[:20].strip().startswith(b"["):
        headings, unique_characters, scene_char_map, page_count = _parse_json_script(body)
        data = json.loads(body.decode("utf-8", errors="replace"))
        raw_elements = data.get("elements") or []
        raw_meta = data.get("metadata") or {}
        types_present = { (e.get("type") or "action").strip().lower() for e in raw_elements }
        if types_present - {"scene_heading", "character"}:
            full_elements = [{"type": (e.get("type") or "action").strip().lower(), "text": (e.get("text") or "").strip()} for e in raw_elements]
            script_metadata = {**raw_meta, "page_count": raw_meta.get("page_count", page_count)}
    elif is_pdf:
        full_result = _parse_pdf_script_full(body, script_name=script.name or "")
        if full_result is not None:
            full_elements, script_metadata = full_result
            page_count = script_metadata.get("page_count", 1)
            headings, unique_characters, scene_char_map, page_count = _derive_db_from_elements(
                full_elements, page_count
            )
        else:
            raise HTTPException(
                status_code=422,
                detail="Failed to parse PDF. Ensure the file is a valid screenplay PDF.",
            )
    else:
        raise HTTPException(status_code=400, detail="File format not recognized (expected PDF or JSON).")
    script_uuid = script.id
    # Delete in FK order: scene_characters -> scenes, characters
    existing_scenes = list(db.exec(select(Scene).where(Scene.script_id == script_uuid)).all())
    for scene in existing_scenes:
        for sc in db.exec(select(SceneCharacter).where(SceneCharacter.scene_id == scene.id)).all():
            db.delete(sc)
    db.flush()  # Emit scene_character DELETEs before deleting scenes (FK constraint)
    for s in existing_scenes:
        db.delete(s)
    for c in db.exec(select(Character).where(Character.script_id == script_uuid)).all():
        db.delete(c)
    db.commit()
    # Insert characters
    char_id_by_name = {}
    for name in unique_characters:
        ch = Character(script_id=script_uuid, user_id=user_id, name=name)
        db.add(ch)
        db.flush()
        char_id_by_name[name] = ch.id
    # Insert scenes and scene_characters
    scene_ids = []
    for i, h in enumerate(headings):
        sc = Scene(
            script_id=script_uuid,
            user_id=user_id,
            heading=h["heading"],
            page_number=h.get("page_number", ""),
            length_in_eighths=h.get("length_in_eighths"),
            scene_number=i + 1,
        )
        db.add(sc)
        db.flush()
        scene_ids.append(sc.id)
        for cname in scene_char_map.get(i, set()):
            cid = char_id_by_name.get(cname)
            if cid:
                db.add(SceneCharacter(scene_id=sc.id, character_id=cid, user_id=user_id))
    script.page_count = page_count
    db.add(script)
    db.commit()
    cache_delete(scripts_stats_key(script_id))
    # Persist script.json in same location as script.pdf (full elements when available, else reduced)
    if full_elements is not None and script_metadata is not None:
        json_bytes = _script_json_to_bytes(full_elements, script_metadata)
    else:
        json_bytes = _build_script_json(headings, unique_characters, scene_char_map, page_count)
    save_script_file(
        script.user_id,
        str(script.project_id),
        str(script.id),
        "script.json",
        io.BytesIO(json_bytes),
        len(json_bytes),
    )
    return {"success": True, "data": {"scenes": len(headings), "characters": len(unique_characters)}}


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
