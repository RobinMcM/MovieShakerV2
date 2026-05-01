"""
CoProducer moodboard generation.
POST /scripts/{script_id}/scenes/{scene_number}/generate-moodboard

Generates AI images for every shot (tram line) in a scene, writes each
image to storage, upserts the first MoodBoardComposition for the tram line,
and updates tram_line.scene_visual.
"""
import base64
import json
import logging
import uuid
from datetime import datetime
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from config import load_settings
from credits import apply_credit_cost, ensure_user_can_generate
from db import get_session
from gateway_client import GatewayClient
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
        "style": "pencil sketch, black on white, minimal, storyboard",
    },
    "draft": {
        "label": "Ink Draft",
        "pass": 2,
        "style": "ink line drawing, black on white, bold lines, no colour",
    },
    "tonal": {
        "label": "Tonal Study",
        "pass": 3,
        "style": "greyscale, light and shadow, no colour, cinematic",
    },
    "colour": {
        "label": "Colour Study",
        "pass": 4,
        "style": "flat colour, stylised, concept art",
    },
    "cinematic": {
        "label": "Cinematic",
        "pass": 5,
        "style": "photorealistic, cinematic lighting, film still",
    },
    "reference": {
        "label": "Reference Shot",
        "pass": 6,
        "style": "photorealistic, production accurate, final quality",
    },
}

# Maps pass type to image model — three-phase strategy:
#
# DEVELOPMENT (director building composition):
#   flux-2-pro — fast enough, good quality, low cost per iteration
#
# APPROVAL (director happy with composition):
#   nano-banana-2 — contextual colour understanding produces better images
#
# FINAL REFERENCE (feeds the Visualize pipeline):
#   gpt-5-image — quality here directly determines video quality; worth the premium
PASS_TO_MODEL = {
    "sketch":    "flux-2-pro",
    "draft":     "flux-2-pro",
    "tonal":     "flux-2-pro",
    "colour":    "nano-banana-2",
    "cinematic": "nano-banana-2",
    "reference": "gpt-5-image",
}

# Maps project aspect_ratio values to gateway-compatible strings.
# 2.39:1 (cinematic) → "21:9" widescreen; anything else passes through unchanged.
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
    vision: Optional[str] = None


def _gateway_client() -> GatewayClient:
    return GatewayClient(
        base_url=settings.gateway_base_url,
        api_key=settings.gateway_internal_api_key,
        timeout_seconds=settings.gateway_timeout_seconds,
        verify_tls=settings.gateway_verify_tls,
    )


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
    vision: Optional[str] = None,
) -> str:
    style = PASS_PROMPTS.get(pass_type, PASS_PROMPTS["sketch"])["style"]
    if vision:
        return f"{vision}, {style}"
    if camera_direction:
        return f"{camera_direction}, {style}"
    parts = []
    if characters:
        parts.append(", ".join(characters))
    if scene_location:
        parts.append(scene_location)
    if shot_type:
        parts.append(f"{shot_type} shot")
    parts.append(style)
    return ", ".join(parts)


def _generate_shot_image(
    tram_line: TramLine,
    character_images: dict,
    background_url: Optional[str],
    props: list,
    scene: dict,
    gateway: GatewayClient,
    pass_type: str = "sketch",
    aspect_ratio: str = "16:9",
    vision: Optional[str] = None,
) -> Optional[bytes]:
    """
    Build a prompt from script data and generate an image via OpenRouter.
    Returns raw image bytes on success, None on any failure (caller skips the shot).
    """
    logger.info(
        "=== _generate_shot_image START === tram=%s pass=%s model=%s",
        tram_line.id, pass_type, PASS_TO_MODEL.get(pass_type, "unknown"),
    )

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
        vision=vision,
    )

    model_key = PASS_TO_MODEL.get(pass_type, "flux-2-klein")

    try:
        result = gateway.generate_image(
            prompt=prompt,
            model_key=model_key,
            aspect_ratio=aspect_ratio,
            dry_run=False,
        )
        logger.info(
            "=== GATEWAY RETURNED === keys=%s ok=%s has_b64=%s b64_len=%d",
            list(result.keys()),
            result.get("ok"),
            bool(result.get("image_b64")),
            len(result.get("image_b64") or ""),
        )
        image_b64 = result.get("image_b64") or ""
        if not image_b64:
            logger.error("NO image_b64 in result. Full result: %s",
                         {k: v[:50] if isinstance(v, str) and len(v) > 50
                          else v for k, v in result.items()})
            return None
        img_bytes = base64.b64decode(image_b64)
        logger.info("Decoded %d bytes successfully", len(img_bytes))
        return img_bytes
    except Exception as exc:
        logger.error("EXCEPTION in _generate_shot_image: %s",
                     exc, exc_info=True)
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
    vision: Optional[str] = ((request.vision or "").strip() or None) if request else None

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
    aspect_ratio = FAL_ASPECT_MAP.get(raw_aspect, "16:9")
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

    ensure_user_can_generate(db, user_id)

    gateway = _gateway_client()
    project_id = str(script.project_id)
    results = []
    skipped = []

    for tl in tram_lines:
        content = _generate_shot_image(
            tram_line=tl,
            character_images=character_images,
            background_url=background_url,
            props=props,
            scene=scene,
            gateway=gateway,
            pass_type=pass_type,
            aspect_ratio=aspect_ratio,
            vision=vision,
        )

        if not content:
            logger.error(
                "NO IMAGE CONTENT returned for shot %s pass_type=%s",
                tl.line_number, pass_type,
            )
            skipped.append({"line_number": tl.line_number, "reason": "Image generation failed"})
            continue

        logger.info("IMAGE GENERATED shot=%s bytes=%d", tl.line_number, len(content))

        filename = f"{tl.line_number}.png"
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
            logger.error(
                "SPACES STORAGE FAILED shot=%s error=%s",
                tl.line_number, exc, exc_info=True,
            )
            skipped.append({"line_number": tl.line_number, "reason": "Storage failed"})
            continue

        logger.info("IMAGE SAVED TO SPACES shot=%s path=%s", tl.line_number, path_key)

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

        # Upsert keyed on (tram_line_id, user_id, pass_type).
        # Each pass type gets its own composition row; re-generating the same
        # pass type updates that row rather than creating a duplicate.
        existing = list(
            db.exec(
                select(MoodBoardComposition)
                .where(
                    MoodBoardComposition.tram_line_id == tl.id,
                    MoodBoardComposition.user_id == user_id,
                )
                .order_by(MoodBoardComposition.canvas_number.asc())
            ).all()
        )
        pass_match = next(
            (
                c for c in existing
                if json.loads(c.composition_data or "{}").get("pass_type") == pass_type
            ),
            None,
        )
        if pass_match:
            comp = pass_match
            comp.composition_data = comp_data_json
            comp.updated_at = datetime.utcnow()
            db.add(comp)
        else:
            next_canvas_number = len(existing) + 1
            comp = MoodBoardComposition(
                tram_line_id=tl.id,
                user_id=user_id,
                composition_data=comp_data_json,
                canvas_number=next_canvas_number,
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
