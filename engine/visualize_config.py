"""
Visualize API config and stitch placeholder.
- GET /api/config/status: returns hasRunwayKey, hasViduKey, testModeEnabled (placeholder: from env or API service).
- POST /api/video/stitch: placeholder for custom stitch server integration.
"""
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

router = APIRouter(tags=["visualize-config"])


@router.get("/api/config/status")
def get_config_status(
    session: SessionContainer = Depends(verify_session()),
):
    """
    Placeholder: API keys are managed by your API service.
    Returns booleans so the client can show provider options.
    """
    has_runway = os.environ.get("RUNWAY_API_KEY", "").strip() != ""
    has_vidu = os.environ.get("VIDU_API_KEY", "").strip() != ""
    test_mode = os.environ.get("VISUALIZE_TEST_MODE", "true").lower() in ("1", "true", "yes")
    return {
        "success": True,
        "config": {
            "hasRunwayKey": has_runway or test_mode,
            "hasViduKey": has_vidu or test_mode,
            "testModeEnabled": test_mode,
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
