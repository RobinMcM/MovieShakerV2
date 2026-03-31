import json
import io
import re
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select, update
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.session.framework.fastapi import verify_session

from cache import cache_delete, scripts_list_key, scripts_stats_key
from credits import apply_credit_cost, ensure_user_can_generate, extract_credit_cost
from db import get_session
from gateway_client import GatewayClient, GatewayClientError
from config import load_settings
from models import (
    Character,
    FilmInABoxItem,
    Project,
    ProjectMember,
    Scene,
    SceneCharacter,
    Script,
    UserProfile,
)
from storage import (
    relative_file_path,
    save_script_file,
    script_json_path,
    get_script_file_stream,
    uses_spaces,
)


router = APIRouter(prefix="/api/film-in-a-box", tags=["film-in-a-box"])
settings = load_settings()
PRODUCER_TIER_LIMITS = {"standard": 5, "indie": 25, "production_company": 999}


class GenerateBody(BaseModel):
    title: str
    prompt: str
    type: str  # FILM | DOC
    previousContent: Optional[Any] = None
    model: Optional[str] = None


class FestivalAnalyzeBody(BaseModel):
    projectId: str
    title: Optional[str] = None
    projectDescription: Optional[str] = None
    model: Optional[str] = None


class FundingAnalyzeBody(BaseModel):
    projectId: str
    title: Optional[str] = None
    logline: Optional[str] = None
    genre: Optional[str] = None
    projectDescription: Optional[str] = None
    model: Optional[str] = None


class MarketingAnalyzeBody(BaseModel):
    projectId: str
    title: Optional[str] = None
    logline: Optional[str] = None
    genre: Optional[str] = None
    projectDescription: Optional[str] = None
    model: Optional[str] = None


class FestivalStrategyAnalyzeBody(BaseModel):
    projectId: str
    title: Optional[str] = None
    genre: Optional[str] = None
    logline: Optional[str] = None
    projectDescription: Optional[str] = None
    model: Optional[str] = None


class SaveBody(BaseModel):
    projectId: str
    title: str
    type: str  # FILM | DOC
    content: Any
    prompt: Optional[str] = None


class CreateProjectBody(BaseModel):
    title: str
    type: str  # FILM | DOC
    content: Any
    prompt: Optional[str] = None


def _extract_writer_from_script_json(script_json: dict[str, Any]) -> str:
    metadata = script_json.get("metadata")
    if isinstance(metadata, dict):
        for key in ("author", "writer", "written_by"):
            value = metadata.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _extract_script_excerpt(script_json: dict[str, Any], max_chars: int = 5000) -> str:
    elements = script_json.get("elements")
    if not isinstance(elements, list):
        return ""
    lines: list[str] = []
    total = 0
    for element in elements:
        if not isinstance(element, dict):
            continue
        line_type = str(element.get("type") or "").strip().lower()
        text = str(element.get("text") or "").strip()
        if not text:
            continue
        prefix = f"[{line_type}] " if line_type else ""
        line = f"{prefix}{text}"
        next_total = total + len(line) + 1
        if next_total > max_chars:
            break
        lines.append(line)
        total = next_total
    return "\n".join(lines)


def _load_script_json_for_script(script: Script) -> dict[str, Any] | None:
    key = relative_file_path(script.user_id, str(script.project_id), str(script.id), "script.json")
    raw: bytes | None = None
    if uses_spaces():
        stream_result = get_script_file_stream(key)
        if stream_result:
            raw = stream_result[0]
    else:
        path = script_json_path(script.user_id, str(script.project_id), str(script.id))
        if path.exists():
            raw = path.read_bytes()
    if not raw:
        return None
    try:
        parsed = json.loads(raw.decode("utf-8"))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _build_festival_prompt(
    *,
    title: str,
    project_description: str,
    writer_hint: str,
    format_hint: str,
    scene_headings: list[str],
    characters: list[str],
    script_excerpt: str,
) -> str:
    scenes_text = "\n".join(f"- {heading}" for heading in scene_headings[:20]) or "(none)"
    characters_text = ", ".join(characters[:30]) or "(none)"
    script_block = script_excerpt.strip() if script_excerpt.strip() else "(script text unavailable)"
    return (
        "You are helping fill a film festival strategy form.\n"
        "Return ONLY strict JSON with this exact shape:\n"
        "{\n"
        '  "writer": string,\n'
        '  "format": string,\n'
        '  "genreTone": string,\n'
        '  "whyNow": string,\n'
        '  "comps": string,\n'
        '  "targetAudience": string\n'
        "}\n"
        "Rules:\n"
        "- writer: infer from script metadata/byline if available. If unknown, return empty string.\n"
        "- format: classify clearly (e.g., Short Film, Feature Film, Documentary, Series Episode).\n"
        "- genreTone: concise genre + tone label.\n"
        "- whyNow: 2-4 sentences on timeliness and relevance.\n"
        "- comps: 2-5 realistic comparable films/series and why briefly.\n"
        "- targetAudience: specific audience segments and viewing behavior.\n"
        "- Do not include markdown, code fences, or extra keys.\n\n"
        f"Project title: {title}\n"
        f"Project description: {project_description or '(none)'}\n"
        f"Writer hint from script: {writer_hint or '(unknown)'}\n"
        f"Format hint from script metadata: {format_hint or '(unknown)'}\n"
        f"Character list: {characters_text}\n"
        "Scene headings:\n"
        f"{scenes_text}\n\n"
        "Script excerpt:\n"
        f"{script_block}\n"
    )


