"""
Visualize API config and stitch placeholder.
- GET /api/config/status: returns gateway connectivity and model metadata.
- POST /api/video/stitch: placeholder for custom stitch server integration.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from config import load_settings
from gateway_client import GatewayClient

router = APIRouter(tags=["visualize-config"])
settings = load_settings()


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
    compact_models = []
    for model in models:
        compact_models.append({
            "id": model.get("id"),
            "name": model.get("name") or model.get("id"),
            "provider": model.get("provider"),
        })
    return {
        "success": True,
        "config": {
            "sourceOfTruth": "gateway",
            "gatewayConnected": connected,
            "hasGatewayKey": bool(settings.gateway_internal_api_key),
            "models": compact_models,
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
