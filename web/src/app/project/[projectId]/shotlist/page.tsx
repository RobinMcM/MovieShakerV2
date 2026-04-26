"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Camera,
  Clapperboard,
  Trash2,
  Palette,
  Eye,
  Bot,
} from "lucide-react";
import { useShotList } from "./useShotList";
import {
  TRAM_COLORS,
  SHOT_TYPES,
  type TramLine,
  type SceneWithCharacters,
} from "./types";
import {
  numberToLetters,
  findAvailableXPosition,
  extractTextFromDOMByTramlineBounds,
} from "./useShotList";
import { matchTextToElements } from "@/lib/scriptJsonUtils";
import { placeSuggestedShots, type ShotSuggestion } from "@/utils/shotPlacement";
import { api } from "@/lib/api";

function parsePageNumber(pageNumber: string): { page: number; eighth: number } {
  const match = pageNumber.match(/Page\s+(\d+)\s+(\d+)\/8/i);
  if (match) return { page: parseInt(match[1], 10), eighth: parseInt(match[2], 10) };
  const simple = pageNumber.match(/Page\s+(\d+)/i);
  if (simple) return { page: parseInt(simple[1], 10), eighth: 0 };
  return { page: 0, eighth: 0 };
}

function ShotListContent() {
  const params = useParams();
  const projectId = (params?.projectId as string) ?? null;
  const {
    loading,
    project,
    scenesData,
    scriptId,
    selectedSceneId,
    sceneContent,
    isLoadingContent,
    contentError,
    scriptElements,
    tramLines,
    tramLinesLoading,
    totalScenes,
    uniqueCharacters,
    expectedDuration,
    selectScene,
    setTramLines,
    createTramLine,
    updateTramLine,
    deleteTramLine,
    syncTramLineFromDOM,
    loadTramLines,
  } = useShotList(projectId);

  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [selectedColor, setSelectedColor] = useState(TRAM_COLORS[0].hex);
  const [draggingLine, setDraggingLine] = useState<{
    id: string;
    type: "ball" | "arrow";
    startY: number;
  } | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [tempCameraDirection, setTempCameraDirection] = useState("");
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    title: string;
    description?: string;
    variant?: "default" | "destructive";
  } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestResult, setSuggestResult] = useState<{
    placed: number;
    skipped: number;
  } | null>(null);
  const scriptContainerRef = useRef<HTMLDivElement>(null);

  const usedColors = useMemo(
    () => new Set(tramLines.map((l) => l.color)),
    [tramLines]
  );

  const sortedScenesData = useMemo(() => {
    const sorted = [...scenesData].sort((a, b) => {
      const numA = a.scene.scene_number ?? 0;
      const numB = b.scene.scene_number ?? 0;
      if (numA !== numB) return numA - numB;
      const aPage = parsePageNumber(a.scene.page_number ?? "");
      const bPage = parsePageNumber(b.scene.page_number ?? "");
      if (aPage.page !== bPage.page) return aPage.page - bPage.page;
      return aPage.eighth - bPage.eighth;
    });
    return sorted;
  }, [scenesData]);

  const currentSceneIndex = selectedSceneId
    ? sortedScenesData.findIndex((s) => s.scene.id === selectedSceneId)
    : -1;

  const currentScene =
    currentSceneIndex >= 0 ? sortedScenesData[currentSceneIndex].scene : null;

  const handlePreviousScene = () => {
    if (currentSceneIndex <= 0) return;
    selectScene(sortedScenesData[currentSceneIndex - 1].scene.id);
  };

  const handleNextScene = () => {
    if (currentSceneIndex < 0 || currentSceneIndex >= sortedScenesData.length - 1)
      return;
    selectScene(sortedScenesData[currentSceneIndex + 1].scene.id);
  };

  const handleCreateLine = async (
    e: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>
  ) => {
    if (!isDrawingMode || !selectedSceneId || e.target !== e.currentTarget) return;
    if (usedColors.has(selectedColor)) return;

    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const containerHeight = container.scrollHeight;
    const relativeY = e.clientY - rect.top;
    const absoluteY = relativeY + container.scrollTop;
    const startYPercent = (absoluteY / containerHeight) * 100;
    const initialLineHeightPercent = 5;
    const endYPercent = startYPercent + initialLineHeightPercent;
    const lineNumber = numberToLetters(tramLines.length + 1);
    const xPosition = findAvailableXPosition(
      startYPercent,
      endYPercent,
      tramLines
    );

    try {
      const newLine = await createTramLine({
        scene_id: selectedSceneId,
        line_number: lineNumber,
        color: selectedColor,
        start_y: startYPercent,
        end_y: endYPercent,
        x_position: xPosition,
        camera_direction: "",
      });
      setTramLines([...tramLines, newLine]);
      setSelectedLineId(newLine.id);
      setEditingLineId(newLine.id);

      const nextColor = TRAM_COLORS.find(
        (c) => !usedColors.has(c.hex) && c.hex !== selectedColor
      );
      if (nextColor) setSelectedColor(nextColor.hex);

      setTimeout(async () => {
        const el = document.querySelector(
          `[data-tramline-id="${newLine.id}"]`
        ) as HTMLElement;
        if (el && scriptElements.length > 0) {
          await syncTramLineFromDOM(newLine.id, el);
        }
      }, 100);
      setToastMessage({ title: "Line created" });
    } catch (err) {
      setToastMessage({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to create line",
        variant: "destructive",
      });
    }
  };

  const handleDragStart = (
    lineId: string,
    type: "ball" | "arrow",
    startY: number,
    e: React.MouseEvent | React.PointerEvent
  ) => {
    e.preventDefault();
    setDraggingLine({ id: lineId, type, startY });
  };

  const handleDragMove = (
    e: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>
  ) => {
    if (!draggingLine) return;
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const containerHeight = container.scrollHeight;
    const relativeY = e.clientY - rect.top;
    const absoluteY = relativeY + container.scrollTop;
    const newYPercent = (absoluteY / containerHeight) * 100;
    const line = tramLines.find((l) => l.id === draggingLine.id);
    if (!line) return;

    let updatedStartY = line.startY;
    let updatedEndY = line.endY;
    if (draggingLine.type === "ball") {
      updatedStartY = Math.min(newYPercent, line.endY - 2);
    } else {
      updatedEndY = Math.max(newYPercent, line.startY + 2);
    }
    setTramLines(
      tramLines.map((l) =>
        l.id === draggingLine.id
          ? { ...l, startY: updatedStartY, endY: updatedEndY }
          : l
      )
    );
  };

  const handleDragEnd = async () => {
    if (!draggingLine) return;
    const line = tramLines.find((l) => l.id === draggingLine.id);
    if (!line) {
      setDraggingLine(null);
      return;
    }
    try {
      await updateTramLine(draggingLine.id, {
        start_y: line.startY,
        end_y: line.endY,
      });
      const el = document.querySelector(
        `[data-tramline-id="${draggingLine.id}"]`
      ) as HTMLElement;
      if (el && scriptElements.length > 0) {
        const { actionText, characterNames } =
          extractTextFromDOMByTramlineBounds(el);
        const structured = matchTextToElements(actionText, scriptElements);
        if (structured.length > 0) {
          await updateTramLine(draggingLine.id, {
            script_elements: structured,
            character_names: characterNames || undefined,
          });
        }
      }
    } catch {
      setToastMessage({
        title: "Error",
        description: "Failed to update line",
        variant: "destructive",
      });
    }
    setDraggingLine(null);
  };

  const handleDeleteLine = async (lineId: string) => {
    try {
      await deleteTramLine(lineId);
      setTramLines(tramLines.filter((l) => l.id !== lineId));
      if (selectedLineId === lineId) setSelectedLineId(null);
      setToastMessage({ title: "Tram line deleted" });
    } catch {
      setToastMessage({
        title: "Error",
        description: "Failed to delete line",
        variant: "destructive",
      });
    }
  };

  const handleCameraDirectionSave = async (lineId: string) => {
    const line = tramLines.find((l) => l.id === lineId);
    if (!line) return;
    const newDirection = tempCameraDirection.trim();
    try {
      await updateTramLine(lineId, { camera_direction: newDirection });
      setTramLines(
        tramLines.map((l) =>
          l.id === lineId ? { ...l, cameraDirection: newDirection } : l
        )
      );
      setEditingLineId(null);
      setTempCameraDirection("");
    } catch {
      setToastMessage({
        title: "Error",
        description: "Failed to save camera direction",
        variant: "destructive",
      });
    }
  };

  const handleShotTypeChange = async (lineId: string, shotType: string) => {
    try {
      await updateTramLine(lineId, { shot_type: shotType });
      setTramLines(
        tramLines.map((l) =>
          l.id === lineId ? { ...l, shotType } : l
        )
      );
      setToastMessage({ title: "Shot type updated" });
    } catch {
      setToastMessage({
        title: "Error",
        description: "Failed to update shot type",
        variant: "destructive",
      });
    }
  };

  async function handleSuggestShots() {
    if (!currentScene || !scriptId) return;
    setSuggesting(true);
    setSuggestResult(null);
    try {
      const response = await api.post<{
        script_id: string;
        scene_number: number;
        suggestions: ShotSuggestion[];
      }>(
        `scripts/${scriptId}/scenes/${currentScene.scene_number}/suggest-shots`,
        {}
      );
      const { suggestions } = response;
      const result = await placeSuggestedShots(
        suggestions,
        scriptContainerRef,
        currentScene.id,
        scriptId,
        tramLines,
        scriptElements,
        (newLine) => {
          setTramLines((prev) => [...prev, newLine]);
        }
      );
      setSuggestResult(result);
      await loadTramLines();
    } catch (err) {
      console.error("Suggest shots failed:", err);
      setToastMessage({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Suggest shots failed",
        variant: "destructive",
      });
    } finally {
      setSuggesting(false);
    }
  }

  async function handleClearShots() {
    if (!confirm('Delete all shots for this scene?')) return;
    for (const line of tramLines) {
      await deleteTramLine(line.id);
    }
    setTramLines([]);
    setSuggestResult(null);
  }

  useEffect(() => {
    const handler = () => handleSuggestShots();
    window.addEventListener("suggestShots", handler);
    return () => window.removeEventListener("suggestShots", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScene, scriptId, tramLines]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-accent/5">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5">
      <AppHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Camera className="h-6 w-6 text-primary" />
              Shot List
            </h1>
          </div>

          <Card>
            <CardContent className="py-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 text-center">
                <div>
                  <p className="text-2xl font-bold text-primary">{totalScenes}</p>
                  <p className="text-sm text-muted-foreground mt-1">Total Scenes</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">{uniqueCharacters}</p>
                  <p className="text-sm text-muted-foreground mt-1">Characters</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">{expectedDuration}</p>
                  <p className="text-sm text-muted-foreground mt-1">Expected Duration (min)</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {project && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    {(project.series || project.episode) && (
                      <p className="text-sm text-muted-foreground">
                        {project.series && project.episode
                          ? `${project.series} • ${project.episode}`
                          : project.series || project.episode}
                      </p>
                    )}
                    <CardTitle className="text-xl">
                      {project.title || project.name}
                    </CardTitle>
                  </div>
                  <div className="flex gap-4 text-sm text-muted-foreground">
                    {project.start_date && (
                      <span>
                        Start:{" "}
                        {new Date(project.start_date).toLocaleDateString("en-GB")}
                      </span>
                    )}
                    {project.end_date && (
                      <span>
                        End:{" "}
                        {new Date(project.end_date).toLocaleDateString("en-GB")}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Shot List</CardTitle>
              <CardDescription>Plan and organize shots for each scene</CardDescription>
            </CardHeader>
            <CardContent>
              {scenesData.length === 0 ? (
                <div className="text-center py-12">
                  <Clapperboard className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    No scenes found. Upload and parse a script to get started.
                  </p>
                </div>
              ) : (
                <>
                  <div className="mb-6">
                    <Label className="text-sm font-medium mb-2 block">
                      Scene Navigation
                    </Label>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-12 w-12 shrink-0"
                        onClick={handlePreviousScene}
                        disabled={currentSceneIndex === 0}
                        title="Previous scene"
                      >
                        <ChevronLeft className="h-6 w-6" />
                      </Button>
                      <Select
                        value={selectedSceneId || ""}
                        onValueChange={(id) => {
                          setSelectedLineId(null);
                          selectScene(id);
                        }}
                      >
                        <SelectTrigger className="flex-1 h-12">
                          <SelectValue placeholder="Select a scene..." />
                        </SelectTrigger>
                        <SelectContent>
                          {sortedScenesData.map((item, index) => (
                            <SelectItem
                              key={item.scene.id}
                              value={item.scene.id}
                            >
                              {item.scene.scene_number ?? index + 1}.{" "}
                              {item.scene.heading}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-12 w-12 shrink-0"
                        onClick={handleNextScene}
                        disabled={
                          currentSceneIndex < 0 ||
                          currentSceneIndex >= sortedScenesData.length - 1
                        }
                        title="Next scene"
                      >
                        <ChevronRight className="h-6 w-6" />
                      </Button>
                    </div>
                  </div>

                  {selectedSceneId && (
                    <>
                      <Card className="mb-4">
                        <CardContent className="py-4">
                          <div className="flex items-center justify-between flex-wrap gap-4">
                            <div className="flex items-center gap-4 flex-wrap">
                              <Button
                                variant={isDrawingMode ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                  setIsDrawingMode(!isDrawingMode);
                                  if (isDrawingMode) setSelectedLineId(null);
                                  else {
                                    const next = TRAM_COLORS.find(
                                      (c) => !usedColors.has(c.hex)
                                    );
                                    if (next) setSelectedColor(next.hex);
                                  }
                                }}
                              >
                                {isDrawingMode ? "Drawing mode ON" : "Enable drawing"}
                              </Button>
                              {isDrawingMode && (
                                <span className="text-sm text-muted-foreground">
                                  Click to add line • Drag handles to adjust
                                </span>
                              )}
                              <button
                                onClick={handleSuggestShots}
                                disabled={suggesting || !currentScene}
                                className={`
                                  flex items-center gap-2 px-3 py-2 rounded-md
                                  text-sm font-medium transition-colors
                                  bg-teal-600 text-white hover:bg-teal-700
                                  disabled:opacity-50 disabled:cursor-not-allowed
                                `}
                              >
                                {suggesting ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    CoProducer thinking...
                                  </>
                                ) : (
                                  <>
                                    <Bot className="h-4 w-4" />
                                    {tramLines.length > 0
                                      ? "Re-suggest shots"
                                      : "Suggest shots"}
                                  </>
                                )}
                              </button>
                              {tramLines.length > 0 && (
                                <button
                                  onClick={handleClearShots}
                                  disabled={suggesting}
                                  className={`
                                    flex items-center gap-2 px-3 py-2 rounded-md
                                    text-sm font-medium transition-colors
                                    bg-destructive text-destructive-foreground hover:bg-destructive/90
                                    disabled:opacity-50 disabled:cursor-not-allowed
                                  `}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Clear shots
                                </button>
                              )}
                              {suggestResult && (
                                <span className="text-xs text-muted-foreground">
                                  {suggestResult.placed} shots placed
                                  {suggestResult.skipped > 0 &&
                                    `, ${suggestResult.skipped} skipped`}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {TRAM_COLORS.map((color) => {
                                const isUsed = usedColors.has(color.hex);
                                return (
                                  <button
                                    key={color.hex}
                                    type="button"
                                    className={`rounded border-2 w-8 h-8 transition-all ${
                                      selectedColor === color.hex
                                        ? "border-foreground scale-110"
                                        : "border-border hover:scale-105"
                                    } ${isUsed ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                                    style={{ backgroundColor: color.hex }}
                                    onClick={() =>
                                      !isUsed && setSelectedColor(color.hex)
                                    }
                                    disabled={isUsed}
                                    title={isUsed ? `${color.name} (used)` : color.name}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">Scene content</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {isLoadingContent ? (
                            <div className="flex items-center justify-center py-8 gap-2">
                              <Loader2 className="h-6 w-6 animate-spin" />
                              <span className="text-muted-foreground">
                                Loading scene...
                              </span>
                            </div>
                          ) : contentError ? (
                            <p className="text-destructive py-4">{contentError}</p>
                          ) : sceneContent ? (
                            <div className="relative bg-background border border-border rounded-md max-w-3xl mx-auto">
                              <div className="relative min-h-[200px]">
                                <div
                                  data-drawing-container
                                  className={`absolute left-0 top-0 w-16 sm:w-24 border-r transition-all ${
                                    isDrawingMode
                                      ? "bg-muted/10 border-primary/30"
                                      : "bg-transparent border-transparent pointer-events-none"
                                  }`}
                                  style={{
                                    minHeight: "100%",
                                    pointerEvents: isDrawingMode ? "auto" : "none",
                                    zIndex: 50,
                                    cursor: isDrawingMode
                                      ? "crosshair"
                                      : draggingLine
                                        ? "grabbing"
                                        : "default",
                                  }}
                                  onPointerDown={handleCreateLine}
                                  onPointerMove={handleDragMove}
                                  onPointerUp={handleDragEnd}
                                  onPointerLeave={handleDragEnd}
                                >
                                  {isDrawingMode &&
                                    tramLines.length === 0 && (
                                      <div className="absolute inset-0 flex items-center justify-center opacity-20 text-xs text-center select-none pointer-events-none">
                                        Click to add line
                                      </div>
                                    )}
                                  {tramLinesLoading ? (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <Loader2 className="h-5 w-5 animate-spin" />
                                    </div>
                                  ) : (
                                    tramLines.map((line) => (
                                      <TramLineMarker
                                        key={line.id}
                                        line={line}
                                        isSelected={selectedLineId === line.id}
                                        sceneIndex={
                                          currentSceneIndex >= 0
                                            ? currentSceneIndex + 1
                                            : 0
                                        }
                                        isDrawingMode={isDrawingMode}
                                        onDragStart={handleDragStart}
                                        onLineClick={() => {
                                          if (isDrawingMode)
                                            setSelectedLineId(line.id);
                                        }}
                                      />
                                    ))
                                  )}
                                </div>
                                <div
                                  ref={scriptContainerRef}
                                  className="font-mono text-sm leading-relaxed p-4 sm:p-8 pl-20 sm:pl-32 relative z-[1] select-none"
                                  style={{
                                    userSelect: isDrawingMode ? "none" : "auto",
                                    pointerEvents: "none",
                                  }}
                                >
                                  {sceneContent.split("\n").map((line, index) => {
                                    const trimmed = line.trim();
                                    const xMatch = trimmed.match(/^\[X:(\d+)\](.+)$/);
                                    if (!xMatch) return <div key={index} className="h-4" />;
                                    const xPos = parseInt(xMatch[1], 10);
                                    const text = xMatch[2];
                                    let className = "";
                                    if (
                                      xPos > 180 &&
                                      xPos < 280 &&
                                      text === text.toUpperCase() &&
                                      text.length < 40
                                    ) {
                                      className =
                                        "text-center font-bold uppercase my-3";
                                    } else if (
                                      (xPos > 140 && xPos < 200) ||
                                      (text.startsWith("(") && text.endsWith(")"))
                                    ) {
                                      className =
                                        "ml-20 italic text-muted-foreground my-1";
                                    } else if (xPos > 100 && xPos < 180) {
                                      className = "ml-12 mr-20 my-1";
                                    } else if (
                                      text === text.toUpperCase() &&
                                      text.includes(":")
                                    ) {
                                      className = "text-right font-semibold my-3";
                                    } else {
                                      className = text.startsWith("INT.") || text.startsWith("EXT.")
                                        ? "font-bold uppercase my-4"
                                        : "my-2";
                                    }
                                    return (
                                      <div
                                        key={index}
                                        className={className}
                                        data-line-index={index}
                                        data-line-text={text}
                                      >
                                        {text}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="text-muted-foreground py-4">
                              No content available
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    </>
                  )}

                  {selectedSceneId && tramLines.length > 0 && (
                    <Card className="mt-4">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Camera className="h-5 w-5" />
                          Camera directions
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {tramLines.map((line) => (
                          <div
                            key={line.id}
                            className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/5"
                          >
                            <div className="flex items-center gap-2 min-w-0 sm:min-w-[60px]">
                              <div
                                className="w-3 h-3 rounded-full ring-2 ring-offset-2 ring-offset-background"
                                style={{ backgroundColor: line.color }}
                              />
                              <span className="font-bold text-sm">
                                {currentSceneIndex >= 0
                                  ? currentSceneIndex + 1
                                  : 0}
                                {line.lineNumber}
                              </span>
                            </div>
                            <div className="w-full sm:w-auto min-w-0 sm:min-w-[140px]">
                              <Select
                                value={line.shotType ?? ""}
                                onValueChange={(value) =>
                                  handleShotTypeChange(line.id, value)
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Shot type" />
                                </SelectTrigger>
                                <SelectContent>
                                  {SHOT_TYPES.map((t) => (
                                    <SelectItem key={t.value} value={t.value}>
                                      {t.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex-1 min-w-0">
                              <input
                                type="text"
                                className="w-full px-3 py-2 text-sm border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20 rounded"
                                value={
                                  editingLineId === line.id
                                    ? tempCameraDirection
                                    : line.cameraDirection
                                }
                                onChange={(e) =>
                                  setTempCameraDirection(e.target.value)
                                }
                                onFocus={() => {
                                  setEditingLineId(line.id);
                                  setTempCameraDirection(line.cameraDirection);
                                }}
                                onBlur={() => handleCameraDirectionSave(line.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleCameraDirectionSave(line.id);
                                    (e.target as HTMLInputElement).blur();
                                  }
                                  if (e.key === "Escape") {
                                    setEditingLineId(null);
                                    setTempCameraDirection("");
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                placeholder="e.g. Wide shot, dolly left..."
                              />
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                title="Mood board"
                              >
                                <Link
                                  href={`/project/${projectId}/moodboard?scene=${selectedSceneId}&tramLine=${line.id}`}
                                >
                                  <Palette className="h-4 w-4" />
                                </Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                title="Visualize"
                              >
                                <Link
                                  href={`/project/${projectId}/visualize?scene=${selectedSceneId}&tramLine=${line.id}`}
                                >
                                  <Eye className="h-4 w-4" />
                                </Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteLine(line.id)}
                                title="Delete line"
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {toastMessage && (
            <div
              className={`fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-3 shadow-lg ${
                toastMessage.variant === "destructive"
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : "border-border bg-background"
              }`}
            >
              <p className="font-medium">{toastMessage.title}</p>
              {toastMessage.description && (
                <p className="mt-1 text-sm opacity-90">
                  {toastMessage.description}
                </p>
              )}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function TramLineMarker({
  line,
  isSelected,
  sceneIndex,
  isDrawingMode,
  onDragStart,
  onLineClick,
}: {
  line: TramLine;
  isSelected: boolean;
  sceneIndex: number;
  isDrawingMode: boolean;
  onDragStart: (
    lineId: string,
    type: "ball" | "arrow",
    startY: number,
    e: React.PointerEvent | React.MouseEvent
  ) => void;
  onLineClick: () => void;
}) {
  const isInsert =
    line.shotType === "INSERT" || line.shotType === "insert";

  return (
    <div
      data-tramline-id={line.id}
      className="absolute flex flex-col items-center pointer-events-auto"
      style={{
        top: `${line.startY}%`,
        height: `${line.endY - line.startY}%`,
        left: `${line.xPosition}px`,
        zIndex: isSelected ? 30 : 15,
        transform: isSelected ? "scale(1.05)" : "scale(1)",
        transition: "all 0.2s ease",
        opacity: isInsert ? 0.75 : 1,
      }}
    >
      <div
        className="absolute -top-2 left-1/2 -translate-x-1/2 z-30 w-6 h-6 flex items-center justify-center cursor-grab"
        onPointerDown={(e) => {
          if (!isDrawingMode) return;
          e.stopPropagation();
          onDragStart(line.id, "ball", line.startY, e);
        }}
        title="Drag to move line start"
      >
        <div
          className="flex flex-col items-center"
          style={{ opacity: isSelected ? 1 : 0.7 }}
        >
          <div
            className="bg-white border border-white/50 rounded-sm"
            style={{
              width: 12,
              height: 2,
              backgroundColor: line.color,
              borderColor: "white",
            }}
          />
          <div
            className="rounded-sm"
            style={{
              width: 2,
              height: 8,
              backgroundColor: line.color,
              border: "1px solid rgba(255,255,255,0.5)",
            }}
          />
        </div>
      </div>
      {isInsert && (
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
          style={{ fontSize: 9, opacity: 0.8, color: line.color, whiteSpace: "nowrap" }}
        >
          INSERT
        </div>
      )}
      <div
        className="h-full w-1 cursor-pointer transition-all"
        style={{
          backgroundColor: line.color,
          border: isInsert
            ? isSelected
              ? "2px dashed white"
              : "1px dashed rgba(255,255,255,0.4)"
            : isSelected
              ? "2px solid white"
              : "1px solid rgba(255,255,255,0.2)",
          opacity: isSelected ? 1 : 0.8,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onLineClick();
        }}
      />
      <div
        className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-30 w-6 h-6 flex items-center justify-center cursor-grab"
        onPointerDown={(e) => {
          if (!isDrawingMode) return;
          e.stopPropagation();
          onDragStart(line.id, "arrow", line.endY, e);
        }}
        title="Drag to extend line"
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: "8px solid transparent",
            borderRight: "8px solid transparent",
            borderTop: `10px solid ${line.color}`,
            opacity: isSelected ? 1 : 0.7,
          }}
        />
      </div>
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background/90 rounded shadow-sm border border-border text-xs font-bold px-1.5 py-0.5 z-10 pointer-events-none"
      >
        {sceneIndex}
        {line.lineNumber}
      </div>
    </div>
  );
}

export default function ShotListPage() {
  return (
    <SessionAuth>
      <ShotListContent />
    </SessionAuth>
  );
}
