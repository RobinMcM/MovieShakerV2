"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import {
  Loader2,
  Target,
  Wallet,
  Megaphone,
  Ticket,
  Save,
  Printer,
} from "lucide-react";

import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";

interface ProjectData {
  id: string;
  name: string;
  description?: string | null;
}

interface ConfigStatusResponse {
  success: boolean;
  config: {
    gatewayConnected: boolean;
    hasGatewayKey: boolean;
  };
}

interface PlanData {
  format: string;
  genre: string;
  whyNow: string;
  comps: string;
  targetAudience: string;
  writer: string;
  budgetMvp: string;
  budgetTarget: string;
  budgetStretch: string;
  sourceGrants: string;
  sourcePrivate: string;
  sourceCrowd: string;
  sourceInKind: string;
  logline: string;
  synopsis: string;
  visualTone: string;
  contentPlan: string;
  channels: string;
  pressOutlets: string;
  tier1: string;
  tier2: string;
  tier3: string;
  distribution: string;
}

interface DocChapter {
  chapterNumber: number;
  title: string;
  summary: string;
  visuals: string;
}

interface InterviewCandidate {
  role: string;
  description: string;
}

interface DocResult {
  logline: string;
  thematicStatement: string;
  chapters: DocChapter[];
  interviewCandidates: InterviewCandidate[];
  visualStyle: string;
  bRollWishlist: string[];
  script?: string | Array<{ VIDEO?: string; AUDIO?: string; video?: string; audio?: string }>;
}

interface FestivalAnalysisResult {
  writer: string;
  format: string;
  genreTone: string;
  whyNow: string;
  comps: string;
  targetAudience: string;
}

interface FundingAnalysisResult {
  budgetMvp: string;
  budgetTarget: string;
  budgetStretch: string;
  sourceGrants: string;
  sourcePrivate: string;
  sourceCrowd: string;
  sourceInKind: string;
}

interface MarketingAnalysisResult {
  logline: string;
  synopsis: string;
  visualTone: string;
  contentPlan: string;
  channels: string;
  pressOutlets: string;
}

interface FestivalStrategyResult {
  tier1: string;
  tier2: string;
  tier3: string;
  distribution: string;
}

const INITIAL_DATA: PlanData = {
  format: "",
  genre: "",
  whyNow: "",
  comps: "",
  targetAudience: "",
  writer: "",
  budgetMvp: "",
  budgetTarget: "",
  budgetStretch: "",
  sourceGrants: "",
  sourcePrivate: "",
  sourceCrowd: "",
  sourceInKind: "",
  logline: "",
  synopsis: "",
  visualTone: "",
  contentPlan: "",
  channels: "",
  pressOutlets: "",
  tier1: "",
  tier2: "",
  tier3: "",
  distribution: "",
};

function extractScriptText(input: DocResult["script"]): string {
  if (!input) return "";
  if (typeof input === "string") return input;
  return input
    .map((line) => `${line.VIDEO || line.video || ""}\n${line.AUDIO || line.audio || ""}`.trim())
    .filter(Boolean)
    .join("\n\n");
}

