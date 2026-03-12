"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { ApiConfig, VideoHistoryItem, CompiledVideo } from "./types";
import type { ProjectMood, TramLineWithScene } from "../moodboard/types";

export function useVisualize(projectId: string | null) {
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState<ProjectMood | null>(null);
  const [tramLines, setTramLines] = useState<TramLineWithScene[]>([]);
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [videoHistory, setVideoHistory] = useState<VideoHistoryItem[]>([]);
  const [compiledVideos, setCompiledVideos] = useState<CompiledVideo[]>([]);

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

  const loadApiConfig = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; config: ApiConfig }>("api/config/status");
      const cfg = (res as { config?: ApiConfig }).config;
      setApiConfig(cfg ?? null);
    } catch {
      setApiConfig(null);
    }
  }, []);

  const loadVideoHistory = useCallback(async (tramLineId: string | null) => {
    if (!tramLineId) {
      setVideoHistory([]);
      return;
    }
    try {
      const res = await api.get<{ success: boolean; videos: VideoHistoryItem[] }>(
        `api/video-history/${tramLineId}`
      );
      setVideoHistory((res as { videos?: VideoHistoryItem[] }).videos ?? []);
    } catch {
      setVideoHistory([]);
    }
  }, []);

  const loadCompiledVideos = useCallback(async (tramLineId: string | null) => {
    if (!tramLineId) {
      setCompiledVideos([]);
      return;
    }
    try {
      const res = await api.get<{ success: boolean; compiledVideos: CompiledVideo[] }>(
        `api/compiled-videos/${tramLineId}`
      );
      setCompiledVideos((res as { compiledVideos?: CompiledVideo[] }).compiledVideos ?? []);
    } catch {
      setCompiledVideos([]);
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setTramLines([]);
      setVideoHistory([]);
      setCompiledVideos([]);
      return;
    }
    setLoading(true);
    Promise.all([
      loadProject(projectId),
      loadTramLines(projectId),
      loadApiConfig(),
    ]).finally(() => setLoading(false));
  }, [projectId, loadProject, loadTramLines, loadApiConfig]);

  const refetchVideoHistory = useCallback(
    (tramLineId: string | null) => {
      loadVideoHistory(tramLineId);
    },
    [loadVideoHistory]
  );

  const refetchCompiledVideos = useCallback(
    (tramLineId: string | null) => {
      loadCompiledVideos(tramLineId);
    },
    [loadCompiledVideos]
  );

  const toggleVideoPrint = useCallback(
    async (videoId: string, isPrint: boolean, tramLineId: string) => {
      await api.patch(`api/video-history/${videoId}/print`, { is_print: isPrint });
      loadVideoHistory(tramLineId);
    },
    [loadVideoHistory]
  );

  const deleteVideo = useCallback(
    async (videoId: string, tramLineId: string) => {
      await api.delete(`api/video-history/${videoId}`);
      loadVideoHistory(tramLineId);
    },
    [loadVideoHistory]
  );

  const deleteCompiledVideo = useCallback(
    async (compiledId: string, tramLineId: string) => {
      await api.delete(`api/compiled-videos/${compiledId}`);
      loadCompiledVideos(tramLineId);
    },
    [loadCompiledVideos]
  );

  const toggleMovieShakerTVPrint = useCallback(
    async (compiledId: string, showOnTV: boolean, tramLineId: string) => {
      await api.patch(`api/compiled-videos/${compiledId}/status`, {
        youtube_upload_status: showOnTV ? "submitted_to_movieshaker_tv" : null,
      });
      loadCompiledVideos(tramLineId);
    },
    [loadCompiledVideos]
  );

  return {
    loading,
    project,
    tramLines,
    apiConfig,
    videoHistory,
    compiledVideos,
    loadVideoHistory,
    loadCompiledVideos,
    refetchVideoHistory,
    refetchCompiledVideos,
    toggleVideoPrint,
    deleteVideo,
    deleteCompiledVideo,
    toggleMovieShakerTVPrint,
  };
}
