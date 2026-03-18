"""
Mood Board API: canvas compositions, image history, and upload per tram line.
Prefix: /api/moodboard.
"""
import json
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from db import get_session
from models import MoodBoardComposition, MoodBoardImageHistory, ProjectMember, Scene, Script, TramLine
from storage import build_guid_filename, delete_storage_file, save_moodboard_image
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

router = APIRouter(prefix="/api/moodboard", tags=["moodboard"])


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


def _tramline_project_scene_context(db: Session, tramline_id: str) -> tuple[str, str]:
    """
    Return (project_id, scene_id) for a tram line.
    Access control is enforced separately via _ensure_tramline_access.
    """
    line = db.get(TramLine, uuid.UUID(tramline_id))
    if not line:
        raise HTTPException(status_code=404, detail="Tram line not found")
    scene = db.get(Scene, line.scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    script = db.get(Script, scene.script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    return str(script.project_id), str(scene.id)


@router.get("/{tram_line_id}/compositions")
def list_compositions(
    tram_line_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_tramline_access(db, tram_line_id, user_id)
    rows = list(
        db.exec(
            select(MoodBoardComposition)
            .where(
                MoodBoardComposition.tram_line_id == uuid.UUID(tram_line_id),
                MoodBoardComposition.user_id == user_id,
            )
            .order_by(MoodBoardComposition.canvas_number.asc(), MoodBoardComposition.created_at.asc())
        ).all()
    )
    out = []
    for r in rows:
        data = None
        if r.composition_data:
            try:
                data = json.loads(r.composition_data)
            except Exception:
                pass
        out.append({
            "id": str(r.id),
            "tram_line_id": str(r.tram_line_id),
            "user_id": r.user_id,
            "composition_data": data,
            "canvas_number": r.canvas_number,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        })
    return {"success": True, "compositions": out}


class CompositionBody(BaseModel):
    id: Optional[str] = None
    tram_line_id: str
    composition_data: Any = None


@router.post("/composition")
def save_composition(
    body: CompositionBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_tramline_access(db, body.tram_line_id, user_id)
    tram_line_uuid = uuid.UUID(body.tram_line_id)
    payload = json.dumps(body.composition_data) if body.composition_data is not None else "{}"

    if body.id:
        comp = db.get(MoodBoardComposition, uuid.UUID(body.id))
        if not comp or comp.user_id != user_id or str(comp.tram_line_id) != body.tram_line_id:
            raise HTTPException(status_code=404, detail="Composition not found")
        comp.composition_data = payload
        comp.updated_at = __import__("datetime").datetime.utcnow()
        db.add(comp)
        db.commit()
        db.refresh(comp)
        row = comp
    else:
        existing = list(
            db.exec(
                select(MoodBoardComposition).where(
                    MoodBoardComposition.tram_line_id == tram_line_uuid,
                    MoodBoardComposition.user_id == user_id,
                )
            ).all()
        )
        next_num = max((c.canvas_number for c in existing), default=0) + 1
        comp = MoodBoardComposition(
            tram_line_id=tram_line_uuid,
            user_id=user_id,
            composition_data=payload,
            canvas_number=next_num,
        )
        db.add(comp)
        db.commit()
        db.refresh(comp)
        row = comp

    data = None
    if row.composition_data:
        try:
            data = json.loads(row.composition_data)
        except Exception:
            pass
    return {
        "success": True,
        "composition": {
            "id": str(row.id),
            "tram_line_id": str(row.tram_line_id),
            "user_id": row.user_id,
            "composition_data": data,
            "canvas_number": row.canvas_number,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        },
    }


class HistoryBody(BaseModel):
    tram_line_id: str
    image_path: str
    generation_method: str = "upload"
    prompt: Optional[str] = None
    aspect_ratio: Optional[str] = None


@router.get("/{tram_line_id}/history")
def list_history(
    tram_line_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_tramline_access(db, tram_line_id, user_id)
    rows = list(
        db.exec(
            select(MoodBoardImageHistory).where(
                MoodBoardImageHistory.tram_line_id == uuid.UUID(tram_line_id),
                MoodBoardImageHistory.user_id == user_id,
            ).order_by(MoodBoardImageHistory.created_at.desc())
        ).all()
    )
    out = [
        {
            "id": str(r.id),
            "tram_line_id": str(r.tram_line_id),
            "image_path": r.image_path,
            "generation_method": r.generation_method,
            "prompt": r.prompt,
            "aspect_ratio": r.aspect_ratio,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
    return {"success": True, "history": out}


@router.post("/history")
def create_history(
    body: HistoryBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_tramline_access(db, body.tram_line_id, user_id)
    row = MoodBoardImageHistory(
        tram_line_id=uuid.UUID(body.tram_line_id),
        user_id=user_id,
        image_path=body.image_path,
        generation_method=body.generation_method,
        prompt=body.prompt,
        aspect_ratio=body.aspect_ratio,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "success": True,
        "history": {
            "id": str(row.id),
            "tram_line_id": str(row.tram_line_id),
            "image_path": row.image_path,
            "generation_method": row.generation_method,
            "prompt": row.prompt,
            "aspect_ratio": row.aspect_ratio,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        },
    }


@router.delete("/history/{history_id}")
def delete_history(
    history_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    row = db.get(MoodBoardImageHistory, uuid.UUID(history_id))
    if not row or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Image history not found")
    _ensure_tramline_access(db, str(row.tram_line_id), user_id)
    db.delete(row)
    db.commit()
    return {"success": True, "message": "Deleted"}


@router.post("/upload")
async def upload_moodboard_image(
    tram_line_id: str = Form(...),
    aspect_ratio: Optional[str] = Form(None),
    file: UploadFile = File(...),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Upload image for a tram line: save to storage, create image history row, update tram line scene_visual."""
    user_id = session.get_user_id()
    line = _ensure_tramline_access(db, tram_line_id, user_id)
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "png"
    if ext not in ("png", "jpg", "jpeg", "gif", "webp"):
        ext = "png"
    asset_filename = build_guid_filename(ext)
    content = await file.read()
    size = len(content)
    old_path = (line.scene_visual or "").strip() or None
    try:
        from io import BytesIO
        project_id, scene_id = _tramline_project_scene_context(db, tram_line_id)
        path_key = save_moodboard_image(
            user_id=user_id,
            project_id=project_id,
            scene_id=scene_id,
            tram_line_id=tram_line_id,
            asset_filename=asset_filename,
            content=BytesIO(content),
            size=size,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    history_row = MoodBoardImageHistory(
        tram_line_id=uuid.UUID(tram_line_id),
        user_id=user_id,
        image_path=path_key,
        generation_method="upload",
        aspect_ratio=aspect_ratio,
    )
    db.add(history_row)
    line.scene_visual = path_key
    db.add(line)

    # Remove stale history rows that reference the replaced source image key.
    if old_path and old_path != path_key:
        stale_rows = list(
            db.exec(
                select(MoodBoardImageHistory).where(
                    MoodBoardImageHistory.tram_line_id == uuid.UUID(tram_line_id),
                    MoodBoardImageHistory.user_id == user_id,
                    MoodBoardImageHistory.image_path == old_path,
                )
            ).all()
        )
        for stale in stale_rows:
            db.delete(stale)

    db.commit()
    db.refresh(history_row)
    if old_path and old_path != path_key:
        delete_storage_file(old_path)
    return {
        "success": True,
        "path": path_key,
        "history": {
            "id": str(history_row.id),
            "image_path": history_row.image_path,
            "created_at": history_row.created_at.isoformat() if history_row.created_at else None,
        },
    }
