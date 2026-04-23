"""
script_parser.py — MovieShaker Script Parser v2

Converts a PDF screenplay to canonical schema v2 JSON per script-rules.md.

Architecture:
  - pdfminer for layout-aware extraction (x/y coordinates per line)
  - x-coordinate zones classify element types (screenplay indentation standard)
  - Two-pass: (1) classify lines → elements, (2) derive scene metadata
  - Eighths calculated from actual y-span on page (most accurate)
  - Flat elements[] array is the source of truth
  - scene_heading elements carry all derived fields inline
  - No DB knowledge — pure PDF → dict transform

Output JSON shape:
  {
    "schema_version": "2.0",
    "metadata": { title, author, created, draft, page_count,
                  total_eighths, total_scenes, parsed_at },
    "elements": [
      { "type": "scene_heading", "text": "...", "scene_number": N,
        "page": N, "int_ext": "INT"|"EXT"|"INT/EXT",
        "location": "...", "sub_location": null|"...",
        "time_of_day": "...", "eighths": N, "characters": [...] },
      { "type": "action"|"character"|"dialogue"|..., "text": "..." },
      ...
    ]
  }

Usage:
  from script_parser import parse_pdf, ParseError

  try:
      doc = parse_pdf(pdf_bytes, script_name="My Film")
  except ParseError as e:
      # handle parse failure with message
      ...
"""

from __future__ import annotations

import io
import json
import re
from datetime import datetime, timezone
from math import ceil
from typing import Optional

__all__ = ["parse_pdf", "parse_json_v1", "document_to_bytes", "ParseError"]

# ─── Schema version ───────────────────────────────────────────────────────────
SCHEMA_VERSION = "2.0"

# ─── Screenplay x-coordinate zones (US Letter 612pt wide, Courier 12pt) ──────
#
# Standard screenwriting software (Final Draft, Movie Magic, Highland) outputs:
#
#   Left margin action/scene heading:  x0 ≈  108–140pt  (1.5")
#   Dialogue left edge:                x0 ≈  180–220pt  (2.5")
#   Parenthetical left edge:           x0 ≈  210–250pt  (2.9")
#   Character name left edge:          x0 ≈  260–290pt  (3.6")
#   Transition (right-aligned):        x0 ≥  380pt
#
# We use generous zones and fall back to context for ambiguous positions.

_ACTION_MAX_X = 165       # action or scene_heading
_DIALOGUE_MAX_X = 235     # dialogue zone
_PARENTH_MAX_X = 280      # parenthetical zone
_CHAR_MAX_X = 390         # character name zone

# ─── Compiled regexes ─────────────────────────────────────────────────────────

_SCENE_HEADING_RE = re.compile(
    r'^(INT\.|EXT\.|INT\./EXT\.|I/E|EST\.)\s', re.IGNORECASE
)
_TRANSITION_SUFFIX_RE = re.compile(r'TO:\s*$')
_TRANSITION_PREFIX_RE = re.compile(r'^(FADE\s+IN|FADE\s+OUT|FADE\s+TO)', re.IGNORECASE)
_PAGE_NUM_RE = re.compile(r'^\d{1,4}\.?$')
_MORE_RE = re.compile(r"^\(MORE\)$", re.IGNORECASE)
_CONTD_RE = re.compile(r"^(.+?)\s*\(CONT'D\)\s*$", re.IGNORECASE)
_INLINE_CONTD_RE = re.compile(r"^(.+?)\s*\(CONT'D\)\s+(.+)$", re.IGNORECASE)

# Scene heading component parser:  "INT. CAFÉ - DAY" / "EXT. SPACE/ORBIT - NIGHT"
_HEADING_RE = re.compile(
    r'^(?:INT\.|EXT\.|INT\./EXT\.|I/E|EST\.)\s+'  # INT_EXT prefix
    r'(.+?)'                                        # location (greedy, trimmed)
    r'(?:\s*[-–—]\s*(.+?))?$',                     # optional " - TIME OF DAY"
    re.IGNORECASE,
)
_INT_EXT_PREFIX_RE = re.compile(
    r'^(INT\./EXT\.|INT\.|EXT\.|I/E|EST\.)', re.IGNORECASE
)

