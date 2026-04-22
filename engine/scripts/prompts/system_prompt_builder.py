import json
import logging
from sqlmodel import Session
from sqlalchemy import text

from models import ChatbotPromptConfig
from admin import CHATBOT_LAYOUT_SCHEMAS

logger = logging.getLogger(__name__)

MAX_PROMPT_TOKENS = 80_000
MAX_SYSTEM_PROMPT_LENGTH = MAX_PROMPT_TOKENS * 4  # char ceiling (~320k)

CONTEXT_MODE_TO_SELECTION_KEY: dict[str, str] = {
    "scripts":    "movieshaker-scripts",
    "budgets":    "movieshaker-budgets",
    "schedule":   "movieshaker-schedule",
    "scheduling": "movieshaker-scheduling",
    "shotlist":   "movieshaker-shotlist",
    "general":    "movieshaker-general",
}

SCHEDULING_SYSTEM_PROMPT = """You are the CoProducer — the production scheduling \
architect for this film. You own the schedule. \
You speak with authority and precision.

You have full knowledge of this script from your analysis. On this page you are \
focused purely on the physical production — shoot days, locations, cast logistics, costs.

Your principles:
- Group scenes by location first — moving costs money
- Protect the lead actor — minimise their shoot days
- Night shoots cluster together or sit at end of week
- Heavy VFX days need technical crew — flag them
- Voice-only cast never need a call day
- Always flag when a day exceeds 32 eighths

When asked to generate a schedule:
- Return ONLY a valid JSON array
- No preamble, no explanation
- Format: [{"scene_number": 1, "shooting_day": 1}, ...]
- Assign every scene to a day
- Leave nothing unscheduled

When asked questions about the schedule:
- Reference scene numbers and shooting days precisely
- Quantify the impact of changes (cost, days, cast)
- Be decisive — give a recommendation, not options
- If the producer overrides you, adapt immediately

You are in control. The producer is assessing."""


def _estimate_tokens(s: str) -> int:
    return len(s) // 4


def _format_full_script(full_scenes: list) -> str:
    """Render grouped scene elements into readable screenplay format."""
    scene_blocks: list[str] = []
    for scene in full_scenes:
        lines: list[str] = []
        for el in scene.get("elements", []):
            el_type = el.get("type", "")
            el_text = (el.get("text") or "").strip()
            if not el_text:
                continue
            if el_type == "scene_heading":
                scene_num = scene.get("scene_number", "")
                lines.append(f"SCENE {scene_num}: {el_text}")
            elif el_type == "action":
                lines.append(el_text)
            elif el_type == "character":
                lines.append(f"{el_text}:")
            elif el_type == "dialogue":
                lines.append(f'"{el_text}"')
            elif el_type == "parenthetical":
                lines.append(f"({el_text})")
            elif el_type == "transition":
                lines.append(el_text)
            elif el_type == "page_number":
                continue
            else:
                lines.append(el_text)
        if lines:
            scene_blocks.append("\n".join(lines))
    return "\n\n".join(scene_blocks)


def _format_analysis(
    analysis_summary: dict,
    production_decisions: list,
    budget_context: dict,
    schedule_context: dict,
    title: str,
    page_count: int,
) -> str:
    parts: list[str] = [f"Script: {title}, {page_count} pages"]

    if analysis_summary:
        section_lines: list[str] = []
        for key, val in analysis_summary.items():
            if val:
                try:
                    formatted = json.dumps(val, indent=2) if isinstance(val, (dict, list)) else str(val)
                except Exception:
                    formatted = str(val)
                section_lines.append(f"### {key}\n{formatted}")
        if section_lines:
            parts.append("## Analysis\n" + "\n\n".join(section_lines))

    if production_decisions:
        decision_lines: list[str] = []
        for d in production_decisions:
            summary = d.get("summary", "")
            detail = d.get("detail", "")
            dtype = d.get("decision_type", "")
            if summary:
                entry = f"- [{dtype}] {summary}"
                if detail:
                    entry += f"\n  {detail}"
                decision_lines.append(entry)
        if decision_lines:
            parts.append("## Production Decisions\n" + "\n".join(decision_lines))

    if budget_context:
        parts.append("## Budget\n" + json.dumps(budget_context, indent=2))

    if schedule_context:
        parts.append("## Schedule\n" + json.dumps(schedule_context, indent=2))

    return "\n\n".join(parts)


def _format_scene_index(scene_index: list) -> str:
    lines: list[str] = []
    for s in scene_index:
        chars = ", ".join(s.get("characters") or [])
        line = f"Scene {s['scene_number']}: {s.get('heading', '')} (p{s.get('page_number', '')})"
        if chars:
            line += f" — {chars}"
        lines.append(line)
    return "\n".join(lines)


