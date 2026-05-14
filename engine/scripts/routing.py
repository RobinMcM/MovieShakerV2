"""
Model routing for the script chat endpoint.

select_model() always returns user_model — the user's profile model is the
source of truth. Routing signals are preserved for future multi-tier selection.
"""
import logging
import re

from scripts.context_assembler import ChatContext

logger = logging.getLogger(__name__)

_FULL_MODEL_KEYWORDS = re.compile(
    r'\b('
    r'compare|consolidate|restructure|risk|impact|'
    r'schedule|budget|overall|analyse|analyze|recommend'
    r')\b'
    r'|what would happen|what if|how much would|what does that mean for',
    re.IGNORECASE,
)


def select_model(message: str, context: ChatContext, user_model: str) -> tuple[str, str]:
    """
    Returns (model_id, reason). Always returns user_model for now.
    Routing signal detection is preserved for future multi-tier selection.
    """
    if len(message) > 200:
        return user_model, "message length > 200 characters"

    if _FULL_MODEL_KEYWORDS.search(message):
        match = _FULL_MODEL_KEYWORDS.search(message)
        return user_model, f"keyword match: '{match.group(0).lower()}'"

    if context.analysis_summary:
        return user_model, "script has been analysed — use full model by default"

    if context.production_decisions:
        return user_model, "production decisions exist for this script"

    return user_model, "short factual query — no complex reasoning signals detected"


def log_routing_decision(message: str, model: str, reason: str) -> None:
    logger.debug("Model routing: %s → reason: %s", model, reason)
