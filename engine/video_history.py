"""
Video history API for Visualize: list/create/patch/delete per tram line.
Prefix: /api/video-history.
"""
import json
import uuid
from typing import Optional

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
from storage import delete_storage_file, get_storage_access_url
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

router = APIRouter(prefix="/api/video-history", tags=["video-history"])
settings = load_settings()


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


def _extract_video_path(result: dict) -> Optional[str]:
    files = result.get("files")
    if isinstance(files, list):
        for item in files:
            if not isinstance(item, dict):
                continue
            url = item.get("url") or item.get("download_url") or item.get("file_url")
            if isinstance(url, str) and url.strip():
                return url.strip()
    for key in ("video_url", "url", "output_url"):
        value = result.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


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
    dry_run: bool = False


class ContinueVideoBody(BaseModel):
    source_video_id: str
    mode: str = "same_channel"  # same_channel | new_channel
    prompt: Optional[str] = None
    aspect_ratio: Optional[str] = None
    duration: Optional[int] = None
    model: Optional[str] = None
    media_type: str = "image-to-video"
    dry_run: bool = False


@router.post("/generate")
def generate_video(
    body: GenerateVideoBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
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

    source_image_path = (body.source_image_path or line.scene_visual or "").strip() or None
    resolved_image_url = _resolve_image_url_for_generation(
        source_image_path=source_image_path,
        source_image_data_url=body.source_image_data_url,
    )
    if not resolved_image_url:
        raise HTTPException(status_code=400, detail="A source image is required to generate video")
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
    if line.shot_type:
        payload["shot_type"] = line.shot_type
    if line.camera_direction:
        payload["camera_direction"] = line.camera_direction

    gateway = _gateway_client()
    catalog = _video_model_catalog(gateway)
    selected_model = _resolve_video_model_id(
        catalog=catalog,
        explicit_model=(body.model or None),
    )
    try:
        request_body = _gateway_execute_body(
            media_type="image-to-video",
            payload=payload,
            model=selected_model,
            dry_run=body.dry_run,
        )
        # Temporary diagnostics for troubleshooting missing provider requests.
        print(f"[video_history.generate] gateway execute body: {json.dumps(request_body, ensure_ascii=False)}")
        response = gateway.execute_fal(
            media_type="image-to-video",
            payload=payload,
            model=selected_model,
            dry_run=body.dry_run,
        )
    except GatewayClientError as exc:
        error_text = str(exc)
        if not selected_model or not _should_fallback_to_default_model(error_text):
            raise HTTPException(status_code=502, detail=error_text)
        # If selected model is invalid/unavailable in gateway, retry on default route.
        request_body = _gateway_execute_body(
            media_type="image-to-video",
            payload=payload,
            model=None,
            dry_run=body.dry_run,
        )
        print(f"[video_history.generate] gateway execute fallback body: {json.dumps(request_body, ensure_ascii=False)}")
        try:
            response = gateway.execute_fal(
                media_type="image-to-video",
                payload=payload,
                model=None,
                dry_run=body.dry_run,
            )
        except GatewayClientError:
            raise HTTPException(
                status_code=502,
                detail=f"Selected video model '{selected_model}' is unavailable and default fallback failed: {error_text}",
            )

    gateway_job_id, parsed_job_status, gateway_error, gateway_result = _extract_gateway_response_fields(response)
    job_status = parsed_job_status or ("completed" if body.dry_run else "processing")
    direct_video_path = _extract_video_path(gateway_result)
    if not gateway_job_id and not direct_video_path:
        detail = gateway_error or "Gateway did not return a job identifier."
        raise HTTPException(
            status_code=502,
            detail=f"{detail} model={selected_model or 'default'} keys={sorted(response.keys())}",
        )
    if gateway_error and str(job_status).strip().lower() in {"failed", "error", "cancelled"}:
        raise HTTPException(status_code=502, detail=gateway_error)
    estimate = response.get("estimate")
    routing = response.get("routing") if isinstance(response.get("routing"), dict) else {}
    model_used = selected_model or routing.get("model")

    row = MoodBoardVideoHistory(
        tram_line_id=uuid.UUID(body.tram_line_id),
        user_id=user_id,
        video_path=(direct_video_path or ""),
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
    return {
        "success": True,
        "video": _video_to_item(row),
        "gateway": {
            "job_id": gateway_job_id,
            "job_status": job_status,
            "estimate": estimate,
            "model_used": model_used,
            "duration_used": body.duration,
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

    prompt = (body.prompt or source.prompt or line.action_text or "").strip() or "Preserve the source image subject and continue motion naturally."
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
    if line.shot_type:
        payload["shot_type"] = line.shot_type
    if line.camera_direction:
        payload["camera_direction"] = line.camera_direction

    gateway = _gateway_client()
    catalog = _video_model_catalog(gateway)
    selected_model = _resolve_video_model_id(
        catalog=catalog,
        explicit_model=(body.model or None),
    )
    try:
        request_body = _gateway_execute_body(
            media_type="image-to-video",
            payload=payload,
            model=selected_model,
            dry_run=body.dry_run,
        )
        print(f"[video_history.continue] gateway execute body: {json.dumps(request_body, ensure_ascii=False)}")
        response = gateway.execute_fal(
            media_type="image-to-video",
            payload=payload,
            model=selected_model,
            dry_run=body.dry_run,
        )
    except GatewayClientError as exc:
        error_text = str(exc)
        if not selected_model or not _should_fallback_to_default_model(error_text):
            raise HTTPException(status_code=502, detail=error_text)
        request_body = _gateway_execute_body(
            media_type="image-to-video",
            payload=payload,
            model=None,
            dry_run=body.dry_run,
        )
        print(f"[video_history.continue] gateway execute fallback body: {json.dumps(request_body, ensure_ascii=False)}")
        try:
            response = gateway.execute_fal(
                media_type="image-to-video",
                payload=payload,
                model=None,
                dry_run=body.dry_run,
            )
        except GatewayClientError:
            raise HTTPException(
                status_code=502,
                detail=f"Selected video model '{selected_model}' is unavailable and default fallback failed: {error_text}",
            )

    gateway_job_id, parsed_job_status, gateway_error, gateway_result = _extract_gateway_response_fields(response)
    job_status = parsed_job_status or ("completed" if body.dry_run else "processing")
    direct_video_path = _extract_video_path(gateway_result)
    if not gateway_job_id and not direct_video_path:
        detail = gateway_error or "Gateway did not return a job identifier."
        raise HTTPException(
            status_code=502,
            detail=f"{detail} model={selected_model or 'default'} keys={sorted(response.keys())}",
        )
    if gateway_error and str(job_status).strip().lower() in {"failed", "error", "cancelled"}:
        raise HTTPException(status_code=502, detail=gateway_error)
    estimate = response.get("estimate")
    routing = response.get("routing") if isinstance(response.get("routing"), dict) else {}
    model_used = selected_model or routing.get("model")

    row = MoodBoardVideoHistory(
        tram_line_id=source.tram_line_id,
        user_id=user_id,
        video_path=(direct_video_path or ""),
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
    return {
        "success": True,
        "video": _video_to_item(row),
        "gateway": {
            "job_id": gateway_job_id,
            "job_status": job_status,
            "estimate": estimate,
            "model_used": model_used,
            "duration_used": body.duration or source.duration,
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
    if not row.task_id:
        status = "completed" if row.video_path else "pending"
        return {"success": True, "status": status, "video": _video_to_item(row)}

    try:
        gateway_status = _gateway_client().get_status(row.task_id)
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    job_status = gateway_status.get("job_status", "processing")
    result = gateway_status.get("result") if isinstance(gateway_status.get("result"), dict) else {}
    usage = gateway_status.get("usage") if isinstance(gateway_status.get("usage"), dict) else None
    error_msg = gateway_status.get("error")

    if job_status == "completed" and not row.video_path:
        video_path = _extract_video_path(result)
        if video_path:
            row.video_path = video_path
            db.add(row)
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
