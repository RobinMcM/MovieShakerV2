"""
Visualize API config and stitch placeholder.
- GET /api/config/status: returns gateway connectivity and model metadata.
- POST /api/video/stitch: placeholder for custom stitch server integration.
"""

import re
import json
import uuid
from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from config import load_settings
from gateway_client import GatewayClient
from media_handler_client import MediaHandlerClient, MediaHandlerClientError
from model_catalog import (
    PURPOSE_FIAB_TEXT,
    PURPOSE_OBJECT_IMAGE,
    PURPOSE_SOUND_MUSIC,
    PURPOSE_VISUALIZE_VIDEO,
    build_model_catalog,
)
from db import get_session
from models import (
    MoodBoardCompiledVideo,
    MoodBoardVideoHistory,
    ProjectMember,
    Scene,
    Script,
    TramLine,
)
from storage import save_moodboard_video

router = APIRouter(tags=["visualize-config"])
settings = load_settings()

FIAB_COST_RANK_OVERRIDES: dict[str, float] = {
    # Higher value = more expensive (for stable high->low sorting)
    "openai/gpt-4.1": 1000,
    "openai/gpt-4.1-mini": 650,
    "openai/gpt-4o": 900,
    "openai/gpt-4o-mini": 600,
    "openai/o1": 1200,
    "openai/o1-mini": 750,
    "openai/o3-mini": 700,
    "anthropic/claude-3.7-sonnet": 950,
    "anthropic/claude-3.5-sonnet": 880,
    "anthropic/claude-3-haiku": 500,
    "google/gemini-2.0-pro": 860,
    "google/gemini-2.0-flash": 560,
    "google/gemma-3-27b-it": 520,
    "google/gemma-3-12b-it": 430,
    "meta-llama/llama-3.3-70b-instruct": 720,
    "meta-llama/llama-3.1-70b-instruct": 680,
    "meta-llama/llama-3.1-8b-instruct": 330,
    "mistralai/mistral-large": 760,
    "mistralai/mixtral-8x22b-instruct": 700,
    "mistralai/mixtral-8x7b-instruct": 450,
    "deepseek/deepseek-r1": 740,
    "deepseek/deepseek-chat": 420,
    "qwen/qwen-2.5-72b-instruct": 620,
    "qwen/qwen-2.5-32b-instruct": 500,
    "qwen/qwen-2.5-14b-instruct": 420,
}


def _to_float(value) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except Exception:
            return None
    return None


def _extract_cost_rank(model: dict) -> float:
    model_id = (model.get("id") or "").strip()
    if model_id in FIAB_COST_RANK_OVERRIDES:
        return FIAB_COST_RANK_OVERRIDES[model_id]

    # Try explicit cost/pricing fields first if provided by gateway/OpenRouter model payload.
    explicit_keys = (
        "cost",
        "price",
        "cost_per_million",
        "input_cost",
        "output_cost",
        "input_cost_per_million",
        "output_cost_per_million",
    )
    for key in explicit_keys:
        parsed = _to_float(model.get(key))
        if parsed is not None:
            return parsed

    pricing = model.get("pricing")
    if isinstance(pricing, dict):
        prompt_cost = _to_float(pricing.get("prompt")) or 0.0
        completion_cost = _to_float(pricing.get("completion")) or 0.0
        if prompt_cost or completion_cost:
            return prompt_cost + completion_cost

    # Stable provider-family fallback (predictable ordering when pricing is missing).
    lowered_id = model_id.lower()
    lowered_name = (model.get("name") or "").lower()
    text = f"{lowered_id} {lowered_name}"
    if "o1" in text or "gpt-4.1" in text:
        return 900.0
    if "gpt-4" in text or "claude" in text or "mistral-large" in text:
        return 800.0
    if "70b" in text or "72b" in text or "mixtral-8x22b" in text:
        return 650.0
    if "flash" in text or "haiku" in text or "mini" in text:
        return 500.0
    if "8b" in text or "7b" in text:
        return 300.0
    return 0.0


def _extract_creativity_rank(model: dict) -> float:
    model_id = (model.get("id") or "").lower()
    model_name = (model.get("name") or "").lower()
    text = f"{model_id} {model_name}"
    score = 0.0
    if "opus" in text:
        score += 90
    if "sonnet" in text:
        score += 75
    if "gpt-4" in text:
        score += 85
    if "o1" in text or "r1" in text:
        score += 80
    if "pro" in text or "ultra" in text:
        score += 70

    match = re.search(r"(\d+(?:\.\d+)?)b", text)
    if match:
        try:
            score += float(match.group(1))
        except Exception:
            pass
    return score


