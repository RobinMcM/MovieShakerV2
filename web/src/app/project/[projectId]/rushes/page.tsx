"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Button } from "@/components/ui/button";
import {
  Film,
  Loader2,
  MapPin,
  Play,
  Scissors,
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

type TimelineMode = "section" | "place" | null;
type SectionStep = 0 | 1 | 2;

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

interface ClipCardProps {
  clip: ClipMeta;
  active: boolean;
  onClick: () => void;
}

function ClipCard({ clip, active, onClick }: ClipCardProps) {
  return (
    <button
      onClick={onClick}
      className={`
        flex-shrink-0 w-44 rounded-lg overflow-hidden text-left transition-all
        border-2 focus:outline-none
        ${active
          ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-black"
          : "border-zinc-700 hover:border-zinc-500"
        }
      `}
    >
      <div className="relative w-full h-24 bg-zinc-800 flex items-center justify-center">
        <Film className="w-8 h-8 text-zinc-600" />
        {active && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <Play className="w-8 h-8 text-white fill-white" />
          </div>
        )}
        {clip.is_extract && (
          <span className="absolute top-1 left-1 bg-primary/80 text-white text-[9px] px-1 rounded font-medium">
            EXTRACT
          </span>
        )}
        <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">
          {formatSize(clip.size)}
        </span>
      </div>
      <div className="px-2 py-1 bg-zinc-900">
        <p className="text-xs text-zinc-200 truncate leading-tight">{clip.filename}</p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// RushesViewer
// ---------------------------------------------------------------------------

function RushesViewer({ projectId }: { projectId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- clip state ---
  const [clips, setClips] = useState<ClipMeta[]>([]);
  const [clipsLoading, setClipsLoading] = useState(true);
  const [currentClip, setCurrentClip] = useState<ClipMeta | null>(null);

  // --- upload state ---
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // --- timeline state ---
  const [playheadTime, setPlayheadTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>(null);
  const [sectionStep, setSectionStep] = useState<SectionStep>(0);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);
  const [placePoint, setPlacePoint] = useState<number | null>(null);

  // --- extraction state ---
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractCount, setExtractCount] = useState<Record<string, number>>({});

  // ---- fetch clips ----

  const fetchClips = useCallback(async () => {
    setClipsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load clips");
      const data = await res.json() as { clips: ClipMeta[] };
      setClips(data.clips);
    } catch {
      setClips([]);
    } finally {
      setClipsLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchClips(); }, [fetchClips]);

  // Reset timeline when clip changes
  useEffect(() => {
    setInPoint(null);
    setOutPoint(null);
    setPlacePoint(null);
    setSectionStep(0);
    setPlayheadTime(0);
    setVideoDuration(0);
    setExtractError(null);
  }, [currentClip?.key]);

  // ---- upload ----

  const handleUpload = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
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
    xhr.onerror = () => { setUploading(false); setUploadError("Upload failed"); };
    xhr.open("POST", `${API_URL}/api/documentary/projects/${projectId}/rushes/upload`);
    xhr.withCredentials = true;
    xhr.send(formData);
  }, [projectId, fetchClips]);

  // ---- mode buttons ----

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

  // ---- bar click / marker drag ----

  function timeFromBarX(clientX: number): number {
    const el = timelineRef.current;
    if (!el || !videoDuration) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * videoDuration;
  }

  function handleBarClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!videoDuration) return;
    const t = timeFromBarX(e.clientX);
    if (timelineMode === "section") {
      if (sectionStep === 0) {
        setInPoint(t); setOutPoint(null); setSectionStep(1);
      } else if (sectionStep === 1) {
        const newIn = Math.min(inPoint!, t);
        const newOut = Math.max(inPoint!, t);
        setInPoint(newIn); setOutPoint(newOut); setSectionStep(2);
      }
    } else if (timelineMode === "place") {
      setPlacePoint(t);
    }
  }

  // ---- extract ----

  async function handleExtract() {
    if (!currentClip || inPoint === null || outPoint === null) return;
    setIsExtracting(true);
    setExtractError(null);
    try {
      const dotIdx = currentClip.filename.lastIndexOf(".");
      const base = dotIdx > 0 ? currentClip.filename.slice(0, dotIdx) : currentClip.filename;
      const ext = dotIdx > 0 ? currentClip.filename.slice(dotIdx + 1) : "mp4";
      const count = (extractCount[base] ?? 0) + 1;
      const outputFilename = `${base}-${String(count).padStart(3, "0")}.${ext}`;

      const res = await fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes/extract`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_key: currentClip.key,
          in_time: inPoint,
          out_time: outPoint,
          output_filename: outputFilename,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error((err as { detail?: string }).detail || "Extraction failed");
      }
      const result = await res.json() as { key: string; url: string };
      setExtractCount((prev) => ({ ...prev, [base]: count }));
      await fetchClips();
      // Auto-select the extracted clip
      if (result.url) {
        setCurrentClip({ filename: outputFilename, key: result.key, size: 0, url: result.url, last_modified: "", is_extract: true });
      }
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setIsExtracting(false);
    }
  }

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
        : "border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
    }`;

  const barCursor = timelineMode && videoDuration > 0 ? "cursor-crosshair" : "cursor-default";

  let hintText: string | null = null;
  if (timelineMode === "section") {
    if (sectionStep === 0) hintText = "Click the bar to set section start";
    else if (sectionStep === 1) hintText = "Click the bar to set section end";
  } else if (timelineMode === "place") {
    if (placePoint === null) hintText = "Click the bar to drop a placement marker";
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-screen bg-black text-white overflow-hidden">
      <AppHeader />

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 flex-shrink-0">
        <Film className="w-4 h-4 text-zinc-400 flex-shrink-0" />
        <span className="text-sm text-zinc-300 font-medium">Rushes</span>
        <span className="text-xs text-zinc-600 flex-shrink-0">{clips.length} clips</span>

        {uploadError && <span className="text-red-400 text-xs ml-2">{uploadError}</span>}

        {uploading && (
          <div className="flex items-center gap-2 ml-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
            <div className="w-32 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <span className="text-xs text-zinc-400">{uploadProgress}%</span>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,audio/*"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="ml-auto flex-shrink-0 gap-1.5 border-zinc-700 text-zinc-300 hover:text-white"
        >
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "Uploading…" : "Upload Clip"}
        </Button>
      </div>

      {/* Main player */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden min-h-0">
        {currentClip ? (
          <>
            <video
              ref={videoRef}
              src={currentClip.url}
              controls
              onTimeUpdate={() => setPlayheadTime(videoRef.current?.currentTime ?? 0)}
              onLoadedMetadata={() => setVideoDuration(videoRef.current?.duration ?? 0)}
              className="w-full h-full object-contain"
            />
            <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
              {currentClip.filename}
            </div>
          </>
        ) : clipsLoading ? (
          <div className="text-center space-y-3 text-zinc-600">
            <Loader2 className="w-10 h-10 mx-auto animate-spin opacity-40" />
            <p className="text-sm">Loading clips…</p>
          </div>
        ) : clips.length === 0 ? (
          <div className="text-center space-y-4 text-zinc-600 max-w-sm px-4">
            <Film className="w-16 h-16 mx-auto opacity-30" />
            <p className="text-sm text-zinc-400">No footage uploaded yet</p>
            <p className="text-xs text-zinc-600">Click "Upload Clip" in the toolbar to add your raw footage. Files are stored securely in your project on DigitalOcean Spaces.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="gap-1.5 border-zinc-600"
            >
              <Upload className="w-4 h-4" />
              Upload Clip
            </Button>
          </div>
        ) : (
          <div className="text-center space-y-3 text-zinc-600 select-none">
            <Play className="w-16 h-16 mx-auto opacity-30" />
            <p className="text-sm">Select a clip below to play</p>
          </div>
        )}
      </div>

      {/* Timeline section */}
      <div className="flex-shrink-0 bg-zinc-950 border-t border-zinc-800 px-4 py-2 space-y-2">

        {/* Mode buttons + status row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => activateMode("section")}
            className={modeButtonClass("section")}
            title="Click to set a section"
          >
            <Scissors className="w-3.5 h-3.5" />
            Section
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => activateMode("place")}
            className={modeButtonClass("place")}
            title="Click to drop a placement marker"
          >
            <MapPin className="w-3.5 h-3.5" />
            Place
          </Button>

          {hintText && (
            <span className="text-xs text-zinc-500 italic ml-1">{hintText}</span>
          )}

          {hasSection && (
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <span className="font-mono text-xs text-zinc-300">IN {formatTimecode(inPoint!)}</span>
              <span className="text-zinc-600 text-xs">→</span>
              <span className="font-mono text-xs text-zinc-300">OUT {formatTimecode(outPoint!)}</span>
              <span className="text-zinc-500 text-xs">({formatTimecode(regionDuration)})</span>
              <button
                onClick={() => { setInPoint(null); setOutPoint(null); setSectionStep(0); setExtractError(null); }}
                className="text-zinc-500 hover:text-zinc-300"
                title="Clear section"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              {extractError && <span className="text-red-400 text-xs">{extractError}</span>}
              <Button
                size="sm"
                onClick={handleExtract}
                disabled={isExtracting}
                className="gap-1.5 h-7 text-xs"
              >
                {isExtracting
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Extracting…</>
                  : <><Scissors className="w-3.5 h-3.5" />Extract Clip</>
                }
              </Button>
            </div>
          )}

          {placePoint !== null && !hasSection && (
            <div className="flex items-center gap-2 ml-auto">
              <MapPin className="w-3.5 h-3.5 text-yellow-400" />
              <span className="font-mono text-xs text-yellow-300">PLACE {formatTimecode(placePoint)}</span>
              <button onClick={() => setPlacePoint(null)} className="text-zinc-500 hover:text-zinc-300" title="Clear marker">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Scrubber bar */}
        <div
          ref={timelineRef}
          onClick={handleBarClick}
          className={`relative w-full h-8 rounded select-none transition-opacity ${barCursor} ${
            videoDuration > 0 ? "bg-zinc-800" : "bg-zinc-900 opacity-40 pointer-events-none"
          }`}
        >
          {hasSection && (
            <div
              className="absolute top-0 h-full bg-primary/40 rounded pointer-events-none"
              style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
            />
          )}

          {inPoint !== null && (
            <>
              <div className="absolute top-0 h-full w-0.5 bg-primary pointer-events-none" style={{ left: `${inPct}%` }} />
              <div
                className="absolute top-0 h-full w-4 -translate-x-1/2 cursor-ew-resize z-10"
                style={{ left: `${inPct}%` }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); }}
                onPointerMove={(e) => { if (e.buttons === 0) return; setInPoint(Math.max(0, Math.min(timeFromBarX(e.clientX), outPoint ?? videoDuration))); }}
              />
            </>
          )}

          {outPoint !== null && (
            <>
              <div className="absolute top-0 h-full w-0.5 bg-primary pointer-events-none" style={{ left: `${outPct}%` }} />
              <div
                className="absolute top-0 h-full w-4 -translate-x-1/2 cursor-ew-resize z-10"
                style={{ left: `${outPct}%` }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); }}
                onPointerMove={(e) => { if (e.buttons === 0) return; setOutPoint(Math.max(inPoint ?? 0, Math.min(timeFromBarX(e.clientX), videoDuration))); }}
              />
            </>
          )}

          {placePoint !== null && (
            <>
              <div className="absolute top-0 h-full w-0.5 bg-yellow-400 pointer-events-none" style={{ left: `${placePct}%` }}>
                <MapPin className="absolute -top-0.5 -left-[5px] w-3 h-3 text-yellow-400 fill-yellow-400" />
              </div>
              <div
                className="absolute top-0 h-full w-4 -translate-x-1/2 cursor-ew-resize z-10"
                style={{ left: `${placePct}%` }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); }}
                onPointerMove={(e) => { if (e.buttons === 0) return; setPlacePoint(Math.max(0, Math.min(timeFromBarX(e.clientX), videoDuration))); }}
              />
            </>
          )}

          {videoDuration > 0 && (
            <div className="absolute top-0 h-full w-0.5 bg-white/70 pointer-events-none" style={{ left: `${playheadPct}%` }} />
          )}

          {videoDuration > 0 && (
            <>
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 font-mono pointer-events-none">{formatTimecode(0)}</span>
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 font-mono pointer-events-none">{formatTimecode(videoDuration)}</span>
            </>
          )}

          {!videoDuration && (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-600">
              Play a clip to use the timeline
            </span>
          )}
        </div>
      </div>

      {/* Clip strip */}
      <div className="flex-shrink-0 bg-zinc-950 border-t border-zinc-800">
        <div className="flex gap-2 p-3 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
          {clips.map((clip) => (
            <ClipCard
              key={clip.key}
              clip={clip}
              active={currentClip?.key === clip.key}
              onClick={() => setCurrentClip(clip)}
            />
          ))}
          {clips.length === 0 && !clipsLoading && (
            <p className="text-xs text-zinc-600 self-center px-2">No clips yet — upload footage above</p>
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
