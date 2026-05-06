"""
Tram Lines API: CRUD for shot coverage markers (tramlines) per scene.
Prefix: /api/tram-lines. Matches legacy client paths.
"""
import io
import json
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from db import get_session
from models import ProjectMember, Scene, Script, TramLine
from script_parser import document_to_bytes
from storage import (
    get_script_file_stream,
    relative_file_path,
    save_script_file,
    script_json_path,
    uses_spaces,
)
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

router = APIRouter(prefix="/api/tram-lines", tags=["tram-lines"])


def _ensure_scene_access(db: Session, scene_id: str, user_id: str) -> Scene:
    scene = db.get(Scene, uuid.UUID(scene_id))
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
    return scene


def _tram_line_to_shot(line: TramLine, now_iso: str) -> dict:
    """Convert a TramLine DB row to a shot embed dict for script.json."""
    start_id, end_id, start_text, end_text = "", "", "", ""
    if line.script_elements:
        try:
            els = json.loads(line.script_elements)
            if isinstance(els, list) and els:
                start_id = els[0].get("element_id") or ""
                start_text = els[0].get("text") or ""
                end_id = els[-1].get("element_id") or ""
                end_text = els[-1].get("text") or ""
        except Exception:
            pass

    chars: list[str] = []
    if line.character_names:
        chars = [c.strip() for c in line.character_names.split(",") if c.strip()]

    return {
        "id": str(line.id),
        "line_number": line.line_number,
        "shot_type": line.shot_type,
        "camera_direction": line.camera_direction or "",
        "color": line.color or "",
        "characters": chars,
        "start_element_id": start_id,
        "end_element_id": end_id,
        "start_element_text": start_text,
        "end_element_text": end_text,
        "scene_mood": line.scene_mood or "",
        "scene_visual": line.scene_visual or "",
        "x_position": line.x_position,
        "embedded_at": now_iso,
    }


def _sync_shots_to_script_json(db: Session, scene_id: uuid.UUID) -> None:
    """
    Re-embed all tram lines for this scene into the shots[] array on the
    matching scene_heading element in script.json. Called after every
    tram line create/update/delete. Fails silently.
    """
    try:
        scene = db.get(Scene, scene_id)
        if scene is None:
            return
        script = db.get(Script, scene.script_id)
        if script is None:
            return

        json_key = relative_file_path(
            script.user_id, str(script.project_id), str(script.id), "script.json"
        )
        if uses_spaces():
            result = get_script_file_stream(json_key)
            if result is None:
                return
            body, _ = result
        else:
            path = script_json_path(
                script.user_id, str(script.project_id), str(script.id)
            )
            if not path.exists():
                return
            body = path.read_bytes()

        data = json.loads(body.decode("utf-8", errors="replace"))
        elements = data.get("elements")
        if not isinstance(elements, list):
            return

        tram_lines = list(
            db.exec(
                select(TramLine)
                .where(TramLine.scene_id == scene_id)
                .order_by(TramLine.x_position)
            ).all()
        )

        now_iso = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        for el in elements:
            if (
                el.get("type") == "scene_heading"
                and el.get("scene_number") == scene.scene_number
            ):
                el["shots"] = [_tram_line_to_shot(tl, now_iso) for tl in tram_lines]
                break

        json_bytes = document_to_bytes(data)
        save_script_file(
            script.user_id,
            str(script.project_id),
            str(script.id),
            "script.json",
            io.BytesIO(json_bytes),
            len(json_bytes),
        )
    except Exception:
        pass  # Never break the API response if storage is unavailable


def _ensure_tramline_access(db: Session, tramline_id: str, user_id: str) -> TramLine:
    line = db.get(TramLine, uuid.UUID(tramline_id))
    if not line:
        raise HTTPException(status_code=404, detail="Tram line not found")
    _ensure_scene_access(db, str(line.scene_id), user_id)
    return line