def _normalize_festival_result(candidate: Any) -> dict[str, str]:
    if not isinstance(candidate, dict):
        return {
            "writer": "",
            "format": "",
            "genreTone": "",
            "whyNow": "",
            "comps": "",
            "targetAudience": "",
        }
    return {
        "writer": str(candidate.get("writer") or "").strip(),
        "format": str(candidate.get("format") or "").strip(),
        "genreTone": str(candidate.get("genreTone") or "").strip(),
        "whyNow": str(candidate.get("whyNow") or "").strip(),
        "comps": str(candidate.get("comps") or "").strip(),
        "targetAudience": str(candidate.get("targetAudience") or "").strip(),
    }


def _build_funding_prompt(
    *,
    title: str,
    logline: str,
    genre: str,
    project_description: str,
    writer_hint: str,
    format_hint: str,
    scene_headings: list[str],
    script_excerpt: str,
) -> str:
    scenes_text = "\n".join(f"- {heading}" for heading in scene_headings[:20]) or "(none)"
    script_block = script_excerpt.strip() if script_excerpt.strip() else "(script text unavailable)"
    return (
        "You are helping fill an indie film funding plan form.\n"
        "Return ONLY strict JSON with this exact shape:\n"
        "{\n"
        '  "budgetMvp": string,\n'
        '  "budgetTarget": string,\n'
        '  "budgetStretch": string,\n'
        '  "sourceGrants": string,\n'
        '  "sourcePrivate": string,\n'
        '  "sourceCrowd": string,\n'
        '  "sourceInKind": string\n'
        "}\n"
        "Rules:\n"
        "- Budgets should be practical indie ranges with currency symbols.\n"
        "- sourceGrants: specific grant/public funding strategy and examples.\n"
        "- sourcePrivate: realistic private investor strategy and packaging notes.\n"
        "- sourceCrowd: concise crowdfunding strategy with campaign angle and audience hook.\n"
        "- sourceInKind: specific in-kind contributions to pursue.\n"
        "- Keep each field concise and actionable.\n"
        "- No markdown, no code fences, and no extra keys.\n\n"
        f"Project title: {title}\n"
        f"Logline: {logline or '(none)'}\n"
        f"Genre/tone: {genre or '(unknown)'}\n"
        f"Project description: {project_description or '(none)'}\n"
        f"Writer hint: {writer_hint or '(unknown)'}\n"
        f"Format hint: {format_hint or '(unknown)'}\n"
        "Scene headings:\n"
        f"{scenes_text}\n\n"
        "Script excerpt:\n"
        f"{script_block}\n"
    )


def _normalize_funding_result(candidate: Any) -> dict[str, str]:
    if not isinstance(candidate, dict):
        return {
            "budgetMvp": "",
            "budgetTarget": "",
            "budgetStretch": "",
            "sourceGrants": "",
            "sourcePrivate": "",
            "sourceCrowd": "",
            "sourceInKind": "",
        }
    return {
        "budgetMvp": str(candidate.get("budgetMvp") or "").strip(),
        "budgetTarget": str(candidate.get("budgetTarget") or "").strip(),
        "budgetStretch": str(candidate.get("budgetStretch") or "").strip(),
        "sourceGrants": str(candidate.get("sourceGrants") or "").strip(),
        "sourcePrivate": str(candidate.get("sourcePrivate") or "").strip(),
        "sourceCrowd": str(candidate.get("sourceCrowd") or "").strip(),
        "sourceInKind": str(candidate.get("sourceInKind") or "").strip(),
    }


def _build_marketing_prompt(
    *,
    title: str,
    logline: str,
    genre: str,
    project_description: str,
    writer_hint: str,
    format_hint: str,
    scene_headings: list[str],
    characters: list[str],
    script_excerpt: str,
) -> str:
    scenes_text = "\n".join(f"- {heading}" for heading in scene_headings[:20]) or "(none)"
    characters_text = ", ".join(characters[:30]) or "(none)"
    script_block = script_excerpt.strip() if script_excerpt.strip() else "(script text unavailable)"
    return (
        "You are helping fill a film marketing section.\n"
        "Return ONLY strict JSON with this exact shape:\n"
        "{\n"
        '  "logline": string,\n'
        '  "synopsis": string,\n'
        '  "visualTone": string,\n'
        '  "contentPlan": string,\n'
        '  "channels": string,\n'
        '  "pressOutlets": string\n'
        "}\n"
        "Rules:\n"
        "- logline: one compelling sentence.\n"
        "- synopsis: concise 1-2 paragraph summary.\n"
        "- visualTone: short style description.\n"
        "- contentPlan: practical phased launch content plan.\n"
        "- channels: concrete channels, comma-separated.\n"
        "- pressOutlets: realistic outlet/category targets, comma-separated.\n"
        "- Keep answers actionable and concise.\n"
        "- No markdown, no code fences, and no extra keys.\n\n"
        f"Project title: {title}\n"
        f"Current logline: {logline or '(none)'}\n"
        f"Genre/tone: {genre or '(unknown)'}\n"
        f"Project description: {project_description or '(none)'}\n"
        f"Writer hint: {writer_hint or '(unknown)'}\n"
        f"Format hint: {format_hint or '(unknown)'}\n"
        f"Character list: {characters_text}\n"
        "Scene headings:\n"
        f"{scenes_text}\n\n"
        "Script excerpt:\n"
        f"{script_block}\n"
    )