_TIME_OF_DAY_TOKENS = frozenset([
    "day", "night", "dawn", "dusk", "morning", "afternoon",
    "evening", "later", "continuous", "moments later", "same time",
    "sunrise", "sunset", "midday", "noon", "midnight", "magic hour",
    "golden hour", "pre-dawn", "twilight",
])

# Page height (US Letter = 792pt). Content typically starts at ~72pt from top.
_PAGE_HEIGHT = 792.0
# Approximate usable content height per page
_CONTENT_HEIGHT = 684.0  # 792 - 54 top - 54 bottom
# Lines per page in Courier 12pt double-spaced screenplay: ~54
# Eighths: 1 page = 8 eighths → content_height / 8 = ~85pt per eighth
_EIGHTH_HEIGHT = _CONTENT_HEIGHT / 8.0  # ≈ 85.5pt


class ParseError(Exception):
    """Raised when a PDF cannot be parsed as a screenplay."""


# ─── Scene heading decomposition ──────────────────────────────────────────────

def _parse_scene_heading(text: str) -> dict:
    """
    Decompose a scene heading into int_ext, location, sub_location, time_of_day.

    "INT. CAFÉ - DAY"           → INT,  "CAFÉ",       None,    "day"
    "EXT. FOREST/CLEARING - NIGHT" → EXT, "FOREST",  "CLEARING", "night"
    "INT./EXT. CAR - MOVING"    → INT/EXT, "CAR",     None,    "moving"
    "EXT. SPACE"                → EXT,  "SPACE",      None,    "unknown"
    """
    # int_ext
    m_prefix = _INT_EXT_PREFIX_RE.match(text)
    raw = (m_prefix.group(1) if m_prefix else "").upper().rstrip(".")
    if "INT" in raw and "EXT" in raw:
        int_ext = "INT/EXT"
    elif "EXT" in raw or raw in ("I/E",):
        int_ext = "EXT"
    elif "INT" in raw:
        int_ext = "INT"
    else:
        int_ext = "INT"  # fallback

    # location + time_of_day
    m = _HEADING_RE.match(text)
    if m:
        location_raw = (m.group(1) or "").strip()
        time_raw = (m.group(2) or "").strip().lower()
    else:
        # Fallback: strip prefix
        location_raw = _INT_EXT_PREFIX_RE.sub("", text).strip().lstrip(".").strip()
        time_raw = ""

    # sub_location: split on "/" (common: "LOCATION/ROOM")
    loc_parts = location_raw.split("/", 1)
    location = loc_parts[0].strip()
    sub_location: Optional[str] = loc_parts[1].strip() if len(loc_parts) > 1 else None

    # time_of_day
    time_of_day = "unknown"
    if time_raw:
        for tok in _TIME_OF_DAY_TOKENS:
            if tok in time_raw:
                time_of_day = tok
                break
        if time_of_day == "unknown":
            # Use whatever's there (e.g. "MOVING", "LATER", "CONTINUOUS")
            time_of_day = time_raw

    return {
        "int_ext": int_ext,
        "location": location,
        "sub_location": sub_location,
        "time_of_day": time_of_day,
    }


# ─── Element type classifier ───────────────────────────────────────────────────

