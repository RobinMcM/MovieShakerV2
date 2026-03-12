/**
 * Visualize page types. Aligned with engine /api/video-history and /api/compiled-videos.
 */

export interface ApiConfig {
  hasRunwayKey: boolean;
  hasViduKey: boolean;
  testModeEnabled: boolean;
}

export type Provider = "runway" | "vidu";

export interface VideoHistoryItem {
  id: string;
  video_path: string;
  task_id: string | null;
  generation_method: string;
  prompt: string | null;
  aspect_ratio: string | null;
  duration: number | null;
  created_at: string | null;
  is_print?: boolean;
  take_number: number | null;
  Channel: number | null;
  source_type?: string | null;
  source_image_path?: string | null;
  source_video_id?: string | null;
}

export interface CompiledVideo {
  id: string;
  compiled_video_path: string;
  source_video_ids: string[];
  status: string;
  created_at: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  is_main_print?: boolean | null;
  youtube_upload_status?: string | null;
  tram_line_id?: string;
  project_id?: string;
  channel_number?: number | null;
}

export interface CompiledVideoWithTramLine extends CompiledVideo {
  tram_line?: {
    line_number: string;
    shot_type?: string | null;
  };
}

export const PROVIDERS: { id: Provider; name: string; description: string }[] = [
  { id: "runway", name: "Runway", description: "RunwayML Gen-4" },
  { id: "vidu", name: "Vidu", description: "Vidu AI" },
];
