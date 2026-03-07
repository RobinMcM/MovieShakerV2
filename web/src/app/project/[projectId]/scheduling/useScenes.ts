"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type {
  Project,
  Scene,
  SceneWithCharacters,
  TimeOfDay,
  Character,
  SceneCharacter,
} from "./types";

/** Engine GET /scripts/:id/scenes returns { success, data: SceneResponse[] }. SceneResponse has id, heading, page_number, length_in_eighths, scene_number. */
interface SceneResponse {
  id: string;
  heading: string;
  page_number: string;
  length_in_eighths?: number | null;
  scene_number?: number | null;
  script_id?: string;
  shooting_day?: string | null;
  time_of_day_id?: string | null;
  continuity_day?: number | null;
  scene_location?: string | null;
  scene_details?: string | null;
  location_details?: string | null;
}

/** Engine GET /scripts/:id/scene-characters returns { success, data: { id, scene_id, character_id }[] }. Optional status/notes when backend extends. */
interface SceneCharacterResponse {
  id: string;
  scene_id: string;
  character_id: string;
  status?: string | null;
  notes?: string | null;
}

/** Engine GET /projects/ returns array of { id, name, status, ... }. */
interface ProjectListItem {
  id: string;
  name: string;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  series?: string | null;
  episode?: string | null;
}

