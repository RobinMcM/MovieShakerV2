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

export interface ObjectImageModelOption {
  id: string;
  name?: string;
  provider?: string;
  status?: string;
  media_type_support?: string[];
  default_for_media_type?: string | null;
}

export interface BackgroundLocation {
  location_name: string;
  location_type: string | null;
  scene_numbers: number[];
  background_id: string | null;
  image_url: string | null;
  has_background: boolean;
}

const CHARACTER_OBJECT_TYPES = new Set([
  "actor_full",
  "actor_body",
  "actor_head",
  "principal",
  "supporting",
  "voice",
  "entity",
]);

const ARTIFACT_OBJECT_TYPES = new Set([
  "prop",
  "vehicle",
  "set_piece",
  "artifact",
]);

export function useObjects(projectId: string | null) {
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState<ProjectObjects | null>(null);
  const [currentScriptId, setCurrentScriptId] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharacterMood[]>([]);
  const [backgroundLocations, setBackgroundLocations] = useState<BackgroundLocation[]>([]);
  const [objectImageModels, setObjectImageModels] = useState<ObjectImageModelOption[]>([]);

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

  const loadBackgroundLocations = useCallback(async (scriptId: string) => {
    try {
      const res = await api.get<{ success: boolean; data: BackgroundLocation[] }>(
        `scripts/${scriptId}/backgrounds`
      );
      const data = (res as { data?: BackgroundLocation[] }).data ?? [];
      setBackgroundLocations(data);
    } catch {
      setBackgroundLocations([]);
    }
  }, []);

  const loadScriptsAndCharacters = useCallback(async (pid: string): Promise<string | null> => {
    try {
      const scriptsRes = await api.get<{ scripts: { id: string; is_current?: boolean }[] }>(
        `projects/${pid}/scripts`
      );
      const scripts = (scriptsRes as { scripts?: { id: string; is_current?: boolean }[] }).scripts ?? [];
      const current = scripts.find((s) => s.is_current) ?? scripts[0];
      if (!current) {
        setCurrentScriptId(null);
        setCharacters([]);
        return null;
      }
      setCurrentScriptId(current.id);
      const charsRes = await api.get<{ success: boolean; data: CharacterMood[] }>(
        `scripts/${current.id}/characters`
      );
      const data = (charsRes as { data?: CharacterMood[] }).data ?? [];
      setCharacters(data);
      return current.id;
    } catch {
      setCurrentScriptId(null);
      setCharacters([]);
      return null;
    }
  }, []);

  const loadConfigModels = useCallback(async () => {
    try {
      const res = await api.get<{
        success: boolean;
        config?: { objectImageModels?: ObjectImageModelOption[] };
      }>("api/config/status");
      const options = (res as { config?: { objectImageModels?: ObjectImageModelOption[] } }).config?.objectImageModels;
      setObjectImageModels(Array.isArray(options) ? options : []);
    } catch {
      setObjectImageModels([]);
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setCurrentScriptId(null);
      setCharacters([]);
      setBackgroundLocations([]);
      return;
    }
    setLoading(true);
    Promise.all([
      loadProject(projectId),
      loadScriptsAndCharacters(projectId).then((scriptId) => {
        if (scriptId) void loadBackgroundLocations(scriptId);
      }),
    ]).finally(() => setLoading(false));
    void loadConfigModels();
  }, [projectId, loadProject, loadScriptsAndCharacters, loadBackgroundLocations, loadConfigModels]);

  // Categorise by object_type. Legacy records with no object_type fall into the Characters tab.
  const characterObjects = useMemo(() => {
    return characters.filter((c: CharacterMood) => {
      if (!c.object_type) return true;
      return CHARACTER_OBJECT_TYPES.has(c.object_type);
    });
  }, [characters]);

  const backgroundObjects = useMemo(() => {
    return characters.filter((c: CharacterMood) => c.object_type === "background");
  }, [characters]);

  const artifactObjects = useMemo(() => {
    return characters.filter((c: CharacterMood) => c.object_type != null && ARTIFACT_OBJECT_TYPES.has(c.object_type!));
  }, [characters]);

  const refetch = useCallback(() => {
    if (projectId) {
      setLoading(true);
      Promise.all([
        loadProject(projectId),
        loadScriptsAndCharacters(projectId).then((scriptId) => {
          if (scriptId) void loadBackgroundLocations(scriptId);
        }),
      ]).finally(() => setLoading(false));
      void loadConfigModels();
    }
  }, [projectId, loadProject, loadScriptsAndCharacters, loadBackgroundLocations, loadConfigModels]);

  const createObject = useCallback(
    async (params: {
      name: string;
      type: "character" | "object" | "scene";
      object_type?: string;
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
          object_type: params.object_type || null,
          casting_notes: params.casting_notes?.trim() || null,
          aspect_ratio: params.aspect_ratio || null,
          series_group: params.series_group || null,
        }
      );
      const data = (res as { data?: CharacterMood }).data;
      if (data) {
        setCharacters((prev: CharacterMood[]) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      }
      return data;
    },
    [currentScriptId]
  );

  const updateObject = useCallback(
    async (characterId: string, updates: {
      casting_notes?: string;
      aspect_ratio?: string;
      hide_from_view?: boolean;
      object_type?: string;
    }) => {
      await api.put(`characters/${characterId}`, updates);
      setCharacters((prev: CharacterMood[]) =>
        prev.map((c: CharacterMood) =>
          c.id === characterId ? { ...c, ...updates } : c
        )
      );
    },
    []
  );

  const deleteObject = useCallback(async (characterId: string) => {
    await api.delete(`characters/${characterId}`);
    setCharacters((prev: CharacterMood[]) => prev.filter((c: CharacterMood) => c.id !== characterId));
  }, []);

  const uploadImage = useCallback(async (characterId: string, file: File) => {
    const form = new FormData();
    form.append("character_id", characterId);
    form.append("file", file);
    const res = await api.postForm<{
      success: boolean;
      path: string;
      character_image_url: string;
      object_views?: Record<string, { url: string; is_dynamic: boolean; video_url: string | null }>;
    }>("api/characters/upload", form);
    const url = res.character_image_url;
    if (url) {
      setCharacters((prev: CharacterMood[]) =>
        prev.map((c: CharacterMood) =>
          c.id === characterId
            ? { ...c, character_image_url: url, ...(res.object_views ? { object_views: res.object_views } : {}) }
            : c
        )
      );
    }
    return url;
  }, []);

  const uploadViewImage = useCallback(async (characterId: string, viewKey: string, file: File): Promise<void> => {
    const form = new FormData();
    form.append("character_id", characterId);
    form.append("file", file);
    form.append("view_key", viewKey);
    const res = await api.postForm<{
      success: boolean;
      path: string;
      character_image_url: string | null;
      object_views: Record<string, { url: string; is_dynamic: boolean; video_url: string | null }>;
    }>("api/characters/upload", form);
    setCharacters((prev: CharacterMood[]) =>
      prev.map((c: CharacterMood) =>
        c.id === characterId && res.object_views
          ? { ...c, object_views: res.object_views }
          : c
      )
    );
  }, []);

  const updateObjectView = useCallback(
    async (characterId: string, viewKey: string, url: string, isDynamic: boolean = false, videoUrl: string | null = null): Promise<void> => {
      const res = await api.patch<{ success: boolean; data: CharacterMood }>(
        `characters/${characterId}/views`,
        { view_key: viewKey, url, is_dynamic: isDynamic, video_url: videoUrl }
      );
      const data = (res as { data?: CharacterMood }).data;
      if (data) {
        setCharacters((prev: CharacterMood[]) =>
          prev.map((c: CharacterMood) => (c.id === characterId ? { ...c, ...data } : c))
        );
      }
    },
    []
  );

  const generateImage = useCallback(
    async (characterId: string, prompt: string, aspectRatio?: string, model?: string | null) => {
      const res = await api.post<{
        success: boolean;
        data: CharacterMood;
        gateway?: { request_body?: Record<string, unknown>; model_used?: string | null };
      }>(
        `api/characters/${characterId}/generate-image`,
        { prompt: prompt.trim(), aspect_ratio: aspectRatio || null, model: model || null }
      );
      const data = (res as { data?: CharacterMood }).data;
      if (data) {
        setCharacters((prev: CharacterMood[]) => prev.map((c: CharacterMood) => (c.id === characterId ? { ...c, ...data } : c)));
      }
      return res;
    },
    []
  );

  const generateBackgroundSketch = useCallback(
    async (
      scriptId: string,
      locationName: string,
      locationType: string | null,
      sceneNumbers: number[],
      aspectRatio?: string,
      model?: string | null
    ) => {
      const res = await api.post<{
        success: boolean;
        character_id: string;
        image_url: string;
        location_name: string;
      }>(
        `scripts/${scriptId}/backgrounds/generate-sketch`,
        {
          location_name: locationName,
          location_type: locationType || null,
          scene_numbers: sceneNumbers,
          aspect_ratio: aspectRatio || "16:9",
          model: model || null,
        }
      );
      await loadBackgroundLocations(scriptId);
      return res;
    },
    [loadBackgroundLocations]
  );

  const uploadBackgroundImage = useCallback(
    async (
      scriptId: string,
      locationName: string,
      existingCharacterId: string | null,
      file: File
    ): Promise<void> => {
      let charId = existingCharacterId;
      if (!charId) {
        // Create background character first if none exists yet
        const created = await createObject({
          name: locationName,
          type: "object",
          object_type: "background",
          aspect_ratio: "16:9",
        });
        charId = created?.id ?? null;
      }
      if (!charId) throw new Error("Failed to create background character");
      await uploadImage(charId, file);
      await loadBackgroundLocations(scriptId);
    },
    [createObject, uploadImage, loadBackgroundLocations]
  );

  return {
    loading,
    project,
    currentScriptId,
    objectImageModels,
    characterObjects,
    backgroundObjects,
    artifactObjects,
    backgroundLocations,
    refetch,
    createObject,
    updateObject,
    deleteObject,
    uploadImage,
    uploadViewImage,
    updateObjectView,
    generateImage,
    generateBackgroundSketch,
    uploadBackgroundImage,
  };
}
