/**
 * Shot List (tramlines) page types. Aligned with engine /api/tram-lines and scripts APIs.
 */

export interface Project {
  id: string;
  title: string;
  name?: string;
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
  scene_number?: number;
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

export interface TramLine {
  id: string;
  sceneId: string;
  lineNumber: string;
  color: string;
  startY: number;
  endY: number;
  xPosition: number;
  cameraDirection: string;
  shotType?: string;
}

export interface ShotTypeOption {
  value: string;
  label: string;
}

export const SHOT_TYPES: ShotTypeOption[] = [
  { value: "ECU", label: "ECU - Extreme Close Up" },
  { value: "CU", label: "CU - Close Up" },
  { value: "MCU", label: "MCU - Medium Close Up" },
  { value: "MS", label: "MS - Medium Shot" },
  { value: "MWS", label: "MWS - Medium Wide Shot" },
  { value: "WS", label: "WS - Wide Shot" },
  { value: "EWS", label: "EWS - Extreme Wide Shot" },
  { value: "OTS", label: "OTS - Over The Shoulder" },
  { value: "POV", label: "POV - Point of View" },
  { value: "INSERT", label: "INSERT - Insert Shot" },
  { value: "AERIAL", label: "AERIAL - Aerial Shot" },
  { value: "TRACKING", label: "TRACKING - Tracking Shot" },
  { value: "DOLLY", label: "DOLLY - Dolly Shot" },
  { value: "PAN", label: "PAN - Pan Shot" },
  { value: "TILT", label: "TILT - Tilt Shot" },
  { value: "CRANE", label: "CRANE - Crane Shot" },
  { value: "STEADICAM", label: "STEADICAM - Steadicam Shot" },
];

export interface TramColor {
  name: string;
  hex: string;
}

export const TRAM_COLORS: TramColor[] = [
  { name: "Blue", hex: "#3B82F6" },
  { name: "Red", hex: "#EF4444" },
  { name: "Green", hex: "#10B981" },
  { name: "Yellow", hex: "#F59E0B" },
  { name: "Purple", hex: "#8B5CF6" },
  { name: "Pink", hex: "#EC4899" },
  { name: "Orange", hex: "#F97316" },
  { name: "Teal", hex: "#14B8A6" },
  { name: "Cyan", hex: "#06B6D4" },
  { name: "Lime", hex: "#84CC16" },
  { name: "Indigo", hex: "#6366F1" },
  { name: "Rose", hex: "#F43F5E" },
];
