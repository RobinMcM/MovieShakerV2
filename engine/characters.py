"""
Character CRUD and image upload for Objects page.
Routes: PUT /characters/{id}, DELETE /characters/{id}, POST /api/characters/upload.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from db import get_session
from models import Character, ProjectMember, Script
from storage import save_character_image
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

router = APIRouter(tags=["characters"])


def _get_character_and_ensure_access(db: Session, character_id: str, user_id: str) -> Character:
    character = db.get(Character, uuid.UUID(character_id))
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    script = db.get(Script, character.script_id)
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
    return character


class CharacterUpdateBody(BaseModel):
    casting_notes: Optional[str] = None
    aspect_ratio: Optional[str] = None
    hide_from_view: Optional[bool] = None
    character_image_url: Optional[str] = None


@router.put("/characters/{character_id}")
def update_character(
    character_id: str,
    body: CharacterUpdateBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    character = _get_character_and_ensure_access(db, character_id, user_id)
    if body.casting_notes is not None:
        character.casting_notes = body.casting_notes.strip() or None
    if body.aspect_ratio is not None:
        character.aspect_ratio = body.aspect_ratio or None
    if body.hide_from_view is not None:
        character.hide_from_view = body.hide_from_view
    if body.character_image_url is not None:
        character.character_image_url = body.character_image_url or None
    db.add(character)
    db.commit()
    db.refresh(character)
    return {
        "success": True,
        "data": {
            "id": str(character.id),
            "name": character.name,
            "script_id": str(character.script_id),
            "type": getattr(character, "type", "character"),
            "casting_notes": character.casting_notes,
            "character_image_url": character.character_image_url,
            "hide_from_view": character.hide_from_view,
            "aspect_ratio": character.aspect_ratio,
            "series_group": getattr(character, "series_group", None),
        },
    }


@router.delete("/characters/{character_id}")
def delete_character(
    character_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    character = _get_character_and_ensure_access(db, character_id, user_id)
    db.delete(character)
    db.commit()
    return {"success": True, "message": "Deleted"}


@router.post("/api/characters/upload")
async def upload_character_image(
    character_id: str = Form(...),
    file: UploadFile = File(...),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Upload image for a character/object. Returns path to store as character_image_url."""
    user_id = session.get_user_id()
    character = _get_character_and_ensure_access(db, character_id, user_id)
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "png"
    if ext not in ("png", "jpg", "jpeg", "gif", "webp"):
        ext = "png"
    filename = f"{character_id}.{ext}"
    content = await file.read()
    size = len(content)
    is_scene = getattr(character, "type", None) == "scene"
    try:
        from io import BytesIO
        path_key = save_character_image(user_id, character_id, filename, BytesIO(content), size, is_scene=is_scene)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    character.character_image_url = path_key
    db.add(character)
    db.commit()
    return {"success": True, "path": path_key, "character_image_url": path_key}
