"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import {
  ensureElementIds,
  matchTextToElements,
  type ScriptElement,
} from "@/lib/scriptJsonUtils";
import type {
  Project,
  Scene,
  SceneWithCharacters,
  TramLine,
  Character,
} from "./types";

/** API response row (snake_case) from /api/tram-lines */
interface TramLineRow {
  id: string;
  scene_id: string;
  line_number: string;
  color: string;
  start_y: number;
  end_y: number;
  x_position: number;
  camera_direction: string;
  shot_type?: string;
}

function rowToTramLine(row: TramLineRow): TramLine {
  return {
    id: row.id,
    sceneId: row.scene_id,
    lineNumber: row.line_number,
    color: row.color,
    startY: Number(row.start_y),
    endY: Number(row.end_y),
    xPosition: Number(row.x_position),
    cameraDirection: row.camera_direction ?? "",
    shotType: row.shot_type,
  };
}

export function numberToLetters(n: number): string {
  let result = "";
  let num = n;
  while (num > 0) {
    const remainder = (num - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    num = Math.floor((num - 1) / 26);
  }
  return result || "A";
}

export function lettersToNumber(letters: string): number {
  let result = 0;
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.charCodeAt(i) - 64);
  }
  return result;
}

export function findAvailableXPosition(
  newStartY: number,
  newEndY: number,
  existingLines: TramLine[]
): number {
  const baseX = 20;
  const spacing = 14;
  const buffer = 2;

  for (let position = 0; position < 20; position++) {
    const xPos = baseX + position * spacing;
    const linesAtThisX = existingLines.filter(
      (line) => Math.abs(line.xPosition - xPos) < 1
    );
    const hasOverlap = linesAtThisX.some((line) => {
      const lineStart = line.startY - buffer;
      const lineEnd = line.endY + buffer;
      return newStartY <= lineEnd && newEndY >= lineStart;
    });
    if (!hasOverlap) return xPos;
  }
  return baseX + existingLines.length * spacing;
}

/**
 * Find script lines that overlap with tramline visual bounds (elements with data-line-text).
 */
export function extractTextFromDOMByTramlineBounds(
  tramlineElement: HTMLElement
): { actionText: string; characterNames: string } {
  const tramlineRect = tramlineElement.getBoundingClientRect();
  const tramlineTop = tramlineRect.top;
  const tramlineBottom = tramlineRect.bottom;

  const lineElements = document.querySelectorAll("[data-line-text]");
  const overlappingTexts: string[] = [];
  const characterNamesSet = new Set<string>();

  lineElements.forEach((el) => {
    const lineRect = el.getBoundingClientRect();
    const lineCenter = (lineRect.top + lineRect.bottom) / 2;
    if (lineCenter >= tramlineTop && lineCenter <= tramlineBottom) {
      const text = el.getAttribute("data-line-text") ?? "";
      if (text.length > 0) {
        overlappingTexts.push(text);
        if (
          text === text.toUpperCase() &&
          text.length < 40 &&
          !text.startsWith("INT.") &&
          !text.startsWith("EXT.") &&
          !text.includes("CUT TO") &&
          !text.includes("FADE")
        ) {
          characterNamesSet.add(text);
        }
      }
    }
  });

  return {
    actionText: overlappingTexts.join("\n"),
    characterNames: Array.from(characterNamesSet).join(", "),
  };
}

