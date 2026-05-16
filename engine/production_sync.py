"""
Production Sync: push project, scenes, shots, and camera assignments from MovieShaker to aFilmInABox.
Receive takes back from aFilmInABox via internal endpoints.
Requires AFILMINABOX_BASE_URL and AFILMINABOX_API_KEY env vars.
"""
import hmac
import os
import uuid as uuid_lib
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from db import get_session
from models import CAMERA_ROLES, Project, ProjectMember, ProductionCamera, Scene, Script, Take, TramLine
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.session.framework.fastapi import verify_session

router = APIRouter(tags=["production-sync"])

MEMBER_ROLES = {"owner", "editor"}


def _box_client() -> tuple[str, dict]:
    base_url = os.getenv("AFILMINABOX_BASE_URL", "").rstrip("/")
    api_key = os.getenv("AFILMINABOX_API_KEY", "").strip()
    if not base_url or not api_key:
        raise HTTPException(
            status_code=503,
            detail="aFilmInABox not configured — set AFILMINABOX_BASE_URL and AFILMINABOX_API_KEY",
        )
    headers = {"X-Internal-API-Key": api_key, "Content-Type": "application/json"}
    return base_url, headers


def _require_project_access(db: Session, project_id: str, user_id: str, roles=MEMBER_ROLES) -> Project:
    member = db.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    ).first()
    if not member or member.role not in roles:
        raise HTTPException(status_code=403, detail="Not authorized")
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


# ---------------------------------------------------------------------------
# Sync push
# ---------------------------------------------------------------------------

@router.post("/projects/{project_id}/sync-to-box")
def sync_project_to_box(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """
    Push production identity, scenes, shots, and camera assignments to aFilmInABox.
    Idempotent — each push replaces the previous sync state.
    """
    user_id = session.get_user_id()
    project = _require_project_access(db, project_id, user_id)

    scripts = list(
        db.exec(
            select(Script)
            .where(Script.project_id == project.id)
            .order_by(Script.uploaded_at.desc())
        ).all()
    )
    current_script = next((s for s in scripts if s.is_current), scripts[0] if scripts else None)

    scenes_payload: list[dict] = []
    shots_payload: list[dict] = []

    if current_script:
        scene_rows = list(
            db.exec(
                select(Scene)
                .where(Scene.script_id == current_script.id)
                .order_by(Scene.scene_number.asc(), Scene.id.asc())
            ).all()
        )
        scenes_payload = [
            {
                "id": str(s.id),
                "heading": s.heading,
                "sceneNumber": s.scene_number,
                "shootingDay": s.shooting_day,
                "pageNumber": s.page_number,
            }
            for s in scene_rows
        ]

        scene_ids = [s.id for s in scene_rows]
        if scene_ids:
            tram_lines = list(
                db.exec(
                    select(TramLine)
                    .where(TramLine.scene_id.in_(scene_ids))
                    .order_by(TramLine.scene_id, TramLine.x_position)
                ).all()
            )
            shots_payload = [
                {
                    "id": str(tl.id),
                    "sceneId": str(tl.scene_id),
                    "lineNumber": tl.line_number,
                    "cameraRole": tl.camera_role,
                    "shotType": tl.shot_type,
                    "framingNotes": tl.camera_direction,
                    "movementNotes": tl.action_text,
                    "durationTarget": None,
                    "characterNames": tl.character_names,
                    "shotStatus": tl.shot_status or "queued",
                }
                for tl in tram_lines
            ]

    # Camera slot → role assignments
    camera_rows = list(
        db.exec(
            select(ProductionCamera).where(ProductionCamera.project_id == project.id)
        ).all()
    )
    cameras_payload = [
        {
            "slot": c.camera_slot,
            "role": c.camera_role,
            "operatorName": c.operator_name,
        }
        for c in camera_rows
    ]

    base_url, headers = _box_client()
    synced_at = datetime.now(timezone.utc).isoformat()

    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                f"{base_url}/api/sync/production",
                json={"projectId": str(project.id), "name": project.name, "director": project.director or "", "syncedAt": synced_at},
                headers=headers,
            )
            r.raise_for_status()

            r = client.post(f"{base_url}/api/sync/scenes", json={"scenes": scenes_payload}, headers=headers)
            r.raise_for_status()

            r = client.post(f"{base_url}/api/sync/shots", json={"shots": shots_payload}, headers=headers)
            r.raise_for_status()

            r = client.post(f"{base_url}/api/sync/cameras", json={"cameras": cameras_payload}, headers=headers)
            r.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"aFilmInABox sync failed: {e.response.status_code} {e.response.text}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"aFilmInABox unreachable: {e}")

    return {
        "success": True,
        "projectId": str(project.id),
        "sceneCount": len(scenes_payload),
        "shotCount": len(shots_payload),
        "cameraCount": len(cameras_payload),
        "syncedAt": synced_at,
    }


