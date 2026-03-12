"""
Video history API for Visualize: list/create/patch/delete per tram line.
Prefix: /api/video-history.
"""
import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from db import get_session
from models import MoodBoardVideoHistory, ProjectMember, Scene, Script, TramLine
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

router = APIRouter(prefix="/api/video-history", tags=["video-history"])


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


def _ensure_video_access(db: Session, video_id: str, user_id: str) -> MoodBoardVideoHistory:
    video = db.get(MoodBoardVideoHistory, uuid.UUID(video_id))
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    _ensure_tramline_access(db, str(video.tram_line_id), user_id)
    return video


def _video_to_item(v: MoodBoardVideoHistory) -> dict:
    return {
        "id": str(v.id),
        "tram_line_id": str(v.tram_line_id),
        "user_id": v.user_id,
        "video_path": v.video_path,
        "task_id": v.task_id,
        "generation_method": v.generation_method,
        "prompt": v.prompt,
        "aspect_ratio": v.aspect_ratio,
        "duration": v.duration,
        "take_number": v.take_number,
        "Channel": v.channel,
        "source_type": v.source_type,
        "source_image_path": v.source_image_path,
        "source_video_id": v.source_video_id,
        "is_print": v.is_print,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


class CreateVideoHistoryBody(BaseModel):
    tram_line_id: str
    task_id: Optional[str] = None
    generation_method: str = "ai_runway"
    prompt: Optional[str] = None
    aspect_ratio: Optional[str] = None
    duration: Optional[int] = None
    take_number: Optional[int] = None
    channel: Optional[int] = None
    video_path: str = ""
    source_type: Optional[str] = None
    source_image_path: Optional[str] = None
    source_video_id: Optional[str] = None
    is_print: bool = False


@router.get("/{tram_line_id}")
def list_videos(
    tram_line_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_tramline_access(db, tram_line_id, user_id)
    rows = list(
        db.exec(
            select(MoodBoardVideoHistory)
            .where(MoodBoardVideoHistory.tram_line_id == uuid.UUID(tram_line_id))
            .order_by(MoodBoardVideoHistory.channel.asc(), MoodBoardVideoHistory.take_number.asc(), MoodBoardVideoHistory.created_at.asc())
        ).all()
    )
    return {"success": True, "videos": [_video_to_item(r) for r in rows]}


@router.get("")
def list_videos_by_ids(
    ids: Optional[str] = Query(None, description="Comma-separated video IDs"),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    if not ids:
        return {"success": True, "videos": []}
    id_list = [x.strip() for x in ids.split(",") if x.strip()]
    if not id_list:
        return {"success": True, "videos": []}
    uuids = []
    for i in id_list:
        try:
            uuids.append(uuid.UUID(i))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid ID: {i}")
    rows = list(db.exec(select(MoodBoardVideoHistory).where(MoodBoardVideoHistory.id.in_(uuids))).all())
    for r in rows:
        _ensure_tramline_access(db, str(r.tram_line_id), user_id)
    return {"success": True, "videos": [_video_to_item(r) for r in rows]}


@router.post("", status_code=201)
def create_video(
    body: CreateVideoHistoryBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_tramline_access(db, body.tram_line_id, user_id)
    row = MoodBoardVideoHistory(
        tram_line_id=uuid.UUID(body.tram_line_id),
        user_id=user_id,
        video_path=body.video_path or "",
        task_id=body.task_id,
        generation_method=body.generation_method,
        prompt=body.prompt,
        aspect_ratio=body.aspect_ratio,
        duration=body.duration,
        take_number=body.take_number,
        channel=body.channel,
        source_type=body.source_type,
        source_image_path=body.source_image_path,
        source_video_id=body.source_video_id,
        is_print=body.is_print,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"success": True, "video": _video_to_item(row)}


class PatchPrintBody(BaseModel):
    is_print: bool


@router.patch("/{video_id}/print")
def patch_print(
    video_id: str,
    body: PatchPrintBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    row = _ensure_video_access(db, video_id, user_id)
    row.is_print = body.is_print
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"success": True, "video": _video_to_item(row)}


@router.delete("/{video_id}")
def delete_video(
    video_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    row = _ensure_video_access(db, video_id, user_id)
    db.delete(row)
    db.commit()
    return {"success": True, "video": _video_to_item(row)}
