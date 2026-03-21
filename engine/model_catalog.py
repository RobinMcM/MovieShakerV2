"""
Canonical model catalog for MovieShaker.

This module defines a stable metadata contract used by:
- /api/config/status model dropdown payloads
- generation-time validation for model/media compatibility
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

PURPOSE_FIAB_TEXT = "fiab_text"
PURPOSE_OBJECT_IMAGE = "object_image"
PURPOSE_VISUALIZE_VIDEO = "visualize_video"
PURPOSE_SOUND_MUSIC = "sound_music"

MEDIA_TEXT = "text-generation"
MEDIA_IMAGE = "image-generation"
MEDIA_IMAGE_TO_VIDEO = "image-to-video"
MEDIA_AUDIO = "audio-generation"

ALL_PURPOSES = (
    PURPOSE_FIAB_TEXT,
    PURPOSE_OBJECT_IMAGE,
    PURPOSE_VISUALIZE_VIDEO,
    PURPOSE_SOUND_MUSIC,
)


def _visualize_generation_options(model_id: str) -> list[dict[str, Any]]:
    key = (model_id or "").strip().lower()
    common_text = {
        "key": "negative_prompt",
        "label": "Negative Prompt",
        "type": "text",
        "default": "",
        "hint": "Optional guidance for what to avoid in the output.",
    }
    if "veo3" in key:
        return [
            {
                "key": "duration",
                "label": "Duration",
                "type": "enum",
                "default": "6s",
                "choices": ["4s", "6s", "8s"],
                "hint": "Veo accepts 4s, 6s, or 8s clips.",
            },
            {
                "key": "aspect_ratio",
                "label": "Aspect Ratio",
                "type": "enum",
                "default": "16:9",
                "choices": ["16:9", "9:16", "auto"],
                "hint": "Use auto to let the provider determine framing.",
            },
            {
                "key": "resolution",
                "label": "Resolution",
                "type": "enum",
                "default": "720p",
                "choices": ["720p", "1080p"],
                "hint": "Higher resolution may increase cost and generation time.",
            },
            {
                "key": "generate_audio",
                "label": "Generate Audio",
                "type": "boolean",
                "default": True,
                "hint": "Enable synchronized generated audio.",
            },
            {
                "key": "safety_tolerance",
                "label": "Safety Tolerance",
                "type": "enum",
                "default": "4",
                "choices": ["1", "2", "3", "4", "5", "6"],
                "hint": "1 is strictest filtering, 6 is least strict.",
            },
            common_text,
        ]
    if "minimax" in key or "hailuo" in key:
        return [
            {
                "key": "duration",
                "label": "Duration",
                "type": "enum",
                "default": "5",
                "choices": ["5", "10"],
                "hint": "Hailuo supports 5s or 10s on this gateway route.",
            },
            {
                "key": "resolution",
                "label": "Resolution",
                "type": "enum",
                "default": "768P",
                "choices": ["512P", "768P"],
                "hint": "Provider resolution enum for Hailuo standard models.",
            },
            {
                "key": "prompt_optimizer",
                "label": "Prompt Optimizer",
                "type": "boolean",
                "default": True,
                "hint": "Allow provider prompt optimization before generation.",
            },
        ]
    if key.startswith("wan/") or "wan-i2v" in key:
        return [
            {
                "key": "duration",
                "label": "Duration",
                "type": "enum",
                "default": "5",
                "choices": ["5", "10", "15"],
                "hint": "Wan supports 5s, 10s, or 15s.",
            },
            {
                "key": "resolution",
                "label": "Resolution",
                "type": "enum",
                "default": "720p",
                "choices": ["720p", "1080p"],
                "hint": "Resolution options supported by Wan v2.6.",
            },
            {
                "key": "enable_prompt_rewriting",
                "label": "Enable Prompt Rewriting",
                "type": "boolean",
                "default": True,
                "hint": "Provider can rewrite prompt to improve results.",
            },
            common_text,
            {
                "key": "audio_url",
                "label": "Audio URL",
                "type": "text",
                "default": "",
                "hint": "Optional background audio URL when supported.",
            },
        ]
    if "kling-video" in key:
        return [
            {
                "key": "duration",
                "label": "Duration",
                "type": "enum",
                "default": "5",
                "choices": ["5", "10"],
                "hint": "Kling commonly supports 5s or 10s.",
            },
            {
                "key": "aspect_ratio",
                "label": "Aspect Ratio",
                "type": "enum",
                "default": "16:9",
                "choices": ["16:9", "9:16", "1:1"],
                "hint": "Kling supports standard aspect ratio enums.",
            },
            common_text,
            {
                "key": "cfg_scale",
                "label": "CFG Scale",
                "type": "number",
                "default": 0.5,
                "hint": "Prompt adherence strength (typically 0.0-1.0).",
            },
        ]
    return []


def _seeded_models() -> list[dict[str, Any]]:
    return [
        # FIAB text
        {
            "id": "google/gemma-3-12b-it:free",
            "name": "Gemma 3 12B Instruct (Free)",
            "provider": "openrouter",
            "purpose": PURPOSE_FIAB_TEXT,
            "media_type_support": [MEDIA_TEXT],
            "required_inputs": ["messages"],
            "optional_inputs": ["temperature", "max_tokens"],
            "status": "active",
            "default_for_media_type": MEDIA_TEXT,
            "cost_tier": "low",
            "speed_tier": "fast",
            "quality_tier": "standard",
            "docs_url": "https://openrouter.ai/docs",
        },
        {
            "id": "openai/gpt-4.1-mini",
            "name": "GPT-4.1 Mini",
            "provider": "openrouter",
            "purpose": PURPOSE_FIAB_TEXT,
            "media_type_support": [MEDIA_TEXT],
            "required_inputs": ["messages"],
            "optional_inputs": ["temperature", "max_tokens"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "standard",
            "speed_tier": "fast",
            "quality_tier": "high",
            "docs_url": "https://openrouter.ai/docs",
        },
        {
            "id": "anthropic/claude-3.5-sonnet",
            "name": "Claude 3.5 Sonnet",
            "provider": "openrouter",
            "purpose": PURPOSE_FIAB_TEXT,
            "media_type_support": [MEDIA_TEXT],
            "required_inputs": ["messages"],
            "optional_inputs": ["temperature", "max_tokens"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://openrouter.ai/docs",
        },
        # Object image
        {
            "id": "fal-ai/flux/schnell",
            "name": "FLUX Schnell",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": MEDIA_IMAGE,
            "cost_tier": "low",
            "speed_tier": "fast",
            "quality_tier": "standard",
            "docs_url": "https://fal.ai/models/fal-ai/flux/schnell/api",
        },
        {
            "id": "fal-ai/flux/dev",
            "name": "FLUX Dev",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "standard",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models/fal-ai/flux/dev/api",
        },
        {
            "id": "fal-ai/flux-pro",
            "name": "FLUX.1 Pro",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/flux-pro/v1.1-ultra",
            "name": "FLUX 1.1 Pro Ultra",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/flux-2-pro",
            "name": "FLUX.2 Pro",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/flux-lora",
            "name": "FLUX LoRA",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed", "lora"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "standard",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/nano-banana-2",
            "name": "Nano Banana 2",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "standard",
            "speed_tier": "fast",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/nano-banana-pro",
            "name": "Nano Banana Pro",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/nano-banana",
            "name": "Nano Banana",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "standard",
            "speed_tier": "fast",
            "quality_tier": "standard",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/imagen4/preview",
            "name": "Imagen 4 Preview",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/gpt-image-1.5",
            "name": "GPT Image 1.5",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/gpt-image-1.5/edit",
            "name": "GPT Image 1.5 (Edit)",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed", "image"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/recraft/v3/text-to-image",
            "name": "Recraft V3",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "standard",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/ideogram/v3",
            "name": "Ideogram V3",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "standard",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/seedream-v45",
            "name": "Seedream 4.5",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/stable-diffusion-v35-medium",
            "name": "Stable Diffusion 3.5 Medium",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "low",
            "speed_tier": "medium",
            "quality_tier": "standard",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "xai/grok-imagine-image",
            "name": "Grok Imagine Image",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        {
            "id": "fal-ai/sana",
            "name": "Sana",
            "provider": "fal",
            "purpose": PURPOSE_OBJECT_IMAGE,
            "media_type_support": [MEDIA_IMAGE],
            "required_inputs": ["prompt"],
            "optional_inputs": ["aspect_ratio", "image_size", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "standard",
            "speed_tier": "fast",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
        },
        # Visualize video
        {
            "id": "fal-ai/minimax-hailuo-02/image-to-video",
            "name": "MiniMax Hailuo-02",
            "provider": "fal",
            "purpose": PURPOSE_VISUALIZE_VIDEO,
            "media_type_support": [MEDIA_IMAGE_TO_VIDEO],
            "required_inputs": ["prompt", "image_url"],
            "optional_inputs": ["duration", "aspect_ratio", "seed"],
            "status": "active",
            "default_for_media_type": MEDIA_IMAGE_TO_VIDEO,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
            "generation_options": _visualize_generation_options("fal-ai/minimax-hailuo-02/image-to-video"),
        },
        {
            "id": "fal-ai/veo3/image-to-video",
            "name": "Google Veo 3",
            "provider": "fal",
            "purpose": PURPOSE_VISUALIZE_VIDEO,
            "media_type_support": [MEDIA_IMAGE_TO_VIDEO],
            "required_inputs": ["prompt", "image_url"],
            "optional_inputs": ["duration", "aspect_ratio", "seed"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
            "generation_options": _visualize_generation_options("fal-ai/veo3/image-to-video"),
        },
        {
            "id": "fal-ai/veo3.1/image-to-video",
            "name": "Google Veo 3.1",
            "provider": "fal",
            "purpose": PURPOSE_VISUALIZE_VIDEO,
            "media_type_support": [MEDIA_IMAGE_TO_VIDEO],
            "required_inputs": ["prompt", "image_url"],
            "optional_inputs": ["duration", "aspect_ratio"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
            "generation_options": _visualize_generation_options("fal-ai/veo3.1/image-to-video"),
        },
        {
            "id": "wan/v2.6/image-to-video",
            "name": "Wan v2.6",
            "provider": "fal",
            "purpose": PURPOSE_VISUALIZE_VIDEO,
            "media_type_support": [MEDIA_IMAGE_TO_VIDEO],
            "required_inputs": ["prompt", "image_url"],
            "optional_inputs": ["duration", "aspect_ratio"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "standard",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
            "generation_options": _visualize_generation_options("wan/v2.6/image-to-video"),
        },
        {
            "id": "fal-ai/wan-i2v",
            "name": "Wan 2.1",
            "provider": "fal",
            "purpose": PURPOSE_VISUALIZE_VIDEO,
            "media_type_support": [MEDIA_IMAGE_TO_VIDEO],
            "required_inputs": ["prompt", "image_url"],
            "optional_inputs": ["duration", "aspect_ratio"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "standard",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
            "generation_options": _visualize_generation_options("fal-ai/wan-i2v"),
        },
        {
            "id": "fal-ai/kling-video/v2.5/turbo-pro/image-to-video",
            "name": "Kling 2.5 Turbo Pro",
            "provider": "fal",
            "purpose": PURPOSE_VISUALIZE_VIDEO,
            "media_type_support": [MEDIA_IMAGE_TO_VIDEO],
            "required_inputs": ["prompt", "image_url"],
            "optional_inputs": ["duration", "aspect_ratio"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
            "generation_options": _visualize_generation_options("fal-ai/kling-video/v2.5/turbo-pro/image-to-video"),
        },
        {
            "id": "fal-ai/kling-video/v3/pro/image-to-video",
            "name": "Kling 3.0 Pro",
            "provider": "fal",
            "purpose": PURPOSE_VISUALIZE_VIDEO,
            "media_type_support": [MEDIA_IMAGE_TO_VIDEO],
            "required_inputs": ["prompt", "image_url"],
            "optional_inputs": ["duration", "aspect_ratio"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
            "generation_options": _visualize_generation_options("fal-ai/kling-video/v3/pro/image-to-video"),
        },
        {
            "id": "xai/grok-imagine-video/image-to-video",
            "name": "Grok Imagine Video",
            "provider": "fal",
            "purpose": PURPOSE_VISUALIZE_VIDEO,
            "media_type_support": [MEDIA_IMAGE_TO_VIDEO],
            "required_inputs": ["prompt", "image_url"],
            "optional_inputs": ["duration", "aspect_ratio"],
            "status": "active",
            "default_for_media_type": None,
            "cost_tier": "premium",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models",
            "generation_options": _visualize_generation_options("xai/grok-imagine-video/image-to-video"),
        },
        # Sound/music
        {
            "id": "fal-ai/stable-audio",
            "name": "Stable Audio",
            "provider": "fal",
            "purpose": PURPOSE_SOUND_MUSIC,
            "media_type_support": [MEDIA_AUDIO],
            "required_inputs": ["prompt"],
            "optional_inputs": ["duration", "seed"],
            "status": "active",
            "default_for_media_type": MEDIA_AUDIO,
            "cost_tier": "standard",
            "speed_tier": "medium",
            "quality_tier": "high",
            "docs_url": "https://fal.ai/models/fal-ai/stable-audio/api",
        },
    ]


def _ensure_defaults(model: dict[str, Any], purpose: str) -> dict[str, Any]:
    normalized = dict(model)
    normalized["id"] = str(normalized.get("id") or "").strip()
    normalized["name"] = str(normalized.get("name") or normalized["id"]).strip()
    normalized["provider"] = str(normalized.get("provider") or "unknown").strip().lower()
    normalized["purpose"] = str(normalized.get("purpose") or purpose).strip()
    media_support = normalized.get("media_type_support")
    normalized["media_type_support"] = media_support if isinstance(media_support, list) else []
    normalized["required_inputs"] = normalized.get("required_inputs") if isinstance(normalized.get("required_inputs"), list) else []
    normalized["optional_inputs"] = normalized.get("optional_inputs") if isinstance(normalized.get("optional_inputs"), list) else []
    normalized["status"] = str(normalized.get("status") or "active").strip().lower()
    normalized["default_for_media_type"] = normalized.get("default_for_media_type")
    normalized["cost_tier"] = str(normalized.get("cost_tier") or "standard").strip().lower()
    normalized["speed_tier"] = str(normalized.get("speed_tier") or "medium").strip().lower()
    normalized["quality_tier"] = str(normalized.get("quality_tier") or "standard").strip().lower()
    normalized["docs_url"] = str(normalized.get("docs_url") or "").strip() or None
    options = normalized.get("generation_options")
    normalized["generation_options"] = options if isinstance(options, list) else []
    return normalized


def _merge_gateway_models(
    catalog_models: list[dict[str, Any]],
    gateway_models: list[dict[str, Any]],
    purpose: str,
) -> list[dict[str, Any]]:
    merged = {str(item.get("id")): _ensure_defaults(item, purpose) for item in catalog_models if str(item.get("id") or "").strip()}
    gateway_ids = {str(item.get("id") or "").strip() for item in gateway_models if str(item.get("id") or "").strip()}

    for model in gateway_models:
        model_id = str(model.get("id") or "").strip()
        if not model_id:
            continue
        incoming = _ensure_defaults(
            {
                "id": model_id,
                "name": model.get("name") or model_id,
                "provider": model.get("provider") or "unknown",
                "purpose": purpose,
                "media_type_support": model.get("media_type_support") or [],
                "default_for_media_type": model.get("default_for_media_type"),
                "status": model.get("status") or "active",
                "docs_url": model.get("docs_url"),
            },
            purpose,
        )
        existing = merged.get(model_id)
        if not existing:
            merged[model_id] = incoming
            continue

        # Preserve curated metadata when present; fill blanks from gateway.
        existing["name"] = existing.get("name") or incoming.get("name")
        existing["provider"] = existing.get("provider") or incoming.get("provider")
        if not existing.get("media_type_support"):
            existing["media_type_support"] = incoming.get("media_type_support") or []
        if not existing.get("default_for_media_type"):
            existing["default_for_media_type"] = incoming.get("default_for_media_type")
        if not existing.get("docs_url"):
            existing["docs_url"] = incoming.get("docs_url")
        merged[model_id] = existing

    rows = list(merged.values())
    if purpose == PURPOSE_OBJECT_IMAGE and gateway_ids:
        # When gateway media models are available, treat gateway as source-of-truth.
        rows = [row for row in rows if str(row.get("id") or "").strip() in gateway_ids]
    elif purpose == PURPOSE_OBJECT_IMAGE:
        allowlist = {
            "fal-ai/flux/schnell",
            "fal-ai/flux/dev",
            "fal-ai/flux-pro",
            "fal-ai/flux-pro/v1.1-ultra",
            "fal-ai/flux-2-pro",
            "fal-ai/flux-lora",
            "fal-ai/nano-banana-2",
            "fal-ai/nano-banana-pro",
            "fal-ai/nano-banana",
            "fal-ai/imagen4/preview",
            "fal-ai/gpt-image-1.5",
            "fal-ai/gpt-image-1.5/edit",
            "fal-ai/recraft/v3/text-to-image",
            "fal-ai/ideogram/v3",
            "fal-ai/seedream-v45",
            "fal-ai/stable-diffusion-v35-medium",
            "xai/grok-imagine-image",
            "fal-ai/sana",
        }
        rows = [row for row in rows if str(row.get("id") or "").strip() in allowlist]
    if purpose == PURPOSE_VISUALIZE_VIDEO and gateway_ids:
        # When gateway media models are available, treat gateway as source-of-truth.
        rows = [row for row in rows if str(row.get("id") or "").strip() in gateway_ids]
    elif purpose == PURPOSE_VISUALIZE_VIDEO:
        allowlist = {
            "fal-ai/veo3/image-to-video",
            "fal-ai/veo3.1/image-to-video",
            "wan/v2.6/image-to-video",
            "fal-ai/wan-i2v",
            "fal-ai/kling-video/v2.5/turbo-pro/image-to-video",
            "fal-ai/kling-video/v3/pro/image-to-video",
            "xai/grok-imagine-video/image-to-video",
            "fal-ai/minimax-hailuo-02/image-to-video",
        }
        rows = [row for row in rows if str(row.get("id") or "").strip() in allowlist]
    rows.sort(key=lambda m: (0 if m.get("default_for_media_type") else 1, str(m.get("name") or m.get("id") or "")))
    return rows


def build_model_catalog(
    *,
    fiab_text_gateway_models: list[dict[str, Any]] | None = None,
    object_image_gateway_models: list[dict[str, Any]] | None = None,
    visualize_video_gateway_models: list[dict[str, Any]] | None = None,
    sound_music_gateway_models: list[dict[str, Any]] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    seeded = deepcopy(_seeded_models())
    by_purpose: dict[str, list[dict[str, Any]]] = {purpose: [] for purpose in ALL_PURPOSES}
    for model in seeded:
        purpose = str(model.get("purpose") or "").strip()
        if purpose in by_purpose:
            by_purpose[purpose].append(model)

    return {
        PURPOSE_FIAB_TEXT: _merge_gateway_models(
            by_purpose[PURPOSE_FIAB_TEXT], fiab_text_gateway_models or [], PURPOSE_FIAB_TEXT
        ),
        PURPOSE_OBJECT_IMAGE: _merge_gateway_models(
            by_purpose[PURPOSE_OBJECT_IMAGE], object_image_gateway_models or [], PURPOSE_OBJECT_IMAGE
        ),
        PURPOSE_VISUALIZE_VIDEO: _merge_gateway_models(
            by_purpose[PURPOSE_VISUALIZE_VIDEO], visualize_video_gateway_models or [], PURPOSE_VISUALIZE_VIDEO
        ),
        PURPOSE_SOUND_MUSIC: _merge_gateway_models(
            by_purpose[PURPOSE_SOUND_MUSIC], sound_music_gateway_models or [], PURPOSE_SOUND_MUSIC
        ),
    }


def find_model(catalog: dict[str, list[dict[str, Any]]], model_id: str | None) -> dict[str, Any] | None:
    model_key = (model_id or "").strip()
    if not model_key:
        return None
    for purpose in ALL_PURPOSES:
        for model in catalog.get(purpose, []):
            if str(model.get("id") or "").strip() == model_key:
                return model
    return None


def model_supports_media_type(model: dict[str, Any] | None, media_type: str) -> bool:
    if not model:
        return False
    supported = model.get("media_type_support")
    if not isinstance(supported, list):
        return False
    normalized = (media_type or "").strip().lower()
    return normalized in [str(item).strip().lower() for item in supported]
