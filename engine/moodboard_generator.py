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


# ── Blocking diagram (Pass 1 — pure SVG, no FAL) ─────────────────────────────

_CHAR_COLORS = ["#60a5fa", "#f87171", "#34d399", "#fbbf24", "#a78bfa", "#f472b6"]

# x positions as fraction of canvas width; index = character index (0-based)
_SHOT_X_POSITIONS: dict[str, list[float]] = {
    "ECU":      [0.50, 0.45, 0.55, 0.48],
    "CU":       [0.50, 0.30, 0.68, 0.45],
    "MCU":      [0.36, 0.62, 0.24, 0.72],
    "OTS":      [0.22, 0.70, 0.36, 0.74],
    "MS":       [0.28, 0.66, 0.48, 0.15],
    "MWS":      [0.22, 0.58, 0.40, 0.72],
    "WS":       [0.15, 0.38, 0.62, 0.80],
    "EWS":      [0.12, 0.30, 0.55, 0.78],
    "POV":      [0.50, 0.38, 0.64, 0.48],
    "INSERT":   [0.50, 0.38, 0.58, 0.44],
    "AERIAL":   [0.30, 0.55, 0.45, 0.70],
    "TRACKING": [0.28, 0.62, 0.45, 0.16],
    "DOLLY":    [0.30, 0.65, 0.48, 0.18],
    "PAN":      [0.25, 0.60, 0.45, 0.75],
    "TILT":     [0.50, 0.35, 0.65, 0.45],
    "CRANE":    [0.30, 0.60, 0.45, 0.72],
    "STEADICAM":[0.28, 0.62, 0.46, 0.16],
}
_DEFAULT_X = [0.28, 0.66, 0.48, 0.15]

_SHOT_SCALE: dict[str, float] = {
    "ECU": 1.75, "CU": 1.30, "MCU": 1.05,
    "OTS": 0.95, "MS": 0.82, "MWS": 0.68,
    "WS": 0.55, "EWS": 0.40,
    "POV": 0.88, "INSERT": 0.72,
    "AERIAL": 0.45, "TRACKING": 0.82, "DOLLY": 0.78,
    "PAN": 0.78, "TILT": 0.88, "CRANE": 0.55,
    "STEADICAM": 0.82,
}
_DEFAULT_SCALE = 0.82
_BLOCKING_W, _BLOCKING_H, _GROUND_Y = 320, 180, 152


def _silhouette_group(cx: float, cy: float, scale: float, color: str, flip: bool = False) -> str:
    flip_part = " scale(-1,1)" if flip else ""
    return (
        f'<g transform="translate({cx:.1f},{cy:.1f}) scale({scale}){flip_part}">'
        f'<circle cx="0" cy="-64" r="10" fill="{color}"/>'
        f'<rect x="-9" y="-53" width="18" height="26" rx="3" fill="{color}"/>'
        f'<rect x="-21" y="-51" width="10" height="18" rx="3" fill="{color}"/>'
        f'<rect x="11" y="-51" width="10" height="18" rx="3" fill="{color}"/>'
        f'<rect x="-8" y="-27" width="7" height="27" rx="3" fill="{color}"/>'
        f'<rect x="1" y="-27" width="7" height="27" rx="3" fill="{color}"/>'
        f'</g>'
    )


def _compose_blocking_svg(shot_type: str, line_label: str, characters: list[dict]) -> str:
    W, H = _BLOCKING_W, _BLOCKING_H
    st = (shot_type or "MS").upper()
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">',
        f'<rect width="{W}" height="{H}" fill="#0f0f1a"/>',
        f'<line x1="0" y1="{_GROUND_Y}" x2="{W}" y2="{_GROUND_Y}" stroke="#2d2d3d" stroke-width="1"/>',
    ]
    # Camera icon at bottom centre
    cx, cy = W // 2, H - 12
    parts.append(
        f'<rect x="{cx - 12}" y="{cy - 7}" width="20" height="14" rx="2" fill="#374151"/>'
        f'<polygon points="{cx + 8},{cy} {cx + 15},{cy - 5} {cx + 15},{cy + 5}" fill="#374151"/>'
        f'<circle cx="{cx - 4}" cy="{cy}" r="4" fill="#1f2937"/>'
    )
    for char in characters:
        parts.append(_silhouette_group(
            cx=float(char["x"]), cy=float(char["y"]),
            scale=float(char["scale"]), color=char["color"],
            flip=bool(char.get("flip", False)),
        ))
        name = str(char.get("name", ""))[:8]
        lx, ly = float(char["x"]), min(float(char["y"]) + 11, H - 4)
        parts.append(
            f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="middle" '
            f'font-family="sans-serif" font-size="8" fill="{char["color"]}">{name}</text>'
        )
    # Shot type badge (top-left)
    bw = max(32, len(st) * 7 + 12)
    parts.append(
        f'<rect x="8" y="8" width="{bw}" height="18" rx="3" fill="#1f2937" opacity="0.85"/>'
        f'<text x="{8 + bw // 2}" y="21" text-anchor="middle" font-family="monospace"'
        f' font-size="10" fill="#9ca3af">{st}</text>'
    )
    # Line label badge (top-right)
    ll = str(line_label or "")[:6]
    llw = max(28, len(ll) * 8 + 12)
    parts.append(
        f'<rect x="{W - llw - 8}" y="8" width="{llw}" height="18" rx="3" fill="#1f2937" opacity="0.85"/>'
        f'<text x="{W - llw // 2 - 8}" y="21" text-anchor="middle" font-family="monospace"'
        f' font-size="10" fill="#e5e7eb">{ll}</text>'
    )
    parts.append('</svg>')
    return "".join(parts)


