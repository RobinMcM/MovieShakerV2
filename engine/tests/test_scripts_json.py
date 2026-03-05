"""
Tests for script.json as source of truth: full/reduced JSON build, derive DB from elements, PDF full parse.
Run from engine dir: pytest tests/ -v
"""
import json
import sys
from pathlib import Path

# Allow importing engine.scripts when running from engine/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import (
    _derive_db_from_elements,
    _script_json_to_bytes,
    _build_script_json,
    _parse_json_script,
    _parse_pdf_script_full,
)


def test_script_json_to_bytes_includes_page_count():
    elements = [{"type": "scene_heading", "text": "INT. HOUSE"}]
    out = _script_json_to_bytes(elements, {"page_count": 5})
    doc = json.loads(out.decode("utf-8"))
    assert doc["metadata"]["page_count"] == 5
    assert doc["elements"] == elements


def test_script_json_to_bytes_defaults_page_count():
    elements = [{"type": "action", "text": "Hello"}]
    out = _script_json_to_bytes(elements, {})
    doc = json.loads(out.decode("utf-8"))
    assert doc["metadata"]["page_count"] == 1


def test_build_script_json_reduced():
    headings = [
        {"heading": "INT. HOUSE", "page_number": "Page 1", "length_in_eighths": 1},
        {"heading": "EXT. GARDEN", "page_number": "Page 2", "length_in_eighths": 1},
    ]
    unique_characters = ["ALICE", "BOB"]
    scene_char_map = {0: {"ALICE"}, 1: {"BOB"}}
    out = _build_script_json(headings, unique_characters, scene_char_map, page_count=2)
    doc = json.loads(out.decode("utf-8"))
    assert doc["metadata"]["page_count"] == 2
    assert [e["type"] for e in doc["elements"]] == ["scene_heading", "character", "scene_heading", "character"]
    assert doc["elements"][0]["text"] == "INT. HOUSE"
    assert doc["elements"][1]["text"] == "ALICE"


def test_derive_db_from_elements():
    elements = [
        {"type": "scene_heading", "text": "INT. HOUSE"},
        {"type": "character", "text": "ALICE"},
        {"type": "dialogue", "text": "Hello."},
        {"type": "scene_heading", "text": "EXT. GARDEN"},
        {"type": "character", "text": "BOB"},
    ]
    headings, unique_characters, scene_char_map, page_count = _derive_db_from_elements(elements, 2)
    assert len(headings) == 2
    assert headings[0]["heading"] == "INT. HOUSE"
    assert headings[1]["heading"] == "EXT. GARDEN"
    assert set(unique_characters) == {"ALICE", "BOB"}
    assert scene_char_map[0] == {"ALICE"}
    assert scene_char_map[1] == {"BOB"}
    assert page_count == 2


def test_full_json_round_trip():
    """Full elements + metadata → _script_json_to_bytes → parse back via _parse_json_script."""
    elements = [
        {"type": "scene_heading", "text": "INT. HOUSE"},
        {"type": "action", "text": "A room."},
        {"type": "character", "text": "ALICE"},
        {"type": "dialogue", "text": "Hello."},
    ]
    metadata = {"page_count": 1, "title": "Test"}
    raw = _script_json_to_bytes(elements, metadata)
    headings, unique_characters, scene_char_map, page_count = _parse_json_script(raw)
    assert len(headings) == 1
    assert headings[0]["heading"] == "INT. HOUSE"
    assert "ALICE" in unique_characters
    assert page_count == 1


def test_parse_pdf_script_full_invalid_returns_none():
    """Invalid or non-PDF bytes should return None."""
    assert _parse_pdf_script_full(b"not a pdf") is None
    assert _parse_pdf_script_full(b"") is None
    assert _parse_pdf_script_full(b'{"elements": []}') is None


def test_parse_pdf_script_full_minimal_pdf():
    """Minimal 1-page PDF should yield elements or None (pdfminer may not be installed)."""
    # Build minimal PDF with pypdf (no text positions, but valid PDF)
    try:
        from pypdf import PdfWriter
        buf = __import__("io").BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        writer.write(buf)
        pdf_bytes = buf.getvalue()
    except Exception:
        pdf_bytes = b"%PDF-1.4 minimal"
    result = _parse_pdf_script_full(pdf_bytes)
    # Either we get (elements, metadata) or None (e.g. blank page → no text lines)
    if result is not None:
        elements, metadata = result
        assert isinstance(elements, list)
        assert isinstance(metadata, dict)
        assert metadata.get("page_count", 0) >= 1
        for el in elements:
            assert "type" in el and "text" in el
