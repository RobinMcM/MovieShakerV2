"use client";

import { useState, useMemo } from "react";
import { AlertTriangle, Bot, Check } from "lucide-react";
import { api } from "@/lib/api";
import type {
  Scene,
  SceneWithCharacters,
  Character,
} from "@/app/project/[projectId]/scheduling/types";

interface TramlineBoardProps {
  scenesData: SceneWithCharacters[];
  scriptId: string;
  projectId: string;
  projectName: string;
}

const CAST_COLORS = [
  "#EF4444", "#F97316", "#EAB308", "#22C55E", "#14B8A6",
  "#3B82F6", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
  "#F43F5E", "#A855F7", "#0EA5E9", "#10B981", "#FB923C",
];

function isNight(scene: Scene): boolean {
  return (
    Boolean(scene.is_night_shoot) ||
    (scene.heading ?? "").toUpperCase().includes("NIGHT") ||
    (scene.time_of_day_id ?? "").toLowerCase().includes("night")
  );
}

function intExt(dayScenes: SceneWithCharacters[]): string {
  const intCount = dayScenes.filter((i) =>
    (i.scene.heading ?? "").toUpperCase().startsWith("INT")
  ).length;
  const extCount = dayScenes.filter((i) =>
    (i.scene.heading ?? "").toUpperCase().startsWith("EXT")
  ).length;
  if (intCount > extCount) return "INT";
  if (extCount > intCount) return "EXT";
  if (intCount + extCount === 0) return "";
  return "MIX";
}

