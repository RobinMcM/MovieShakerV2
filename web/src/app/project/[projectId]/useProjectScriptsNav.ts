"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

interface ScriptNavItem {
  id: string;
  name: string;
  uploaded_at: string;
  is_current: boolean;
}

export function useProjectScriptsNav(projectId: string | null) {
  const [scripts, setScripts] = useState<ScriptNavItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setScripts([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await api.get<{ scripts: ScriptNavItem[] }>(`/projects/${projectId}/scripts`);
        if (cancelled) return;
        setScripts(Array.isArray(res?.scripts) ? res.scripts : []);
      } catch {
        if (!cancelled) setScripts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const sortedScripts = useMemo(() => {
    return [...scripts].sort((a, b) => {
      if (a.is_current && !b.is_current) return -1;
      if (!a.is_current && b.is_current) return 1;
      return new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime();
    });
  }, [scripts]);

  return {
    scripts: sortedScripts,
    loading,
  };
}
