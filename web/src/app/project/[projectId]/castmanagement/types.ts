/**
 * Cast Management page types. Aligned with engine/legacy API shapes.
 * Project from api.get('/projects/'); scripts from /projects/:id/scripts;
 * characters from /scripts/:id/characters; applications from /api/auditions/characters/:id/applications.
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
  applications: Application[];
}

export interface Application {
  id: string;
  user_id: string;
  applicant_name: string;
  applicant_email: string;
  status: string;
  created_at: string;
  notes: string | null;
  pronoun?: string | null;
  playing_age?: string | null;
  actor_profile?: string | null;
  profiles?: {
    avatar_url: string | null;
    name: string | null;
  };
}

export interface CharacterResponseItem {
  id: string;
  name: string;
}