def _normalize_marketing_result(candidate: Any) -> dict[str, str]:
    if not isinstance(candidate, dict):
        return {
            "logline": "",
            "synopsis": "",
            "visualTone": "",
            "contentPlan": "",
            "channels": "",
            "pressOutlets": "",
        }
    return {
        "logline": str(candidate.get("logline") or "").strip(),
        "synopsis": str(candidate.get("synopsis") or "").strip(),
        "visualTone": str(candidate.get("visualTone") or "").strip(),
        "contentPlan": str(candidate.get("contentPlan") or "").strip(),
        "channels": str(candidate.get("channels") or "").strip(),
        "pressOutlets": str(candidate.get("pressOutlets") or "").strip(),
    }


def _build_festival_strategy_prompt(
    *,
    title: str,
    logline: str,
    genre: str,
    project_description: str,
    writer_hint: str,
    format_hint: str,
    scene_headings: list[str],
    script_excerpt: str,
) -> str:
    scenes_text = "\n".join(f"- {heading}" for heading in scene_headings[:20]) or "(none)"
    script_block = script_excerpt.strip() if script_excerpt.strip() else "(script text unavailable)"
    return (
        "You are helping fill a film festival strategy section.\n"
        "Return ONLY strict JSON with this exact shape:\n"
        "{\n"
        '  "tier1": string,\n'
        '  "tier2": string,\n'
        '  "tier3": string,\n'
        '  "distribution": string\n'
        "}\n"
        "Rules:\n"
        "- tier1: top prestige festivals best fit for this project and why.\n"
        "- tier2: strong secondary festivals and positioning strategy.\n"
        "- tier3: regional/niche/genre festivals with practical submission plan.\n"
        "- distribution: post-festival distribution roadmap (sales, platforms, windows).\n"
        "- Keep each field concise and actionable.\n"
        "- No markdown, no code fences, and no extra keys.\n\n"
        f"Project title: {title}\n"
        f"Logline: {logline or '(none)'}\n"
        f"Genre/tone: {genre or '(unknown)'}\n"
        f"Project description: {project_description or '(none)'}\n"
        f"Writer hint: {writer_hint or '(unknown)'}\n"
        f"Format hint: {format_hint or '(unknown)'}\n"
        "Scene headings:\n"
        f"{scenes_text}\n\n"
        "Script excerpt:\n"
        f"{script_block}\n"
    )


def _normalize_festival_strategy_result(candidate: Any) -> dict[str, str]:
    if not isinstance(candidate, dict):
        return {
            "tier1": "",
            "tier2": "",
            "tier3": "",
            "distribution": "",
        }
    return {
        "tier1": str(candidate.get("tier1") or "").strip(),
        "tier2": str(candidate.get("tier2") or "").strip(),
        "tier3": str(candidate.get("tier3") or "").strip(),
        "distribution": str(candidate.get("distribution") or "").strip(),
    }


