import json
from sqlalchemy import text
from sqlmodel import Session


def compute_production_metrics(script_id: str, db: Session) -> dict:
    """Query scene data for script_id and return a context dict for build_analysis_user_prompt."""

    script_row = db.execute(
        text("SELECT name, page_count FROM script WHERE id = :script_id"),
        {"script_id": script_id},
    ).first()

    title = script_row[0] if script_row else "Untitled"
    page_count = script_row[1] if script_row else 0

    rows = db.execute(
        text("""
            SELECT scene_number, heading, page_number, length_in_eighths,
                   location_type, scene_location, location_details,
                   is_night_shoot, has_stunts, has_vfx, characters
            FROM scenes
            WHERE script_id = :script_id
            ORDER BY scene_number ASC
        """),
        {"script_id": script_id},
    ).fetchall()

    total_scenes = len(rows)
    total_eighths = 0
    int_count = 0
    ext_count = 0
    night_shoot_count = 0
    stunt_scene_count = 0
    vfx_scene_count = 0
    seen_locations: list[str] = []
    scene_index = []

    for row in rows:
        (
            scene_number, heading, page_number, length_in_eighths,
            location_type, scene_location, location_details,
            is_night_shoot, has_stunts, has_vfx, characters_raw,
        ) = row

        if length_in_eighths:
            total_eighths += length_in_eighths
        if location_type == "INT":
            int_count += 1
        elif location_type == "EXT":
            ext_count += 1
        if is_night_shoot:
            night_shoot_count += 1
        if has_stunts:
            stunt_scene_count += 1
        if has_vfx:
            vfx_scene_count += 1

        if scene_location and scene_location not in seen_locations:
            seen_locations.append(scene_location)

        if isinstance(characters_raw, str):
            try:
                characters = json.loads(characters_raw)
            except (ValueError, TypeError):
                characters = []
        elif isinstance(characters_raw, list):
            characters = characters_raw
        else:
            characters = []

        scene_index.append({
            "scene_number": scene_number,
            "heading": heading,
            "page_number": page_number,
            "length_in_eighths": length_in_eighths,
            "location_type": location_type,
            "scene_location": scene_location,
            "location_details": location_details,
            "is_night_shoot": is_night_shoot,
            "characters": characters,
        })

    estimated_shooting_days = round(total_eighths / 32, 1) if total_eighths else 0.0

    return {
        "title": title,
        "author": "",
        "page_count": page_count or 0,
        "total_scenes": total_scenes,
        "total_eighths": total_eighths,
        "int_count": int_count,
        "ext_count": ext_count,
        "night_shoot_count": night_shoot_count,
        "unique_locations": seen_locations,
        "stunt_scene_count": stunt_scene_count,
        "vfx_scene_count": vfx_scene_count,
        "estimated_shooting_days": estimated_shooting_days,
        "scene_index": scene_index,
    }