def _classify(
    x0: float,
    text: str,
    prev_type: Optional[str],
) -> str:
    """
    Classify a line as a screenplay element type.

    Priority order:
    1. Content-based rules (reliable, position-independent)
    2. Position-based rules (fallback, x-coordinate zones)
    3. Context rules (use previous element type for disambiguation)
    """
    t = text.strip()
    if not t:
        return "_empty"

    is_upper = t == t.upper() and bool(re.search(r"[A-Z]", t))
    is_paren = t.startswith("(") and t.endswith(")")

    # ── (MORE) → discard ──
    if _MORE_RE.match(t):
        return "_more"

    # ── Page numbers: purely numeric at right edge ──
    if _PAGE_NUM_RE.match(t) and x0 > 400:
        return "page_number"

    # ── Scene headings: content wins, ignore position ──
    if _SCENE_HEADING_RE.match(t):
        return "scene_heading"

    # ── Transitions: content wins ──
    if _TRANSITION_SUFFIX_RE.search(t) or _TRANSITION_PREFIX_RE.match(t):
        return "transition"

    # ── Parenthetical: starts and ends with () ──
    if is_paren:
        return "parenthetical"

    # ── CONT'D character continuation ──
    if is_upper and _CONTD_RE.match(t):
        return "character"

    # ── x-coordinate zone classification ──

    if x0 < _ACTION_MAX_X:
        # Left-aligned: action
        return "action"

    if _ACTION_MAX_X <= x0 < _DIALOGUE_MAX_X:
        # Short ALL-CAPS line in dialogue zone = character cue
        # (PDF indentation varies by authoring tool)
        if is_upper and len(t) < 50 and not is_paren:
            return "character"
        if prev_type in ("character", "parenthetical", "dialogue"):
            return "dialogue"
        return "dialogue"

    if _DIALOGUE_MAX_X <= x0 < _PARENTH_MAX_X:
        if is_paren:
            return "parenthetical"
        # Short ALL-CAPS = character cue regardless of previous type
        if is_upper and len(t) < 50 and not is_paren:
            return "character"
        if prev_type in ("character", "parenthetical", "dialogue"):
            return "dialogue"
        return "dialogue"

    if _PARENTH_MAX_X <= x0 < _CHAR_MAX_X:
        # Character name zone
        if is_upper:
            return "character"
        if prev_type in ("character", "parenthetical", "dialogue"):
            return "dialogue"
        return "action"

    if x0 >= _CHAR_MAX_X:
        # Far right: transition or right-aligned action
        if is_upper:
            return "transition"
        return "action"

    return "action"


# ─── Title page metadata extractor ────────────────────────────────────────────

def _extract_title_metadata(
    page1_lines: list[tuple[float, float, str]],
    script_name: str,
    now_iso: str,
) -> dict:
    """
    Extract title/author/draft from page 1 (title page only).
    page1_lines: list of (x_left, y_center, text) sorted by y descending.
    """
    metadata = {
        "title": script_name or "Untitled",
        "author": "Unknown",
        "created": now_iso,
        "draft": "MovieShaker (Imported)",
    }

    found_by = False
    for x, _y, text in sorted(page1_lines, key=lambda t: -t[1]):
        t = text.strip()
        if not t or _PAGE_NUM_RE.match(t):
            continue

        # "Written by" / "Screenplay by" / "By" → next centered line is author
        if re.match(r'^(written\s+by|screenplay\s+by|story\s+by|by)\s*:?$', t, re.I):
            found_by = True
            continue

        if found_by and metadata["author"] == "Unknown":
            # Accept any non-trivial centered text as author
            if 50 < x < 500 and len(t) > 1:
                metadata["author"] = t
                found_by = False
                continue
            found_by = False

        # Title: typically centered, upper portion of page, not a byline
        if (
            metadata["title"] == (script_name or "Untitled")
            and 50 < x < 500
            and len(t) > 1
        ):
            metadata["title"] = t

        # Draft label
        if re.match(
            r'^(first|second|third|revised|production|final|shooting|polish)\s+draft\.?$',
            t,
            re.I,
        ):
            metadata["draft"] = t.title()

    return metadata


# ─── Main PDF parser ───────────────────────────────────────────────────────────

