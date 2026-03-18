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
from models import (
    GatewayUsageEvent,
    MoodBoardVideoHistory,
    ProjectMember,
    Scene,
    Script,
    TramLine,
)
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


def _video_to_item(v: MoodBoardVideoHistory) -> dict:
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
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


def _gateway_client() -> GatewayClient:
    return GatewayClient(
        base_url=settings.gateway_base_url,
        api_key=settings.gateway_internal_api_key,
        timeout_seconds=settings.gateway_timeout_seconds,
        verify_tls=settings.gateway_verify_tls,
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
    media_type: str = "video-generation"
    source_image_path: Optional[str] = None
    source_image_data_url: Optional[str] = None
    dry_run: bool = False


@router.post("/generate")
def generate_video(
    body: GenerateVideoBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = ensure_user_can_generate(db, user_id)
    line = _ensure_tramline_access(db, body.tram_line_id, user_id)
    project_id = _project_id_for_tramline(db, line)

    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")

    prompt = (body.prompt or line.action_text or "").strip()
    if not prompt:
        prompt = "Cinematic shot"

    source_image_path = (body.source_image_path or line.scene_visual or "").strip() or None
    normalized_aspect_ratio = _normalize_video_aspect_ratio(body.aspect_ratio)
    payload: dict = {
        "prompt": prompt,
        "aspect_ratio": normalized_aspect_ratio,
    }
    if body.duration:
        payload["duration"] = body.duration
    if source_image_path:
        payload["source_image_path"] = source_image_path
    if body.source_image_data_url:
        payload["image_url"] = body.source_image_data_url
    if line.shot_type:
        payload["shot_type"] = line.shot_type
    if line.camera_direction:
        payload["camera_direction"] = line.camera_direction

    try:
        selected_model = (body.model or profile.model_visualize_video or "").strip() or None
        response = _gateway_client().execute_fal(
            media_type=body.media_type,
            payload=payload,
            model=selected_model,
            dry_run=body.dry_run,
        )
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    gateway_job_id = response.get("job_id")
    job_status = response.get("job_status") or ("completed" if body.dry_run else "processing")
    estimate = response.get("estimate")
    routing = response.get("routing") if isinstance(response.get("routing"), dict) else {}
    model_used = selected_model or routing.get("model")

    row = MoodBoardVideoHistory(
        tram_line_id=uuid.UUID(body.tram_line_id),
        user_id=user_id,
        video_path="",
        task_id=gateway_job_id,
        generation_method=f"gateway_{body.media_type}",
        prompt=prompt,
        aspect_ratio=normalized_aspect_ratio,
        duration=body.duration,
        take_number=body.take_number,
        channel=body.channel,
        source_type="image" if (source_image_path or body.source_image_data_url) else "text",
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
        media_type=body.media_type,
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
    return {"success": True, "videos": [_video_to_item(r) for r in rows]}


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
    return {"success": True, "videos": [_video_to_item(r) for r in rows]}


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
    db.delete(row)
    db.commit()
    return {"success": True, "video": _video_to_item(row)}
