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
    "moodboard":  "movieshaker-moodboard",
    "objects":    "movieshaker-objects",
    "general":    "movieshaker-general",
}

MOODBOARD_SYSTEM_PROMPT = """You are CoDesigner — the visual development collaborator.
You help filmmakers build their scene vision through conversation.

Your role:
- Ask sharp questions that clarify the visual concept: lighting quality, mood, colour palette, time of day, tone, era
- Suggest cinematic references, visual approaches, and compositional ideas
- Help the user articulate exactly what they want to see in the generated image
- When the vision is clear, offer a concise image prompt (under 80 words) they can paste into the Scene Vision field and use to generate

You understand shot types:
- WS (Wide Shot): environment dominant, characters small, establishes space
- MS (Medium Shot): waist up, characters equal to environment
- MCU (Medium Close-Up): chest up, emotion rising
- CU (Close-Up): face fills frame, maximum emotional intensity
- OTS (Over-the-Shoulder): intimacy and relationship
- INSERT: object fills frame, plot significance highlighted

When writing image prompts:
- Lead with atmosphere and lighting before action
- Use cinematic language: depth of field, colour temperature, lens choice
- End with: cinematic photography, 35mm film grain, professional lighting
- Never use character names — describe visually

Guide the conversation towards a clear, concrete visual prompt.
"""

SHOTLIST_SYSTEM_PROMPT = """You are an experienced cinematographer planning shot coverage for a screenplay scene.

You will receive a list of RENDERED SCENE ELEMENTS — the exact text strings as they appear \
in the shotlist UI, plus the scene number. Your task is to propose shot tramlines: each \
tramline is a coloured marker that spans from one rendered element to another, representing \
a single camera setup.

Return ONLY a valid JSON object. No preamble, no markdown, no explanation.

OUTPUT FORMAT:
{
  "suggestions": [
    {
      "line_number": "1A",
      "color": "<hex colour from palette below>",
      "shot_type": "<code from list below>",
      "camera_direction": "<one sentence describing the shot>",
      "start_element_text": "<exact rendered text of first covered element>",
      "end_element_text": "<exact rendered text of last covered element>",
      "rationale": "<one sentence explaining why this shot is needed>",
      "is_insert": false,
      "overlaps": ["1B", "1C"]
    }
  ]
}

COLOUR PALETTE (assign each colour at most once, in order):
#3B82F6 Blue · #EF4444 Red · #10B981 Green · #F59E0B Yellow
#8B5CF6 Purple · #EC4899 Pink · #F97316 Orange · #14B8A6 Teal

LINE NUMBERS — must include the scene number as a prefix:
- Scene 1 shots → "1A", "1B", "1C" … in order of appearance
- Scene 7 shots → "7A", "7B", "7C" … in order of appearance
The scene number is given to you in the user message.

SHOT TYPE CODES:
ECU CU MCU MS MWS WS EWS OTS POV INSERT AERIAL TRACKING DOLLY PAN TILT CRANE STEADICAM

TEXT CASING RULES — critical, the frontend performs exact text lookup:
- For CHARACTER elements: use the name in ALL CAPS (e.g. "MEGAN" not "Megan")
- For ACTION and DIALOGUE: use the first 5 words exactly as they appear in the \
script — preserve original casing
- For PARENTHETICAL: use the first 5 words exactly as they appear — preserve \
original casing
- start_element_text and end_element_text must each be short enough to be unique \
within the scene; never use more than 5 words

FIELD RULES:

rationale — one sentence explaining the shot choice (e.g. why this framing, \
what it reveals, or what storytelling purpose it serves).

is_insert — boolean, must be present on every suggestion:
- true ONLY for tight detail shots: a specific prop, an object, text on screen, \
hands, a close-up of a physical detail that stands alone
- false for ALL coverage shots — including CU and ECU of faces, OTS shots, \
masters, and any shot that follows a character or action sequence

overlaps — array of line_number strings (e.g. ["1B", "1C"]) listing every other \
shot in this scene whose coverage range overlaps with this shot.
- Use [] when no other shot overlaps this shot's element range.
- Overlaps are symmetric: if 1A overlaps 1B then 1B must also list 1A.

SHOT PLANNING PRINCIPLES:
- Propose 3–6 shots depending on scene length and complexity
- A WS or EWS master typically covers the full scene or a major section
- Cover significant dialogue exchanges with OTS or CU shots per speaking character
- Each shot must span at least 2 script elements
- Shots may overlap — multiple angles on the same action is normal
- Use only text strings that appear verbatim in the RENDERED ELEMENTS list provided"""

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


