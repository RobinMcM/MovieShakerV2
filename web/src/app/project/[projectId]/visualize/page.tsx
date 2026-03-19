"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Video,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Trash2,
  Star,
  Film,
  Sparkles,
  Play,
  ArrowRight,
  Plus,
} from "lucide-react";
import { TramLineSelect } from "../moodboard/TramLineSelect";
import { useVisualize } from "./useVisualize";
import type { VideoHistoryItem, CompiledVideo, Provider } from "./types";
import { API_URL, api, storageImageUrl } from "@/lib/api";

function getVideoUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_URL}/api/storage/${path}`;
}

function resolveSourceImageUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith("data:")) return pathOrUrl;
  return storageImageUrl(pathOrUrl);
}

function normalizeVideoAspectRatio(aspectRatio: string | null | undefined): string {
  const value = (aspectRatio || "").trim();
  if (!value) return "16:9";
  const mapping: Record<string, string> = {
    "2.39:1": "21:9",
    "2.35:1": "21:9",
    "1:2.39": "9:21",
    "1:2.35": "9:21",
  };
  const normalized = mapping[value] || value;
  const allowed = new Set(["16:9", "9:16", "4:3", "3:4", "21:9", "9:21"]);
  return allowed.has(normalized) ? normalized : "16:9";
}

function normalizeSourceImagePath(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  const value = pathOrUrl.trim();
  if (!value || value.startsWith("data:")) return null;
  const marker = "/api/storage/";
  const idx = value.indexOf(marker);
  if (idx >= 0) {
    return value.slice(idx + marker.length).split("?")[0];
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return null;
  }
  return value;
}

function VisualizeContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = (params?.projectId as string) ?? null;
  const tramLineParam = searchParams?.get("tramLine");
  const moodboardImageParam = searchParams?.get("moodboardImage");

  const {
    loading,
    project,
    tramLines,
    apiConfig,
    videoHistory,
    compiledVideos,
    sourceCompositions,
    loadVideoHistory,
    loadCompiledVideos,
    loadSourceCompositions,
    toggleVideoPrint,
    deleteVideo,
    deleteCompiledVideo,
    continueVideo,
    toggleMovieShakerTVPrint,
  } = useVisualize(projectId);

  const [selectedTramLine, setSelectedTramLine] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<Provider>("gateway");
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [pollingVideoId, setPollingVideoId] = useState<string | null>(null);
  const [videoToDelete, setVideoToDelete] = useState<{ id: string; path: string } | null>(null);
  const [compiledToDelete, setCompiledToDelete] = useState<{ id: string; path: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastCallCost, setLastCallCost] = useState<number | null>(null);
  const [lastCallBalance, setLastCallBalance] = useState<number | null>(null);
  const [generatedImageDataUrl, setGeneratedImageDataUrl] = useState<string | null>(null);
  const [generatedImagePath, setGeneratedImagePath] = useState<string | null>(null);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState(0);

  useEffect(() => {
    if (!moodboardImageParam) {
      setGeneratedImageUrl(null);
      setGeneratedImageDataUrl(null);
      setGeneratedImagePath(null);
      return;
    }
    const normalized = resolveSourceImageUrl(moodboardImageParam);
    setGeneratedImageUrl(normalized);
    setGeneratedImageDataUrl(moodboardImageParam.startsWith("data:") ? moodboardImageParam : null);
    setGeneratedImagePath(normalizeSourceImagePath(moodboardImageParam));
  }, [moodboardImageParam]);

  useEffect(() => {
    if (tramLineParam && tramLines.length > 0 && tramLines.some((l) => l.id === tramLineParam)) {
      setSelectedTramLine(tramLineParam);
    }
  }, [tramLineParam, tramLines]);

  useEffect(() => {
    if (selectedTramLine) {
      loadVideoHistory(selectedTramLine);
      loadCompiledVideos(selectedTramLine);
      loadSourceCompositions(selectedTramLine);
    }
  }, [selectedTramLine, loadVideoHistory, loadCompiledVideos, loadSourceCompositions]);

  const sourceSnapshots = (sourceCompositions || [])
    .sort((a, b) => (a.canvas_number || 0) - (b.canvas_number || 0))
    .map((composition) => {
      const payload = (composition.composition_data || {}) as {
        snapshot_path?: string;
        images?: Array<{ src?: string }>;
      };
      return (payload.snapshot_path || payload.images?.[0]?.src || "").trim();
    })
    .filter((src) => !!src);

  useEffect(() => {
    if (sourceSnapshots.length === 0) {
      setSelectedSourceIndex(0);
      return;
    }
    if (moodboardImageParam) {
      const fromParam = normalizeSourceImagePath(moodboardImageParam);
      if (fromParam) {
        const idx = sourceSnapshots.findIndex((item) => normalizeSourceImagePath(item) === fromParam);
        if (idx >= 0) {
          setSelectedSourceIndex(idx);
          return;
        }
      }
    }
    setSelectedSourceIndex((current) => Math.min(current, sourceSnapshots.length - 1));
  }, [sourceSnapshots, moodboardImageParam]);

  useEffect(() => {
    const selectedSource = sourceSnapshots[selectedSourceIndex] || null;
    if (!selectedSource) return;
    setGeneratedImageDataUrl(null);
    setGeneratedImagePath(normalizeSourceImagePath(selectedSource));
    setGeneratedImageUrl(resolveSourceImageUrl(selectedSource));
  }, [selectedSourceIndex, sourceSnapshots]);

  const currentLine = tramLines.find((l) => l.id === selectedTramLine);
  const selectedSourcePath = sourceSnapshots[selectedSourceIndex] || null;
  const imageUrl =
    generatedImageUrl ||
    resolveSourceImageUrl(selectedSourcePath) ||
    resolveSourceImageUrl(currentLine?.scene_visual);

  const gatewayConnected = apiConfig?.gatewayConnected ?? false;
  const hasGatewayKey = apiConfig?.hasGatewayKey ?? false;
  const availableProviders: Provider[] = ["gateway"];

  const channelGroups = videoHistory.reduce<Record<number, VideoHistoryItem[]>>((acc, v) => {
    const ch = v.Channel ?? 0;
    if (!acc[ch]) acc[ch] = [];
    acc[ch].push(v);
    return acc;
  }, {});
  const sortedChannels = Object.keys(channelGroups)
    .map(Number)
    .sort((a, b) => a - b);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const pollVideoUntilTerminal = async (videoId: string) => {
    setPollingVideoId(videoId);
    const maxAttempts = 40;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const statusRes = await api.get<{
          success: boolean;
          status: string;
          error?: string | null;
          video?: VideoHistoryItem;
        }>(`api/video-history/${videoId}/status`);
        const status = statusRes.status;
        if (status === "completed") {
          if (selectedTramLine) {
            await loadVideoHistory(selectedTramLine);
          }
          setToastMessage("Video generation completed.");
          setPollingVideoId(null);
          return;
        }
        if (status === "failed") {
          setToastMessage(statusRes.error || "Video generation failed.");
          setPollingVideoId(null);
          if (selectedTramLine) {
            await loadVideoHistory(selectedTramLine);
          }
          return;
        }
      } catch {
        // Keep polling for transient failures.
      }
      await sleep(3000);
    }
    setPollingVideoId(null);
    setToastMessage("Generation is still processing. Refresh in a few moments.");
  };

  const handleGenerateVideo = async () => {
    if (!selectedTramLine) {
      setToastMessage("Select a shot first.");
      return;
    }
    setIsGenerating(true);
    try {
      const nextChannel =
        videoHistory.length > 0
          ? Math.max(...videoHistory.map((v) => v.Channel ?? 0)) + 1
          : 1;
      const currentChannelVideos = (channelGroups[nextChannel] ?? []).filter((v) => !!v.video_path);
      const nextTake = currentChannelVideos.length + 1;
      const res = await api.post<{
        success: boolean;
        video: VideoHistoryItem;
        gateway: { job_id?: string | null; job_status?: string };
        credits?: { cost?: number; balance?: number };
      }>("api/video-history/generate", {
        tram_line_id: selectedTramLine,
        prompt: prompt.trim() || currentLine?.action_text || "Cinematic shot",
        aspect_ratio: normalizeVideoAspectRatio(project?.aspect_ratio),
        channel: nextChannel,
        take_number: nextTake,
        media_type: "video-generation",
        source_image_path: generatedImagePath || normalizeSourceImagePath(selectedSourcePath) || currentLine?.scene_visual || null,
        source_image_data_url: generatedImageDataUrl || null,
      });
      if (typeof res.credits?.cost === "number") {
        setLastCallCost(res.credits.cost);
      }
      if (typeof res.credits?.balance === "number") {
        setLastCallBalance(res.credits.balance);
      }
      await loadVideoHistory(selectedTramLine);
      const createdVideoId = res.video?.id;
      if (res.gateway?.job_status === "completed") {
        setToastMessage("Video generated.");
      } else if (createdVideoId) {
        setToastMessage("Generation started.");
        void pollVideoUntilTerminal(createdVideoId);
      } else {
        setToastMessage("Generation submitted.");
      }
    } catch (e) {
      setToastMessage(e instanceof Error ? e.message : "Failed to start video generation.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleContinueFromVideo = async (
    sourceVideoId: string,
    mode: "same_channel" | "new_channel"
  ) => {
    if (!selectedTramLine) return;
    try {
      await continueVideo(sourceVideoId, mode, selectedTramLine, {
        prompt,
        aspect_ratio: project?.aspect_ratio ?? null,
      });
      setToastMessage(mode === "same_channel" ? "Continuation started in same channel." : "Continuation started in a new channel.");
      await loadVideoHistory(selectedTramLine);
    } catch (e) {
      setToastMessage(e instanceof Error ? e.message : "Failed to start continuation.");
    }
  };

  const handleStitch = async (channelNumber: number) => {
    const printed = videoHistory
      .filter((v) => v.is_print && v.Channel === channelNumber)
      .sort((a, b) => (a.take_number ?? 0) - (b.take_number ?? 0));
    if (printed.length < 2) {
      setToastMessage("Need at least 2 print-marked videos to stitch");
      return;
    }
    try {
      await api.post("api/video/stitch", {
        video_ids: printed.map((v) => v.id),
        project_id: projectId,
        tram_line_id: selectedTramLine,
        aspect_ratio: "16:9",
      });
      setToastMessage("Stitch started.");
      if (selectedTramLine) loadCompiledVideos(selectedTramLine);
    } catch (e) {
      setToastMessage("Stitch service is not connected yet. Connect your stitch server to this endpoint.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <Link
            href={projectId ? `/project/${projectId}` : "/"}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Link>
        </div>
        {project && (
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Video className="h-6 w-6 text-primary" />
              Visualize
            </h1>
            <p className="text-muted-foreground">{project.title ?? project.name}</p>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>API Provider and Shot</CardTitle>
            <CardDescription>Choose AI provider and which shot to work with</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">API Provider</label>
              <Select
                value={selectedProvider}
                onValueChange={(v) => setSelectedProvider(v as Provider)}
                disabled={availableProviders.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider..." />
                </SelectTrigger>
                <SelectContent>
                  {availableProviders.map((id) => (
                    <SelectItem key={id} value={id}>
                      Gateway
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground mt-2">
                Source of truth: Gateway
                {!hasGatewayKey ? " (missing internal key)" : gatewayConnected ? " (connected)" : " (not reachable)"}
              </p>
              {(lastCallCost !== null || lastCallBalance !== null) && (
                <p className="text-xs text-muted-foreground mt-1">
                  {lastCallCost !== null ? `Last call cost: ${lastCallCost} credit${lastCallCost === 1 ? "" : "s"}` : ""}
                  {lastCallCost !== null && lastCallBalance !== null ? " · " : ""}
                  {lastCallBalance !== null ? `Balance: ${lastCallBalance}` : ""}
                </p>
              )}
            </div>
            {tramLines.length > 0 ? (
              <div>
                <label className="text-sm font-medium mb-2 block">Select Shot</label>
                <TramLineSelect
                  tramLines={tramLines}
                  selectedTramLineId={selectedTramLine}
                  onSelect={setSelectedTramLine}
                />
              </div>
            ) : (
              <p className="text-muted-foreground">No shots available. Create tram lines in Shot List.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Video Generation</CardTitle>
            <CardDescription>Generate video through the gateway model router</CardDescription>
          </CardHeader>
          <CardContent>
            {!imageUrl ? (
              <div className="p-4 bg-muted rounded-md text-center text-muted-foreground">
                Select a shot and add an image from the Mood Board, or use the Visualize button from the Mood Board
                with a canvas image.
              </div>
            ) : (
              <div className="space-y-4">
                {sourceSnapshots.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedSourceIndex((idx) => Math.max(0, idx - 1))}
                      disabled={selectedSourceIndex <= 0}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium min-w-[120px] text-center">
                      Moodboard {selectedSourceIndex + 1} / {sourceSnapshots.length}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSelectedSourceIndex((idx) =>
                          Math.min(sourceSnapshots.length - 1, idx + 1)
                        )
                      }
                      disabled={selectedSourceIndex >= sourceSnapshots.length - 1}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <div className="relative aspect-video max-w-md rounded-md overflow-hidden bg-black">
                  <img
                    src={imageUrl}
                    alt="Source for video"
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Gateway generation supports prompt + optional moodboard source image.
                </p>
                <div className="space-y-3 max-w-xl">
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={currentLine?.action_text || "Describe the cinematic shot..."}
                    className="min-h-[100px]"
                  />
                  <Button onClick={handleGenerateVideo} disabled={isGenerating || !gatewayConnected}>
                    {isGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                    Generate Video
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {selectedTramLine && (
          <Card>
            <CardHeader>
              <CardTitle>Video History</CardTitle>
              <CardDescription>Videos generated for this shot</CardDescription>
            </CardHeader>
            <CardContent>
              {videoHistory.length === 0 ? (
                <div className="p-4 bg-muted rounded-md text-center text-muted-foreground">
                  No videos yet. Connect your API service to generate videos.
                </div>
              ) : (
                <Accordion type="single" collapsible className="w-full">
                  {sortedChannels.map((channelNum) => {
                    const videos = channelGroups[channelNum];
                    const printCount = videos.filter((v) => v.is_print).length;
                    const channelCompiled = compiledVideos.find((c) => c.channel_number === channelNum);
                    return (
                      <AccordionItem key={channelNum} value={`ch-${channelNum}`}>
                        <AccordionTrigger>
                          Channel {channelNum} ({videos.length} video{videos.length !== 1 ? "s" : ""})
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4">
                            {videos.map((video) => (
                              <div key={video.id} className="space-y-2">
                                <div className="relative aspect-video rounded-md overflow-hidden bg-black border">
                                  {video.video_path ? (
                                    <video
                                      src={getVideoUrl(video.video_path)}
                                      controls
                                      preload="metadata"
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-white/80 gap-2">
                                      <Loader2 className="h-5 w-5 animate-spin" />
                                      <span className="text-xs">
                                        {pollingVideoId === video.id || video.status === "processing"
                                          ? "Processing..."
                                          : "Pending..."}
                                      </span>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    disabled={!video.video_path}
                                    onClick={() =>
                                      toggleVideoPrint(
                                        video.id,
                                        !video.is_print,
                                        selectedTramLine!
                                      )
                                    }
                                    className="absolute top-2 left-2 p-1.5 rounded bg-black/50 hover:bg-black/70"
                                  >
                                    <Star
                                      className={`h-5 w-5 ${
                                        video.video_path && video.is_print
                                          ? "fill-yellow-400 text-yellow-400"
                                          : "text-white"
                                      }`}
                                    />
                                  </button>
                                </div>
                                <div className="flex items-center justify-between text-xs text-muted-foreground gap-1">
                                  <span>Take {video.take_number ?? "?"} · Ch {video.Channel ?? "?"}</span>
                                  <div className="flex items-center gap-1">
                                    {!videoHistory.some(
                                      (candidate) =>
                                        candidate.source_video_id === video.id &&
                                        candidate.Channel === video.Channel
                                    ) && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0"
                                        disabled={!video.video_path}
                                        title="Continue in same channel"
                                        onClick={() => handleContinueFromVideo(video.id, "same_channel")}
                                      >
                                        <ArrowRight className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      disabled={!video.video_path}
                                      title="Continue in new channel"
                                      onClick={() => handleContinueFromVideo(video.id, "new_channel")}
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-destructive"
                                      onClick={() => setVideoToDelete({ id: video.id, path: video.video_path })}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                            {channelCompiled ? (
                              <div className="space-y-2">
                                <div className="relative aspect-video rounded-md overflow-hidden bg-black border-2 border-yellow-500">
                                  <video
                                    src={getVideoUrl(channelCompiled.compiled_video_path)}
                                    controls
                                    className="w-full h-full object-cover"
                                  />
                                  <div className="absolute top-2 left-2 bg-yellow-500 text-white px-2 py-1 rounded text-xs font-bold flex items-center gap-1">
                                    <Sparkles className="h-3 w-3" />
                                    Final Cut
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleMovieShakerTVPrint(
                                        channelCompiled.id,
                                        channelCompiled.youtube_upload_status !== "submitted_to_movieshaker_tv",
                                        selectedTramLine!
                                      )
                                    }
                                    className="absolute top-2 right-2 p-1.5 rounded bg-black/50"
                                  >
                                    <Film className="h-5 w-5 text-white" />
                                  </button>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive"
                                  onClick={() =>
                                    setCompiledToDelete({
                                      id: channelCompiled.id,
                                      path: channelCompiled.compiled_video_path,
                                    })
                                  }
                                >
                                  <Trash2 className="h-3 w-3 mr-1" />
                                  Delete Final Cut
                                </Button>
                              </div>
                            ) : printCount >= 2 ? (
                              <button
                                type="button"
                                onClick={() => handleStitch(channelNum)}
                                className="aspect-video rounded-md border-2 border-dashed border-primary flex flex-col items-center justify-center gap-2 text-primary hover:bg-primary/5"
                              >
                                <Film className="h-8 w-8" />
                                <span className="text-sm font-medium">Stitch {printCount} videos</span>
                              </button>
                            ) : null}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </CardContent>
          </Card>
        )}

        {toastMessage && (
          <div className="fixed bottom-4 right-4 px-4 py-2 rounded-md border bg-muted">
            <p className="text-sm">{toastMessage}</p>
          </div>
        )}

        <AlertDialog open={!!videoToDelete} onOpenChange={(open) => !open && setVideoToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete video?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the video from the database. Storage cleanup may be done separately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground"
                onClick={async () => {
                  if (videoToDelete && selectedTramLine) {
                    await deleteVideo(videoToDelete.id, selectedTramLine);
                    setVideoToDelete(null);
                    setToastMessage("Video deleted");
                  }
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!compiledToDelete} onOpenChange={(open) => !open && setCompiledToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Final Cut?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the stitched video. Original takes remain.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground"
                onClick={async () => {
                  if (compiledToDelete && selectedTramLine) {
                    await deleteCompiledVideo(compiledToDelete.id, selectedTramLine);
                    setCompiledToDelete(null);
                    setToastMessage("Final cut deleted");
                  }
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
      <Footer />
    </div>
  );
}

export default function VisualizePage() {
  return (
    <SessionAuth>
      <VisualizeContent />
    </SessionAuth>
  );
}
