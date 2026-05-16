"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Camera,
  CheckCircle2,
  Circle,
  Clapperboard,
  ExternalLink,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CameraState {
  id: number;
  connected: boolean;
  role: string | null;
  operatorName?: string | null;
  metadata?: { deviceName?: string };
}

interface ActiveShot {
  id: string;
  title: string;
  sceneHeading: string;
  sceneNumber: string;
  lineNumber: string;
  cameraRole: string | null;
  shotType: string | null;
  framingNotes: string | null;
  movementNotes: string | null;
  durationTarget: number | null;
  characterNames: string | null;
}

interface BoxContext {
  cameras: CameraState[];
  activeShot: ActiveShot | null;
}

interface Shot {
  id: string;
  lineNumber: string;
  shotType: string | null;
  cameraRole: string | null;
  sceneId: string;
  sceneHeading: string;
  sceneNumber: string;
}

interface Take {
  id: string;
  take_number: number;
  camera_role: string;
  status: string;
  duration: number | null;
  video_path: string | null;
  started_at: string | null;
  completed_at: string | null;
  shot_line_number: string | null;
  shot_type: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
  A_CAM: "bg-blue-600",
  B_CAM: "bg-purple-600",
  GIMBAL_CAM: "bg-amber-600",
  BTS_CAM: "bg-green-600",
};

