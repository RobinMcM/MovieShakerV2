"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type {
  ProjectMood,
  TramLineWithScene,
  CanvasComposition,
  CharacterMood,
} from "./types";

export function useMoodBoard(projectId: string | null) {
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState<ProjectMood | null>(null);
  const [tramLines, setTramLines] = useState<TramLineWithScene[]>([]);
  const [characters, setCharacters] = useState<CharacterMood[]>([]);
  const [compositions, setCompositions] = useState<CanvasComposition[]>([]);
  const [compositionsLoading, setCompositionsLoading] = useState(false);

  const loadProject = useCallback(async (pid: string) => {
    try {
      const list = await api.get<ProjectMood[]>("projects/");
      const projects = Array.isArray(list) ? list : [];
      const found = projects.find((p) => p.id === pid);
      setProject(
        found
          ? {
              id: found.id,
              name: found.name,
              title: (found as { title?: string }).title ?? found.name,
              director: (found as { director?: string }).director,
              aspect_ratio: (found as { aspect_ratio?: string }).aspect_ratio ?? "16:9",
              series: (found as { series?: string }).series,
              episode: (found as { episode?: string }).episode,
            }
          : null
      );
    } catch {
      setProject(null);
    }
  }, []);

  const loadTramLines = useCallback(async (pid: string) => {
    try {
      const res = await api.get<{ success: boolean; tramLines: TramLineWithScene[] }>(
        `projects/${pid}/tram-lines`
      );
      const data = (res as { tramLines?: TramLineWithScene[] }).tramLines ?? [];
      setTramLines(data);
    } catch {
      setTramLines([]);
    }
  }, []);

  const loadCharacters = useCallback(async (pid: string) => {
    try {
      const scriptsRes = await api.get<{ scripts: { id: string; is_current?: boolean }[] }>(
        `projects/${pid}/scripts`
      );
      const scripts = (scriptsRes as { scripts?: { id: string; is_current?: boolean }[] }).scripts ?? [];
      const current = scripts.find((s) => s.is_current) ?? scripts[0];
      if (!current) {
        setCharacters([]);
        return;
      }
      const charsRes = await api.get<{ success: boolean; data: CharacterMood[] }>(
        `scripts/${current.id}/characters`
      );
      const data = (charsRes as { data?: CharacterMood[] }).data ?? [];
      setCharacters(data);
    } catch {
      setCharacters([]);
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setTramLines([]);
      setCharacters([]);
      return;
    }
    setLoading(true);
    Promise.all([
      loadProject(projectId),
      loadTramLines(projectId),
      loadCharacters(projectId),
    ]).finally(() => setLoading(false));
  }, [projectId, loadProject, loadTramLines, loadCharacters]);

  const loadCompositions = useCallback(async (tramLineId: string | null) => {
    if (!tramLineId) {
      setCompositions([]);
      return;
    }
    setCompositionsLoading(true);
    try {
      const res = await api.get<{
        success: boolean;
        compositions: CanvasComposition[];
      }>(`api/moodboard/${tramLineId}/compositions`);
      const data = (res as { compositions?: CanvasComposition[] }).compositions ?? [];
      setCompositions(data);
    } catch {
      setCompositions([]);
    } finally {
      setCompositionsLoading(false);
    }
  }, []);

  const uploadImage = useCallback(
    async (params: {
      tramLineId: string;
      file: File;
      aspectRatio?: string;
    }) => {
      const form = new FormData();
      form.append("tram_line_id", params.tramLineId);
      if (params.aspectRatio) form.append("aspect_ratio", params.aspectRatio);
      form.append("file", params.file);
      const res = await api.postForm<{ success: boolean; path: string }>(
        "api/moodboard/upload",
        form
      );
      return res as { success: boolean; path: string };
    },
    []
  );

  const saveComposition = useCallback(
    async (params: {
      tramLineId: string;
      compositionData: Record<string, unknown>;
      compositionId?: string;
    }) => {
      const res = await api.post<{
        success: boolean;
        composition: CanvasComposition;
      }>("api/moodboard/composition", {
        tram_line_id: params.tramLineId,
        composition_data: params.compositionData,
        id: params.compositionId,
      });
      const comp = (res as { composition?: CanvasComposition }).composition;
      if (comp && params.compositionId) {
        setCompositions((prev) =>
          prev.map((c) => (c.id === comp.id ? comp : c))
        );
      } else if (comp) {
        setCompositions((prev) => [...prev, comp]);
      }
      return comp;
    },
    []
  );

  const saveCanvas = useCallback(
    async (params: {
      tramLineId: string;
      file: File;
      compositionData: Record<string, unknown>;
      compositionId?: string;
      aspectRatio?: string;
    }) => {
      const form = new FormData();
      form.append("tram_line_id", params.tramLineId);
      form.append("composition_data", JSON.stringify(params.compositionData || {}));
      if (params.compositionId) form.append("composition_id", params.compositionId);
      if (params.aspectRatio) form.append("aspect_ratio", params.aspectRatio);
      form.append("file", params.file);
      const res = await api.postForm<{
        success: boolean;
        path: string;
        composition: CanvasComposition;
      }>("api/moodboard/save-canvas", form);
      const comp = (res as { composition?: CanvasComposition }).composition;
      if (comp && params.compositionId) {
        setCompositions((prev) => prev.map((c) => (c.id === comp.id ? comp : c)));
      } else if (comp) {
        setCompositions((prev) => [...prev, comp]);
      }
      return res;
    },
    []
  );

  return {
    loading,
    project,
    tramLines,
    characters,
    compositions,
    compositionsLoading,
    loadCompositions,
    setCompositions,
    uploadImage,
    saveComposition,
    saveCanvas,
    refetchTramLines: () => projectId && loadTramLines(projectId),
    refetchCharacters: () => projectId && loadCharacters(projectId),
  };
}
