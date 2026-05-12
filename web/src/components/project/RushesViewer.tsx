"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Bookmark,
  Film,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Pause,
  Pencil,
  Play,
  Scissors,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { API_URL } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClipMeta {
  filename: string;
  key: string;
  size: number;
  url: string;
  last_modified: string;
  is_extract: boolean;
}

interface SelectMeta {
  id: string;
  label: string;
  source_key: string;
  source_filename: string;
  in_time: number;
  out_time: number;
  duration: number;
  created_at: string;
  source_url?: string;
}

// ---------------------------------------------------------------------------
// ConfirmDeleteDialog — modal confirmation before any delete action
// ---------------------------------------------------------------------------

function ConfirmDeleteDialog({
  itemName,
  onConfirm,
  onCancel,
}: {
  itemName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Delete this file?</p>
          <p className="text-xs text-muted-foreground break-all">
            <span className="font-medium text-foreground">{itemName}</span> will be permanently
            removed and cannot be recovered.
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700 text-white border-0"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InlineRename — shared inline-edit name field used by all cards
// ---------------------------------------------------------------------------

function InlineRename({
  name,
  onSave,
}: {
  name: string;
  onSave: (newName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setValue(name);
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  }

  function commit() {
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) onSave(trimmed);
    setEditing(false);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") setEditing(false);
    e.stopPropagation();
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        onClick={(e) => e.stopPropagation()}
        className="w-full text-xs bg-background border border-primary rounded px-1 py-0 leading-tight focus:outline-none"
      />
    );
  }

  return (
    <span className="group/rename flex items-center gap-0.5 min-w-0">
      <span className="truncate text-xs text-foreground leading-tight">{name}</span>
      <button
        onClick={startEdit}
        className="flex-shrink-0 opacity-0 group-hover/rename:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        title="Rename"
      >
        <Pencil className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

interface InsertMeta {
  filename: string;
  key: string;
  size: number;
  url: string;
  last_modified: string;
}

interface SoundMeta { filename: string; key: string; size: number; url: string; last_modified: string; }
interface EffectsMeta { filename: string; key: string; size: number; url: string; last_modified: string; }
interface BackgroundsMeta { filename: string; key: string; size: number; url: string; last_modified: string; }

type TimelineMode = "section" | "place" | null;
type SectionStep = 0 | 1 | 2;
type ActiveTab = "clips" | "selects" | "inserts" | "sound" | "effects" | "backgrounds";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTimecode(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// ClipCard
// ---------------------------------------------------------------------------

// Video thumbnail — preload="metadata" so only moov atom is fetched (~few KB).
// seekTo: exact time to show (e.g. select in_time); falls back to 10% of duration.
function ClipThumbnail({ url, seekTo }: { url: string; seekTo?: number }) {
  return (
    <video
      src={url}
      muted
      playsInline
      preload="metadata"
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        v.currentTime = seekTo !== undefined
          ? Math.min(seekTo, v.duration)
          : Math.min(1, v.duration * 0.1);
      }}
      className="w-full h-full object-cover"
    />
  );
}

interface ClipCardProps {
  clip: ClipMeta;
  label: string;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

function ClipCard({ clip, label, active, onClick, onDelete, onRename }: ClipCardProps) {
  return (
    <div className={`
      relative flex-shrink-0 w-44 rounded-lg overflow-hidden text-left transition-all border-2
      ${active
        ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
        : "border-border hover:border-muted-foreground"
      }
    `}>
      <button onClick={onClick} className="block w-full focus:outline-none">
        <div className="relative w-full h-24 bg-muted overflow-hidden">
          <ClipThumbnail url={clip.url} />
          {active && (
            <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
              <Play className="w-8 h-8 text-foreground fill-foreground drop-shadow" />
            </div>
          )}
          <span className="absolute bottom-1 left-1 bg-background/70 text-foreground text-[10px] px-1 rounded">
            {formatSize(clip.size)}
          </span>
        </div>
        <div className="px-2 pt-1 pb-1.5 bg-card">
          <InlineRename name={label} onSave={onRename} />
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-1 right-1 z-10 rounded bg-background/70 p-0.5 text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
        title="Delete clip"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectCard
// ---------------------------------------------------------------------------

interface SelectCardProps {
  select: SelectMeta;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  sourceUrl?: string;
}

function SelectCard({ select, active, onClick, onDelete, onRename, sourceUrl }: SelectCardProps) {
  return (
    <div className={`
      relative flex-shrink-0 w-44 rounded-lg overflow-hidden text-left transition-all border-2
      ${active
        ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
        : "border-border hover:border-muted-foreground"
      }
    `}>
      <button onClick={onClick} className="block w-full focus:outline-none">
        <div className="relative w-full h-24 bg-muted flex items-center justify-center overflow-hidden">
          {sourceUrl ? (
            <ClipThumbnail url={sourceUrl} seekTo={select.in_time} />
          ) : (
            <Bookmark className="w-7 h-7 text-muted-foreground" />
          )}
          {active && (
            <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
              <Play className="w-7 h-7 text-foreground fill-foreground" />
            </div>
          )}
          <span className="absolute bottom-1 left-1 bg-background/70 text-foreground text-[10px] px-1 rounded">
            {formatDuration(select.duration)}
          </span>
        </div>
        <div className="px-2 pt-1 pb-1.5 bg-card text-left">
          <InlineRename name={select.label || select.source_filename} onSave={onRename} />
          <p className="text-[10px] text-muted-foreground font-mono">
            {formatTimecode(select.in_time)} → {formatTimecode(select.out_time)}
          </p>
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-1 right-1 z-10 rounded bg-background/70 p-0.5 text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
        title="Delete select"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InsertCard
// ---------------------------------------------------------------------------

interface InsertCardProps {
  insert: InsertMeta;
  label: string;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

function InsertCard({ insert, label, active, onClick, onDelete, onRename }: InsertCardProps) {
  return (
    <div className={`
      relative flex-shrink-0 w-44 rounded-lg overflow-hidden text-left transition-all border-2
      ${active
        ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
        : "border-border hover:border-muted-foreground"
      }
    `}>
      <button onClick={onClick} className="block w-full focus:outline-none">
        <div className="relative w-full h-24 bg-muted overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={insert.url} alt={insert.filename} className="w-full h-full object-cover" />
          {active && (
            <div className="absolute inset-0 bg-primary/20" />
          )}
          <span className="absolute bottom-1 left-1 bg-background/70 text-foreground text-[10px] px-1 rounded">
            {formatSize(insert.size)}
          </span>
        </div>
        <div className="px-2 pt-1 pb-1.5 bg-card">
          <InlineRename name={label} onSave={onRename} />
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-1 right-1 z-10 rounded bg-background/70 p-0.5 text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
        title="Delete insert"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AudioCard — shared card for Sound and Effects items
// ---------------------------------------------------------------------------

interface AudioCardProps {
  item: SoundMeta | EffectsMeta;
  label: string;
  icon: React.ReactNode;
  onDelete: () => void;
  onRename: (name: string) => void;
}

function AudioCard({ item, label, icon, onDelete, onRename }: AudioCardProps) {
  return (
    <div className="relative flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left">
      <div className="flex-shrink-0 text-muted-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <InlineRename name={label} onSave={onRename} />
        <p className="text-[10px] text-muted-foreground">{formatSize(item.size)}</p>
      </div>
      <button
        onClick={onDelete}
        className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
        title="Delete"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BackgroundCard
// ---------------------------------------------------------------------------

interface BackgroundCardProps {
  item: BackgroundsMeta;
  label: string;
  onDelete: () => void;
  onRename: (name: string) => void;
}

function BackgroundCard({ item, label, onDelete, onRename }: BackgroundCardProps) {
  const ext = item.filename.split(".").pop()?.toLowerCase() ?? "";
  const isImage = ["jpg", "jpeg", "png", "webp"].includes(ext);
  return (
    <div className="relative flex-shrink-0 w-44 rounded-lg overflow-hidden border border-border">
      <div className="relative w-full h-24 bg-muted overflow-hidden flex items-center justify-center">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.filename} className="w-full h-full object-cover" />
        ) : (
          <Film className="w-6 h-6 text-muted-foreground" />
        )}
        <span className="absolute bottom-1 left-1 bg-background/70 text-foreground text-[10px] px-1 rounded">
          {formatSize(item.size)}
        </span>
      </div>
      <div className="px-2 pt-1 pb-1.5 bg-card">
        <InlineRename name={label} onSave={onRename} />
      </div>
      <button
        onClick={onDelete}
        className="absolute top-1 right-1 z-10 rounded bg-background/70 p-0.5 text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
        title="Delete background"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RushesViewer
// ---------------------------------------------------------------------------

interface RushesViewerProps {
  projectId: string;
  onAssetsChanged?: () => void;
  externalPreview?: { url: string; in_time?: number; out_time?: number; isImage?: boolean } | null;
  emptyStateLabel?: string;
  onClearExternalPreview?: () => void;
}

export function RushesViewer({ projectId, onAssetsChanged, externalPreview, emptyStateLabel, onClearExternalPreview }: RushesViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const insertInputRef = useRef<HTMLInputElement>(null);
  const soundInputRef = useRef<HTMLInputElement>(null);
  const effectsInputRef = useRef<HTMLInputElement>(null);
  const backgroundsInputRef = useRef<HTMLInputElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const isPlayingSelectionRef = useRef(false);

  // clip / select / insert state
  const [clips, setClips] = useState<ClipMeta[]>([]);
  const [selects, setSelects] = useState<SelectMeta[]>([]);
  const [inserts, setInserts] = useState<InsertMeta[]>([]);
  const [clipsLoading, setClipsLoading] = useState(true);
  const clipUrlMap = useMemo(() => new Map(clips.map((c) => [c.key, c.url])), [clips]);
  const [currentClip, setCurrentClip] = useState<ClipMeta | null>(null);
  const [currentSelect, setCurrentSelect] = useState<SelectMeta | null>(null);
  const [currentInsert, setCurrentInsert] = useState<InsertMeta | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("clips");

  // clip upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // insert upload state
  const [insertUploading, setInsertUploading] = useState(false);
  const [insertUploadProgress, setInsertUploadProgress] = useState(0);
  const [insertUploadError, setInsertUploadError] = useState<string | null>(null);

  // sound / effects / backgrounds state
  const [sounds, setSounds] = useState<SoundMeta[]>([]);
  const [effects, setEffects] = useState<EffectsMeta[]>([]);
  const [backgrounds, setBackgrounds] = useState<BackgroundsMeta[]>([]);
  const [soundUploading, setSoundUploading] = useState(false);
  const [soundUploadProgress, setSoundUploadProgress] = useState(0);
  const [soundUploadError, setSoundUploadError] = useState<string | null>(null);
  const [effectsUploading, setEffectsUploading] = useState(false);
  const [effectsUploadProgress, setEffectsUploadProgress] = useState(0);
  const [effectsUploadError, setEffectsUploadError] = useState<string | null>(null);
  const [backgroundsUploading, setBackgroundsUploading] = useState(false);
  const [backgroundsUploadProgress, setBackgroundsUploadProgress] = useState(0);
  const [backgroundsUploadError, setBackgroundsUploadError] = useState<string | null>(null);

  // timeline state — mode is intentionally NOT reset on clip change (matches documentary studio)
  const [playheadTime, setPlayheadTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>(null);
  const [sectionStep, setSectionStep] = useState<SectionStep>(0);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);
  const [placePoint, setPlacePoint] = useState<number | null>(null);

  // audio waveform state
  const [waveformSamples, setWaveformSamples] = useState<Float32Array | null>(null);
  // stored peaks keyed by clip filename — "processing" while background task runs
  const [audioPeaks, setAudioPeaks] = useState<Record<string, number[] | "processing">>({});

  // full duration of the source video currently loaded (needed to slice select peaks)
  const [sourceVideoDuration, setSourceVideoDuration] = useState<number>(0);

  // asset labels (display-name overrides keyed by storage key or select id)
  const [labels, setLabels] = useState<Record<string, string>>({});
  const labelsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // delete confirmation dialog
  const [pendingDelete, setPendingDelete] = useState<{ label: string; onConfirm: () => void } | null>(null);

  // save select state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // video error state (format not supported, CORS failure, etc.)
  const [videoError, setVideoError] = useState<string | null>(null);

  // playback state — kept in sync via onPlay / onPause events
  const [isPlaying, setIsPlaying] = useState(false);

  // Stable ID for the active item — changes whenever the playing item changes.
  // Drives the load+play effect (same pattern as film-in-a-box's currentUrl effect).
  const videoId = currentClip?.key ?? (currentSelect ? `select:${currentSelect.id}` : (externalPreview && !externalPreview.isImage ? externalPreview.url : ""));
  const videoSrc = (externalPreview && !externalPreview.isImage ? externalPreview.url : null) ?? currentClip?.url ?? currentSelect?.source_url ?? "";

  // ---- fetch ----

  const fetchClips = useCallback(async () => {
    setClipsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load clips");
      const data = await res.json() as {
        clips: ClipMeta[];
        selects: SelectMeta[];
        inserts: InsertMeta[];
        sounds: SoundMeta[];
        effects: EffectsMeta[];
        backgrounds: BackgroundsMeta[];
        audio_peaks?: Record<string, number[] | "processing">;
        labels?: Record<string, string>;
      };
      setClips(data.clips);
      setSelects(data.selects || []);
      setInserts(data.inserts || []);
      setSounds(data.sounds || []);
      setEffects(data.effects || []);
      setBackgrounds(data.backgrounds || []);
      setAudioPeaks(data.audio_peaks || {});
      setLabels(data.labels || {});
    } catch {
      setClips([]);
      setSelects([]);
      setInserts([]);
      setSounds([]);
      setEffects([]);
      setBackgrounds([]);
    } finally {
      setClipsLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchClips(); }, [fetchClips]);

  // Load whenever the active item changes — resets markers but preserves timeline mode.
  // No auto-play: leave the video paused so native controls remain visible at all times.
  useEffect(() => {
    const vid = videoRef.current;
    setInPoint(null);
    setOutPoint(null);
    setPlacePoint(null);
    setSectionStep(0);
    setPlayheadTime(0);
    setVideoDuration(0);
    setSourceVideoDuration(0);
    setSaveError(null);
    setVideoError(null);
    setIsPlaying(false);
    if (!vid || !videoId) return;
    vid.load();
  }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hydrate waveformSamples from persisted peaks. For selects, slice to the in/out portion.
  useEffect(() => {
    const filename = currentClip?.filename ?? currentSelect?.source_filename;
    const entry = filename ? audioPeaks[filename] : undefined;
    if (Array.isArray(entry)) {
      if (currentSelect && sourceVideoDuration > 0) {
        const total = entry.length;
        const startIdx = Math.floor((currentSelect.in_time / sourceVideoDuration) * total);
        const endIdx = Math.ceil((currentSelect.out_time / sourceVideoDuration) * total);
        setWaveformSamples(new Float32Array(entry.slice(startIdx, endIdx)));
      } else {
        setWaveformSamples(new Float32Array(entry));
      }
    } else {
      setWaveformSamples(null);
    }
  }, [currentClip?.filename, currentSelect?.id, sourceVideoDuration, audioPeaks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll every 5 seconds while the current item's peaks are still processing.
  useEffect(() => {
    const filename = currentClip?.filename ?? currentSelect?.source_filename;
    const entry = filename ? audioPeaks[filename] : undefined;
    if (entry !== "processing") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json() as { audio_peaks?: Record<string, number[] | "processing"> };
        setAudioPeaks(data.audio_peaks ?? {});
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [currentClip?.filename, currentSelect?.source_filename, audioPeaks, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- external preview sync ----
  // When an artifact is selected in the editor's Artifacts panel, clear internal
  // selection so the video element reloads with the externally provided URL.
  useEffect(() => {
    if (!externalPreview) return;
    setCurrentClip(null);
    setCurrentSelect(null);
    setCurrentInsert(null);
  }, [externalPreview]);

  // ---- play actions ----

  const playClip = useCallback((clip: ClipMeta) => {
    setCurrentClip(clip);
    setCurrentSelect(null);
    setCurrentInsert(null);
    onClearExternalPreview?.();
  }, [onClearExternalPreview]);

  const playSelect = useCallback((select: SelectMeta) => {
    setCurrentSelect(select);
    setCurrentClip(null);
    setCurrentInsert(null);
    onClearExternalPreview?.();
  }, [onClearExternalPreview]);

  const playInsert = useCallback((ins: InsertMeta) => {
    setCurrentInsert(ins);
    setCurrentClip(null);
    setCurrentSelect(null);
    onClearExternalPreview?.();
  }, [onClearExternalPreview]);

  // Auto-advance to next clip on video end (mirrors film-in-a-box handleVideoEnded)
  const handleVideoEnded = useCallback(() => {
    if (!currentClip || clips.length === 0) return;
    const idx = clips.findIndex((c) => c.key === currentClip.key);
    if (idx >= 0 && idx < clips.length - 1) playClip(clips[idx + 1]);
  }, [currentClip, clips, playClip]);

  const handlePlayPause = useCallback(() => {
    isPlayingSelectionRef.current = false;
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) vid.play().catch(() => {});
    else vid.pause();
  }, []);

  const handlePlaySelection = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || inPoint === null) return;
    isPlayingSelectionRef.current = true;
    vid.currentTime = inPoint;
    vid.play().catch(() => { isPlayingSelectionRef.current = false; });
  }, [inPoint]);

  // ---- upload ----

  // Prevent the screen from sleeping while a large file is in flight.
  // Re-acquires automatically when the tab becomes visible again (browser releases on hide).
  // Returns a cleanup function; safe to call even if Wake Lock is unsupported.
  async function acquireWakeLock(): Promise<() => void> {
    const wl: { release: () => void } = { release: () => {} };
    const acquire = async () => {
      try {
        if ("wakeLock" in navigator) {
          const sentinel = await navigator.wakeLock.request("screen");
          wl.release = () => sentinel.release().catch(() => {});
        }
      } catch { /* denied or unavailable — continue without it */ }
    };
    await acquire();
    const onVisibilityChange = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      wl.release();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }

  const handleUpload = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    // Resolve effective MIME type (macOS sends application/octet-stream for some formats)
    const ALLOWED_TYPES = ["video/mp4", "video/quicktime"];
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const effectiveType = ALLOWED_TYPES.includes(file.type) ? file.type
      : ext === "mp4" || ext === "m4v" ? "video/mp4"
      : ext === "mov" ? "video/quicktime"
      : file.type;

    if (!ALLOWED_TYPES.includes(effectiveType)) {
      setUploadError("Only .mp4 and .mov files are supported.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    acquireWakeLock().then(async (releaseWakeLock) => {
      const cleanup = (err?: string) => {
        releaseWakeLock();
        setUploading(false);
        if (err) setUploadError(err);
      };

      try {
        // Step 1: get a presigned PUT URL from the engine (fast — no file data)
        const urlRes = await fetch(
          `${API_URL}/api/documentary/projects/${projectId}/rushes/upload-url`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, content_type: effectiveType }),
          }
        );
        if (!urlRes.ok) {
          const err = await urlRes.json().catch(() => ({})) as { detail?: string };
          cleanup(err.detail || "Upload failed");
          return;
        }
        const { upload_url, key, filename } = await urlRes.json() as {
          upload_url: string; key: string; filename: string;
        };

        // Step 2: PUT the file directly to Spaces — bypasses engine and Caddy entirely,
        // eliminating proxy timeouts for large files.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload to storage failed (${xhr.status})`));
          };
          xhr.onerror = () => reject(new Error("Network error during upload"));
          xhr.open("PUT", upload_url);
          xhr.setRequestHeader("Content-Type", effectiveType);
          xhr.send(file);
        });

        // Step 3: notify engine — triggers audio peak extraction in background
        const regRes = await fetch(
          `${API_URL}/api/documentary/projects/${projectId}/rushes/register`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, filename }),
          }
        );
        if (!regRes.ok) {
          const err = await regRes.json().catch(() => ({})) as { detail?: string };
          cleanup(err.detail || "Upload registration failed");
          return;
        }

        cleanup();
        fetchClips();
        onAssetsChanged?.();
      } catch (err) {
        cleanup(err instanceof Error ? err.message : "Upload failed");
      }
    });
  }, [projectId, fetchClips, onAssetsChanged]);

  // ---- mode buttons — always resets markers, preserves mode between clips ----

  function activateMode(mode: NonNullable<TimelineMode>) {
    setTimelineMode(mode);
    if (mode === "section") {
      setInPoint(null);
      setOutPoint(null);
      setSectionStep(0);
    } else {
      setPlacePoint(null);
    }
  }

  // ---- bar interaction — identical to film-in-a-box ----

  function timeFromBarX(clientX: number): number {
    const el = timelineRef.current;
    if (!el || !videoDuration) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * videoDuration;
  }

  function handleBarClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!videoDuration || currentSelect) return;
    const t = timeFromBarX(e.clientX);
    if (timelineMode === "section") {
      if (sectionStep === 0) {
        setInPoint(t); setOutPoint(null); setSectionStep(1);
      } else if (sectionStep === 1) {
        const newIn = Math.min(inPoint!, t);
        const newOut = Math.max(inPoint!, t);
        setInPoint(newIn); setOutPoint(newOut); setSectionStep(2);
      }
      // sectionStep === 2: no-op — section is locked
    } else if (timelineMode === "place") {
      setPlacePoint(t);
    }
    // null mode: bar is passive, no action
  }

  // ---- save select ----

  async function handleSaveSelect() {
    if (!currentClip || inPoint === null || outPoint === null) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes/selects`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_key: currentClip.key,
          source_filename: currentClip.filename,
          in_time: inPoint,
          out_time: outPoint,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error((err as { detail?: string }).detail || "Save failed");
      }
      const newSelect = await res.json() as SelectMeta;
      newSelect.source_url = currentClip.url;
      setSelects((prev) => [...prev, newSelect]);
      setActiveTab("selects");
      setInPoint(null);
      setOutPoint(null);
      setSectionStep(0);
      onAssetsChanged?.();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  // ---- delete select ----

  async function handleDeleteSelect(selectId: string) {
    try {
      await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes/selects/${selectId}`, {
        method: "DELETE",
        credentials: "include",
      });
      setSelects((prev) => prev.filter((s) => s.id !== selectId));
      if (currentSelect?.id === selectId) setCurrentSelect(null);
    } catch {
      // silent
    }
  }

  // ---- delete clip (removes from Spaces permanently) ----

  async function handleDeleteClip(clip: ClipMeta) {
    try {
      await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes/${clip.filename}`, {
        method: "DELETE",
        credentials: "include",
      });
      setClips((prev) => prev.filter((c) => c.key !== clip.key));
      if (currentClip?.key === clip.key) setCurrentClip(null);
    } catch {
      // silent
    }
  }

  // ---- delete insert ----

  async function handleDeleteInsert(ins: InsertMeta) {
    try {
      await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes/inserts/${ins.filename}`, {
        method: "DELETE",
        credentials: "include",
      });
      setInserts((prev) => prev.filter((i) => i.key !== ins.key));
      if (currentInsert?.key === ins.key) setCurrentInsert(null);
    } catch {
      // silent
    }
  }

  // ---- delete sound / effects / backgrounds ----

  async function handleDeleteSound(item: SoundMeta) {
    try {
      await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes/sound/${item.filename}`, {
        method: "DELETE", credentials: "include",
      });
      setSounds((prev) => prev.filter((s) => s.key !== item.key));
    } catch { /* silent */ }
  }

  async function handleDeleteEffects(item: EffectsMeta) {
    try {
      await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes/effects/${item.filename}`, {
        method: "DELETE", credentials: "include",
      });
      setEffects((prev) => prev.filter((e) => e.key !== item.key));
    } catch { /* silent */ }
  }

  async function handleDeleteBackground(item: BackgroundsMeta) {
    try {
      await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes/backgrounds/${item.filename}`, {
        method: "DELETE", credentials: "include",
      });
      setBackgrounds((prev) => prev.filter((b) => b.key !== item.key));
    } catch { /* silent */ }
  }

  // ---- rename handlers ----

  // File-based assets (clips, inserts, sound, effects, backgrounds) use asset_labels.json.
  // Saves immediately to local state and debounces the API write by 800ms.
  function handleRenameAsset(key: string, newLabel: string) {
    const next = { ...labels, [key]: newLabel };
    setLabels(next);
    if (labelsSaveTimerRef.current) clearTimeout(labelsSaveTimerRef.current);
    labelsSaveTimerRef.current = setTimeout(() => {
      fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes/labels`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels: next }),
      }).catch(() => {});
    }, 800);
  }

  // Selects store their label in selects.json via PATCH.
  async function handleRenameSelect(selectId: string, newLabel: string) {
    setSelects((prev) => prev.map((s) => s.id === selectId ? { ...s, label: newLabel } : s));
    try {
      await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes/selects/${selectId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel }),
      });
    } catch { /* silent */ }
  }

  // ---- delete confirmation ----

  function confirmDelete(displayName: string, onConfirm: () => void) {
    setPendingDelete({ label: displayName, onConfirm });
  }

  // ---- upload insert ----

  const handleUploadInsert = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const effectiveType = ALLOWED_IMAGE_TYPES.includes(file.type) ? file.type
      : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "png" ? "image/png"
      : ext === "webp" ? "image/webp"
      : file.type;

    if (!ALLOWED_IMAGE_TYPES.includes(effectiveType)) {
      setInsertUploadError("Only .jpg, .png, and .webp images are supported.");
      return;
    }

    setInsertUploading(true);
    setInsertUploadProgress(0);
    setInsertUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    acquireWakeLock().then((releaseWakeLock) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setInsertUploadProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        releaseWakeLock();
        setInsertUploading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          fetchClips();
          setActiveTab("inserts");
          onAssetsChanged?.();
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            setInsertUploadError(err.detail || "Upload failed");
          } catch {
            setInsertUploadError("Upload failed");
          }
        }
      };
      xhr.onerror = () => { releaseWakeLock(); setInsertUploading(false); setInsertUploadError("Upload failed"); };
      xhr.open("POST", `${API_URL}/api/documentary/projects/${projectId}/rushes/inserts/upload`);
      xhr.withCredentials = true;
      xhr.send(formData);
    });
  }, [projectId, fetchClips]);

  // ---- upload sound / effects / backgrounds ----

  function makeAudioUploadHandler(
    endpoint: string,
    setUploading: (v: boolean) => void,
    setProgress: (v: number) => void,
    setError: (v: string | null) => void,
    tab: ActiveTab,
  ) {
    return (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      const ALLOWED = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac", "audio/x-m4a", "audio/mp4", "audio/flac", "audio/x-aiff", "audio/aiff"];
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const effectiveType = ALLOWED.includes(file.type) ? file.type
        : ext === "mp3" ? "audio/mpeg"
        : ext === "wav" ? "audio/wav"
        : ext === "aac" ? "audio/aac"
        : ext === "m4a" ? "audio/x-m4a"
        : ext === "flac" ? "audio/flac"
        : ext === "aiff" || ext === "aif" ? "audio/aiff"
        : file.type;
      if (!ALLOWED.includes(effectiveType)) {
        setError("Only .mp3, .wav, .aac, .m4a, .flac, and .aiff files are supported.");
        return;
      }
      setUploading(true);
      setProgress(0);
      setError(null);
      const formData = new FormData();
      formData.append("file", file);
      acquireWakeLock().then((releaseWakeLock) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => {
          releaseWakeLock();
          setUploading(false);
          if (xhr.status >= 200 && xhr.status < 300) {
            fetchClips();
            setActiveTab(tab);
            onAssetsChanged?.();
          } else {
            try { setError(JSON.parse(xhr.responseText).detail || "Upload failed"); }
            catch { setError("Upload failed"); }
          }
        };
        xhr.onerror = () => { releaseWakeLock(); setUploading(false); setError("Upload failed"); };
        xhr.open("POST", `${API_URL}${endpoint}`);
        xhr.withCredentials = true;
        xhr.send(formData);
      });
    };
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleUploadSound = useCallback(makeAudioUploadHandler(
    `/api/documentary/projects/${projectId}/rushes/sound/upload`,
    setSoundUploading, setSoundUploadProgress, setSoundUploadError, "sound",
  ), [projectId, fetchClips]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleUploadEffects = useCallback(makeAudioUploadHandler(
    `/api/documentary/projects/${projectId}/rushes/effects/upload`,
    setEffectsUploading, setEffectsUploadProgress, setEffectsUploadError, "effects",
  ), [projectId, fetchClips]);

  const handleUploadBackgrounds = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const ALLOWED = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"];
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const effectiveType = ALLOWED.includes(file.type) ? file.type
      : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "png" ? "image/png"
      : ext === "webp" ? "image/webp"
      : ext === "mp4" ? "video/mp4"
      : ext === "mov" ? "video/quicktime"
      : file.type;
    if (!ALLOWED.includes(effectiveType)) {
      setBackgroundsUploadError("Only .jpg, .png, .webp, .mp4, and .mov files are supported.");
      return;
    }
    setBackgroundsUploading(true);
    setBackgroundsUploadProgress(0);
    setBackgroundsUploadError(null);
    const formData = new FormData();
    formData.append("file", file);
    acquireWakeLock().then((releaseWakeLock) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setBackgroundsUploadProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        releaseWakeLock();
        setBackgroundsUploading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          fetchClips();
          setActiveTab("backgrounds");
          onAssetsChanged?.();
        } else {
          try { setBackgroundsUploadError(JSON.parse(xhr.responseText).detail || "Upload failed"); }
          catch { setBackgroundsUploadError("Upload failed"); }
        }
      };
      xhr.onerror = () => { releaseWakeLock(); setBackgroundsUploading(false); setBackgroundsUploadError("Upload failed"); };
      xhr.open("POST", `${API_URL}/api/documentary/projects/${projectId}/rushes/backgrounds/upload`);
      xhr.withCredentials = true;
      xhr.send(formData);
    });
  }, [projectId, fetchClips]);

  // ---- derived values ----

  const hasSection = inPoint !== null && outPoint !== null;
  const regionDuration = hasSection ? outPoint! - inPoint! : 0;
  const playheadPct = videoDuration > 0 ? (playheadTime / videoDuration) * 100 : 0;

  // Derived audio state from peaks map
  const peaksFilename = currentClip?.filename ?? currentSelect?.source_filename;
  const currentPeaksEntry = peaksFilename ? audioPeaks[peaksFilename] : undefined;
  const isAudioProcessing = currentPeaksEntry === "processing";

  const inPct = videoDuration > 0 && inPoint !== null ? (inPoint / videoDuration) * 100 : 0;
  const outPct = videoDuration > 0 && outPoint !== null ? (outPoint / videoDuration) * 100 : 0;
  const placePct = videoDuration > 0 && placePoint !== null ? (placePoint / videoDuration) * 100 : 0;

  const modeButtonClass = (mode: TimelineMode) =>
    `gap-1.5 h-7 text-xs border transition-colors ${
      timelineMode === mode
        ? "border-primary text-primary bg-primary/10 hover:bg-primary/20"
        : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
    }`;

  // Crosshair only when in a mode, video loaded, and not playing a select
  const barCursor = timelineMode && videoDuration > 0 && !currentSelect ? "cursor-crosshair" : "cursor-default";

  let hintText: string | null = null;
  if (!currentSelect) {
    if (timelineMode === "section") {
      if (sectionStep === 0) hintText = "Click the bar to set section start";
      else if (sectionStep === 1) hintText = "Click the bar to set section end";
    } else if (timelineMode === "place" && placePoint === null) {
      hintText = "Click the bar to drop a placement marker";
    }
  }

  const hasCurrentItem = currentClip !== null || currentSelect !== null || currentInsert !== null;
  const hasPlayableItem = hasCurrentItem || !!(externalPreview && !externalPreview.isImage);

  // Redraw waveform canvas whenever peaks or overlay positions change.
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !waveformSamples || !videoDuration) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const mid = h / 2;
    const n = waveformSamples.length;
    const barW = w / n;

    // Section highlight
    if (inPoint !== null && outPoint !== null) {
      ctx.fillStyle = "rgba(74,222,128,0.12)";
      ctx.fillRect(
        (inPoint / videoDuration) * w,
        0,
        ((outPoint - inPoint) / videoDuration) * w,
        h,
      );
    }

    // Waveform bars — brighter inside the section
    for (let i = 0; i < n; i++) {
      const t = (i / n) * videoDuration;
      const inSection = inPoint !== null && outPoint !== null && t >= inPoint && t <= outPoint;
      const bh = Math.max(1, waveformSamples[i] * h * 0.85);
      ctx.fillStyle = inSection ? "#4ade80" : "rgba(74,222,128,0.38)";
      ctx.fillRect(i * barW, mid - bh / 2, Math.max(0.5, barW - 0.5), bh);
    }

    // In-point marker (green)
    if (inPoint !== null) {
      ctx.strokeStyle = "#4ade80";
      ctx.lineWidth = 2;
      const x = (inPoint / videoDuration) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    // Out-point marker (red)
    if (outPoint !== null) {
      ctx.strokeStyle = "#f87171";
      ctx.lineWidth = 2;
      const x = (outPoint / videoDuration) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    // Playhead
    const px = (playheadTime / videoDuration) * w;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  }, [waveformSamples, playheadTime, videoDuration, inPoint, outPoint]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      {pendingDelete && (
        <ConfirmDeleteDialog
          itemName={pendingDelete.label}
          onConfirm={() => { pendingDelete.onConfirm(); setPendingDelete(null); }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border flex-shrink-0">
        <Film className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm text-foreground font-medium">Studio</span>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {clips.length} clips · {selects.length} selects · {inserts.length} inserts
        </span>

        {uploadError && <span className="text-red-400 text-xs ml-2">{uploadError}</span>}
        {insertUploadError && <span className="text-red-400 text-xs ml-2">{insertUploadError}</span>}

        {(uploading || insertUploading) && (
          <div className="flex items-center gap-2 ml-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${uploading ? uploadProgress : insertUploadProgress}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {uploading ? uploadProgress : insertUploadProgress}%
            </span>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.mov,video/mp4,video/quicktime"
          className="hidden"
          onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }}
        />
        <input
          ref={insertInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => { handleUploadInsert(e.target.files); e.target.value = ""; }}
        />
        <input
          ref={soundInputRef}
          type="file"
          accept=".mp3,.wav,.aac,.m4a,.flac,.aiff,.aif,audio/*"
          className="hidden"
          onChange={(e) => { handleUploadSound(e.target.files); e.target.value = ""; }}
        />
        <input
          ref={effectsInputRef}
          type="file"
          accept=".mp3,.wav,.aac,.m4a,.flac,.aiff,.aif,audio/*"
          className="hidden"
          onChange={(e) => { handleUploadEffects(e.target.files); e.target.value = ""; }}
        />
        <input
          ref={backgroundsInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
          className="hidden"
          onChange={(e) => { handleUploadBackgrounds(e.target.files); e.target.value = ""; }}
        />

        <Button
          variant="outline"
          size="sm"
          onClick={
            activeTab === "inserts" ? () => insertInputRef.current?.click()
            : activeTab === "clips" ? () => fileInputRef.current?.click()
            : activeTab === "sound" ? () => soundInputRef.current?.click()
            : activeTab === "effects" ? () => effectsInputRef.current?.click()
            : activeTab === "backgrounds" ? () => backgroundsInputRef.current?.click()
            : undefined
          }
          disabled={
            activeTab === "selects" ||
            (activeTab === "clips" && uploading) ||
            (activeTab === "inserts" && insertUploading) ||
            (activeTab === "sound" && soundUploading) ||
            (activeTab === "effects" && effectsUploading) ||
            (activeTab === "backgrounds" && backgroundsUploading)
          }
          className="ml-auto flex-shrink-0 gap-1.5"
        >
          <Upload className="w-3.5 h-3.5" />
          {activeTab === "inserts" ? (insertUploading ? "Uploading…" : "Upload Insert")
            : activeTab === "clips" ? (uploading ? "Uploading…" : "Upload Clip")
            : activeTab === "sound" ? (soundUploading ? "Uploading…" : "Upload Sound")
            : activeTab === "effects" ? (effectsUploading ? "Uploading…" : "Upload Effect")
            : activeTab === "backgrounds" ? (backgroundsUploading ? "Uploading…" : "Upload Background")
            : "Upload"}
        </Button>
      </div>

      {/* Content row: video+timeline (left) | media sidebar (right) */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

      {/* Left column: video player + timeline */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">

      {/* Main player */}
      <div className="relative flex-1 bg-background flex items-center justify-center overflow-hidden min-h-0">
        {(hasCurrentItem || (externalPreview && externalPreview.url)) ? (
          externalPreview?.isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={externalPreview.url}
              alt="preview"
              className="max-w-full max-h-full object-contain"
            />
          ) : currentInsert ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentInsert.url}
              alt={currentInsert.filename}
              className="max-w-full max-h-full object-contain"
            />
          ) : (
          <>
            <video
              ref={videoRef}
              src={videoSrc}
              controls
              playsInline
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={handleVideoEnded}
              onLoadedMetadata={() => {
                const vid = videoRef.current;
                if (!vid) return;
                setSourceVideoDuration(vid.duration ?? 0);
                if (externalPreview && externalPreview.in_time != null) {
                  vid.currentTime = externalPreview.in_time;
                  setVideoDuration(vid.duration ?? 0);
                } else if (currentSelect) {
                  setVideoDuration(currentSelect.out_time - currentSelect.in_time);
                  vid.currentTime = currentSelect.in_time;
                } else {
                  setVideoDuration(vid.duration ?? 0);
                }
              }}
              onTimeUpdate={() => {
                const vid = videoRef.current;
                if (!vid) return;
                if (currentSelect) {
                  setPlayheadTime(Math.max(0, vid.currentTime - currentSelect.in_time));
                  if (vid.currentTime >= currentSelect.out_time) vid.pause();
                } else {
                  setPlayheadTime(vid.currentTime ?? 0);
                  if (isPlayingSelectionRef.current && outPoint !== null && vid.currentTime >= outPoint) {
                    isPlayingSelectionRef.current = false;
                    vid.pause();
                  }
                }
              }}
              onError={() => {
                const name = currentClip?.filename ?? currentSelect?.source_filename ?? "";
                const ext = name.split(".").pop()?.toLowerCase() ?? "";
                if (ext === "webm" || ext === "mkv") {
                  setVideoError("This browser doesn't support .webm / .mkv. Open in Chrome, or re-upload as .mp4 / .mov.");
                } else {
                  setVideoError("Video failed to load — the file may be corrupted or an unsupported format.");
                }
              }}
              className="w-full h-full object-contain"
            />
            {videoError && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm px-6">
                <div className="text-center space-y-2 max-w-sm">
                  <Film className="w-10 h-10 mx-auto text-muted-foreground opacity-50" />
                  <p className="text-sm text-foreground font-medium">Playback error</p>
                  <p className="text-xs text-muted-foreground">{videoError}</p>
                </div>
              </div>
            )}
          </>
          )
        ) : clipsLoading ? (
          <div className="text-center space-y-3 text-muted-foreground">
            <Loader2 className="w-10 h-10 mx-auto animate-spin opacity-40" />
            <p className="text-sm">Loading clips…</p>
          </div>
        ) : clips.length === 0 ? (
          <div className="text-center space-y-4 text-muted-foreground max-w-sm px-4">
            <Film className="w-16 h-16 mx-auto opacity-30" />
            <p className="text-sm">No footage uploaded yet</p>
            <p className="text-xs">
              Click "Upload Clip" in the toolbar to add your raw footage. Files are stored securely
              in your project on DigitalOcean Spaces.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="gap-1.5"
            >
              <Upload className="w-4 h-4" />
              Upload Clip
            </Button>
          </div>
        ) : (
          <div className="text-center space-y-3 text-muted-foreground select-none">
            <Play className="w-16 h-16 mx-auto opacity-30" />
            <p className="text-sm">Select {emptyStateLabel ?? "a clip"} to play</p>
          </div>
        )}
      </div>

      {/* Timeline section */}
      <div className="flex-shrink-0 bg-card border-t border-border px-4 py-2 space-y-2">

        {/* Controls row — 3-column grid: left info | centre buttons | right actions */}
        <div className="grid grid-cols-3 items-center gap-2">

          {/* LEFT — contextual info */}
          <div className="flex items-center gap-2 text-xs min-w-0">
            {currentInsert ? (
              <>
                <ImageIcon className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <span className="text-foreground truncate">{currentInsert.filename}</span>
              </>
            ) : currentSelect ? (
              <>
                <Bookmark className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <span className="text-foreground truncate">{currentSelect.source_filename}</span>
              </>
            ) : hasSection ? (
              <>
                <span className="font-mono text-foreground">IN {formatTimecode(inPoint!)}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono text-foreground">OUT {formatTimecode(outPoint!)}</span>
                <span className="text-muted-foreground hidden sm:inline">({formatTimecode(regionDuration)})</span>
              </>
            ) : hintText ? (
              <span className="text-muted-foreground italic">{hintText}</span>
            ) : null}
          </div>

          {/* CENTRE — playback + mode buttons (always centred) */}
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePlayPause}
              disabled={!hasPlayableItem}
              className="gap-1.5 h-7 text-xs border-border text-foreground hover:bg-accent"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying
                ? <><Pause className="w-3.5 h-3.5" />Pause</>
                : <><Play className="w-3.5 h-3.5" />Play</>
              }
            </Button>

            {!currentSelect && !currentInsert && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => activateMode("section")}
                  className={modeButtonClass("section")}
                  title="Click to set a section (always resets previous)"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  Section
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => activateMode("place")}
                  className={modeButtonClass("place")}
                  title="Click to drop a placement marker (always resets previous)"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Place
                </Button>
              </>
            )}
          </div>

          {/* RIGHT — save / clear actions */}
          <div className="flex items-center justify-end gap-2 text-xs">
            {currentInsert ? (
              <span className="text-muted-foreground">{formatSize(currentInsert.size)}</span>
            ) : currentSelect ? (
              <>
                <span className="font-mono text-muted-foreground">IN {formatTimecode(currentSelect.in_time)}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono text-muted-foreground">OUT {formatTimecode(currentSelect.out_time)}</span>
                <span className="text-muted-foreground hidden sm:inline">({formatDuration(currentSelect.duration)})</span>
              </>
            ) : hasSection ? (
              <>
                {saveError && <span className="text-red-400">{saveError}</span>}
                <button
                  onClick={() => { setInPoint(null); setOutPoint(null); setSectionStep(0); setSaveError(null); }}
                  className="text-muted-foreground hover:text-foreground"
                  title="Clear section"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <Button
                  size="sm"
                  onClick={handleSaveSelect}
                  disabled={isSaving || !currentClip}
                  className="gap-1.5 h-7 text-xs"
                >
                  {isSaving
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</>
                    : <><Bookmark className="w-3.5 h-3.5" />Save Select</>
                  }
                </Button>
              </>
            ) : placePoint !== null ? (
              <>
                <MapPin className="w-3.5 h-3.5 text-yellow-400" />
                <span className="font-mono text-yellow-400">PLACE {formatTimecode(placePoint)}</span>
                <button
                  onClick={() => setPlacePoint(null)}
                  className="text-muted-foreground hover:text-foreground"
                  title="Clear marker"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : null}
          </div>
        </div>

        {/* Scrubber bar + bridge + audio waveform — grouped so the playhead spans all three */}
        {!currentInsert && (
          <div className="relative flex flex-col">

            {/* Film scrubber bar */}
            <div
              ref={timelineRef}
              onClick={handleBarClick}
              className={`relative w-full h-8 rounded select-none transition-opacity ${barCursor} ${
                videoDuration > 0 ? "bg-muted" : "bg-muted opacity-40 pointer-events-none"
              }`}
            >
              {hasSection && !currentSelect && (
                <div
                  className="absolute top-0 h-full bg-green-400/20 rounded pointer-events-none"
                  style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
                />
              )}

              {inPoint !== null && !currentSelect && (
                <>
                  <div
                    className="absolute top-0 h-full w-0.5 bg-green-400 pointer-events-none"
                    style={{ left: `${inPct}%` }}
                  >
                    <MapPin className="absolute -top-0.5 -left-[5px] w-3 h-3 text-green-400 fill-green-400" />
                  </div>
                  <div
                    className="absolute top-0 h-full w-4 -translate-x-1/2 cursor-ew-resize z-10"
                    style={{ left: `${inPct}%` }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); }}
                    onPointerMove={(e) => {
                      if (e.buttons === 0) return;
                      setInPoint(Math.max(0, Math.min(timeFromBarX(e.clientX), outPoint ?? videoDuration)));
                    }}
                  />
                </>
              )}

              {outPoint !== null && !currentSelect && (
                <>
                  <div
                    className="absolute top-0 h-full w-0.5 bg-red-400 pointer-events-none"
                    style={{ left: `${outPct}%` }}
                  >
                    <MapPin className="absolute -top-0.5 -left-[5px] w-3 h-3 text-red-400 fill-red-400" />
                  </div>
                  <div
                    className="absolute top-0 h-full w-4 -translate-x-1/2 cursor-ew-resize z-10"
                    style={{ left: `${outPct}%` }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); }}
                    onPointerMove={(e) => {
                      if (e.buttons === 0) return;
                      setOutPoint(Math.max(inPoint ?? 0, Math.min(timeFromBarX(e.clientX), videoDuration)));
                    }}
                  />
                </>
              )}

              {placePoint !== null && !currentSelect && (
                <>
                  <div
                    className="absolute top-0 h-full w-0.5 bg-yellow-400 pointer-events-none"
                    style={{ left: `${placePct}%` }}
                  >
                    <MapPin className="absolute -top-0.5 -left-[5px] w-3 h-3 text-yellow-400 fill-yellow-400" />
                  </div>
                  <div
                    className="absolute top-0 h-full w-4 -translate-x-1/2 cursor-ew-resize z-10"
                    style={{ left: `${placePct}%` }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); }}
                    onPointerMove={(e) => {
                      if (e.buttons === 0) return;
                      setPlacePoint(Math.max(0, Math.min(timeFromBarX(e.clientX), videoDuration)));
                    }}
                  />
                </>
              )}

              {/* Playhead line only — label moved to bridge below */}
              {videoDuration > 0 && (
                <div
                  className="absolute top-0 h-full w-0.5 bg-foreground/70 pointer-events-none"
                  style={{ left: `${playheadPct}%` }}
                />
              )}

              {videoDuration > 0 && (
                <>
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-mono pointer-events-none">
                    {formatTimecode(0)}
                  </span>
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-mono pointer-events-none">
                    {formatTimecode(videoDuration)}
                  </span>
                </>
              )}

              {!videoDuration && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                  {(externalPreview && !externalPreview.isImage) || currentClip
                    ? "Loading…"
                    : "Play a clip to use the timeline"}
                </span>
              )}
            </div>

            {/* Play Selection — appears when in/out section is set on a clip */}
            {hasSection && !currentSelect && videoDuration > 0 && (
              <div className="flex items-center justify-center py-0.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePlaySelection}
                  className="gap-1.5 h-6 text-[10px] border-border text-foreground hover:bg-accent"
                >
                  <Play className="w-3 h-3" />
                  Play Selection
                </Button>
              </div>
            )}

            {/* Bridge: position label only — the connector line is the wrapper-level overlay below */}
            <div className="relative h-5 flex-shrink-0 pointer-events-none">
              {videoDuration > 0 && (
                <>
                  <span
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[9px] font-mono text-foreground bg-card px-1 rounded whitespace-nowrap shadow-sm z-20"
                    style={{ left: `${playheadPct}%` }}
                  >
                    {formatTimecode(playheadTime)}
                  </span>
                </>
              )}
            </div>

            {/* Audio waveform */}
            <div className="relative w-full h-8 rounded overflow-hidden bg-muted/40">
              {/* Canvas always mounted so the drawing effect finds it immediately after peaks load */}
              <canvas
                ref={waveformCanvasRef}
                className={`w-full h-full block ${waveformSamples ? "" : "hidden"}`}
              />
              {!waveformSamples && videoSrc && isAudioProcessing && (
                <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Analysing audio…
                </div>
              )}
              {!waveformSamples && videoSrc && !isAudioProcessing && (
                <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground select-none">
                  No audio data
                </div>
              )}
              {!videoSrc && (
                <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground select-none">
                  Audio
                </div>
              )}
            </div>

            {/* Wrapper-level overlay: single playhead line spanning bridge + audio bar,
                in front of the audio bar canvas (z-10). top-8 = film bar height (h-8 = 32px). */}
            {videoDuration > 0 && (
              <div
                className="absolute top-8 bottom-0 w-0.5 -translate-x-1/2 bg-foreground/70 pointer-events-none z-10"
                style={{ left: `${playheadPct}%` }}
              />
            )}

          </div>
        )}
      </div>

      </div> {/* end left column */}

      </div> {/* end content row */}
    </div>
  );
}


