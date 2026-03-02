"""
Scripts API: list by project, create+upload (multipart), stats, stream file, delete.
Storage path: STORAGE_ROOT/{user_id}/{project_id}/{script_id}/script.pdf
Valkey cache: scripts:list:{project_id}, scripts:stats:{script_id}
"""
import json
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlmodel import Session, select
from pydantic import BaseModel

from db import get_session
from models import ProjectMember, Script
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


class ScriptListResponse(BaseModel):
    scripts: List[ScriptResponse]


class StatsResponse(BaseModel):
    stats: dict  # { "scenes": n, "characters": n }


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
        path = script_json_path(script.user_id, str(script.project_id), str(script.id))
        if not path.exists():
            raise HTTPException(status_code=404, detail="Script JSON not found")
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
