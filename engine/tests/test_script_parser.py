"""
engine/tests/test_script_parser.py

Tests for script_parser.py v2.
Run from engine/ directory: pytest tests/test_script_parser.py -v
"""

import json
import pytest
from script_parser import (
    parse_json_v1,
    document_to_bytes,
    derive_db_data,
    _parse_scene_heading,
    _clean_character_name,
    SCHEMA_VERSION,
)


# ─── Scene heading parser ──────────────────────────────────────────────────────

class TestParseSceneHeading:
    def test_basic_int_day(self):
        r = _parse_scene_heading("INT. CAFÉ - DAY")
        assert r["int_ext"] == "INT"
        assert r["location"] == "CAFÉ"
        assert r["sub_location"] is None
        assert r["time_of_day"] == "day"

    def test_ext_night(self):
        r = _parse_scene_heading("EXT. DEEP SPACE - NIGHT")
        assert r["int_ext"] == "EXT"
        assert r["location"] == "DEEP SPACE"
        assert r["time_of_day"] == "night"

    def test_int_ext(self):
        r = _parse_scene_heading("INT./EXT. CAR - MOVING")
        assert r["int_ext"] == "INT/EXT"
        assert r["location"] == "CAR"
        assert r["time_of_day"] == "moving"

    def test_sub_location(self):
        r = _parse_scene_heading("INT. SHIP/BRIDGE - DAY")
        assert r["location"] == "SHIP"
        assert r["sub_location"] == "BRIDGE"

    def test_no_time(self):
        r = _parse_scene_heading("EXT. SPACE")
        assert r["location"] == "SPACE"
        assert r["time_of_day"] == "unknown"

    def test_continuous(self):
        r = _parse_scene_heading("INT. CORRIDOR - CONTINUOUS")
        assert r["time_of_day"] == "continuous"

    def test_lowercase_ext(self):
        r = _parse_scene_heading("ext. forest - dawn")
        assert r["int_ext"] == "EXT"
        assert r["time_of_day"] == "dawn"


# ─── Character name cleaning ───────────────────────────────────────────────────

class TestCleanCharacterName:
    def test_strip_vo(self):
        assert _clean_character_name("TALON-7 (V.O.)") == "TALON-7"

    def test_strip_os(self):
        assert _clean_character_name("COMMANDER (O.S.)") == "COMMANDER"

    def test_strip_contd(self):
        assert _clean_character_name("ARIA (CONT'D)") == "ARIA"

    def test_plain(self):
        assert _clean_character_name("TALON-7") == "TALON-7"

    def test_empty(self):
        assert _clean_character_name("") == ""

    def test_too_long(self):
        assert _clean_character_name("A" * 70) == ""


# ─── JSON v1 normalisation ─────────────────────────────────────────────────────

SAMPLE_V1_JSON = json.dumps({
    "metadata": {
        "title": "TALON-7",
        "author": "Robin McManus",
        "created": "2025-12-31T10:20:33Z",
        "draft": "First Draft",
        "page_count": 3,
    },
    "elements": [
        {"type": "action", "text": "FADE IN:"},
        {"type": "scene_heading", "text": "EXT. DEEP SPACE - NIGHT"},
        {"type": "action", "text": "The ship glides through the void."},
        {"type": "character", "text": "TALON-7"},
        {"type": "dialogue", "text": "Engaging stealth mode."},
        {"type": "character", "text": "ARCTURUS (V.O.)"},
        {"type": "dialogue", "text": "Acknowledged."},
        {"type": "scene_heading", "text": "INT. BRIDGE - CONTINUOUS"},
        {"type": "action", "text": "The crew prepares."},
        {"type": "character", "text": "COMMANDER"},
        {"type": "parenthetical", "text": "(quietly)"},
        {"type": "dialogue", "text": "Hold position."},
    ]
}).encode()

