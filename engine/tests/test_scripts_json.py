"""
Tests for script JSON round-trips using the new script_parser v2 interface.
Replaces tests that imported deleted internal functions from scripts.py.
Run from engine dir: pytest tests/test_scripts_json.py -v
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from script_parser import (
    parse_json_v1,
    document_to_bytes,
    derive_db_data,
    SCHEMA_VERSION,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_v1_json(elements, metadata=None):
    """Build a v1-style JSON payload for testing."""
    return json.dumps({
        "metadata": metadata or {"page_count": 1},
        "elements": elements,
    }).encode()


# ─── document_to_bytes ────────────────────────────────────────────────────────

def test_document_to_bytes_includes_page_count():
    doc = parse_json_v1(_make_v1_json(
        [{"type": "scene_heading", "text": "INT. HOUSE"}],
        {"page_count": 5},
    ))
    out = document_to_bytes(doc)
    parsed = json.loads(out.decode("utf-8"))
    assert parsed["metadata"]["page_count"] == 5


def test_document_to_bytes_defaults_page_count():
    doc = parse_json_v1(_make_v1_json(
        [{"type": "action", "text": "Hello"}],
        {},
    ))
    out = document_to_bytes(doc)
    parsed = json.loads(out.decode("utf-8"))
    assert parsed["metadata"]["page_count"] == 1


def test_document_to_bytes_schema_version():
    doc = parse_json_v1(_make_v1_json([{"type": "action", "text": "A"}]))
    out = document_to_bytes(doc)
    parsed = json.loads(out.decode("utf-8"))
    assert parsed["schema_version"] == SCHEMA_VERSION


# ─── derive_db_data ───────────────────────────────────────────────────────────

def test_derive_db_data_basic():
    raw = _make_v1_json([
        {"type": "scene_heading", "text": "INT. HOUSE"},
        {"type": "character", "text": "ALICE"},
        {"type": "dialogue", "text": "Hello."},
        {"type": "scene_heading", "text": "EXT. GARDEN"},
        {"type": "character", "text": "BOB"},
    ], {"page_count": 2})
    doc = parse_json_v1(raw)
    headings, unique_characters, scene_char_map, page_count = derive_db_data(
        doc["elements"], 2
    )
    assert len(headings) == 2
    assert headings[0]["heading"] == "INT. HOUSE"
    assert headings[1]["heading"] == "EXT. GARDEN"
    assert set(unique_characters) == {"ALICE", "BOB"}
    assert "ALICE" in scene_char_map.get(0, set())
    assert "BOB" in scene_char_map.get(1, set())
    assert page_count == 2


def test_derive_db_data_eighths_positive():
    raw = _make_v1_json([
        {"type": "scene_heading", "text": "INT. OFFICE"},
        {"type": "action", "text": "Desks everywhere."},
        {"type": "character", "text": "JANE"},
        {"type": "dialogue", "text": "Morning."},
    ])
    doc = parse_json_v1(raw)
    headings, _, _, _ = derive_db_data(doc["elements"], 1)
    assert headings[0]["length_in_eighths"] >= 1


def test_derive_db_data_page_number_format():
    raw = _make_v1_json([
        {"type": "scene_heading", "text": "EXT. FOREST - NIGHT"},
    ])
    doc = parse_json_v1(raw)
    headings, _, _, _ = derive_db_data(doc["elements"], 1)
    assert headings[0]["page_number"].startswith("Page ")


# ─── Full round trip ──────────────────────────────────────────────────────────

def test_full_json_round_trip():
    """v1 JSON → parse_json_v1 → document_to_bytes → re-parse → derive_db_data."""
    elements = [
        {"type": "scene_heading", "text": "INT. HOUSE"},
        {"type": "action", "text": "A room."},
        {"type": "character", "text": "ALICE"},
        {"type": "dialogue", "text": "Hello."},
    ]
    raw = _make_v1_json(elements, {"page_count": 1, "title": "Test"})
    doc = parse_json_v1(raw)
    assert doc is not None

    # Serialise and re-parse
    out = document_to_bytes(doc)
    doc2 = parse_json_v1(out)
    assert doc2 is not None
    assert doc2["schema_version"] == SCHEMA_VERSION
    assert doc2["metadata"]["title"] == "Test"

    headings, unique_characters, scene_char_map, page_count = derive_db_data(
        doc2["elements"], 1
    )
    assert len(headings) == 1
    assert headings[0]["heading"] == "INT. HOUSE"
    assert "ALICE" in unique_characters
    assert page_count == 1


def test_v2_passthrough_round_trip():
    """Already-v2 JSON passes through parse_json_v1 unchanged."""
    raw = _make_v1_json([
        {"type": "scene_heading", "text": "EXT. SPACE - NIGHT"},
        {"type": "action", "text": "Stars."},
    ], {"page_count": 2, "title": "Space Film"})
    doc = parse_json_v1(raw)
    out = document_to_bytes(doc)

    # Pass v2 through the normaliser
    doc2 = parse_json_v1(out)
    assert doc2 is not None
    assert doc2["schema_version"] == SCHEMA_VERSION
    assert doc2["metadata"]["title"] == "Space Film"


# ─── Invalid PDF handling ─────────────────────────────────────────────────────

def test_parse_invalid_pdf_bytes():
    """parse_pdf should raise ParseError for non-PDF input."""
    from script_parser import parse_pdf, ParseError
    import pytest
    with pytest.raises(ParseError):
        parse_pdf(b"not a pdf")


def test_parse_empty_bytes():
    from script_parser import parse_pdf, ParseError
    import pytest
    with pytest.raises(ParseError):
        parse_pdf(b"")


def test_parse_json_bytes_not_pdf():
    """JSON bytes are not a valid PDF — should raise ParseError."""
    from script_parser import parse_pdf, ParseError
    import pytest
    with pytest.raises(ParseError):
        parse_pdf(b'{"elements": []}')


def test_parse_minimal_blank_pdf():
    """A valid but blank PDF should raise ParseError (no text content)."""
    from script_parser import parse_pdf, ParseError
    import pytest
    try:
        from pypdf import PdfWriter
        import io
        buf = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        writer.write(buf)
        pdf_bytes = buf.getvalue()
    except Exception:
        pytest.skip("pypdf not available")
    with pytest.raises(ParseError):
        parse_pdf(pdf_bytes)


# ─── Scene heading enrichment on parse ───────────────────────────────────────

def test_scene_headings_get_int_ext():
    raw = _make_v1_json([
        {"type": "scene_heading", "text": "EXT. FOREST - DAWN"},
        {"type": "scene_heading", "text": "INT. CABIN - NIGHT"},
    ])
    doc = parse_json_v1(raw)
    scenes = [e for e in doc["elements"] if e["type"] == "scene_heading"]
    assert scenes[0]["int_ext"] == "EXT"
    assert scenes[1]["int_ext"] == "INT"


def test_scene_headings_get_time_of_day():
    raw = _make_v1_json([
        {"type": "scene_heading", "text": "INT. OFFICE - DAY"},
    ])
    doc = parse_json_v1(raw)
    scenes = [e for e in doc["elements"] if e["type"] == "scene_heading"]
    assert scenes[0]["time_of_day"] == "day"


def test_scene_headings_get_scene_number():
    raw = _make_v1_json([
        {"type": "scene_heading", "text": "INT. A"},
        {"type": "scene_heading", "text": "EXT. B"},
        {"type": "scene_heading", "text": "INT. C"},
    ])
    doc = parse_json_v1(raw)
    scenes = [e for e in doc["elements"] if e["type"] == "scene_heading"]
    assert [s["scene_number"] for s in scenes] == [1, 2, 3]


def test_total_scenes_in_metadata():
    raw = _make_v1_json([
        {"type": "scene_heading", "text": "INT. A"},
        {"type": "scene_heading", "text": "EXT. B"},
    ])
    doc = parse_json_v1(raw)
    assert doc["metadata"]["total_scenes"] == 2


def test_total_eighths_in_metadata():
    raw = _make_v1_json([
        {"type": "scene_heading", "text": "INT. A"},
        {"type": "action", "text": "Something happens."},
        {"type": "scene_heading", "text": "EXT. B"},
    ])
    doc = parse_json_v1(raw)
    assert doc["metadata"]["total_eighths"] >= 2
