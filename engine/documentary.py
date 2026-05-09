"""
Documentary Studio: 5-step workflow — interview video → transcript → dialogue → screenplay → shots.
Canonical media pattern: video bytes streamed to media handler for Whisper transcription,
immediately discarded. Only text/entities persist (PostgreSQL). Scripts go to DO Spaces.
Prefix: /api/documentary
"""
import asyncio
import json
import mimetypes
import os
import re
import uuid
from datetime import datetime
from typing import Any, List, Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from config import load_settings
from credits import apply_credit_cost, ensure_user_can_generate, extract_credit_cost
from db import get_session
from gateway_client import GatewayClient, GatewayClientError
from media_handler_client import MediaHandlerClient, MediaHandlerClientError
import storage as storage_module
from models import (
    Character,
    DocumentarySession,
    Project,
    ProjectMember,
    Scene,
    TramLine,
)
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.session.framework.fastapi import verify_session

router = APIRouter(prefix="/api/documentary", tags=["documentary"])
settings = load_settings()

VALID_MEDIA_TYPES = {
    "video/mp4", "video/quicktime", "video/x-msvideo", "video/webm",
    "video/x-matroska", "video/mpeg", "video/ogg",
    "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav",
    "audio/ogg", "audio/flac", "audio/aac", "audio/m4a",
    "audio/x-m4a", "application/octet-stream",
}


# --- Pydantic request schemas ---

class SessionUpdateBody(BaseModel):
    stage: Optional[int] = None
    subjectName: Optional[str] = None
    workingTitle: Optional[str] = None
    context: Optional[str] = None
    rawTranscript: Optional[str] = None
    cleanedDialogue: Optional[str] = None
    dialogueStyle: Optional[str] = None
    generatedScript: Optional[str] = None


class GenerateDialogueBody(BaseModel):
    style: str  # monologue | interview | mixed


class ExtractEntitiesBody(BaseModel):
    scriptId: str


class ApplyShotsBody(BaseModel):
    shots: List[dict]  # [{scene_id, description, context_quote}]


# --- Helpers ---

def _gateway_client() -> GatewayClient:
    return GatewayClient(
        base_url=settings.gateway_base_url,
        api_key=settings.gateway_internal_api_key,
        timeout_seconds=settings.gateway_timeout_seconds,
        verify_tls=settings.gateway_verify_tls,
    )


def _media_handler_client() -> MediaHandlerClient:
    return MediaHandlerClient(
        base_url=settings.media_handler_base_url,
        api_key=settings.media_handler_internal_api_key,
        timeout_seconds=300.0,
        verify_tls=settings.media_handler_verify_tls,
    )


def _extract_text(response: dict) -> str:
    if not isinstance(response, dict):
        return ""
    result_block = response.get("result")
    if isinstance(result_block, dict):
        choices = result_block.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                msg = first.get("message")
                if isinstance(msg, dict):
                    c = msg.get("content")
                    if isinstance(c, str) and c.strip():
                        return c.strip()
    for key in ("text", "result", "output", "content", "message"):
        v = response.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    choices = response.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            msg = first.get("message")
            if isinstance(msg, dict):
                c = msg.get("content")
                if isinstance(c, str) and c.strip():
                    return c.strip()
    return ""


def _build_messages(system: str, user: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _ensure_project_member(db: Session, project_id: str, user_id: str) -> None:
    row = db.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == uuid.UUID(project_id),
            ProjectMember.user_id == user_id,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=403, detail="Not a member of this project")


def _get_or_create_session(db: Session, project_id: str, user_id: str) -> DocumentarySession:
    sess = db.exec(
        select(DocumentarySession).where(
            DocumentarySession.project_id == uuid.UUID(project_id)
        )
    ).first()
    if not sess:
        sess = DocumentarySession(
            project_id=uuid.UUID(project_id),
            user_id=user_id,
        )
        db.add(sess)
        db.commit()
        db.refresh(sess)
    return sess


def _session_to_dict(sess: DocumentarySession) -> dict:
    return {
        "id": str(sess.id),
        "projectId": str(sess.project_id),
        "stage": sess.stage,
        "subjectName": sess.subject_name,
        "workingTitle": sess.working_title,
        "context": sess.context,
        "rawTranscript": sess.raw_transcript,
        "cleanedDialogue": sess.cleaned_dialogue,
        "dialogueStyle": sess.dialogue_style,
        "generatedScript": sess.generated_script,
        "updatedAt": sess.updated_at.isoformat() + "Z",
    }


