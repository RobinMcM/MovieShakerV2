"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type {
  SceneCostConfig,
  SceneCost,
  ProjectCostSummary,
  SceneCostsResponse,
  SceneModifiers,
} from "./types";

interface ProjectListItem {
  id: string;
  name: string;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  series?: string | null;
  episode?: string | null;
}

const BASE = "/api/scene-costs/projects";

function parseGetResponse(raw: unknown): SceneCostsResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.success !== true) return null;
  return raw as SceneCostsResponse;
}

export function useSceneCosts(projectId: string | null) {
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [project, setProject] = useState<{ id: string; name: string; title?: string } | null>(null);
  const [config, setConfig] = useState<SceneCostConfig | null>(null);
  const [sceneCosts, setSceneCosts] = useState<SceneCost[]>([]);
  const [summary, setSummary] = useState<ProjectCostSummary | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    title: string;
    description?: string;
    variant?: "default" | "destructive";
  } | null>(null);

  const showToast = useCallback(
    (
      title: string,
      description?: string,
      variant?: "default" | "destructive"
    ) => {
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
          title: found.name,
        });
      } else {
        setProject(null);
      }
    } catch {
      setProject(null);
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      await loadProject(projectId);
      const raw = await api.get<SceneCostsResponse>(`${BASE}/${projectId}`);
      const data = parseGetResponse(raw) ?? (raw as SceneCostsResponse);
      setConfig(data.config);
      setSceneCosts(data.sceneCosts ?? []);
      if (data.summary) setSummary(data.summary);
      else setSummary(null);
      if (data.sceneCosts?.length && !selectedSceneId) {
        setSelectedSceneId(data.sceneCosts[0].sceneId);
      }
    } catch (e) {
      console.error("Error loading scene costs:", e);
      showToast(
        "Error",
        e instanceof Error ? e.message : "Failed to load scene costs",
        "destructive"
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, loadProject, showToast]);

  const handleCalculate = useCallback(async () => {
    if (!projectId) return;
    setCalculating(true);
    try {
      const raw = await api.post<SceneCostsResponse>(
        `${BASE}/${projectId}/calculate`,
        {}
      );
      const data = raw as SceneCostsResponse;
      setConfig(data.config);
      setSceneCosts(data.sceneCosts ?? []);
      if (data.summary) setSummary(data.summary);
      if (data.sceneCosts?.length) {
        setSelectedSceneId(data.sceneCosts[0].sceneId);
      }
      showToast(
        "Costs Calculated",
        `Calculated costs for ${data.sceneCosts?.length ?? 0} scenes`
      );
    } catch (e) {
      console.error("Error calculating scene costs:", e);
      showToast(
        "Calculation Error",
        e instanceof Error ? e.message : "Failed to calculate scene costs",
        "destructive"
      );
    } finally {
      setCalculating(false);
    }
  }, [projectId, showToast]);

  const handleUpdateConfig = useCallback(
    async (shootDays: number, strategyId: string) => {
      if (!projectId) return;
      try {
        await api.put<{ success: boolean; config: SceneCostConfig }>(
          `${BASE}/${projectId}/config`,
          { shootDays, strategyId }
        );
        await handleCalculate();
        showToast("Config Updated", "Settings saved and costs recalculated");
      } catch (e) {
        console.error("Error updating config:", e);
        showToast(
          "Error",
          e instanceof Error ? e.message : "Failed to update configuration",
          "destructive"
        );
      }
    },
    [projectId, handleCalculate, showToast]
  );

  const handleUpdateModifiers = useCallback(
    async (sceneId: string, modifiers: SceneModifiers) => {
      try {
        await api.put<{ success: boolean }>(
          `/api/scene-costs/scenes/${sceneId}/modifiers`,
          modifiers
        );
        if (projectId) {
          await handleCalculate();
        }
        showToast("Scene Updated", "Costs recalculated with new modifiers");
      } catch (e) {
        console.error("Error updating scene modifiers:", e);
        showToast(
          "Error",
          e instanceof Error ? e.message : "Failed to update scene",
          "destructive"
        );
      }
    },
    [projectId, handleCalculate, showToast]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    loading,
    calculating,
    project,
    config,
    sceneCosts,
    summary,
    selectedSceneId,
    setSelectedSceneId,
    toastMessage,
    clearToast: () => setToastMessage(null),
    refresh: loadData,
    handleCalculate,
    handleUpdateConfig,
    handleUpdateModifiers,
  };
}