@router.get("/projects/{project_id}/sync-status")
def get_sync_status(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Read back current sync state from aFilmInABox for verification."""
    user_id = session.get_user_id()
    _require_project_access(db, project_id, user_id)

    base_url, headers = _box_client()

    try:
        with httpx.Client(timeout=10.0) as client:
            production = client.get(f"{base_url}/api/sync/production", headers=headers).json()
            scenes = client.get(f"{base_url}/api/sync/scenes", headers=headers).json()
            shots = client.get(f"{base_url}/api/sync/shots", headers=headers).json()
            cameras = client.get(f"{base_url}/api/sync/cameras", headers=headers).json()
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"aFilmInABox unreachable: {e}")

    return {
        "success": True,
        "production": production.get("production"),
        "sceneCount": len(scenes.get("scenes", [])),
        "shotCount": len(shots.get("shots", [])),
        "cameras": cameras.get("cameras", []),
    }


# ---------------------------------------------------------------------------
# ProductionCamera CRUD (camera slot → role assignments)
# ---------------------------------------------------------------------------

class CameraAssignBody(BaseModel):
    camera_slot: int       # 1 | 2 | 3
    camera_role: str       # A_CAM | B_CAM | GIMBAL_CAM | BTS_CAM
    operator_name: Optional[str] = None


class CameraAssignResponse(BaseModel):
    id: str
    project_id: str
    camera_slot: int
    camera_role: str
    operator_name: Optional[str]
    created_at: datetime
    updated_at: datetime


def _camera_to_response(c: ProductionCamera) -> dict:
    return {
        "id": str(c.id),
        "project_id": str(c.project_id),
        "camera_slot": c.camera_slot,
        "camera_role": c.camera_role,
        "operator_name": c.operator_name,
        "created_at": c.created_at.isoformat(),
        "updated_at": c.updated_at.isoformat(),
    }


@router.get("/projects/{project_id}/cameras")
def list_production_cameras(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _require_project_access(db, project_id, user_id, roles={"owner", "editor", "viewer"})
    rows = list(
        db.exec(
            select(ProductionCamera)
            .where(ProductionCamera.project_id == project_id)
            .order_by(ProductionCamera.camera_slot)
        ).all()
    )
    return {"success": True, "cameras": [_camera_to_response(c) for c in rows]}


@router.post("/projects/{project_id}/cameras")
def assign_camera(
    project_id: str,
    body: CameraAssignBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Upsert camera slot → role assignment. One role per slot per project."""
    user_id = session.get_user_id()
    _require_project_access(db, project_id, user_id)

    if body.camera_slot not in {1, 2, 3}:
        raise HTTPException(status_code=400, detail="camera_slot must be 1, 2, or 3")
    if body.camera_role not in CAMERA_ROLES:
        raise HTTPException(status_code=400, detail=f"camera_role must be one of {sorted(CAMERA_ROLES)}")

    existing = db.exec(
        select(ProductionCamera).where(
            ProductionCamera.project_id == project_id,
            ProductionCamera.camera_slot == body.camera_slot,
        )
    ).first()

    if existing:
        existing.camera_role = body.camera_role
        existing.operator_name = body.operator_name
        existing.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return {"success": True, "camera": _camera_to_response(existing)}

    new_cam = ProductionCamera(
        project_id=uuid_lib.UUID(project_id),
        camera_slot=body.camera_slot,
        camera_role=body.camera_role,
        operator_name=body.operator_name,
    )
    db.add(new_cam)
    db.commit()
    db.refresh(new_cam)
    return {"success": True, "camera": _camera_to_response(new_cam)}


@router.delete("/projects/{project_id}/cameras/{camera_id}")
def remove_camera(
    project_id: str,
    camera_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _require_project_access(db, project_id, user_id)

    cam = db.get(ProductionCamera, uuid_lib.UUID(camera_id))
    if not cam or str(cam.project_id) != project_id:
        raise HTTPException(status_code=404, detail="Camera assignment not found")

    db.delete(cam)
    db.commit()
    return {"success": True}


# ---------------------------------------------------------------------------
# Internal auth helper (called by aFilmInABox, not by users)
# ---------------------------------------------------------------------------

def _require_internal_key(request: Request) -> None:
    expected = os.getenv("INTERNAL_API_KEY", "")
    provided = request.headers.get("X-Internal-API-Key", "")
    if not expected or not hmac.compare_digest(expected.encode(), provided.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _take_to_dict(t: Take) -> dict:
    return {
        "id": str(t.id),
        "project_id": str(t.project_id),
        "scene_id": str(t.scene_id) if t.scene_id else None,
        "tram_line_id": str(t.tram_line_id) if t.tram_line_id else None,
        "camera_role": t.camera_role,
        "take_number": t.take_number,
        "status": t.status,
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "duration": t.duration,
        "video_path": t.video_path,
        "recording_id": t.recording_id,
        "created_at": t.created_at.isoformat(),
        "updated_at": t.updated_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Take endpoints (internal — called by aFilmInABox)
# ---------------------------------------------------------------------------

class TakeCreateBody(BaseModel):
    project_id: str
    scene_id: Optional[str] = None
    tram_line_id: Optional[str] = None
    camera_role: str
    take_number: int = 0
    recording_id: Optional[str] = None
    started_at: Optional[str] = None
    status: str = "recording"


class TakeUpdateBody(BaseModel):
    status: Optional[str] = None
    take_number: Optional[int] = None
    completed_at: Optional[str] = None
    duration: Optional[float] = None
    video_path: Optional[str] = None
    recording_id: Optional[str] = None


@router.post("/api/production/takes")
def create_take_internal(
    request: Request,
    body: TakeCreateBody,
    db: Session = Depends(get_session),
):
    """Called by aFilmInABox when a camera starts recording. No SuperTokens auth."""
    _require_internal_key(request)

    started = None
    if body.started_at:
        try:
            started = datetime.fromisoformat(body.started_at.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            pass

    take = Take(
        project_id=uuid_lib.UUID(body.project_id),
        scene_id=uuid_lib.UUID(body.scene_id) if body.scene_id else None,
        tram_line_id=uuid_lib.UUID(body.tram_line_id) if body.tram_line_id else None,
        camera_role=body.camera_role,
        take_number=body.take_number,
        status=body.status,
        recording_id=body.recording_id,
        started_at=started,
    )
    db.add(take)
    db.commit()
    db.refresh(take)

    if take.tram_line_id:
        try:
            tl = db.get(TramLine, take.tram_line_id)
            if tl:
                tl.shot_status = "recording"
                tl.updated_at = datetime.utcnow()
                db.add(tl)
                db.commit()
        except Exception:
            pass  # non-critical — don't fail the take callback

    return {"success": True, "take": _take_to_dict(take)}


@router.put("/api/production/takes/{take_id}")
def update_take_internal(
    take_id: str,
    request: Request,
    body: TakeUpdateBody,
    db: Session = Depends(get_session),
):
    """Called by aFilmInABox when a recording completes. No SuperTokens auth."""
    _require_internal_key(request)

    take = db.get(Take, uuid_lib.UUID(take_id))
    if not take:
        raise HTTPException(status_code=404, detail="Take not found")

    if body.status is not None:
        take.status = body.status
    if body.take_number is not None:
        take.take_number = body.take_number
    if body.duration is not None:
        take.duration = body.duration
    if body.video_path is not None:
        take.video_path = body.video_path
    if body.recording_id is not None:
        take.recording_id = body.recording_id
    if body.completed_at:
        try:
            take.completed_at = datetime.fromisoformat(body.completed_at.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            pass

    take.updated_at = datetime.utcnow()
    db.add(take)
    db.commit()
    db.refresh(take)
    return {"success": True, "take": _take_to_dict(take)}


# ---------------------------------------------------------------------------
# Takes list (authenticated — for dashboard)
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/takes")
def list_takes(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """List all takes for a project, ordered newest first."""
    user_id = session.get_user_id()
    _require_project_access(db, project_id, user_id, roles={"owner", "editor", "viewer"})

    takes = list(
        db.exec(
            select(Take)
            .where(Take.project_id == uuid_lib.UUID(project_id))
            .order_by(Take.created_at.desc())
        ).all()
    )

    # Attach shot heading from TramLine for context
    tram_line_ids = [t.tram_line_id for t in takes if t.tram_line_id]
    tram_lines_by_id: dict = {}
    if tram_line_ids:
        rows = list(db.exec(select(TramLine).where(TramLine.id.in_(tram_line_ids))).all())
        tram_lines_by_id = {tl.id: tl for tl in rows}

    out = []
    for t in takes:
        d = _take_to_dict(t)
        tl = tram_lines_by_id.get(t.tram_line_id) if t.tram_line_id else None
        d["shot_line_number"] = tl.line_number if tl else None
        d["shot_type"] = tl.shot_type if tl else None
        out.append(d)

    return {"success": True, "takes": out, "total": len(out)}


# ---------------------------------------------------------------------------
# aFilmInABox live proxy — dashboard polling endpoints
# ---------------------------------------------------------------------------

class SetActiveShotBody(BaseModel):
    shotId: str


@router.get("/projects/{project_id}/box/context")
def get_box_context(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Poll cameras + active shot from aFilmInABox in one call. Used by dashboard every 5s."""
    user_id = session.get_user_id()
    _require_project_access(db, project_id, user_id, roles={"owner", "editor", "viewer"})

    base_url, headers = _box_client()

    try:
        with httpx.Client(timeout=8.0) as client:
            cameras_res = client.get(f"{base_url}/api/cameras", headers=headers)
            cameras_res.raise_for_status()
            shot_res = client.get(f"{base_url}/api/active-shot", headers=headers)
            shot_res.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"aFilmInABox error: {e.response.status_code}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"aFilmInABox unreachable: {e}")

    return {
        "success": True,
        "cameras": cameras_res.json().get("cameras", []),
        "activeShot": shot_res.json().get("activeShot"),
    }


@router.get("/projects/{project_id}/box/shots")
def get_project_shots_for_box(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """
    Flat list of all shots for the project with scene context.
    Used to populate the active-shot selector on the dashboard.
    """
    user_id = session.get_user_id()
    _require_project_access(db, project_id, user_id, roles={"owner", "editor", "viewer"})

    scripts = list(
        db.exec(
            select(Script)
            .where(Script.project_id == project_id)
            .order_by(Script.uploaded_at.desc())
        ).all()
    )
    current_script = next((s for s in scripts if s.is_current), scripts[0] if scripts else None)
    if not current_script:
        return {"success": True, "shots": []}

    scene_rows = list(
        db.exec(
            select(Scene)
            .where(Scene.script_id == current_script.id)
            .order_by(Scene.scene_number.asc(), Scene.id.asc())
        ).all()
    )
    scene_map = {s.id: s for s in scene_rows}
    scene_ids = [s.id for s in scene_rows]

    shots_out: list[dict] = []
    if scene_ids:
        tram_lines = list(
            db.exec(
                select(TramLine)
                .where(TramLine.scene_id.in_(scene_ids))
                .order_by(TramLine.scene_id, TramLine.x_position)
            ).all()
        )
        for tl in tram_lines:
            scene = scene_map.get(tl.scene_id)
            shots_out.append({
                "id": str(tl.id),
                "lineNumber": tl.line_number,
                "shotType": tl.shot_type,
                "cameraRole": tl.camera_role,
                "sceneId": str(tl.scene_id),
                "sceneHeading": scene.heading if scene else "",
                "sceneNumber": scene.scene_number if scene else "",
                "shotStatus": tl.shot_status or "queued",
            })

    return {"success": True, "shots": shots_out}


@router.post("/projects/{project_id}/box/active-shot")
def set_active_shot(
    project_id: str,
    body: SetActiveShotBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Set the active shot in aFilmInABox."""
    user_id = session.get_user_id()
    _require_project_access(db, project_id, user_id)

    base_url, headers = _box_client()

    try:
        with httpx.Client(timeout=8.0) as client:
            r = client.post(
                f"{base_url}/api/active-shot",
                json={"shotId": body.shotId},
                headers=headers,
            )
            r.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"aFilmInABox error: {e.response.status_code} {e.response.text}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"aFilmInABox unreachable: {e}")

    try:
        tl = db.get(TramLine, uuid_lib.UUID(body.shotId))
        if tl:
            tl.shot_status = "ready"
            tl.updated_at = datetime.utcnow()
            db.add(tl)
            db.commit()
    except Exception:
        pass  # non-critical — don't fail the active-shot call

    return {"success": True}


@router.delete("/projects/{project_id}/box/active-shot")
def clear_active_shot(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Clear the active shot in aFilmInABox."""
    user_id = session.get_user_id()
    _require_project_access(db, project_id, user_id)

    base_url, headers = _box_client()

    try:
        with httpx.Client(timeout=8.0) as client:
            r = client.delete(f"{base_url}/api/active-shot", headers=headers)
            r.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"aFilmInABox error: {e.response.status_code} {e.response.text}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"aFilmInABox unreachable: {e}")

    return {"success": True}