export function useScenes(projectId: string | null) {
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [scenesData, setScenesData] = useState<SceneWithCharacters[]>([]);
  const [scriptPageCount, setScriptPageCount] = useState<number>(0);
  const [timeOfDayOptions, setTimeOfDayOptions] = useState<TimeOfDay[]>([]);
  const [shootingDays, setShootingDays] = useState<string[]>([]);
  const [sceneCostsMap, setSceneCostsMap] = useState<Map<string, number>>(
    new Map()
  );
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

  const loadTimeOfDayOptions = useCallback(async () => {
    try {
      const response = await api.get<{ data: TimeOfDay[] }>(
        "/reference/time-of-day"
      );
      const data = (response as { data?: TimeOfDay[] }).data;
      setTimeOfDayOptions(Array.isArray(data) ? data : []);
    } catch {
      setTimeOfDayOptions([]);
    }
  }, []);

  const loadProject = useCallback(
    async (pid: string) => {
      try {
        const list = await api.get<ProjectListItem[]>("/projects/");
        const arr = Array.isArray(list) ? list : [];
        const found = arr.find((p) => p.id === pid);
        if (found) {
          setProject({
            id: found.id,
            name: found.name,
            title: found.name,
            status: found.status,
            start_date: found.start_date ?? null,
            end_date: found.end_date ?? null,
            series: found.series ?? null,
            episode: found.episode ?? null,
          });
        } else {
          setProject(null);
        }
      } catch {
        setProject(null);
        showToast("Error", "Failed to load project details", "destructive");
      }
    },
    [showToast]
  );

  const loadScenesAndCharacters = useCallback(
    async (pid: string) => {
      try {
        const scriptsRes = await api.get<{ scripts: { id: string; is_current: boolean; page_count?: number }[] }>(
          `/projects/${pid}/scripts`
        );
        const scripts = scriptsRes?.scripts ?? [];
        const currentScript = scripts.find((s) => s.is_current);
        if (!currentScript) {
          setScenesData([]);
          setScriptPageCount(0);
          return;
        }

        setScriptPageCount(currentScript.page_count ?? 0);

        const [scenesRes, sceneCharsRes, charsRes] = await Promise.all([
          api.get<{ success: boolean; data: SceneResponse[] }>(
            `/scripts/${currentScript.id}/scenes`
          ),
          api.get<{ success: boolean; data: SceneCharacterResponse[] }>(
            `/scripts/${currentScript.id}/scene-characters`
          ),
          api.get<{ success: boolean; data: { id: string; name: string }[] }>(
            `/scripts/${currentScript.id}/characters`
          ),
        ]);

        const scenes: SceneResponse[] = Array.isArray((scenesRes as { data?: SceneResponse[] }).data)
          ? (scenesRes as { data: SceneResponse[] }).data
          : [];
        const sceneCharacters: SceneCharacterResponse[] = Array.isArray(
          (sceneCharsRes as { data?: SceneCharacterResponse[] }).data
        )
          ? (sceneCharsRes as { data: SceneCharacterResponse[] }).data
          : [];
        const allCharacters: { id: string; name: string }[] = Array.isArray(
          (charsRes as { data?: { id: string; name: string }[] }).data
        )
          ? (charsRes as { data: { id: string; name: string }[] }).data
          : [];

        const charactersMap = new Map<string, Character>(
          allCharacters.map((c) => [
            c.id,
            { id: c.id, name: c.name, script_id: currentScript.id },
          ])
        );

        const uniqueDays = Array.from(
          new Set(scenes.map((s) => (s as SceneResponse & { shooting_day?: string }).shooting_day).filter(Boolean))
        ).sort() as string[];
        setShootingDays(uniqueDays);

        const scenesWithCharacters: SceneWithCharacters[] = scenes.map(
          (scene) => {
            const sceneChars = sceneCharacters
              .filter((sc) => sc.scene_id === scene.id)
              .map((sc) => {
                const character = charactersMap.get(sc.character_id);
                return {
                  id: sc.id,
                  scene_id: sc.scene_id,
                  character_id: sc.character_id,
                  status: sc.status ?? null,
                  notes: sc.notes ?? null,
                  characters: { name: character?.name ?? "Unknown" },
                } as SceneCharacter;
              });
            const characters = sceneChars
              .map((sc) => charactersMap.get(sc.character_id))
              .filter((c): c is Character => c != null);
            return {
              scene: {
                ...scene,
                script_id: currentScript.id,
                scene_characters: sceneChars,
              } as Scene,
              characters,
            };
          }
        );
        setScenesData(scenesWithCharacters);
      } catch {
        setScenesData([]);
        showToast("Error", "Failed to load scenes", "destructive");
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setScenesData([]);
      setScriptPageCount(0);
      setShootingDays([]);
      return;
    }
    setLoading(true);
    Promise.all([
      loadProject(projectId),
      loadScenesAndCharacters(projectId),
      loadTimeOfDayOptions(),
    ])
      .finally(() => setLoading(false));
  }, [projectId, loadProject, loadScenesAndCharacters, loadTimeOfDayOptions]);

  const updateLocalScene = useCallback((sceneId: string, updates: Partial<Scene>) => {
    setScenesData((prev) =>
      prev.map((item) =>
        item.scene.id === sceneId
          ? { ...item, scene: { ...item.scene, ...updates } }
          : item
      )
    );
  }, []);

  const updateLocalSceneCharacter = useCallback(
    (sceneCharacterId: string, updates: Partial<SceneCharacter>) => {
      setScenesData((prev) =>
        prev.map((item) => ({
          ...item,
          scene: {
            ...item.scene,
            scene_characters: item.scene.scene_characters?.map((sc) =>
              sc.id === sceneCharacterId ? { ...sc, ...updates } : sc
            ),
          },
        }))
      );
    },
    []
  );

  const updateSceneField = useCallback(
    async (sceneId: string, field: string, value: string | number | null) => {
      updateLocalScene(sceneId, { [field]: value });
      try {
        await api.put(`/scenes/${sceneId}`, { [field]: value });
      } catch {
        showToast("Error", `Failed to update ${field.replace("_", " ")}`, "destructive");
      }
    },
    [updateLocalScene, showToast]
  );

  const updateCharacterField = useCallback(
    async (sceneCharacterId: string, field: string, value: string | null) => {
      updateLocalSceneCharacter(sceneCharacterId, { [field]: value });
      try {
        await api.put(`/scripts/scene-characters/${sceneCharacterId}`, {
          [field]: value,
        });
      } catch {
        showToast("Error", "Failed to update character", "destructive");
      }
    },
    [updateLocalSceneCharacter, showToast]
  );

  const bulkUpdateSceneLocations = useCallback(
    async (sceneIds: string[], location: string) => {
      setScenesData((prev) =>
        prev.map((item) =>
          sceneIds.includes(item.scene.id)
            ? { ...item, scene: { ...item.scene, scene_location: location } }
            : item
        )
      );
      try {
        await api.put("/scenes/bulk-update", {
          scene_ids: sceneIds,
          updates: { scene_location: location },
        });
        showToast(
          "Grouped",
          `${sceneIds.length} scenes grouped to ${location}`
        );
      } catch {
        showToast("Error", "Failed to update scenes", "destructive");
      }
    },
    [showToast]
  );

  return {
    loading,
    project,
    scenesData,
    scriptPageCount,
    timeOfDayOptions,
    shootingDays,
    sceneCostsMap,
    toastMessage,
    clearToast: () => setToastMessage(null),
    updateSceneField,
    updateCharacterField,
    updateLocalScene,
    updateLocalSceneCharacter,
    bulkUpdateSceneLocations,
  };
}