const ROLE_LABEL: Record<string, string> = {
  A_CAM: "A CAM",
  B_CAM: "B CAM",
  GIMBAL_CAM: "GIMBAL",
  BTS_CAM: "BTS",
};

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <span className="text-muted-foreground text-xs">Unassigned</span>;
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-bold text-white ${ROLE_COLORS[role] ?? "bg-gray-600"}`}
    >
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CameraCard({ camera }: { camera: CameraState }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Camera {camera.id}
          </span>
          {camera.connected ? (
            <span className="flex items-center gap-1 text-xs font-medium text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Live
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Circle className="h-3.5 w-3.5" />
              Offline
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <RoleBadge role={camera.role} />
        {camera.operatorName && (
          <p className="text-xs text-muted-foreground">{camera.operatorName}</p>
        )}
        {camera.metadata?.deviceName && (
          <p className="truncate text-xs text-muted-foreground">{camera.metadata.deviceName}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page inner (rendered inside SessionAuth)
// ---------------------------------------------------------------------------

function OnSetDashboardInner() {
  const params = useParams();
  const projectId =
    typeof params.projectId === "string" ? params.projectId : params.projectId?.[0];

  const [context, setContext] = useState<BoxContext | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [takes, setTakes] = useState<Take[]>([]);
  const [selectedShotId, setSelectedShotId] = useState<string>("");

  const [contextError, setContextError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [settingShot, setSettingShot] = useState(false);
  const [clearingShot, setClearingShot] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadContext = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.get<{
        success: boolean;
        cameras: CameraState[];
        activeShot: ActiveShot | null;
      }>(`/projects/${projectId}/box/context`);
      setContext({ cameras: res.cameras, activeShot: res.activeShot });
      setContextError(null);
    } catch (e) {
      setContextError((e as Error).message);
    }
  }, [projectId]);

  const loadShots = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.get<{ success: boolean; shots: Shot[] }>(
        `/projects/${projectId}/box/shots`
      );
      setShots(res.shots ?? []);
    } catch {
      // non-critical — selector simply stays empty
    }
  }, [projectId]);

  const loadTakes = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.get<{ success: boolean; takes: Take[] }>(
        `/projects/${projectId}/takes`
      );
      setTakes(res.takes ?? []);
    } catch {
      // non-critical
    }
  }, [projectId]);

  useEffect(() => {
    loadContext();
    loadShots();
    loadTakes();
    pollRef.current = setInterval(() => {
      loadContext();
      loadTakes();
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadContext, loadShots, loadTakes]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleSync = async () => {
    if (!projectId) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await api.post<{
        success: boolean;
        sceneCount: number;
        shotCount: number;
        cameraCount: number;
      }>(`/projects/${projectId}/sync-to-box`, {});
      setSyncMsg(
        `Synced ${res.sceneCount} scenes, ${res.shotCount} shots, ${res.cameraCount} cameras.`
      );
      await loadContext();
      await loadShots();
    } catch (e) {
      setSyncMsg(`Sync failed: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleLaunchBox = async () => {
    if (!projectId) return;
    setLaunching(true);
    try {
      const res = await api.post<{ success: boolean; launchUrl: string }>(
        `/projects/${projectId}/launch-box`,
        {}
      );
      if (res.launchUrl) {
        window.open(res.launchUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setSyncMsg(`Launch failed: ${(e as Error).message}`);
    } finally {
      setLaunching(false);
    }
  };

  const handleSetActiveShot = async () => {
    if (!projectId || !selectedShotId) return;
    setSettingShot(true);
    try {
      await api.post(`/projects/${projectId}/box/active-shot`, { shotId: selectedShotId });
      await loadContext();
    } catch (e) {
      alert(`Failed to set active shot: ${(e as Error).message}`);
    } finally {
      setSettingShot(false);
    }
  };

  const handleClearActiveShot = async () => {
    if (!projectId) return;
    setClearingShot(true);
    try {
      await api.delete(`/projects/${projectId}/box/active-shot`);
      await loadContext();
    } catch (e) {
      alert(`Failed to clear active shot: ${(e as Error).message}`);
    } finally {
      setClearingShot(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const cameras: CameraState[] = context?.cameras ?? [
    { id: 1, connected: false, role: null },
    { id: 2, connected: false, role: null },
    { id: 3, connected: false, role: null },
  ];

  const activeShot = context?.activeShot ?? null;
  const connectedCount = cameras.filter((c) => c.connected).length;

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="container mx-auto max-w-6xl flex-1 space-y-8 px-4 py-8">

        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clapperboard className="h-6 w-6" />
            <div>
              <h1 className="text-2xl font-bold">On Set</h1>
              <p className="text-sm text-muted-foreground">
                {connectedCount} of {cameras.length} cameras live · auto-refresh every 5s
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {syncMsg && (
              <p
                className={`text-sm ${
                  syncMsg.startsWith("Sync failed")
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {syncMsg}
              </p>
            )}
            <Button onClick={handleSync} disabled={syncing} variant="outline" size="sm">
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {syncing ? "Syncing…" : "Sync to Box"}
            </Button>
            <Button onClick={handleLaunchBox} disabled={launching} size="sm">
              {launching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
              {launching ? "Opening…" : "Open in aFilmInABox"}
            </Button>
          </div>
        </div>

        {/* aFilmInABox connectivity error */}
        {contextError && (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            aFilmInABox unreachable: {contextError}
          </div>
        )}

        {/* Cameras */}
        <section>
          <h2 className="mb-3 text-lg font-semibold">Cameras</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {cameras.map((cam) => (
              <CameraCard key={cam.id} camera={cam} />
            ))}
          </div>
        </section>

        {/* Active Shot */}
        <section>
          <h2 className="mb-3 text-lg font-semibold">Active Shot</h2>
          <Card>
            <CardContent className="space-y-4 pt-6">
              {activeShot ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium">{activeShot.title}</p>
                  <p className="text-xs text-muted-foreground">{activeShot.sceneHeading}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {activeShot.shotType && (
                      <Badge variant="outline">{activeShot.shotType}</Badge>
                    )}
                    {activeShot.cameraRole && <RoleBadge role={activeShot.cameraRole} />}
                    {activeShot.durationTarget && (
                      <Badge variant="secondary">{activeShot.durationTarget}s target</Badge>
                    )}
                  </div>
                  {activeShot.framingNotes && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      <span className="font-medium">Framing:</span> {activeShot.framingNotes}
                    </p>
                  )}
                  {activeShot.movementNotes && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Movement:</span> {activeShot.movementNotes}
                    </p>
                  )}
                  {activeShot.characterNames && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Characters:</span> {activeShot.characterNames}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No active shot set.</p>
              )}

              {/* Shot selector */}
              <div className="flex items-center gap-2 pt-2">
                <Select value={selectedShotId} onValueChange={setSelectedShotId}>
                  <SelectTrigger className="flex-1 text-sm">
                    <SelectValue placeholder="Select a shot…" />
                  </SelectTrigger>
                  <SelectContent>
                    {shots.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.sceneHeading} — Shot {s.lineNumber}
                        {s.shotType ? ` (${s.shotType})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleSetActiveShot}
                  disabled={!selectedShotId || settingShot}
                  size="sm"
                >
                  {settingShot ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Set Active"
                  )}
                </Button>
                {activeShot && (
                  <Button
                    onClick={handleClearActiveShot}
                    disabled={clearingShot}
                    variant="ghost"
                    size="sm"
                  >
                    {clearingShot ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Takes */}
        <section>
          <h2 className="mb-3 text-lg font-semibold">Takes ({takes.length})</h2>
          {takes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No takes recorded yet.</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Take</th>
                    <th className="px-4 py-2 text-left font-medium">Shot</th>
                    <th className="px-4 py-2 text-left font-medium">Camera</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-left font-medium">Duration</th>
                    <th className="px-4 py-2 text-left font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {takes.map((t) => (
                    <tr key={t.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 font-mono">#{t.take_number}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {t.shot_line_number
                          ? `Shot ${t.shot_line_number}${t.shot_type ? ` · ${t.shot_type}` : ""}`
                          : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <RoleBadge role={t.camera_role} />
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant={
                            t.status === "completed"
                              ? "default"
                              : t.status === "rejected"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {t.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {formatDuration(t.duration)}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {formatTime(t.completed_at ?? t.started_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}

export default function OnSetPage() {
  return (
    <SessionAuth>
      <OnSetDashboardInner />
    </SessionAuth>
  );
}
