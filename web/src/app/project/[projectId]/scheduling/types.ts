/**
 * Scheduling page types. Aligned with engine response shapes where applicable.
 * Optional scheduling fields (shooting_day, scene_location, etc.) are present
 * for when the backend adds them; engine currently returns a subset.
 */

export interface Project {
  id: string;
  /** Engine returns `name`; we use it as display title */
  name: string;
  title?: string; // legacy alias, prefer name
  start_date: string | null;
  end_date: string | null;
  status: string;
  series: string | null;
  episode: string | null;
}

export interface Scene {
  id: string;
  heading: string;
  page_number: string;
  script_id: string;
  length_in_eighths?: number | null;
  scene_number?: number | null;
  continuity_day?: number | null;
  time_of_day_id?: string | null;
  time_of_day_notes?: string | null;
  shooting_day?: string | null;
  location_details?: string | null;
  scene_location?: string | null;
  scene_details?: string | null;
  scene_characters?: SceneCharacter[];
}

export interface TimeOfDay {
  id: string;
  name: string;
  sort_order: number;
}

export interface Character {
  id: string;
  name: string;
  script_id: string;
}

export interface SceneWithCharacters {
  scene: Scene;
  characters: Character[];
}

export interface SceneCharacter {
  id: string;
  scene_id: string;
  character_id: string;
  status?: string | null;
  notes?: string | null;
  characters?: {
    name: string;
  };
}
