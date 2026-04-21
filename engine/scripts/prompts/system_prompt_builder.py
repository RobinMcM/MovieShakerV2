from sqlmodel import Session
from sqlalchemy import text

from models import ChatbotPromptConfig
from admin import CHATBOT_LAYOUT_SCHEMAS

MAX_SYSTEM_PROMPT_LENGTH = 20000

CONTEXT_MODE_TO_SELECTION_KEY: dict[str, str] = {
    "scripts":  "movieshaker-scripts",
    "budgets":  "movieshaker-budgets",
    "schedule": "movieshaker-schedule",
    "general":  "movieshaker-general",
}


def build_system_prompt(
    context_mode: str,
    context,
    db: Session,
    user_id: str,
) -> str:
    """
    Assemble the system prompt for the script chat endpoint.

    Order of assembly:
      # Context       ← admin prompt_information
      # Rules         ← admin prompt_rules
      # Page structure← layout fields from CHATBOT_LAYOUT_SCHEMAS
      # Script context← existing ChatContext data (scripts mode only)
      # User instructions ← user's prompt_override (append or prepend)

    Falls back to the hardcoded _build_script_chat_system_prompt when no
    admin config exists for the selection key.

    Script context is trimmed first if the total exceeds MAX_SYSTEM_PROMPT_LENGTH.
    Admin prompt and user override are never truncated.
    """
    selection_key = CONTEXT_MODE_TO_SELECTION_KEY.get(context_mode, "movieshaker-scripts")

    config = db.get(ChatbotPromptConfig, selection_key)
    has_admin_config = bool(
        config
        and (config.prompt_information or "").strip()
        and (config.prompt_rules or "").strip()
    )

    if not has_admin_config:
        # Lazy import — avoids circular dep (context_assembler → router → here → router)
        from scripts.router import _build_script_chat_system_prompt
        return _build_script_chat_system_prompt(context)

    layout_lines = _get_layout_field_lines(selection_key)
    prompt_override, override_mode = _get_user_override(db, user_id)

    # Build base parts (never truncated)
    fixed_parts: list[str] = []
    fixed_parts.append("# Context\n" + config.prompt_information.strip())
    fixed_parts.append("# Rules\n" + config.prompt_rules.strip())
    if layout_lines:
        fixed_parts.append("# Page structure\n" + "\n".join(layout_lines))

    # Script context part (truncatable)
    script_context_text = ""
    if context_mode == "scripts":
        from scripts.router import _build_script_chat_system_prompt
        script_context_text = _build_script_chat_system_prompt(context)

    def _assemble(include_script: bool) -> str:
        parts = list(fixed_parts)
        if include_script and script_context_text:
            parts.append("# Script context\n" + script_context_text)
        core = "\n\n".join(parts)
        if not prompt_override:
            return core
        override_section = "# User instructions\n" + prompt_override
        if override_mode == "prepend":
            return override_section + "\n\n" + core
        return core + "\n\n" + override_section

    assembled = _assemble(include_script=True)
    if len(assembled) > MAX_SYSTEM_PROMPT_LENGTH:
        assembled = _assemble(include_script=False)

    return assembled[:MAX_SYSTEM_PROMPT_LENGTH]


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
