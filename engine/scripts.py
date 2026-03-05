"""
Scripts API: list by project, create+upload (multipart), stats, stream file, delete.
Parse: POST /scripts/:id/parse to extract scenes/characters from PDF or JSON.
Storage path: STORAGE_ROOT/{user_id}/{project_id}/{script_id}/script.pdf
Valkey cache: scripts:list:{project_id}, scripts:stats:{script_id}
"""
import io
import json
import re
import uuid
from datetime import datetime
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlmodel import Session, select, update
from pydantic import BaseModel

from db import get_session
from models import Character, ProjectMember, Scene, SceneCharacter, Script
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from cache import (
    cache_get,
    cache_set,
    cache_delete,
    scripts_list_key,
    scripts_stats_key,
    SCRIPTS_LIST_TTL,
    SCRIPTS_STATS_TTL,
)
from storage import (
    relative_file_path,
    save_script_file,
    get_script_file_path,
    get_script_file_stream,
    delete_script_dir,
    script_json_path,
    uses_spaces,
    MAX_UPLOAD_BYTES,
)

router = APIRouter(tags=["scripts"])


class ScriptResponse(BaseModel):
    id: str
    project_id: str
    name: str
    file_url: str  # relative path for compatibility; frontend uses GET /scripts/:id/file to view
    uploaded_at: datetime
    is_current: bool
    series: Optional[str] = None
    episode: Optional[str] = None
    description: Optional[str] = None
    is_locked: bool = False
    page_count: Optional[int] = None


class ScriptListResponse(BaseModel):
    scripts: List[ScriptResponse]


class StatsResponse(BaseModel):
    stats: dict  # { "scenes": n, "characters": n }


class SceneResponse(BaseModel):
    id: str
    heading: str
    page_number: str
    length_in_eighths: Optional[int] = None
    scene_number: Optional[int] = None


class CharacterResponse(BaseModel):
    id: str
    name: str


class SceneCharacterResponse(BaseModel):
    id: str
    scene_id: str
    character_id: str


def _ensure_project_member(db: Session, project_id: str, user_id: str) -> None:
    member = db.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == uuid.UUID(project_id),
            ProjectMember.user_id == user_id,
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this project")


def _get_script_and_ensure_access(
    db: Session, script_id: str, user_id: str
) -> Script:
    script = db.get(Script, uuid.UUID(script_id))
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    _ensure_project_member(db, str(script.project_id), user_id)
    return script


def _script_to_response(s: Script) -> ScriptResponse:
    return ScriptResponse(
        id=str(s.id),
        project_id=str(s.project_id),
        name=s.name,
        file_url=s.file_path,
        uploaded_at=s.uploaded_at,
        is_current=s.is_current,
        series=s.series,
        episode=s.episode,
        description=s.description,
        is_locked=getattr(s, "is_locked", False),
        page_count=getattr(s, "page_count", None),
    )


