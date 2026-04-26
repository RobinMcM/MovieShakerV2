"""
Background image endpoints for the Objects page Backgrounds tab.
Routes: GET /scripts/{script_id}/backgrounds,
        POST /scripts/{script_id}/backgrounds/generate-sketch
"""
import uuid
from io import BytesIO
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from characters import (
    _detect_ext,
    _extract_generated_image_bytes,
    _gateway_client,
    _gateway_execute_body,
    _get_character_and_ensure_access,
    _image_model_catalog,
    _resolve_image_model_id,
    _resolve_image_url_from_gateway,
    _should_fallback_to_default_model,
    _stable_filename,
    _gateway_debug_hint,
)
from config import load_settings
from credits import apply_credit_cost, ensure_user_can_generate, extract_credit_cost
from db import get_session
from gateway_client import GatewayClientError
from models import Character, ProjectMember, Script
from storage import save_character_image
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.session.framework.fastapi import verify_session

router = APIRouter(tags=["backgrounds"])
settings = load_settings()


def _get_script_and_ensure_access(db: Session, script_id: str, user_id: str) -> Script:
    script = db.get(Script, uuid.UUID(script_id))
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
    return script


class BackgroundResponse(BaseModel):
    id: str
    name: str
    script_id: str
    object_type: Optional[str] = None
    casting_notes: Optional[str] = None
    character_image_url: Optional[str] = None
    hide_from_view: Optional[bool] = None
    aspect_ratio: Optional[str] = None
    scene_tags: Optional[str] = None


class GenerateSketchBody(BaseModel):
    character_id: str
    prompt: str
    aspect_ratio: Optional[str] = None
    model: Optional[str] = None
    dry_run: bool = False


# GET /scripts/{script_id}/backgrounds
@router.get("/scripts/{script_id}/backgrounds")
def get_script_backgrounds(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)
    stmt = (
        select(Character)
        .where(
            Character.script_id == uuid.UUID(script_id),
            Character.object_type == "background",
        )
        .order_by(Character.name.asc())
    )
    characters = list(db.exec(stmt).all())
    data = [
        BackgroundResponse(
            id=str(c.id),
            name=c.name,
            script_id=str(c.script_id),
            object_type=getattr(c, "object_type", None),
            casting_notes=getattr(c, "casting_notes", None),
            character_image_url=getattr(c, "character_image_url", None),
            hide_from_view=getattr(c, "hide_from_view", False),
            aspect_ratio=getattr(c, "aspect_ratio", None),
            scene_tags=getattr(c, "scene_tags", None),
        )
        for c in characters
    ]
    return {"success": True, "data": data}


# POST /scripts/{script_id}/backgrounds/generate-sketch
@router.post("/scripts/{script_id}/backgrounds/generate-sketch")
def generate_background_sketch(
    script_id: str,
    body: GenerateSketchBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    ensure_user_can_generate(db, user_id)
    _get_script_and_ensure_access(db, script_id, user_id)
    character = _get_character_and_ensure_access(db, body.character_id, user_id)
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

    payload: dict = {
        "prompt": prompt,
        "aspect_ratio": (body.aspect_ratio or character.aspect_ratio or "16:9"),
    }
    gateway = _gateway_client()
    catalog = _image_model_catalog(gateway)
    selected_model = _resolve_image_model_id(
        catalog=catalog,
        explicit_model=(body.model or None),
    )
    try:
        request_body = _gateway_execute_body(
            media_type="image-generation",
            payload=payload,
            model=selected_model,
            dry_run=body.dry_run,
        )
        response = gateway.execute_fal(
            media_type="image-generation",
            payload=payload,
            model=selected_model,
            dry_run=body.dry_run,
        )
    except GatewayClientError as exc:
        error_text = str(exc)
        if not selected_model:
            raise HTTPException(status_code=502, detail=error_text)
        if not _should_fallback_to_default_model(error_text):
            raise HTTPException(status_code=502, detail=error_text)
        try:
            response = gateway.execute_fal(
                media_type="image-generation",
                payload=payload,
                model=None,
                dry_run=body.dry_run,
            )
        except GatewayClientError:
            raise HTTPException(
                status_code=502,
                detail=f"Selected model '{selected_model}' is unavailable and default fallback failed: {error_text}",
            )

    image_url, final_gateway_response = _resolve_image_url_from_gateway(gateway, response)
    content = None
    ext = None

    if image_url:
        if image_url.startswith("data:image/"):
            decoded, decoded_ext = _extract_generated_image_bytes({"image": image_url})
            content = decoded
            ext = decoded_ext
        else:
            try:
                downloaded = httpx.get(
                    image_url,
                    timeout=settings.gateway_timeout_seconds,
                    follow_redirects=True,
                    headers={"User-Agent": "MovieShakerEngine/1.0"},
                )
                downloaded.raise_for_status()
                content = downloaded.content
                ext = _detect_ext(image_url, downloaded.headers.get("content-type"))
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"Failed to download generated image: {exc}")
    else:
        decoded, decoded_ext = _extract_generated_image_bytes(
            final_gateway_response if isinstance(final_gateway_response, dict) else {}
        )
        content = decoded
        ext = decoded_ext
        if not content:
            error_message = final_gateway_response.get("error") if isinstance(final_gateway_response, dict) else None
            if isinstance(error_message, str) and error_message.strip():
                raise HTTPException(status_code=502, detail=f"Image generation failed: {error_message.strip()}")
            hint = _gateway_debug_hint(final_gateway_response if isinstance(final_gateway_response, dict) else {})
            raise HTTPException(status_code=502, detail=f"Gateway did not return image output ({hint})")

    ext = ext or "png"
    filename = _stable_filename(character, ext)
    try:
        path_key = save_character_image(
            user_id=user_id,
            project_id=str(script.project_id),
            character_id=body.character_id,
            filename=filename,
            content=BytesIO(content),
            size=len(content),
            is_scene=False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    character.character_image_url = path_key
    db.add(character)
    credits_cost = extract_credit_cost(final_gateway_response if isinstance(final_gateway_response, dict) else response)
    balance = apply_credit_cost(db, user_id, credits_cost)
    db.commit()
    db.refresh(character)
    return {
        "success": True,
        "data": {
            "id": str(character.id),
            "name": character.name,
            "script_id": str(character.script_id),
            "object_type": getattr(character, "object_type", None),
            "casting_notes": character.casting_notes,
            "character_image_url": character.character_image_url,
            "hide_from_view": character.hide_from_view,
            "aspect_ratio": character.aspect_ratio,
            "scene_tags": getattr(character, "scene_tags", None),
        },
        "credits": {
            "cost": credits_cost,
            "balance": balance,
        },
        "gateway": {
            "request_body": request_body,
            "model_used": selected_model,
        },
    }
