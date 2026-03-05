# Script reading rules

This document defines how a film script is structured and how it maps to the **script.json** source of truth. It applies to PDF-to-JSON parsing, JSON validation, and any feature that reads script.json (ScriptViewer, ShotList, etc.).

**Principle:** The PDF is converted once to JSON; after that only the JSON is used. The PDF is for archive only.

---

## 1. Purpose and scope

- Defines how a screenplay is read and represented as canonical JSON.
- Applies to: PDF-to-JSON parsing, JSON validation, and any consumer of script.json.
- PDF is converted once to JSON; after that only the JSON is used (PDF is archive only).

---

## 2. Title page (page 1)

**Page 1 is the title page.** It is used only to populate **metadata**. No body elements (scene headings, action, dialogue, etc.) are taken from it.

| Field     | Source                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------- |
| `title`   | Main script title (typically centered, upper/middle area of page).                                       |
| `author`  | Writer name, often under "Written by" / "Screenplay by" / "By" (centered).                               |
| `created` | Script or draft date if present (e.g. bottom of title page); otherwise use import/parse time (ISO 8601). |
| `draft`   | Draft label if present (e.g. "First Draft", "Revised"); otherwise e.g. "MovieShaker (Imported)".         |

Script **body** (all `elements`) starts from **page 2**. Page 1 is never emitted as action, dialogue, or any other body element.

---

## 3. Script body: element types

Each type that can appear in `elements[]`:

| Type             | Description |
| ---------------- | ----------- |
| **scene_heading** | Slug line (INT./EXT., location, time). One line; no concatenation across different headings. |
| **action**       | Narrative description of what we see/hear. Present tense. Can span **multiple lines** on the page; those lines must be **concatenated into a single `text`** for one element. |
| **character**    | Character name (and optional (V.O.)/(O.S.) etc.). Usually centered, caps. One line per cue. |
| **parenthetical** | Direction in brackets `()`. Can be its **own element** (e.g. under character, before dialogue) or **inside** dialogue text. When on its own line as `( ... )`, it is a separate element. |
| **dialogue**     | Spoken line. Can follow a **parenthetical** or **dialogue** (continuation). Can span **multiple lines**; those lines must be **concatenated into a single `text`** for one element, **unless** the flow is broken by a **parenthetical** (then the next dialogue is a new element). Parentheticals can also appear inside the dialogue string (e.g. leading `( female, calm, professional) Talon-7, this is...`). |
| **transition**   | Editing instruction (CUT TO:, FADE IN:, etc.). Often right-aligned. |
| **page_number**  | Header/footer page number (e.g. "2.", "3"). |

**Rule:** Multi-line blocks (action, dialogue) = one element with concatenated text; do not merge across a parenthetical.

---

## 4. Document order

- `elements[]` must be in **reading order** (top to bottom, page by page). No grouping by scene or type.
- Typical flow: scene_heading, action, character, [parenthetical], dialogue, [more dialogue or next character], … transition, scene_heading, …

---

## 5. Internal scene numbering

- Scenes are numbered internally in document order (1, 2, 3, …). These numbers **remain fixed** once assigned.
- If a new scene is **inserted** between two existing scenes, it does **not** renumber later scenes. The inserted scene(s) take the number of the scene they follow plus a **letter suffix** (A, B, C, …). Example: existing 24, 25, 26; insert two scenes after 25 → 24, 25, **25A**, **25B**, 26.
- Scene numbers (including lettered variants like 25A, 25B) are stable for the life of the script and are used for reference (breakdown, scheduling, shot lists).

---

## 6. Concatenation rules (for parsers and readers)

- **Same type, same block:** Consecutive lines classified as the same type (e.g. action or dialogue) that form one block (e.g. similar Y position / same paragraph) are merged into **one** element by concatenating their text (space between lines).
- **Do not merge:** Two **scene_headings**; dialogue or action across an intervening **parenthetical** (parenthetical starts a new block).
- **Result:** One element = one logical block; `text` may contain multiple sentences or lines joined by spaces.

---

## 7. Canonical JSON format

- **metadata:** Object with `title`, `author`, `created`, `draft`. Optional: `page_count`, `format_version`.
- **elements:** Array of `{ "type": "<type>", "text": "<string>" }`.
- **Allowed types:** scene_heading, action, character, parenthetical, dialogue, transition, page_number (and optionally general).

Example shape:

```json
{
  "metadata": {
    "title": "TALON-7",
    "author": "Robin McManus",
    "created": "2025-12-31T10:20:33.804Z",
    "draft": "MovieShaker (Imported)"
  },
  "elements": [
    { "type": "action", "text": "FADE IN:" },
    { "type": "scene_heading", "text": "EXT. DEEP SPACE - DISTANT STAR SYSTEM" },
    { "type": "action", "text": "The experimental fighter ship TALON-7, sleek and deadly, glides through the void. In the distance, the massive carrier vessel ARCTURUS PRIME." }
  ]
}
```

---

## 8. What we do not do

- No reduced format (e.g. scene_heading + character only).
- No reordering (e.g. by scene or type).
- No treating page 1 as script body.