def _lookup_scene_characters(
    db: Session,
    scene_id: uuid.UUID,
    script_uuid: uuid.UUID,
    names: list[str],
) -> dict[str, tuple[str, Optional[str]]]:
    """
    Returns {NAME_UPPER: (character_id_str, character_image_url_or_None)}.
    Queries scene_characters JOIN characters first; falls back to script-wide search.
    """
    result: dict[str, tuple[str, Optional[str]]] = {}
    raw_conn = db.connection().connection
    for name in names:
        name_upper = name.upper().strip()
        if not name_upper:
            continue
        with raw_conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.id, c.character_image_url
                FROM characters c
                JOIN scene_characters sc ON sc.character_id = c.id
                WHERE sc.scene_id = %s AND UPPER(c.name) = %s
                LIMIT 1
                """,
                (str(scene_id), name_upper),
            )
            row = cur.fetchone()
        if not row:
            with raw_conn.cursor() as cur:
                cur.execute(
                    "SELECT id, character_image_url FROM characters "
                    "WHERE script_id = %s AND UPPER(name) = %s LIMIT 1",
                    (str(script_uuid), name_upper),
                )
                row = cur.fetchone()
        if row:
            result[name_upper] = (str(row[0]), row[1] or None)
    return result


def _default_char_positions(
    shot_type: str,
    names: list[str],
    char_lookup: Optional[dict] = None,
) -> list[dict]:
    st = (shot_type or "MS").upper()
    x_positions = _SHOT_X_POSITIONS.get(st, _DEFAULT_X)
    scale = _SHOT_SCALE.get(st, _DEFAULT_SCALE)
    lookup = char_lookup or {}
    result = []
    for i, name in enumerate(names):
        name_upper = name.upper().strip()
        char_id, img_url = lookup.get(name_upper, (None, None))
        result.append({
            "name": name.strip(),
            "x": round(_BLOCKING_W * x_positions[min(i, len(x_positions) - 1)], 1),
            "y": float(_GROUND_Y),
            "scale": round(scale, 3),
            "color": _CHAR_COLORS[i % len(_CHAR_COLORS)],
            "flip": (i % 2 == 1 and len(names) > 1),
            "character_id": char_id,
            "character_image_url": img_url,
        })
    return result


def _get_tram_line_by_label(
    db: Session, script_uuid: uuid.UUID, scene_number: int, line_label: str
) -> tuple["TramLine", dict]:
    raw_conn = db.connection().connection
    with raw_conn.cursor() as cur:
        cur.execute(
            "SELECT id, scene_number, heading FROM scenes "
            "WHERE script_id = %s AND scene_number = %s",
            (str(script_uuid), scene_number),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Scene not found")
    scene = {"id": str(row[0]), "scene_number": row[1], "heading": row[2] or ""}
    tl = db.exec(
        select(TramLine).where(
            TramLine.scene_id == row[0],
            TramLine.line_number == line_label,
        )
    ).first()
    if not tl:
        raise HTTPException(status_code=404, detail="Shot not found")
    return tl, scene


def _build_blocking_composition(
    tl: "TramLine",
    scene: dict,
    user_id: str,
    db: Session,
    script_uuid: Optional[uuid.UUID] = None,
    position_overrides: Optional[list[dict]] = None,
) -> dict:
    names = [n.strip() for n in (tl.character_names or "").split(",") if n.strip()] or ["Character"]
    if position_overrides:
        characters = position_overrides
    else:
        char_lookup = (
            _lookup_scene_characters(db, tl.scene_id, script_uuid, names)
            if script_uuid else {}
        )
        characters = _default_char_positions(tl.shot_type or "MS", names, char_lookup)
    svg = _compose_blocking_svg(tl.shot_type or "MS", tl.line_number or "", characters)
    comp_data = json.dumps({
        "mode": "blocking",
        "shot_type": tl.shot_type or "MS",
        "line_label": tl.line_number or "",
        "characters": characters,
        "svg_content": svg,
    })
    existing = list(
        db.exec(
            select(MoodBoardComposition).where(
                MoodBoardComposition.tram_line_id == tl.id,
                MoodBoardComposition.user_id == user_id,
            )
            .order_by(MoodBoardComposition.canvas_number.asc())
            .limit(1)
        ).all()
    )
    if existing:
        comp = existing[0]
        comp.composition_data = comp_data
        comp.updated_at = datetime.utcnow()
    else:
        comp = MoodBoardComposition(
            tram_line_id=tl.id,
            user_id=user_id,
            composition_data=comp_data,
            canvas_number=1,
        )
    db.add(comp)
    db.commit()
    db.refresh(comp)
    return {
        "line_number": tl.line_number,
        "composition_id": str(comp.id),
        "characters": characters,
        "svg_content": svg,
    }


def _verify_script_member(script_id: str, user_id: str, db: Session) -> "Script":
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
        raise HTTPException(status_code=403, detail="Not a member")
    return script


class AdjustBlockingBody(BaseModel):
    positions: list[dict]


@router.post("/scripts/{script_id}/scenes/{scene_number}/shots/{line_label}/generate-silhouette")
def generate_shot_silhouette(
    script_id: str,
    scene_number: int,
    line_label: str,
    session=Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Return generic SVG silhouettes for each character in the shot (Pass 1)."""
    user_id = session.get_user_id()
    _verify_script_member(script_id, user_id, db)
    script_uuid = uuid.UUID(script_id)
    tl, _ = _get_tram_line_by_label(db, script_uuid, scene_number, line_label)
    names = [n.strip() for n in (tl.character_names or "").split(",") if n.strip()] or ["Character"]
    silhouettes = []
    for i, name in enumerate(names):
        color = _CHAR_COLORS[i % len(_CHAR_COLORS)]
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-22 -74 44 74">'
            f'<circle cx="0" cy="-64" r="10" fill="{color}"/>'
            f'<rect x="-9" y="-53" width="18" height="26" rx="3" fill="{color}"/>'
            f'<rect x="-21" y="-51" width="10" height="18" rx="3" fill="{color}"/>'
            f'<rect x="11" y="-51" width="10" height="18" rx="3" fill="{color}"/>'
            f'<rect x="-8" y="-27" width="7" height="27" rx="3" fill="{color}"/>'
            f'<rect x="1" y="-27" width="7" height="27" rx="3" fill="{color}"/>'
            f'</svg>'
        )
        silhouettes.append({"name": name, "color": color, "svg": svg})
    return {"shot": line_label, "silhouettes": silhouettes}


