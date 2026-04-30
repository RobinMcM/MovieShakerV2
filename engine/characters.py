"""
Character CRUD and image upload for Objects page.
Routes: PUT /characters/{id}, DELETE /characters/{id}, POST /api/characters/upload,
POST /api/characters/{id}/generate-image.
"""
import base64
import json
import os
import uuid
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from config import load_settings
from credits import apply_credit_cost, ensure_user_can_generate
from db import get_session
from gateway_client import GatewayClient, GatewayClientError
from models import Character, ProjectMember, Script
from storage import save_character_image
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

router = APIRouter(tags=["characters"])
settings = load_settings()

VALID_VIEW_KEYS: frozenset = frozenset({
    "face_front", "face_side", "face_back",
    "short_front", "short_side", "short_back",
    "full_front", "full_side", "full_back",
    "front", "side", "back",
})


def _parse_object_views(character: "Character") -> dict:
    ov = getattr(character, "object_views", None)
    if not ov:
        return {}
    if isinstance(ov, dict):
        return ov
    try:
        return json.loads(ov)
    except Exception:
        return {}


def _char_to_dict(character: "Character") -> dict:
    return {
        "id": str(character.id),
        "name": character.name,
        "script_id": str(character.script_id),
        "type": getattr(character, "type", "character"),
        "casting_notes": character.casting_notes,
        "character_image_url": character.character_image_url,
        "hide_from_view": character.hide_from_view,
        "aspect_ratio": character.aspect_ratio,
        "series_group": getattr(character, "series_group", None),
        "object_type": getattr(character, "object_type", None),
        "scene_tags": getattr(character, "scene_tags", None),
        "object_views": _parse_object_views(character),
    }


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
    object_type: Optional[str] = None


class GenerateCharacterImageBody(BaseModel):
    prompt: str
    aspect_ratio: Optional[str] = None
    model: Optional[str] = None  # OpenRouter model_key (e.g. "flux-2-pro", "nano-banana")
    dry_run: bool = False


class PatchViewBody(BaseModel):
    view_key: str
    url: str
    is_dynamic: bool = False
    video_url: Optional[str] = None


def _gateway_client() -> GatewayClient:
    return GatewayClient(
        base_url=settings.gateway_base_url,
        api_key=settings.gateway_internal_api_key,
        timeout_seconds=settings.gateway_timeout_seconds,
        verify_tls=settings.gateway_verify_tls,
    )


def _stable_filename(character: Character, fallback_ext: str) -> str:
    existing = (character.character_image_url or "").strip()
    existing_name = os.path.basename(existing)
    if "." in existing_name:
        base, ext = existing_name.rsplit(".", 1)
        ext = ext.lower()
        if base == str(character.id) and ext in {"png", "jpg", "jpeg", "gif", "webp"}:
            return f"{character.id}.{ext}"
    return f"{character.id}.{fallback_ext}"


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
    if body.object_type is not None:
        character.object_type = body.object_type or None
    db.add(character)
    db.commit()
    db.refresh(character)
    return {"success": True, "data": _char_to_dict(character)}


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


@router.patch("/characters/{character_id}/views")
def patch_character_view(
    character_id: str,
    body: PatchViewBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Update a single view within object_views JSONB."""
    if body.view_key not in VALID_VIEW_KEYS:
        raise HTTPException(status_code=400, detail=f"Invalid view_key '{body.view_key}'")
    user_id = session.get_user_id()
    character = _get_character_and_ensure_access(db, character_id, user_id)
    views = _parse_object_views(character)
    views[body.view_key] = {
        "url": body.url,
        "is_dynamic": body.is_dynamic,
        "video_url": body.video_url,
    }
    character.object_views = json.dumps(views)
    db.add(character)
    db.commit()
    db.refresh(character)
    return {"success": True, "data": _char_to_dict(character)}


@router.post("/api/characters/{character_id}/generate-image")
def generate_character_image(
    character_id: str,
    body: GenerateCharacterImageBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    ensure_user_can_generate(db, user_id)
    character = _get_character_and_ensure_access(db, character_id, user_id)
    script = db.get(Script, character.script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")

    aspect_ratio = body.aspect_ratio or character.aspect_ratio or "1:1"
    model_key = body.model or "flux-2-klein"

    gateway = _gateway_client()
    try:
        result = gateway.generate_image(
            prompt=prompt,
            model_key=model_key,
            aspect_ratio=aspect_ratio,
            dry_run=body.dry_run,
        )
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    if body.dry_run:
        return {
            "success": True,
            "data": _char_to_dict(character),
            "credits": {"cost": 1, "balance": None},
            "dry_run": True,
        }

    image_b64 = result.get("image_b64") or ""
    if not image_b64:
        raise HTTPException(status_code=502, detail="Gateway returned no image data")

    try:
        content = base64.b64decode(image_b64)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to decode image: {exc}")

    content_type = result.get("content_type", "image/png").lower()
    if "jpeg" in content_type or "jpg" in content_type:
        ext = "jpg"
    elif "webp" in content_type:
        ext = "webp"
    else:
        ext = "png"

    filename = _stable_filename(character, ext)
    is_scene = getattr(character, "type", None) == "scene"
    try:
        path_key = save_character_image(
            user_id=user_id,
            project_id=str(script.project_id),
            character_id=character_id,
            filename=filename,
            content=BytesIO(content),
            size=len(content),
            is_scene=is_scene,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    character.character_image_url = path_key
    db.add(character)
    balance = apply_credit_cost(db, user_id, 1)
    db.commit()
    db.refresh(character)
    return {
        "success": True,
        "data": _char_to_dict(character),
        "credits": {"cost": 1, "balance": balance},
    }


@router.post("/api/characters/upload")
async def upload_character_image(
    character_id: str = Form(...),
    file: UploadFile = File(...),
    view_key: Optional[str] = Form(None),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Upload image for a character/object. If view_key is set, saves to object_views; otherwise sets character_image_url."""
    user_id = session.get_user_id()
    if view_key and view_key not in VALID_VIEW_KEYS:
        raise HTTPException(status_code=400, detail=f"Invalid view_key '{view_key}'")
    character = _get_character_and_ensure_access(db, character_id, user_id)
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "png"
    if ext not in ("png", "jpg", "jpeg", "gif", "webp"):
        ext = "png"
    filename = f"{character_id}_{view_key}.{ext}" if view_key else f"{character_id}.{ext}"
    content = await file.read()
    size = len(content)
    is_scene = getattr(character, "type", None) == "scene"
    script = db.get(Script, character.script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    try:
        path_key = save_character_image(
            user_id=user_id,
            project_id=str(script.project_id),
            character_id=character_id,
            filename=filename,
            content=BytesIO(content),
            size=size,
            is_scene=is_scene,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    views = _parse_object_views(character)
    if view_key:
        views[view_key] = {"url": path_key, "is_dynamic": False, "video_url": None}
        character.object_views = json.dumps(views)
    else:
        character.character_image_url = path_key
        # Auto-set face_front if it has no image yet
        if not (views.get("face_front") or {}).get("url"):
            views["face_front"] = {"url": path_key, "is_dynamic": False, "video_url": None}
            character.object_views = json.dumps(views)

    db.add(character)
    db.commit()
    db.refresh(character)
    return {
        "success": True,
        "path": path_key,
        "character_image_url": character.character_image_url,
        "object_views": _parse_object_views(character),
    }
