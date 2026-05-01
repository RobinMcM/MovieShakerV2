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
from storage import delete_storage_file, save_moodboard_image
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


def _serialize_composition(row: MoodBoardComposition) -> dict:
    data = None
    if row.composition_data:
        try:
            data = json.loads(row.composition_data)
        except Exception:
            pass
    return {
        "id": str(row.id),
        "tram_line_id": str(row.tram_line_id),
        "user_id": row.user_id,
        "composition_data": data,
        "canvas_number": row.canvas_number,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


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

    return {
        "success": True,
        "composition": _serialize_composition(row),
    }


@router.post("/save-canvas")
async def save_canvas_atomic(
    tram_line_id: str = Form(...),
    composition_data: str = Form("{}"),
    composition_id: Optional[str] = Form(None),
    aspect_ratio: Optional[str] = Form(None),
    file: UploadFile = File(...),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """
    Atomically save moodboard canvas:
    - save rendered PNG snapshot
    - update tram line scene_visual
    - create/update composition JSON
    - rotate snapshot key each save (cache-busting)
    """
    user_id = session.get_user_id()
    line = _ensure_tramline_access(db, tram_line_id, user_id)
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    payload: Any
    try:
        payload = json.loads(composition_data) if composition_data else {}
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid composition_data JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="composition_data must be a JSON object")

    content = await file.read()
    size = len(content)
    if size <= 0:
        raise HTTPException(status_code=400, detail="Canvas image is empty")
    # PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if size < 8 or content[:8] != b"\x89PNG\r\n\x1a\n":
        raise HTTPException(status_code=400, detail="Invalid PNG image payload")

    path_key: Optional[str] = None
    old_snapshot_to_delete: Optional[str] = None
    try:
        from io import BytesIO

        project_id, scene_id = _tramline_project_scene_context(db, tram_line_id)
        tram_line_uuid = uuid.UUID(tram_line_id)
        row: MoodBoardComposition
        note = str(payload.get("note") or "").strip()
        dimensions = payload.get("dimensions") if isinstance(payload.get("dimensions"), dict) else {}
        width = float(dimensions.get("width") or 1280)
        height = float(dimensions.get("height") or 720)
        if width <= 0:
            width = 1280
        if height <= 0:
            height = 720

        if composition_id:
            row = db.get(MoodBoardComposition, uuid.UUID(composition_id))
            if not row or row.user_id != user_id or str(row.tram_line_id) != tram_line_id:
                raise HTTPException(status_code=404, detail="Composition not found")
            previous_snapshot_path: Optional[str] = None
            if row.composition_data:
                try:
                    previous_payload = json.loads(row.composition_data)
                    if isinstance(previous_payload, dict):
                        previous_snapshot_path = str(previous_payload.get("snapshot_path") or "").strip() or None
                except Exception:
                    previous_snapshot_path = None

            rotated_filename = f"{uuid.uuid4().hex}.png"
            rotated_path = save_moodboard_image(
                user_id=user_id,
                project_id=project_id,
                scene_id=scene_id,
                tram_line_id=tram_line_id,
                filename=rotated_filename,
                content=BytesIO(content),
                size=size,
            )
            path_key = rotated_path
            snapshot_payload = {
                "images": [
                    {
                        "id": f"snapshot-{uuid.uuid4().hex}",
                        "src": rotated_path,
                        "x": 0,
                        "y": 0,
                        "width": width,
                        "height": height,
                    }
                ],
                "lines": [],
                "dimensions": {"width": width, "height": height},
                "note": note,
                "snapshot_path": rotated_path,
                "mode": "snapshot",
            }
            row.composition_data = json.dumps(snapshot_payload)
            row.updated_at = __import__("datetime").datetime.utcnow()
            db.add(row)
            if previous_snapshot_path and previous_snapshot_path != rotated_path:
                old_snapshot_to_delete = previous_snapshot_path
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
            new_comp_id = uuid.uuid4()
            rotated_path = save_moodboard_image(
                user_id=user_id,
                project_id=project_id,
                scene_id=scene_id,
                tram_line_id=tram_line_id,
                filename=f"{uuid.uuid4().hex}.png",
                content=BytesIO(content),
                size=size,
            )
            path_key = rotated_path
            snapshot_payload = {
                "images": [
                    {
                        "id": f"snapshot-{new_comp_id}",
                        "src": rotated_path,
                        "x": 0,
                        "y": 0,
                        "width": width,
                        "height": height,
                    }
                ],
                "lines": [],
                "dimensions": {"width": width, "height": height},
                "note": note,
                "snapshot_path": rotated_path,
                "mode": "snapshot",
            }
            row = MoodBoardComposition(
                id=new_comp_id,
                tram_line_id=tram_line_uuid,
                user_id=user_id,
                composition_data=json.dumps(snapshot_payload),
                canvas_number=next_num,
            )
            db.add(row)

        history_row = MoodBoardImageHistory(
            tram_line_id=tram_line_uuid,
            user_id=user_id,
            image_path=path_key,
            generation_method="canvas_save",
            aspect_ratio=aspect_ratio,
        )
        db.add(history_row)
        line.scene_visual = path_key
        db.add(line)
        db.commit()
        db.refresh(row)

        if old_snapshot_to_delete:
            try:
                delete_storage_file(old_snapshot_to_delete)
            except Exception:
                pass

        return {
            "success": True,
            "path": path_key,
            "composition": _serialize_composition(row),
            "history": {
                "id": str(history_row.id),
                "image_path": history_row.image_path,
                "created_at": history_row.created_at.isoformat() if history_row.created_at else None,
            },
        }
    except HTTPException:
        db.rollback()
        raise
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        db.rollback()
        raise


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


@router.delete("/{composition_id}")
def delete_composition(
    composition_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    try:
        comp_uuid = uuid.UUID(composition_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid composition ID")
    comp = db.get(MoodBoardComposition, comp_uuid)
    if not comp or comp.user_id != user_id:
        raise HTTPException(status_code=404, detail="Composition not found")
    _ensure_tramline_access(db, str(comp.tram_line_id), user_id)
    snapshot_path: Optional[str] = None
    if comp.composition_data:
        try:
            data = json.loads(comp.composition_data)
            if isinstance(data, dict):
                snapshot_path = str(data.get("snapshot_path") or "").strip() or None
        except Exception:
            pass
    db.delete(comp)
    db.commit()
    if snapshot_path:
        try:
            delete_storage_file(snapshot_path)
        except Exception:
            pass
    return {"success": True}


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
    filename = f"{tram_line_id}-{uuid.uuid4().hex[:12]}.{ext}"
    content = await file.read()
    size = len(content)
    try:
        from io import BytesIO
        project_id, scene_id = _tramline_project_scene_context(db, tram_line_id)
        path_key = save_moodboard_image(
            user_id=user_id,
            project_id=project_id,
            scene_id=scene_id,
            tram_line_id=tram_line_id,
            filename=filename,
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
    db.commit()
    db.refresh(history_row)
    return {
        "success": True,
        "path": path_key,
        "history": {
            "id": str(history_row.id),
            "image_path": history_row.image_path,
            "created_at": history_row.created_at.isoformat() if history_row.created_at else None,
        },
    }