def _infer_fiab_categories(model: dict) -> list[str]:
    model_id = (model.get("id") or "").lower()
    model_name = (model.get("name") or "").lower()
    text = f"{model_id} {model_name}"
    categories = {"script_creative_writing"}

    reasoning_tokens = (
        "reason", "r1", "o1", "thinking", "analysis", "math", "deepseek", "qwen", "mixtral"
    )
    finance_tokens = (
        "finance", "financial", "budget", "account", "analyst", "excel", "spreadsheet"
    )
    funding_tokens = (
        "fund", "funding", "invest", "investor", "pitch", "venture", "startup", "capital", "grant"
    )
    marketing_tokens = (
        "market", "marketing", "brand", "ads", "advert", "copy", "promotion", "campaign", "social"
    )
    creative_tokens = (
        "creative", "story", "writer", "writing", "script", "screenplay", "opus", "sonnet", "gpt-4"
    )

    if any(token in text for token in reasoning_tokens):
        categories.add("budget_financial_planning")
        categories.add("funding_pitch_development")
    if any(token in text for token in finance_tokens):
        categories.add("budget_financial_planning")
    if any(token in text for token in funding_tokens):
        categories.add("funding_pitch_development")
    if any(token in text for token in marketing_tokens):
        categories.add("marketing_promotion")
    if any(token in text for token in creative_tokens):
        categories.add("marketing_promotion")
        categories.add("funding_pitch_development")

    return sorted(categories)


def _media_handler_client() -> MediaHandlerClient:
    return MediaHandlerClient(
        base_url=settings.media_handler_base_url,
        api_key=settings.media_handler_internal_api_key,
        timeout_seconds=settings.media_handler_timeout_seconds,
        verify_tls=settings.media_handler_verify_tls,
    )


