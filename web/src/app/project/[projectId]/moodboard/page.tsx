"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  User,
  Bot,
  ChevronLeft,
  ChevronRight,
  Plus,
  Sparkles,
  RefreshCw,
  Maximize,
  Loader2,
} from "lucide-react";
import { StructuredScriptRenderer } from "@/components/StructuredScriptRenderer";
import { ScriptTextRenderer } from "@/components/ScriptTextRenderer";
import type { ScriptElement } from "@/lib/scriptJsonUtils";
import { TramLineSelect } from "./TramLineSelect";
import { useMoodBoard } from "./useMoodBoard";
import type { TramLineWithScene, CanvasComposition } from "./types";
import type { DrawingCanvasRef, DrawingCanvasProps } from "@/components/DrawingCanvas";
import { api, storageImageUrl } from "@/lib/api";
import { BlockingDiagram } from "@/components/moodboard/BlockingDiagram";

const DrawingCanvas = dynamic(
  () => import("@/components/DrawingCanvas").then((m) => ({ default: m.DrawingCanvas })),
  { ssr: false }
);

const CANVAS_ASPECT_RATIO_OPTIONS = [
  { value: "16:9", label: "Landscape (16:9) - most common" },
  { value: "9:16", label: "Vertical (9:16) - mobile / social media" },
  { value: "1:1", label: "Square (1:1) - simple / training datasets" },
  { value: "2.39:1", label: "Cinematic (2.39:1) - film style" },
];

