"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  User,
  ChevronLeft,
  ChevronRight,
  Plus,
  Sparkles,
  RefreshCw,
  Maximize,
  Loader2,
  Trash2,
} from "lucide-react";
import { StructuredScriptRenderer } from "@/components/StructuredScriptRenderer";
import { ScriptTextRenderer } from "@/components/ScriptTextRenderer";
import type { ScriptElement } from "@/lib/scriptJsonUtils";
import { TramLineSelect } from "./TramLineSelect";
import { useMoodBoard } from "./useMoodBoard";
import type { TramLineWithScene, CanvasComposition, CharacterMood, ObjectViewData } from "./types";
import type { DrawingCanvasRef, DrawingCanvasProps, CanvasImageMeta } from "@/components/DrawingCanvas";
import { api, storageImageUrl } from "@/lib/api";

const DrawingCanvas = dynamic(
  () => import("@/components/DrawingCanvas").then((m) => ({ default: m.DrawingCanvas })),
  { ssr: false }
);

// Used only for read-only pass badge display — AI generation is handled by the CoDesigner sidebar
const PASS_OPTIONS = [
  { value: "sketch",    label: "✏️ Pencil Sketch",  pass: 1 },
  { value: "draft",     label: "🖊️ Ink Draft",       pass: 2 },
  { value: "tonal",     label: "◑ Tonal Study",      pass: 3 },
  { value: "colour",    label: "🎨 Colour Study",     pass: 4 },
  { value: "cinematic", label: "🎬 Cinematic",        pass: 5 },
  { value: "reference", label: "📷 Reference Shot",   pass: 6 },
];

function getSceneNumber(tramLine: TramLineWithScene): string | number {
  return tramLine.scenes?.scene_number ?? "?";
}

// ─── View selector helpers ────────────────────────────────────────────────────

function parseObjectViews(raw: unknown): Record<string, ObjectViewData> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, ObjectViewData>;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

const CROP_ICONS: Record<string, string> = { face: "👤", short: "🧍", full: "🧍" };
const CROP_TYPES = ["face", "short", "full"] as const;
const VIEW_ANGLES = ["front", "side", "back"] as const;

