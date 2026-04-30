"""
Background image endpoints for the Objects page Backgrounds tab.
Routes: GET /scripts/{script_id}/backgrounds,
        POST /scripts/{script_id}/backgrounds/generate-sketch
"""
import base64
import json
import uuid
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session, select

from characters import _gateway_client, _stable_filename
from config import load_settings
from credits import apply_credit_cost, ensure_user_can_generate
from db import get_session
from gateway_client import GatewayClientError
from models import Character, ProjectMember, Script
from storage import save_character_image
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.session.framework.fastapi import verify_session

router = APIRouter(tags=["backgrounds"])
settings = load_settings()

# Maps project aspect_ratio values to OpenRouter-compatible strings.
FAL_ASPECT_MAP: dict[str, str] = {
    "16:9":   "16:9",
    "9:16":   "9:16",
    "1:1":    "1:1",
    "2.39:1": "21:9",
}

_DIMENSION_MAP: dict[str, dict] = {
    "16:9":   {"width": 1920, "height": 1080},
    "9:16":   {"width": 1080, "height": 1920},
    "1:1":    {"width": 1080, "height": 1080},
    "2.39:1": {"width": 1920, "height": 803},
}


def _aspect_to_dimensions(aspect_ratio: str) -> dict:
    if aspect_ratio in _DIMENSION_MAP:
        return _DIMENSION_MAP[aspect_ratio]
    try:
        w_str, h_str = aspect_ratio.split(":")
        ratio = float(w_str) / float(h_str)
        base = 1920
        return {"width": base, "height": round(base / ratio)}
    except Exception:
        return {"width": 1920, "height": 1080}


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


def _derive_int_ext(location_name: str) -> str:
    upper = (location_name or "").strip().upper()
    if upper.startswith("INT"):
        return "INT"
    if upper.startswith("EXT"):
        return "EXT"
    return "INT"


def _build_sketch_prompt(location_name: str, int_ext: str) -> str:
    if int_ext == "EXT":
        scene_desc = (
            f"Exterior environment, suggest sky, ground, horizon appropriate for {location_name}"
        )
    else:
        scene_desc = (
            f"Interior space, suggest walls, ceiling, furniture or set pieces appropriate for {location_name}"
        )
    return (
        "Simple pencil sketch of a film set background environment. "
        "Hand-drawn style, rough gestural lines, black pencil on white paper. "
        "Film production storyboard aesthetic. No colour, no shading.\n\n"
        f"Location: {int_ext}. {location_name}\n"
        f"{scene_desc}\n\n"
        "Wide establishing shot composition. "
        "Empty of characters — background only. "
        "Sketch fills the frame."
    )


def _find_background_for_location(characters: list, location_name: str) -> Optional[Character]:
    upper = location_name.strip().upper()
    return next((c for c in characters if (c.name or "").strip().upper() == upper), None)


class GenerateSketchBody(BaseModel):
    location_name: str
    location_type: Optional[str] = None  # INT | EXT — inferred from location_name if omitted
    scene_numbers: Optional[list[int]] = None
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

    # Fetch unique locations from scenes with aggregated scene numbers
    rows = db.execute(
        text("""
            SELECT scene_location,
                   array_agg(scene_number ORDER BY scene_number) AS scene_numbers
            FROM scenes
            WHERE script_id = :script_id
              AND scene_location IS NOT NULL
            GROUP BY scene_location
            ORDER BY scene_location
        """),
        {"script_id": str(uuid.UUID(script_id))},
    ).fetchall()

    # Load all background characters for this script once
    bg_chars = list(
        db.exec(
            select(Character).where(
                Character.script_id == uuid.UUID(script_id),
                Character.object_type == "background",
            )
        ).all()
    )

    result = []
    for row in rows:
        loc_name = row[0]
        scene_nums = [n for n in (row[1] or []) if n is not None]
        bg = _find_background_for_location(bg_chars, loc_name)
        result.append({
            "location_name": loc_name,
            "location_type": _derive_int_ext(loc_name),
            "scene_numbers": scene_nums,
            "background_id": str(bg.id) if bg else None,
            "image_url": bg.character_image_url if bg else None,
            "has_background": bg is not None and bool(bg.character_image_url),
        })

    return {"success": True, "data": result}


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
    script = _get_script_and_ensure_access(db, script_id, user_id)

    location_name = (body.location_name or "").strip()
    if not location_name:
        raise HTTPException(status_code=400, detail="location_name is required")
    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")

    int_ext = ((body.location_type or "").strip().upper() or _derive_int_ext(location_name))
    prompt = _build_sketch_prompt(location_name, int_ext)
    scene_numbers = body.scene_numbers or []

    # Read aspect ratio from project settings — never hardcode or ask the user
    ar_row = db.execute(
        text("SELECT aspect_ratio FROM project WHERE id = :pid"),
        {"pid": str(script.project_id)},
    ).fetchone()
    aspect_ratio = FAL_ASPECT_MAP.get(ar_row[0] if ar_row else "16:9", "16:9")

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
            "location_name": location_name,
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

    # Upsert background character — find existing by name match, else create
    bg_chars = list(
        db.exec(
            select(Character).where(
                Character.script_id == uuid.UUID(script_id),
                Character.object_type == "background",
            )
        ).all()
    )
    character = _find_background_for_location(bg_chars, location_name)

    if character is None:
        character = Character(
            script_id=uuid.UUID(script_id),
            user_id=user_id,
            name=location_name,
            type="object",
            object_type="background",
            aspect_ratio=aspect_ratio,
            scene_tags=json.dumps(scene_numbers),
        )
        db.add(character)
        db.flush()

    filename = _stable_filename(character, ext)
    try:
        path_key = save_character_image(
            user_id=user_id,
            project_id=str(script.project_id),
            character_id=str(character.id),
            filename=filename,
            content=BytesIO(content),
            size=len(content),
            is_scene=False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    character.character_image_url = path_key
    if scene_numbers:
        character.scene_tags = json.dumps(scene_numbers)
    db.add(character)
    balance = apply_credit_cost(db, user_id, 1)
    db.commit()
    db.refresh(character)

    return {
        "success": True,
        "character_id": str(character.id),
        "image_url": character.character_image_url,
        "location_name": location_name,
        "pass": 1,
        "credits": {"cost": 1, "balance": balance},
    }
