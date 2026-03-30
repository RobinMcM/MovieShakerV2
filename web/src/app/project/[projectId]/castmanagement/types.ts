/**
 * Cast Management page types. Aligned with engine/legacy API shapes.
 * Project from api.get('/projects/'); scripts from /projects/:id/scripts;
 * characters from /scripts/:id/characters.
 */

export interface Project {
  id: string;
  name: string;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  series?: string | null;
  episode?: string | null;
  casting_location?: string | null;
}

export interface ScriptListItem {
  id: string;
  project_id: string;
  name: string;
  is_current: boolean;
  uploaded_at?: string;
}

export interface Character {
  id: string;
  name: string;
  script_id?: string;
  casting_notes?: string | null;
}

export interface CharacterResponseItem {
  id: string;
  name: string;
}
