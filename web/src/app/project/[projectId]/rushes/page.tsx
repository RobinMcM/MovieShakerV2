"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Button } from "@/components/ui/button";
import {
  Bookmark,
  Film,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Pause,
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

interface InsertMeta {
  filename: string;
  key: string;
  size: number;
  url: string;
  last_modified: string;
}

type TimelineMode = "section" | "place" | null;
type SectionStep = 0 | 1 | 2;
type ActiveTab = "clips" | "selects" | "inserts";

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
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function ClipCard({ clip, active, onClick, onDelete }: ClipCardProps) {
  return (
    <div className={`
      flex-shrink-0 w-44 rounded-lg overflow-hidden text-left transition-all border-2
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
          <span className="absolute bottom-1 right-1 bg-background/70 text-foreground text-[10px] px-1 rounded">
            {formatSize(clip.size)}
          </span>
        </div>
        <div className="px-2 pt-1 pb-0.5 bg-card">
          <p className="text-xs text-foreground truncate leading-tight">{clip.filename}</p>
        </div>
      </button>
      <div className="bg-card border-t border-border flex justify-end px-1.5 pb-1.5 pt-0.5">
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-muted-foreground hover:text-red-400 transition-colors"
          title="Delete clip"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
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
  sourceUrl?: string;
}

function SelectCard({ select, active, onClick, onDelete, sourceUrl }: SelectCardProps) {
  return (
    <div className={`
      flex-shrink-0 w-44 rounded-lg overflow-hidden text-left transition-all border-2
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
          <span className="absolute bottom-1 right-1 bg-background/70 text-foreground text-[10px] px-1 rounded">
            {formatDuration(select.duration)}
          </span>
        </div>
        <div className="px-2 pt-1 pb-0.5 bg-card text-left">
          <p className="text-xs text-foreground truncate leading-tight">{select.source_filename}</p>
          <p className="text-[10px] text-muted-foreground font-mono">
            {formatTimecode(select.in_time)} → {formatTimecode(select.out_time)}
          </p>
        </div>
      </button>
      <div className="bg-card border-t border-border flex justify-end px-1.5 pb-1.5 pt-0.5">
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-muted-foreground hover:text-red-400 transition-colors"
          title="Delete select"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InsertCard
// ---------------------------------------------------------------------------

interface InsertCardProps {
  insert: InsertMeta;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function InsertCard({ insert, active, onClick, onDelete }: InsertCardProps) {
  return (
    <div className={`
      flex-shrink-0 w-44 rounded-lg overflow-hidden text-left transition-all border-2
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
          <span className="absolute bottom-1 right-1 bg-background/70 text-foreground text-[10px] px-1 rounded">
            {formatSize(insert.size)}
          </span>
        </div>
        <div className="px-2 pt-1 pb-0.5 bg-card">
          <p className="text-xs text-foreground truncate leading-tight">{insert.filename}</p>
        </div>
      </button>
      <div className="bg-card border-t border-border flex justify-end px-1.5 pb-1.5 pt-0.5">
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-muted-foreground hover:text-red-400 transition-colors"
          title="Delete insert"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RushesViewer
// ---------------------------------------------------------------------------

function RushesViewer({ projectId }: { projectId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const insertInputRef = useRef<HTMLInputElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

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
  const [waveformLoading, setWaveformLoading] = useState(false);

  // save select state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // video error state (format not supported, CORS failure, etc.)
  const [videoError, setVideoError] = useState<string | null>(null);

  // playback state — kept in sync via onPlay / onPause events
  const [isPlaying, setIsPlaying] = useState(false);

  // Stable ID for the active item — changes whenever the playing item changes.
  // Drives the load+play effect (same pattern as film-in-a-box's currentUrl effect).
  const videoId = currentClip?.key ?? (currentSelect ? `select:${currentSelect.id}` : "");
  const videoSrc = currentClip?.url ?? currentSelect?.source_url ?? "";

  // ---- fetch ----

  const fetchClips = useCallback(async () => {
    setClipsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load clips");
      const data = await res.json() as { clips: ClipMeta[]; selects: SelectMeta[]; inserts: InsertMeta[] };
      setClips(data.clips);
      setSelects(data.selects || []);
      setInserts(data.inserts || []);
    } catch {
      setClips([]);
      setSelects([]);
      setInserts([]);
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
    setSaveError(null);
    setVideoError(null);
    setIsPlaying(false);
    if (!vid || !videoId) return;
    vid.load();
  }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch and decode audio whenever the video source changes to build a static waveform.
  useEffect(() => {
    setWaveformSamples(null);
    if (!videoSrc) { setWaveformLoading(false); return; }
    setWaveformLoading(true);
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(videoSrc, { signal: controller.signal });
        const buf = await res.arrayBuffer();
        if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
          audioCtxRef.current = new AudioContext();
        }
        const audio = await audioCtxRef.current.decodeAudioData(buf);
        const channel = audio.getChannelData(0);
        const NUM_BARS = 400;
        const blockSize = Math.floor(channel.length / NUM_BARS);
        const peaks = new Float32Array(NUM_BARS);
        for (let i = 0; i < NUM_BARS; i++) {
          let max = 0;
          for (let j = 0; j < blockSize; j++) {
            const v = Math.abs(channel[i * blockSize + j]);
            if (v > max) max = v;
          }
          peaks[i] = max;
        }
        setWaveformSamples(peaks);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setWaveformSamples(null);
        }
      } finally {
        setWaveformLoading(false);
      }
    })();
    return () => controller.abort();
  }, [videoSrc]);

  // ---- play actions ----

  const playClip = useCallback((clip: ClipMeta) => {
    setCurrentClip(clip);
    setCurrentSelect(null);
    setCurrentInsert(null);
  }, []);

  const playSelect = useCallback((select: SelectMeta) => {
    setCurrentSelect(select);
    setCurrentClip(null);
    setCurrentInsert(null);
  }, []);

  const playInsert = useCallback((ins: InsertMeta) => {
    setCurrentInsert(ins);
    setCurrentClip(null);
    setCurrentSelect(null);
  }, []);

  // Auto-advance to next clip on video end (mirrors film-in-a-box handleVideoEnded)
  const handleVideoEnded = useCallback(() => {
    if (!currentClip || clips.length === 0) return;
    const idx = clips.findIndex((c) => c.key === currentClip.key);
    if (idx >= 0 && idx < clips.length - 1) playClip(clips[idx + 1]);
  }, [currentClip, clips, playClip]);

  const handlePlayPause = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) vid.play().catch(() => {});
    else vid.pause();
  }, []);

  // ---- upload ----

  // Prevent the screen from sleeping while a large file is in flight.
  // Returns a release function; safe to call even if Wake Lock is unsupported.
  async function acquireWakeLock(): Promise<() => void> {
    try {
      if ("wakeLock" in navigator) {
        const sentinel = await navigator.wakeLock.request("screen");
        return () => sentinel.release().catch(() => {});
      }
    } catch {
      // Wake Lock denied or unavailable — continue without it
    }
    return () => {};
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

    const formData = new FormData();
    formData.append("file", file);

    acquireWakeLock().then((releaseWakeLock) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        releaseWakeLock();
        setUploading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          fetchClips();
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            setUploadError(err.detail || "Upload failed");
          } catch {
            setUploadError("Upload failed");
          }
        }
      };
      xhr.onerror = () => { releaseWakeLock(); setUploading(false); setUploadError("Upload failed"); };
      xhr.open("POST", `${API_URL}/api/documentary/projects/${projectId}/rushes/upload`);
      xhr.withCredentials = true;
      xhr.send(formData);
    });
  }, [projectId, fetchClips]);

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

  // ---- derived values ----

  const hasSection = inPoint !== null && outPoint !== null;
  const regionDuration = hasSection ? outPoint! - inPoint! : 0;
  const playheadPct = videoDuration > 0 ? (playheadTime / videoDuration) * 100 : 0;
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
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <AppHeader />

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

        {activeTab === "inserts" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => insertInputRef.current?.click()}
            disabled={insertUploading}
            className="ml-auto flex-shrink-0 gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            {insertUploading ? "Uploading…" : "Upload Insert"}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="ml-auto flex-shrink-0 gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            {uploading ? "Uploading…" : "Upload Clip"}
          </Button>
        )}
      </div>

      {/* Main player */}
      <div className="relative flex-1 bg-background flex items-center justify-center overflow-hidden min-h-0">
        {hasCurrentItem ? (
          currentInsert ? (
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
                if (currentSelect) {
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
            <p className="text-sm">Select a clip below to play</p>
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
              disabled={!hasCurrentItem}
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

        {/* Scrubber bar */}
        {!currentInsert && <div
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

          {videoDuration > 0 && (
            <div
              className="absolute top-0 h-full pointer-events-none"
              style={{ left: `${playheadPct}%` }}
            >
              <div className="absolute top-0 h-full w-0.5 bg-foreground/70" />
              <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[9px] font-mono text-foreground bg-background/80 px-1 rounded whitespace-nowrap shadow-sm">
                {formatTimecode(playheadTime)}
              </span>
            </div>
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
              Play a clip to use the timeline
            </span>
          )}
        </div>}

        {/* Audio waveform */}
        {!currentInsert && (
          <div className="relative w-full h-14 rounded overflow-hidden bg-muted/40">
            <canvas ref={waveformCanvasRef} className="w-full h-full block" />
            {videoSrc && waveformLoading && (
              <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Analysing audio…
              </div>
            )}
            {!videoSrc && (
              <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground select-none">
                Audio
              </div>
            )}
          </div>
        )}
      </div>

      {/* Clip / Select strip */}
      <div className="flex-shrink-0 bg-card border-t border-border">
        {/* Tabs */}
        <div className="flex gap-0 border-b border-border px-3 pt-2">
          <button
            onClick={() => setActiveTab("clips")}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              activeTab === "clips"
                ? "text-foreground border-b-2 border-primary -mb-px"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Clips ({clips.length})
          </button>
          <button
            onClick={() => setActiveTab("selects")}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              activeTab === "selects"
                ? "text-foreground border-b-2 border-primary -mb-px"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Selects ({selects.length})
          </button>
          <button
            onClick={() => setActiveTab("inserts")}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              activeTab === "inserts"
                ? "text-foreground border-b-2 border-primary -mb-px"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Inserts ({inserts.length})
          </button>
        </div>

        {/* Strip content */}
        <div className="flex gap-2 p-3 overflow-x-auto overflow-y-hidden h-40 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          {activeTab === "clips" && (
            <>
              {clips.map((clip) => (
                <ClipCard
                  key={clip.key}
                  clip={clip}
                  active={currentClip?.key === clip.key}
                  onClick={() => playClip(clip)}
                  onDelete={() => handleDeleteClip(clip)}
                />
              ))}
              {clips.length === 0 && !clipsLoading && (
                <p className="text-xs text-muted-foreground self-center px-2">
                  No clips yet — upload footage above
                </p>
              )}
            </>
          )}

          {activeTab === "selects" && (
            <>
              {selects.map((sel) => (
                <SelectCard
                  key={sel.id}
                  select={sel}
                  active={currentSelect?.id === sel.id}
                  onClick={() => playSelect(sel)}
                  onDelete={() => handleDeleteSelect(sel.id)}
                  sourceUrl={clipUrlMap.get(sel.source_key)}
                />
              ))}
              {selects.length === 0 && (
                <div className="text-xs text-muted-foreground self-center px-2 space-y-1">
                  <p>No selects yet</p>
                  <p className="opacity-60">Play a clip, set a Section, then click "Save Select"</p>
                </div>
              )}
            </>
          )}

          {activeTab === "inserts" && (
            <>
              {inserts.map((ins) => (
                <InsertCard
                  key={ins.key}
                  insert={ins}
                  active={currentInsert?.key === ins.key}
                  onClick={() => playInsert(ins)}
                  onDelete={() => handleDeleteInsert(ins)}
                />
              ))}
              {inserts.length === 0 && (
                <div className="text-xs text-muted-foreground self-center px-2 space-y-1">
                  <p>No inserts yet</p>
                  <p className="opacity-60">Click "Upload Insert" to add reference images</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export
// ---------------------------------------------------------------------------

export default function RushesPage() {
  const params = useParams();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId as string;

  return (
    <SessionAuth>
      <RushesViewer projectId={projectId} />
    </SessionAuth>
  );
}
