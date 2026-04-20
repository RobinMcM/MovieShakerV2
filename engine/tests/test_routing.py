"""
Tests for select_model() in scripts/routing.py
Run from engine dir: pytest tests/test_routing.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.context_assembler import ChatContext
from scripts.routing import FAST_MODEL, FULL_MODEL, select_model


def _empty_context(**overrides) -> ChatContext:
    defaults = dict(
        script_id="test-script",
        title="Test",
        page_count=10,
        scene_index=[],
        analysis_summary={},
        production_decisions=[],
    )
    defaults.update(overrides)
    return ChatContext(**defaults)


# ── (a) short simple message → FAST_MODEL ────────────────────────────────────

def test_short_simple_message_routes_fast():
    ctx = _empty_context()
    model, reason = select_model("What happens in scene 3?", ctx)
    assert model == FAST_MODEL


def test_short_message_no_keywords_routes_fast():
    ctx = _empty_context()
    model, _ = select_model("Who is in scene 7?", ctx)
    assert model == FAST_MODEL


# ── (b) message containing "budget" → FULL_MODEL ─────────────────────────────

def test_budget_keyword_routes_full():
    ctx = _empty_context()
    model, reason = select_model("What is the budget for this scene?", ctx)
    assert model == FULL_MODEL
    assert "budget" in reason.lower()


def test_budget_keyword_case_insensitive():
    ctx = _empty_context()
    model, _ = select_model("BUDGET breakdown please", ctx)
    assert model == FULL_MODEL


# ── (c) message containing "what if" → FULL_MODEL ────────────────────────────

def test_what_if_routes_full():
    ctx = _empty_context()
    model, reason = select_model("What if we moved the night shoot to day?", ctx)
    assert model == FULL_MODEL
    assert "what if" in reason.lower()


def test_what_would_happen_routes_full():
    ctx = _empty_context()
    model, _ = select_model("What would happen if we cut scene 4?", ctx)
    assert model == FULL_MODEL


# ── (d) long message > 200 chars → FULL_MODEL ────────────────────────────────

def test_long_message_routes_full():
    long_msg = "a" * 201
    ctx = _empty_context()
    model, reason = select_model(long_msg, ctx)
    assert model == FULL_MODEL
    assert "200" in reason


def test_message_exactly_200_chars_routes_fast():
    msg = "a" * 200
    ctx = _empty_context()
    model, _ = select_model(msg, ctx)
    assert model == FAST_MODEL


# ── (e) non-empty analysis_summary → FULL_MODEL ──────────────────────────────

def test_non_empty_analysis_summary_routes_full():
    ctx = _empty_context(analysis_summary={"act_structure": {"acts": []}})
    model, reason = select_model("Tell me about scene 2", ctx)
    assert model == FULL_MODEL
    assert "analysed" in reason.lower()


def test_empty_analysis_summary_does_not_trigger_full():
    ctx = _empty_context(analysis_summary={})
    model, _ = select_model("Tell me about scene 2", ctx)
    assert model == FAST_MODEL


# ── production decisions trigger full model ───────────────────────────────────

def test_production_decisions_present_routes_full():
    ctx = _empty_context(production_decisions=[{"decision_type": "location", "summary": "Use studio A"}])
    model, reason = select_model("What did we decide?", ctx)
    assert model == FULL_MODEL
    assert "production decisions" in reason.lower()


# ── other keywords ────────────────────────────────────────────────────────────

def test_risk_keyword_routes_full():
    ctx = _empty_context()
    model, _ = select_model("What is the risk of shooting exteriors in winter?", ctx)
    assert model == FULL_MODEL


def test_schedule_keyword_routes_full():
    ctx = _empty_context()
    model, _ = select_model("Can we adjust the schedule?", ctx)
    assert model == FULL_MODEL


def test_recommend_keyword_routes_full():
    ctx = _empty_context()
    model, _ = select_model("What would you recommend for casting?", ctx)
    assert model == FULL_MODEL
