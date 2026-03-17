"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import type { CharacterMood } from "../moodboard/types";

export interface ProjectObjects {
  id: string;
  name: string;
  title?: string;
  aspect_ratio?: string | null;
}

export function useObjects(projectId: string | null) {
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState<ProjectObjects | null>(null);
  const [currentScriptId, setCurrentScriptId] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharacterMood[]>([]);
  const [sceneCharacterIds, setSceneCharacterIds] = useState<Set<string>>(new Set());

  const loadProject = useCallback(async (pid: string) => {
    try {
      const list = await api.get<{ id: string; name: string; title?: string; aspect_ratio?: string }[]>("projects/");
      const projects = Array.isArray(list) ? list : [];
      const found = projects.find((p) => p.id === pid);
      setProject(
        found
          ? {
              id: found.id,
              name: found.name,
              title: (found as { title?: string }).title ?? found.name,
              aspect_ratio: (found as { aspect_ratio?: string }).aspect_ratio ?? undefined,
            }
          : null
      );
    } catch {
      setProject(null);
    }
  }, []);

  const loadScriptsAndCharacters = useCallback(async (pid: string) => {
    try {
      const scriptsRes = await api.get<{ scripts: { id: string; is_current?: boolean }[] }>(
        `projects/${pid}/scripts`
      );
      const scripts = (scriptsRes as { scripts?: { id: string; is_current?: boolean }[] }).scripts ?? [];
      const current = scripts.find((s) => s.is_current) ?? scripts[0];
      if (!current) {
        setCurrentScriptId(null);
        setCharacters([]);
        setSceneCharacterIds(new Set());
        return;
      }
      setCurrentScriptId(current.id);
      const [charsRes, sceneCharsRes] = await Promise.all([
        api.get<{ success: boolean; data: CharacterMood[] }>(`scripts/${current.id}/characters`),
        api.get<{ success: boolean; data: { character_id: string }[] }>(
          `scripts/${current.id}/scene-characters`
        ),
      ]);
      const data = (charsRes as { data?: CharacterMood[] }).data ?? [];
      setCharacters(data);
      const ids = new Set(
        ((sceneCharsRes as { data?: { character_id: string }[] }).data ?? []).map((r) => r.character_id)
      );
      setSceneCharacterIds(ids);
    } catch {
      setCurrentScriptId(null);
      setCharacters([]);
      setSceneCharacterIds(new Set());
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setCurrentScriptId(null);
      setCharacters([]);
      setSceneCharacterIds(new Set());
      return;
    }
    setLoading(true);
    Promise.all([loadProject(projectId), loadScriptsAndCharacters(projectId)]).finally(() =>
      setLoading(false)
    );
  }, [projectId, loadProject, loadScriptsAndCharacters]);

  const objects = useMemo(() => {
    return characters.filter((c) => !sceneCharacterIds.has(c.id));
  }, [characters, sceneCharacterIds]);

  const refetch = useCallback(() => {
    if (projectId) {
      setLoading(true);
      Promise.all([loadProject(projectId), loadScriptsAndCharacters(projectId)]).finally(() =>
        setLoading(false)
      );
    }
  }, [projectId, loadProject, loadScriptsAndCharacters]);

  const createObject = useCallback(
    async (params: {
      name: string;
      type: "character" | "object" | "scene";
      casting_notes?: string;
      aspect_ratio?: string;
      series_group?: string;
    }) => {
      if (!currentScriptId) throw new Error("No script");
      const res = await api.post<{ success: boolean; data: CharacterMood }>(
        `scripts/${currentScriptId}/characters`,
        {
          name: params.name.trim(),
          type: params.type,
          casting_notes: params.casting_notes?.trim() || null,
          aspect_ratio: params.aspect_ratio || null,
          series_group: params.series_group || null,
        }
      );
      const data = (res as { data?: CharacterMood }).data;
      if (data) {
        setCharacters((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      }
      return data;
    },
    [currentScriptId]
  );

  const updateObject = useCallback(
    async (characterId: string, updates: { casting_notes?: string; aspect_ratio?: string; hide_from_view?: boolean }) => {
      await api.put(`characters/${characterId}`, updates);
      setCharacters((prev) =>
        prev.map((c) =>
          c.id === characterId
            ? {
                ...c,
                ...updates,
                casting_notes: updates.casting_notes !== undefined ? updates.casting_notes : c.casting_notes,
                aspect_ratio: updates.aspect_ratio !== undefined ? updates.aspect_ratio : c.aspect_ratio,
                hide_from_view: updates.hide_from_view !== undefined ? updates.hide_from_view : c.hide_from_view,
              }
            : c
        )
      );
    },
    []
  );

  const deleteObject = useCallback(async (characterId: string) => {
    await api.delete(`characters/${characterId}`);
    setCharacters((prev) => prev.filter((c) => c.id !== characterId));
  }, []);

  const uploadImage = useCallback(async (characterId: string, file: File) => {
    const form = new FormData();
    form.append("character_id", characterId);
    form.append("file", file);
    const res = await api.postForm<{ success: boolean; path: string; character_image_url: string }>(
      "api/characters/upload",
      form
    );
    const url = (res as { character_image_url?: string }).character_image_url;
    if (url) {
      setCharacters((prev) =>
        prev.map((c) => (c.id === characterId ? { ...c, character_image_url: url } : c))
      );
    }
    return url;
  }, []);

  const generateImage = useCallback(
    async (characterId: string, prompt: string, aspectRatio?: string) => {
      const res = await api.post<{ success: boolean; data: CharacterMood }>(
        `api/characters/${characterId}/generate-image`,
        {
          prompt: prompt.trim(),
          aspect_ratio: aspectRatio || null,
        }
      );
      const data = (res as { data?: CharacterMood }).data;
      if (data) {
        setCharacters((prev) => prev.map((c) => (c.id === characterId ? { ...c, ...data } : c)));
      }
      return data;
    },
    []
  );

  return {
    loading,
    project,
    currentScriptId,
    objects,
    refetch,
    createObject,
    updateObject,
    deleteObject,
    uploadImage,
    generateImage,
  };
}
