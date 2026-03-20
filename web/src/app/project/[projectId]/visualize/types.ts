/**
 * Visualize page types. Aligned with engine /api/video-history and /api/compiled-videos.
 */

export interface ApiConfig {
  sourceOfTruth: "gateway";
  gatewayConnected: boolean;
  hasGatewayKey: boolean;
  models: GatewayModel[];
  visualizeVideoModels?: ModelOption[];
}

export type Provider = "gateway";

export interface GatewayModel {
  id: string;
  name: string;
  provider?: string | null;
}

export interface ModelOption extends GatewayModel {
  media_type_support?: string[];
  required_inputs?: string[];
  optional_inputs?: string[];
  status?: string;
  default_for_media_type?: string | null;
  cost_tier?: string;
  speed_tier?: string;
  quality_tier?: string;
  docs_url?: string | null;
  generation_options?: ModelGenerationOptionDescriptor[];
}

export interface ModelGenerationOptionDescriptor {
  key: string;
  label: string;
  type: "enum" | "text" | "number" | "boolean";
  default?: string | number | boolean | null;
  choices?: string[];
  hint?: string;
}

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
  credit_cost?: number | null;
  status?: string | null;
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
  { id: "gateway", name: "Gateway", description: "Gateway-backed model routing" },
];
