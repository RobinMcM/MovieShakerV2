# Script JSON Schema v2.0

## scene_heading element

```json
{
  "type": "scene_heading",
  "text": "INT. OFFICE - DAY",
  "scene_number": 1,
  "page": 1,
  "eighths": 4,
  "int_ext": "INT",
  "location": "OFFICE",
  "sub_location": null,
  "time_of_day": "day",
  "characters": [
    {
      "name": "ALICE",
      "character_type": "principal",
      "scene_function": "Confronts BOB about the missing file"
    },
    {
      "name": "BOB",
      "character_type": "supporting",
      "scene_function": "Deflects and covers for the director"
    }
  ]
}
```

## characters array

Each object within `characters` represents a character present in the scene.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Character name as it appears in the script (uppercase) |
| `character_type` | string | no | `"supporting"` | One of the values below |
| `scene_function` | string | no | `""` | Brief description of what this character does in this specific scene |

### character_type values

| Value | Meaning |
|-------|---------|
| `"principal"` | Lead characters with significant screen time — on set most of the shoot |
| `"supporting"` | Named characters with meaningful but smaller roles |
| `"voice"` | Heard but not physically present on set (phone calls, intercom, narration) |
| `"entity"` | Non-human presence (AI system, creature, vehicle, environmental force) |
| `"crowd"` | Unnamed background performers — counted in bulk, not individually |

### Ingest behaviour

- If `character_type` is absent or null, the ingest defaults to `"supporting"`.
- If `scene_function` is absent or null, the ingest defaults to `""`.
- The `characters` array may also be a flat list of name strings (legacy v1 format). The ingest normalises these to objects with `character_type: "supporting"` and `scene_function: ""`.

## Other element types

Non-`scene_heading` elements (action, dialogue, transition, etc.) are stored in the script JSON file but are not ingested into the `scenes` table. They are read directly from DigitalOcean Spaces when scene-level breakdown is needed.