@router.post("/scripts/{script_id}/scenes/{scene_number}/shots/{line_label}/blocking-diagram")
def generate_shot_blocking_diagram(
    script_id: str,
    scene_number: int,
    line_label: str,
    session=Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _verify_script_member(script_id, user_id, db)
    script_uuid = uuid.UUID(script_id)
    tl, scene = _get_tram_line_by_label(db, script_uuid, scene_number, line_label)
    return _build_blocking_composition(tl, scene, user_id, db, script_uuid=script_uuid)


@router.post("/scripts/{script_id}/scenes/{scene_number}/generate-blocking")
def generate_scene_blocking(
    script_id: str,
    scene_number: int,
    session=Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _verify_script_member(script_id, user_id, db)
    script_uuid = uuid.UUID(script_id)
    raw_conn = db.connection().connection
    with raw_conn.cursor() as cur:
        cur.execute(
            "SELECT id, heading FROM scenes WHERE script_id = %s AND scene_number = %s",
            (str(script_uuid), scene_number),
        )
        scene_row = cur.fetchone()
    if not scene_row:
        raise HTTPException(status_code=404, detail="Scene not found")
    scene = {"id": str(scene_row[0]), "heading": scene_row[1] or "", "scene_number": scene_number}
    tram_lines = list(
        db.exec(
            select(TramLine).where(TramLine.scene_id == scene_row[0]).order_by(TramLine.created_at)
        ).all()
    )
    if not tram_lines:
        raise HTTPException(status_code=400, detail="No shots found for this scene.")
    generated, skipped = [], []
    for tl in tram_lines:
        try:
            r = _build_blocking_composition(tl, scene, user_id, db, script_uuid=script_uuid)
            generated.append(r)
        except Exception as exc:
            logger.warning("Blocking diagram failed for %s: %s", tl.line_number, exc)
            skipped.append({"line_number": tl.line_number, "reason": str(exc)})
    return {
        "scene_number": scene_number,
        "diagrams_generated": len(generated),
        "diagrams_skipped": len(skipped),
        "results": generated,
    }


@router.post("/scripts/{script_id}/scenes/{scene_number}/shots/{line_label}/adjust-blocking")
def adjust_blocking_diagram(
    script_id: str,
    scene_number: int,
    line_label: str,
    body: AdjustBlockingBody,
    session=Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _verify_script_member(script_id, user_id, db)
    script_uuid = uuid.UUID(script_id)
    tl, scene = _get_tram_line_by_label(db, script_uuid, scene_number, line_label)
    # position_overrides already contain character_id + character_image_url from the initial generate
    return _build_blocking_composition(tl, scene, user_id, db, position_overrides=body.positions)
