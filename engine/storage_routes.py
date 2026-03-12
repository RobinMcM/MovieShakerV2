"""Serve stored images (moodboard, character/object) for the current user."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

from storage import get_storage_file

router = APIRouter(prefix="/api/storage", tags=["storage"])


@router.get("/{path:path}")
def serve_storage(
    path: str,
    session: SessionContainer = Depends(verify_session()),
):
    """Serve a stored file. Path must be moodboard/{user_id}/... or objects/{user_id}/... for current user."""
    user_id = session.get_user_id()
    if not path or ".." in path:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not path.startswith(f"moodboard/{user_id}/") and not path.startswith(f"objects/{user_id}/"):
        raise HTTPException(status_code=403, detail="Access denied")
    result = get_storage_file(path)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    body, content_type = result
    return Response(content=body, media_type=content_type)