function TheFilmFestivalPage() {
  const params = useParams<{ projectId?: string | string[] }>();
  const searchParams = useSearchParams();
  const projectIdFromPath =
    typeof params.projectId === "string" ? params.projectId : params.projectId?.[0] ?? null;
  const projectId = searchParams.get("project") ?? projectIdFromPath;

  const [title, setTitle] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [generatingFunding, setGeneratingFunding] = useState(false);
  const [generatingMarketing, setGeneratingMarketing] = useState(false);
  const [generatingFestivals, setGeneratingFestivals] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [formData, setFormData] = useState<PlanData>(INITIAL_DATA);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [configStatus, setConfigStatus] = useState<ConfigStatusResponse["config"] | null>(null);

  const localStorageKey = useMemo(
    () => (projectId ? `film-festival-plan-${projectId}` : null),
    [projectId]
  );

  useEffect(() => {
    if (!projectId) return;
    void loadProjectDetails(projectId);
  }, [projectId]);

  useEffect(() => {
    void loadConfigStatus();
  }, []);

  useEffect(() => {
    if (!localStorageKey) return;
    try {
      const saved = localStorage.getItem(localStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<PlanData> & { title?: string; savedAt?: string };
      setFormData((prev) => ({ ...prev, ...parsed }));
      if (parsed.title) setTitle(parsed.title);
      if (parsed.savedAt) setLastSaved(new Date(parsed.savedAt));
    } catch {
      // Ignore malformed local data
    }
  }, [localStorageKey]);

  async function loadProjectDetails(id: string) {
    try {
      setLoading(true);
      const list = await api.get<ProjectData[]>("/projects/");
      const found = (Array.isArray(list) ? list : []).find((p) => p.id === id) ?? null;
      if (found) {
        setTitle((prev) => prev || found.name || "");
        setProjectDescription(found.description || "");
      }
    } catch {
      setMessage({ kind: "error", text: "Failed to load project details." });
    } finally {
      setLoading(false);
    }
  }

  async function loadConfigStatus() {
    try {
      const res = await api.get<ConfigStatusResponse>("/api/config/status");
      if (res?.success) {
        setConfigStatus(res.config);
      } else {
        setConfigStatus(null);
      }
    } catch {
      setConfigStatus(null);
    }
  }

  function updateField(field: keyof PlanData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!localStorageKey) {
      setMessage({ kind: "error", text: "Missing project context. Open this page from a project." });
      return;
    }
    try {
      setSaving(true);
      localStorage.setItem(
        localStorageKey,
        JSON.stringify({
          ...formData,
          title,
          savedAt: new Date().toISOString(),
        })
      );
      setLastSaved(new Date());
      setMessage({ kind: "success", text: "Draft saved to this browser." });
    } catch {
      setMessage({ kind: "error", text: "Failed to save draft." });
    } finally {
      setSaving(false);
    }
  }

  async function generateDoc(prompt: string): Promise<DocResult> {
    const result = await api.post<{ result: DocResult }>("/api/film-in-a-box/generate", {
      title: title.trim() || "Untitled project",
      prompt,
      type: "DOC",
    }, 90000);
    return result.result;
  }

  async function generateText(prompt: string): Promise<string> {
    const result = await api.post<{ result: string }>("/api/film-in-a-box/generate", {
      title: title.trim() || "Untitled project",
      prompt,
      type: "FILM",
    }, 90000);
    return typeof result.result === "string" ? result.result : "";
  }

  async function handleAnalyzeScript() {
    if (!configStatus?.gatewayConnected || !configStatus?.hasGatewayKey) {
      setMessage({ kind: "error", text: "AI gateway is not connected. Please try again shortly." });
      return;
    }
    if (!projectId) {
      setMessage({ kind: "error", text: "Missing project context. Open this page from a project." });
      return;
    }
    try {
      setAnalyzing(true);
      setMessage(null);
      const response = await api.post<{ result: FestivalAnalysisResult }>(
        "/api/film-in-a-box/festival-analyze",
        {
          projectId,
          title: title.trim() || "Untitled project",
          projectDescription: projectDescription.trim(),
        },
        90000
      );
      const res = response.result;
      setFormData((prev) => ({
        ...prev,
        writer: res.writer || prev.writer,
        format: res.format || prev.format,
        genre: res.genreTone || prev.genre,
        whyNow: res.whyNow || prev.whyNow,
        comps: res.comps || prev.comps,
        targetAudience: res.targetAudience || prev.targetAudience,
      }));
      setMessage({ kind: "success", text: "Film festival positioning fields updated from script analysis." });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not analyze project.",
      });
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleGenerateFunding() {
    if (!configStatus?.gatewayConnected || !configStatus?.hasGatewayKey) {
      setMessage({ kind: "error", text: "AI gateway is not connected. Please try again shortly." });
      return;
    }
    if (!projectId) {
      setMessage({ kind: "error", text: "Missing project context. Open this page from a project." });
      return;
    }
    try {
      setGeneratingFunding(true);
      setMessage(null);
      const response = await api.post<{ result: FundingAnalysisResult }>(
        "/api/film-in-a-box/funding-analyze",
        {
          projectId,
          title: title.trim() || "Untitled project",
          logline: formData.logline.trim(),
          genre: formData.genre.trim(),
          projectDescription: projectDescription.trim(),
        },
        90000
      );
      const res = response.result;
      setFormData((prev) => ({
        ...prev,
        budgetMvp: res.budgetMvp || prev.budgetMvp,
        budgetTarget: res.budgetTarget || prev.budgetTarget,
        budgetStretch: res.budgetStretch || prev.budgetStretch,
        sourceGrants: res.sourceGrants || prev.sourceGrants,
        sourcePrivate: res.sourcePrivate || prev.sourcePrivate,
        sourceCrowd: res.sourceCrowd || prev.sourceCrowd,
        sourceInKind: res.sourceInKind || prev.sourceInKind,
      }));
      setMessage({ kind: "success", text: "Funding fields updated from script analysis." });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not generate funding guidance.",
      });
    } finally {
      setGeneratingFunding(false);
    }
  }

  async function handleGenerateMarketing() {
    if (!configStatus?.gatewayConnected || !configStatus?.hasGatewayKey) {
      setMessage({ kind: "error", text: "AI gateway is not connected. Please try again shortly." });
      return;
    }
    if (!projectId) {
      setMessage({ kind: "error", text: "Missing project context. Open this page from a project." });
      return;
    }
    try {
      setGeneratingMarketing(true);
      setMessage(null);
      const response = await api.post<{ result: MarketingAnalysisResult }>(
        "/api/film-in-a-box/marketing-analyze",
        {
          projectId,
          title: title.trim() || "Untitled project",
          logline: formData.logline.trim(),
          genre: formData.genre.trim(),
          projectDescription: projectDescription.trim(),
        },
        90000
      );
      const res = response.result;
      setFormData((prev) => ({
        ...prev,
        logline: res.logline || prev.logline,
        synopsis: res.synopsis || prev.synopsis,
        visualTone: res.visualTone || prev.visualTone,
        contentPlan: res.contentPlan || prev.contentPlan,
        channels: res.channels || prev.channels,
        pressOutlets: res.pressOutlets || prev.pressOutlets,
      }));
      setMessage({ kind: "success", text: "Marketing fields updated from script analysis." });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not generate marketing guidance.",
      });
    } finally {
      setGeneratingMarketing(false);
    }
  }

  async function handleGenerateFestivals() {
    if (!configStatus?.gatewayConnected || !configStatus?.hasGatewayKey) {
      setMessage({ kind: "error", text: "AI gateway is not connected. Please try again shortly." });
      return;
    }
    if (!projectId) {
      setMessage({ kind: "error", text: "Missing project context. Open this page from a project." });
      return;
    }
    try {
      setGeneratingFestivals(true);
      setMessage(null);
      const response = await api.post<{ result: FestivalStrategyResult }>(
        "/api/film-in-a-box/festival-strategy-analyze",
        {
          projectId,
          title: title.trim() || "Untitled project",
          genre: formData.genre.trim(),
          logline: formData.logline.trim(),
          projectDescription: projectDescription.trim(),
        },
        90000
      );
      const res = response.result;
      setFormData((prev) => ({
        ...prev,
        tier1: res.tier1 || prev.tier1,
        tier2: res.tier2 || prev.tier2,
        tier3: res.tier3 || prev.tier3,
        distribution: res.distribution || prev.distribution,
      }));
      setMessage({ kind: "success", text: "Festival strategy fields updated from script analysis." });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not generate festival strategy.",
      });
    } finally {
      setGeneratingFestivals(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <main className="flex-1 container mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center justify-end gap-3">
          <h1 className="text-2xl font-bold text-center">The Film Festival</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="print:hidden"
          >
            <Printer className="h-4 w-4 mr-2" />
            Print Strategy
          </Button>
        </div>

        {message && (
          <div
            className={`p-3 rounded-md text-sm ${
              message.kind === "error"
                ? "bg-destructive/10 text-destructive border border-destructive/20"
                : "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Project Info</CardTitle>
                <CardDescription>Context for this strategy draft.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
                  {configStatus?.gatewayConnected && configStatus?.hasGatewayKey
                    ? "AI status: Ready"
                    : "AI status: Not ready"}
                </div>
                <div className="space-y-2">
                  <Label>Working Title</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Project name"
                    disabled={loading}
                  />
                  {loading && <p className="text-xs text-muted-foreground">Loading project...</p>}
                </div>
                <Button className="w-full" variant="outline" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  {saving ? "Saving..." : "Save Draft Plan"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  {lastSaved ? `Last saved ${lastSaved.toLocaleTimeString()}` : "Saved in browser local storage"}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-3">
            <Tabs defaultValue="positioning" className="w-full">
              <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full h-auto gap-1">
                <TabsTrigger value="positioning">
                  <Target className="h-4 w-4 mr-1" />
                  Positioning
                </TabsTrigger>
                <TabsTrigger value="funding">
                  <Wallet className="h-4 w-4 mr-1" />
                  Funding
                </TabsTrigger>
                <TabsTrigger value="marketing">
                  <Megaphone className="h-4 w-4 mr-1" />
                  Marketing
                </TabsTrigger>
                <TabsTrigger value="festivals">
                  <Ticket className="h-4 w-4 mr-1" />
                  Festivals
                </TabsTrigger>
              </TabsList>

              <TabsContent value="positioning" className="space-y-4 mt-6">
                <div className="flex justify-end">
                  <Button variant="outline" onClick={handleAnalyzeScript} disabled={analyzing}>
                    {analyzing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Target className="h-4 w-4 mr-2" />
                    )}
                    {analyzing ? "Analyzing..." : "Auto-Analyze"}
                  </Button>
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Core Identity</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>Writer</Label>
                      <Input value={formData.writer} onChange={(e) => updateField("writer", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Format</Label>
                      <Input value={formData.format} onChange={(e) => updateField("format", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Genre & Tone</Label>
                      <Input value={formData.genre} onChange={(e) => updateField("genre", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Why this film now?</Label>
                      <Textarea value={formData.whyNow} onChange={(e) => updateField("whyNow", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Comps</Label>
                      <Textarea value={formData.comps} onChange={(e) => updateField("comps", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Target Audience</Label>
                      <Textarea
                        value={formData.targetAudience}
                        onChange={(e) => updateField("targetAudience", e.target.value)}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="funding" className="space-y-4 mt-6">
                <div className="flex justify-end">
                  <Button variant="outline" onClick={handleGenerateFunding} disabled={generatingFunding}>
                    {generatingFunding ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Wallet className="h-4 w-4 mr-2" />
                    )}
                    {generatingFunding ? "Generating..." : "Auto-Generate Funding Plan"}
                  </Button>
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Budget Tiers</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label>MVP</Label>
                      <Input value={formData.budgetMvp} onChange={(e) => updateField("budgetMvp", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Target</Label>
                      <Input
                        value={formData.budgetTarget}
                        onChange={(e) => updateField("budgetTarget", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Stretch</Label>
                      <Input
                        value={formData.budgetStretch}
                        onChange={(e) => updateField("budgetStretch", e.target.value)}
                      />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Funding Sources</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>Grants & Public Funds</Label>
                      <Textarea
                        value={formData.sourceGrants}
                        onChange={(e) => updateField("sourceGrants", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Private Investment</Label>
                      <Textarea
                        value={formData.sourcePrivate}
                        onChange={(e) => updateField("sourcePrivate", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Crowdfunding</Label>
                      <Input value={formData.sourceCrowd} onChange={(e) => updateField("sourceCrowd", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>In-kind Support</Label>
                      <Textarea value={formData.sourceInKind} onChange={(e) => updateField("sourceInKind", e.target.value)} />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="marketing" className="space-y-4 mt-6">
                <div className="flex justify-end">
                  <Button variant="outline" onClick={handleGenerateMarketing} disabled={generatingMarketing}>
                    {generatingMarketing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Megaphone className="h-4 w-4 mr-2" />
                    )}
                    {generatingMarketing ? "Generating..." : "Auto-Generate Marketing Plan"}
                  </Button>
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Brand & Audience</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>Logline</Label>
                      <Input value={formData.logline} onChange={(e) => updateField("logline", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Synopsis</Label>
                      <Textarea value={formData.synopsis} onChange={(e) => updateField("synopsis", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Visual Tone</Label>
                      <Input value={formData.visualTone} onChange={(e) => updateField("visualTone", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Content Plan</Label>
                      <Textarea
                        value={formData.contentPlan}
                        onChange={(e) => updateField("contentPlan", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Channels</Label>
                      <Textarea value={formData.channels} onChange={(e) => updateField("channels", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Press Outlets</Label>
                      <Textarea
                        value={formData.pressOutlets}
                        onChange={(e) => updateField("pressOutlets", e.target.value)}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="festivals" className="space-y-4 mt-6">
                <div className="flex justify-end">
                  <Button variant="outline" onClick={handleGenerateFestivals} disabled={generatingFestivals}>
                    {generatingFestivals ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Ticket className="h-4 w-4 mr-2" />
                    )}
                    {generatingFestivals ? "Generating..." : "Auto-Generate Festival Strategy"}
                  </Button>
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Festival Tiering</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>Tier 1</Label>
                      <Textarea value={formData.tier1} onChange={(e) => updateField("tier1", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Tier 2</Label>
                      <Textarea value={formData.tier2} onChange={(e) => updateField("tier2", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Tier 3</Label>
                      <Textarea value={formData.tier3} onChange={(e) => updateField("tier3", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Distribution</Label>
                      <Textarea
                        value={formData.distribution}
                        onChange={(e) => updateField("distribution", e.target.value)}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function TheFilmFestivalRoute() {
  return (
    <SessionAuth>
      <TheFilmFestivalPage />
    </SessionAuth>
  );
}
