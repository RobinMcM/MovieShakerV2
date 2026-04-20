import json

ANALYSIS_SYSTEM_PROMPT = """You are an experienced line producer and script analyst with deep knowledge of physical production. You have broken down hundreds of scripts for low-to-mid budget productions and you think in terms of what it actually costs to put something on screen: company moves, night premiums, stunt coordination, VFX pulls, cast holding fees, and location availability.

You will receive structured script data — scene headings, page counts, character lists, and production metrics — and return a single, valid JSON object. That is all you return.

Rules:
- Return ONLY the JSON object. No preamble. No explanation. No markdown code fences. No trailing text.
- Every reference to scenes, locations, and characters must use the actual scene numbers, location names, and character names from the data provided — never use placeholders like "Scene X" or "Character A".
- Ratings and rationales must reflect the specific content of this script, not generic film production advice.
- When grouping locations for scheduling, consider logical company moves and avoid unnecessary travel between sets on the same day.
- Character types: "principal" = leads with significant screen time, "supporting" = named roles in multiple scenes, "voice" = voice only or off-screen, "entity" = non-human (creature, AI, vehicle), "crowd" = background/unnamed groups.
- Complexity ratings are 1–10 where 1 is a single actor in an empty room and 10 is a large exterior action sequence with stunts, VFX, and crowd.
- Risk scores are 1–10 where 1 is negligible and 10 is production-threatening.
- Think like someone who has to physically make this film on a real budget with a real crew."""


def build_analysis_user_prompt(context: dict) -> str:
    raw_scenes = context.get("scene_index", [])
    scene_index = []
    for s in raw_scenes:
        raw_chars = s.get("characters") or []
        characters = [
            {
                "name": c.get("name", c) if isinstance(c, dict) else str(c),
                "character_type": c.get("character_type", "supporting") if isinstance(c, dict) else "supporting",
            }
            for c in raw_chars
        ]
        scene_index.append({**s, "characters": characters})
    scene_index_json = json.dumps(scene_index, indent=2)

    return f"""Analyse the following script data and return a single valid JSON object matching the exact structure shown below.

SCRIPT OVERVIEW
---------------
Title: {context.get("title", "Untitled")}
Author: {context.get("author", "Unknown")}
Page count: {context.get("page_count", 0)}
Total scenes: {context.get("total_scenes", 0)}
Total eighths: {context.get("total_eighths", 0)}
Interior scenes: {context.get("int_count", 0)}
Exterior scenes: {context.get("ext_count", 0)}
Night shoots: {context.get("night_shoot_count", 0)}
Unique locations: {json.dumps(context.get("unique_locations", []))}
Scenes with stunts: {context.get("stunt_scene_count", 0)}
Scenes with VFX: {context.get("vfx_scene_count", 0)}
Estimated shooting days: {context.get("estimated_shooting_days", 0)}

SCENE INDEX
-----------
{scene_index_json}

REQUIRED JSON STRUCTURE
-----------------------
Return exactly this structure, populated with data from the script above:

{{
  "act_structure": {{
    "acts": [
      {{
        "act": "One",
        "scene_range": [1, 13],
        "turning_point": "brief description of the turning point event",
        "page_range": [1, 19]
      }}
    ]
  }},
  "location_map": {{
    "locations": [
      {{
        "name": "INT. BRIDGE",
        "scenes": [1, 4, 7],
        "location_type": "INT",
        "complexity_rating": 7,
        "complexity_rationale": "one sentence explaining the rating"
      }}
    ]
  }},
  "cast_summary": {{
    "characters": [
      {{
        "name": "TALON",
        "character_type": "principal",
        "total_scenes": 9,
        "scenes": [1, 2, 3]
      }}
    ]
  }},
  "risk_scores": {{
    "schedule": {{"score": 6, "rationale": "one sentence referencing specific scenes or locations"}},
    "budget": {{"score": 7, "rationale": "one sentence referencing specific cost drivers"}},
    "vfx": {{"score": 8, "rationale": "one sentence referencing specific scenes"}},
    "stunt": {{"score": 4, "rationale": "one sentence referencing specific scenes"}},
    "location": {{"score": 5, "rationale": "one sentence referencing specific locations"}}
  }},
  "production_metrics": {{
    "estimated_shooting_days": 12,
    "location_day_groupings": [
      {{
        "location": "INT. BRIDGE",
        "scenes": [1, 4, 7],
        "suggested_days": 2
      }}
    ],
    "cast_size_by_type": {{
      "principal": 2,
      "supporting": 1,
      "voice": 1,
      "entity": 0,
      "crowd": 0
    }}
  }}
}}

Return only the JSON object. Nothing else."""
