"""
Character CRUD and image upload for Objects page.
Routes: PUT /characters/{id}, DELETE /characters/{id}, POST /api/characters/upload,
POST /api/characters/{id}/generate-image.
"""
import os
import uuid
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
import httpx
from pydantic import BaseModel
from sqlmodel import Session, select

from config import load_settings
from credits import apply_credit_cost, ensure_user_can_generate, extract_credit_cost
from db import get_session
from gateway_client import GatewayClient, GatewayClientError
from models import Character, ProjectMember, Script
from storage import save_character_image
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

router = APIRouter(tags=["characters"])
settings = load_settings()


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


class GenerateCharacterImageBody(BaseModel):
    prompt: str
    aspect_ratio: Optional[str] = None
    model: Optional[str] = None
    dry_run: bool = False


def _gateway_client() -> GatewayClient:
    return GatewayClient(
        base_url=settings.gateway_base_url,
        api_key=settings.gateway_internal_api_key,
        timeout_seconds=settings.gateway_timeout_seconds,
        verify_tls=settings.gateway_verify_tls,
    )


def _extract_generated_image_url(response: dict) -> Optional[str]:
    if not isinstance(response, dict):
        return None
    result = response.get("result")
    if isinstance(result, dict):
        files = result.get("files")
        if isinstance(files, list):
            for item in files:
                if isinstance(item, dict):
                    value = item.get("url") or item.get("download_url") or item.get("file_url")
                    if isinstance(value, str) and value.strip():
                        return value.strip()
        for key in ("image_url", "url", "output_url"):
            value = result.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    for key in ("image_url", "url", "output_url"):
        value = response.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _detect_ext(image_url: str, content_type: Optional[str]) -> str:
    if content_type:
        lowered = content_type.lower()
        if "png" in lowered:
            return "png"
        if "webp" in lowered:
            return "webp"
        if "gif" in lowered:
            return "gif"
        if "jpeg" in lowered or "jpg" in lowered:
            return "jpg"
    path = urlparse(image_url).path or ""
    _, dot, ext = path.rpartition(".")
    ext = ext.lower()
    if dot and ext in {"png", "jpg", "jpeg", "gif", "webp"}:
        return "jpg" if ext == "jpeg" else ext
    return "png"


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


@router.post("/api/characters/{character_id}/generate-image")
def generate_character_image(
    character_id: str,
    body: GenerateCharacterImageBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = ensure_user_can_generate(db, user_id)
    character = _get_character_and_ensure_access(db, character_id, user_id)

    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")

    selected_model = (body.model or profile.model_object_image or "").strip() or None
    payload: dict = {
        "prompt": prompt,
        "aspect_ratio": (body.aspect_ratio or character.aspect_ratio or "1:1"),
    }
    try:
        response = _gateway_client().execute_fal(
            media_type="image-generation",
            payload=payload,
            model=selected_model,
            dry_run=body.dry_run,
        )
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    image_url = _extract_generated_image_url(response)
    if not image_url:
        raise HTTPException(status_code=502, detail="Gateway did not return an image URL")

    try:
        downloaded = httpx.get(image_url, timeout=settings.gateway_timeout_seconds)
        downloaded.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to download generated image: {exc}")

    content = downloaded.content
    ext = _detect_ext(image_url, downloaded.headers.get("content-type"))
    filename = _stable_filename(character, ext)
    is_scene = getattr(character, "type", None) == "scene"
    try:
        from io import BytesIO

        path_key = save_character_image(
            user_id, character_id, filename, BytesIO(content), len(content), is_scene=is_scene
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    character.character_image_url = path_key
    db.add(character)
    credits_cost = extract_credit_cost(response)
    balance = apply_credit_cost(db, user_id, credits_cost)
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
        "credits": {
            "cost": credits_cost,
            "balance": balance,
        },
    }


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
