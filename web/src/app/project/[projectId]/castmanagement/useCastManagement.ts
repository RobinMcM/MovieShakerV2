"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type {
  Project,
  ScriptListItem,
  Character,
  CharacterResponseItem,
} from "./types";

interface ProjectListItem {
  id: string;
  name: string;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  series?: string | null;
  episode?: string | null;
  casting_location?: string | null;
}

interface ScriptsResponse {
  scripts: Array<{
    id: string;
    project_id: string;
    name: string;
    is_current: boolean;
    uploaded_at?: string;
  }>;
}

interface CharactersResponse {
  success?: boolean;
  data?: CharacterResponseItem[];
}

export function useCastManagement(projectId: string | null) {
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [currentScript, setCurrentScript] = useState<ScriptListItem | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [toastMessage, setToastMessage] = useState<{
    title: string;
    description?: string;
    variant?: "default" | "destructive";
  } | null>(null);

  const showToast = useCallback(
    (title: string, description?: string, variant?: "default" | "destructive") => {
      setToastMessage({ title, description, variant });
    },
    []
  );

  const loadProject = useCallback(async (pid: string) => {
    try {
      const list = await api.get<ProjectListItem[]>("/projects/");
      const arr = Array.isArray(list) ? list : [];
      const found = arr.find((p) => p.id === pid);
      if (found) {
        setProject({
          id: found.id,
          name: found.name,
          status: found.status,
          start_date: found.start_date ?? null,
          end_date: found.end_date ?? null,
          series: found.series ?? null,
          episode: found.episode ?? null,
          casting_location: found.casting_location ?? null,
        });
      } else {
        setProject(null);
      }
    } catch {
      setProject(null);
      showToast("Error", "Failed to load project", "destructive");
    }
  }, [showToast]);

  const loadScriptsAndCharacters = useCallback(
    async (pid: string) => {
      try {
        const scriptsRes = await api.get<ScriptsResponse>(`/projects/${pid}/scripts`);
        const scripts = scriptsRes?.scripts ?? [];
        const current = scripts.find((s) => s.is_current) ?? scripts[0] ?? null;
        setCurrentScript(current);

        if (!current) {
          setCharacters([]);
          return;
        }

        const charRes = await api.get<CharactersResponse>(`/scripts/${current.id}/characters`);
        const rawData = (charRes as { data?: CharacterResponseItem[] }).data;
        const charList = Array.isArray(rawData) ? rawData : [];

        const normalizedCharacters: Character[] = charList.map((c) => ({
          id: c.id,
          name: c.name,
          casting_notes: null,
        }));

        setCharacters(normalizedCharacters);
      } catch {
        setCurrentScript(null);
        setCharacters([]);
        showToast("Error", "Failed to load scripts or characters", "destructive");
      }
    },
    [showToast]
  );

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      await loadProject(projectId);
      await loadScriptsAndCharacters(projectId);
    } finally {
      setLoading(false);
    }
  }, [projectId, loadProject, loadScriptsAndCharacters]);

  const updateCastingNotes = useCallback(
    async (characterId: string, notes: string) => {
      if (!projectId) return;
      try {
        await api.put(`/api/characters/${characterId}`, { casting_notes: notes });
        setCharacters((prev) =>
          prev.map((c) =>
            c.id === characterId ? { ...c, casting_notes: notes } : c
          )
        );
        showToast("Saved", "Casting notes updated");
      } catch {
        showToast("Error", "Failed to save casting notes", "destructive");
      }
    },
    [projectId, showToast]
  );

  const updateCastingLocation = useCallback(
    async (location: string) => {
      if (!projectId) return;
      try {
        await api.put(`/projects/${projectId}`, { casting_location: location });
        setProject((prev) =>
          prev ? { ...prev, casting_location: location } : null
        );
        showToast("Saved", "Casting location updated");
      } catch {
        showToast("Error", "Failed to save casting location", "destructive");
      }
    },
    [projectId, showToast]
  );

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setCurrentScript(null);
      setCharacters([]);
      return;
    }
    setLoading(true);
    loadProject(projectId)
      .then(() => loadScriptsAndCharacters(projectId))
      .finally(() => setLoading(false));
  }, [projectId, loadProject, loadScriptsAndCharacters]);

  return {
    loading,
    project,
    currentScript,
    characters,
    toastMessage,
    clearToast: () => setToastMessage(null),
    refresh,
    updateCastingNotes,
    updateCastingLocation,
  };
}