function ViewSelectorCard({
  object,
  canvasRef,
}: {
  object: CharacterMood;
  canvasRef: React.RefObject<DrawingCanvasRef | null>;
}) {
  const views = parseObjectViews(object.object_views);

  // Determine available crop types (person views: face_front, short_side, etc.)
  const availableCrops = CROP_TYPES.filter((crop) =>
    VIEW_ANGLES.some((angle) => views[`${crop}_${angle}`]?.url)
  );
  const isPersonType = availableCrops.length > 0;

  // For scene objects: front/side/back directly
  const availableSceneAngles = VIEW_ANGLES.filter((angle) => views[angle]?.url);

  const [selectedCrop, setSelectedCrop] = useState<string>(availableCrops[0] ?? "face");
  const [selectedAngle, setSelectedAngle] = useState<"front" | "side" | "back">("front");

  // Angles available for the current crop (person) or all scene angles
  const currentAngles = isPersonType
    ? VIEW_ANGLES.filter((angle) => views[`${selectedCrop}_${angle}`]?.url)
    : availableSceneAngles;

  // Ensure selectedAngle is valid after crop switch
  const validAngle = currentAngles.includes(selectedAngle) ? selectedAngle : (currentAngles[0] ?? "front");
  const effectiveAngle = validAngle;

  const currentViewKey = isPersonType ? `${selectedCrop}_${effectiveAngle}` : effectiveAngle;
  const currentViewData = views[currentViewKey];
  const currentViewUrl = storageImageUrl(currentViewData?.url) ?? currentViewData?.url ?? null;

  const handleCropChange = (crop: string) => {
    const anglesForCrop = VIEW_ANGLES.filter((angle) => views[`${crop}_${angle}`]?.url);
    const nextAngle = anglesForCrop.includes(selectedAngle)
      ? selectedAngle
      : (anglesForCrop[0] ?? "front");
    setSelectedCrop(crop);
    setSelectedAngle(nextAngle);
  };

  const goAngle = (dir: 1 | -1) => {
    const idx = currentAngles.indexOf(effectiveAngle);
    const next = currentAngles[(idx + dir + currentAngles.length) % currentAngles.length];
    if (next) setSelectedAngle(next);
  };

  const buildMeta = (): CanvasImageMeta => ({
    character_id: object.id,
    character_name: object.name,
    view_key: currentViewKey,
    object_type: (object as { object_type?: string | null }).object_type ?? "object",
  });

  const buildDragData = () => ({
    name: object.name,
    src: currentViewUrl,
    type: currentViewUrl ? "image" : "placeholder",
    ...buildMeta(),
  });

  return (
    <div
      draggable={!!currentViewUrl}
      onDragStart={(e) => {
        if ((e.target as HTMLElement | null)?.closest("button")) { e.preventDefault(); return; }
        if (!currentViewUrl) { e.preventDefault(); return; }
        e.dataTransfer.setData("application/json", JSON.stringify(buildDragData()));
        e.dataTransfer.setData("text/plain", currentViewUrl);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`relative group flex flex-col items-center bg-secondary rounded-md p-2 border border-border ${currentViewUrl ? "cursor-grab hover:bg-accent" : "opacity-50 cursor-not-allowed"}`}
      onClick={() => {
        if (currentViewUrl) canvasRef.current?.addImage(currentViewUrl, false, buildMeta());
      }}
      title={currentViewUrl ? `Click to place ${object.name} (${currentViewKey}) on canvas` : "No image for this view"}
    >
      {/* Fill canvas button */}
      {currentViewUrl && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            canvasRef.current?.addImage(currentViewUrl!, true, buildMeta());
          }}
          className="absolute -top-2 -right-2 p-1 bg-primary text-primary-foreground rounded-full shadow-md opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:scale-110 z-10"
          title="Fill Canvas"
        >
          <Maximize className="h-3 w-3" />
        </button>
      )}

      {/* Crop type selector (person objects only) */}
      {isPersonType && availableCrops.length > 1 && (
        <div className="flex items-center gap-1.5 mb-1">
          {availableCrops.map((crop) => (
            <button
              key={crop}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCropChange(crop); }}
              className={`text-sm leading-none transition-opacity ${selectedCrop === crop ? "opacity-100" : "opacity-30"}`}
              title={crop}
            >
              {CROP_ICONS[crop]}
            </button>
          ))}
        </div>
      )}

      {/* Image with angle navigation */}
      <div className="flex items-center gap-0.5">
        {currentAngles.length > 1 && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); goAngle(-1); }}
            className="p-0.5 hover:bg-muted rounded shrink-0"
          >
            <ChevronLeft className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
        <div className="h-12 w-12 rounded overflow-hidden bg-muted border border-border shrink-0">
          {currentViewUrl ? (
            <img src={currentViewUrl} alt={`${object.name} ${currentViewKey}`} className="h-full w-full object-cover" />
          ) : (
            <User className="h-4 w-4 m-auto mt-4 text-muted-foreground" />
          )}
        </div>
        {currentAngles.length > 1 && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); goAngle(1); }}
            className="p-0.5 hover:bg-muted rounded shrink-0"
          >
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Name · view_key label */}
      <div className="text-[10px] text-muted-foreground text-center mt-1 max-w-[96px] truncate">
        {object.name} · {currentViewKey}
      </div>
    </div>
  );
}

function MoodBoardContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = (params?.projectId as string) ?? null;
  const tramLineParam = searchParams?.get("tramLine");

  const {
    loading,
    project,
    tramLines,
    characters,
    compositions,
    compositionsLoading,
    loadCompositions,
    saveCanvas,
    deleteComposition,
    refetchCharacters,
  } = useMoodBoard(projectId);

  const [selectedTramLineId, setSelectedTramLineId] = useState<string | null>(
    () => tramLineParam
  );
  const [currentCanvasIndex, setCurrentCanvasIndex] = useState(0);
  const [isNewCanvas, setIsNewCanvas] = useState(false);
  const [canvasNote, setCanvasNote] = useState("");
  const [canvasAspectRatio, setCanvasAspectRatio] = useState("16:9");
  const [isScriptCollapsed, setIsScriptCollapsed] = useState(false);
  const [visionPrompt, setVisionPrompt] = useState("");
  const [moodboardGenerating, setMoodboardGenerating] = useState(false);
  const canvasRef = useRef<DrawingCanvasRef>(null);

  useEffect(() => {
    if (tramLineParam) setSelectedTramLineId(tramLineParam);
  }, [tramLineParam]);

  useEffect(() => {
    loadCompositions(selectedTramLineId);
  }, [selectedTramLineId, loadCompositions]);

  const currentComposition: CanvasComposition | null = isNewCanvas
    ? null
    : compositions[currentCanvasIndex] ?? null;
  const totalCanvases = compositions.length;
  const displayCanvasNumber = isNewCanvas ? totalCanvases + 1 : currentCanvasIndex + 1;

  useEffect(() => {
    if (isNewCanvas) {
      setCanvasNote("");
    } else if (currentComposition?.composition_data?.note) {
      setCanvasNote(String((currentComposition.composition_data as { note?: string }).note ?? ""));
    } else {
      setCanvasNote("");
    }
  }, [currentComposition, isNewCanvas]);

  useEffect(() => {
    setCurrentCanvasIndex(0);
    setIsNewCanvas(false);
    setCanvasNote("");
  }, [selectedTramLineId]);

  useEffect(() => {
    if (compositionsLoading) return;

    // Only auto-open a new canvas when there are truly no saved moodboards.
    if (compositions.length === 0) {
      if (!isNewCanvas) setIsNewCanvas(true);
      return;
    }

    // When saved moodboards exist, default to the first one on load/navigation.
    if (isNewCanvas && currentCanvasIndex === 0) {
      setIsNewCanvas(false);
    }
  }, [compositionsLoading, compositions.length, isNewCanvas, currentCanvasIndex]);

  useEffect(() => {
    setCanvasAspectRatio(project?.aspect_ratio ?? "16:9");
  }, [project?.aspect_ratio]);

  const selectedTramLine = tramLines.find((t) => t.id === selectedTramLineId);

  // Read-only badge showing the pass type of the currently displayed composition
  const passLabel = !isNewCanvas && currentComposition?.composition_data
    ? PASS_OPTIONS.find(
        (o) => o.value === (currentComposition.composition_data as { pass_type?: string }).pass_type
      )?.label ?? null
    : null;

  const currentImagePath = currentComposition?.composition_data
    ? (() => {
        try {
          const data =
            typeof currentComposition.composition_data === "string"
              ? JSON.parse(currentComposition.composition_data)
              : currentComposition.composition_data;
          return (data?.snapshot_path || data?.images?.[0]?.src || null) as string | null;
        } catch {
          return null;
        }
      })()
    : null;
  const currentImageUrl = currentImagePath ? storageImageUrl(currentImagePath) : null;

  // Internal — triggered by the CoDesigner sidebar via the 'generateMoodboard' custom event.
  // Dispatches 'moodboardGenerated' when done so the sidebar can show progress feedback.
  const handleGenerateMoodboard = useCallback(async (passType: string = "sketch", vision?: string) => {
    if (!selectedTramLine || !selectedTramLineId) return;
    const scriptId = selectedTramLine.scenes?.script_id;
    const sceneNumber = selectedTramLine.scenes?.scene_number;
    if (!scriptId || sceneNumber == null) return;
    try {
      await api.post<{ shots_generated: number; shots_skipped: number }>(
        `scripts/${scriptId}/scenes/${sceneNumber}/generate-moodboard`,
        { pass_type: passType, ...(vision ? { vision } : {}) },
        90_000,
      );
      await loadCompositions(selectedTramLineId);
      setIsNewCanvas(false);
      setCurrentCanvasIndex(0);
      window.dispatchEvent(
        new CustomEvent("moodboardGenerated", { detail: { passType, sceneNumber } })
      );
    } catch {
      window.dispatchEvent(
        new CustomEvent("moodboardGenerated", { detail: { passType, sceneNumber, error: true } })
      );
    }
  }, [selectedTramLine, selectedTramLineId, loadCompositions]);

  const handlePassButtonClick = useCallback(async (passType: string) => {
    setMoodboardGenerating(true);
    try {
      await handleGenerateMoodboard(passType, visionPrompt.trim() || undefined);
    } finally {
      setMoodboardGenerating(false);
    }
  }, [handleGenerateMoodboard, visionPrompt]);

  // Bridge: external dispatchers can still trigger generation via this event
  useEffect(() => {
    const handler = (e: Event) => {
      const { passType, vision } = (e as CustomEvent).detail ?? {};
      handleGenerateMoodboard(passType || "sketch", vision || undefined);
    };
    window.addEventListener("generateMoodboard", handler);
    return () => window.removeEventListener("generateMoodboard", handler);
  }, [handleGenerateMoodboard]);

  const handleCanvasSave = useCallback(
    async (blob: Blob, compositionData: Record<string, unknown>) => {
      if (!selectedTramLineId || !projectId || !project) return;
      try {
        const file = new File([blob], `drawing-${Date.now()}.png`, {
          type: "image/png",
        });
        const dataToSave = { ...compositionData, note: canvasNote };
        await saveCanvas({
          tramLineId: selectedTramLineId,
          file,
          compositionData: dataToSave,
          compositionId: isNewCanvas ? undefined : currentComposition?.id,
          aspectRatio: canvasAspectRatio,
        });
        if (isNewCanvas) {
          loadCompositions(selectedTramLineId);
          setIsNewCanvas(false);
        }
      } catch (e) {
        console.error("Error saving canvas:", e);
      }
    },
    [
      selectedTramLineId,
      projectId,
      project,
      canvasNote,
      canvasAspectRatio,
      isNewCanvas,
      currentComposition?.id,
      saveCanvas,
      loadCompositions,
    ]
  );

  const handlePreviousCanvas = () => {
    if (isNewCanvas) {
      setIsNewCanvas(false);
      setCurrentCanvasIndex(Math.max(0, compositions.length - 1));
    } else if (currentCanvasIndex > 0) {
      setCurrentCanvasIndex(currentCanvasIndex - 1);
    }
  };

  const handleNextCanvas = () => {
    if (currentCanvasIndex < compositions.length - 1 && !isNewCanvas) {
      setCurrentCanvasIndex(currentCanvasIndex + 1);
    }
  };

  const handleNewCanvas = () => {
    setIsNewCanvas(true);
    setCurrentCanvasIndex(compositions.length);
  };

  const handleDeleteComposition = useCallback(async () => {
    if (!currentComposition) return;
    const newLength = compositions.length - 1;
    await deleteComposition(currentComposition.id);
    if (newLength === 0) {
      setIsNewCanvas(true);
      setCurrentCanvasIndex(0);
    } else {
      setCurrentCanvasIndex((idx) => Math.min(idx, newLength - 1));
    }
  }, [currentComposition, deleteComposition, compositions.length]);

  const handleVisualize = async () => {
    if (!selectedTramLineId || !projectId) return;
    try {
      const compositionData = (currentComposition?.composition_data ?? {}) as {
        snapshot_path?: string;
        images?: Array<{ src?: string }>;
      };
      const snapshotPath = (compositionData.snapshot_path || "").trim();
      const firstImagePath = (compositionData.images?.[0]?.src || "").trim();
      const resolvedSource = snapshotPath || firstImagePath;
      if (resolvedSource) {
        window.location.href = `/project/${projectId}/visualize?scene=${selectedTramLine?.scene_id ?? ""}&tramLine=${selectedTramLineId}&moodboardImage=${encodeURIComponent(resolvedSource)}`;
        return;
      }
      if (!canvasRef.current) return;
      const dataURL = await canvasRef.current.getCanvasDataURL();
      window.location.href = `/project/${projectId}/visualize?scene=${selectedTramLine?.scene_id ?? ""}&tramLine=${selectedTramLineId}&moodboardImage=${encodeURIComponent(dataURL)}`;
    } catch (e) {
      console.error("Error generating visualization:", e);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="w-full px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col items-center min-h-[60vh] space-y-6 w-full">
          <div className="flex flex-col items-center w-full p-4 sm:p-6 lg:p-8 border-2 border-dashed border-muted rounded-xl bg-muted/10 space-y-6">
            <p className="text-lg font-medium">Select a Tram Line to begin</p>
            <div className="w-full max-w-md">
              <TramLineSelect
                tramLines={tramLines}
                selectedTramLineId={selectedTramLineId}
                onSelect={(id) => setSelectedTramLineId(id)}
              />
            </div>

            {selectedTramLineId && selectedTramLine && (
              <div className="w-full space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="relative bg-gradient-to-br from-slate-900 to-slate-800 rounded-t-lg border-2 border-slate-700 shadow-xl overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-r from-yellow-400 via-slate-900 to-yellow-400 opacity-20" />
                  <div className="pt-10 pb-4 px-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-yellow-400 font-bold text-xs uppercase tracking-wider mb-1">Film</div>
                        <div className="text-white font-mono">{project?.title ?? project?.name ?? "Untitled"}</div>
                      </div>
                      <div>
                        <div className="text-yellow-400 font-bold text-xs uppercase tracking-wider mb-1">Director</div>
                        <div className="text-white font-mono">{project?.director ?? "-"}</div>
                      </div>
                      <div>
                        <div className="text-yellow-400 font-bold text-xs uppercase tracking-wider mb-1">Scene {getSceneNumber(selectedTramLine)}</div>
                        <div className="text-white font-mono font-bold text-lg leading-tight">
                          Scene {getSceneNumber(selectedTramLine)} {selectedTramLine.scenes?.heading ?? ""}
                        </div>
                      </div>
                      <div>
                        <div className="text-yellow-400 font-bold text-xs uppercase tracking-wider mb-1">Shot</div>
                        <div className="text-white font-mono font-bold text-lg">
                          {selectedTramLine.line_number ?? "-"}
                          {selectedTramLine.shot_type && (
                            <span className="text-sm bg-yellow-400/20 text-yellow-300 px-2 py-0.5 rounded ml-2">
                              {selectedTramLine.shot_type}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-yellow-400 font-bold text-xs uppercase tracking-wider mb-1">Date</div>
                        <div className="text-white font-mono font-bold text-lg">{new Date().toLocaleDateString("en-GB")}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <Card>
                  <CardHeader
                    className="cursor-pointer"
                    onClick={() => setIsScriptCollapsed(!isScriptCollapsed)}
                  >
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base text-muted-foreground">Script Section</CardTitle>
                      <span className="text-muted-foreground">{isScriptCollapsed ? "▼" : "▲"}</span>
                    </div>
                  </CardHeader>
                  {!isScriptCollapsed && (
                    <CardContent>
                      <div className="p-4 bg-muted/30 rounded-lg border border-border/50 font-mono text-sm whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                        {selectedTramLine.script_elements && selectedTramLine.script_elements.length > 0 ? (
                          <StructuredScriptRenderer elements={selectedTramLine.script_elements as ScriptElement[]} />
                        ) : (
                          <ScriptTextRenderer text={selectedTramLine.action_text ?? ""} />
                        )}
                      </div>
                    </CardContent>
                  )}
                </Card>

                <div className="flex flex-wrap gap-2 px-1">
                  <span className="text-sm font-medium text-muted-foreground mr-2 flex items-center">Cast:</span>
                  {selectedTramLine.character_names
                    ? selectedTramLine.character_names.split(",").map((name, idx) => {
                        const trimmed = name.trim();
                        if (!trimmed) return null;
                        const character = characters.find(
                          (c) =>
                            c.name.toLowerCase() === trimmed.toLowerCase() &&
                            !(c as { hide_from_view?: boolean }).hide_from_view
                        );
                        if (!character) return null;
                        const castImgUrl = storageImageUrl((character as { character_image_url?: string })?.character_image_url) ?? (character as { character_image_url?: string })?.character_image_url ?? null;
                        return (
                          <div
                            key={idx}
                            draggable
                            onDragStart={(e) => {
                              const data = JSON.stringify({
                                name: trimmed,
                                src: castImgUrl,
                                type: castImgUrl ? "image" : "placeholder",
                                character_id: character.id,
                                character_name: trimmed,
                                view_key: "primary",
                                object_type: (character as { object_type?: string | null }).object_type ?? "character",
                              });
                              e.dataTransfer.setData("application/json", data);
                              if (castImgUrl) e.dataTransfer.setData("text/plain", castImgUrl);
                              e.dataTransfer.effectAllowed = "copy";
                            }}
                            className="flex items-center gap-2 bg-secondary/50 rounded-full pr-3 pl-1 py-1 border border-border/50 cursor-grab"
                          >
                            <Avatar className="h-6 w-6">
                              <AvatarImage
                                src={castImgUrl ?? undefined}
                                alt={trimmed}
                                className="object-cover object-top"
                              />
                              <AvatarFallback className="bg-muted text-muted-foreground">
                                <User className="h-4 w-4" />
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium">{trimmed}</span>
                          </div>
                        );
                      })
                    : (
                      <span className="text-sm text-muted-foreground italic opacity-50">Select a shot to view cast</span>
                    )}
                </div>

                {/* AI Generation — scene vision + pass buttons */}
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Scene Vision
                      </label>
                      <textarea
                        value={visionPrompt}
                        onChange={(e) => setVisionPrompt(e.target.value)}
                        placeholder="Paste your agreed vision here, or leave blank to let CoDesigner interpret the scene..."
                        rows={3}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {PASS_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={moodboardGenerating || !selectedTramLineId}
                          onClick={() => handlePassButtonClick(opt.value)}
                          className="flex flex-col items-start p-2 rounded-md border border-border bg-background hover:bg-accent hover:border-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-left"
                        >
                          <span className="text-xs font-medium leading-tight">{opt.label}</span>
                        </button>
                      ))}
                    </div>
                    {moodboardGenerating && (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-400" />
                        <span className="text-xs text-teal-400">Generating moodboard...</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base text-muted-foreground">Ideas & Notes</CardTitle>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={handlePreviousCanvas} disabled={currentCanvasIndex === 0 && !isNewCanvas}>
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm font-medium min-w-[80px] text-center w-full sm:w-auto">
                          Moodboard {displayCanvasNumber}
                          {totalCanvases > 0 ? ` / ${isNewCanvas ? totalCanvases + 1 : totalCanvases}` : ""}
                        </span>
                        {passLabel && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                            {passLabel}
                          </span>
                        )}
                        {currentImageUrl && (
                          <a
                            href={currentImageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                          >
                            Open full image ↗
                          </a>
                        )}
                        <Button variant="outline" size="sm" onClick={handleNextCanvas} disabled={isNewCanvas || currentCanvasIndex >= compositions.length - 1}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button variant="default" size="sm" onClick={handleNewCanvas} disabled={isNewCanvas}>
                          <Plus className="h-4 w-4" /> Add
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleDeleteComposition} disabled={isNewCanvas || !currentComposition} className="text-destructive hover:text-destructive hover:bg-destructive/10" title="Delete this composition">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <div className="hidden sm:block w-px h-6 bg-border mx-1" />
                        <Button variant="default" size="sm" className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white border-0" onClick={handleVisualize} disabled={!selectedTramLineId}>
                          <Sparkles className="h-4 w-4 mr-2" /> Visualize
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {compositionsLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                    ) : (
                      <DrawingCanvas
                        key={currentComposition?.id ?? `new-${selectedTramLine?.id}`}
                        ref={canvasRef}
                        tramLineId={selectedTramLine?.id ?? ""}
                        initialData={currentComposition?.composition_data as DrawingCanvasProps["initialData"]}
                        onSave={handleCanvasSave}
                        aspectRatio={canvasAspectRatio}
                      />
                    )}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-muted-foreground">Canvas Notes</label>
                      <Textarea
                        placeholder="Add notes about this moodboard composition..."
                        value={canvasNote}
                        onChange={(e) => setCanvasNote(e.target.value)}
                        className="min-h-[100px] resize-y"
                      />
                      <p className="text-xs text-muted-foreground italic">Notes are saved when you save the canvas (Save in the toolbar above).</p>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex flex-col gap-2 mt-4 p-4 border rounded-lg bg-background/50">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-muted-foreground">Project Objects & Assets</h3>
                    <Button variant="ghost" size="sm" onClick={() => refetchCharacters()} className="h-6 px-2 text-muted-foreground hover:text-foreground" title="Refresh">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {characters.filter((c) => (c as { type?: string }).type !== "character" && !(c as { hide_from_view?: boolean }).hide_from_view).length > 0 ? (
                      characters
                        .filter((c) => (c as { type?: string }).type !== "character" && !(c as { hide_from_view?: boolean }).hide_from_view)
                        .map((object) => {
                          const objImgUrl = (object as { character_image_url?: string }).character_image_url;
                          const objImgSrc = storageImageUrl(objImgUrl) ?? objImgUrl ?? null;
                          const objMeta: CanvasImageMeta = {
                            character_id: object.id,
                            character_name: object.name,
                            view_key: "primary",
                            object_type: (object as { object_type?: string | null }).object_type ?? "object",
                          };

                          // Use view selector card if object has any populated views
                          const objViews = parseObjectViews((object as { object_views?: unknown }).object_views);
                          const hasViews = Object.values(objViews).some((v) => !!v?.url);
                          if (hasViews) {
                            return (
                              <ViewSelectorCard
                                key={object.id}
                                object={object as CharacterMood}
                                canvasRef={canvasRef}
                              />
                            );
                          }

                          // Fallback: existing single-image card
                          return (
                            <div
                              key={object.id}
                              draggable={!!objImgSrc}
                              onDragStart={(e) => {
                                const target = e.target as HTMLElement | null;
                                if (target?.closest("button")) {
                                  e.preventDefault();
                                  return;
                                }
                                if (objImgSrc) {
                                  e.dataTransfer.setData("application/json", JSON.stringify({ name: object.name, src: objImgSrc, ...objMeta }));
                                  e.dataTransfer.setData("text/plain", objImgSrc);
                                  e.dataTransfer.effectAllowed = "copy";
                                } else {
                                  e.preventDefault();
                                }
                              }}
                              className={`relative group flex items-center gap-2 bg-secondary rounded-md p-2 border border-border cursor-grab hover:bg-accent ${!objImgSrc ? "opacity-50 cursor-not-allowed" : ""}`}
                              onClick={() => {
                                if (objImgSrc) {
                                  canvasRef.current?.addImage(objImgSrc, false, objMeta);
                                }
                              }}
                              title={objImgSrc ? "Click to place on canvas or drag to position" : "No image available"}
                            >
                              {objImgSrc && (
                                <button
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    canvasRef.current?.addImage(objImgSrc, true, objMeta);
                                  }}
                                  className="absolute -top-2 -right-2 p-1 bg-primary text-primary-foreground rounded-full shadow-md opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:scale-110 z-10"
                                  title="Fill Canvas"
                                >
                                  <Maximize className="h-3 w-3" />
                                </button>
                              )}
                              <div className="h-8 w-8 rounded overflow-hidden bg-muted border border-border shrink-0">
                                {objImgSrc ? (
                                  <img
                                    src={objImgSrc}
                                    alt={object.name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <User className="h-4 w-4 m-auto text-muted-foreground" />
                                )}
                              </div>
                              <span className="text-sm font-medium">{object.name}</span>
                            </div>
                          );
                        })
                    ) : (
                      <div className="w-full py-4 text-center text-sm text-muted-foreground italic bg-muted/20 rounded border border-dashed border-border/50">
                        No objects or assets found.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function MoodBoardPage() {
  return (
    <SessionAuth>
      <MoodBoardContent />
    </SessionAuth>
  );
}
