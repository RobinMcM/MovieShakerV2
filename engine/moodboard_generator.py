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
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
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

PASS_PROMPTS = {
    "sketch": {
        "label": "Pencil Sketch",
        "pass": 1,
        "style": (
            "Simple pencil sketch, "
            "hand-drawn gestural lines, "
            "black pencil on white paper background, "
            "film production storyboard aesthetic, "
            "rough sketch style, no colour, "
            "no shading, minimal detail, "
            "character silhouettes with initials "
            "on face to identify each person, "
            "blocking diagram feel"
        ),
    },
    "draft": {
        "label": "Ink Draft",
        "pass": 2,
        "style": (
            "Clean ink line drawing, "
            "more defined than a sketch, "
            "bold confident lines, "
            "characters recognisable and detailed, "
            "basic shadow hatching suggested, "
            "black ink on white paper, "
            "graphic novel panel aesthetic, "
            "no colour"
        ),
    },
    "tonal": {
        "label": "Tonal Study",
        "pass": 3,
        "style": (
            "Greyscale tonal study, "
            "light and shadow fully defined, "
            "cinematic lighting direction clear, "
            "characters have volume and form, "
            "environment detailed and atmospheric, "
            "no colour, rich greyscale values, "
            "film noir aesthetic"
        ),
    },
    "colour": {
        "label": "Colour Study",
        "pass": 4,
        "style": (
            "Flat colour illustration, "
            "bold colour palette, "
            "cinematic colour grading, "
            "mood and atmosphere through colour, "
            "stylised not photorealistic, "
            "concept art aesthetic, "
            "characters and environment fully rendered in colour"
        ),
    },
    "cinematic": {
        "label": "Cinematic",
        "pass": 5,
        "style": (
            "Photorealistic cinematic frame, "
            "professional film lighting, "
            "shallow depth of field, "
            "35mm film grain, "
            "colour graded, "
            "high production value, "
            "indistinguishable from a film still, "
            "professional cinematography"
        ),
    },
    "reference": {
        "label": "Reference Shot",
        "pass": 6,
        "style": (
            "Photorealistic film reference, "
            "exact character likenesses, "
            "approved costume and makeup, "
            "production accurate locations, "
            "final pre-visualisation quality, "
            "ready for Visualize pipeline"
        ),
    },
}


# Maps project aspect_ratio values to FAL-compatible strings.
# 2.39:1 (cinematic) → FAL's "21:9" widescreen; anything else passes through unchanged.
FAL_ASPECT_MAP: dict[str, str] = {
    "16:9":   "16:9",
    "9:16":   "9:16",
    "1:1":    "1:1",
    "2.39:1": "21:9",
}


def _aspect_to_dimensions(aspect_ratio: str) -> dict:
    """Convert aspect ratio string to pixel dimensions. Base width is always 1920px."""
    DIMENSION_MAP = {
        "16:9":   {"width": 1920, "height": 1080},
        "9:16":   {"width": 1080, "height": 1920},
        "1:1":    {"width": 1920, "height": 1920},
        "2.39:1": {"width": 1920, "height": 803},
        "21:9":   {"width": 1920, "height": 823},
        "4:3":    {"width": 1920, "height": 1440},
        "3:4":    {"width": 1440, "height": 1920},
    }
    if aspect_ratio in DIMENSION_MAP:
        return DIMENSION_MAP[aspect_ratio]
    try:
        parts = aspect_ratio.split(":")
        w, h = float(parts[0]), float(parts[1])
        height = int(1920 / (w / h))
        return {"width": 1920, "height": height}
    except Exception:
        return {"width": 1920, "height": 1080}


class GenerateMoodboardRequest(BaseModel):
    pass_type: str = "sketch"


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


def _build_fal_prompt(
    shot_type: str,
    camera_direction: str,
    characters: list,
    scene_location: str,
    location_type: str,
    pass_type: str,
) -> str:
    style = PASS_PROMPTS.get(pass_type, PASS_PROMPTS["sketch"])["style"]
    char_list = ", ".join(characters) if characters else "no characters"
    prompt = (
        f"{shot_type} shot. "
        f"Location: {location_type}. {scene_location}. "
        f"Characters: {char_list}. "
        f"Camera: {camera_direction}. "
        f"{style}"
    )
    return prompt


