import json
import re
import uuid
from dataclasses import dataclass, field
from typing import List, Optional

from sqlalchemy import text
from sqlmodel import Session

TOKEN_BUDGET = 6000

from models import Script
from scripts.router import _read_script_json

_SCENE_PATTERNS = [
    re.compile(r'\bscene\s+(\d+)\b', re.IGNORECASE),
    re.compile(r'\bsc\.?\s+(\d+)\b', re.IGNORECASE),
    re.compile(r'#(\d+)\b'),
]

_BUDGET_SIGNALS = re.compile(
    r'\b(cost|budget|money|expensive|cheap|afford|price|rate|day rate|hire)\b',
    re.IGNORECASE,
)

_SCHEDULE_SIGNALS = re.compile(
    r'\b(day|schedule|shoot|shooting day|tram|week|calendar|timeline|when)\b',
    re.IGNORECASE,
)


@dataclass
class ChatContext:
    script_id: str
    title: str
    page_count: int
    scene_index: list
    analysis_summary: dict
    production_decisions: list
    full_scenes: list = field(default_factory=list)
    budget_context: dict = field(default_factory=dict)
    schedule_context: dict = field(default_factory=dict)


def assemble_chat_context(script_id: str, message: str, db: Session) -> ChatContext:
    # 1. Script record
    script_row = db.execute(
        text("SELECT id, name, page_count FROM script WHERE id = :script_id"),
        {"script_id": script_id},
    ).first()
    title = script_row[1] if script_row else "Untitled"
    page_count = script_row[2] if script_row else 0

    # 2. Scene index
    scene_rows = db.execute(
        text("""
            SELECT scene_number, heading, page_number, length_in_eighths,
                   location_type, scene_location, location_details,
                   is_night_shoot, characters
            FROM scenes
            WHERE script_id = :script_id
            ORDER BY scene_number ASC
        """),
        {"script_id": script_id},
    ).fetchall()

    scene_index = []
    for row in scene_rows:
        (
            scene_number, heading, page_number, length_in_eighths,
            location_type, scene_location, location_details,
            is_night_shoot, characters_raw,
        ) = row
        if isinstance(characters_raw, str):
            try:
                characters = json.loads(characters_raw)
            except (ValueError, TypeError):
                characters = []
        elif isinstance(characters_raw, list):
            characters = characters_raw
        else:
            characters = []
        scene_index.append({
            "scene_number": scene_number,
            "heading": heading,
            "page_number": page_number,
            "length_in_eighths": length_in_eighths,
            "location_type": location_type,
            "scene_location": scene_location,
            "location_details": location_details,
            "is_night_shoot": is_night_shoot,
            "characters": characters,
        })

    # 3. Analysis summary
    analysis_row = db.execute(
        text("""
            SELECT act_structure, location_map, cast_summary,
                   risk_scores, production_metrics
            FROM script_analysis
            WHERE script_id = :script_id
        """),
        {"script_id": script_id},
    ).first()

    if analysis_row:
        analysis_summary = {
            "act_structure": analysis_row[0],
            "location_map": analysis_row[1],
            "cast_summary": analysis_row[2],
            "risk_scores": analysis_row[3],
            "production_metrics": analysis_row[4],
        }
    else:
        analysis_summary = {}

    # 4. Production decisions
    decision_rows = db.execute(
        text("""
            SELECT decision_type, summary, detail, scene_refs, created_at
            FROM production_decisions
            WHERE script_id = :script_id
            ORDER BY created_at ASC
        """),
        {"script_id": script_id},
    ).fetchall()

    production_decisions = [
        {
            "decision_type": row[0],
            "summary": row[1],
            "detail": row[2],
            "scene_refs": row[3],
            "created_at": str(row[4]) if row[4] else None,
        }
        for row in decision_rows
    ]

    # 5. Detect referenced scene numbers in message
    referenced_scenes: List[int] = []
    for pattern in _SCENE_PATTERNS:
        for match in pattern.finditer(message):
            n = int(match.group(1))
            if n not in referenced_scenes:
                referenced_scenes.append(n)
    referenced_scenes.sort()

    # 6. Fetch full script content — always load all scenes grouped by scene_number.
    # referenced_scenes detection above is kept for backwards compatibility but is
    # now redundant; full content is always returned so the AI sees the complete script.
    full_scenes: List[dict] = []
    script_obj = db.get(Script, uuid.UUID(script_id))
    if script_obj:
        parsed = _read_script_json(script_obj)
        if parsed:
            elements, _ = parsed
            current_scene_number: Optional[int] = None
            current_scene_elements: List[dict] = []
            for el in elements:
                if el.get("type") == "scene_heading":
                    if current_scene_number is not None:
                        full_scenes.append({
                            "scene_number": current_scene_number,
                            "elements": current_scene_elements,
                        })
                    current_scene_number = el.get("scene_number")
                    current_scene_elements = [el]
                elif current_scene_number is not None:
                    current_scene_elements.append(el)
            if current_scene_number is not None and current_scene_elements:
                full_scenes.append({
                    "scene_number": current_scene_number,
                    "elements": current_scene_elements,
                })

    # 7–9. Detect context signals and fetch conditional data
    include_budget = bool(_BUDGET_SIGNALS.search(message))
    include_schedule = bool(_SCHEDULE_SIGNALS.search(message))

    budget_context = _get_budget_context(script_id, db) if include_budget else {}
    schedule_context = _get_schedule_context(script_id, db) if include_schedule else {}

    return ChatContext(
        script_id=script_id,
        title=title,
        page_count=page_count or 0,
        scene_index=scene_index,
        analysis_summary=analysis_summary,
        production_decisions=production_decisions,
        full_scenes=full_scenes,
        budget_context=budget_context,
        schedule_context=schedule_context,
    )