def parse_pdf(body: bytes, script_name: str = "") -> dict:
    """
    Parse a PDF screenplay to schema v2 JSON document.

    Returns dict with keys: schema_version, metadata, elements.
    Raises ParseError if pdfminer is unavailable or PDF cannot be read.
    """
    try:
        from pdfminer.converter import PDFPageAggregator
        from pdfminer.layout import LAParams, LTTextBox, LTTextLine
        from pdfminer.pdfpage import PDFPage
        from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
    except ImportError as exc:
        raise ParseError("pdfminer is required for PDF parsing") from exc

    now_iso = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # ── Step 1: extract all positioned lines ──────────────────────────────────
    # raw_lines: list of (page_num, x0, y_center, y_bottom, text)
    # We track y_bottom for eighths calculation.

    try:
        rsrc = PDFResourceManager()
        laparams = LAParams(line_margin=0.3, char_margin=2.0)
        device = PDFPageAggregator(rsrc, laparams=laparams)
        interpreter = PDFPageInterpreter(rsrc, device)

        raw_lines: list[tuple[int, float, float, float, str]] = []

        for page_num, page in enumerate(PDFPage.get_pages(io.BytesIO(body)), 1):
            interpreter.process_page(page)
            layout = device.get_result()
            for obj in layout:
                if isinstance(obj, LTTextBox):
                    for line in obj:
                        if isinstance(line, LTTextLine):
                            text = (line.get_text() or "").strip()
                            if not text:
                                continue
                            x0, y0, _x1, y1 = line.bbox
                            y_center = (y0 + y1) / 2
                            raw_lines.append((page_num, x0, y_center, y0, text))
    except Exception as exc:
        raise ParseError(f"Failed to read PDF: {exc}") from exc

    if not raw_lines:
        raise ParseError("No text content found in PDF")

    page_count = max(t[0] for t in raw_lines)

    # ── Step 2: title page metadata (page 1 only) ─────────────────────────────

    page1_lines = [(x, y, t) for p, x, y, _yb, t in raw_lines if p == 1]
    metadata = _extract_title_metadata(page1_lines, script_name, now_iso)
    metadata["page_count"] = page_count
    metadata["parsed_at"] = now_iso

    # ── Step 3: sort body lines (page 2+) top-to-bottom ──────────────────────

    body_lines = [(p, x, y, yb, t) for p, x, y, yb, t in raw_lines if p >= 2]
    if not body_lines:
        metadata["total_eighths"] = 0
        metadata["total_scenes"] = 0
        return _build_doc(metadata, [])

    # Sort: page ascending, y descending (top of page = highest y in pdfminer)
    body_lines.sort(key=lambda r: (r[0], -r[2]))

    # ── Step 4: merge lines that are same-paragraph (very close y, same page) ─

    LINE_MERGE_TOLERANCE = 4  # pt — same visual line
    merged: list[tuple[int, float, float, str]] = []  # (page, x0_min, y_bottom_min, text)

    for page_num, x0, _yc, yb, text in body_lines:
        if (
            merged
            and merged[-1][0] == page_num
            and abs(merged[-1][2] - yb) <= LINE_MERGE_TOLERANCE
        ):
            # Same visual line — merge and keep leftmost x0
            prev_p, prev_x, prev_yb, prev_text = merged[-1]
            merged[-1] = (prev_p, min(prev_x, x0), min(prev_yb, yb), prev_text + " " + text)
        else:
            merged.append((page_num, x0, yb, text))

    # ── Step 5: classify merged lines into elements ───────────────────────────

    BLOCK_MERGE_Y_TOLERANCE = 22  # pt — same paragraph/block on same page

    elements: list[dict] = []
    last_el: Optional[dict] = None
    last_yb: float = -1e9
    last_page: int = -1
    prev_type: Optional[str] = None
    scene_num = 0

    # Track y_bottom of first line per scene for eighths calculation
    scene_page_yb: list[tuple[int, float]] = []  # (page_num, y_bottom) per scene

    for page_num, x0, yb, text in merged:
        t = text.strip()
        if not t:
            continue

        el_type = _classify(x0, t, prev_type)

        # Discard noise
        if el_type in ("_empty", "_more"):
            continue

        # ── (CONT'D) inline: "NAME (CONT'D) dialogue text" → split ──
        inline_m = _INLINE_CONTD_RE.match(t)
        if inline_m and el_type == "dialogue":
            # Emit character cue then dialogue
            char_text = inline_m.group(1).strip() + " (CONT'D)"
            dial_text = inline_m.group(2).strip()
            el_char = {"type": "character", "text": char_text}
            el_dial = {"type": "dialogue", "text": dial_text}
            elements.append(el_char)
            elements.append(el_dial)
            last_el = el_dial
            last_yb = yb
            last_page = page_num
            prev_type = "dialogue"
            continue

        # ── Block merging per script-rules.md ──
        # Merge consecutive same-type blocks within BLOCK_MERGE_Y_TOLERANCE
        # EXCEPT: never merge scene_headings; never merge across parenthetical.
        can_merge = (
            last_el is not None
            and last_page == page_num
            and last_el.get("type") == el_type
            and el_type not in ("scene_heading", "parenthetical", "page_number",
                                "transition", "_more", "_empty")
            and (last_el.get("type") != "parenthetical")
            and abs(last_yb - yb) <= BLOCK_MERGE_Y_TOLERANCE
        )

        if can_merge and last_el is not None:
            last_el["text"] = last_el["text"] + " " + t
            last_yb = yb
            continue

        # ── New element ──
        if el_type == "scene_heading":
            scene_num += 1
            components = _parse_scene_heading(t)
            el: dict = {
                "type": "scene_heading",
                "text": t,
                "scene_number": scene_num,
                "page": page_num,
                **components,
                "eighths": 1,       # placeholder; filled in pass 2
                "characters": [],   # filled in pass 2
            }
            scene_page_yb.append((page_num, yb))
        else:
            el = {"type": el_type, "text": t}
            # Back-reference to scene for character/dialogue (useful for filtering)
            if el_type in ("character", "dialogue") and scene_num > 0:
                el["scene_number"] = scene_num

        elements.append(el)
        last_el = el
        last_yb = yb
        last_page = page_num
        prev_type = el_type

    # ── Step 6: second pass — derive scene metadata ───────────────────────────
    # For each scene: collect characters, calculate eighths

    total_eighths = 0
    scene_indices: list[int] = [i for i, e in enumerate(elements) if e.get("type") == "scene_heading"]

    for scene_idx_pos, elem_idx in enumerate(scene_indices):
        scene_el = elements[elem_idx]
        scene_no = scene_el["scene_number"]
        scene_page = scene_el["page"]

        # Range of elements belonging to this scene
        next_scene_elem_idx = scene_indices[scene_idx_pos + 1] if scene_idx_pos + 1 < len(scene_indices) else len(elements)
        scene_elements = elements[elem_idx + 1: next_scene_elem_idx]

        # Characters in this scene (unique names, cleaned)
        chars: list[str] = []
        seen_chars: set[str] = set()
        for el in scene_elements:
            if el.get("type") == "character":
                name = _clean_character_name(el["text"])
                if name and name not in seen_chars:
                    seen_chars.add(name)
                    chars.append(name)
        scene_el["characters"] = chars

        # Eighths: estimate from element count if y-spans unavailable
        # Heuristic: each element ≈ 1.5 visual lines; 7 lines ≈ 1 eighth
        line_estimate = len(scene_elements) * 1.5
        eighths = max(1, ceil(line_estimate / 7))

        # Better: use page coverage if we know next scene page
        # (simple heuristic: if scene spans multiple pages, add 8 eighths per extra page)
        if scene_idx_pos + 1 < len(scene_indices):
            next_page = elements[scene_indices[scene_idx_pos + 1]]["page"]
            pages_spanned = next_page - scene_page
            if pages_spanned >= 1:
                eighths = max(eighths, pages_spanned * 8)

        scene_el["eighths"] = eighths
        total_eighths += eighths

    # ── Step 7: assemble final document ───────────────────────────────────────

    metadata["total_eighths"] = total_eighths
    metadata["total_scenes"] = scene_num

    return _build_doc(metadata, elements)