def _generate_shot_image(
    tram_line: TramLine,
    character_images: dict,
    background_url: Optional[str],
    props: list,
    scene: dict,
    gateway: GatewayClient,
    image_model: Optional[str],
    pass_type: str = "sketch",
    fal_aspect_ratio: str = "16:9",
) -> Optional[str]:
    """
    Build a FAL prompt directly from script data and call FAL for the image.
    Returns image URL on success, None on any failure (caller skips the shot).
    """
    char_names = [
        n.strip()
        for n in (tram_line.character_names or "").split(",")
        if n.strip()
    ]

    prompt = _build_fal_prompt(
        shot_type=tram_line.shot_type or "Medium",
        camera_direction=tram_line.camera_direction or "",
        characters=char_names,
        scene_location=scene.get("scene_location", ""),
        location_type=scene.get("location_type", ""),
        pass_type=pass_type,
    )

    try:
        response = gateway.execute_fal(
            media_type="image-generation",
            payload={"prompt": prompt, "aspect_ratio": fal_aspect_ratio},
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
    request: Optional[GenerateMoodboardRequest] = Body(default=None),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    pass_type = (request.pass_type if request else None) or "sketch"
    if pass_type not in PASS_PROMPTS:
        pass_type = "sketch"

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
    raw_conn = db.connection().connection
    with raw_conn.cursor() as cur:
        cur.execute(
            "SELECT id, scene_number, scene_location, location_type, heading "
            "FROM scenes "
            "WHERE script_id = %s AND scene_number = %s",
            (str(script_uuid), scene_number),
        )
        scene_row = cur.fetchone()
    if not scene_row:
        raise HTTPException(status_code=404, detail="Scene not found")

    scene = {
        "id": str(scene_row[0]),
        "scene_number": scene_row[1],
        "scene_location": scene_row[2] or "",
        "location_type": scene_row[3] or "",
        "heading": scene_row[4] or "",
    }

    # Read aspect ratio from project settings — never hardcode or ask the user
    with raw_conn.cursor() as cur:
        cur.execute(
            "SELECT p.aspect_ratio "
            "FROM project p "
            "JOIN script s ON s.project_id = p.id "
            "WHERE s.id = %s",
            (str(script_uuid),),
        )
        ar_row = cur.fetchone()
    raw_aspect = ar_row[0] if ar_row else "16:9"
    fal_aspect = FAL_ASPECT_MAP.get(raw_aspect, "16:9")
    dims = _aspect_to_dimensions(raw_aspect)

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
        with raw_conn.cursor() as cur:
            cur.execute(
                "SELECT name, character_image_url FROM characters "
                "WHERE script_id = %s AND UPPER(name) = %s "
                "AND character_image_url IS NOT NULL AND character_image_url != '' "
                "LIMIT 1",
                (str(script_uuid), name),
            )
            row = cur.fetchone()
        if row:
            character_images[name] = row[1]

    # Fetch background image for this location/scene
    background_url: Optional[str] = None
    scene_num_json = json.dumps([scene_number])
    location_pattern = f"%{scene['scene_location']}%" if scene["scene_location"] else "%"
    with raw_conn.cursor() as cur:
        cur.execute(
            "SELECT character_image_url FROM characters "
            "WHERE script_id = %s AND object_type = 'background' "
            "AND (scene_tags = '[]'::jsonb OR scene_tags @> %s::jsonb) "
            "ORDER BY CASE WHEN name ILIKE %s THEN 0 ELSE 1 END "
            "LIMIT 1",
            (str(script_uuid), scene_num_json, location_pattern),
        )
        bg_row = cur.fetchone()
    if bg_row:
        background_url = bg_row[0]

    # Fetch props/vehicles/set pieces tagged for this scene
    props = []
    with raw_conn.cursor() as cur:
        cur.execute(
            "SELECT name, character_image_url, object_type FROM characters "
            "WHERE script_id = %s "
            "AND object_type IN ('prop', 'vehicle', 'set_piece') "
            "AND (scene_tags = '[]'::jsonb OR scene_tags @> %s::jsonb)",
            (str(script_uuid), scene_num_json),
        )
        prop_rows = cur.fetchall()
    for pr in prop_rows:
        props.append({"name": pr[0], "character_image_url": pr[1], "object_type": pr[2]})

    # Get user model preferences
    with raw_conn.cursor() as cur:
        cur.execute(
            "SELECT model_fiab_text, model_object_image FROM user_profile "
            "WHERE user_id = %s",
            (user_id,),
        )
        profile_row = cur.fetchone()
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
            image_model=image_model,
            pass_type=pass_type,
            fal_aspect_ratio=fal_aspect,
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
                    "width": dims["width"],
                    "height": dims["height"],
                }
            ],
            "lines": [],
            "dimensions": dims,
            "snapshot_path": path_key,
            "note": tl.camera_direction or "",
            "mode": "snapshot",
            "pass_type": pass_type,
            "pass": PASS_PROMPTS.get(pass_type, PASS_PROMPTS["sketch"])["pass"],
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

