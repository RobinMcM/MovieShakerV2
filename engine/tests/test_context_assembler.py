"""
Tests for get_message_history() in scripts/context_assembler.py
Run from engine dir: pytest tests/test_context_assembler.py -v
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from scripts.context_assembler import TOKEN_BUDGET, get_message_history


def _make_db(rows):
    """Return a mock db Session whose script_messages query returns rows."""
    row_objects = [MagicMock(spec=["__getitem__"]) for _ in rows]
    for mock_row, (role, content) in zip(row_objects, rows):
        mock_row.__getitem__ = lambda self, i, _r=(role, content): _r[i]
        # Support positional indexing: row[0] = role, row[1] = content
        mock_row.__iter__ = lambda self, _r=(role, content): iter(_r)

    # Use plain tuples — simpler and matches real driver behaviour
    tuple_rows = [(role, content) for role, content in rows]

    result_mock = MagicMock()
    result_mock.fetchall.return_value = tuple_rows

    db = MagicMock()
    db.execute.return_value = result_mock
    return db


# ── (c) empty chat history ────────────────────────────────────────────────────

def test_empty_history_returns_empty_list():
    db = _make_db([])
    result = get_message_history("chat-abc", db)
    assert result == []


# ── (a) history longer than TOKEN_BUDGET gets trimmed from the front ──────────

def test_long_history_trimmed_from_front():
    # Each message is 4 * TOKEN_BUDGET chars long, so two messages alone
    # would exceed the budget. We add three so trimming must happen.
    long_content = "x" * (TOKEN_BUDGET * 4)
    rows = [
        ("user", long_content),      # oldest — should be removed
        ("assistant", long_content),  # middle — should be removed
        ("user", "short final message"),  # newest — must survive
    ]
    db = _make_db(rows)
    result = get_message_history("chat-abc", db)

    # Only the most recent message should remain
    assert len(result) == 1
    assert result[-1]["content"] == "short final message"
    assert result[-1]["role"] == "user"


def test_history_under_budget_not_trimmed():
    # Three tiny messages well under TOKEN_BUDGET
    rows = [
        ("user", "hello"),
        ("assistant", "hi there"),
        ("user", "how are you?"),
    ]
    db = _make_db(rows)
    result = get_message_history("chat-abc", db)

    assert len(result) == 3
    assert result[0]["role"] == "user"
    assert result[0]["content"] == "hello"


# ── (b) most recent message is never removed ─────────────────────────────────

def test_most_recent_message_never_removed():
    # Single message that is enormous — still must be returned
    huge_content = "y" * (TOKEN_BUDGET * 100)
    rows = [("user", huge_content)]
    db = _make_db(rows)
    result = get_message_history("chat-abc", db)

    assert len(result) == 1
    assert result[0]["content"] == huge_content


def test_most_recent_preserved_when_all_others_trimmed():
    # Four large messages; only the last should survive
    big = "z" * (TOKEN_BUDGET * 4)
    rows = [
        ("user", big),
        ("assistant", big),
        ("user", big),
        ("assistant", "final assistant turn"),
    ]
    db = _make_db(rows)
    result = get_message_history("chat-abc", db)

    assert result[-1]["content"] == "final assistant turn"
    assert result[-1]["role"] == "assistant"


# ── max_turns cap ─────────────────────────────────────────────────────────────

def test_max_turns_cap_applied_before_token_guard():
    rows = [("user", f"msg {i}") for i in range(30)]
    db = _make_db(rows)
    result = get_message_history("chat-abc", db, max_turns=5)

    assert len(result) == 5
    # Should be the last 5 messages
    assert result[-1]["content"] == "msg 29"
    assert result[0]["content"] == "msg 25"