export function useShotList(projectId: string | null) {
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [scenesData, setScenesData] = useState<SceneWithCharacters[]>([]);
  const [scriptId, setScriptId] = useState<string>("");
  const [scriptPageCount, setScriptPageCount] = useState(0);
  const [selectedSceneId, setSelectedSceneId] = useState<string>("");
  const [sceneContent, setSceneContent] = useState<string>("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string>("");
  const [scriptElements, setScriptElements] = useState<ScriptElement[]>([]);
  const [tramLines, setTramLines] = useState<TramLine[]>([]);
  const [tramLinesLoading, setTramLinesLoading] = useState(false);

  const loadProject = useCallback(async (pid: string) => {
    try {
      const list = await api.get<Project[]>("projects/");
      const projects = Array.isArray(list) ? list : [];
      const found = projects.find((p) => p.id === pid);
      if (found) setProject(found);
      else setProject(null);
    } catch {
      setProject(null);
    }
  }, []);

  const [currentScriptData, setCurrentScriptData] = useState<{
    id: string;
    is_current?: boolean;
    page_count?: number;
    is_soft_locked?: boolean;
  } | null>(null);

  const loadScenesAndCharacters = useCallback(async () => {
    if (!projectId) return;
    try {
      const scriptsRes = await api.get<{ scripts: { id: string; is_current?: boolean; page_count?: number; is_soft_locked?: boolean }[] }>(
        `projects/${projectId}/scripts`
      );
      const scripts = (scriptsRes as { scripts?: { id: string; is_current?: boolean; page_count?: number; is_soft_locked?: boolean }[] }).scripts ?? [];
      const currentScript = scripts.find((s) => s.is_current) ?? scripts[0];
      if (!currentScript) {
        setScenesData([]);
        return;
      }
      setScriptId(currentScript.id);
      setScriptPageCount(currentScript.page_count ?? 0);
      setCurrentScriptData(currentScript);

      const [scenesRes, sceneCharsRes, charsRes] = await Promise.all([
        api.get<{ success: boolean; data: Scene[] }>(`scripts/${currentScript.id}/scenes`),
        api.get<{ success: boolean; data: { scene_id: string; character_id: string }[] }>(
          `scripts/${currentScript.id}/scene-characters`
        ),
        api.get<{ success: boolean; data: Character[] }>(`scripts/${currentScript.id}/characters`),
      ]);

      const scenes = (scenesRes as { data?: Scene[] }).data ?? [];
      const sceneChars = (sceneCharsRes as { data?: { scene_id: string; character_id: string }[] }).data ?? [];
      const allChars = (charsRes as { data?: Character[] }).data ?? [];
      const charactersMap = new Map(allChars.map((c) => [c.id, c]));

      const withChars: SceneWithCharacters[] = scenes.map((scene) => {
        const linkedIds = sceneChars
          .filter((sc) => sc.scene_id === scene.id)
          .map((sc) => sc.character_id);
        const characters = linkedIds
          .map((id) => charactersMap.get(id))
          .filter(Boolean) as Character[];
        return {
          scene: { ...scene, script_id: currentScript.id },
          characters,
        };
      });
      setScenesData(withChars);
      if (withChars.length > 0 && !selectedSceneId) {
        const firstId = withChars[0].scene.id;
        setSelectedSceneId(firstId);
      }
    } catch (e) {
      console.error("Error loading scenes and characters:", e);
      setScenesData([]);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      setLoading(true);
      loadProject(projectId).finally(() => setLoading(false));
      loadScenesAndCharacters();
    } else {
      setProject(null);
      setScenesData([]);
    }
  }, [projectId, loadProject, loadScenesAndCharacters]);

  useEffect(() => {
    if (selectedSceneId && scriptId && scenesData.some((s) => s.scene.id === selectedSceneId)) {
      parseSceneContent(selectedSceneId);
    }
  }, [selectedSceneId, scriptId, scenesData]);

  const parseSceneContent = useCallback(
    async (sceneId: string) => {
      if (!scriptId || !sceneId) return;
      const selected = scenesData.find((s) => s.scene.id === sceneId);
      if (!selected) {
        setContentError("Scene not found");
        return;
      }

      setIsLoadingContent(true);
      setContentError("");
      setSceneContent("");

      try {
        const scriptJson = await api.get<{ elements?: ScriptElement[] }>(
          `scripts/${scriptId}/file?variant=json`
        );
        const raw = scriptJson as { elements?: ScriptElement[] };
        const elements = raw.elements ?? [];
        if (!elements.length) {
          setContentError("Invalid script JSON: missing elements");
          return;
        }

        const fullElements = ensureElementIds(elements);
        setScriptElements(fullElements);

        const normalize = (s: string) =>
          s
            .replace(/[^\w\s]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
        const targetHeading = normalize(selected.scene.heading);

        let startIndex = -1;
        for (let i = 0; i < fullElements.length; i++) {
          if (fullElements[i].type === "scene_heading" && normalize(fullElements[i].text) === targetHeading) {
            startIndex = i;
            break;
          }
        }
        if (startIndex === -1) {
          setContentError(`Scene heading not found in script JSON.`);
          return;
        }

        const sceneLines: string[] = [];
        const xPosMap: Record<string, number> = {
          scene_heading: 50,
          action: 50,
          character: 220,
          dialogue: 150,
          parenthetical: 200,
          transition: 350,
        };
        for (let i = startIndex; i < fullElements.length; i++) {
          const el = fullElements[i];
          if (i > startIndex && el.type === "scene_heading") break;
          const xPos = xPosMap[el.type] ?? 50;
          let text = el.text;
          if (el.type === "scene_heading" || el.type === "character" || el.type === "transition")
            text = text.toUpperCase();
          sceneLines.push(`[X:${xPos}]${text}`);
        }
        setSceneContent(sceneLines.join("\n"));
      } catch (e) {
        setContentError(e instanceof Error ? e.message : "Failed to load scene content");
      } finally {
        setIsLoadingContent(false);
      }
    },
    [scriptId, scenesData]
  );

  useEffect(() => {
    if (!selectedSceneId) {
      setTramLines([]);
      return;
    }
    let cancelled = false;
    setTramLinesLoading(true);
    (async () => {
      try {
        const res = await api.get<{ success: boolean; data: TramLineRow[] }>(
          `api/tram-lines?scene_id=${selectedSceneId}`
        );
        const data = (res as { data?: TramLineRow[] }).data ?? [];
        if (!cancelled) {
          const lines = data.map(rowToTramLine).sort((a, b) => lettersToNumber(a.lineNumber) - lettersToNumber(b.lineNumber));
          setTramLines(lines);
        }
      } catch {
        if (!cancelled) setTramLines([]);
      } finally {
        if (!cancelled) setTramLinesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSceneId]);

  const selectScene = useCallback(
    (sceneId: string) => {
      setSelectedSceneId(sceneId);
      parseSceneContent(sceneId);
    },
    [parseSceneContent]
  );

  const createTramLine = useCallback(
    async (body: {
      scene_id: string;
      line_number: string;
      color: string;
      start_y: number;
      end_y: number;
      x_position: number;
      camera_direction?: string;
    }) => {
      const res = await api.post<{ success: boolean; tramLine: TramLineRow }>(
        "api/tram-lines",
        body
      );
      const row = (res as { tramLine?: TramLineRow }).tramLine;
      if (!row) throw new Error("No tramLine in response");
      return rowToTramLine(row);
    },
    []
  );

  const updateTramLine = useCallback(
    async (
      tramlineId: string,
      updates: {
        start_y?: number;
        end_y?: number;
        camera_direction?: string;
        shot_type?: string;
        script_elements?: ScriptElement[];
        character_names?: string;
      }
    ) => {
      await api.put<{ success: boolean; tramLine: TramLineRow }>(
        `api/tram-lines/${tramlineId}`,
        updates
      );
    },
    []
  );

  const deleteTramLine = useCallback(async (tramlineId: string) => {
    await api.delete(`api/tram-lines/${tramlineId}`);
  }, []);

  const syncTramLineFromDOM = useCallback(
    async (tramlineId: string, tramlineEl: HTMLElement | null) => {
      if (!tramlineEl || scriptElements.length === 0) return;
      const { actionText, characterNames } = extractTextFromDOMByTramlineBounds(tramlineEl);
      const structured = matchTextToElements(actionText, scriptElements);
      if (structured.length > 0) {
        await updateTramLine(tramlineId, {
          script_elements: structured,
          character_names: characterNames || undefined,
        });
      }
    },
    [scriptElements, updateTramLine]
  );

  const loadTramLines = useCallback(async () => {
    if (!selectedSceneId) return;
    setTramLinesLoading(true);
    try {
      const res = await api.get<{ success: boolean; data: TramLineRow[] }>(
        `api/tram-lines?scene_id=${selectedSceneId}`
      );
      const data = (res as { data?: TramLineRow[] }).data ?? [];
      const lines = data
        .map(rowToTramLine)
        .sort((a, b) => lettersToNumber(a.lineNumber) - lettersToNumber(b.lineNumber));
      setTramLines(lines);
    } catch {
      setTramLines([]);
    } finally {
      setTramLinesLoading(false);
    }
  }, [selectedSceneId]);

  const totalScenes = scenesData.length;
  const uniqueCharacters = new Set(
    scenesData.flatMap((item) => item.characters.map((c) => c.id))
  ).size;
  const expectedDuration = Math.max(0, scriptPageCount - 1);

  return {
    loading,
    project,
    scenesData,
    scriptId,
    scriptPageCount,
    currentScriptData,
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
    loadProject,
    loadScenesAndCharacters,
    parseSceneContent,
    selectScene,
    setTramLines,
    createTramLine,
    updateTramLine,
    deleteTramLine,
    syncTramLineFromDOM,
    loadTramLines,
  };
}
