"""
CoProducer moodboard generation.
POST /scripts/{script_id}/scenes/{scene_number}/generate-moodboard

Generates AI images for every shot (tram line) in a scene, writes each
image to storage, upserts the first MoodBoardComposition for the tram line,
and updates tram_line.scene_visual.
"""
import json
import logging
import time
import uuid
from datetime import datetime
from io import BytesIO
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlmodel import Session, select

from config import load_settings
from credits import apply_credit_cost, ensure_user_can_generate
from db import get_session
from gateway_client import GatewayClient, GatewayClientError
from models import MoodBoardComposition, ProjectMember, Script, TramLine
from storage import save_moodboard_image
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.session.framework.fastapi import verify_session

router = APIRouter(tags=["moodboard"])
logger = logging.getLogger(__name__)
settings = load_settings()


def _gateway_client() -> GatewayClient:
    return GatewayClient(
        base_url=settings.gateway_base_url,
        api_key=settings.gateway_internal_api_key,
        timeout_seconds=settings.gateway_timeout_seconds,
        verify_tls=settings.gateway_verify_tls,
    )


def _extract_image_url(node) -> Optional[str]:
    if isinstance(node, str):
        v = node.strip()
        if v.startswith(("http://", "https://", "data:image/")):
            return v
        return None
    if isinstance(node, dict):
        for key in ("image_url", "url", "output_url", "download_url", "file_url"):
            v = node.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
        files = node.get("files")
        if isinstance(files, list):
            for item in files:
                found = _extract_image_url(item)
                if found:
                    return found
        for v in node.values():
            found = _extract_image_url(v)
            if found:
                return found
    if isinstance(node, list):
        for v in node:
            found = _extract_image_url(v)
            if found:
                return found
    return None


def _resolve_image_url(client: GatewayClient, first_response: dict) -> Optional[str]:
    """Return image URL from response, polling async jobs if needed."""
    url = _extract_image_url(first_response)
    if url:
        return url
    job_id = first_response.get("job_id")
    if not isinstance(job_id, str) or not job_id.strip():
        return None
    deadline = time.monotonic() + max(10.0, settings.gateway_timeout_seconds * 2)
    latest = first_response
    while time.monotonic() < deadline:
        try:
            latest = client.get_status(job_id)
        except GatewayClientError:
            break
        url = _extract_image_url(latest)
        if url:
            return url
        status = str(latest.get("job_status") or "").lower()
        if status in {"failed", "error", "cancelled", "completed", "succeeded", "done"}:
            break
        time.sleep(1.0)
    return None


def _extract_text_from_response(response: dict) -> Optional[str]:
    """Extract plain text from a gateway execute_text response."""
    result = response.get("result") or response
    if isinstance(result, dict):
        choices = result.get("choices")
        if isinstance(choices, list) and choices:
            msg = choices[0].get("message") or {}
            text_val = msg.get("content")
            if isinstance(text_val, str) and text_val.strip():
                return text_val.strip()
        for key in ("content", "text", "output"):
            v = result.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    output = response.get("output")
    if isinstance(output, str) and output.strip():
        return output.strip()
    return None