function getSceneNumber(tramLine: TramLineWithScene): string | number {
  return tramLine.scenes?.scene_number ?? "?";
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
  const [generatingMoodboard, setGeneratingMoodboard] = useState(false);
  const [generateResult, setGenerateResult] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [ideasMode, setIdeasMode] = useState<"canvas" | "blocking">("canvas");
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
    setIdeasMode("canvas");
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

  const blockingComposition = compositions.find(
    (c) => c.composition_data?.["mode"] === "blocking"
  );
  const blockingData = (blockingComposition?.composition_data ?? null) as {
    mode: string;
    shot_type: string;
    line_label: string;
    characters: Array<{ name: string; x: number; y: number; scale: number; color: string; flip: boolean }>;
    svg_content: string;
  } | null;

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

  const handleGenerateMoodboard = async () => {
    if (!selectedTramLine || !selectedTramLineId) return;
    const scriptId = selectedTramLine.scenes?.script_id;
    const sceneNumber = selectedTramLine.scenes?.scene_number;
    if (!scriptId || sceneNumber == null) return;
    setGeneratingMoodboard(true);
    setGenerateResult(null);
    setGenerateError(null);
    try {
      const res = await api.post<{ shots_generated: number; shots_skipped: number }>(
        `scripts/${scriptId}/scenes/${sceneNumber}/generate-moodboard`,
        {},
        90_000,
      );
      const generated = (res as { shots_generated?: number }).shots_generated ?? 0;
      setGenerateResult(`${generated} shot${generated === 1 ? "" : "s"} generated`);
      await loadCompositions(selectedTramLineId);
      setIsNewCanvas(false);
      setCurrentCanvasIndex(0);
    } catch {
      setGenerateError("Generation failed — please try again.");
    } finally {
      setGeneratingMoodboard(false);
    }
  };

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
                        return (
                          <div
                            key={idx}
                            draggable
                            onDragStart={(e) => {
                              const data = JSON.stringify({
                                name: trimmed,
                                src: storageImageUrl((character as { character_image_url?: string })?.character_image_url) ?? (character as { character_image_url?: string })?.character_image_url ?? null,
                                type: (storageImageUrl((character as { character_image_url?: string })?.character_image_url) ?? (character as { character_image_url?: string })?.character_image_url) ? "image" : "placeholder",
                              });
                              e.dataTransfer.setData("application/json", data);
                              const castSrc = storageImageUrl((character as { character_image_url?: string })?.character_image_url) ?? (character as { character_image_url?: string })?.character_image_url;
                              if (castSrc) e.dataTransfer.setData("text/plain", castSrc);
                              e.dataTransfer.effectAllowed = "copy";
                            }}
                            className="flex items-center gap-2 bg-secondary/50 rounded-full pr-3 pl-1 py-1 border border-border/50 cursor-grab"
                          >
                            <Avatar className="h-6 w-6">
                              <AvatarImage
                                src={storageImageUrl((character as { character_image_url?: string })?.character_image_url) ?? (character as { character_image_url?: string })?.character_image_url ?? undefined}
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

                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base text-muted-foreground">Ideas & Notes</CardTitle>
                        <div className="flex rounded-md border border-border overflow-hidden text-xs shrink-0">
                          <button
                            type="button"
                            onClick={() => setIdeasMode("canvas")}
                            className={`px-3 py-1 transition-colors ${ideasMode === "canvas" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent"}`}
                          >
                            Canvas
                          </button>
                          <button
                            type="button"
                            onClick={() => setIdeasMode("blocking")}
                            className={`px-3 py-1 border-l border-border transition-colors ${ideasMode === "blocking" ? "bg-indigo-600 text-white" : "bg-background text-muted-foreground hover:bg-accent"}`}
                          >
                            Blocking
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {ideasMode === "canvas" && (
                          <>
                            <Button variant="outline" size="sm" onClick={handlePreviousCanvas} disabled={currentCanvasIndex === 0 && !isNewCanvas}>
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-sm font-medium min-w-[80px] text-center w-full sm:w-auto">
                              Moodboard {displayCanvasNumber}
                              {totalCanvases > 0 ? ` / ${isNewCanvas ? totalCanvases + 1 : totalCanvases}` : ""}
                            </span>
                            <Button variant="outline" size="sm" onClick={handleNextCanvas} disabled={isNewCanvas || currentCanvasIndex >= compositions.length - 1}>
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                            <Button variant="default" size="sm" onClick={handleNewCanvas} disabled={isNewCanvas}>
                              <Plus className="h-4 w-4" /> Add
                            </Button>
                            <div className="hidden sm:block w-px h-6 bg-border mx-1" />
                            <Button
                              variant="default"
                              size="sm"
                              className="bg-teal-600 hover:bg-teal-700 text-white border-0"
                              onClick={handleGenerateMoodboard}
                              disabled={generatingMoodboard || !selectedTramLineId}
                              title="CoProducer: generate moodboard images for all shots in this scene"
                            >
                              {generatingMoodboard ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Bot className="h-4 w-4 mr-2" />
                              )}
                              {generatingMoodboard ? "CoProducer thinking..." : "Generate moodboard"}
                            </Button>
                            <div className="hidden sm:block w-px h-6 bg-border mx-1" />
                            <Button variant="default" size="sm" className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white border-0" onClick={handleVisualize} disabled={!selectedTramLineId}>
                              <Sparkles className="h-4 w-4 mr-2" /> Visualize
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {ideasMode === "canvas" ? (
                      <>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-muted-foreground">Canvas Aspect Ratio</label>
                          <Select value={canvasAspectRatio} onValueChange={setCanvasAspectRatio}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CANVAS_ASPECT_RATIO_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
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
                        {generateResult && (
                          <p className="text-xs text-teal-600 dark:text-teal-400 font-medium">{generateResult}</p>
                        )}
                        {generateError && (
                          <p className="text-xs text-destructive">{generateError}</p>
                        )}
                      </>
                    ) : (
                      /* Blocking diagram mode */
                      selectedTramLine?.scenes?.script_id && selectedTramLine.scenes.scene_number != null ? (
                        <BlockingDiagram
                          key={`blocking-${selectedTramLineId}`}
                          scriptId={selectedTramLine.scenes.script_id}
                          sceneNumber={selectedTramLine.scenes.scene_number}
                          lineLabel={selectedTramLine.line_number ?? ""}
                          initialData={blockingData ?? null}
                          onUpdated={() => loadCompositions(selectedTramLineId)}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          Select a shot to view its blocking diagram.
                        </p>
                      )
                    )}
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
                                  e.dataTransfer.setData("application/json", JSON.stringify({ name: object.name, src: objImgSrc }));
                                  e.dataTransfer.setData("text/plain", objImgSrc);
                                  e.dataTransfer.effectAllowed = "copy";
                                } else {
                                  e.preventDefault();
                                }
                              }}
                              className={`relative group flex items-center gap-2 bg-secondary rounded-md p-2 border border-border cursor-grab hover:bg-accent ${!objImgSrc ? "opacity-50 cursor-not-allowed" : ""}`}
                              onClick={() => {
                                if (objImgSrc) {
                                  canvasRef.current?.addImage(objImgSrc, false);
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
                                    canvasRef.current?.addImage(objImgSrc, true);
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
