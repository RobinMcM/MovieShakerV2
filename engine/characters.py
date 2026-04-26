"""
Character CRUD and image upload for Objects page.
Routes: PUT /characters/{id}, DELETE /characters/{id}, POST /api/characters/upload,
POST /api/characters/{id}/generate-image.
"""
import os
import time
import uuid
import json
from typing import Optional
from urllib.parse import urlparse
import base64

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
import httpx
from pydantic import BaseModel
from sqlmodel import Session, select

from config import load_settings
from credits import apply_credit_cost, ensure_user_can_generate, extract_credit_cost
from db import get_session
from gateway_client import GatewayClient, GatewayClientError
from model_catalog import (
    MEDIA_IMAGE,
    PURPOSE_OBJECT_IMAGE,
    build_model_catalog,
    find_model,
    model_supports_media_type,
)
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
    object_type: Optional[str] = None


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


def _image_model_catalog(client: GatewayClient) -> dict[str, list[dict]]:
    return build_model_catalog(
        object_image_gateway_models=client.get_object_image_models()
    )


def _resolve_image_model_id(
    *,
    catalog: dict[str, list[dict]],
    explicit_model: Optional[str],
) -> Optional[str]:
    candidate = (explicit_model or "").strip()
    if candidate:
        model = find_model(catalog, candidate)
        if not model:
            raise HTTPException(
                status_code=400,
                detail=f"Model '{candidate}' is not available for selection.",
            )
        if not model_supports_media_type(model, MEDIA_IMAGE):
            raise HTTPException(
                status_code=400,
                detail=f"Model '{candidate}' does not support media_type '{MEDIA_IMAGE}'.",
            )
        if str(model.get("status") or "active").strip().lower() not in {"active", "beta"}:
            raise HTTPException(
                status_code=400,
                detail=f"Model '{candidate}' is not active.",
            )
        return candidate

    for item in catalog.get(PURPOSE_OBJECT_IMAGE, []):
        if str(item.get("default_for_media_type") or "").strip().lower() == MEDIA_IMAGE:
            return str(item.get("id") or "").strip() or None
    return None


def _gateway_execute_body(
    *,
    media_type: str,
    payload: dict,
    model: Optional[str],
    dry_run: bool,
) -> dict:
    body = {
        "provider": "fal",
        "media_type": media_type,
        "payload": payload,
        "dry_run": dry_run,
    }
    if model:
        body["model"] = model
    return body


def _extract_generated_image_url(response: dict) -> Optional[str]:
    def walk(node) -> Optional[str]:
        if isinstance(node, str):
            value = node.strip()
            if value.startswith("http://") or value.startswith("https://") or value.startswith("data:image/"):
                return value
            return None
        if isinstance(node, dict):
            for key in ("image_url", "url", "output_url", "download_url", "file_url"):
                value = node.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
            files = node.get("files")
            if isinstance(files, list):
                for item in files:
                    found = walk(item)
                    if found:
                        return found
            for value in node.values():
                found = walk(value)
                if found:
                    return found
        if isinstance(node, list):
            for value in node:
                found = walk(value)
                if found:
                    return found
        return None

    if not isinstance(response, dict):
        return None
    found = walk(response)
    if isinstance(found, str) and found.strip():
        return found.strip()
    return None


def _extract_generated_image_bytes(response: dict) -> tuple[Optional[bytes], Optional[str]]:
    def decode_data_url(value: str) -> tuple[Optional[bytes], Optional[str]]:
        if not value.startswith("data:image/") or ";base64," not in value:
            return None, None
        header, b64 = value.split(";base64,", 1)
        ext = header.replace("data:image/", "").strip().lower()
        if ext == "jpeg":
            ext = "jpg"
        if ext not in {"png", "jpg", "gif", "webp"}:
            ext = "png"
        try:
            return base64.b64decode(b64), ext
        except Exception:
            return None, None

    def walk(node) -> tuple[Optional[bytes], Optional[str]]:
        if isinstance(node, str):
            value = node.strip()
            decoded, ext = decode_data_url(value)
            if decoded:
                return decoded, ext
            return None, None
        if isinstance(node, dict):
            for key in ("b64_json", "image_base64", "base64", "b64"):
                value = node.get(key)
                if isinstance(value, str) and value.strip():
                    try:
                        return base64.b64decode(value), None
                    except Exception:
                        pass
            for key in ("image", "data"):
                value = node.get(key)
                if isinstance(value, str) and value.strip():
                    decoded, ext = decode_data_url(value.strip())
                    if decoded:
                        return decoded, ext
            for value in node.values():
                content, ext = walk(value)
                if content:
                    return content, ext
        elif isinstance(node, list):
            for value in node:
                content, ext = walk(value)
                if content:
                    return content, ext
        return None, None

    if not isinstance(response, dict):
        return None, None
    return walk(response)


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


def _resolve_image_url_from_gateway(
    client: GatewayClient,
    first_response: dict,
) -> tuple[Optional[str], dict]:
    image_url = _extract_generated_image_url(first_response)
    if image_url:
        return image_url, first_response

    job_id = first_response.get("job_id")
    if not isinstance(job_id, str) or not job_id.strip():
        return None, first_response

    deadline = time.monotonic() + max(10.0, settings.gateway_timeout_seconds * 2)
    latest_response = first_response
    while time.monotonic() < deadline:
        try:
            latest_response = client.get_status(job_id)
        except GatewayClientError:
            break

        status = str(latest_response.get("job_status") or "").strip().lower()
        image_url = _extract_generated_image_url(latest_response)
        if image_url:
            return image_url, latest_response
        if status in {"failed", "error", "cancelled"}:
            return None, latest_response
        if status in {"completed", "succeeded", "done"}:
            return None, latest_response
        time.sleep(1.0)

    return None, latest_response


def _gateway_debug_hint(payload: dict) -> str:
    if not isinstance(payload, dict):
        return "response_not_dict"
    keys = sorted(list(payload.keys()))
    job_id = payload.get("job_id")
    job_status = payload.get("job_status")
    result = payload.get("result")
    result_type = type(result).__name__
    return (
        f"keys={keys}, "
        f"job_id={job_id if isinstance(job_id, str) else 'none'}, "
        f"job_status={job_status if isinstance(job_status, str) else 'none'}, "
        f"result_type={result_type}"
    )


def _should_fallback_to_default_model(error_text: str) -> bool:
    text = (error_text or "").lower()
    fallback_markers = (
        "not in allowlist",
        "model not allowed",
        "unknown media_type",
        "unknown model",
        "invalid model",
        "unsupported model",
    )
    return any(marker in text for marker in fallback_markers)


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
            "object_type": getattr(character, "object_type", None),
            "scene_tags": getattr(character, "scene_tags", None),
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

    payload: dict = {
        "prompt": prompt,
        "aspect_ratio": (body.aspect_ratio or character.aspect_ratio or "1:1"),
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
        print(f"[characters.generate-image] gateway execute body: {json.dumps(request_body, ensure_ascii=False)}")
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
        # If profile-selected model is invalid/unavailable, try gateway default route.
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
                detail=f"Selected image model '{selected_model}' is unavailable and default fallback failed: {error_text}",
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
    is_scene = getattr(character, "type", None) == "scene"
    try:
        from io import BytesIO

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
        "gateway": {
            "request_body": request_body,
            "model_used": selected_model,
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
    script = db.get(Script, character.script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    try:
        from io import BytesIO
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
    character.character_image_url = path_key
    db.add(character)
    db.commit()
    return {"success": True, "path": path_key, "character_image_url": path_key}
