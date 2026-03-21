"""
Video history API for Visualize: list/create/patch/delete per tram line.
Prefix: /api/video-history.
"""
import json
from io import BytesIO
import uuid
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from db import get_session
from config import load_settings
from credits import apply_credit_cost, ensure_user_can_generate, extract_credit_cost
from gateway_client import GatewayClient, GatewayClientError
from media_handler_client import MediaHandlerClient, MediaHandlerClientError
from model_catalog import (
    MEDIA_IMAGE_TO_VIDEO,
    PURPOSE_VISUALIZE_VIDEO,
    build_model_catalog,
    find_model,
    model_supports_media_type,
)
from models import (
    GatewayUsageEvent,
    MoodBoardCompiledVideo,
    MoodBoardVideoHistory,
    ProjectMember,
    Scene,
    Script,
    TramLine,
)
from storage import delete_storage_file, get_storage_access_url, save_moodboard_video
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

router = APIRouter(prefix="/api/video-history", tags=["video-history"])
settings = load_settings()


def _trace(event: str, **fields: object) -> None:
    safe_fields: dict[str, object] = {}
    for key, value in fields.items():
        if isinstance(value, str):
            safe_fields[key] = value if len(value) <= 600 else f"{value[:600]}...(truncated)"
        else:
            safe_fields[key] = value
    try:
        print(f"[video_history.{event}] {json.dumps(safe_fields, ensure_ascii=False, default=str)}")
    except Exception:
        print(f"[video_history.{event}] {safe_fields}")


def _ensure_tramline_access(db: Session, tramline_id: str, user_id: str) -> TramLine:
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
    return line


