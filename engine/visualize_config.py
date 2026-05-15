"""
Visualize API config and stitch placeholder.
- GET /api/config/status: returns gateway connectivity and model metadata.
- POST /api/video/stitch: placeholder for custom stitch server integration.
"""

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
    Returns gateway connectivity status. Model lists are resolved by the gateway team registry.
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
    return {
        "success": True,
        "config": {
            "sourceOfTruth": "gateway",
            "gatewayConnected": connected,
            "hasGatewayKey": bool(settings.gateway_internal_api_key),
            "models": [],
            "objectImageModels": [],
            "visualizeVideoModels": [],
            "soundMusicModels": [],
            "fiabTextModels": [],
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

    stitch_response = stitch_result if isinstance(stitch_result, dict) else {"success": True}
    if isinstance(stitch_response, dict) and "output_bytes" in stitch_response:
        # Keep raw bytes internal-only; JSON responses must remain UTF-8 serializable.
        stitch_response = {k: v for k, v in stitch_response.items() if k != "output_bytes"}

    return {
        "success": True,
        "stitch": stitch_response,
        "compiledVideo": {
            "id": str(created_compiled.id),
            "compiled_video_path": created_compiled.compiled_video_path,
            "channel_number": created_compiled.channel_number,
        } if created_compiled else None,
    }