def _ensure_tramline_access(db: Session, tramline_id: str, user_id: str) -> tuple[TramLine, uuid.UUID]:
    line = db.get(TramLine, uuid.UUID(tramline_id))
    if not line:
        raise HTTPException(status_code=404, detail="Tram line not found")
    scene = db.get(Scene, line.scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    script = db.get(Script, scene.script_id)
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
    return line, script.project_id


@router.get("/api/config/status")
def get_config_status(
    session: SessionContainer = Depends(verify_session()),
):
    """
    Gateway is the source of truth for model availability.
    """
    client = GatewayClient(
        base_url=settings.gateway_base_url,
        api_key=settings.gateway_internal_api_key,
        timeout_seconds=settings.gateway_timeout_seconds,
        connect_timeout_seconds=settings.gateway_connect_timeout_seconds,
        read_timeout_seconds=settings.gateway_read_timeout_seconds,
        verify_tls=settings.gateway_verify_tls,
    )
    connected = client.health() if settings.gateway_base_url else False
    models = client.get_models() if connected and settings.gateway_internal_api_key else []
    object_image_models = client.get_object_image_models() if connected and settings.gateway_internal_api_key else []
    visualize_video_models = client.get_visualize_video_models() if connected and settings.gateway_internal_api_key else []
    sound_music_models = client.get_sound_music_models() if connected and settings.gateway_internal_api_key else []
    catalog = build_model_catalog(
        fiab_text_gateway_models=models,
        object_image_gateway_models=object_image_models,
        visualize_video_gateway_models=visualize_video_models,
        sound_music_gateway_models=sound_music_models,
    )
    compact_models = []
    fiab_text_models = []
    for model in catalog.get(PURPOSE_FIAB_TEXT, []):
        model_id = model.get("id")
        model_name = model.get("name") or model_id
        provider = model.get("provider")
        if not model_id:
            continue
        compact_models.append({
            "id": model_id,
            "name": model_name,
            "provider": provider,
        })
        fiab_text_models.append({
            "id": model_id,
            "name": model_name,
            "provider": provider,
            "media_type_support": model.get("media_type_support") or [],
            "required_inputs": model.get("required_inputs") or [],
            "optional_inputs": model.get("optional_inputs") or [],
            "status": model.get("status") or "active",
            "default_for_media_type": model.get("default_for_media_type"),
            "cost_tier": model.get("cost_tier"),
            "speed_tier": model.get("speed_tier"),
            "quality_tier": model.get("quality_tier"),
            "docs_url": model.get("docs_url"),
            "cost_rank": _extract_cost_rank(model),
            "creativity_rank": _extract_creativity_rank(model),
            "categories": _infer_fiab_categories(model),
        })

    fiab_text_models.sort(
        key=lambda m: (float(m.get("cost_rank", 0.0)), str(m.get("name") or m.get("id") or "")),
        reverse=True,
    )
    return {
        "success": True,
        "config": {
            "sourceOfTruth": "gateway",
            "gatewayConnected": connected,
            "hasGatewayKey": bool(settings.gateway_internal_api_key),
            "models": compact_models,
            "objectImageModels": catalog.get(PURPOSE_OBJECT_IMAGE, []),
            "visualizeVideoModels": catalog.get(PURPOSE_VISUALIZE_VIDEO, []),
            "soundMusicModels": catalog.get(PURPOSE_SOUND_MUSIC, []),
            "fiabTextModels": fiab_text_models,
        },
    }


class StitchBody(BaseModel):
    video_ids: list[str]
    project_id: str
    tram_line_id: str
    aspect_ratio: str = "16:9"


@router.post("/api/video/stitch")
def stitch_videos(
    body: StitchBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    if not settings.media_handler_base_url:
        raise HTTPException(status_code=503, detail="Media-handler base URL is not configured")
    if not settings.media_handler_internal_api_key:
        raise HTTPException(status_code=503, detail="Media-handler API key is not configured")

    line, project_id = _ensure_tramline_access(db, body.tram_line_id, user_id)
    if str(project_id) != body.project_id:
        raise HTTPException(status_code=400, detail="project_id does not match tram_line_id")

    if len(body.video_ids) < 2:
        raise HTTPException(status_code=400, detail="At least 2 videos are required to stitch")

    try:
        source_video_uuids = [uuid.UUID(v_id) for v_id in body.video_ids]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid video id in video_ids")

    source_rows = list(
        db.exec(
            select(MoodBoardVideoHistory).where(
                MoodBoardVideoHistory.tram_line_id == line.id,
                MoodBoardVideoHistory.id.in_(source_video_uuids),
            )
        ).all()
    )
    if len(source_rows) != len(body.video_ids):
        raise HTTPException(status_code=404, detail="One or more source videos were not found")

    sorted_source_rows = sorted(source_rows, key=lambda row: (row.take_number or 0))
    source_urls = [row.video_path for row in sorted_source_rows if row.video_path]
    if len(source_urls) < 2:
        raise HTTPException(status_code=400, detail="Source videos must be completed before stitching")

    try:
        stitch_result = _media_handler_client().stitch_videos(source_urls, aspect_ratio=body.aspect_ratio)
    except MediaHandlerClientError as exc:
        raise HTTPException(status_code=502, detail=f"Stitch request failed: {exc}")

    output_path = None
    if isinstance(stitch_result, dict):
        for key in ("output_url", "url", "compiled_video_path", "video_url"):
            value = stitch_result.get(key)
            if isinstance(value, str) and value.strip():
                output_path = value.strip()
                break

    streamed_output = None
    if isinstance(stitch_result, dict):
        maybe_bytes = stitch_result.get("output_bytes")
        if isinstance(maybe_bytes, (bytes, bytearray)) and len(maybe_bytes) > 0:
            streamed_output = bytes(maybe_bytes)

    if output_path is None and streamed_output is not None:
        filename = f"compiled-{uuid.uuid4()}.mp4"
        try:
            output_path = save_moodboard_video(
                user_id=user_id,
                project_id=str(project_id),
                scene_id=str(line.scene_id),
                tram_line_id=str(line.id),
                filename=filename,
                content=BytesIO(streamed_output),
                size=len(streamed_output),
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Stitch output persistence failed: {exc}")

    created_compiled = None
    if output_path:
        channel_number = sorted_source_rows[0].channel
        created_compiled = MoodBoardCompiledVideo(
            tram_line_id=line.id,
            project_id=project_id,
            user_id=user_id,
            compiled_video_path=output_path,
            source_video_ids=json.dumps(body.video_ids),
            status="completed",
            completed_at=datetime.utcnow(),
            channel_number=channel_number,
        )
        db.add(created_compiled)
        db.commit()
        db.refresh(created_compiled)
    else:
        db.rollback()
        raise HTTPException(
            status_code=502,
            detail="Stitch completed without a persisted output video",
        )

    return {
        "success": True,
        "stitch": stitch_result,
        "compiledVideo": {
            "id": str(created_compiled.id),
            "compiled_video_path": created_compiled.compiled_video_path,
            "channel_number": created_compiled.channel_number,
        } if created_compiled else None,
    }
