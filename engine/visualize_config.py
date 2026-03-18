"""
Visualize API config and stitch placeholder.
- GET /api/config/status: returns gateway connectivity and model metadata.
- POST /api/video/stitch: placeholder for custom stitch server integration.
"""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from config import load_settings
from gateway_client import GatewayClient

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
        verify_tls=settings.gateway_verify_tls,
    )
    connected = client.health() if settings.gateway_base_url else False
    models = client.get_models() if connected and settings.gateway_internal_api_key else []
    object_image_models = client.get_object_image_models() if connected and settings.gateway_internal_api_key else []
    compact_models = []
    fiab_text_models = []
    for model in models:
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
            "objectImageModels": object_image_models,
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
):
    """
    Placeholder for custom stitch server. Integrate with your server when ready.
    """
    raise HTTPException(
        status_code=501,
        detail="Video stitch is not integrated. Connect your stitch server to this endpoint.",
    )
