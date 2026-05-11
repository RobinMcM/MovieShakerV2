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
  Play,
  Scissors,
  Trash2,
  Zap,
} from "lucide-react";
import { API_URL } from "@/lib/api";

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
  url?: string;           // presigned URL — populated from rushes data, not persisted
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

// Block pixel width. Min 80px, scale 3px/s beyond that.
function blockWidth(duration: number): number {
  if (!duration || duration <= 0) return 100;
  return Math.max(80, Math.round(duration * 3));
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
        relative flex-shrink-0 h-full rounded border cursor-grab active:cursor-grabbing
        flex flex-col justify-between px-1.5 py-1 select-none transition-all
        ${TRACK_COLORS[item.type]}
        ${selected ? "ring-2 ring-white ring-offset-1 ring-offset-background" : ""}
      `}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-[9px] text-white font-medium leading-tight truncate flex-1">{item.label}</p>
        {selected && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="flex-shrink-0 rounded p-0.5 bg-black/30 hover:bg-red-600 text-white transition-colors"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        )}
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
  const [timeline, setTimeline] = useState<Timeline>({ video_track: [], audio_track: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragSrcRef = useRef<{ track: TrackType; index: number } | null>(null);

  // ---- fetch ----

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [rushesRes, timelineRes] = await Promise.all([
          fetch(`${API_URL}/api/documentary/projects/${projectId}/rushes`, { credentials: "include" }),
          fetch(`${API_URL}/api/editorial/projects/${projectId}/timeline`, { credentials: "include" }),
        ]);
        const rushesData: RushesData = rushesRes.ok ? await rushesRes.json() : { clips: [], selects: [], inserts: [], sounds: [], effects: [], backgrounds: [] };
        const timelineData: Timeline = timelineRes.ok ? await timelineRes.json() : { video_track: [], audio_track: [] };

        // Enrich timeline items with current presigned URLs from rushes data
        const urlMap = new Map<string, string>();
        for (const c of rushesData.clips) urlMap.set(c.key, c.url);
        for (const s of rushesData.selects) { if (s.source_key) urlMap.set(s.source_key, s.source_url ?? ""); }
        for (const i of rushesData.inserts) urlMap.set(i.key, i.url);
        for (const s of rushesData.sounds) urlMap.set(s.key, s.url);
        for (const e of rushesData.effects) urlMap.set(e.key, e.url);
        for (const b of rushesData.backgrounds) urlMap.set(b.key, b.url);

        const enrich = (items: TimelineItem[]) => items.map((item) => ({
          ...item,
          url: urlMap.get(item.key) ?? item.url,
        }));

        setRushes(rushesData);
        setTimeline({
          video_track: enrich(timelineData.video_track ?? []),
          audio_track: enrich(timelineData.audio_track ?? []),
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId]);

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

  // ---- add asset to timeline ----

  function addToTimeline(item: TimelineItem) {
    const track = ASSET_TRACK[item.type];
    const next = { ...timeline };
    if (track === "video") next.video_track = [...timeline.video_track, item];
    else next.audio_track = [...timeline.audio_track, item];
    updateTimeline(next);
    setTab("build");
  }

  function removeFromTimeline(track: TrackType, id: string) {
    const next = { ...timeline };
    if (track === "video") next.video_track = timeline.video_track.filter((i) => i.id !== id);
    else next.audio_track = timeline.audio_track.filter((i) => i.id !== id);
    setSelectedId(null);
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

  // ---- asset → TimelineItem helpers ----

  function makeId() { return Math.random().toString(36).slice(2, 10); }

  function fromSelect(s: SelectMeta): TimelineItem {
    return { id: makeId(), type: "select", key: s.source_key, filename: s.source_filename, label: s.label, duration: s.duration, in_time: s.in_time, out_time: s.out_time, url: s.source_url };
  }
  function fromClip(c: ClipMeta): TimelineItem {
    return { id: makeId(), type: "clip", key: c.key, filename: c.filename, label: c.filename, duration: 0, url: c.url };
  }
  function fromInsert(i: InsertMeta): TimelineItem {
    return { id: makeId(), type: "insert", key: i.key, filename: i.filename, label: i.filename, duration: 5, url: i.url };
  }
  function fromAudio(a: AudioMeta, type: "sound" | "effects"): TimelineItem {
    return { id: makeId(), type, key: a.key, filename: a.filename, label: a.filename, duration: 0, url: a.url };
  }
  function fromBackground(b: InsertMeta): TimelineItem {
    const ext = b.filename.split(".").pop()?.toLowerCase() ?? "";
    const isImg = ["jpg","jpeg","png","webp"].includes(ext);
    return { id: makeId(), type: "backgrounds", key: b.key, filename: b.filename, label: b.filename, duration: isImg ? 5 : 0, url: b.url };
  }

  // ---- render ----

  const totalVideoTime = timeline.video_track.reduce((s, i) => s + (i.duration || 0), 0);
  const totalAudioTime = timeline.audio_track.reduce((s, i) => s + (i.duration || 0), 0);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <AppHeader />

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
          {tab === "design" && rushes && (
            <div className="flex-1 overflow-y-auto p-4 space-y-6 max-w-2xl mx-auto w-full">

              {/* Selects */}
              {rushes.selects.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Scissors className="w-3.5 h-3.5" /> Selects ({rushes.selects.length})
                  </h3>
                  <div className="space-y-1.5">
                    {rushes.selects.map((s) => (
                      <AssetRow
                        key={s.id}
                        label={s.label}
                        sublabel={formatDuration(s.duration)}
                        badge="video"
                        onAdd={() => addToTimeline(fromSelect(s))}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Clips */}
              {rushes.clips.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5" /> Clips ({rushes.clips.length})
                  </h3>
                  <div className="space-y-1.5">
                    {rushes.clips.map((c) => (
                      <AssetRow
                        key={c.key}
                        label={c.filename}
                        sublabel={formatSize(c.size)}
                        badge="video"
                        onAdd={() => addToTimeline(fromClip(c))}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Inserts */}
              {rushes.inserts.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5" /> Inserts ({rushes.inserts.length})
                  </h3>
                  <div className="space-y-1.5">
                    {rushes.inserts.map((i) => (
                      <AssetRow
                        key={i.key}
                        label={i.filename}
                        sublabel="5s default"
                        badge="video"
                        onAdd={() => addToTimeline(fromInsert(i))}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Backgrounds */}
              {rushes.backgrounds.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5" /> Backgrounds ({rushes.backgrounds.length})
                  </h3>
                  <div className="space-y-1.5">
                    {rushes.backgrounds.map((b) => (
                      <AssetRow
                        key={b.key}
                        label={b.filename}
                        sublabel={formatSize(b.size)}
                        badge="video"
                        onAdd={() => addToTimeline(fromBackground(b))}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Sound */}
              {rushes.sounds.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5" /> Sound ({rushes.sounds.length})
                  </h3>
                  <div className="space-y-1.5">
                    {rushes.sounds.map((s) => (
                      <AssetRow
                        key={s.key}
                        label={s.filename}
                        sublabel={formatSize(s.size)}
                        badge="audio"
                        onAdd={() => addToTimeline(fromAudio(s, "sound"))}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Effects */}
              {rushes.effects.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" /> Effects ({rushes.effects.length})
                  </h3>
                  <div className="space-y-1.5">
                    {rushes.effects.map((e) => (
                      <AssetRow
                        key={e.key}
                        label={e.filename}
                        sublabel={formatSize(e.size)}
                        badge="audio"
                        onAdd={() => addToTimeline(fromAudio(e, "effects"))}
                      />
                    ))}
                  </div>
                </section>
              )}

              {rushes.selects.length === 0 && rushes.clips.length === 0 && rushes.sounds.length === 0 && rushes.inserts.length === 0 && rushes.effects.length === 0 && rushes.backgrounds.length === 0 && (
                <div className="text-center py-16 space-y-2">
                  <p className="text-sm text-muted-foreground">No assets yet</p>
                  <p className="text-xs text-muted-foreground opacity-60">Upload footage and audio on the Studio page first</p>
                </div>
              )}
            </div>
          )}

          {/* ── BUILD TAB ── */}
          {tab === "build" && (
            <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">

              {/* Legend */}
              <div className="flex items-center gap-4 flex-wrap text-[10px] text-muted-foreground flex-shrink-0">
                {(Object.entries(TRACK_COLORS) as [AssetType, string][]).map(([type, cls]) => (
                  <span key={type} className="flex items-center gap-1">
                    <span className={`w-3 h-3 rounded border ${cls} inline-block`} />
                    {type}
                  </span>
                ))}
                <span className="ml-auto">Drag blocks to reorder · Click to select · × to remove</span>
              </div>

              {/* Timeline tracks */}
              <div className="flex-1 flex flex-col gap-3 min-h-0">

                {/* Video track */}
                <div className="flex flex-col gap-1 flex-1">
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Film className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground font-medium">Video</span>
                    <span className="text-[10px] text-muted-foreground">
                      {timeline.video_track.length} clips · {formatDuration(totalVideoTime)}
                    </span>
                  </div>
                  <div className="flex-1 bg-muted/30 border border-border rounded-lg overflow-x-auto p-2 min-h-[80px]">
                    <div className="flex gap-1.5 h-full min-h-[64px] items-stretch">
                      {timeline.video_track.map((item, idx) => (
                        <TimelineBlock
                          key={item.id}
                          item={item}
                          selected={selectedId === item.id}
                          onSelect={() => setSelectedId(selectedId === item.id ? null : item.id)}
                          onRemove={() => removeFromTimeline("video", item.id)}
                          onDragStart={() => handleDragStart("video", idx)}
                          onDragOver={() => {}}
                          onDrop={() => handleDrop("video", idx)}
                        />
                      ))}
                      {timeline.video_track.length === 0 && (
                        <p className="text-xs text-muted-foreground self-center mx-auto">
                          Click "Add →" on a video asset in the Design tab
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Audio track */}
                <div className="flex flex-col gap-1 flex-1">
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Music className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground font-medium">Audio</span>
                    <span className="text-[10px] text-muted-foreground">
                      {timeline.audio_track.length} clips · {formatDuration(totalAudioTime)}
                    </span>
                  </div>
                  <div className="flex-1 bg-muted/30 border border-border rounded-lg overflow-x-auto p-2 min-h-[80px]">
                    <div className="flex gap-1.5 h-full min-h-[64px] items-stretch">
                      {timeline.audio_track.map((item, idx) => (
                        <TimelineBlock
                          key={item.id}
                          item={item}
                          selected={selectedId === item.id}
                          onSelect={() => setSelectedId(selectedId === item.id ? null : item.id)}
                          onRemove={() => removeFromTimeline("audio", item.id)}
                          onDragStart={() => handleDragStart("audio", idx)}
                          onDragOver={() => {}}
                          onDrop={() => handleDrop("audio", idx)}
                        />
                      ))}
                      {timeline.audio_track.length === 0 && (
                        <p className="text-xs text-muted-foreground self-center mx-auto">
                          Click "Add →" on a sound or effects asset in the Design tab
                        </p>
                      )}
                    </div>
                  </div>
                </div>

              </div>

              {/* Bottom bar */}
              <div className="flex items-center gap-3 flex-shrink-0 pt-2 border-t border-border">
                <Play className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  Total: {formatDuration(Math.max(totalVideoTime, totalAudioTime))} estimated
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-xs"
                  onClick={() => setTab("design")}
                >
                  ← Back to Design
                </Button>
              </div>
            </div>
          )}
        </>
      )}
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
