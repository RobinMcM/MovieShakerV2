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
    """
    Serve a stored image for current user.
    Supported paths:
    - Legacy: moodboard/{user_id}/..., objects/{user_id}/...
    - Project-scoped: {user_id}/{project_id}/.../moodboard/... or .../objects/...
    """
    user_id = session.get_user_id()
    if not path or ".." in path:
        raise HTTPException(status_code=400, detail="Invalid path")

    legacy_allowed = path.startswith(f"moodboard/{user_id}/") or path.startswith(f"objects/{user_id}/")
    project_scoped_allowed = path.startswith(f"{user_id}/") and (
        "/moodboard/" in path or "/objects/" in path
    )
    if not legacy_allowed and not project_scoped_allowed:
        raise HTTPException(status_code=403, detail="Access denied")
    result = get_storage_file(path)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    body, content_type = result
    return Response(content=body, media_type=content_type)