export function TramlineBoard({
  scenesData,
  scriptId,
  projectName,
}: TramlineBoardProps) {
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitDone, setCommitDone] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const days = useMemo(() => {
    const s = new Set<number>();
    scenesData.forEach((i) => {
      if (i.scene.continuity_day) s.add(i.scene.continuity_day);
    });
    return Array.from(s).sort((a, b) => a - b);
  }, [scenesData]);

  const unscheduled = useMemo(
    () => scenesData.filter((i) => !i.scene.continuity_day),
    [scenesData]
  );

  const scenesByDay = useMemo(() => {
    const map = new Map<number, SceneWithCharacters[]>();
    days.forEach((d) => map.set(d, []));
    scenesData.forEach((i) => {
      if (i.scene.continuity_day) {
        const arr = map.get(i.scene.continuity_day) ?? [];
        arr.push(i);
        map.set(i.scene.continuity_day, arr);
      }
    });
    return map;
  }, [scenesData, days]);

  const allCharacters = useMemo(() => {
    const map = new Map<string, Character>();
    scenesData.forEach((i) => i.characters.forEach((c) => map.set(c.id, c)));
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [scenesData]);

  const charColor = useMemo(() => {
    const map = new Map<string, string>();
    allCharacters.forEach((c, idx) =>
      map.set(c.id, CAST_COLORS[idx % CAST_COLORS.length])
    );
    return map;
  }, [allCharacters]);

  const charLastDay = useMemo(() => {
    const map = new Map<string, number>();
    scenesData.forEach((i) => {
      const day = i.scene.continuity_day;
      if (!day) return;
      i.characters.forEach((c) => {
        if (day > (map.get(c.id) ?? 0)) map.set(c.id, day);
      });
    });
    return map;
  }, [scenesData]);

  const eighthsByDay = useMemo(() => {
    const map = new Map<number, number>();
    days.forEach((d) => {
      const total = (scenesByDay.get(d) ?? []).reduce(
        (s, i) => s + (i.scene.length_in_eighths ?? 0),
        0
      );
      map.set(d, total);
    });
    return map;
  }, [days, scenesByDay]);

  const primaryLocByDay = useMemo(() => {
    const map = new Map<number, string>();
    days.forEach((d) => {
      const counts = new Map<string, number>();
      (scenesByDay.get(d) ?? []).forEach((i) => {
        const loc = i.scene.scene_location || i.scene.heading || "";
        counts.set(loc, (counts.get(loc) ?? 0) + 1);
      });
      let maxN = 0;
      let primary = "";
      counts.forEach((n, loc) => {
        if (n > maxN) {
          maxN = n;
          primary = loc;
        }
      });
      map.set(d, primary);
    });
    return map;
  }, [days, scenesByDay]);

  const totalEighths = useMemo(
    () => scenesData.reduce((s, i) => s + (i.scene.length_in_eighths ?? 0), 0),
    [scenesData]
  );

  const nightShootDays = useMemo(() => {
    const nightDays = new Set<number>();
    scenesData.forEach((i) => {
      if (i.scene.continuity_day && isNight(i.scene))
        nightDays.add(i.scene.continuity_day);
    });
    return nightDays.size;
  }, [scenesData]);

  const heaviestDay = useMemo(() => {
    let max = 0;
    let day: number | null = null;
    days.forEach((d) => {
      const e = eighthsByDay.get(d) ?? 0;
      if (e > max) {
        max = e;
        day = d;
      }
    });
    return day && max > 32 ? { day, eighths: max } : null;
  }, [days, eighthsByDay]);

  const selectedItem = useMemo(
    () =>
      selectedSceneId
        ? scenesData.find((i) => i.scene.id === selectedSceneId) ?? null
        : null,
    [selectedSceneId, scenesData]
  );

  async function handleCommit() {
    if (!scriptId) return;
    setCommitting(true);
    try {
      const assignments = scenesData
        .filter(
          (i) =>
            i.scene.continuity_day != null && i.scene.scene_number != null
        )
        .map((i) => ({
          scene_number: i.scene.scene_number!,
          shooting_day: i.scene.continuity_day!,
        }));
      await api.post(`/scripts/${scriptId}/schedule/commit`, { assignments });
      setCommitDone(true);
      setToast("Schedule committed.");
      setTimeout(() => setCommitDone(false), 2500);
    } catch {
      setToast("Commit failed — please try again.");
    } finally {
      setCommitting(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  if (days.length === 0 && unscheduled.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-sm">No schedule yet.</p>
        <p className="text-xs mt-2">
          Ask CoProducer to generate one, or assign scenes to shooting days in
          the Script Supervision tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 pb-3 border-b border-border">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {projectName}{" "}
            <span className="font-normal text-muted-foreground">
              · shoot schedule
            </span>
          </p>
          <div className="flex items-center gap-4 mt-1 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {days.length} shooting day{days.length !== 1 ? "s" : ""}
            </span>
            <span className="text-xs text-muted-foreground">
              {totalEighths} eighths
            </span>
            {nightShootDays > 0 && (
              <span className="text-xs text-purple-600 dark:text-purple-400">
                {nightShootDays} night shoot{nightShootDays !== 1 ? "s" : ""}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {allCharacters.length} cast
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleCommit}
          disabled={committing || commitDone}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {commitDone ? (
            <>
              <Check className="h-3 w-3" />
              Committed
            </>
          ) : committing ? (
            "Committing…"
          ) : (
            "Commit schedule"
          )}
        </button>
      </div>

      {/* Scrollable board */}
      <div className="overflow-x-auto pb-2">
        <div className="inline-flex gap-2" style={{ minWidth: "max-content" }}>
          {days.map((day) => {
            const dayScenes = scenesByDay.get(day) ?? [];
            const eighths = eighthsByDay.get(day) ?? 0;
            const heavy = eighths > 32;
            const loc = primaryLocByDay.get(day) ?? "";
            const ie = intExt(dayScenes);
            const hasNight = dayScenes.some((i) => isNight(i.scene));
            const hasVfx = dayScenes.some((i) => i.scene.has_vfx);
            const hasStunts = dayScenes.some((i) => i.scene.has_stunts);
            const isDialogue = !hasNight && !hasVfx && !hasStunts;

            return (
              <div key={day} className="w-36 flex flex-col">
                {/* Column header */}
                <div
                  className={`rounded-t-lg px-2 py-2 text-center border ${
                    heavy
                      ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
                      : "bg-muted/40 dark:bg-muted/20 border-border"
                  }`}
                >
                  <p className="text-xs font-bold text-foreground">
                    Day {day}
                  </p>
                  {loc && (
                    <p
                      className="text-[10px] text-muted-foreground truncate mt-0.5"
                      title={loc}
                    >
                      {loc}
                    </p>
                  )}
                  <div className="flex items-center justify-center gap-1 mt-1 flex-wrap">
                    {ie && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-secondary-foreground">
                        {ie}
                      </span>
                    )}
                    <span className="text-[9px] text-muted-foreground">
                      {eighths}/8
                    </span>
                  </div>
                  {heavy && (
                    <div className="flex items-center justify-center gap-0.5 mt-1 text-[9px] font-semibold text-red-600 dark:text-red-400">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      HEAVY DAY
                    </div>
                  )}
                </div>

                {/* Cast bars */}
                <div className="border-x border-border bg-card dark:bg-card">
                  {allCharacters.map((char) => {
                    const inDay = dayScenes.some((i) =>
                      i.characters.some((c) => c.id === char.id)
                    );
                    const color = charColor.get(char.id) ?? "#888";
                    const isWrap = charLastDay.get(char.id) === day && inDay;
                    return (
                      <div
                        key={char.id}
                        className="h-5 border-b border-border/40 flex items-center px-1"
                        title={inDay ? char.name : `${char.name} — no call`}
                      >
                        {inDay ? (
                          <div className="flex items-center gap-1 w-full">
                            <div
                              className="h-2.5 flex-1 rounded-sm"
                              style={{
                                backgroundColor: color + "33",
                                border: `1px solid ${color}88`,
                              }}
                            />
                            {isWrap && (
                              <span className="text-[8px] font-bold text-green-600 dark:text-green-400 leading-none">
                                W
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="w-full h-2.5 rounded-sm border border-dashed border-border/30" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Flags */}
                <div className="border-x border-border bg-card dark:bg-card px-1 py-1 flex flex-wrap gap-0.5 min-h-[22px]">
                  {hasNight && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                      night
                    </span>
                  )}
                  {hasVfx && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
                      vfx
                    </span>
                  )}
                  {hasStunts && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700">
                      stunt
                    </span>
                  )}
                  {isDialogue && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
                      dialogue
                    </span>
                  )}
                </div>

                {/* Scene cards */}
                <div className="border border-border rounded-b-lg bg-card dark:bg-card p-1 flex flex-col gap-1 flex-1">
                  {dayScenes.map((item) => (
                    <button
                      key={item.scene.id}
                      type="button"
                      onClick={() =>
                        setSelectedSceneId(
                          item.scene.id === selectedSceneId
                            ? null
                            : item.scene.id
                        )
                      }
                      className={`w-full text-left rounded px-1.5 py-1 text-[10px] border transition-colors ${
                        selectedSceneId === item.scene.id
                          ? "bg-primary/10 border-primary/40 text-primary dark:text-primary"
                          : "bg-background dark:bg-background border-border hover:bg-accent/50 text-foreground"
                      }`}
                    >
                      <p className="font-semibold leading-tight">
                        Sc. {item.scene.scene_number}
                      </p>
                      <p className="text-muted-foreground leading-tight">
                        {item.scene.length_in_eighths ?? 0}/8
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Unscheduled column */}
          {unscheduled.length > 0 && (
            <div className="w-36 flex flex-col">
              <div className="rounded-t-lg px-2 py-2 text-center border border-dashed border-border bg-muted/20 dark:bg-muted/10">
                <p className="text-xs font-bold text-muted-foreground">
                  Unscheduled
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {unscheduled.length} scene
                  {unscheduled.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="border-x border-dashed border-border">
                {allCharacters.map((char) => (
                  <div
                    key={char.id}
                    className="h-5 border-b border-border/20"
                  />
                ))}
              </div>
              <div className="border-x border-dashed border-border px-1 py-1 min-h-[22px]" />
              <div className="border border-dashed border-border rounded-b-lg p-1 flex flex-col gap-1 flex-1">
                {unscheduled.map((item) => (
                  <button
                    key={item.scene.id}
                    type="button"
                    onClick={() =>
                      setSelectedSceneId(
                        item.scene.id === selectedSceneId
                          ? null
                          : item.scene.id
                      )
                    }
                    className={`w-full text-left rounded px-1.5 py-1 text-[10px] border transition-colors ${
                      selectedSceneId === item.scene.id
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "bg-background dark:bg-background border-dashed border-border/60 hover:bg-accent/50 text-muted-foreground"
                    }`}
                  >
                    <p className="font-semibold leading-tight">
                      Sc. {item.scene.scene_number}
                    </p>
                    <p className="text-muted-foreground leading-tight">
                      {item.scene.length_in_eighths ?? 0}/8
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cast legend */}
      {allCharacters.length > 0 && (
        <div className="border border-border rounded-lg p-3 bg-card dark:bg-card">
          <p className="text-xs font-medium text-foreground mb-2">Cast</p>
          <div className="flex flex-wrap gap-3">
            {allCharacters.map((char) => {
              const color = charColor.get(char.id) ?? "#888";
              return (
                <div key={char.id} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs text-foreground">{char.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedItem && (
        <div className="border border-border rounded-lg p-4 bg-card dark:bg-card">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Scene {selectedItem.scene.scene_number}:{" "}
                {selectedItem.scene.heading}
              </p>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {selectedItem.scene.continuity_day && (
                  <span className="text-xs text-muted-foreground">
                    Day {selectedItem.scene.continuity_day}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {selectedItem.scene.length_in_eighths ?? 0} eighths
                </span>
                {isNight(selectedItem.scene) && (
                  <span className="text-xs text-purple-600 dark:text-purple-400">
                    Night
                  </span>
                )}
              </div>
              {selectedItem.characters.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {selectedItem.characters.map((c) => {
                    const color = charColor.get(c.id) ?? "#888";
                    return (
                      <span
                        key={c.id}
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: color + "22",
                          color,
                          border: `1px solid ${color}55`,
                        }}
                      >
                        {c.name}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedSceneId(null)}
              className="text-muted-foreground hover:text-foreground text-sm leading-none shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* CoProducer bar */}
      <div className="rounded-lg bg-teal-600 dark:bg-teal-700 p-3 flex items-center gap-3">
        <Bot className="h-4 w-4 text-white shrink-0" />
        <p className="text-xs text-white flex-1">
          {heaviestDay
            ? `Day ${heaviestDay.day} is heavy at ${heaviestDay.eighths} eighths — CoProducer can rebalance.`
            : days.length > 0
            ? `${days.length} shooting days · ${scenesData.length} scenes · ${totalEighths} eighths.`
            : "Ask CoProducer to generate your shooting schedule."}
        </p>
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new Event("openCoproducer"))
          }
          className="shrink-0 text-xs font-medium text-white border border-white/40 px-2.5 py-1 rounded hover:bg-white/10 transition-colors"
        >
          Ask CoProducer ↗
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-border bg-background px-4 py-3 shadow-lg text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