def _extract_broll_markers(script_text: str) -> list[dict]:
    pattern = re.compile(r'\[B-ROLL:\s*([^\]]+)\]', re.IGNORECASE)
    results = []
    lines = script_text.splitlines()
    for i, line in enumerate(lines):
        for match in pattern.finditer(line):
            # grab surrounding context (prev + next non-empty line)
            context_lines = []
            if i > 0:
                context_lines.append(lines[i - 1].strip())
            if i < len(lines) - 1:
                context_lines.append(lines[i + 1].strip())
            context = " … ".join(l for l in context_lines if l)
            results.append({
                "id": str(uuid.uuid4()),
                "description": match.group(1).strip(),
                "contextQuote": context,
            })
    return results


# --- Routes ---

@router.get("/projects/{project_id}")
def get_documentary_session(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Return (or create) the documentary session for this project."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    sess = _get_or_create_session(db, project_id, user_id)
    return {"success": True, "session": _session_to_dict(sess)}


@router.put("/projects/{project_id}")
def update_session(
    project_id: str,
    body: SessionUpdateBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Persist any stage of the documentary workflow."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    sess = _get_or_create_session(db, project_id, user_id)

    if body.stage is not None:
        sess.stage = body.stage
    if body.subjectName is not None:
        sess.subject_name = body.subjectName
    if body.workingTitle is not None:
        sess.working_title = body.workingTitle
    if body.context is not None:
        sess.context = body.context
    if body.rawTranscript is not None:
        sess.raw_transcript = body.rawTranscript
    if body.cleanedDialogue is not None:
        sess.cleaned_dialogue = body.cleanedDialogue
    if body.dialogueStyle is not None:
        sess.dialogue_style = body.dialogueStyle
    if body.generatedScript is not None:
        sess.generated_script = body.generatedScript

    sess.updated_at = datetime.utcnow()
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return {"success": True, "session": _session_to_dict(sess)}


@router.post("/projects/{project_id}/transcribe")
async def transcribe(
    project_id: str,
    files: List[UploadFile] = File(...),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """
    Accepts one or more video/audio files, streams each to media.rapidmvp.io/api/transcribe
    (Whisper), concatenates results, and persists to the documentary session.
    Raw bytes are never stored — discarded immediately after transcription.
    """
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    if not settings.media_handler_base_url:
        raise HTTPException(
            status_code=503,
            detail="Media handler unavailable — transcription service not yet deployed",
        )

    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required")

    # Fast async health check — avoids reading any file bytes if service is down.
    # Short timeout so Caddy never times out waiting for us.
    try:
        async with httpx.AsyncClient(timeout=5.0, verify=not getattr(settings, "disable_tls_verify", False)) as hc:
            probe = await hc.get(f"{settings.media_handler_base_url}/health")
            if probe.status_code >= 500:
                raise HTTPException(
                    status_code=503,
                    detail="Media handler unavailable — transcription service is not responding",
                )
    except httpx.RequestError:
        raise HTTPException(
            status_code=503,
            detail="Media handler unavailable — cannot reach transcription service",
        )

    # Read all file bytes (async, non-blocking) before entering thread executor.
    uploads: list[tuple[str, str, bytes]] = []
    for upload in files:
        content_type = upload.content_type or "application/octet-stream"
        filename = upload.filename or "interview"
        file_bytes = await upload.read()
        uploads.append((filename, content_type, file_bytes))

    client = _media_handler_client()
    loop = asyncio.get_running_loop()
    segments: list[str] = []

    for filename, content_type, file_bytes in uploads:
        try:
            # Run synchronous httpx.Client call in a thread so the event loop stays free.
            result = await loop.run_in_executor(
                None,
                lambda fb=file_bytes, fn=filename, ct=content_type: client.transcribe_video(fb, fn, ct),
            )
        except MediaHandlerClientError as exc:
            raise HTTPException(status_code=503, detail=f"Transcription failed for '{filename}': {exc}")

        transcript_text = result.get("transcript", "").strip()
        if transcript_text:
            segments.append(f"--- [{filename}] ---\n\n{transcript_text}")

    if not segments:
        raise HTTPException(status_code=502, detail="No transcript returned from media handler")

    combined = "\n\n".join(segments)
    sess = _get_or_create_session(db, project_id, user_id)
    sess.raw_transcript = combined
    sess.updated_at = datetime.utcnow()
    db.add(sess)
    db.commit()

    return {"success": True, "transcript": combined, "segmentCount": len(segments)}


@router.post("/trim")
async def trim_clip(
    file: UploadFile = File(...),
    in_time: float = Form(...),
    out_time: float = Form(...),
    session: SessionContainer = Depends(verify_session()),
):
    """
    Trim a video clip to in_time→out_time using FFmpeg on the media handler.
    Returns the trimmed video bytes directly for the browser to save locally.
    """
    if not settings.media_handler_base_url:
        raise HTTPException(status_code=503, detail="Media handler unavailable — trim service not configured")

    if out_time <= in_time:
        raise HTTPException(status_code=400, detail="out_time must be greater than in_time")

    content_type = file.content_type or "video/mp4"
    filename = file.filename or "clip.mp4"
    file_bytes = await file.read()

    client = _media_handler_client()
    loop = asyncio.get_running_loop()
    try:
        trimmed_bytes = await loop.run_in_executor(
            None,
            lambda: client.trim_video(file_bytes, filename, content_type, in_time, out_time),
        )
    except MediaHandlerClientError as exc:
        raise HTTPException(status_code=503, detail=f"Trim failed: {exc}")

    return Response(
        content=trimmed_bytes,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Rushes endpoints — /api/documentary/{project_id}/rushes/
# ---------------------------------------------------------------------------

class RushesSelectBody(BaseModel):
    source_key: str
    source_filename: str
    in_time: float
    out_time: float
    label: Optional[str] = None


def _fmt_tc(seconds: float) -> str:
    s = int(seconds)
    m, sec = divmod(s, 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m:02d}:{sec:02d}"


_MIME_OVERRIDES: dict[str, str] = {
    ".webm": "video/webm",
    ".mkv":  "video/x-matroska",
    ".avi":  "video/x-msvideo",
    ".mov":  "video/quicktime",
    ".mp4":  "video/mp4",
    ".m4v":  "video/mp4",
    ".ogv":  "video/ogg",
    ".mp3":  "audio/mpeg",
    ".m4a":  "audio/mp4",
    ".wav":  "audio/wav",
    ".aac":  "audio/aac",
    ".ogg":  "audio/ogg",
    ".flac": "audio/flac",
    # image types
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
}


def _resolve_content_type(filename: str, browser_ct: str) -> str:
    """Return a reliable MIME type even when macOS sends application/octet-stream."""
    if browser_ct and browser_ct not in ("application/octet-stream", ""):
        return browser_ct
    ext = os.path.splitext(filename)[1].lower()
    return _MIME_OVERRIDES.get(ext) or mimetypes.guess_type(filename)[0] or "video/mp4"


@router.post("/projects/{project_id}/rushes/upload")
async def rushes_upload(
    project_id: str,
    file: UploadFile = File(...),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Upload a raw footage clip to Spaces. Streams directly — no size limit."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    filename = (file.filename or "clip.mp4").replace(" ", "_")
    content_type = _resolve_content_type(filename, file.content_type or "")

    _ALLOWED_RUSHES_TYPES = {"video/mp4", "video/quicktime"}
    if content_type not in _ALLOWED_RUSHES_TYPES:
        raise HTTPException(status_code=415, detail="Only .mp4 and .mov files are supported.")

    key = storage_module.rushes_original_key(user_id, project_id, filename)

    # Ensure we're at the start of the file (FastAPI may have already read it)
    await file.seek(0)
    file_obj = file.file

    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: storage_module.upload_rushes_file(key, file_obj, content_type),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Upload failed: {exc}")

    return {"key": key, "filename": filename}


@router.get("/projects/{project_id}/rushes")
def rushes_list(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """List all clips (originals) and saved selects for a project with presigned playback URLs."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    clips = storage_module.list_rushes_clips(user_id, project_id)
    for clip in clips:
        clip["url"] = storage_module.generate_rushes_url(clip["key"], expires_seconds=7200) or ""

    selects = storage_module.read_selects(user_id, project_id)
    for sel in selects:
        sel["source_url"] = storage_module.generate_rushes_url(sel.get("source_key", ""), expires_seconds=7200) or ""

    inserts = storage_module.list_rushes_inserts(user_id, project_id)
    for ins in inserts:
        ins["url"] = storage_module.generate_rushes_url(ins["key"], expires_seconds=7200) or ""

    return {"clips": clips, "selects": selects, "inserts": inserts}


@router.post("/projects/{project_id}/rushes/selects")
def rushes_save_select(
    project_id: str,
    body: RushesSelectBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Save a select (JSON metadata only — no file is copied to Spaces)."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    if body.out_time <= body.in_time:
        raise HTTPException(status_code=400, detail="out_time must be greater than in_time")

    duration = round(body.out_time - body.in_time, 3)
    label = (body.label or "").strip() or (
        f"{body.source_filename} ({_fmt_tc(body.in_time)} → {_fmt_tc(body.out_time)})"
    )
    new_select = {
        "id": str(uuid.uuid4()),
        "label": label,
        "source_key": body.source_key,
        "source_filename": body.source_filename,
        "in_time": body.in_time,
        "out_time": body.out_time,
        "duration": duration,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }

    selects = storage_module.read_selects(user_id, project_id)
    selects.append(new_select)
    storage_module.write_selects(user_id, project_id, selects)
    return new_select


@router.delete("/projects/{project_id}/rushes/selects/{select_id}")
def rushes_delete_select(
    project_id: str,
    select_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Remove a saved select from selects.json — no Spaces file is deleted."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    selects = storage_module.read_selects(user_id, project_id)
    original_count = len(selects)
    selects = [s for s in selects if s.get("id") != select_id]
    storage_module.write_selects(user_id, project_id, selects)
    return {"success": len(selects) < original_count}


@router.post("/projects/{project_id}/rushes/inserts/upload")
async def rushes_insert_upload(
    project_id: str,
    file: UploadFile = File(...),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Upload a still image insert to Spaces."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    filename = (file.filename or "insert.jpg").replace(" ", "_")
    content_type = _resolve_content_type(filename, file.content_type or "")

    _ALLOWED_INSERT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
    if content_type not in _ALLOWED_INSERT_TYPES:
        raise HTTPException(status_code=415, detail="Only .jpg, .png, and .webp images are supported.")

    key = storage_module.rushes_insert_key(user_id, project_id, filename)
    await file.seek(0)
    file_obj = file.file

    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: storage_module.upload_rushes_file(key, file_obj, content_type),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Upload failed: {exc}")

    return {"key": key, "filename": filename}


@router.delete("/projects/{project_id}/rushes/inserts/{insert_name:path}")
def rushes_insert_delete(
    project_id: str,
    insert_name: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Delete an insert image from Spaces."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    key = storage_module.rushes_insert_key(user_id, project_id, insert_name)
    deleted = storage_module.delete_rushes_file(key)
    return {"success": deleted}


@router.delete("/projects/{project_id}/rushes/{clip_name:path}")
def rushes_delete(
    project_id: str,
    clip_name: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Delete a rushes clip by filename (originals or extracts)."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    # Reconstruct the full Spaces key (clip_name is the filename, not the full key)
    # Determine subfolder from the name pattern
    key_original = storage_module.rushes_original_key(user_id, project_id, clip_name)
    key_extract = storage_module.rushes_extract_key(user_id, project_id, clip_name)
    deleted = storage_module.delete_rushes_file(key_original) or storage_module.delete_rushes_file(key_extract)
    return {"success": deleted}


@router.post("/projects/{project_id}/generate-dialogue")
def generate_dialogue(
    project_id: str,
    body: GenerateDialogueBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Convert raw interview transcript to clean documentary dialogue using AI."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    profile = ensure_user_can_generate(db, user_id)

    sess = _get_or_create_session(db, project_id, user_id)
    if not sess.raw_transcript:
        raise HTTPException(status_code=400, detail="No transcript found. Complete Step 2 first.")

    style = (body.style or "monologue").lower()
    subject = sess.subject_name or "Subject"

    style_instructions = {
        "monologue": (
            f"Convert this interview transcript into a clean first-person narrative monologue "
            f"spoken entirely by {subject}. Remove all interviewer questions entirely. "
            f"Weave the answers into a flowing, natural first-person account. "
            f"Fix false starts, filler words, and repetition. Keep the authentic voice."
        ),
        "interview": (
            f"Clean up this interview transcript into polished documentary dialogue. "
            f"Keep both interviewer questions and {subject}'s answers, "
            f"but remove filler words, false starts, and repetition. "
            f"Format as:\nINTERVIEWER: [question]\n{subject.upper()}: [answer]"
        ),
        "mixed": (
            f"Transform this interview transcript into a mixed documentary format: "
            f"use a NARRATOR voice to bridge sections, and present {subject}'s most powerful "
            f"statements as direct speech. Remove questions. "
            f"Format as:\nNARRATOR: [bridging text]\n{subject.upper()}: [direct quote]"
        ),
    }.get(style, "")

    if not style_instructions:
        raise HTTPException(status_code=400, detail="style must be monologue, interview, or mixed")

    prompt = (
        f"{style_instructions}\n\n"
        f"ORIGINAL TRANSCRIPT:\n{sess.raw_transcript[:12000]}"
    )

    try:
        model = (profile.model_fiab_text or settings.film_in_a_box_model or "").strip()
        if not model:
            raise HTTPException(status_code=400, detail="No AI model configured")
        response = _gateway_client().execute_text(
            model=model,
            messages=_build_messages(
                "You are a documentary writer and editor. Return only the cleaned dialogue text, no preamble.",
                prompt,
            ),
        )
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    dialogue = _extract_text(response)
    if not dialogue:
        raise HTTPException(status_code=502, detail="Gateway returned empty dialogue")

    credits_cost = extract_credit_cost(response)
    balance = apply_credit_cost(db, user_id, credits_cost)

    sess.cleaned_dialogue = dialogue
    sess.dialogue_style = style
    sess.updated_at = datetime.utcnow()
    db.add(sess)
    db.commit()

    return {
        "success": True,
        "dialogue": dialogue,
        "credits": {"cost": credits_cost, "balance": balance},
    }


@router.post("/projects/{project_id}/generate-script")
def generate_script(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Generate a formatted documentary screenplay from the cleaned dialogue."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    profile = ensure_user_can_generate(db, user_id)

    sess = _get_or_create_session(db, project_id, user_id)
    if not sess.cleaned_dialogue:
        raise HTTPException(status_code=400, detail="No dialogue found. Complete Step 3 first.")

    subject = sess.subject_name or "Subject"
    title = sess.working_title or "Documentary"
    context = sess.context or ""

    prompt = (
        f"Write a documentary screenplay titled '{title}' based on the following interview dialogue.\n"
        f"Subject: {subject}\n"
        f"Context: {context}\n\n"
        f"Format as a proper documentary screenplay:\n"
        f"- Use FADE IN: at the start\n"
        f"- Use scene headings: INT./EXT. LOCATION - DAY/NIGHT\n"
        f"- Use {subject.upper()} (V.O.) for interview narration\n"
        f"- Use NARRATOR (V.O.) for bridging text where needed\n"
        f"- Insert [B-ROLL: brief visual description] markers at natural moments where archive footage, "
        f"present-day shots or illustrative images would accompany the narration\n"
        f"- Use action lines to describe implied visual context\n"
        f"- End with FADE OUT.\n\n"
        f"DIALOGUE:\n{sess.cleaned_dialogue[:12000]}"
    )

    try:
        model = (profile.model_fiab_text or settings.film_in_a_box_model or "").strip()
        if not model:
            raise HTTPException(status_code=400, detail="No AI model configured")
        response = _gateway_client().execute_text(
            model=model,
            messages=_build_messages(
                "You are a professional documentary screenwriter. "
                "Return only the formatted screenplay, no preamble or explanation.",
                prompt,
            ),
        )
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    script_text = _extract_text(response)
    if not script_text:
        raise HTTPException(status_code=502, detail="Gateway returned empty script")

    credits_cost = extract_credit_cost(response)
    balance = apply_credit_cost(db, user_id, credits_cost)

    sess.generated_script = script_text
    sess.updated_at = datetime.utcnow()
    db.add(sess)
    db.commit()

    broll = _extract_broll_markers(script_text)

    return {
        "success": True,
        "script": script_text,
        "brollSuggestions": broll,
        "credits": {"cost": credits_cost, "balance": balance},
    }


@router.post("/projects/{project_id}/extract-entities")
def extract_entities(
    project_id: str,
    body: ExtractEntitiesBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """
    Extract people, places, and organisations from the transcript/script.
    Creates Character records (type=character/object) for use in Moodboard and Objects.
    """
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    profile = ensure_user_can_generate(db, user_id)

    sess = _get_or_create_session(db, project_id, user_id)
    source_text = (sess.generated_script or "") + "\n\n" + (sess.raw_transcript or "")
    if not source_text.strip():
        raise HTTPException(status_code=400, detail="No script or transcript to analyse")

    script_uuid = uuid.UUID(body.scriptId)

    prompt = (
        "Extract all named people, places, and organisations from this documentary material. "
        "Return a JSON array only, no preamble:\n"
        '[\n  {"name": "...", "category": "person|place|organisation", "description": "one sentence"}\n]\n\n'
        f"TEXT:\n{source_text[:10000]}"
    )

    try:
        model = (profile.model_fiab_text or settings.film_in_a_box_model or "").strip()
        if not model:
            raise HTTPException(status_code=400, detail="No AI model configured")
        response = _gateway_client().execute_text(
            model=model,
            messages=_build_messages(
                "You are a documentary researcher. Return strict JSON only, no markdown.",
                prompt,
            ),
        )
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    raw = _extract_text(response)
    credits_cost = extract_credit_cost(response)
    balance = apply_credit_cost(db, user_id, credits_cost)

    # Parse entity JSON
    try:
        match = re.search(r'\[.*\]', raw, re.DOTALL)
        entities_data = json.loads(match.group(0)) if match else []
    except Exception:
        entities_data = []

    created = []
    for item in entities_data:
        if not isinstance(item, dict) or not item.get("name"):
            continue
        cat = (item.get("category") or "person").lower()
        char_type = "character" if cat == "person" else "object"
        obj_type = "entity" if cat == "person" else ("set_piece" if cat == "place" else "artifact")

        row = Character(
            script_id=script_uuid,
            user_id=user_id,
            name=item["name"],
            type=char_type,
            object_type=obj_type,
            casting_notes=item.get("description", ""),
        )
        db.add(row)
        db.flush()
        created.append({"id": str(row.id), "name": item["name"], "type": char_type, "objectType": obj_type})

    db.commit()
    return {
        "success": True,
        "created": len(created),
        "entities": created,
        "credits": {"cost": credits_cost, "balance": balance},
    }


@router.post("/projects/{project_id}/apply-shots")
def apply_shots(
    project_id: str,
    body: ApplyShotsBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """
    Create TramLine (shot list) entries for approved B-roll suggestions.
    Requires that the script has been saved and scenes exist in the database.
    """
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    if not body.shots:
        raise HTTPException(status_code=400, detail="No shots provided")

    # Determine next line_number for each scene
    created = []
    for shot in body.shots:
        scene_id_str = shot.get("scene_id") or shot.get("sceneId")
        description = shot.get("description", "")
        context_quote = shot.get("context_quote") or shot.get("contextQuote", "")

        if not scene_id_str or not description:
            continue

        try:
            scene_uuid = uuid.UUID(scene_id_str)
        except ValueError:
            continue

        scene = db.get(Scene, scene_uuid)
        if not scene:
            continue

        # Count existing tram lines to auto-assign line_number
        existing = db.exec(
            select(TramLine).where(TramLine.scene_id == scene_uuid)
        ).all()
        line_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        idx = len(existing)
        if idx < 26:
            line_number = line_letters[idx]
        else:
            line_number = line_letters[idx // 26 - 1] + line_letters[idx % 26]

        tram = TramLine(
            scene_id=scene_uuid,
            user_id=user_id,
            line_number=line_number,
            shot_type="b-roll",
            action_text=description,
            scene_visual=context_quote,
            color="#6366f1",
            start_y=0.0,
            end_y=1.0,
            x_position=float(idx),
        )
        db.add(tram)
        db.flush()
        created.append({"id": str(tram.id), "lineNumber": line_number, "description": description})

    db.commit()
    return {"success": True, "created": len(created), "shots": created}