def _ensure_project_member(db: Session, project_id: str, user_id: str) -> None:
    try:
        project_uuid = uuid.UUID(project_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid project id")
    member = db.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_uuid,
            ProjectMember.user_id == user_id,
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this project")


def _gateway_client() -> GatewayClient:
    return GatewayClient(
        base_url=settings.gateway_base_url,
        api_key=settings.gateway_internal_api_key,
        timeout_seconds=settings.gateway_timeout_seconds,
        verify_tls=settings.gateway_verify_tls,
    )


def _extract_text_from_gateway(response: dict) -> str:
    if not isinstance(response, dict):
        return ""

    # Common gateway format: {"result": {"choices":[{"message":{"content":"..."}}]}}
    result_block = response.get("result")
    if isinstance(result_block, dict):
        choices = result_block.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                message = first.get("message")
                if isinstance(message, dict):
                    content = message.get("content")
                    if isinstance(content, str) and content.strip():
                        return content.strip()
                text_val = first.get("text")
                if isinstance(text_val, str) and text_val.strip():
                    return text_val.strip()

    for key in ("text", "result", "output", "content", "message"):
        value = response.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    data = response.get("data")
    if isinstance(data, dict):
        for key in ("text", "result", "output", "content", "message"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    choices = response.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            message = first.get("message")
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    return content.strip()
            text_val = first.get("text")
            if isinstance(text_val, str) and text_val.strip():
                return text_val.strip()

    return ""


def _extract_json_block(raw: str) -> Optional[dict]:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        snippet = raw[start : end + 1]
        try:
            parsed = json.loads(snippet)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


def _film_prompt(title: str, prompt: str, previous: Optional[Any]) -> str:
    if previous:
        return (
            f"Continue refining this short film screenplay for '{title}'.\n"
            "Respect existing tone, character voices, and structure. Improve pacing and visual storytelling.\n"
            "Return screenplay text only.\n\n"
            f"Existing Draft:\n{previous}\n\n"
            f"New Direction:\n{prompt}"
        )
    return (
        f"Write a short film screenplay draft titled '{title}'.\n"
        "Use professional screenplay style with scene headings, action, and dialogue.\n"
        "Keep it concise but complete, emotionally coherent, and production-aware.\n"
        "Return screenplay text only.\n\n"
        f"Idea / Synopsis:\n{prompt}"
    )


def _doc_prompt(title: str, prompt: str, previous: Optional[Any]) -> str:
    base = (
        "Generate a documentary development package as strict JSON.\n"
        "Return ONLY valid JSON with this exact top-level shape:\n"
        "{\n"
        '  "logline": string,\n'
        '  "thematicStatement": string,\n'
        '  "chapters": [{"chapterNumber": number, "title": string, "summary": string, "visuals": string}],\n'
        '  "interviewCandidates": [{"role": string, "description": string}],\n'
        '  "visualStyle": string,\n'
        '  "bRollWishlist": [string],\n'
        '  "script": string or array of {"VIDEO": string, "AUDIO": string}\n'
        "}\n"
    )
    if previous:
        return (
            f"{base}\n"
            f"Title: {title}\n"
            "Refine and continue from previous JSON while preserving structure.\n"
            f"Previous JSON/content:\n{previous}\n\n"
            f"New direction:\n{prompt}\n"
        )
    return f"{base}\nTitle: {title}\nBrief:\n{prompt}\n"


def _normalize_doc_result(candidate: Any) -> dict:
    if not isinstance(candidate, dict):
        return {
            "logline": "",
            "thematicStatement": "",
            "chapters": [],
            "interviewCandidates": [],
            "visualStyle": "",
            "bRollWishlist": [],
            "script": str(candidate or ""),
        }
    return {
        "logline": candidate.get("logline", ""),
        "thematicStatement": candidate.get("thematicStatement", ""),
        "chapters": candidate.get("chapters", []) if isinstance(candidate.get("chapters"), list) else [],
        "interviewCandidates": candidate.get("interviewCandidates", [])
        if isinstance(candidate.get("interviewCandidates"), list)
        else [],
        "visualStyle": candidate.get("visualStyle", ""),
        "bRollWishlist": candidate.get("bRollWishlist", [])
        if isinstance(candidate.get("bRollWishlist"), list)
        else [],
        "script": candidate.get("script", ""),
    }


_SCENE_HEADING_RE = re.compile(r"^(INT\.|EXT\.|INT\./EXT\.|I/E|EST\.)(?:\s|$)", re.IGNORECASE)
_CHARACTER_RE = re.compile(r"^[A-Z][A-Z0-9\s\-']{1,48}$")


def _extract_screenplay_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, dict):
        for key in ("screenplay", "script", "content", "text"):
            value = content.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return str(content or "").strip()


def _film_text_to_elements(script_text: str) -> list[dict[str, str]]:
    elements: list[dict[str, str]] = []
    for raw_line in script_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if _SCENE_HEADING_RE.match(line):
            elements.append({"type": "scene_heading", "text": line})
            continue
        if _CHARACTER_RE.match(line):
            name = re.sub(r"\s*\([^)]*\)", "", line).strip().rstrip(". ")
            if name:
                elements.append({"type": "character", "text": name})
            continue
        elements.append({"type": "action", "text": line})
    return elements


def _derive_scene_character_data(elements: list[dict[str, str]]) -> tuple[list[str], list[str], dict[int, set[str]]]:
    headings: list[str] = []
    scene_char_map: dict[int, set[str]] = {}
    character_set: set[str] = set()

    for item in elements:
        line_type = (item.get("type") or "").strip().lower()
        text = (item.get("text") or "").strip()
        if not text:
            continue
        if line_type == "scene_heading":
            headings.append(text[:255])
            scene_char_map[len(headings) - 1] = set()
            continue
        if line_type == "character":
            character_set.add(text)
            if headings:
                scene_char_map[len(headings) - 1].add(text)

    return headings, sorted(character_set), scene_char_map


def _upsert_project_script_from_fiab(
    db: Session,
    user_id: str,
    project_id: uuid.UUID,
    title: str,
    script_text: str,
) -> None:
    elements = _film_text_to_elements(script_text)
    headings, unique_characters, scene_char_map = _derive_scene_character_data(elements)
    script_name = title.strip() or "a Film in a Box Draft"
    page_count = max(1, len(script_text.splitlines()) // 55)

    scripts = list(
        db.exec(
            select(Script)
            .where(Script.project_id == project_id)
            .order_by(Script.uploaded_at.desc())
        ).all()
    )
    generated_script = next(
        (s for s in scripts if (s.description or "") == "Generated by a Film in a Box"),
        None,
    )

    if generated_script is None:
        script_id = uuid.uuid4()
        rel_path = relative_file_path(user_id, str(project_id), str(script_id), "script.json")
        generated_script = Script(
            id=script_id,
            project_id=project_id,
            user_id=user_id,
            name=script_name,
            description="Generated by a Film in a Box",
            file_path=rel_path,
            is_current=True,
            page_count=page_count,
        )
        db.add(generated_script)
        db.flush()
    else:
        generated_script.name = script_name
        generated_script.page_count = page_count
        generated_script.is_current = True
        if not generated_script.file_path.endswith(".json"):
            generated_script.file_path = relative_file_path(
                user_id, str(project_id), str(generated_script.id), "script.json"
            )
        db.add(generated_script)
        db.flush()

    db.exec(update(Script).where(Script.project_id == project_id).values(is_current=False))
    generated_script.is_current = True
    db.add(generated_script)
    db.flush()

    existing_scenes = list(db.exec(select(Scene).where(Scene.script_id == generated_script.id)).all())
    for scene in existing_scenes:
        for scene_character in db.exec(
            select(SceneCharacter).where(SceneCharacter.scene_id == scene.id)
        ).all():
            db.delete(scene_character)
    db.flush()
    for scene in existing_scenes:
        db.delete(scene)
    for character in db.exec(
        select(Character).where(Character.script_id == generated_script.id)
    ).all():
        db.delete(character)
    db.flush()

    char_id_by_name: dict[str, uuid.UUID] = {}
    for name in unique_characters:
        row = Character(script_id=generated_script.id, user_id=user_id, name=name)
        db.add(row)
        db.flush()
        char_id_by_name[name] = row.id

    for idx, heading in enumerate(headings):
        scene = Scene(
            script_id=generated_script.id,
            user_id=user_id,
            heading=heading,
            page_number=f"Page {idx + 1}",
            length_in_eighths=1,
            scene_number=idx + 1,
        )
        db.add(scene)
        db.flush()
        for char_name in sorted(scene_char_map.get(idx, set())):
            char_id = char_id_by_name.get(char_name)
            if char_id is None:
                continue
            db.add(SceneCharacter(scene_id=scene.id, character_id=char_id, user_id=user_id))

    doc = {
        "metadata": {
            "title": script_name,
            "author": "a Film in a Box",
            "created": datetime.utcnow().isoformat() + "Z",
            "draft": "a Film in a Box (AI Generated)",
            "page_count": page_count,
        },
        "elements": elements,
    }
    body = json.dumps(doc, indent=2).encode("utf-8")
    save_script_file(
        user_id,
        str(project_id),
        str(generated_script.id),
        "script.json",
        io.BytesIO(body),
        len(body),
    )

    cache_delete(scripts_list_key(str(project_id)))
    cache_delete(scripts_stats_key(str(generated_script.id)))


def _build_gateway_messages(prompt: str, want_json: bool) -> list[dict[str, str]]:
    system = (
        "You are a professional film development assistant."
        " Keep responses practical and production-oriented."
    )
    if want_json:
        system += " Return strict JSON only with no markdown."
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]


@router.post("/generate")
def generate(
    body: GenerateBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = ensure_user_can_generate(db, user_id)
    content_type = (body.type or "").strip().upper()
    if content_type not in {"FILM", "DOC"}:
        raise HTTPException(status_code=400, detail="type must be FILM or DOC")
    if not body.title.strip() or not body.prompt.strip():
        raise HTTPException(status_code=400, detail="Title and prompt are required")
    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")

    try:
        selected_model = (body.model or profile.model_fiab_text or settings.film_in_a_box_model).strip()
        if not selected_model:
            raise HTTPException(status_code=400, detail="Model is required")

        if content_type == "FILM":
            prompt = _film_prompt(body.title.strip(), body.prompt.strip(), body.previousContent)
            gateway_response = _gateway_client().execute_text(
                model=selected_model,
                messages=_build_gateway_messages(prompt, want_json=False),
            )
            text = _extract_text_from_gateway(gateway_response)
            if not text:
                raise HTTPException(status_code=502, detail="Gateway returned empty film content")
            credits_cost = extract_credit_cost(gateway_response)
            balance = apply_credit_cost(db, user_id, credits_cost)
            db.commit()
            return {"result": text, "credits": {"cost": credits_cost, "balance": balance}}

        prompt = _doc_prompt(body.title.strip(), body.prompt.strip(), body.previousContent)
        gateway_response = _gateway_client().execute_text(
            model=selected_model,
            messages=_build_gateway_messages(prompt, want_json=True),
        )
        raw_text = _extract_text_from_gateway(gateway_response)
        json_candidate = _extract_json_block(raw_text)
        if json_candidate is None and isinstance(gateway_response, dict):
            json_candidate = gateway_response.get("result") if isinstance(gateway_response.get("result"), dict) else None
            if json_candidate is None:
                json_candidate = gateway_response.get("data") if isinstance(gateway_response.get("data"), dict) else None
        normalized = _normalize_doc_result(json_candidate if json_candidate is not None else raw_text)
        credits_cost = extract_credit_cost(gateway_response)
        balance = apply_credit_cost(db, user_id, credits_cost)
        db.commit()
        return {"result": normalized, "credits": {"cost": credits_cost, "balance": balance}}
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/festival-analyze")
def festival_analyze(
    body: FestivalAnalyzeBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = ensure_user_can_generate(db, user_id)
    if not body.projectId.strip():
        raise HTTPException(status_code=400, detail="projectId is required")
    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")

    _ensure_project_member(db, body.projectId, user_id)
    project_uuid = uuid.UUID(body.projectId)
    project = db.get(Project, project_uuid)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    script = db.exec(
        select(Script)
        .where(Script.project_id == project_uuid)
        .order_by(Script.is_current.desc(), Script.uploaded_at.desc())
    ).first()
    if not script:
        raise HTTPException(status_code=400, detail="No script found for this project. Upload a script first.")

    script_json = _load_script_json_for_script(script) or {}
    writer_hint = _extract_writer_from_script_json(script_json)
    format_hint = project.film_type or ""
    scene_rows = list(
        db.exec(
            select(Scene)
            .where(Scene.script_id == script.id)
            .order_by(Scene.scene_number.asc(), Scene.id.asc())
        ).all()
    )
    scene_headings = [str(scene.heading or "").strip() for scene in scene_rows if str(scene.heading or "").strip()]
    character_rows = list(
        db.exec(
            select(Character)
            .where(Character.script_id == script.id)
            .order_by(Character.name.asc())
        ).all()
    )
    characters = [str(character.name or "").strip() for character in character_rows if str(character.name or "").strip()]
    script_excerpt = _extract_script_excerpt(script_json)

    selected_model = (body.model or profile.model_fiab_text or settings.film_in_a_box_model).strip()
    if not selected_model:
        raise HTTPException(status_code=400, detail="Model is required")

    prompt = _build_festival_prompt(
        title=(body.title or project.name or "Untitled project").strip() or "Untitled project",
        project_description=(body.projectDescription or project.description or "").strip(),
        writer_hint=writer_hint,
        format_hint=format_hint.strip(),
        scene_headings=scene_headings,
        characters=characters,
        script_excerpt=script_excerpt,
    )

    try:
        gateway_response = _gateway_client().execute_text(
            model=selected_model,
            messages=_build_gateway_messages(prompt, want_json=True),
        )
        raw_text = _extract_text_from_gateway(gateway_response)
        json_candidate = _extract_json_block(raw_text)
        if json_candidate is None and isinstance(gateway_response, dict):
            json_candidate = gateway_response.get("result") if isinstance(gateway_response.get("result"), dict) else None
            if json_candidate is None:
                json_candidate = gateway_response.get("data") if isinstance(gateway_response.get("data"), dict) else None
        normalized = _normalize_festival_result(json_candidate if json_candidate is not None else raw_text)
        credits_cost = extract_credit_cost(gateway_response)
        balance = apply_credit_cost(db, user_id, credits_cost)
        db.commit()
        return {"result": normalized, "credits": {"cost": credits_cost, "balance": balance}}
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/funding-analyze")
def funding_analyze(
    body: FundingAnalyzeBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = ensure_user_can_generate(db, user_id)
    if not body.projectId.strip():
        raise HTTPException(status_code=400, detail="projectId is required")
    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")

    _ensure_project_member(db, body.projectId, user_id)
    project_uuid = uuid.UUID(body.projectId)
    project = db.get(Project, project_uuid)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    script = db.exec(
        select(Script)
        .where(Script.project_id == project_uuid)
        .order_by(Script.is_current.desc(), Script.uploaded_at.desc())
    ).first()
    if not script:
        raise HTTPException(status_code=400, detail="No script found for this project. Upload a script first.")

    script_json = _load_script_json_for_script(script) or {}
    writer_hint = _extract_writer_from_script_json(script_json)
    format_hint = project.film_type or ""
    scene_rows = list(
        db.exec(
            select(Scene)
            .where(Scene.script_id == script.id)
            .order_by(Scene.scene_number.asc(), Scene.id.asc())
        ).all()
    )
    scene_headings = [str(scene.heading or "").strip() for scene in scene_rows if str(scene.heading or "").strip()]
    script_excerpt = _extract_script_excerpt(script_json)

    selected_model = (body.model or profile.model_fiab_text or settings.film_in_a_box_model).strip()
    if not selected_model:
        raise HTTPException(status_code=400, detail="Model is required")

    prompt = _build_funding_prompt(
        title=(body.title or project.name or "Untitled project").strip() or "Untitled project",
        logline=(body.logline or "").strip(),
        genre=(body.genre or "").strip(),
        project_description=(body.projectDescription or project.description or "").strip(),
        writer_hint=writer_hint,
        format_hint=format_hint.strip(),
        scene_headings=scene_headings,
        script_excerpt=script_excerpt,
    )

    try:
        gateway_response = _gateway_client().execute_text(
            model=selected_model,
            messages=_build_gateway_messages(prompt, want_json=True),
        )
        raw_text = _extract_text_from_gateway(gateway_response)
        json_candidate = _extract_json_block(raw_text)
        if json_candidate is None and isinstance(gateway_response, dict):
            json_candidate = gateway_response.get("result") if isinstance(gateway_response.get("result"), dict) else None
            if json_candidate is None:
                json_candidate = gateway_response.get("data") if isinstance(gateway_response.get("data"), dict) else None
        normalized = _normalize_funding_result(json_candidate if json_candidate is not None else raw_text)
        credits_cost = extract_credit_cost(gateway_response)
        balance = apply_credit_cost(db, user_id, credits_cost)
        db.commit()
        return {"result": normalized, "credits": {"cost": credits_cost, "balance": balance}}
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/marketing-analyze")
def marketing_analyze(
    body: MarketingAnalyzeBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = ensure_user_can_generate(db, user_id)
    if not body.projectId.strip():
        raise HTTPException(status_code=400, detail="projectId is required")
    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")

    _ensure_project_member(db, body.projectId, user_id)
    project_uuid = uuid.UUID(body.projectId)
    project = db.get(Project, project_uuid)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    script = db.exec(
        select(Script)
        .where(Script.project_id == project_uuid)
        .order_by(Script.is_current.desc(), Script.uploaded_at.desc())
    ).first()
    if not script:
        raise HTTPException(status_code=400, detail="No script found for this project. Upload a script first.")

    script_json = _load_script_json_for_script(script) or {}
    writer_hint = _extract_writer_from_script_json(script_json)
    format_hint = project.film_type or ""
    scene_rows = list(
        db.exec(
            select(Scene)
            .where(Scene.script_id == script.id)
            .order_by(Scene.scene_number.asc(), Scene.id.asc())
        ).all()
    )
    scene_headings = [str(scene.heading or "").strip() for scene in scene_rows if str(scene.heading or "").strip()]
    character_rows = list(
        db.exec(
            select(Character)
            .where(Character.script_id == script.id)
            .order_by(Character.name.asc())
        ).all()
    )
    characters = [str(character.name or "").strip() for character in character_rows if str(character.name or "").strip()]
    script_excerpt = _extract_script_excerpt(script_json)

    selected_model = (body.model or profile.model_fiab_text or settings.film_in_a_box_model).strip()
    if not selected_model:
        raise HTTPException(status_code=400, detail="Model is required")

    prompt = _build_marketing_prompt(
        title=(body.title or project.name or "Untitled project").strip() or "Untitled project",
        logline=(body.logline or "").strip(),
        genre=(body.genre or "").strip(),
        project_description=(body.projectDescription or project.description or "").strip(),
        writer_hint=writer_hint,
        format_hint=format_hint.strip(),
        scene_headings=scene_headings,
        characters=characters,
        script_excerpt=script_excerpt,
    )

    try:
        gateway_response = _gateway_client().execute_text(
            model=selected_model,
            messages=_build_gateway_messages(prompt, want_json=True),
        )
        raw_text = _extract_text_from_gateway(gateway_response)
        json_candidate = _extract_json_block(raw_text)
        if json_candidate is None and isinstance(gateway_response, dict):
            json_candidate = gateway_response.get("result") if isinstance(gateway_response.get("result"), dict) else None
            if json_candidate is None:
                json_candidate = gateway_response.get("data") if isinstance(gateway_response.get("data"), dict) else None
        normalized = _normalize_marketing_result(json_candidate if json_candidate is not None else raw_text)
        credits_cost = extract_credit_cost(gateway_response)
        balance = apply_credit_cost(db, user_id, credits_cost)
        db.commit()
        return {"result": normalized, "credits": {"cost": credits_cost, "balance": balance}}
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/festival-strategy-analyze")
def festival_strategy_analyze(
    body: FestivalStrategyAnalyzeBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = ensure_user_can_generate(db, user_id)
    if not body.projectId.strip():
        raise HTTPException(status_code=400, detail="projectId is required")
    if not settings.gateway_base_url:
        raise HTTPException(status_code=503, detail="Gateway base URL is not configured")
    if not settings.gateway_internal_api_key:
        raise HTTPException(status_code=503, detail="Gateway API key is not configured")

    _ensure_project_member(db, body.projectId, user_id)
    project_uuid = uuid.UUID(body.projectId)
    project = db.get(Project, project_uuid)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    script = db.exec(
        select(Script)
        .where(Script.project_id == project_uuid)
        .order_by(Script.is_current.desc(), Script.uploaded_at.desc())
    ).first()
    if not script:
        raise HTTPException(status_code=400, detail="No script found for this project. Upload a script first.")

    script_json = _load_script_json_for_script(script) or {}
    writer_hint = _extract_writer_from_script_json(script_json)
    format_hint = project.film_type or ""
    scene_rows = list(
        db.exec(
            select(Scene)
            .where(Scene.script_id == script.id)
            .order_by(Scene.scene_number.asc(), Scene.id.asc())
        ).all()
    )
    scene_headings = [str(scene.heading or "").strip() for scene in scene_rows if str(scene.heading or "").strip()]
    script_excerpt = _extract_script_excerpt(script_json)

    selected_model = (body.model or profile.model_fiab_text or settings.film_in_a_box_model).strip()
    if not selected_model:
        raise HTTPException(status_code=400, detail="Model is required")

    prompt = _build_festival_strategy_prompt(
        title=(body.title or project.name or "Untitled project").strip() or "Untitled project",
        logline=(body.logline or "").strip(),
        genre=(body.genre or "").strip(),
        project_description=(body.projectDescription or project.description or "").strip(),
        writer_hint=writer_hint,
        format_hint=format_hint.strip(),
        scene_headings=scene_headings,
        script_excerpt=script_excerpt,
    )

    try:
        gateway_response = _gateway_client().execute_text(
            model=selected_model,
            messages=_build_gateway_messages(prompt, want_json=True),
        )
        raw_text = _extract_text_from_gateway(gateway_response)
        json_candidate = _extract_json_block(raw_text)
        if json_candidate is None and isinstance(gateway_response, dict):
            json_candidate = gateway_response.get("result") if isinstance(gateway_response.get("result"), dict) else None
            if json_candidate is None:
                json_candidate = gateway_response.get("data") if isinstance(gateway_response.get("data"), dict) else None
        normalized = _normalize_festival_strategy_result(json_candidate if json_candidate is not None else raw_text)
        credits_cost = extract_credit_cost(gateway_response)
        balance = apply_credit_cost(db, user_id, credits_cost)
        db.commit()
        return {"result": normalized, "credits": {"cost": credits_cost, "balance": balance}}
    except GatewayClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/save")
def save_generation(
    body: SaveBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    _ensure_project_member(db, body.projectId, user_id)
    row = FilmInABoxItem(
        user_id=user_id,
        project_id=uuid.UUID(body.projectId),
        name=body.title.strip() or "Untitled",
        content_type=(body.type or "FILM").strip().upper(),
        content_json=json.dumps(body.content),
        prompt=(body.prompt or "").strip() or None,
    )
    db.add(row)
    if (body.type or "").strip().upper() == "FILM":
        script_text = _extract_screenplay_text(body.content)
        if script_text:
            _upsert_project_script_from_fiab(
                db=db,
                user_id=user_id,
                project_id=uuid.UUID(body.projectId),
                title=body.title,
                script_text=script_text,
            )
    db.commit()
    return {"success": True}


@router.post("/create-project")
def create_project_from_generation(
    body: CreateProjectBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    profile = db.get(UserProfile, user_id)
    if not profile:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    if profile.blocked:
        raise HTTPException(status_code=403, detail="Account is blocked")
    if profile.role != "admin":
        limit = PRODUCER_TIER_LIMITS.get(profile.producer_tier, 5)
        count = db.exec(select(Project).where(Project.owner_id == user_id)).all()
        if len(count) >= limit:
            raise HTTPException(
                status_code=403,
                detail=f"Project limit reached for your plan ({limit} projects). Contact support to upgrade.",
            )

    project = Project(
        name=body.title.strip() or "Untitled Project",
        owner_id=user_id,
        creation_method="film_in_a_box",
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    member = ProjectMember(project_id=project.id, user_id=user_id, role="owner")
    db.add(member)

    row = FilmInABoxItem(
        user_id=user_id,
        project_id=project.id,
        name=body.title.strip() or "Untitled",
        content_type=(body.type or "FILM").strip().upper(),
        content_json=json.dumps(body.content),
        prompt=(body.prompt or "").strip() or None,
    )
    db.add(row)
    if (body.type or "").strip().upper() == "FILM":
        script_text = _extract_screenplay_text(body.content)
        if script_text:
            _upsert_project_script_from_fiab(
                db=db,
                user_id=user_id,
                project_id=project.id,
                title=body.title,
                script_text=script_text,
            )
    cache_delete(f"projects:list:{user_id}")
    db.commit()
    return {"projectId": str(project.id)}


@router.get("/list")
def list_items(
    projectId: Optional[str] = Query(default=None),
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    statement = select(FilmInABoxItem).where(FilmInABoxItem.user_id == user_id)

    if projectId:
        _ensure_project_member(db, projectId, user_id)
        statement = statement.where(FilmInABoxItem.project_id == uuid.UUID(projectId))

    rows = list(db.exec(statement.order_by(FilmInABoxItem.created_at.desc())).all())
    return {
        "list": [
            {
                "id": str(r.id),
                "name": r.name,
                "type": r.content_type,
                "project_id": str(r.project_id) if r.project_id else None,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]
    }


@router.get("/content/{item_id}")
def get_item_content(
    item_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    user_id = session.get_user_id()
    try:
        item_uuid = uuid.UUID(item_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid item id")

    row = db.get(FilmInABoxItem, item_uuid)
    if not row:
        raise HTTPException(status_code=404, detail="Item not found")
    if row.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized for this item")
    if row.project_id:
        _ensure_project_member(db, str(row.project_id), user_id)

    try:
        content = json.loads(row.content_json) if row.content_json else {}
    except Exception:
        content = row.content_json
    return {"type": row.content_type, "content": content}