def _clean_character_name(text: str) -> str:
    """Clean a character cue text to a canonical name."""
    # Remove (V.O.), (O.S.), (O.C.), (CONT'D), (PRE-LAP) etc.
    name = re.sub(r'\s*\([^)]*\)', '', text).strip()
    name = re.sub(r'[(),!?:;]', '', name).strip().rstrip(". ")
    return name if 0 < len(name) < 60 else ""


def _build_doc(metadata: dict, elements: list[dict]) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "metadata": metadata,
        "elements": elements,
    }


# ─── JSON v1 compatibility shim ───────────────────────────────────────────────

def parse_json_v1(body: bytes) -> Optional[dict]:
    """
    Accept an existing script.json (any version) and normalise to v2 format.
    If already v2, return as-is. If v1, upgrade.
    Returns None if body is not valid JSON or missing required fields.
    """
    try:
        data = json.loads(body.decode("utf-8", errors="replace"))
    except Exception:
        return None

    if not isinstance(data, dict):
        return None

    # Already v2
    if data.get("schema_version") == SCHEMA_VERSION:
        return data

    # v1: has elements[] and metadata{} but no schema_version or rich fields
    elements = data.get("elements")
    if not isinstance(elements, list):
        return None

    metadata = dict(data.get("metadata") or {})
    metadata.setdefault("title", "Untitled")
    metadata.setdefault("author", "Unknown")
    metadata.setdefault("created", datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    metadata.setdefault("draft", "MovieShaker (Imported)")
    metadata.setdefault("page_count", metadata.get("page_count", 1))
    metadata.setdefault("parsed_at", datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))

    # Normalise elements and enrich scene_headings
    normalised: list[dict] = []
    scene_num = 0
    current_chars: set[str] = set()
    scene_el: Optional[dict] = None
    total_eighths = 0
    scene_element_count = 0

    def _flush_scene():
        nonlocal total_eighths
        if scene_el is not None:
            chars = sorted(current_chars)
            scene_el["characters"] = chars
            eighths = max(1, ceil(scene_element_count * 1.5 / 7))
            scene_el["eighths"] = eighths
            total_eighths += eighths

    for el in elements:
        if not isinstance(el, dict):
            continue
        el_type = (el.get("type") or "action").strip().lower()
        el_text = (el.get("text") or "").strip()
        if not el_text:
            continue

        if el_type == "scene_heading":
            _flush_scene()
            current_chars = set()
            scene_element_count = 0
            scene_num += 1
            components = _parse_scene_heading(el_text)
            new_el: dict = {
                "type": "scene_heading",
                "text": el_text,
                "scene_number": el.get("scene_number", scene_num),
                "page": el.get("page", scene_num),
                **components,
                "eighths": 1,
                "characters": [],
            }
            normalised.append(new_el)
            scene_el = new_el
        else:
            new_el = {"type": el_type, "text": el_text}
            if el_type in ("character", "dialogue") and scene_num > 0:
                new_el["scene_number"] = scene_num
            if el_type == "character":
                name = _clean_character_name(el_text)
                if name:
                    current_chars.add(name)
            normalised.append(new_el)
            scene_element_count += 1

    _flush_scene()

    metadata["total_scenes"] = scene_num
    metadata["total_eighths"] = total_eighths

    return _build_doc(metadata, normalised)


