"""
Compiled (stitched) videos API for Visualize.
Prefix: /api/compiled-videos.
"""
import json
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from db import get_session
from models import MoodBoardCompiledVideo, ProjectMember, Scene, Script, TramLine
from storage import delete_storage_file
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

router = APIRouter(prefix="/api/compiled-videos", tags=["compiled-videos"])


def _ensure_project_member(db: Session, project_id: str, user_id: str) -> None:
    member = db.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == uuid.UUID(project_id),
            ProjectMember.user_id == user_id,
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this project")


def _ensure_tramline_access(db: Session, tramline_id: str, user_id: str) -> TramLine:
    line = db.get(TramLine, uuid.UUID(tramline_id))
    if not line:
        raise HTTPException(status_code=404, detail="Tram line not found")
    scene = db.get(Scene, line.scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    script = db.get(Script, scene.script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    member = db.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == script.project_id,
            ProjectMember.user_id == user_id,
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this project")
    return line


def _ensure_compiled_access(db: Session, compiled_id: str, user_id: str) -> MoodBoardCompiledVideo:
    row = db.get(MoodBoardCompiledVideo, uuid.UUID(compiled_id))
    if not row:
        raise HTTPException(status_code=404, detail="Compiled video not found")
    _ensure_project_member(db, str(row.project_id), user_id)
    return row


def _compiled_to_response(c: MoodBoardCompiledVideo, tram_line: Optional[TramLine] = None) -> dict:
    source_ids: List[str] = []
    if c.source_video_ids:
        try:
            source_ids = json.loads(c.source_video_ids)
        except Exception:
            pass
    out = {
        "id": str(c.id),
        "compiled_video_path": c.compiled_video_path,
        "source_video_ids": source_ids,
        "status": c.status,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "completed_at": c.completed_at.isoformat() if c.completed_at else None,
        "error_message": c.error_message,
        "is_main_print": c.is_main_print,
        "youtube_upload_status": c.youtube_upload_status,
        "tram_line_id": str(c.tram_line_id),
        "project_id": str(c.project_id),
        "channel_number": c.channel_number,
    }
    if tram_line:
        out["tram_line"] = {
            "line_number": tram_line.line_number,
            "shot_type": tram_line.shot_type,
        }
    return out


def _normalize_storage_key(path_or_url: Optional[str]) -> Optional[str]:
    value = (path_or_url or "").strip()
    if not value:
        return None
    marker = "/api/storage/"
    idx = value.find(marker)
    if idx >= 0:
        return value[idx + len(marker):].split("?")[0]
    if value.startswith("http://") or value.startswith("https://") or value.startswith("data:"):
        return None
    return value


class CreateCompiledBody(BaseModel):
    tram_line_id: Optional[str] = None
    project_id: Optional[str] = None
    video_url: Optional[str] = None
    compiled_video_path: Optional[str] = None
    source_video_ids: Optional[List[str]] = None
    status: str = "pending"
    is_main_print: Optional[bool] = None
    youtube_upload_status: Optional[str] = None
    channel_number: Optional[int] = None


class PatchStatusBody(BaseModel):
    youtube_upload_status: Optional[str] = None
    channel_number: Optional[int] = None


class MainPrintBody(BaseModel):
    tram_line_id: str


@router.get("/{tram_line_id}")
def list_by_tram_line(
    tram_line_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_tramline_access(db, tram_line_id, user_id)
    rows = list(
        db.exec(
            select(MoodBoardCompiledVideo).where(
                MoodBoardCompiledVideo.tram_line_id == uuid.UUID(tram_line_id)
            ).order_by(MoodBoardCompiledVideo.channel_number.asc(), MoodBoardCompiledVideo.created_at.asc())
        ).all()
    )
    return {"success": True, "compiledVideos": [_compiled_to_response(r) for r in rows]}


@router.get("/project/{project_id}/print-videos")
def list_print_videos(
    project_id: str,
    main_only: bool = Query(False),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    stmt = select(MoodBoardCompiledVideo).where(
        MoodBoardCompiledVideo.project_id == uuid.UUID(project_id)
    )
    if main_only:
        stmt = stmt.where(MoodBoardCompiledVideo.is_main_print == True)
    rows = list(db.exec(stmt.order_by(MoodBoardCompiledVideo.created_at.desc())).all())
    out = []
    for r in rows:
        line = db.get(TramLine, r.tram_line_id)
        out.append(_compiled_to_response(r, line))
    return {"success": True, "videos": out}


@router.get("/project/{project_id}/final")
def get_final_video(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    row = db.exec(
        select(MoodBoardCompiledVideo).where(
            MoodBoardCompiledVideo.project_id == uuid.UUID(project_id),
            MoodBoardCompiledVideo.status == "completed",
        ).order_by(MoodBoardCompiledVideo.completed_at.desc()).limit(1)
    ).first()
    return {"success": True, "finalVideo": _compiled_to_response(row) if row else None}


@router.post("", status_code=201)
def create_compiled(
    body: CreateCompiledBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    path = body.compiled_video_path or body.video_url or ""
    if not body.tram_line_id or not body.project_id:
        raise HTTPException(status_code=400, detail="tram_line_id and project_id required")
    _ensure_tramline_access(db, body.tram_line_id, user_id)
    _ensure_project_member(db, body.project_id, user_id)
    source_json = json.dumps(body.source_video_ids or []) if body.source_video_ids else None
    row = MoodBoardCompiledVideo(
        tram_line_id=uuid.UUID(body.tram_line_id),
        project_id=uuid.UUID(body.project_id),
        user_id=user_id,
        compiled_video_path=path,
        source_video_ids=source_json,
        status=body.status,
        is_main_print=body.is_main_print,
        youtube_upload_status=body.youtube_upload_status,
        channel_number=body.channel_number,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"success": True, "compiledVideo": _compiled_to_response(row)}


@router.patch("/{compiled_id}/status")
def patch_status(
    compiled_id: str,
    body: PatchStatusBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    row = _ensure_compiled_access(db, compiled_id, user_id)
    if body.youtube_upload_status is not None:
        row.youtube_upload_status = body.youtube_upload_status
    if body.channel_number is not None:
        row.channel_number = body.channel_number
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"success": True, "compiledVideo": _compiled_to_response(row)}


@router.patch("/{compiled_id}/main-print")
def set_main_print(
    compiled_id: str,
    body: MainPrintBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    row = _ensure_compiled_access(db, compiled_id, user_id)
    _ensure_tramline_access(db, body.tram_line_id, user_id)
    row.is_main_print = True
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"success": True}


@router.delete("/{compiled_id}")
def delete_compiled(
    compiled_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    row = _ensure_compiled_access(db, compiled_id, user_id)
    compiled_storage_key = _normalize_storage_key(row.compiled_video_path)
    if compiled_storage_key:
        delete_storage_file(compiled_storage_key)
    db.delete(row)
    db.commit()
    return {"success": True}


@router.post("/{compiled_id}/check-status")
def check_status(
    compiled_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Poll endpoint: return current status (placeholder for external stitch service)."""
    user_id = session.get_user_id()
    row = _ensure_compiled_access(db, compiled_id, user_id)
    return {
        "success": True,
        "compiledVideo": _compiled_to_response(row),
        "status": row.status,
        "message": row.error_message or ("Completed" if row.status == "completed" else "Pending"),
    }
