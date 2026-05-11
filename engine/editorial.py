"""
Editorial: film assembly timeline.
Stores a two-track (video + audio) ordered sequence as timeline.json in DO Spaces.
Prefix: /api/editorial
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from auth_deps import verify_session
from supertokens_python.recipe.session import SessionContainer
from db import get_session
from models import Project, ProjectMember
import storage as storage_module

router = APIRouter(prefix="/api/editorial", tags=["editorial"])


def _ensure_project_member(db: Session, project_id: str, user_id: str) -> None:
    member = db.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not a project member")


class TimelineBody(BaseModel):
    video_track: list[dict[str, Any]]
    audio_track: list[dict[str, Any]]


@router.get("/projects/{project_id}/timeline")
def get_timeline(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Return the current timeline for a project."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    return storage_module.read_timeline(user_id, project_id)


@router.put("/projects/{project_id}/timeline")
def save_timeline(
    project_id: str,
    body: TimelineBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Persist the full timeline state."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    timeline = {"video_track": body.video_track, "audio_track": body.audio_track}
    storage_module.write_timeline(user_id, project_id, timeline)
    return {"success": True}