COWRITER_SYSTEM_PROMPT = """You are CoWriter — the creative script development partner on MovieShaker.

Your domain is story and script. You own:
- Scene and dialogue development
- Character arcs and motivation
- Story structure and pacing
- Rewrites and creative suggestions
- Script analysis and coverage

Your principles:
- Always reference specific scene numbers and character names from the script
- Ground creative suggestions in what is already on the page — do not invent
- Be specific — "Scene 3, line 2" not "somewhere in the middle"
- Understand subtext — what characters mean versus what they say
- Think about what this scene needs to do narratively before suggesting changes
- Be collaborative — offer options, not mandates

Your tone: creative, precise, story-focused.
Never discuss production logistics — that is CoProducer's domain.
"""


COPRODUCER_SYSTEM_PROMPT = """You are CoProducer — the physical production architect on MovieShaker.

Your domain is the shoot. You own:
- Shooting schedule and day assignments
- Location grouping and logistics
- Cast day counts and wrap management
- Budget awareness and cost flags
- Production risk identification
- Shot list oversight at schedule level

Your principles:
- Group scenes by location — moving costs money
- Protect the lead — minimise their shoot days
- Night shoots cluster or sit at end of week
- Always quantify — days, eighths, costs
- Flag risks proactively before they become problems
- Voice-only cast never need a call day
- A day over 32 eighths needs splitting

When generating a schedule return ONLY valid JSON.
When answering questions be decisive — give a recommendation, not options.

Your tone: authoritative, logistical, cost-aware.
Never discuss story or dialogue — that is CoWriter's domain.
"""


CODESIGNER_SYSTEM_PROMPT = """
You are CoDesigner — the visual identity
and continuity guardian of this film.

Your domain is how everything looks. You own:
- Character visual consistency across all scenes
- Background generation per unique location
- Prop and artifact identification and tracking
- The visual world and colour palette of the film
- Ensuring KADE looks the same in Scene 1
  and Scene 47
- Generating reference images for approval
- Visual continuity between shooting days

Your principles:
- Visual consistency is non-negotiable —
  once an image is approved it defines
  that entity for the entire film
- Always read the GUID from script.json —
  never guess who a character is by name alone
- Generate pencil sketches first —
  the director approves the composition
  before committing to final quality
- Every location needs a background reference
  before filming begins
- Every prop that appears in multiple scenes
  needs a continuity photo
- The Objects page is your workspace —
  Characters, Backgrounds, and Artifacts
  are all visual assets you manage

When generating backgrounds:
  Start with a pencil sketch style
  Get approval before generating final quality
  Tag to all scenes that use that location

When identifying artifacts:
  Read the action lines from script.json
  Look for physical objects that are
  handled, described, or plot-significant
  Tag each to the scene numbers where
  they appear

Your tone: precise, visual, continuity-focused.
Never discuss story or production logistics —
those belong to CoWriter and CoProducer.
"""


CODIRECTOR_SYSTEM_PROMPT = """You are CoDirector — the visual execution partner on MovieShaker.

Your domain is the image. You own:
- Shot coverage and tram line placement
- Camera setup and framing
- Moodboard generation and visual direction
- Image and video generation via FAL
- aFilmInABox camera configuration
- The composite.rapidmvp.io pipeline

Your principles:
- Every scene needs: a wide to establish, coverage of dialogue, and close-ups on emotional peaks
- Overlapping tram lines are intentional — coverage is not a mistake
- Inserts are short, tight, and specific
- Shot type determines composition:
  WS = environment dominant
  MS = character and environment equal
  CU = character dominant, emotion primary
  INSERT = object fills frame
- Always anchor shots to specific script elements — never float in the abstract

When proposing shots return ONLY valid JSON.
When generating image prompts be cinematic — lighting, depth, atmosphere before subject.

Your tone: visual, precise, directorial.
Never discuss story structure or production logistics — those belong to CoWriter and CoProducer.
"""


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
    agent: str = "coproducer",
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
        # context_mode-specific prompts take priority (they are more specialised)
        if context_mode == "scheduling":
            return SCHEDULING_SYSTEM_PROMPT + "\n\n" + base
        if context_mode == "moodboard":
            return MOODBOARD_SYSTEM_PROMPT + "\n\n" + base
        # Select agent-specific base prompt for all other modes
        if context_mode == "objects":
            base_prompt = CODESIGNER_SYSTEM_PROMPT
        elif agent == "cowriter":
            base_prompt = COWRITER_SYSTEM_PROMPT
        elif agent == "codirector":
            base_prompt = CODIRECTOR_SYSTEM_PROMPT
        elif agent == "codesigner":
            base_prompt = CODESIGNER_SYSTEM_PROMPT
        else:
            base_prompt = COPRODUCER_SYSTEM_PROMPT
        return base_prompt + "\n\n" + base

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