def _get_budget_context(script_id: str, db: Session) -> dict:
    # Budget is linked to project, not script directly.
    # Join: script → project → budget → budget_line_item.
    rows = db.execute(
        text("""
            SELECT b.total_budget, b.currency, b.template_id,
                   bli.category, bli.item_name, bli.estimated_amount, bli.view_type
            FROM script s
            JOIN budget b ON b.project_id = s.project_id
            LEFT JOIN budget_line_item bli ON bli.budget_id = b.id
            WHERE s.id = :script_id
            ORDER BY bli.sort_order ASC NULLS LAST
        """),
        {"script_id": script_id},
    ).fetchall()

    if not rows:
        return {}

    first = rows[0]
    total_budget = first[0]
    currency = first[1] or "GBP"
    template_id = first[2]

    line_items = []
    for row in rows:
        if row[3] is not None or row[4] is not None:
            line_items.append({
                "category": row[3],
                "item_name": row[4],
                "estimated_amount": row[5],
                "view_type": row[6],
            })

    return {
        "total_budget": total_budget,
        "currency": currency,
        "template_id": template_id,
        "line_items": line_items,
    }


def _get_schedule_context(script_id: str, db: Session) -> dict:
    # Shooting day assignments are stored on the scenes table (scenes.shooting_day,
    # scenes.continuity_day). The tram_lines table holds shot coverage markers
    # (line position, shot type, camera direction) and does not carry scheduling data.
    rows = db.execute(
        text("""
            SELECT scene_number, heading, shooting_day, continuity_day, time_of_day_id
            FROM scenes
            WHERE script_id = :script_id
              AND shooting_day IS NOT NULL
            ORDER BY shooting_day ASC, scene_number ASC
        """),
        {"script_id": script_id},
    ).fetchall()

    if not rows:
        return {}

    days: dict = {}
    for row in rows:
        scene_number, heading, shooting_day, continuity_day, time_of_day_id = row
        if shooting_day not in days:
            days[shooting_day] = []
        days[shooting_day].append({
            "scene_number": scene_number,
            "heading": heading,
            "continuity_day": continuity_day,
            "time_of_day_id": time_of_day_id,
        })

    return {"shooting_days": days}


def get_message_history(chat_id: str, db: Session, max_turns: int = 20) -> list:
    """Return the last max_turns messages for chat_id, trimmed to TOKEN_BUDGET."""
    rows = db.execute(
        text("""
            SELECT role, content FROM script_messages
            WHERE chat_id = :chat_id
            ORDER BY created_at ASC
        """),
        {"chat_id": chat_id},
    ).fetchall()

    if not rows:
        return []

    messages = [{"role": row[0], "content": row[1]} for row in rows]

    # Keep only the last max_turns messages before applying the token guard.
    if len(messages) > max_turns:
        messages = messages[-max_turns:]

    # Token budget guard: trim oldest messages until under budget.
    # Never remove the last message (most recent user turn).
    while len(messages) > 1:
        estimated = sum(len(m["content"]) // 4 for m in messages)
        if estimated <= TOKEN_BUDGET:
            break
        messages.pop(0)

    return messages
