/**
 * Mood Board types. Aligned with engine /api/moodboard and /api/projects/:id/tram-lines.
 */

export interface ProjectMood {
  id: string;
  name: string;
  title?: string;
  director?: string | null;
  aspect_ratio?: string | null;
  series?: string | null;
  episode?: string | null;
}

export interface TramLineScene {
  id: string;
  heading: string;
  scene_number?: number;
  page_number?: string;
  script_id: string;
}

export interface TramLineWithScene {
  id: string;
  scene_id: string;
  line_number: string;
  color: string;
  action_text: string | null;
  character_names: string | null;
  script_elements?: Array<{
    type: string;
    text: string;
    element_id?: string;
  }> | null;
  scene_mood: string | null;
  scene_visual: string | null;
  shot_type: string | null;
  camera_direction: string | null;
  scenes?: TramLineScene | null;
}

export interface CanvasComposition {
  id: string;
  tram_line_id: string;
  user_id: string;
  composition_data: Record<string, unknown> | null;
  canvas_number: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ImageHistoryItem {
  id: string;
  tram_line_id: string;
  image_path: string;
  generation_method: string;
  prompt?: string | null;
  aspect_ratio?: string | null;
  created_at: string | null;
}

export interface CharacterMood {
  id: string;
  name: string;
  script_id: string;
  type?: string;
  character_image_url?: string | null;
}
