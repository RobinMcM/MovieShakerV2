"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  Film,
  GripHorizontal,
  Image as ImageIcon,
  Music,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  SkipBack,
  Trash2,
  Zap,
} from "lucide-react";
import { API_URL } from "@/lib/api";
import { RushesViewer } from "@/components/project/RushesViewer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AssetType = "select" | "clip" | "insert" | "sound" | "effects" | "backgrounds";
type TrackType = "video" | "audio";

interface TimelineItem {
  id: string;
  type: AssetType;
  key: string;
  filename: string;
  label: string;
  duration: number;       // seconds; 0 = unknown
  in_time?: number;
  out_time?: number;
  url?: string;           // presigned URL — populated from rushes, not persisted
}

interface Timeline {
  video_track: TimelineItem[];
  audio_track: TimelineItem[];
}

// Rushes API shapes (minimal — only what the editor needs)
interface SelectMeta { id: string; label: string; source_key: string; source_filename: string; in_time: number; out_time: number; duration: number; key?: string; url?: string; source_url?: string; }
interface ClipMeta { key: string; filename: string; size: number; url: string; }
interface InsertMeta { key: string; filename: string; size: number; url: string; }
interface AudioMeta { key: string; filename: string; size: number; url: string; }

interface RushesData {
  clips: ClipMeta[];
  selects: SelectMeta[];
  inserts: InsertMeta[];
  sounds: AudioMeta[];
  effects: AudioMeta[];
  backgrounds: InsertMeta[];
  labels?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "?";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const TRACK_COLORS: Record<AssetType, string> = {
  select:      "bg-blue-500/80 border-blue-400",
  clip:        "bg-slate-500/80 border-slate-400",
  insert:      "bg-amber-500/80 border-amber-400",
  backgrounds: "bg-emerald-500/80 border-emerald-400",
  sound:       "bg-purple-500/80 border-purple-400",
  effects:     "bg-pink-500/80 border-pink-400",
};

const ASSET_TRACK: Record<AssetType, TrackType> = {
  select: "video", clip: "video", insert: "video", backgrounds: "video",
  sound: "audio", effects: "audio",
};

// Module-level factory helpers (used by ArtifactsPanel; EditorView has its own with label context)
function makeId() { return Math.random().toString(36).slice(2, 10); }
function fromSelectMeta(s: SelectMeta): TimelineItem {
  return { id: makeId(), type: "select", key: s.source_key, filename: s.source_filename, label: s.label, duration: s.duration, in_time: s.in_time, out_time: s.out_time, url: s.source_url };
}
function fromClipMeta(c: ClipMeta): TimelineItem {
  return { id: makeId(), type: "clip", key: c.key, filename: c.filename, label: c.filename, duration: 0, url: c.url };
}
function fromInsertMeta(i: InsertMeta): TimelineItem {
  return { id: makeId(), type: "insert", key: i.key, filename: i.filename, label: i.filename, duration: 5, url: i.url };
}
function fromAudioMeta(a: AudioMeta, type: "sound" | "effects"): TimelineItem {
  return { id: makeId(), type, key: a.key, filename: a.filename, label: a.filename, duration: 0, url: a.url };
}
function fromBackgroundMeta(b: InsertMeta): TimelineItem {
  const ext = b.filename.split(".").pop()?.toLowerCase() ?? "";
  const isImg = ["jpg", "jpeg", "png", "webp"].includes(ext);
  return { id: makeId(), type: "backgrounds", key: b.key, filename: b.filename, label: b.filename, duration: isImg ? 5 : 0, url: b.url };
}

function blockWidth(duration: number): number {
  if (!duration || duration <= 0) return 100;
  return Math.max(80, Math.round(duration * 3));
}

function isImageItem(item: TimelineItem): boolean {
  if (item.type === "insert") return true;
  if (item.type === "backgrounds") {
    const ext = item.filename.split(".").pop()?.toLowerCase() ?? "";
    return ["jpg", "jpeg", "png", "webp"].includes(ext);
  }
  return false;
}

// ---------------------------------------------------------------------------
// GapMarker — clickable insert-point slot between timeline blocks
// ---------------------------------------------------------------------------

function GapMarker({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      title="Set insert point here"
      className="flex-shrink-0 w-3 h-full cursor-pointer flex items-center justify-center hover:bg-amber-400/10 group transition-colors"
    >
      <div
        className={`w-0.5 h-full transition-colors ${
          active ? "bg-amber-400" : "bg-transparent group-hover:bg-amber-400/50"
        }`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssetRow — one asset in the Design library
// ---------------------------------------------------------------------------

function AssetRow({
  label, sublabel, badge, onAdd,
}: {
  label: string;
  sublabel?: string;
  badge?: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground truncate leading-tight">{label}</p>
        {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
      </div>
      {badge && (
        <span className="flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {badge}
        </span>
      )}
      <button
        onClick={onAdd}
        className="flex-shrink-0 flex items-center gap-0.5 text-[10px] text-primary hover:text-primary/80 font-medium"
        title="Add to Timeline"
      >
        Add <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArtifactsPanel — persistent right sidebar listing assets ready to add
// ---------------------------------------------------------------------------

function ArtifactsPanel({
  rushes, labels, onAdd, onRefresh,
}: {
  rushes: RushesData | null;
  labels: Record<string, string>;
  onAdd: (item: TimelineItem) => void;
  onRefresh: () => void;
}) {
  if (!rushes) {
    return (
      <div className="w-72 flex-shrink-0 border-l border-border bg-card flex items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  const totalAssets =
    rushes.selects.length + rushes.clips.length + rushes.inserts.length +
    rushes.backgrounds.length + rushes.sounds.length + rushes.effects.length;

  return (
    <div className="w-72 flex-shrink-0 border-l border-border bg-card flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Artifacts
        </span>
        <button
          onClick={onRefresh}
          title="Refresh assets"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {totalAssets === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            No assets yet — upload footage in the Design tab
          </p>
        )}

        {rushes.selects.length > 0 && (
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Scissors className="w-3 h-3" /> Selects ({rushes.selects.length})
            </h3>
            <div className="space-y-1">
              {rushes.selects.map((s) => (
                <AssetRow key={s.id} label={s.label} sublabel={formatDuration(s.duration)} badge="video" onAdd={() => onAdd(fromSelectMeta(s))} />
              ))}
            </div>
          </section>
        )}

        {rushes.clips.length > 0 && (
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Film className="w-3 h-3" /> Clips ({rushes.clips.length})
            </h3>
            <div className="space-y-1">
              {rushes.clips.map((c) => (
                <AssetRow key={c.key} label={labels[c.key] || c.filename} sublabel={formatSize(c.size)} badge="video" onAdd={() => onAdd(fromClipMeta(c))} />
              ))}
            </div>
          </section>
        )}

        {rushes.inserts.length > 0 && (
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <ImageIcon className="w-3 h-3" /> Inserts ({rushes.inserts.length})
            </h3>
            <div className="space-y-1">
              {rushes.inserts.map((i) => (
                <AssetRow key={i.key} label={labels[i.key] || i.filename} sublabel="5s" badge="video" onAdd={() => onAdd(fromInsertMeta(i))} />
              ))}
            </div>
          </section>
        )}

        {rushes.backgrounds.length > 0 && (
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Film className="w-3 h-3" /> Backgrounds ({rushes.backgrounds.length})
            </h3>
            <div className="space-y-1">
              {rushes.backgrounds.map((b) => (
                <AssetRow key={b.key} label={labels[b.key] || b.filename} sublabel={formatSize(b.size)} badge="video" onAdd={() => onAdd(fromBackgroundMeta(b))} />
              ))}
            </div>
          </section>
        )}

        {rushes.sounds.length > 0 && (
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Music className="w-3 h-3" /> Sound ({rushes.sounds.length})
            </h3>
            <div className="space-y-1">
              {rushes.sounds.map((s) => (
                <AssetRow key={s.key} label={labels[s.key] || s.filename} sublabel={formatSize(s.size)} badge="audio" onAdd={() => onAdd(fromAudioMeta(s, "sound"))} />
              ))}
            </div>
          </section>
        )}

        {rushes.effects.length > 0 && (
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Zap className="w-3 h-3" /> Effects ({rushes.effects.length})
            </h3>
            <div className="space-y-1">
              {rushes.effects.map((e) => (
                <AssetRow key={e.key} label={labels[e.key] || e.filename} sublabel={formatSize(e.size)} badge="audio" onAdd={() => onAdd(fromAudioMeta(e, "effects"))} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TimelineBlock — draggable block on a track
// ---------------------------------------------------------------------------

function TimelineBlock({
  item, selected, onSelect, onRemove,
  onDragStart, onDragOver, onDrop,
}: {
  item: TimelineItem;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const w = blockWidth(item.duration);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e); }}
      onDrop={(e) => { e.preventDefault(); onDrop(e); }}
      onClick={onSelect}
      style={{ width: `${w}px`, minWidth: `${w}px` }}
      className={`
        group relative flex-shrink-0 h-full rounded border cursor-grab active:cursor-grabbing
        flex flex-col justify-between px-1.5 py-1 select-none transition-all
        ${TRACK_COLORS[item.type]}
        ${selected ? "ring-2 ring-white ring-offset-1 ring-offset-background" : ""}
      `}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-[9px] text-white font-medium leading-tight truncate flex-1">{item.label}</p>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="flex-shrink-0 rounded p-0.5 bg-black/30 hover:bg-red-600 text-white transition-colors opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <GripHorizontal className="w-3 h-3 text-white/50" />
        <span className="text-[9px] text-white/70">{formatDuration(item.duration)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditorView
// ---------------------------------------------------------------------------

function EditorView({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<"design" | "build">("design");
  const [rushes, setRushes] = useState<RushesData | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [timeline, setTimeline] = useState<Timeline>({ video_track: [], audio_track: [] });
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingVideoIdx, setPlayingVideoIdx] = useState(0);
  const [playStartIdx, setPlayStartIdx] = useState(0);
  const [videoInsertPoint, setVideoInsertPoint] = useState(0);
  const [audioInsertPoint, setAudioInsertPoint] = useState(0);
  const [rushesVersion, setRushesVersion] = useState(0);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragSrcRef = useRef<{ track: TrackType; index: number } | null>(null);
  const playerVideoRef = useRef<HTMLVideoElement>(null);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackScrollRef = useRef<HTMLDivElement>(null);
  const isDraggingMarkerRef = useRef(false);
  // Ref so event-handler closures see the latest isPlaying without staling
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // ---- fetch ----

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [rushesRes, timelineRes] = await Promise.all([
          fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes`, { credentials: "include" }),
          fetch(`${API_URL}/api/editorial/projects/${projectId}/timeline`, { credentials: "include" }),
        ]);
        const rushesData: RushesData = rushesRes.ok
          ? await rushesRes.json()
          : { clips: [], selects: [], inserts: [], sounds: [], effects: [], backgrounds: [] };
        const timelineData: Timeline = timelineRes.ok
          ? await timelineRes.json()
          : { video_track: [], audio_track: [] };

        // Enrich timeline items with current presigned URLs and user labels from rushes data
        const labelMap = rushesData.labels ?? {};
        const urlMap = new Map<string, string>();
        for (const c of rushesData.clips) urlMap.set(c.key, c.url);
        for (const s of rushesData.selects) { if (s.source_key) urlMap.set(s.source_key, s.source_url ?? ""); }
        for (const i of rushesData.inserts) urlMap.set(i.key, i.url);
        for (const s of rushesData.sounds) urlMap.set(s.key, s.url);
        for (const e of rushesData.effects) urlMap.set(e.key, e.url);
        for (const b of rushesData.backgrounds) urlMap.set(b.key, b.url);

        const enrich = (items: TimelineItem[]) =>
          items.map((item) => ({
            ...item,
            url: urlMap.get(item.key) ?? item.url,
            // Refresh label from current user-defined names (selects keep their own label)
            label: item.type === "select" ? item.label : (labelMap[item.key] || item.label),
          }));

        const vt = enrich(timelineData.video_track ?? []);
        const at = enrich(timelineData.audio_track ?? []);

        setRushes(rushesData);
        setLabels(labelMap);
        setTimeline({ video_track: vt, audio_track: at });
        // Default insert points to end (append mode)
        setVideoInsertPoint(vt.length);
        setAudioInsertPoint(at.length);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId]);

  // Re-fetch rushes data only (triggered by onAssetsChanged from RushesViewer)
  useEffect(() => {
    if (rushesVersion === 0) return; // skip initial render — covered by main load
    fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data: RushesData | null) => {
        if (data) {
          setRushes(data);
          setLabels(data.labels ?? {});
        }
      })
      .catch(() => {});
  }, [projectId, rushesVersion]);

  // ---- sequential playback effect ----
  // Fires when isPlaying or playingVideoIdx changes. Handles image timers and video play.

  useEffect(() => {
    if (!isPlaying) return;
    const item = timeline.video_track[playingVideoIdx];
    if (!item) {
      setIsPlaying(false);
      return;
    }
    if (isImageItem(item)) {
      // Show the image for item.duration seconds, then advance
      playTimerRef.current = setTimeout(() => {
        const next = playingVideoIdx + 1;
        if (next < timeline.video_track.length) setPlayingVideoIdx(next);
        else { setIsPlaying(false); setPlayingVideoIdx(0); }
      }, (item.duration || 5) * 1000);
      return () => { if (playTimerRef.current) clearTimeout(playTimerRef.current); };
    } else {
      // Video — seek and play. onLoadedMetadata also plays if still isPlaying.
      const vid = playerVideoRef.current;
      if (!vid) return;
      vid.currentTime = item.in_time ?? 0;
      vid.play().catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playingVideoIdx]);

  // ---- auto-save (debounced 1.5s) ----

  const persistTimeline = useCallback((tl: Timeline) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // Strip presigned URLs before saving — they expire
      const strip = (items: TimelineItem[]) => items.map(({ url: _url, ...rest }) => rest);
      fetch(`${API_URL}/api/editorial/projects/${projectId}/timeline`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_track: strip(tl.video_track), audio_track: strip(tl.audio_track) }),
      }).catch(() => {});
    }, 1500);
  }, [projectId]);

  function updateTimeline(tl: Timeline) {
    setTimeline(tl);
    persistTimeline(tl);
  }

  // ---- playback controls ----

  function handlePlay() {
    if (timeline.video_track.length === 0) return;
    setPlayingVideoIdx(playStartIdx);
    setIsPlaying(true);
  }

  function handlePause() {
    setIsPlaying(false);
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    playerVideoRef.current?.pause();
  }

  function handleVideoEnded() {
    const next = playingVideoIdx + 1;
    if (next < timeline.video_track.length) setPlayingVideoIdx(next);
    else { setIsPlaying(false); setPlayingVideoIdx(0); }
  }

  // ---- add asset to timeline (at insert point) ----

  function addToTimeline(item: TimelineItem) {
    const track = ASSET_TRACK[item.type];
    const next = { ...timeline };
    if (track === "video") {
      const arr = [...timeline.video_track];
      arr.splice(videoInsertPoint, 0, item);
      next.video_track = arr;
      setVideoInsertPoint(videoInsertPoint + 1);
    } else {
      const arr = [...timeline.audio_track];
      arr.splice(audioInsertPoint, 0, item);
      next.audio_track = arr;
      setAudioInsertPoint(audioInsertPoint + 1);
    }
    updateTimeline(next);
  }

  // ---- remove from timeline ----

  function removeFromTimeline(track: TrackType, id: string) {
    const next = { ...timeline };
    if (track === "video") {
      const removedIdx = timeline.video_track.findIndex((i) => i.id === id);
      next.video_track = timeline.video_track.filter((i) => i.id !== id);
      const newLen = next.video_track.length;
      if (newLen === 0) { handlePause(); setPlayingVideoIdx(0); }
      else if (playingVideoIdx >= newLen) setPlayingVideoIdx(newLen - 1);
      if (removedIdx < videoInsertPoint && videoInsertPoint > 0) setVideoInsertPoint(videoInsertPoint - 1);
    } else {
      const removedIdx = timeline.audio_track.findIndex((i) => i.id === id);
      next.audio_track = timeline.audio_track.filter((i) => i.id !== id);
      if (removedIdx < audioInsertPoint && audioInsertPoint > 0) setAudioInsertPoint(audioInsertPoint - 1);
    }
    updateTimeline(next);
  }

  // ---- drag to reorder ----

  function handleDragStart(track: TrackType, index: number) {
    dragSrcRef.current = { track, index };
  }

  function handleDrop(track: TrackType, dropIndex: number) {
    const src = dragSrcRef.current;
    if (!src || src.track !== track || src.index === dropIndex) return;
    const next = { ...timeline };
    const arr = [...(track === "video" ? timeline.video_track : timeline.audio_track)];
    const [moved] = arr.splice(src.index, 1);
    arr.splice(dropIndex, 0, moved);
    if (track === "video") next.video_track = arr;
    else next.audio_track = arr;
    dragSrcRef.current = null;
    updateTimeline(next);
  }

  // ---- asset → TimelineItem factories ----

  function fromSelect(s: SelectMeta): TimelineItem {
    return { id: makeId(), type: "select", key: s.source_key, filename: s.source_filename, label: s.label, duration: s.duration, in_time: s.in_time, out_time: s.out_time, url: s.source_url };
  }
  function fromClip(c: ClipMeta): TimelineItem {
    return { id: makeId(), type: "clip", key: c.key, filename: c.filename, label: labels[c.key] || c.filename, duration: 0, url: c.url };
  }
  function fromInsert(i: InsertMeta): TimelineItem {
    return { id: makeId(), type: "insert", key: i.key, filename: i.filename, label: labels[i.key] || i.filename, duration: 5, url: i.url };
  }
  function fromAudio(a: AudioMeta, type: "sound" | "effects"): TimelineItem {
    return { id: makeId(), type, key: a.key, filename: a.filename, label: labels[a.key] || a.filename, duration: 0, url: a.url };
  }
  function fromBackground(b: InsertMeta): TimelineItem {
    const ext = b.filename.split(".").pop()?.toLowerCase() ?? "";
    const isImg = ["jpg", "jpeg", "png", "webp"].includes(ext);
    return { id: makeId(), type: "backgrounds", key: b.key, filename: b.filename, label: labels[b.key] || b.filename, duration: isImg ? 5 : 0, url: b.url };
  }

  // ---- play-start marker helpers ----

  function computeMarkerOffset(idx: number): number {
    const GAP = 12; // GapMarker w-3 = 12px
    let offset = GAP;
    for (let i = 0; i < idx && i < timeline.video_track.length; i++) {
      offset += blockWidth(timeline.video_track[i].duration) + GAP;
    }
    return offset;
  }

  function pixelToClipIdx(px: number): number {
    const GAP = 12;
    let cumulative = GAP;
    for (let i = 0; i < timeline.video_track.length; i++) {
      const clipEnd = cumulative + blockWidth(timeline.video_track[i].duration);
      if (px <= clipEnd) return i;
      cumulative = clipEnd + GAP;
    }
    return Math.max(0, timeline.video_track.length - 1);
  }

  function handleMarkerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    isDraggingMarkerRef.current = true;

    const handleMove = (ev: MouseEvent) => {
      if (!isDraggingMarkerRef.current || !trackScrollRef.current) return;
      const rect = trackScrollRef.current.getBoundingClientRect();
      const rawX = ev.clientX - rect.left + trackScrollRef.current.scrollLeft;
      setPlayStartIdx(pixelToClipIdx(Math.max(0, rawX)));
    };

    const handleUp = () => {
      isDraggingMarkerRef.current = false;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }

  // ---- track renderer — interleaved blocks + gap markers ----

  function renderTrack(
    trackItems: TimelineItem[],
    trackType: TrackType,
    insertPoint: number,
    setInsertPoint: (n: number) => void,
  ) {
    const nodes = [];
    for (let i = 0; i <= trackItems.length; i++) {
      nodes.push(
        <GapMarker
          key={`gap-${i}`}
          active={insertPoint === i}
          onClick={() => setInsertPoint(i)}
        />
      );
      if (i < trackItems.length) {
        const item = trackItems[i];
        const isSelected = trackType === "video" && playingVideoIdx === i;
        nodes.push(
          <TimelineBlock
            key={item.id}
            item={item}
            selected={isSelected}
            onSelect={() => {
              if (trackType === "video") {
                if (isPlaying) handlePause();
                setPlayingVideoIdx(i);
                setInsertPoint(i);
              }
            }}
            onRemove={() => removeFromTimeline(trackType, item.id)}
            onDragStart={() => handleDragStart(trackType, i)}
            onDragOver={() => {}}
            onDrop={() => handleDrop(trackType, i)}
          />
        );
      }
    }
    return nodes;
  }

  // ---- computed ----

  const totalVideoTime = timeline.video_track.reduce((s, i) => s + (i.duration || 0), 0);
  const totalAudioTime = timeline.audio_track.reduce((s, i) => s + (i.duration || 0), 0);
  const previewItem = timeline.video_track[playingVideoIdx] ?? null;

  // ---- render ----

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <AppHeader />

      <div className="flex flex-1 min-h-0">

        {/* Left column: tab bar + tab content */}
        <div className="flex flex-col flex-1 min-w-0">

          {/* Tab bar */}
          <div className="flex items-center gap-0 border-b border-border px-4 flex-shrink-0">
            {(["design", "build"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors -mb-px ${
                  tab === t
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "design" ? "Design" : "Build"}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground pr-2">
              {timeline.video_track.length + timeline.audio_track.length} items in timeline
            </span>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : (
            <>
              {/* ── DESIGN TAB ── */}
              {tab === "design" && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <RushesViewer
                    projectId={projectId}
                    onAssetsChanged={() => setRushesVersion((v) => v + 1)}
                  />
                </div>
              )}

              {/* ── OLD DESIGN TAB PLACEHOLDER (never shown — kept for compiler) ── */}
              {false && rushes && (
                <div className="flex-1 overflow-y-auto p-4 space-y-6 max-w-2xl mx-auto w-full">

              {rushes.selects.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Scissors className="w-3.5 h-3.5" /> Selects ({rushes.selects.length})
                  </h3>
                  <div className="space-y-1.5">
                    {rushes.selects.map((s) => (
                      <AssetRow key={s.id} label={s.label} sublabel={formatDuration(s.duration)} badge="video" onAdd={() => addToTimeline(fromSelect(s))} />
                    ))}
                  </div>
                </section>
              )}

              {rushes.clips.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5" /> Clips ({rushes.clips.length})
                  </h3>
                  <div className="space-y-1.5">
                    {rushes.clips.map((c) => (
                      <AssetRow key={c.key} label={labels[c.key] || c.filename} sublabel={formatSize(c.size)} badge="video" onAdd={() => addToTimeline(fromClip(c))} />
                    ))}
                  </div>
                </section>
              )}

              {rushes.inserts.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5" /> Inserts ({rushes.inserts.length})
                  </h3>
                  <div className="space-y-1.5">
                    {rushes.inserts.map((i) => (
                      <AssetRow key={i.key} label={labels[i.key] || i.filename} sublabel="5s default" badge="video" onAdd={() => addToTimeline(fromInsert(i))} />
                    ))}
                  </div>
                </section>
              )}

              {rushes.backgrounds.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5" /> Backgrounds ({rushes.backgrounds.length})
                  </h3>
                  <div className="space-y-1.5">
                    {rushes.backgrounds.map((b) => (
                      <AssetRow key={b.key} label={labels[b.key] || b.filename} sublabel={formatSize(b.size)} badge="video" onAdd={() => addToTimeline(fromBackground(b))} />
                    ))}
                  </div>
                </section>
              )}

              {rushes.sounds.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5" /> Sound ({rushes.sounds.length})
                  </h3>
                  <div className="space-y-1.5">
                    {rushes.sounds.map((s) => (
                      <AssetRow key={s.key} label={labels[s.key] || s.filename} sublabel={formatSize(s.size)} badge="audio" onAdd={() => addToTimeline(fromAudio(s, "sound"))} />
                    ))}
                  </div>
                </section>
              )}

              {rushes.effects.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" /> Effects ({rushes.effects.length})
                  </h3>
                  <div className="space-y-1.5">
                    {rushes.effects.map((e) => (
                      <AssetRow key={e.key} label={labels[e.key] || e.filename} sublabel={formatSize(e.size)} badge="audio" onAdd={() => addToTimeline(fromAudio(e, "effects"))} />
                    ))}
                  </div>
                </section>
              )}

              {rushes.selects.length === 0 && rushes.clips.length === 0 && rushes.sounds.length === 0 &&
               rushes.inserts.length === 0 && rushes.effects.length === 0 && rushes.backgrounds.length === 0 && (
                <div className="text-center py-16 space-y-2">
                  <p className="text-sm text-muted-foreground">No assets yet</p>
                </div>
              )}
                </div>
              )}

              {/* ── BUILD TAB ── */}
              {tab === "build" && (
                <div className="flex-1 flex flex-col min-h-0">

              {/* Preview pane — takes all available vertical space */}
              <div className="flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
                {!previewItem ? (
                  <div className="text-center space-y-2 px-4">
                    <Play className="w-10 h-10 text-white/20 mx-auto" />
                    <p className="text-sm text-white/40">Add clips to the timeline to preview</p>
                  </div>
                ) : isImageItem(previewItem) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewItem.url ?? ""}
                    alt={previewItem.filename}
                    className="max-w-full max-h-full object-contain"
                  />
                ) : previewItem.url ? (
                  <video
                    key={playingVideoIdx}
                    ref={playerVideoRef}
                    src={previewItem.url}
                    playsInline
                    className="w-full h-full object-contain"
                    onLoadedMetadata={() => {
                      const vid = playerVideoRef.current;
                      if (!vid) return;
                      if (previewItem.in_time != null) vid.currentTime = previewItem.in_time;
                      if (isPlayingRef.current) vid.play().catch(() => {});
                    }}
                    onTimeUpdate={() => {
                      const vid = playerVideoRef.current;
                      if (!vid || previewItem.out_time == null) return;
                      if (vid.currentTime >= previewItem.out_time && !vid.paused) {
                        vid.pause();
                        handleVideoEnded();
                      }
                    }}
                    onEnded={handleVideoEnded}
                  />
                ) : (
                  <div className="text-center px-4">
                    <Film className="w-8 h-8 text-white/20 mx-auto mb-2" />
                    <p className="text-xs text-white/30">Reload to get a fresh preview link</p>
                  </div>
                )}
              </div>

              {/* Transport bar */}
              <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-t border-b border-border bg-card">
                <button
                  onClick={() => { handlePause(); setPlayingVideoIdx(0); }}
                  disabled={timeline.video_track.length === 0}
                  className="p-1 rounded hover:bg-muted text-foreground disabled:text-muted-foreground/40 transition-colors"
                  title="Skip to start"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
                <button
                  onClick={isPlaying ? handlePause : handlePlay}
                  disabled={timeline.video_track.length === 0}
                  className="p-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <span className="text-xs text-muted-foreground">
                  {timeline.video_track.length > 0
                    ? `clip ${playingVideoIdx + 1} / ${timeline.video_track.length}`
                    : "no clips"}
                </span>
                {previewItem && (
                  <span className="text-xs text-foreground/70 truncate max-w-xs">{previewItem.label}</span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatDuration(Math.max(totalVideoTime, totalAudioTime))} total
                </span>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setTab("design")}>
                  ← Design
                </Button>
              </div>

              {/* Audio track */}
              <div className="flex-shrink-0 border-b border-border px-4 pt-3 pb-2">
                <div className="flex items-center gap-2 mb-1.5">
                  <Music className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-medium">Audio</span>
                  <span className="text-[10px] text-muted-foreground">
                    {timeline.audio_track.length} clips · {formatDuration(totalAudioTime)}
                  </span>
                </div>
                <div className="bg-muted/30 border border-border rounded-lg overflow-x-auto p-2 h-[72px]">
                  <div className="flex h-full items-stretch min-w-max">
                    {timeline.audio_track.length === 0 ? (
                      <p className="text-xs text-muted-foreground self-center mx-auto">
                        Add sound or effects from the Design tab
                      </p>
                    ) : (
                      renderTrack(timeline.audio_track, "audio", audioInsertPoint, setAudioInsertPoint)
                    )}
                  </div>
                </div>
              </div>

              {/* Video track */}
              <div className="flex-shrink-0 px-4 pt-3 pb-2">
                <div className="flex items-center gap-2 mb-1.5">
                  <Film className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-medium">Video</span>
                  <span className="text-[10px] text-muted-foreground">
                    {timeline.video_track.length} clips · {formatDuration(totalVideoTime)}
                  </span>
                </div>
                <div ref={trackScrollRef} className="bg-muted/30 border border-border rounded-lg overflow-x-auto p-2 h-[88px]">
                  {timeline.video_track.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                      <p className="text-xs text-muted-foreground">
                        Add selects or clips from the Design tab
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col h-full min-w-max">
                      {/* Marker rail — draggable play-start handle */}
                      <div className="relative h-6 flex-shrink-0">
                        <div
                          onMouseDown={handleMarkerMouseDown}
                          className="absolute top-0 cursor-ew-resize select-none z-10"
                          style={{ left: `${computeMarkerOffset(playStartIdx)}px`, transform: "translateX(-50%)" }}
                          title="Drag to set play start"
                        >
                          <div className="w-5 h-5 bg-emerald-500 rounded-sm flex items-center justify-center shadow border border-emerald-400">
                            <div className="flex gap-0.5">
                              <div className="w-px h-3 bg-emerald-200 rounded-full" />
                              <div className="w-px h-3 bg-emerald-200 rounded-full" />
                              <div className="w-px h-3 bg-emerald-200 rounded-full" />
                            </div>
                          </div>
                          <div className="w-0.5 h-2 bg-emerald-500 mx-auto" />
                        </div>
                      </div>
                      {/* Clip row */}
                      <div className="flex flex-1 items-stretch">
                        {renderTrack(timeline.video_track, "video", videoInsertPoint, setVideoInsertPoint)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Legend */}
              <div className="flex-shrink-0 flex items-center gap-3 flex-wrap px-4 py-1.5 border-t border-border text-[10px] text-muted-foreground">
                {(Object.entries(TRACK_COLORS) as [AssetType, string][]).map(([type, cls]) => (
                  <span key={type} className="flex items-center gap-1">
                    <span className={`w-3 h-3 rounded border ${cls} inline-block`} />
                    {type}
                  </span>
                ))}
                <span className="ml-auto">Click clip to set insert point · Click gap ▌ to set insert point · Drag ◼ to set play start · Drag clip to reorder</span>
              </div>

              </div>
              )}
            </>
          )}

        </div>{/* end left column */}

        {/* Right column: persistent artifacts panel */}
        <ArtifactsPanel
          rushes={rushes}
          labels={labels}
          onAdd={addToTimeline}
          onRefresh={() => setRushesVersion((v) => v + 1)}
        />

      </div>{/* end flex row */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export
// ---------------------------------------------------------------------------

export default function EditorPage() {
  const params = useParams();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId as string;
  return (
    <SessionAuth>
      <EditorView projectId={projectId} />
    </SessionAuth>
  );
}