# GET /scripts/{script_id}
@router.get("/scripts/{script_id}")
def get_script(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    data = _script_to_response(script)
    return {"success": True, "data": data.model_dump()}


# GET /projects/{project_id}/scripts
@router.get("/projects/{project_id}/scripts", response_model=ScriptListResponse)
def list_scripts(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    cache_key = scripts_list_key(project_id)
    cached = cache_get(cache_key)
    if cached is not None:
        try:
            data = json.loads(cached)
            out_cached = []
            for item in data:
                d = dict(item)
                if isinstance(d.get("uploaded_at"), str) and d["uploaded_at"]:
                    d["uploaded_at"] = datetime.fromisoformat(
                        d["uploaded_at"].replace("Z", "+00:00")
                    )
                out_cached.append(ScriptResponse(**d))
            return ScriptListResponse(scripts=out_cached)
        except Exception:
            pass

    stmt = select(Script).where(Script.project_id == uuid.UUID(project_id)).order_by(Script.uploaded_at.desc())
    scripts = list(db.exec(stmt).all())
    out = [_script_to_response(s) for s in scripts]
    payload = [getattr(s, "model_dump", lambda: s.dict())() for s in out]
    try:
        cache_set(cache_key, json.dumps(payload, default=str), SCRIPTS_LIST_TTL)
    except Exception:
        pass
    return ScriptListResponse(scripts=out)


# POST /projects/{project_id}/scripts
@router.post("/projects/{project_id}/scripts", response_model=ScriptResponse, status_code=201)
def create_script_upload(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
    file: UploadFile = File(...),
    name: str = Form(...),
    description: Optional[str] = Form(None),
    series: Optional[str] = Form(None),
    episode: Optional[str] = Form(None),
):
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF file required")
    content_type = file.content_type or ""
    if "pdf" not in content_type.lower():
        raise HTTPException(status_code=400, detail="Content-Type must be application/pdf")

    script_id = uuid.uuid4()
    rel_path = relative_file_path(user_id, project_id, str(script_id), "script.pdf")

    try:
        contents = file.file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e!s}")
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File size must be less than 50MB")

    import io
    save_script_file(
        user_id,
        project_id,
        str(script_id),
        "script.pdf",
        io.BytesIO(contents),
        len(contents),
    )

    # If this is the first script for the project, set is_current
    existing = db.exec(select(Script).where(Script.project_id == uuid.UUID(project_id))).first()
    is_current = existing is None

    script = Script(
        id=script_id,
        project_id=uuid.UUID(project_id),
        user_id=user_id,
        name=name.strip(),
        description=description.strip() if description else None,
        series=series.strip() if series else None,
        episode=episode.strip() if episode else None,
        file_path=rel_path,
        is_current=is_current,
    )
    db.add(script)
    db.commit()
    db.refresh(script)

    cache_delete(scripts_list_key(project_id))
    return _script_to_response(script)


# GET /scripts/{script_id}/stats
@router.get("/scripts/{script_id}/stats", response_model=StatsResponse)
def get_script_stats(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)

    cache_key = scripts_stats_key(script_id)
    cached = cache_get(cache_key)
    if cached is not None:
        try:
            data = json.loads(cached)
            return StatsResponse(stats=data)
        except Exception:
            pass

    scenes, characters = 0, 0
    json_path = script_json_path(script.user_id, str(script.project_id), str(script.id))
    if json_path.exists():
        try:
            with open(json_path) as f:
                data = json.load(f)
            if isinstance(data.get("scenes"), list):
                scenes = len(data["scenes"])
            if isinstance(data.get("characters"), list):
                characters = len(data["characters"])
            elif "characters" in data and isinstance(data["characters"], dict):
                characters = len(data["characters"])
        except Exception:
            pass

    stats = {"scenes": scenes, "characters": characters}
    try:
        cache_set(cache_key, json.dumps(stats), SCRIPTS_STATS_TTL)
    except Exception:
        pass
    return StatsResponse(stats=stats)


# GET /scripts/{script_id}/file
@router.get("/scripts/{script_id}/file")
def get_script_file(
    script_id: str,
    variant: Optional[str] = None,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)

    if variant == "json":
        if uses_spaces():
            json_key = relative_file_path(script.user_id, str(script.project_id), str(script.id), "script.json")
            stream_result = get_script_file_stream(json_key)
            if stream_result is None:
                raise HTTPException(status_code=404, detail="Script JSON not found. Parse the script first.")
            body, _ = stream_result
            return Response(content=body, media_type="application/json")
        path = script_json_path(script.user_id, str(script.project_id), str(script.id))
        if not path.exists():
            raise HTTPException(status_code=404, detail="Script JSON not found. Parse the script first.")
        return FileResponse(path, media_type="application/json")
    else:
        if uses_spaces():
            stream_result = get_script_file_stream(script.file_path)
            if stream_result is None:
                raise HTTPException(status_code=404, detail="Script file not found")
            body, content_type = stream_result
            return Response(
                content=body,
                media_type=content_type,
                headers={"Content-Disposition": 'inline; filename="script.pdf"'},
            )
        path = get_script_file_path(script.file_path)
        if not path.exists():
            raise HTTPException(status_code=404, detail="Script file not found")
        return FileResponse(
            path,
            media_type="application/pdf",
            filename="script.pdf",
        )


# GET /scripts/{script_id}/scenes
@router.get("/scripts/{script_id}/scenes")
def get_script_scenes(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)
    stmt = (
        select(Scene)
        .where(Scene.script_id == uuid.UUID(script_id))
        .order_by(Scene.scene_number.asc(), Scene.id.asc())
    )
    scenes = list(db.exec(stmt).all())
    data = [
        SceneResponse(
            id=str(s.id),
            heading=s.heading,
            page_number=s.page_number or "",
            length_in_eighths=s.length_in_eighths,
            scene_number=s.scene_number,
        )
        for s in scenes
    ]
    return {"success": True, "data": data}


# GET /scripts/{script_id}/characters
@router.get("/scripts/{script_id}/characters")
def get_script_characters(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)
    stmt = (
        select(Character)
        .where(Character.script_id == uuid.UUID(script_id))
        .order_by(Character.name.asc())
    )
    characters = list(db.exec(stmt).all())
    data = [CharacterResponse(id=str(c.id), name=c.name) for c in characters]
    return {"success": True, "data": data}


# GET /scripts/{script_id}/scene-characters
@router.get("/scripts/{script_id}/scene-characters")
def get_script_scene_characters(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _get_script_and_ensure_access(db, script_id, user_id)
    # Join scene_character -> scene to filter by script_id
    stmt = (
        select(SceneCharacter)
        .join(Scene, SceneCharacter.scene_id == Scene.id)
        .where(Scene.script_id == uuid.UUID(script_id))
    )
    rows = list(db.exec(stmt).all())
    data = [
        SceneCharacterResponse(
            id=str(r.id),
            scene_id=str(r.scene_id),
            character_id=str(r.character_id),
        )
        for r in rows
    ]
    return {"success": True, "data": data}


# POST /scripts/{script_id}/set-current
@router.post("/scripts/{script_id}/set-current")
def set_script_current(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    project_id = str(script.project_id)
    db.exec(update(Script).where(Script.project_id == script.project_id).values(is_current=False))
    script.is_current = True
    db.add(script)
    db.commit()
    db.refresh(script)
    cache_delete(scripts_list_key(project_id))
    return {"success": True, "message": "Script set as current"}


# POST /scripts/{script_id}/set-lock
class SetLockBody(BaseModel):
    is_locked: bool


@router.post("/scripts/{script_id}/set-lock")
def set_script_lock(
    script_id: str,
    body: SetLockBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    script.is_locked = body.is_locked
    db.add(script)
    db.commit()
    db.refresh(script)
    data = _script_to_response(script)
    return {"success": True, "data": data.model_dump()}


def _get_script_file_bytes(script: Script) -> Tuple[bytes, bool]:
    """Return (body, is_pdf). Raises HTTPException if file not found."""
    if uses_spaces():
        result = get_script_file_stream(script.file_path)
        if result is None:
            raise HTTPException(status_code=404, detail="Script file not found")
        body, _ = result
        return (body, body[:5].strip().startswith(b"%PDF-"))
    path = get_script_file_path(script.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Script file not found")
    body = path.read_bytes()
    return (body, body[:5].strip().startswith(b"%PDF-"))


def _derive_db_from_elements(
    elements: List[dict], page_count: int
) -> Tuple[List[dict], List[str], dict, int]:
    """Derive (headings, unique_characters, scene_char_map, page_count) from full elements for DB insert."""
    headings = []
    character_set = set()
    scene_char_map: dict = {}
    for el in elements:
        el_type = (el.get("type") or "action").strip().lower()
        text = (el.get("text") or "").strip()
        if el_type == "scene_heading":
            headings.append({
                "heading": text[:255],
                "page_number": f"Page {len(headings) + 1}",
                "length_in_eighths": 1,
            })
            scene_char_map[len(headings) - 1] = set()
        elif el_type == "character":
            name = re.sub(r"\s*\([^)]*\)", "", text)
            name = re.sub(r"[(),!?:;]", "", name).strip().rstrip(". ")
            if 0 < len(name) < 50:
                character_set.add(name)
                if headings:
                    scene_char_map[len(headings) - 1].add(name)
    return (headings, sorted(character_set), scene_char_map, page_count)


def _parse_json_script(body: bytes) -> Tuple[List[dict], List[str], dict, int]:
    """Parse JSON script. Returns (headings, unique_characters, scene_index_to_characters, page_count)."""
    data = json.loads(body.decode("utf-8", errors="replace"))
    elements = data.get("elements") or []
    page_count = 1
    if isinstance(data.get("metadata"), dict) and "page_count" in data["metadata"]:
        page_count = int(data["metadata"]["page_count"]) or 1
    return _derive_db_from_elements(elements, page_count)


# Canonical script.json types (source of truth)
SCRIPT_JSON_TYPES = frozenset(
    {"scene_heading", "action", "character", "dialogue", "parenthetical", "transition", "page_number", "general"}
)


def _script_json_to_bytes(elements: List[dict], metadata: dict) -> bytes:
    """Serialize script.json document. metadata must include page_count."""
    meta = dict(metadata)
    if "page_count" not in meta:
        meta["page_count"] = 1
    doc = {"metadata": meta, "elements": elements}
    return json.dumps(doc, indent=2).encode("utf-8")


def _build_script_json(
    headings: List[dict], unique_characters: List[str], scene_char_map: dict, page_count: int
) -> bytes:
    """Build reduced script.json (scene_heading + character only) for saving as script.json."""
    elements: List[dict] = []
    for i, h in enumerate(headings):
        elements.append({"type": "scene_heading", "text": h.get("heading", "")})
        for cname in sorted(scene_char_map.get(i, set())):
            elements.append({"type": "character", "text": cname})
    return _script_json_to_bytes(elements, {"page_count": page_count})


def _parse_pdf_script(body: bytes) -> Tuple[List[dict], List[str], dict, int]:
    """Extract scenes and characters from PDF text. Returns same shape as _parse_json_script."""
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(body))
    page_count = len(reader.pages)
    headings = []
    character_set = set()
    scene_char_map = {}
    scene_heading_re = re.compile(r"^(INT\.|EXT\.|INT\./EXT\.|I/E|EST\.)\s", re.IGNORECASE)
    for pagenum, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        for line in lines:
            if scene_heading_re.match(line):
                headings.append({
                    "heading": line[:255],
                    "page_number": f"Page {pagenum}",
                    "length_in_eighths": 1,
                })
                scene_char_map[len(headings) - 1] = set()
            elif line.isupper() and len(line) < 50 and re.match(r"^[A-Z][A-Z\s\-']+$", line):
                name = re.sub(r"\s*\([^)]*\)", "", line).strip().rstrip(". ")
                if name:
                    character_set.add(name)
                    if headings:
                        scene_char_map[len(headings) - 1].add(name)
    unique_characters = sorted(character_set)
    return (headings, unique_characters, scene_char_map, page_count)


def _parse_pdf_script_full(body: bytes) -> Optional[Tuple[List[dict], int]]:
    """
    Extract full screenplay elements from PDF using position-based classification (legacy heuristics).
    Returns (elements, page_count) or None on failure (caller should fall back to _parse_pdf_script).
    """
    try:
        from pdfminer.converter import PDFPageAggregator
        from pdfminer.layout import LAParams, LTTextBox, LTTextLine
        from pdfminer.pdfpage import PDFPage
        from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
    except ImportError:
        return None
    try:
        rsrc = PDFResourceManager()
        laparams = LAParams()
        device = PDFPageAggregator(rsrc, laparams=laparams)
        interpreter = PDFPageInterpreter(rsrc, device)
        all_lines: List[Tuple[int, float, float, str]] = []  # (page_num, x, y, text)
        line_height_tol = 5
        for page_num, page in enumerate(PDFPage.get_pages(io.BytesIO(body)), 1):
            interpreter.process_page(page)
            layout = device.get_result()
            for obj in layout:
                if isinstance(obj, LTTextBox):
                    for line in obj:
                        if isinstance(line, LTTextLine):
                            text = (line.get_text() or "").strip()
                            if not text:
                                continue
                            x0, y0, x1, y1 = line.bbox
                            x_center = (x0 + x1) / 2
                            y_center = (y0 + y1) / 2
                            all_lines.append((page_num, x_center, y_center, text))
        if not all_lines:
            return None
        all_lines.sort(key=lambda t: (t[0], -t[2], t[1]))
        grouped: List[Tuple[int, float, float, str]] = []
        for page_num, x, y, text in all_lines:
            if grouped and grouped[-1][0] == page_num and abs(grouped[-1][2] - y) <= line_height_tol:
                grouped[-1] = (page_num, (grouped[-1][1] + x) / 2, grouped[-1][2], grouped[-1][3] + " " + text)
            else:
                grouped.append((page_num, x, y, text))
        scene_heading_re = re.compile(r"^(INT\.|EXT\.|INT\./EXT\.|I/E|EST\.)(?:\s|$)", re.IGNORECASE)
        MERGE_Y_TOLERANCE = 20
        elements: List[dict] = []
        last_el: Optional[dict] = None
        last_y: float = -1e9
        for page_num, x, y, text in grouped:
            is_centered = 150 < x < 400
            is_parenthetical = text.startswith("(") and text.endswith(")")
            starts_scene = bool(scene_heading_re.match(text))
            is_page_num = bool(re.match(r"^\d+\.?$", text)) and y > 500 and x > 450
            is_upper = text == text.upper() and bool(re.search(r"[A-Z]", text))
            el_type = "action"
            if is_page_num:
                el_type = "page_number"
            elif starts_scene:
                el_type = "scene_heading"
            elif is_centered and is_upper and not is_parenthetical:
                el_type = "character"
            elif is_centered and is_parenthetical:
                el_type = "parenthetical"
            elif is_centered:
                if last_el and last_el.get("type") in ("character", "parenthetical", "dialogue"):
                    el_type = "dialogue"
                elif text.endswith("TO:") or re.match(r"^FADE", text, re.I):
                    el_type = "transition"
                else:
                    el_type = "dialogue"
            else:
                el_type = "action"
            should_merge = (
                last_el is not None
                and last_el.get("_page") == page_num
                and last_el.get("type") == el_type
                and abs(last_y - y) <= MERGE_Y_TOLERANCE
                and not (el_type == "scene_heading")  # never merge two scene headings
            )
            if should_merge and last_el is not None:
                last_el["text"] = (last_el["text"] or "") + " " + text
            else:
                last_el = {"type": el_type, "text": text, "_page": page_num}
                elements.append(last_el)
            last_y = y
        for el in elements:
            el.pop("_page", None)
        page_count = max((t[0] for t in grouped), default=1)
        return (elements, page_count)
    except Exception:
        return None


def _read_script_json(script: Script) -> Optional[Tuple[List[dict], dict]]:
    """Read current script.json from storage. Returns (elements, metadata) or None if not found."""
    json_key = relative_file_path(script.user_id, str(script.project_id), str(script.id), "script.json")
    if uses_spaces():
        result = get_script_file_stream(json_key)
        if result is None:
            return None
        body, _ = result
    else:
        path = script_json_path(script.user_id, str(script.project_id), str(script.id))
        if not path.exists():
            return None
        body = path.read_bytes()
    data = json.loads(body.decode("utf-8", errors="replace"))
    elements = data.get("elements")
    metadata = data.get("metadata") or {}
    if not isinstance(elements, list):
        return None
    return (elements, metadata)


# PUT /scripts/{script_id}/json - update script.json (source of truth) from client e.g. ScriptViewer save
class ScriptJsonBody(BaseModel):
    elements: List[dict]  # [ {"type": str, "text": str}, ... ]
    metadata: Optional[dict] = None  # e.g. page_count, title, author


@router.put("/scripts/{script_id}/json")
def update_script_json(
    script_id: str,
    body: ScriptJsonBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Update script.json in storage (full replace). Use for saving edits or replacing document. Does not change scenes/characters in DB."""
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    if not body.elements:
        raise HTTPException(status_code=400, detail="elements array is required and must not be empty")
    metadata = body.metadata or {}
    if "page_count" not in metadata:
        metadata = {**metadata, "page_count": 1}
    normalized = [{"type": (e.get("type") or "action").strip().lower(), "text": (e.get("text") or "").strip()} for e in body.elements]
    json_bytes = _script_json_to_bytes(normalized, metadata)
    save_script_file(
        script.user_id,
        str(script.project_id),
        str(script.id),
        "script.json",
        io.BytesIO(json_bytes),
        len(json_bytes),
    )
    return {"success": True, "message": "Script JSON updated"}


# POST /scripts/{script_id}/json/elements - append elements to script.json (e.g. during production)
class AppendElementsBody(BaseModel):
    elements: List[dict]  # [ {"type": str, "text": str}, ... ] - will be appended to existing


@router.post("/scripts/{script_id}/json/elements")
def append_script_json_elements(
    script_id: str,
    body: AppendElementsBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Append elements to script.json. Use during production to add extra elements. Fails if script.json does not exist (parse first)."""
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    current = _read_script_json(script)
    if current is None:
        raise HTTPException(
            status_code=404,
            detail="Script JSON not found. Parse the script first to create script.json.",
        )
    existing_elements, metadata = current
    if not body.elements:
        return {"success": True, "message": "No elements to append", "elements_count": len(existing_elements)}
    new_els = [{"type": (e.get("type") or "action").strip().lower(), "text": (e.get("text") or "").strip()} for e in body.elements]
    combined = existing_elements + new_els
    json_bytes = _script_json_to_bytes(combined, metadata)
    save_script_file(
        script.user_id,
        str(script.project_id),
        str(script.id),
        "script.json",
        io.BytesIO(json_bytes),
        len(json_bytes),
    )
    return {"success": True, "message": "Elements appended", "elements_count": len(combined)}


# POST /scripts/{script_id}/parse
@router.post("/scripts/{script_id}/parse")
def parse_script(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)
    if getattr(script, "is_locked", False):
        raise HTTPException(status_code=403, detail="Script is locked. Unlock it to re-parse.")
    body, is_pdf = _get_script_file_bytes(script)
    full_elements: Optional[List[dict]] = None
    script_metadata: Optional[dict] = None
    if body[:20].strip().startswith(b"{") or body[:20].strip().startswith(b"["):
        headings, unique_characters, scene_char_map, page_count = _parse_json_script(body)
        data = json.loads(body.decode("utf-8", errors="replace"))
        raw_elements = data.get("elements") or []
        raw_meta = data.get("metadata") or {}
        types_present = { (e.get("type") or "action").strip().lower() for e in raw_elements }
        if types_present - {"scene_heading", "character"}:
            full_elements = [{"type": (e.get("type") or "action").strip().lower(), "text": (e.get("text") or "").strip()} for e in raw_elements]
            script_metadata = {**raw_meta, "page_count": raw_meta.get("page_count", page_count)}
    elif is_pdf:
        full_result = _parse_pdf_script_full(body)
        if full_result is not None:
            full_elements, page_count = full_result
            headings, unique_characters, scene_char_map, page_count = _derive_db_from_elements(full_elements, page_count)
            script_metadata = {"page_count": page_count}
        else:
            headings, unique_characters, scene_char_map, page_count = _parse_pdf_script(body)
    else:
        raise HTTPException(status_code=400, detail="File format not recognized (expected PDF or JSON).")
    script_uuid = script.id
    # Delete in FK order: scene_characters -> scenes, characters
    existing_scenes = list(db.exec(select(Scene).where(Scene.script_id == script_uuid)).all())
    for scene in existing_scenes:
        for sc in db.exec(select(SceneCharacter).where(SceneCharacter.scene_id == scene.id)).all():
            db.delete(sc)
    db.flush()  # Emit scene_character DELETEs before deleting scenes (FK constraint)
    for s in existing_scenes:
        db.delete(s)
    for c in db.exec(select(Character).where(Character.script_id == script_uuid)).all():
        db.delete(c)
    db.commit()
    # Insert characters
    char_id_by_name = {}
    for name in unique_characters:
        ch = Character(script_id=script_uuid, user_id=user_id, name=name)
        db.add(ch)
        db.flush()
        char_id_by_name[name] = ch.id
    # Insert scenes and scene_characters
    scene_ids = []
    for i, h in enumerate(headings):
        sc = Scene(
            script_id=script_uuid,
            user_id=user_id,
            heading=h["heading"],
            page_number=h.get("page_number", ""),
            length_in_eighths=h.get("length_in_eighths"),
            scene_number=i + 1,
        )
        db.add(sc)
        db.flush()
        scene_ids.append(sc.id)
        for cname in scene_char_map.get(i, set()):
            cid = char_id_by_name.get(cname)
            if cid:
                db.add(SceneCharacter(scene_id=sc.id, character_id=cid, user_id=user_id))
    script.page_count = page_count
    db.add(script)
    db.commit()
    cache_delete(scripts_stats_key(script_id))
    # Persist script.json in same location as script.pdf (full elements when available, else reduced)
    if full_elements is not None and script_metadata is not None:
        json_bytes = _script_json_to_bytes(full_elements, script_metadata)
    else:
        json_bytes = _build_script_json(headings, unique_characters, scene_char_map, page_count)
    save_script_file(
        script.user_id,
        str(script.project_id),
        str(script.id),
        "script.json",
        io.BytesIO(json_bytes),
        len(json_bytes),
    )
    return {"success": True, "data": {"scenes": len(headings), "characters": len(unique_characters)}}


# DELETE /scripts/{script_id}
@router.delete("/scripts/{script_id}")
def delete_script(
    script_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    script = _get_script_and_ensure_access(db, script_id, user_id)

    delete_script_dir(script.user_id, str(script.project_id), str(script.id))
    db.delete(script)
    db.commit()

    cache_delete(scripts_list_key(str(script.project_id)))
    cache_delete(scripts_stats_key(script_id))
    return {"success": True}