# ─── Derive DB data from elements ─────────────────────────────────────────────

def derive_db_data(elements: list[dict], page_count: int) -> tuple[list[dict], list[str], dict, int]:
    """
    Derive (headings, unique_characters, scene_char_map, page_count) from v2 elements.
    headings: list of { heading, page_number, length_in_eighths, scene_number }
    unique_characters: sorted list of character names
    scene_char_map: { scene_index: set(character_names) }
    Compatible with scripts.py DB insert logic.
    """
    headings: list[dict] = []
    character_set: set[str] = set()
    scene_char_map: dict = {}
    scene_number_map: dict = {}  # scene_number → headings index

    for el in elements:
        el_type = (el.get("type") or "").strip().lower()
        text = (el.get("text") or "").strip()

        if el_type == "scene_heading":
            idx = len(headings)
            _chars = [c for c in (el.get("characters") or []) if c]
            headings.append({
                "heading": text[:255],
                "page_number": f"Page {el.get('page', idx + 1)}",
                "length_in_eighths": el.get("eighths", 1),
                "scene_number": el.get("scene_number", idx + 1),
                "scene_location": el.get("location") or "",
                "location_type": el.get("int_ext") or "",
                "location_details": el.get("sub_location") or "",
                "characters_json": json.dumps([
                    {"name": c, "character_type": "supporting", "scene_function": ""}
                    for c in _chars
                ]),
            })
            scene_char_map[idx] = set()
            scene_number_map[el.get("scene_number", idx + 1)] = idx

            # Use pre-computed characters field if present
            for cname in el.get("characters") or []:
                if cname:
                    character_set.add(cname)
                    scene_char_map[idx].add(cname)

        elif el_type == "character":
            name = _clean_character_name(text)
            if name and headings:
                # Find scene index from scene_number back-reference
                sn = el.get("scene_number")
                idx = scene_number_map.get(sn, len(headings) - 1)
                character_set.add(name)
                scene_char_map.setdefault(idx, set()).add(name)

    return headings, sorted(character_set), scene_char_map, page_count


# ─── Serialisation ────────────────────────────────────────────────────────────

def document_to_bytes(doc: dict) -> bytes:
    """Serialise a script document to UTF-8 JSON bytes."""
    return json.dumps(doc, indent=2, ensure_ascii=False).encode("utf-8")
