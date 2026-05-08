"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Film, FolderOpen, Loader2, MapPin, Play, Scissors, X } from "lucide-react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import {
  supportsLocalDirectory,
  saveDirectoryHandle,
  loadDirectoryHandle,
  listMediaFiles,
  verifyPermission,
  writeBinaryFileToDirectory,
  type LocalFile,
} from "@/lib/localFileStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TimelineMode = "section" | "place" | null;
type SectionStep = 0 | 1 | 2; // 0=nothing, 1=start set, 2=complete

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

// ---------------------------------------------------------------------------
// Thumbnail generation (canvas capture at 0.5 s)
// ---------------------------------------------------------------------------

async function captureFrame(clip: LocalFile): Promise<string | null> {
  try {
    const file = await clip.handle.getFile();
    const url = URL.createObjectURL(file);
    return await new Promise<string | null>((resolve) => {
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "metadata";
      video.src = url;
      const cleanup = () => URL.revokeObjectURL(url);
      video.onerror = () => { cleanup(); resolve(null); };
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(0.5, video.duration * 0.1);
      };
      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 90;
          const ctx = canvas.getContext("2d");
          if (!ctx) { cleanup(); resolve(null); return; }
          ctx.drawImage(video, 0, 0, 160, 90);
          cleanup();
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        } catch {
          cleanup();
          resolve(null);
        }
      };
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Clip duration (read from hidden video element)
// ---------------------------------------------------------------------------

async function readDuration(clip: LocalFile): Promise<number> {
  try {
    const file = await clip.handle.getFile();
    const url = URL.createObjectURL(file);
    return await new Promise<number>((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.src = url;
      video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration); };
      video.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    });
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// ClipCard
// ---------------------------------------------------------------------------

interface ClipCardProps {
  clip: LocalFile;
  active: boolean;
  thumbnail: string | null;
  duration: number;
  onClick: () => void;
}

function ClipCard({ clip, active, thumbnail, duration, onClick }: ClipCardProps) {
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
        {thumbnail ? (
          <img src={thumbnail} alt={clip.name} className="w-full h-full object-cover" />
        ) : (
          <Film className="w-8 h-8 text-zinc-600" />
        )}
        {active && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <Play className="w-8 h-8 text-white fill-white" />
          </div>
        )}
        <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">
          {formatDuration(duration)}
        </span>
      </div>
      <div className="px-2 py-1 bg-zinc-900">
        <p className="text-xs text-zinc-200 truncate leading-tight">{clip.name}</p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// RushesViewer (main component)
// ---------------------------------------------------------------------------

function RushesViewer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);

  // --- directory / clip state ---
  const [localDir, setLocalDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [localDirName, setLocalDirName] = useState("");
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([]);
  const [currentClip, setCurrentClip] = useState<LocalFile | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [loadingDir, setLoadingDir] = useState(false);

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
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractCount, setExtractCount] = useState<Record<string, number>>({});

  // Restore persisted directory handle on mount
  useEffect(() => {
    async function restore() {
      try {
        const handle = await loadDirectoryHandle();
        if (!handle) return;
        const ok = await verifyPermission(handle);
        if (!ok) return;
        const files = await listMediaFiles(handle);
        setLocalDir(handle);
        setLocalDirName(handle.name);
        setLocalFiles(files);
      } catch {
        // silently ignore — user will open manually
      }
    }
    restore();
  }, []);

  // Generate thumbnails and durations whenever the file list changes
  useEffect(() => {
    if (localFiles.length === 0) return;
    let cancelled = false;
    async function generate() {
      for (const clip of localFiles) {
        if (cancelled) break;
        const [thumb, dur] = await Promise.all([captureFrame(clip), readDuration(clip)]);
        if (cancelled) break;
        if (thumb) setThumbnails((p) => ({ ...p, [clip.name]: thumb }));
        setDurations((p) => ({ ...p, [clip.name]: dur }));
      }
    }
    generate();
    return () => { cancelled = true; };
  }, [localFiles]);

  // Reset timeline state when clip changes
  useEffect(() => {
    if (currentUrl && videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
    setInPoint(null);
    setOutPoint(null);
    setPlacePoint(null);
    setSectionStep(0);
    setPlayheadTime(0);
    setVideoDuration(0);
    setExtractError(null);
  }, [currentUrl]);

  // ---- directory actions ----

  const pickDirectory = useCallback(async () => {
    if (!supportsLocalDirectory()) return;
    setLoadingDir(true);
    try {
      // @ts-expect-error — showDirectoryPicker not in all TS lib defs
      const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      await saveDirectoryHandle(handle);
      const files = await listMediaFiles(handle);
      setLocalDir(handle);
      setLocalDirName(handle.name);
      setLocalFiles(files);
      setCurrentClip(null);
      if (currentUrl) { URL.revokeObjectURL(currentUrl); setCurrentUrl(null); }
      setThumbnails({});
      setDurations({});
    } catch {
      // user cancelled
    } finally {
      setLoadingDir(false);
    }
  }, [currentUrl]);

  // ---- clip actions ----

  const selectClip = useCallback(async (clip: LocalFile) => {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    try {
      const file = await clip.handle.getFile();
      const url = URL.createObjectURL(file);
      setCurrentUrl(url);
      setCurrentClip(clip);
    } catch {
      // handle expired — silently fail
    }
  }, [currentUrl]);

  const handleVideoEnded = useCallback(() => {
    if (!currentClip) return;
    const idx = localFiles.findIndex((f) => f.name === currentClip.name);
    if (idx >= 0 && idx < localFiles.length - 1) selectClip(localFiles[idx + 1]);
  }, [currentClip, localFiles, selectClip]);

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
        setInPoint(t);
        setOutPoint(null);
        setSectionStep(1);
      } else if (sectionStep === 1) {
        // Normalise so in < out
        const newIn = Math.min(inPoint!, t);
        const newOut = Math.max(inPoint!, t);
        setInPoint(newIn);
        setOutPoint(newOut);
        setSectionStep(2);
      }
      // sectionStep === 2: no-op — section is locked
    } else if (timelineMode === "place") {
      setPlacePoint(t);
    }
    // null mode: bar is passive, no action
  }

  // ---- ffmpeg lazy loader ----

  async function loadFfmpeg(): Promise<FFmpeg> {
    if (ffmpegRef.current) return ffmpegRef.current;
    const ff = new FFmpeg();
    const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";
    await ff.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegRef.current = ff;
    return ff;
  }

  // ---- extract action ----

  async function handleExtract() {
    if (!currentClip || inPoint === null || outPoint === null || !localDir) return;
    setIsExtracting(true);
    setExtractError(null);
    try {
      setFfmpegLoading(true);
      const ff = await loadFfmpeg();
      setFfmpegLoading(false);

      const file = await currentClip.handle.getFile();
      const dotIdx = currentClip.name.lastIndexOf(".");
      const base = dotIdx > 0 ? currentClip.name.slice(0, dotIdx) : currentClip.name;
      const ext = dotIdx > 0 ? currentClip.name.slice(dotIdx + 1) : "mp4";
      const count = (extractCount[base] ?? 0) + 1;
      const outputName = `${base}-${String(count).padStart(3, "0")}.${ext}`;
      const inputName = `input.${ext}`;
      const outName = `output.${ext}`;

      await ff.writeFile(inputName, await fetchFile(file));
      await ff.exec(["-i", inputName, "-ss", String(inPoint), "-to", String(outPoint), "-c", "copy", outName]);

      const data = await ff.readFile(outName);
      const blob = new Blob([data as Uint8Array], { type: file.type || `video/${ext}` });
      await writeBinaryFileToDirectory(localDir, outputName, blob);

      await ff.deleteFile(inputName).catch(() => {});
      await ff.deleteFile(outName).catch(() => {});

      setExtractCount((prev) => ({ ...prev, [base]: count }));
      const files = await listMediaFiles(localDir);
      setLocalFiles(files);
    } catch (e) {
      setFfmpegLoading(false);
      setExtractError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setIsExtracting(false);
    }
  }

  // ---- derived values ----

  const currentIndex = currentClip ? localFiles.findIndex((f) => f.name === currentClip.name) : -1;
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

  // ---- hint text ----
  let hintText: string | null = null;
  if (timelineMode === "section") {
    if (sectionStep === 0) hintText = "Click the bar to set section start";
    else if (sectionStep === 1) hintText = "Click the bar to set section end";
  } else if (timelineMode === "place") {
    if (placePoint === null) hintText = "Click the bar to drop a placement marker";
  }

  // -------------------------------------------------------------------------
  // Empty states
  // -------------------------------------------------------------------------

  if (!supportsLocalDirectory()) {
    return (
      <div className="flex flex-col h-screen bg-black text-white">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm space-y-3 px-4">
            <Film className="w-12 h-12 text-zinc-600 mx-auto" />
            <p className="text-zinc-300 font-medium">Local folder access requires Chrome or Edge</p>
            <p className="text-zinc-500 text-sm">
              Safari doesn&apos;t support the Filesystem Access API. Open MovieShaker in Chrome to use the Rushes Viewer.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!localDir) {
    return (
      <div className="flex flex-col h-screen bg-black text-white">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm space-y-6 px-4">
            <div className="flex items-center justify-center w-20 h-20 rounded-full bg-zinc-900 mx-auto">
              <Film className="w-10 h-10 text-zinc-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">Open your footage folder</h2>
              <p className="text-zinc-400 text-sm">
                Select the folder on your Mac where your raw clips are stored. They&apos;ll play directly from disk — nothing is uploaded.
              </p>
            </div>
            <Button onClick={pickDirectory} disabled={loadingDir} size="lg" className="gap-2">
              <FolderOpen className="w-5 h-5" />
              {loadingDir ? "Opening…" : "Open Footage Folder"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (localFiles.length === 0) {
    return (
      <div className="flex flex-col h-screen bg-black text-white">
        <AppHeader />
        <div className="p-3 border-b border-zinc-800 flex items-center gap-3">
          <FolderOpen className="w-4 h-4 text-zinc-400 flex-shrink-0" />
          <span className="text-sm text-zinc-300 truncate">{localDirName}</span>
          <Button variant="outline" size="sm" onClick={pickDirectory} className="ml-auto flex-shrink-0 gap-1.5">
            <FolderOpen className="w-3.5 h-3.5" />
            Change
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <Film className="w-10 h-10 text-zinc-700 mx-auto" />
            <p className="text-zinc-400">No video or audio files found in <strong>{localDirName}</strong></p>
            <p className="text-zinc-600 text-sm">Supported: mp4, mov, avi, webm, mkv, mp3, m4a, wav, aac, ogg, flac</p>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main viewer
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-screen bg-black text-white overflow-hidden">
      <AppHeader />

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 flex-shrink-0">
        <FolderOpen className="w-4 h-4 text-zinc-400 flex-shrink-0" />
        <span className="text-sm text-zinc-300 truncate">{localDirName}</span>
        <span className="text-xs text-zinc-600 flex-shrink-0">{localFiles.length} clips</span>
        <Button
          variant="outline"
          size="sm"
          onClick={pickDirectory}
          disabled={loadingDir}
          className="ml-auto flex-shrink-0 gap-1.5 border-zinc-700 text-zinc-300 hover:text-white"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Change
        </Button>
      </div>

      {/* Main player */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden min-h-0">
        {currentUrl ? (
          <>
            <video
              ref={videoRef}
              src={currentUrl}
              controls
              onEnded={handleVideoEnded}
              onTimeUpdate={() => setPlayheadTime(videoRef.current?.currentTime ?? 0)}
              onLoadedMetadata={() => setVideoDuration(videoRef.current?.duration ?? 0)}
              className="w-full h-full object-contain"
            />
            {currentClip && (
              <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
                {currentIndex + 1} of {localFiles.length} · {currentClip.name}
              </div>
            )}
          </>
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
          {/* Section button */}
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

          {/* Place button */}
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

          {/* Hint text */}
          {hintText && (
            <span className="text-xs text-zinc-500 italic ml-1">{hintText}</span>
          )}

          {/* Section complete: IN/OUT info + clear + extract */}
          {hasSection && (
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <span className="font-mono text-xs text-zinc-300">
                IN {formatTimecode(inPoint!)}
              </span>
              <span className="text-zinc-600 text-xs">→</span>
              <span className="font-mono text-xs text-zinc-300">
                OUT {formatTimecode(outPoint!)}
              </span>
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
                disabled={isExtracting || !localDir}
                className="gap-1.5 h-7 text-xs"
              >
                {isExtracting
                  ? ffmpegLoading
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading FFmpeg…</>
                    : <><Loader2 className="w-3.5 h-3.5 animate-spin" />Extracting…</>
                  : <><Scissors className="w-3.5 h-3.5" />Extract Clip</>
                }
              </Button>
            </div>
          )}

          {/* Place point info + clear */}
          {placePoint !== null && !hasSection && (
            <div className="flex items-center gap-2 ml-auto">
              <MapPin className="w-3.5 h-3.5 text-yellow-400" />
              <span className="font-mono text-xs text-yellow-300">
                PLACE {formatTimecode(placePoint)}
              </span>
              <button
                onClick={() => setPlacePoint(null)}
                className="text-zinc-500 hover:text-zinc-300"
                title="Clear marker"
              >
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
          {/* Section region highlight */}
          {hasSection && (
            <div
              className="absolute top-0 h-full bg-primary/40 rounded pointer-events-none"
              style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
            />
          )}

          {/* In-point marker + drag handle */}
          {inPoint !== null && (
            <>
              <div
                className="absolute top-0 h-full w-0.5 bg-primary pointer-events-none"
                style={{ left: `${inPct}%` }}
              />
              <div
                className="absolute top-0 h-full w-4 -translate-x-1/2 cursor-ew-resize z-10"
                style={{ left: `${inPct}%` }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.buttons === 0) return;
                  const t = timeFromBarX(e.clientX);
                  setInPoint(Math.max(0, Math.min(t, outPoint ?? videoDuration)));
                }}
              />
            </>
          )}

          {/* Out-point marker + drag handle */}
          {outPoint !== null && (
            <>
              <div
                className="absolute top-0 h-full w-0.5 bg-primary pointer-events-none"
                style={{ left: `${outPct}%` }}
              />
              <div
                className="absolute top-0 h-full w-4 -translate-x-1/2 cursor-ew-resize z-10"
                style={{ left: `${outPct}%` }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.buttons === 0) return;
                  const t = timeFromBarX(e.clientX);
                  setOutPoint(Math.max(inPoint ?? 0, Math.min(t, videoDuration)));
                }}
              />
            </>
          )}

          {/* Place marker + drag handle */}
          {placePoint !== null && (
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
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.buttons === 0) return;
                  const t = timeFromBarX(e.clientX);
                  setPlacePoint(Math.max(0, Math.min(t, videoDuration)));
                }}
              />
            </>
          )}

          {/* Playhead */}
          {videoDuration > 0 && (
            <div
              className="absolute top-0 h-full w-0.5 bg-white/70 pointer-events-none"
              style={{ left: `${playheadPct}%` }}
            />
          )}

          {/* Edge timecodes */}
          {videoDuration > 0 && (
            <>
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 font-mono pointer-events-none">
                {formatTimecode(0)}
              </span>
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 font-mono pointer-events-none">
                {formatTimecode(videoDuration)}
              </span>
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
          {localFiles.map((clip) => (
            <ClipCard
              key={clip.name}
              clip={clip}
              active={currentClip?.name === clip.name}
              thumbnail={thumbnails[clip.name] ?? null}
              duration={durations[clip.name] ?? 0}
              onClick={() => selectClip(clip)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export (wrapped in SessionAuth)
// ---------------------------------------------------------------------------

export default function FilmInABoxPage() {
  return (
    <SessionAuth>
      <RushesViewer />
    </SessionAuth>
  );
}