def build_system_prompt(
    context_mode: str,
    context,
    db: Session,
    user_id: str,
) -> str:
    """
    Assemble the system prompt for the script chat endpoint.

    Priority order (high → low, never drop higher):
      1. Admin context + rules + layout fields
      2. Script analysis + production decisions + budget/schedule
      3. User prompt override (never dropped)
      4. Full script content (truncated scene-by-scene from end if over budget)
      5. Scene index fallback if full script doesn't fit at all
    """
    selection_key = CONTEXT_MODE_TO_SELECTION_KEY.get(context_mode, "movieshaker-scripts")

    config = db.get(ChatbotPromptConfig, selection_key)
    has_admin_config = bool(
        config
        and (config.prompt_information or "").strip()
        and (config.prompt_rules or "").strip()
    )

    if not has_admin_config:
        from scripts.router import _build_script_chat_system_prompt
        base = _build_script_chat_system_prompt(context)
        if context_mode == "scheduling":
            return SCHEDULING_SYSTEM_PROMPT + "\n\n" + base
        return base

    layout_lines = _get_layout_field_lines(selection_key)
    prompt_override, override_mode = _get_user_override(db, user_id)

    # Build fixed (never-truncated) parts
    fixed_parts: list[str] = []

    if override_mode == "prepend" and prompt_override:
        fixed_parts.append("# User instructions\n" + prompt_override)

    fixed_parts.append("# Context\n" + config.prompt_information.strip())
    fixed_parts.append("# Rules\n" + config.prompt_rules.strip())

    if layout_lines:
        fixed_parts.append("# Page structure\n" + "\n".join(layout_lines))

    if context_mode == "scripts":
        analysis_text = _format_analysis(
            getattr(context, "analysis_summary", {}) or {},
            getattr(context, "production_decisions", []) or [],
            getattr(context, "budget_context", {}) or {},
            getattr(context, "schedule_context", {}) or {},
            getattr(context, "title", ""),
            getattr(context, "page_count", 0),
        )
        fixed_parts.append("# Script analysis\n" + analysis_text)

    fixed_text = "\n\n".join(fixed_parts)
    override_append_text = prompt_override if override_mode == "append" else ""
    script_budget = MAX_PROMPT_TOKENS - _estimate_tokens(fixed_text) - _estimate_tokens(override_append_text)

    # Fit full script within budget, dropping scenes from end if needed
    script_section = ""
    if context_mode == "scripts" and script_budget > 0:
        full_scenes = list(getattr(context, "full_scenes", []) or [])
        original_count = len(full_scenes)

        while full_scenes:
            formatted = _format_full_script(full_scenes)
            if _estimate_tokens(formatted) <= script_budget:
                script_section = formatted
                break
            full_scenes.pop()

        if full_scenes and len(full_scenes) < original_count:
            logger.warning(
                "Script prompt truncated: dropped %d of %d scenes to fit %d-token budget",
                original_count - len(full_scenes),
                original_count,
                script_budget,
            )

        if not script_section:
            # Full script won't fit at all — fall back to scene index
            scene_index = getattr(context, "scene_index", []) or []
            if scene_index:
                idx_text = _format_scene_index(scene_index)
                if _estimate_tokens(idx_text) <= script_budget:
                    script_section = idx_text
                    logger.warning(
                        "Script too large for prompt; using scene index fallback (%d scenes)",
                        len(scene_index),
                    )

    # Assemble final prompt
    parts = list(fixed_parts)
    if script_section:
        parts.append("# Script content\n" + script_section)
    if override_append_text:
        parts.append("# User instructions\n" + override_append_text)

    return "\n\n".join(parts)


def _get_layout_field_lines(selection_key: str) -> list[str]:
    layout = CHATBOT_LAYOUT_SCHEMAS.get(selection_key)
    if not layout:
        return []
    lines: list[str] = []
    for tab in layout.get("tabs", []):
        for field in tab.get("fields", []):
            lines.append(f"- {field['field_label']} ({field['field_key']})")
    return lines


def _get_user_override(db: Session, user_id: str) -> tuple[str, str]:
    try:
        row = db.execute(
            text(
                "SELECT prompt_override, prompt_override_mode "
                "FROM user_profile WHERE user_id = :user_id"
            ),
            {"user_id": user_id},
        ).first()
    except Exception:
        return "", "append"
    if not row:
        return "", "append"
    override = (row[0] or "").strip()
    mode = (row[1] or "append").strip()
    if mode not in ("append", "prepend"):
        mode = "append"
    return override, mode