SAMPLE_V2_JSON = json.dumps({
    "schema_version": "2.0",
    "metadata": {
        "title": "TALON-7",
        "author": "Robin McManus",
        "created": "2025-12-31T10:20:33Z",
        "draft": "First Draft",
        "page_count": 3,
        "total_eighths": 6,
        "total_scenes": 2,
        "parsed_at": "2026-01-01T00:00:00Z",
    },
    "elements": [
        {"type": "action", "text": "FADE IN:"},
        {
            "type": "scene_heading",
            "text": "EXT. DEEP SPACE - NIGHT",
            "scene_number": 1,
            "page": 1,
            "int_ext": "EXT",
            "location": "DEEP SPACE",
            "sub_location": None,
            "time_of_day": "night",
            "eighths": 3,
            "characters": ["ARCTURUS", "TALON-7"],
        },
        {"type": "action", "text": "The ship glides through the void."},
        {"type": "character", "text": "TALON-7", "scene_number": 1},
        {"type": "dialogue", "text": "Engaging stealth mode.", "scene_number": 1},
        {
            "type": "scene_heading",
            "text": "INT. BRIDGE - CONTINUOUS",
            "scene_number": 2,
            "page": 2,
            "int_ext": "INT",
            "location": "BRIDGE",
            "sub_location": None,
            "time_of_day": "continuous",
            "eighths": 3,
            "characters": ["COMMANDER"],
        },
    ]
}).encode()


class TestParseJsonV1:
    def test_upgrades_v1_to_v2(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        assert doc is not None
        assert doc["schema_version"] == SCHEMA_VERSION
        assert "metadata" in doc
        assert "elements" in doc

    def test_title_preserved(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        assert doc["metadata"]["title"] == "TALON-7"

    def test_scene_headings_enriched(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        scene_els = [e for e in doc["elements"] if e["type"] == "scene_heading"]
        assert len(scene_els) == 2
        s1 = scene_els[0]
        assert s1["int_ext"] == "EXT"
        assert s1["location"] == "DEEP SPACE"
        assert s1["time_of_day"] == "night"
        assert s1["scene_number"] == 1
        assert "eighths" in s1
        assert s1["eighths"] >= 1
        assert "characters" in s1

    def test_characters_on_scene(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        scene_els = [e for e in doc["elements"] if e["type"] == "scene_heading"]
        # Scene 1 should have TALON-7 and ARCTURUS
        chars_1 = set(scene_els[0]["characters"])
        assert "TALON-7" in chars_1
        assert "ARCTURUS" in chars_1

    def test_v2_passthrough(self):
        doc = parse_json_v1(SAMPLE_V2_JSON)
        assert doc is not None
        assert doc["schema_version"] == SCHEMA_VERSION

    def test_invalid_json_returns_none(self):
        assert parse_json_v1(b"not json") is None

    def test_missing_elements_returns_none(self):
        assert parse_json_v1(json.dumps({"metadata": {}}).encode()) is None

    def test_total_scenes_in_metadata(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        assert doc["metadata"]["total_scenes"] == 2

    def test_total_eighths_positive(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        assert doc["metadata"]["total_eighths"] >= 2


# ─── Derive DB data ────────────────────────────────────────────────────────────

class TestDeriveDbData:
    def test_headings_count(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        headings, chars, scene_char_map, page_count = derive_db_data(
            doc["elements"], doc["metadata"]["page_count"]
        )
        assert len(headings) == 2

    def test_headings_have_page_number(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        headings, _, _, _ = derive_db_data(doc["elements"], 3)
        for h in headings:
            assert "page_number" in h
            assert h["page_number"].startswith("Page ")

    def test_headings_have_eighths(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        headings, _, _, _ = derive_db_data(doc["elements"], 3)
        for h in headings:
            assert h.get("length_in_eighths", 0) >= 1

    def test_unique_characters(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        _, chars, _, _ = derive_db_data(doc["elements"], 3)
        assert "TALON-7" in chars
        assert "ARCTURUS" in chars
        assert "COMMANDER" in chars

    def test_scene_char_map(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        _, _, scene_char_map, _ = derive_db_data(doc["elements"], 3)
        # Scene 0 should have TALON-7 and ARCTURUS
        assert "TALON-7" in scene_char_map.get(0, set())
        assert "ARCTURUS" in scene_char_map.get(0, set())
        # Scene 1 should have COMMANDER
        assert "COMMANDER" in scene_char_map.get(1, set())


# ─── Serialisation ─────────────────────────────────────────────────────────────

class TestDocumentToBytes:
    def test_valid_json(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        b = document_to_bytes(doc)
        assert isinstance(b, bytes)
        reloaded = json.loads(b)
        assert reloaded["schema_version"] == SCHEMA_VERSION

    def test_unicode_preserved(self):
        doc = parse_json_v1(SAMPLE_V1_JSON)
        doc["metadata"]["title"] = "Café Noir"
        b = document_to_bytes(doc)
        reloaded = json.loads(b)
        assert reloaded["metadata"]["title"] == "Café Noir"