def _generate_shot_image(
    tram_line: TramLine,
    character_images: dict,
    background_url: Optional[str],
    props: list,
    scene: dict,
    gateway: GatewayClient,
    text_model: str,
    image_model: Optional[str],
) -> Optional[str]:
    """
    Build an AI prompt for a shot then call FAL for the image.
    Returns image URL on success, None on any failure (caller skips the shot).
    """
    char_names = (tram_line.character_names or "").strip()

    user_msg = (
        "Write a FAL.ai image generation prompt for this film shot:\n\n"
        f"Scene: {scene.get('heading', '')}\n"
        f"Shot type: {tram_line.shot_type or 'MS'}\n"
        f"Camera direction: {tram_line.camera_direction or ''}\n"
        f"Characters in frame: {char_names}\n"
        f"Location: {scene.get('scene_location', '')} ({scene.get('location_type', '')})\n\n"
        "Rules:\n"
        "- Start with the shot type and framing\n"
        "- Describe the location atmosphere\n"
        "- Describe character positions and expressions\n"
        "- End with: cinematic photography, film grain, professional lighting, photorealistic\n"
        "- Maximum 100 words\n"
        "- No character names — describe appearance only"
    )

    prompt: Optional[str] = None
    try:
        text_resp = gateway.execute_text(
            model=text_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a cinematography prompt writer for AI image generation. "
                        "Write precise, visual prompts for FAL.ai image generation. "
                        "Return ONLY the prompt string. No explanation."
                    ),
                },
                {"role": "user", "content": user_msg},
            ],
        )
        prompt = _extract_text_from_response(text_resp)
    except Exception as exc:
        logger.warning("Prompt generation failed for tram line %s: %s", tram_line.id, exc)

    if not prompt:
        prompt = (
            f"{tram_line.shot_type or 'Medium shot'}, {scene.get('heading', '')}, "
            "cinematic photography, film grain, professional lighting, photorealistic"
        )

    try:
        response = gateway.execute_fal(
            media_type="image-generation",
            payload={"prompt": prompt, "aspect_ratio": "16:9"},
            model=image_model,
            dry_run=False,
        )
        return _resolve_image_url(gateway, response)
    except Exception as exc:
        logger.warning("Image generation failed for tram line %s: %s", tram_line.id, exc)
        return None


