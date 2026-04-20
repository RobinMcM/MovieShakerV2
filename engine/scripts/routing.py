"""
Model routing for the script chat endpoint.

gateway_client.execute_text() accepts any model string via its `model`
parameter — there is no built-in fast/full selection in the client
itself. Model identifiers come from the project's configured defaults.
"""
import logging
import re

from scripts.context_assembler import ChatContext

logger = logging.getLogger(__name__)

FAST_MODEL = "google/gemma-3-12b-it:free"
FULL_MODEL = "anthropic/claude-3.5-sonnet"

_FULL_MODEL_KEYWORDS = re.compile(
    r'\b('
    r'compare|consolidate|restructure|risk|impact|'
    r'schedule|budget|overall|analyse|analyze|recommend'
    r')\b'
    r'|what would happen|what if|how much would|what does that mean for',
    re.IGNORECASE,
)


def select_model(message: str, context: ChatContext) -> tuple[str, str]:
    """
    Returns (model_id, reason). Uses FULL_MODEL when the question
    warrants deep reasoning; FAST_MODEL for simple factual lookups.
    """
    if len(message) > 200:
        return FULL_MODEL, "message length > 200 characters"

    if _FULL_MODEL_KEYWORDS.search(message):
        match = _FULL_MODEL_KEYWORDS.search(message)
        return FULL_MODEL, f"keyword match: '{match.group(0).lower()}'"

    if context.analysis_summary:
        return FULL_MODEL, "script has been analysed — use full model by default"

    if context.production_decisions:
        return FULL_MODEL, "production decisions exist for this script"

    return FAST_MODEL, "short factual query — no complex reasoning signals detected"


def log_routing_decision(message: str, model: str, reason: str) -> None:
    logger.debug("Model routing: %s → reason: %s", model, reason)
