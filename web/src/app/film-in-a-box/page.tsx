"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Film, FolderOpen, Play } from "lucide-react";
import {
  supportsLocalDirectory,
  saveDirectoryHandle,
  loadDirectoryHandle,
  listMediaFiles,
  verifyPermission,
  type LocalFile,
} from "@/lib/localFileStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
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
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(video.duration);
      };
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
          <img
            src={thumbnail}
            alt={clip.name}
            className="w-full h-full object-cover"
          />
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

  const [localDir, setLocalDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [localDirName, setLocalDirName] = useState("");
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([]);
  const [currentClip, setCurrentClip] = useState<LocalFile | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [loadingDir, setLoadingDir] = useState(false);

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

  // Generate thumbnails and durations for all clips whenever the list changes
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

  const pickDirectory = useCallback(async () => {
    if (!supportsLocalDirectory()) return;
    setLoadingDir(true);
    try {
      // @ts-expect-error — showDirectoryPicker not in all TS lib defs
      const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: "read" });
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
    if (idx >= 0 && idx < localFiles.length - 1) {
      selectClip(localFiles[idx + 1]);
    }
  }, [currentClip, localFiles, selectClip]);

  // Auto-play when URL changes
  useEffect(() => {
    if (currentUrl && videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  }, [currentUrl]);

  const currentIndex = currentClip
    ? localFiles.findIndex((f) => f.name === currentClip.name)
    : -1;

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
            <Button
              onClick={pickDirectory}
              disabled={loadingDir}
              size="lg"
              className="gap-2"
            >
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