@router.post("/scripts/{script_id}/scenes/{scene_number}/generate-moodboard")
def generate_scene_moodboard(
    script_id: str,
    scene_number: int,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()

    # Verify script + project membership
    try:
        script_uuid = uuid.UUID(script_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid script_id")
    script = db.get(Script, script_uuid)
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

    # Fetch scene
    scene_row = db.execute(
        text(
            "SELECT id, scene_number, scene_location, location_type, heading "
            "FROM scenes "
            "WHERE script_id = :script_id AND scene_number = :scene_number"
        ),
        {"script_id": script_uuid, "scene_number": scene_number},
    ).first()
    if not scene_row:
        raise HTTPException(status_code=404, detail="Scene not found")

    scene = {
        "id": str(scene_row[0]),
        "scene_number": scene_row[1],
        "scene_location": scene_row[2] or "",
        "location_type": scene_row[3] or "",
        "heading": scene_row[4] or "",
    }

    # Fetch tram lines for this scene
    tram_lines = list(
        db.exec(
            select(TramLine)
            .where(TramLine.scene_id == scene_row[0])
            .order_by(TramLine.created_at)
        ).all()
    )
    if not tram_lines:
        raise HTTPException(
            status_code=400,
            detail="No shot list found for this scene. Please generate shots first.",
        )

    # Collect unique character names across all tram lines
    all_names: set[str] = set()
    for tl in tram_lines:
        if tl.character_names:
            for n in tl.character_names.split(","):
                n = n.strip()
                if n:
                    all_names.add(n.upper())

    # Fetch character reference images
    character_images: dict[str, str] = {}
    for name in all_names:
        row = db.execute(
            text(
                "SELECT name, character_image_url FROM characters "
                "WHERE script_id = :script_id AND UPPER(name) = :name "
                "AND character_image_url IS NOT NULL AND character_image_url != '' "
                "LIMIT 1"
            ),
            {"script_id": script_uuid, "name": name},
        ).first()
        if row:
            character_images[name] = row[1]

    # Fetch background image for this location/scene
    background_url: Optional[str] = None
    scene_num_json = json.dumps([scene_number])
    location_pattern = f"%{scene['scene_location']}%" if scene["scene_location"] else "%%"
    bg_row = db.execute(
        text(
            "SELECT character_image_url FROM characters "
            "WHERE script_id = :script_id AND object_type = 'background' "
            "AND (scene_tags = '[]'::jsonb OR scene_tags @> :scene_num_arr::jsonb) "
            "ORDER BY CASE WHEN name ILIKE :location_name THEN 0 ELSE 1 END "
            "LIMIT 1"
        ),
        {
            "script_id": script_uuid,
            "scene_num_arr": scene_num_json,
            "location_name": location_pattern,
        },
    ).first()
    if bg_row:
        background_url = bg_row[0]

    # Fetch props/vehicles/set pieces tagged for this scene
    props = []
    prop_rows = db.execute(
        text(
            "SELECT name, character_image_url, object_type FROM characters "
            "WHERE script_id = :script_id "
            "AND object_type IN ('prop', 'vehicle', 'set_piece') "
            "AND (scene_tags = '[]'::jsonb OR scene_tags @> :scene_num_arr::jsonb)"
        ),
        {"script_id": script_uuid, "scene_num_arr": scene_num_json},
    ).all()
    for pr in prop_rows:
        props.append({"name": pr[0], "character_image_url": pr[1], "object_type": pr[2]})

    # Get user model preferences
    profile_row = db.execute(
        text(
            "SELECT model_fiab_text, model_object_image FROM user_profile "
            "WHERE user_id = :user_id"
        ),
        {"user_id": user_id},
    ).first()
    text_model = "anthropic/claude-3.7-sonnet"
    image_model: Optional[str] = None
    if profile_row:
        if profile_row[0]:
            text_model = profile_row[0]
        if profile_row[1]:
            image_model = profile_row[1]

    ensure_user_can_generate(db, user_id)

    gateway = _gateway_client()
    project_id = str(script.project_id)
    results = []
    skipped = []

    for tl in tram_lines:
        image_url = _generate_shot_image(
            tram_line=tl,
            character_images=character_images,
            background_url=background_url,
            props=props,
            scene=scene,
            gateway=gateway,
            text_model=text_model,
            image_model=image_model,
        )

        if not image_url:
            skipped.append({"line_number": tl.line_number, "reason": "Image generation failed"})
            continue

        # Download generated image
        try:
            downloaded = httpx.get(
                image_url,
                timeout=settings.gateway_timeout_seconds,
                follow_redirects=True,
                headers={"User-Agent": "MovieShakerEngine/1.0"},
            )
            downloaded.raise_for_status()
            content = downloaded.content
        except Exception as exc:
            logger.warning("Download failed for shot %s: %s", tl.line_number, exc)
            skipped.append({"line_number": tl.line_number, "reason": "Download failed"})
            continue

        filename = f"{tl.line_number}.jpg"
        try:
            path_key = save_moodboard_image(
                user_id=user_id,
                project_id=project_id,
                scene_id=scene["id"],
                tram_line_id=str(tl.id),
                filename=filename,
                content=BytesIO(content),
                size=len(content),
            )
        except Exception as exc:
            logger.warning("Storage failed for shot %s: %s", tl.line_number, exc)
            skipped.append({"line_number": tl.line_number, "reason": "Storage failed"})
            continue

        composition_payload = {
            "images": [
                {
                    "id": str(uuid.uuid4()),
                    "src": path_key,
                    "x": 0,
                    "y": 0,
                    "width": 1920,
                    "height": 1080,
                }
            ],
            "lines": [],
            "dimensions": {"width": 1920, "height": 1080},
            "snapshot_path": path_key,
            "note": tl.camera_direction or "",
            "mode": "snapshot",
        }
        comp_data_json = json.dumps(composition_payload)

        # Upsert: update first existing composition, or create with canvas_number=1
        existing = list(
            db.exec(
                select(MoodBoardComposition)
                .where(
                    MoodBoardComposition.tram_line_id == tl.id,
                    MoodBoardComposition.user_id == user_id,
                )
                .order_by(MoodBoardComposition.canvas_number.asc())
                .limit(1)
            ).all()
        )
        if existing:
            comp = existing[0]
            comp.composition_data = comp_data_json
            comp.updated_at = datetime.utcnow()
            db.add(comp)
        else:
            comp = MoodBoardComposition(
                tram_line_id=tl.id,
                user_id=user_id,
                composition_data=comp_data_json,
                canvas_number=1,
            )
            db.add(comp)

        tl.scene_visual = path_key
        tl.updated_at = datetime.utcnow()
        db.add(tl)
        db.commit()
        db.refresh(comp)

        apply_credit_cost(db, user_id, 1)

        results.append({
            "line_number": tl.line_number,
            "image_url": path_key,
            "composition_id": str(comp.id),
        })

    return {
        "scene_number": scene_number,
        "shots_generated": len(results),
        "shots_skipped": len(skipped),
        "skipped_reasons": skipped,
        "missing_character_images": [n for n in sorted(all_names) if n not in character_images],
        "results": results,
    }