def _project_id_for_tramline(db: Session, line: TramLine) -> uuid.UUID:
    scene = db.get(Scene, line.scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    script = db.get(Script, scene.script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    return script.project_id


def _ensure_video_access(db: Session, video_id: str, user_id: str) -> MoodBoardVideoHistory:
    video = db.get(MoodBoardVideoHistory, uuid.UUID(video_id))
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    _ensure_tramline_access(db, str(video.tram_line_id), user_id)
    return video


def _video_to_item(v: MoodBoardVideoHistory, credit_cost: Optional[int] = None) -> dict:
    status = "completed" if v.video_path else ("processing" if v.task_id else "pending")
    return {
        "id": str(v.id),
        "tram_line_id": str(v.tram_line_id),
        "user_id": v.user_id,
        "video_path": v.video_path,
        "task_id": v.task_id,
        "generation_method": v.generation_method,
        "prompt": v.prompt,
        "aspect_ratio": v.aspect_ratio,
        "duration": v.duration,
        "take_number": v.take_number,
        "Channel": v.channel,
        "source_type": v.source_type,
        "source_image_path": v.source_image_path,
        "source_video_id": v.source_video_id,
        "is_print": v.is_print,
        "status": status,
        "credit_cost": credit_cost,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


def _gateway_client() -> GatewayClient:
    return GatewayClient(
        base_url=settings.gateway_base_url,
        api_key=settings.gateway_internal_api_key,
        timeout_seconds=settings.gateway_timeout_seconds,
        verify_tls=settings.gateway_verify_tls,
    )


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


def _video_model_catalog(client: GatewayClient) -> dict[str, list[dict]]:
    return build_model_catalog(
        visualize_video_gateway_models=client.get_visualize_video_models()
    )


def _resolve_video_model_id(
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
        if not model_supports_media_type(model, MEDIA_IMAGE_TO_VIDEO):
            raise HTTPException(
                status_code=400,
                detail=f"Model '{candidate}' does not support media_type '{MEDIA_IMAGE_TO_VIDEO}'.",
            )
        if str(model.get("status") or "active").strip().lower() not in {"active", "beta"}:
            raise HTTPException(
                status_code=400,
                detail=f"Model '{candidate}' is not active.",
            )
        return candidate

    for item in catalog.get(PURPOSE_VISUALIZE_VIDEO, []):
        if str(item.get("default_for_media_type") or "").strip().lower() == MEDIA_IMAGE_TO_VIDEO:
            return str(item.get("id") or "").strip() or None
    return None


def _media_handler_client() -> MediaHandlerClient:
    return MediaHandlerClient(
        base_url=settings.media_handler_base_url,
        api_key=settings.media_handler_internal_api_key,
        timeout_seconds=settings.media_handler_timeout_seconds,
        verify_tls=settings.media_handler_verify_tls,
    )


def _extract_video_path(result: object) -> Optional[str]:
    def looks_like_video_url(value: str) -> bool:
        lowered = value.lower()
        if not (lowered.startswith("http://") or lowered.startswith("https://")):
            return False
        # Prefer clearly video-like URLs to avoid selecting source image URLs.
        video_tokens = (".mp4", ".webm", ".mov", "/video", "content_type=video", "video/mp4")
        return any(token in lowered for token in video_tokens)

    def looks_like_any_url(value: str) -> bool:
        lowered = value.lower()
        return lowered.startswith("http://") or lowered.startswith("https://")

    def walk(node: object) -> Optional[str]:
        if isinstance(node, str):
            value = node.strip()
            return value if looks_like_video_url(value) else None
        if isinstance(node, dict):
            for key in ("video_url", "url", "output_url", "download_url", "file_url"):
                value = node.get(key)
                if not isinstance(value, str):
                    continue
                candidate = value.strip()
                if key == "video_url" and looks_like_any_url(candidate):
                    return candidate
                if looks_like_video_url(candidate):
                    return candidate
            files = node.get("files")
            if isinstance(files, list):
                for item in files:
                    # Fal-style payloads often return [{"url": "...", "content_type": "video/mp4"}].
                    # Accept those even when URL path does not include a video-like token.
                    if isinstance(item, dict):
                        file_url = item.get("url") or item.get("file_url") or item.get("download_url")
                        content_type = str(item.get("content_type") or item.get("mime_type") or "").lower()
                        if isinstance(file_url, str):
                            candidate = file_url.strip()
                            if looks_like_any_url(candidate) and ("video" in content_type or looks_like_video_url(candidate)):
                                return candidate
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

    return walk(result)


def _extract_result_payload(response: object) -> dict:
    if isinstance(response, dict):
        result = response.get("result")
        if isinstance(result, dict):
            return result
        data = response.get("data")
        if isinstance(data, dict):
            nested = data.get("result")
            if isinstance(nested, dict):
                return nested
            return data
        return response
    return {}


def _first_non_empty_string(*values: object) -> Optional[str]:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_gateway_response_fields(response: dict) -> tuple[Optional[str], Optional[str], Optional[str], dict]:
    """
    Parse multiple known gateway response shapes and return:
    (job_id, job_status, error_message, result_dict)
    """
    if not isinstance(response, dict):
        return None, None, "Gateway response is not a JSON object.", {}

    nested_data = response.get("data") if isinstance(response.get("data"), dict) else {}
    nested_job = response.get("job") if isinstance(response.get("job"), dict) else {}
    nested_result = response.get("result") if isinstance(response.get("result"), dict) else {}
    nested_data_result = nested_data.get("result") if isinstance(nested_data.get("result"), dict) else {}

    job_id = _first_non_empty_string(
        response.get("job_id"),
        response.get("task_id"),
        response.get("request_id"),
        nested_data.get("job_id"),
        nested_data.get("task_id"),
        nested_data.get("request_id"),
        nested_job.get("id"),
        nested_job.get("job_id"),
        nested_result.get("job_id"),
        nested_data_result.get("job_id"),
    )
    job_status = _first_non_empty_string(
        response.get("job_status"),
        response.get("status"),
        nested_data.get("job_status"),
        nested_data.get("status"),
        nested_job.get("status"),
    )
    error_message = _first_non_empty_string(
        response.get("error"),
        response.get("detail"),
        response.get("message"),
        nested_data.get("error"),
        nested_data.get("detail"),
        nested_data.get("message"),
        nested_result.get("error"),
        nested_data_result.get("error"),
    )

    # Prefer explicit result payload, then data.result, then whole response.
    result_dict = nested_result or nested_data_result or response
    return job_id, job_status, error_message, result_dict if isinstance(result_dict, dict) else {}


def _should_fallback_to_default_model(error_text: str) -> bool:
    text = (error_text or "").lower()
    fallback_markers = (
        "not in allowlist",
        "model not allowed",
        "unknown media_type",
        "unknown model",
        "invalid model",
        "unsupported model",
        "not found",
    )
    return any(marker in text for marker in fallback_markers)


def _normalize_video_aspect_ratio(aspect_ratio: Optional[str]) -> str:
    """
    Normalize UI/project aspect ratios to Fal-supported values:
    16:9, 9:16, 4:3, 3:4, 21:9, 9:21
    """
    value = (aspect_ratio or "").strip()
    if not value:
        return "16:9"
    mapping = {
        "2.39:1": "21:9",
        "2.35:1": "21:9",
        "1:2.39": "9:21",
        "1:2.35": "9:21",
    }
    value = mapping.get(value, value)
    allowed = {"16:9", "9:16", "4:3", "3:4", "21:9", "9:21"}
    return value if value in allowed else "16:9"


def _normalize_gateway_job_status(raw_status: Optional[str]) -> str:
    value = (raw_status or "").strip().lower()
    if not value:
        return "processing"
    if value in {"completed", "complete", "succeeded", "success", "done", "finished"}:
        return "completed"
    if value in {"failed", "error", "cancelled", "canceled", "rejected"}:
        return "failed"
    if value in {"processing", "pending", "queued", "in_progress", "running", "submitted"}:
        return "processing"
    return value


def _normalize_payload_for_model(
    *,
    model_id: Optional[str],
    payload: dict,
    model_options: Optional[dict[str, Any]] = None,
) -> dict:
    """
    Apply model-specific input constraints before sending to gateway/FAL.

    Model families with distinct contracts are normalized here:
    - Veo: duration "4s|6s|8s", aspect_ratio 16:9|9:16, plus
      resolution/generate_audio/safety_tolerance.
    - MiniMax/Hailuo: duration "5|10", resolution/prompt_optimizer.
    - Wan: duration "5|10|15", resolution/enable_prompt_rewriting.
    - Kling: duration "5|10", aspect_ratio + cfg_scale.
    """
    normalized = {
        "prompt": str(payload.get("prompt") or "").strip(),
        "image_url": str(payload.get("image_url") or "").strip(),
    }
    model_key = (model_id or "").strip().lower()
    source_aspect = str(payload.get("aspect_ratio") or "").strip() or "16:9"
    source_duration_raw = payload.get("duration")

    def _duration_int(value: object) -> Optional[int]:
        try:
            if value is None:
                return None
            return int(str(value).strip().lower().replace("s", ""))
        except Exception:
            return None

    duration_int = _duration_int(source_duration_raw)
    requested = model_options or {}

    def _apply_requested_overrides(
        values: dict,
        *,
        allowed_keys: set[str],
    ) -> dict:
        for key, value in requested.items():
            if key in allowed_keys:
                values[key] = value
        return values

    # Veo family: duration uses "4s|6s|8s", aspect is 16:9/9:16/auto.
    if "veo3" in model_key:
        if source_aspect in {"9:16", "9:21"}:
            normalized["aspect_ratio"] = "9:16"
        else:
            normalized["aspect_ratio"] = "16:9"
        if duration_int is not None:
            if duration_int <= 4:
                normalized["duration"] = "4s"
            elif duration_int <= 6:
                normalized["duration"] = "6s"
            else:
                normalized["duration"] = "8s"
        normalized["resolution"] = "720p"
        normalized["generate_audio"] = True
        normalized["safety_tolerance"] = "4"
        return _apply_requested_overrides(
            normalized,
            allowed_keys={"duration", "aspect_ratio", "resolution", "generate_audio", "safety_tolerance", "negative_prompt", "auto_fix", "seed"},
        )

    # MiniMax/Hailuo family: duration enum as strings (5/10), no aspect_ratio field.
    if "minimax" in model_key or "hailuo" in model_key:
        if duration_int is not None:
            normalized["duration"] = "10" if duration_int >= 8 else "5"
        normalized["resolution"] = "768P"
        normalized["prompt_optimizer"] = True
        return _apply_requested_overrides(
            normalized,
            allowed_keys={"duration", "resolution", "prompt_optimizer", "end_image_url", "seed"},
        )

    # Wan family: duration enum 5/10/15, plus optional prompt rewriting.
    if model_key.startswith("wan/") or "wan-i2v" in model_key:
        if duration_int is not None:
            if duration_int <= 5:
                normalized["duration"] = "5"
            elif duration_int <= 10:
                normalized["duration"] = "10"
            else:
                normalized["duration"] = "15"
        normalized["resolution"] = "720p"
        normalized["enable_prompt_rewriting"] = True
        return _apply_requested_overrides(
            normalized,
            allowed_keys={"duration", "resolution", "enable_prompt_rewriting", "negative_prompt", "audio_url", "seed"},
        )

    # Kling family: duration enum typically 5/10, supports aspect ratio and cfg_scale.
    if "kling-video" in model_key:
        if source_aspect in {"9:16", "9:21"}:
            normalized["aspect_ratio"] = "9:16"
        elif source_aspect == "1:1":
            normalized["aspect_ratio"] = "1:1"
        else:
            normalized["aspect_ratio"] = "16:9"
        if duration_int is not None:
            normalized["duration"] = "10" if duration_int >= 8 else "5"
        normalized["cfg_scale"] = 0.5
        return _apply_requested_overrides(
            normalized,
            allowed_keys={"duration", "aspect_ratio", "negative_prompt", "cfg_scale", "special_fx", "seed"},
        )

    # Conservative fallback for unknown i2v models.
    if source_aspect in {"9:16", "9:21"}:
        normalized["aspect_ratio"] = "9:16"
    else:
        normalized["aspect_ratio"] = "16:9"
    if duration_int is not None:
        normalized["duration"] = str(duration_int)
    return _apply_requested_overrides(
        normalized,
        allowed_keys={"duration", "aspect_ratio", "negative_prompt", "seed"},
    )


def _coerce_bool(value: object, *, key: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    raise HTTPException(status_code=400, detail=f"model_options.{key} must be a boolean.")


def _sanitize_model_options(model: Optional[dict], requested: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not requested:
        return {}
    if not isinstance(requested, dict):
        raise HTTPException(status_code=400, detail="model_options must be a JSON object.")

    options = model.get("generation_options") if isinstance(model, dict) else None
    descriptors = options if isinstance(options, list) else []
    descriptor_by_key: dict[str, dict] = {}
    for item in descriptors:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        if key:
            descriptor_by_key[key] = item

    if not descriptor_by_key:
        raise HTTPException(status_code=400, detail="Selected model does not support additional options.")

    sanitized: dict[str, Any] = {}
    for key, value in requested.items():
        descriptor = descriptor_by_key.get(key)
        if not descriptor:
            raise HTTPException(status_code=400, detail=f"model_options.{key} is not supported for this model.")
        kind = str(descriptor.get("type") or "text").strip().lower()
        if kind == "enum":
            choices = [str(choice) for choice in descriptor.get("choices") or []]
            candidate = str(value).strip()
            if choices and candidate not in choices:
                raise HTTPException(status_code=400, detail=f"model_options.{key} must be one of {choices}.")
            sanitized[key] = candidate
        elif kind == "boolean":
            sanitized[key] = _coerce_bool(value, key=key)
        elif kind == "number":
            try:
                sanitized[key] = float(value)
            except Exception:
                raise HTTPException(status_code=400, detail=f"model_options.{key} must be a number.")
        else:
            sanitized[key] = str(value).strip()
    return sanitized


def _normalize_storage_key(path_or_url: Optional[str]) -> Optional[str]:
    value = (path_or_url or "").strip()
    if not value:
        return None
    marker = "/api/storage/"
    idx = value.find(marker)
    if idx >= 0:
        return value[idx + len(marker):].split("?")[0]
    if value.startswith("http://") or value.startswith("https://") or value.startswith("data:"):
        return None
    return value


def _to_storage_or_url(value: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """
    Convert a path/URL to either a relative storage key or keep as external URL.
    Returns (storage_key, external_url).
    """
    trimmed = (value or "").strip()
    if not trimmed:
        return (None, None)
    marker = "/api/storage/"
    idx = trimmed.find(marker)
    if idx >= 0:
        return (trimmed[idx + len(marker):].split("?")[0], None)
    if trimmed.startswith("http://") or trimmed.startswith("https://"):
        return (None, trimmed)
    if trimmed.startswith("data:"):
        return (None, None)
    return (trimmed, None)


def _resolve_image_url_for_generation(
    *,
    source_image_path: Optional[str],
    source_image_data_url: Optional[str],
) -> Optional[str]:
    data_or_url = (source_image_data_url or "").strip()
    if data_or_url.startswith("http://") or data_or_url.startswith("https://"):
        return data_or_url

    path_value = (source_image_path or "").strip()
    if not path_value:
        return None
    if path_value.startswith("http://") or path_value.startswith("https://"):
        return path_value
    if path_value.startswith("data:image/"):
        return None

    # Internal storage key -> convert to signed URL.
    return get_storage_access_url(path_value)


def _detect_video_ext(video_url: str, content_type: Optional[str]) -> str:
    lowered_type = (content_type or "").lower()
    if "video/mp4" in lowered_type:
        return "mp4"
    if "video/webm" in lowered_type:
        return "webm"
    if "quicktime" in lowered_type or "video/mov" in lowered_type:
        return "mov"
    lowered_url = (video_url or "").lower()
    for ext in ("mp4", "webm", "mov"):
        if f".{ext}" in lowered_url:
            return ext
    return "mp4"


def _ingest_video_to_storage(
    *,
    source_video_url: Optional[str],
    user_id: str,
    project_id: str,
    scene_id: str,
    tram_line_id: str,
) -> Optional[str]:
    """
    Download provider video URL and copy it into project-scoped storage.
    Falls back to original URL on any ingest failure.
    """
    source = (source_video_url or "").strip()
    if not source:
        return None
    # Already a storage key/path.
    if not source.startswith("http://") and not source.startswith("https://"):
        return source
    try:
        response = httpx.get(
            source,
            timeout=max(30.0, settings.gateway_timeout_seconds * 2),
            follow_redirects=True,
            headers={"User-Agent": "MovieShakerEngine/1.0"},
        )
        response.raise_for_status()
        content = response.content
        if not content:
            _trace("ingest_video.empty_content", source_video_url=source)
            return source
        ext = _detect_video_ext(source, response.headers.get("content-type"))
        filename = f"{uuid.uuid4().hex}.{ext}"
        key = save_moodboard_video(
            user_id=user_id,
            project_id=project_id,
            scene_id=scene_id,
            tram_line_id=tram_line_id,
            filename=filename,
            content=BytesIO(content),
            size=len(content),
        )
        _trace("ingest_video.saved", source_video_url=source, storage_key=key, size=len(content))
        return key
    except Exception as exc:
        _trace("ingest_video.failed", source_video_url=source, error=str(exc))
        return source


def _create_usage_event(
    db: Session,
    *,
    user_id: str,
    project_id: uuid.UUID,
    tram_line_id: uuid.UUID,
    video_history_id: Optional[uuid.UUID],
    gateway_job_id: Optional[str],
    model: Optional[str],
    media_type: Optional[str],
    status: str,
    estimate: Optional[dict] = None,
    actual_usage: Optional[dict] = None,
    raw_response: Optional[dict] = None,
) -> None:
    if gateway_job_id and video_history_id and status in {"completed", "failed"}:
        existing = db.exec(
            select(GatewayUsageEvent).where(
                GatewayUsageEvent.gateway_job_id == gateway_job_id,
                GatewayUsageEvent.video_history_id == video_history_id,
                GatewayUsageEvent.status == status,
            )
        ).first()
        if existing:
            return
    row = GatewayUsageEvent(
        user_id=user_id,
        project_id=project_id,
        tram_line_id=tram_line_id,
        video_history_id=video_history_id,
        gateway_job_id=gateway_job_id,
        model=model,
        media_type=media_type,
        status=status,
        estimate_json=json.dumps(estimate) if estimate is not None else None,
        actual_usage_json=json.dumps(actual_usage) if actual_usage is not None else None,
        raw_response_json=json.dumps(raw_response) if raw_response is not None else None,
    )
    db.add(row)


def _video_credit_cost_map(db: Session, video_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not video_ids:
        return {}
    events = list(
        db.exec(
            select(GatewayUsageEvent).where(
                GatewayUsageEvent.video_history_id.in_(video_ids)
            )
        ).all()
    )
    rank = {"completed": 3, "failed": 3, "processing": 2, "submitted": 1}
    chosen: dict[uuid.UUID, tuple[int, int]] = {}
    for event in events:
        video_id = event.video_history_id
        if video_id is None:
            continue
        cost = extract_credit_cost(
            event.actual_usage_json
            or event.estimate_json
            or event.raw_response_json
            or {}
        )
        priority = rank.get((event.status or "").lower(), 0)
        existing = chosen.get(video_id)
        if existing is None or priority > existing[0]:
            chosen[video_id] = (priority, cost)
    return {video_id: data[1] for video_id, data in chosen.items()}


class CreateVideoHistoryBody(BaseModel):
    tram_line_id: str
    task_id: Optional[str] = None
    generation_method: str = "gateway_fal"
    prompt: Optional[str] = None
    aspect_ratio: Optional[str] = None
    duration: Optional[int] = None
    take_number: Optional[int] = None
    channel: Optional[int] = None
    video_path: str = ""
    source_type: Optional[str] = None
    source_image_path: Optional[str] = None
    source_video_id: Optional[str] = None
    is_print: bool = False


class GenerateVideoBody(BaseModel):
    tram_line_id: str
    prompt: Optional[str] = None
    aspect_ratio: Optional[str] = None
    duration: Optional[int] = None
    channel: Optional[int] = None
    take_number: Optional[int] = None
    model: Optional[str] = None
    media_type: str = "image-to-video"
    source_image_path: Optional[str] = None
    source_image_data_url: Optional[str] = None
    model_options: Optional[dict[str, Any]] = None
    dry_run: bool = False


class ContinueVideoBody(BaseModel):
    source_video_id: str
    mode: str = "same_channel"  # same_channel | new_channel
    prompt: Optional[str] = None
    aspect_ratio: Optional[str] = None
    duration: Optional[int] = None
    model: Optional[str] = None
    media_type: str = "image-to-video"
    model_options: Optional[dict[str, Any]] = None
    dry_run: bool = False


@router.post("/generate")
def generate_video(
    body: GenerateVideoBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _trace(
        "generate.start",
        user_id=user_id,
        tram_line_id=body.tram_line_id,
        model=body.model,
        duration=body.duration,
        aspect_ratio=body.aspect_ratio,
        media_type=body.media_type,
        has_model_options=bool(body.model_options),
    )
    ensure_user_can_generate(db, user_id)
    line = _ensure_tramline_access(db, body.tram_line_id, user_id)
    project_id = _project_id_for_tramline(db, line)

    if body.duration is not None and body.duration <= 0:
        raise HTTPException(status_code=400, detail="duration must be greater than 0")
    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")

    prompt = (body.prompt or line.action_text or "").strip()
    if not prompt:
        prompt = "Preserve the source image subject and scene."
    if line.shot_type:
        prompt = f"{prompt} Shot type: {line.shot_type}."
    if line.camera_direction:
        prompt = f"{prompt} Camera direction: {line.camera_direction}."

    source_image_path = (body.source_image_path or line.scene_visual or "").strip() or None
    resolved_image_url = _resolve_image_url_for_generation(
        source_image_path=source_image_path,
        source_image_data_url=body.source_image_data_url,
    )
    if not resolved_image_url:
        raise HTTPException(status_code=400, detail="A source image is required to generate video")
    _trace(
        "generate.source",
        source_image_path=source_image_path,
        resolved_image_url=resolved_image_url,
    )
    normalized_aspect_ratio = _normalize_video_aspect_ratio(body.aspect_ratio)
    requested_media_type = (body.media_type or "image-to-video").strip().lower()
    if requested_media_type != "image-to-video":
        raise HTTPException(status_code=400, detail="media_type must be image-to-video")
    payload: dict = {
        "prompt": prompt,
        "aspect_ratio": normalized_aspect_ratio,
    }
    if body.duration:
        payload["duration"] = body.duration
    payload["image_url"] = resolved_image_url

    gateway = _gateway_client()
    catalog = _video_model_catalog(gateway)
    selected_model = _resolve_video_model_id(
        catalog=catalog,
        explicit_model=(body.model or None),
    )
    selected_model_meta = find_model(catalog, selected_model) if selected_model else None
    sanitized_model_options = _sanitize_model_options(selected_model_meta, body.model_options)
    _trace(
        "generate.model",
        selected_model=selected_model,
        sanitized_model_options=sanitized_model_options,
    )
    model_payload = _normalize_payload_for_model(
        model_id=selected_model,
        payload=payload,
        model_options=sanitized_model_options,
    )
    _trace("generate.payload", model_payload=model_payload)
    try:
        request_body = _gateway_execute_body(
            media_type="image-to-video",
            payload=model_payload,
            model=selected_model,
            dry_run=body.dry_run,
        )
        # Temporary diagnostics for troubleshooting missing provider requests.
        print(f"[video_history.generate] gateway execute body: {json.dumps(request_body, ensure_ascii=False)}")
        response = gateway.execute_fal(
            media_type="image-to-video",
            payload=model_payload,
            model=selected_model,
            dry_run=body.dry_run,
        )
        _trace("generate.gateway_submit_response", response_keys=sorted(response.keys()) if isinstance(response, dict) else str(type(response)))
    except GatewayClientError as exc:
        error_text = str(exc)
        if not selected_model or not _should_fallback_to_default_model(error_text):
            raise HTTPException(status_code=502, detail=error_text)
        # If selected model is invalid/unavailable in gateway, retry on default route.
        request_body = _gateway_execute_body(
            media_type="image-to-video",
            payload=model_payload,
            model=None,
            dry_run=body.dry_run,
        )
        print(f"[video_history.generate] gateway execute fallback body: {json.dumps(request_body, ensure_ascii=False)}")
        try:
            response = gateway.execute_fal(
                media_type="image-to-video",
                payload=model_payload,
                model=None,
                dry_run=body.dry_run,
            )
            _trace("generate.gateway_fallback_response", response_keys=sorted(response.keys()) if isinstance(response, dict) else str(type(response)))
        except GatewayClientError:
            raise HTTPException(
                status_code=502,
                detail=f"Selected video model '{selected_model}' is unavailable and default fallback failed: {error_text}",
            )

    gateway_job_id, parsed_job_status, gateway_error, gateway_result = _extract_gateway_response_fields(response)
    job_status = parsed_job_status or ("completed" if body.dry_run else "processing")
    direct_video_path = _extract_video_path(gateway_result)
    if (
        selected_model
        and gateway_error
        and not gateway_job_id
        and not direct_video_path
        and _should_fallback_to_default_model(gateway_error)
    ):
        # Some gateway versions return model errors as 200 JSON payloads
        # (e.g. {"status": "...", "message": "..."}). Retry default route.
        request_body = _gateway_execute_body(
            media_type="image-to-video",
            payload=model_payload,
            model=None,
            dry_run=body.dry_run,
        )
        print(f"[video_history.generate] gateway execute soft-error fallback body: {json.dumps(request_body, ensure_ascii=False)}")
        try:
            response = gateway.execute_fal(
                media_type="image-to-video",
                payload=model_payload,
                model=None,
                dry_run=body.dry_run,
            )
            _trace("generate.gateway_soft_fallback_response", response_keys=sorted(response.keys()) if isinstance(response, dict) else str(type(response)))
            gateway_job_id, parsed_job_status, gateway_error, gateway_result = _extract_gateway_response_fields(response)
            job_status = parsed_job_status or ("completed" if body.dry_run else "processing")
            direct_video_path = _extract_video_path(gateway_result)
        except GatewayClientError:
            raise HTTPException(
                status_code=502,
                detail=f"Selected video model '{selected_model}' soft-failed and default fallback failed: {gateway_error}",
            )
    if not gateway_job_id and not direct_video_path:
        detail = gateway_error or "Gateway did not return a job identifier."
        raise HTTPException(
            status_code=502,
            detail=f"{detail} model={selected_model or 'default'} keys={sorted(response.keys())}",
        )
    if gateway_error and str(job_status).strip().lower() in {"failed", "error", "cancelled"}:
        raise HTTPException(status_code=502, detail=gateway_error)
    persisted_video_path = _ingest_video_to_storage(
        source_video_url=direct_video_path,
        user_id=user_id,
        project_id=str(project_id),
        scene_id=str(line.scene_id),
        tram_line_id=body.tram_line_id,
    )
    _trace(
        "generate.gateway_parsed",
        gateway_job_id=gateway_job_id,
        job_status=job_status,
        direct_video_path=direct_video_path,
        persisted_video_path=persisted_video_path,
        gateway_error=gateway_error,
    )
    estimate = response.get("estimate")
    routing = response.get("routing") if isinstance(response.get("routing"), dict) else {}
    model_used = selected_model or routing.get("model")

    row = MoodBoardVideoHistory(
        tram_line_id=uuid.UUID(body.tram_line_id),
        user_id=user_id,
        video_path=(persisted_video_path or ""),
        task_id=gateway_job_id,
        generation_method="gateway_image-to-video",
        prompt=prompt,
        aspect_ratio=normalized_aspect_ratio,
        duration=body.duration,
        take_number=body.take_number,
        channel=body.channel,
        source_type="image",
        source_image_path=source_image_path,
        is_print=False,
    )
    db.add(row)
    db.flush()

    _create_usage_event(
        db,
        user_id=user_id,
        project_id=project_id,
        tram_line_id=uuid.UUID(body.tram_line_id),
        video_history_id=row.id,
        gateway_job_id=gateway_job_id,
        model=model_used,
        media_type="image-to-video",
        status=job_status,
        estimate=estimate if isinstance(estimate, dict) else None,
        raw_response=response if isinstance(response, dict) else None,
    )

    credits_cost = extract_credit_cost(response)
    balance = apply_credit_cost(db, user_id, credits_cost)

    db.commit()
    db.refresh(row)
    _trace(
        "generate.saved",
        video_history_id=str(row.id),
        task_id=row.task_id,
        video_path=row.video_path,
        job_status=job_status,
    )
    return {
        "success": True,
        "video": _video_to_item(row),
        "gateway": {
            "job_id": gateway_job_id,
            "job_status": job_status,
            "estimate": estimate,
            "model_used": model_used,
            "duration_used": model_payload.get("duration"),
            "aspect_ratio_used": model_payload.get("aspect_ratio"),
            "model_options_used": sanitized_model_options,
            "image_source_used": resolved_image_url,
            "request_body": request_body,
        },
        "credits": {
            "cost": credits_cost,
            "balance": balance,
        },
    }


@router.post("/continue")
def continue_video(
    body: ContinueVideoBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _trace(
        "continue.start",
        user_id=user_id,
        source_video_id=body.source_video_id,
        mode=body.mode,
        model=body.model,
        duration=body.duration,
        aspect_ratio=body.aspect_ratio,
        has_model_options=bool(body.model_options),
    )
    if body.mode not in {"same_channel", "new_channel"}:
        raise HTTPException(status_code=400, detail="mode must be same_channel or new_channel")

    source = _ensure_video_access(db, body.source_video_id, user_id)
    line = _ensure_tramline_access(db, str(source.tram_line_id), user_id)
    project_id = _project_id_for_tramline(db, line)
    ensure_user_can_generate(db, user_id)

    if body.duration is not None and body.duration <= 0:
        raise HTTPException(status_code=400, detail="duration must be greater than 0")
    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")
    if not settings.media_handler_base_url:
        raise HTTPException(status_code=503, detail="Media-handler base URL is not configured")
    if not settings.media_handler_internal_api_key:
        raise HTTPException(status_code=503, detail="Media-handler API key is not configured")

    source_video_path = (source.video_path or "").strip()
    if not source_video_path:
        raise HTTPException(status_code=400, detail="Source video has no playable path yet")

    if body.mode == "same_channel":
        existing_same = db.exec(
            select(MoodBoardVideoHistory).where(
                MoodBoardVideoHistory.source_video_id == str(source.id),
                MoodBoardVideoHistory.channel == source.channel,
            )
        ).first()
        if existing_same:
            raise HTTPException(status_code=409, detail="Same-channel continuation already exists for this source video")

    try:
        frame = _media_handler_client().extract_last_frame(source_video_path)
    except MediaHandlerClientError as exc:
        raise HTTPException(status_code=502, detail=f"Frame extraction failed: {exc}")

    source_image_storage_key, source_image_external_url = _to_storage_or_url(frame.get("image_url"))
    source_image_data_url = frame.get("image_data_url")
    continuation_source_path = source_image_storage_key or source_image_external_url
    resolved_image_url = _resolve_image_url_for_generation(
        source_image_path=continuation_source_path,
        source_image_data_url=source_image_data_url,
    )
    if not resolved_image_url:
        raise HTTPException(status_code=400, detail="Could not resolve continuation source image")
    _trace(
        "continue.source",
        continuation_source_path=continuation_source_path,
        resolved_image_url=resolved_image_url,
    )

    prompt = (body.prompt or source.prompt or line.action_text or "").strip() or "Preserve the source image subject and continue motion naturally."
    if line.shot_type:
        prompt = f"{prompt} Shot type: {line.shot_type}."
    if line.camera_direction:
        prompt = f"{prompt} Camera direction: {line.camera_direction}."
    normalized_aspect_ratio = _normalize_video_aspect_ratio(body.aspect_ratio or source.aspect_ratio)
    requested_media_type = (body.media_type or "image-to-video").strip().lower()
    if requested_media_type != "image-to-video":
        raise HTTPException(status_code=400, detail="media_type must be image-to-video")

    rows = list(
        db.exec(
            select(MoodBoardVideoHistory).where(
                MoodBoardVideoHistory.tram_line_id == source.tram_line_id
            )
        ).all()
    )

    if body.mode == "same_channel":
        channel = source.channel if source.channel is not None else 1
        same_channel_rows = [r for r in rows if r.channel == channel]
        take_number = max((r.take_number or 0) for r in same_channel_rows) + 1
    else:
        max_channel = max((r.channel or 0) for r in rows) if rows else 0
        channel = max_channel + 1
        take_number = 1

    payload: dict = {
        "prompt": prompt,
        "aspect_ratio": normalized_aspect_ratio,
    }
    if body.duration:
        payload["duration"] = body.duration
    payload["image_url"] = resolved_image_url

    gateway = _gateway_client()
    catalog = _video_model_catalog(gateway)
    selected_model = _resolve_video_model_id(
        catalog=catalog,
        explicit_model=(body.model or None),
    )
    selected_model_meta = find_model(catalog, selected_model) if selected_model else None
    sanitized_model_options = _sanitize_model_options(selected_model_meta, body.model_options)
    _trace(
        "continue.model",
        selected_model=selected_model,
        sanitized_model_options=sanitized_model_options,
    )
    model_payload = _normalize_payload_for_model(
        model_id=selected_model,
        payload=payload,
        model_options=sanitized_model_options,
    )
    _trace("continue.payload", model_payload=model_payload)
    try:
        request_body = _gateway_execute_body(
            media_type="image-to-video",
            payload=model_payload,
            model=selected_model,
            dry_run=body.dry_run,
        )
        print(f"[video_history.continue] gateway execute body: {json.dumps(request_body, ensure_ascii=False)}")
        response = gateway.execute_fal(
            media_type="image-to-video",
            payload=model_payload,
            model=selected_model,
            dry_run=body.dry_run,
        )
        _trace("continue.gateway_submit_response", response_keys=sorted(response.keys()) if isinstance(response, dict) else str(type(response)))
    except GatewayClientError as exc:
        error_text = str(exc)
        if not selected_model or not _should_fallback_to_default_model(error_text):
            raise HTTPException(status_code=502, detail=error_text)
        request_body = _gateway_execute_body(
            media_type="image-to-video",
            payload=model_payload,
            model=None,
            dry_run=body.dry_run,
        )
        print(f"[video_history.continue] gateway execute fallback body: {json.dumps(request_body, ensure_ascii=False)}")
        try:
            response = gateway.execute_fal(
                media_type="image-to-video",
                payload=model_payload,
                model=None,
                dry_run=body.dry_run,
            )
            _trace("continue.gateway_fallback_response", response_keys=sorted(response.keys()) if isinstance(response, dict) else str(type(response)))
        except GatewayClientError:
            raise HTTPException(
                status_code=502,
                detail=f"Selected video model '{selected_model}' is unavailable and default fallback failed: {error_text}",
            )

    gateway_job_id, parsed_job_status, gateway_error, gateway_result = _extract_gateway_response_fields(response)
    job_status = parsed_job_status or ("completed" if body.dry_run else "processing")
    direct_video_path = _extract_video_path(gateway_result)
    if (
        selected_model
        and gateway_error
        and not gateway_job_id
        and not direct_video_path
        and _should_fallback_to_default_model(gateway_error)
    ):
        request_body = _gateway_execute_body(
            media_type="image-to-video",
            payload=model_payload,
            model=None,
            dry_run=body.dry_run,
        )
        print(f"[video_history.continue] gateway execute soft-error fallback body: {json.dumps(request_body, ensure_ascii=False)}")
        try:
            response = gateway.execute_fal(
                media_type="image-to-video",
                payload=model_payload,
                model=None,
                dry_run=body.dry_run,
            )
            _trace("continue.gateway_soft_fallback_response", response_keys=sorted(response.keys()) if isinstance(response, dict) else str(type(response)))
            gateway_job_id, parsed_job_status, gateway_error, gateway_result = _extract_gateway_response_fields(response)
            job_status = parsed_job_status or ("completed" if body.dry_run else "processing")
            direct_video_path = _extract_video_path(gateway_result)
        except GatewayClientError:
            raise HTTPException(
                status_code=502,
                detail=f"Selected video model '{selected_model}' soft-failed and default fallback failed: {gateway_error}",
            )
    if not gateway_job_id and not direct_video_path:
        detail = gateway_error or "Gateway did not return a job identifier."
        raise HTTPException(
            status_code=502,
            detail=f"{detail} model={selected_model or 'default'} keys={sorted(response.keys())}",
        )
    if gateway_error and str(job_status).strip().lower() in {"failed", "error", "cancelled"}:
        raise HTTPException(status_code=502, detail=gateway_error)
    persisted_video_path = _ingest_video_to_storage(
        source_video_url=direct_video_path,
        user_id=user_id,
        project_id=str(project_id),
        scene_id=str(line.scene_id),
        tram_line_id=str(source.tram_line_id),
    )
    _trace(
        "continue.gateway_parsed",
        gateway_job_id=gateway_job_id,
        job_status=job_status,
        direct_video_path=direct_video_path,
        persisted_video_path=persisted_video_path,
        gateway_error=gateway_error,
    )
    estimate = response.get("estimate")
    routing = response.get("routing") if isinstance(response.get("routing"), dict) else {}
    model_used = selected_model or routing.get("model")

    row = MoodBoardVideoHistory(
        tram_line_id=source.tram_line_id,
        user_id=user_id,
        video_path=(persisted_video_path or ""),
        task_id=gateway_job_id,
        generation_method="gateway_image-to-video",
        prompt=prompt,
        aspect_ratio=normalized_aspect_ratio,
        duration=body.duration or source.duration,
        take_number=take_number,
        channel=channel,
        source_type="video_continuation",
        source_image_path=continuation_source_path,
        source_video_id=str(source.id),
        is_print=False,
    )
    db.add(row)
    db.flush()

    _create_usage_event(
        db,
        user_id=user_id,
        project_id=project_id,
        tram_line_id=source.tram_line_id,
        video_history_id=row.id,
        gateway_job_id=gateway_job_id,
        model=model_used,
        media_type="image-to-video",
        status=job_status,
        estimate=estimate if isinstance(estimate, dict) else None,
        raw_response=response if isinstance(response, dict) else None,
    )

    credits_cost = extract_credit_cost(response)
    balance = apply_credit_cost(db, user_id, credits_cost)

    db.commit()
    db.refresh(row)
    _trace(
        "continue.saved",
        video_history_id=str(row.id),
        task_id=row.task_id,
        video_path=row.video_path,
        job_status=job_status,
    )
    return {
        "success": True,
        "video": _video_to_item(row),
        "gateway": {
            "job_id": gateway_job_id,
            "job_status": job_status,
            "estimate": estimate,
            "model_used": model_used,
            "duration_used": model_payload.get("duration"),
            "aspect_ratio_used": model_payload.get("aspect_ratio"),
            "model_options_used": sanitized_model_options,
            "image_source_used": resolved_image_url,
            "request_body": request_body,
        },
        "credits": {
            "cost": credits_cost,
            "balance": balance,
        },
    }


@router.get("/{video_id}/status")
def get_generation_status(
    video_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    row = _ensure_video_access(db, video_id, user_id)
    _trace("status.start", video_id=video_id, task_id=row.task_id, current_video_path=row.video_path)
    # If a persisted path already exists, this row is terminal from the app's perspective.
    if row.video_path:
        return {"success": True, "status": "completed", "video": _video_to_item(row)}
    if not row.task_id:
        status = "completed" if row.video_path else "pending"
        return {"success": True, "status": status, "video": _video_to_item(row)}

    try:
        gateway_status = _gateway_client().get_status(row.task_id)
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    _trace(
        "status.gateway_status",
        task_id=row.task_id,
        status_keys=sorted(gateway_status.keys()) if isinstance(gateway_status, dict) else str(type(gateway_status)),
    )

    _, parsed_job_status, parsed_error, _ = _extract_gateway_response_fields(gateway_status)
    raw_status = parsed_job_status or gateway_status.get("job_status") or gateway_status.get("status") or "processing"
    job_status = _normalize_gateway_job_status(str(raw_status))
    result = _extract_result_payload(gateway_status)
    usage = gateway_status.get("usage") if isinstance(gateway_status.get("usage"), dict) else None
    error_msg = parsed_error or gateway_status.get("error")
    video_path = _extract_video_path(result)
    _trace("status.parse", task_id=row.task_id, job_status=job_status, parsed_video_path=video_path)

    if not video_path and row.task_id and job_status != "failed":
        # Some gateway status payloads omit final output; fetch explicit result.
        try:
            final_result_response = _gateway_client().get_result(row.task_id)
            final_result = _extract_result_payload(final_result_response)
            video_path = _extract_video_path(final_result)
            if not video_path:
                video_path = _extract_video_path(final_result_response)
            _trace(
                "status.result_fallback",
                task_id=row.task_id,
                fallback_keys=sorted(final_result_response.keys()) if isinstance(final_result_response, dict) else str(type(final_result_response)),
                fallback_video_path=video_path,
            )
        except GatewayClientError:
            video_path = None
            _trace("status.result_fallback_error", task_id=row.task_id)
    if video_path and not row.video_path:
        line = _ensure_tramline_access(db, str(row.tram_line_id), user_id)
        project_id = _project_id_for_tramline(db, line)
        row.video_path = _ingest_video_to_storage(
            source_video_url=video_path,
            user_id=user_id,
            project_id=str(project_id),
            scene_id=str(line.scene_id),
            tram_line_id=str(row.tram_line_id),
        ) or video_path
        db.add(row)
        # If we have a real video URL/path, treat this job as completed regardless of
        # gateway status string shape.
        job_status = "completed"
        error_msg = None
    if job_status == "failed" and not row.video_path and error_msg:
        row.video_path = ""
        db.add(row)

    if job_status in {"completed", "failed"}:
        completed_event_exists = db.exec(
            select(GatewayUsageEvent).where(
                GatewayUsageEvent.gateway_job_id == row.task_id,
                GatewayUsageEvent.video_history_id == row.id,
                GatewayUsageEvent.status == job_status,
            )
        ).first()

        if not completed_event_exists:
            submitted_event = db.exec(
                select(GatewayUsageEvent).where(
                    GatewayUsageEvent.gateway_job_id == row.task_id,
                    GatewayUsageEvent.video_history_id == row.id,
                    GatewayUsageEvent.status == "processing",
                )
            ).first()
            estimated_cost = 0
            if submitted_event and submitted_event.estimate_json:
                estimated_cost = extract_credit_cost(submitted_event.estimate_json)
            actual_cost = extract_credit_cost(usage if usage is not None else gateway_status)
            delta_cost = actual_cost - estimated_cost
            if delta_cost != 0:
                apply_credit_cost(db, user_id, delta_cost)

        line = _ensure_tramline_access(db, str(row.tram_line_id), user_id)
        project_id = _project_id_for_tramline(db, line)
        _create_usage_event(
            db,
            user_id=user_id,
            project_id=project_id,
            tram_line_id=row.tram_line_id,
            video_history_id=row.id,
            gateway_job_id=row.task_id,
            model=None,
            media_type=row.generation_method.replace("gateway_", "", 1),
            status=job_status,
            actual_usage=usage,
            raw_response=gateway_status if isinstance(gateway_status, dict) else None,
        )

    db.commit()
    db.refresh(row)
    return {
        "success": True,
        "status": job_status,
        "error": error_msg,
        "video": _video_to_item(row),
        "gateway": gateway_status,
    }


@router.get("/{tram_line_id}")
def list_videos(
    tram_line_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_tramline_access(db, tram_line_id, user_id)
    rows = list(
        db.exec(
            select(MoodBoardVideoHistory)
            .where(MoodBoardVideoHistory.tram_line_id == uuid.UUID(tram_line_id))
            .order_by(MoodBoardVideoHistory.channel.asc(), MoodBoardVideoHistory.take_number.asc(), MoodBoardVideoHistory.created_at.asc())
        ).all()
    )
    cost_map = _video_credit_cost_map(db, [r.id for r in rows if r.id is not None])
    return {
        "success": True,
        "videos": [_video_to_item(r, cost_map.get(r.id)) for r in rows],
    }


@router.get("")
def list_videos_by_ids(
    ids: Optional[str] = Query(None, description="Comma-separated video IDs"),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    if not ids:
        return {"success": True, "videos": []}
    id_list = [x.strip() for x in ids.split(",") if x.strip()]
    if not id_list:
        return {"success": True, "videos": []}
    uuids = []
    for i in id_list:
        try:
            uuids.append(uuid.UUID(i))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid ID: {i}")
    rows = list(db.exec(select(MoodBoardVideoHistory).where(MoodBoardVideoHistory.id.in_(uuids))).all())
    for r in rows:
        _ensure_tramline_access(db, str(r.tram_line_id), user_id)
    cost_map = _video_credit_cost_map(db, [r.id for r in rows if r.id is not None])
    return {
        "success": True,
        "videos": [_video_to_item(r, cost_map.get(r.id)) for r in rows],
    }


@router.post("", status_code=201)
def create_video(
    body: CreateVideoHistoryBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_tramline_access(db, body.tram_line_id, user_id)
    row = MoodBoardVideoHistory(
        tram_line_id=uuid.UUID(body.tram_line_id),
        user_id=user_id,
        video_path=body.video_path or "",
        task_id=body.task_id,
        generation_method=body.generation_method,
        prompt=body.prompt,
        aspect_ratio=body.aspect_ratio,
        duration=body.duration,
        take_number=body.take_number,
        channel=body.channel,
        source_type=body.source_type,
        source_image_path=body.source_image_path,
        source_video_id=body.source_video_id,
        is_print=body.is_print,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"success": True, "video": _video_to_item(row)}


class PatchPrintBody(BaseModel):
    is_print: bool


@router.patch("/{video_id}/print")
def patch_print(
    video_id: str,
    body: PatchPrintBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    row = _ensure_video_access(db, video_id, user_id)
    row.is_print = body.is_print
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"success": True, "video": _video_to_item(row)}


@router.delete("/{video_id}")
def delete_video(
    video_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    row = _ensure_video_access(db, video_id, user_id)
    line = _ensure_tramline_access(db, str(row.tram_line_id), user_id)
    project_id = _project_id_for_tramline(db, line)
    video_id_str = str(row.id)

    # Remove dependent usage rows first to avoid FK violations.
    usage_rows = list(
        db.exec(
            select(GatewayUsageEvent).where(
                GatewayUsageEvent.video_history_id == row.id
            )
        ).all()
    )
    if row.task_id:
        usage_by_job = list(
            db.exec(
                select(GatewayUsageEvent).where(
                    GatewayUsageEvent.gateway_job_id == row.task_id
                )
            ).all()
        )
        known_usage_ids = {str(item.id) for item in usage_rows}
        usage_rows.extend([item for item in usage_by_job if str(item.id) not in known_usage_ids])
    for usage_row in usage_rows:
        db.delete(usage_row)

    # Remove any compiled videos that include this video as a source artifact.
    compiled_rows = list(
        db.exec(
            select(MoodBoardCompiledVideo).where(
                MoodBoardCompiledVideo.project_id == project_id
            )
        ).all()
    )
    for compiled_row in compiled_rows:
        source_ids = []
        if compiled_row.source_video_ids:
            try:
                parsed = json.loads(compiled_row.source_video_ids)
                if isinstance(parsed, list):
                    source_ids = [str(item) for item in parsed]
            except Exception:
                source_ids = []
        if video_id_str in source_ids:
            compiled_storage_key = _normalize_storage_key(compiled_row.compiled_video_path)
            if compiled_storage_key:
                delete_storage_file(compiled_storage_key)
            db.delete(compiled_row)

    # Remove stored video file when this is an internal storage path.
    video_storage_key = _normalize_storage_key(row.video_path)
    if video_storage_key:
        delete_storage_file(video_storage_key)

    db.delete(row)
    db.commit()
    return {"success": True, "video": _video_to_item(row)}