class CreateTramLineBody(BaseModel):
    scene_id: str
    line_number: str
    color: Optional[str] = None
    start_y: float = 0.0
    end_y: float = 5.0
    x_position: float = 20.0
    camera_direction: Optional[str] = None
    shot_type: Optional[str] = None


class UpdateTramLineBody(BaseModel):
    line_number: Optional[str] = None
    color: Optional[str] = None
    start_y: Optional[float] = None
    end_y: Optional[float] = None
    x_position: Optional[float] = None
    camera_direction: Optional[str] = None
    shot_type: Optional[str] = None
    action_text: Optional[str] = None
    character_names: Optional[str] = None
    script_elements: Optional[List[Any]] = None
    scene_visual: Optional[str] = None


def _row_to_response(row: TramLine, scene: Optional[Scene] = None) -> dict:
    out = {
        "id": str(row.id),
        "scene_id": str(row.scene_id),
        "line_number": row.line_number,
        "color": row.color or "",
        "start_y": row.start_y,
        "end_y": row.end_y,
        "x_position": row.x_position,
        "camera_direction": row.camera_direction or "",
        "shot_type": row.shot_type,
        "action_text": row.action_text,
        "scene_mood": row.scene_mood,
        "scene_visual": row.scene_visual,
    }
    if row.script_elements:
        try:
            out["script_elements"] = json.loads(row.script_elements)
        except Exception:
            out["script_elements"] = None
    if row.character_names is not None:
        out["character_names"] = row.character_names
    if scene is not None:
        out["scenes"] = {
            "id": str(scene.id),
            "heading": scene.heading,
            "scene_number": scene.scene_number,
            "page_number": scene.page_number or "",
            "script_id": str(scene.script_id),
        }
    return out


@router.get("")
def list_tram_lines(
    scene_id: Optional[str] = Query(None, alias="scene_id"),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    if not scene_id:
        raise HTTPException(
            status_code=400,
            detail="scene_id query parameter is required",
        )
    user_id = session.get_user_id()
    _ensure_scene_access(db, scene_id, user_id)
    rows = list(
        db.exec(
            select(TramLine).where(TramLine.scene_id == uuid.UUID(scene_id)).order_by(TramLine.created_at)
        ).all()
    )
    return {"success": True, "data": [_row_to_response(r) for r in rows]}


@router.post("")
def create_tram_line(
    body: CreateTramLineBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_scene_access(db, body.scene_id, user_id)
    line = TramLine(
        scene_id=uuid.UUID(body.scene_id),
        user_id=user_id,
        line_number=body.line_number,
        color=body.color,
        start_y=body.start_y,
        end_y=body.end_y,
        x_position=body.x_position,
        camera_direction=body.camera_direction,
        shot_type=body.shot_type,
    )
    db.add(line)
    db.commit()
    db.refresh(line)
    _sync_shots_to_script_json(db, line.scene_id)
    return {"success": True, "tramLine": _row_to_response(line)}


@router.put("/{tramline_id}")
def update_tram_line(
    tramline_id: str,
    body: UpdateTramLineBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    line = _ensure_tramline_access(db, tramline_id, user_id)
    updates = body.model_dump(exclude_unset=True)
    if "script_elements" in updates and updates["script_elements"] is not None:
        updates["script_elements"] = json.dumps(updates["script_elements"])
    for key, value in updates.items():
        if hasattr(line, key):
            setattr(line, key, value)
    db.add(line)
    db.commit()
    db.refresh(line)
    _sync_shots_to_script_json(db, line.scene_id)
    return {"success": True, "tramLine": _row_to_response(line)}


@router.delete("/{tramline_id}")
def delete_tram_line(
    tramline_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    line = _ensure_tramline_access(db, tramline_id, user_id)
    scene_id = line.scene_id
    db.delete(line)
    db.commit()
    _sync_shots_to_script_json(db, scene_id)
    return {"success": True, "message": "Tram line deleted"}
