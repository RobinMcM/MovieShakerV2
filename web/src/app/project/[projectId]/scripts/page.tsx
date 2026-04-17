"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  CheckCircle2,
  FileText,
  Loader2,
  Upload,
} from "lucide-react";
import { api } from "@/lib/api";

interface Script {
  id: string;
  project_id: string;
  name: string;
  file_url: string;
  uploaded_at: string;
  is_current: boolean;
  series: string | null;
  episode: string | null;
  description?: string | null;
  is_locked?: boolean;
  page_count?: number | null;
}

function ScriptsPageInner() {
  const params = useParams();
  const router = useRouter();
  const projectId =
    typeof params.projectId === "string"
      ? params.projectId
      : params.projectId?.[0];

  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  // Upload form state
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadSeries, setUploadSeries] = useState("");
  const [uploadEpisode, setUploadEpisode] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Set current dialog
  const [setCurrentDialogOpen, setSetCurrentDialogOpen] = useState(false);
  const [pendingCurrentId, setPendingCurrentId] = useState<string | null>(null);

  const loadScripts = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.get<{ scripts: Script[] }>(
        `/projects/${projectId}/scripts`
      );
      const list = Array.isArray(res?.scripts) ? res.scripts : [];
      list.sort((a, b) => {
        if (a.is_current && !b.is_current) return -1;
        if (!a.is_current && b.is_current) return 1;
        return (
          new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
        );
      });
      setScripts(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scripts.");
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadScripts();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, loadScripts]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (file && !uploadName) {
      setUploadName(file.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " "));
    }
  };

  const handleUpload = async () => {
    if (!projectId || !selectedFile || !uploadName.trim()) return;
    setUploading(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("name", uploadName.trim());
      if (uploadDescription.trim())
        formData.append("description", uploadDescription.trim());
      if (uploadSeries.trim()) formData.append("series", uploadSeries.trim());
      if (uploadEpisode.trim())
        formData.append("episode", uploadEpisode.trim());

      const res = await api.postForm<Script>(
        `/projects/${projectId}/scripts`,
        formData
      );
      const newScript = res as Script;
      setMessage({ text: `"${newScript.name}" uploaded successfully.`, type: "success" });
      setUploadName("");
      setUploadDescription("");
      setUploadSeries("");
      setUploadEpisode("");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadScripts();
      // Navigate to the new script
      router.push(`/project/${projectId}/script/${newScript.id}`);
    } catch (e) {
      setMessage({
        text: e instanceof Error ? e.message : "Upload failed.",
        type: "error",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSetCurrentClick = (scriptId: string) => {
    setPendingCurrentId(scriptId);
    setSetCurrentDialogOpen(true);
  };

  const handleConfirmSetCurrent = async () => {
    if (!pendingCurrentId) return;
    setSetCurrentDialogOpen(false);
    try {
      await api.post(`/scripts/${pendingCurrentId}/set-current`, {});
      setMessage({ text: "Current script updated.", type: "success" });
      await loadScripts();
    } catch (e) {
      setMessage({
        text: e instanceof Error ? e.message : "Failed to set current.",
        type: "error",
      });
    } finally {
      setPendingCurrentId(null);
    }
  };

  if (!projectId) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <AppHeader />
        <main className="flex-1 container mx-auto px-4 py-8">
          <p className="text-muted-foreground">Invalid project.</p>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Scripts</h1>
          </div>

          {message && (
            <div
              className={`p-3 rounded-md text-sm ${
                message.type === "error"
                  ? "bg-destructive/10 text-destructive border border-destructive/20"
                  : "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
              }`}
            >
              {message.text}
            </div>
          )}

          {/* Upload section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Script
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="script-file">PDF File *</Label>
                <Input
                  id="script-file"
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
                {selectedFile && (
                  <p className="text-xs text-muted-foreground">
                    Selected: {selectedFile.name} (
                    {(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="script-name">Script Name *</Label>
                <Input
                  id="script-name"
                  placeholder="e.g. The Final Draft"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  disabled={uploading}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="script-series">Series (optional)</Label>
                  <Input
                    id="script-series"
                    placeholder="e.g. Season 1"
                    value={uploadSeries}
                    onChange={(e) => setUploadSeries(e.target.value)}
                    disabled={uploading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="script-episode">Episode (optional)</Label>
                  <Input
                    id="script-episode"
                    placeholder="e.g. Episode 3"
                    value={uploadEpisode}
                    onChange={(e) => setUploadEpisode(e.target.value)}
                    disabled={uploading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="script-description">
                  Description (optional)
                </Label>
                <Textarea
                  id="script-description"
                  placeholder="Brief description of this draft..."
                  value={uploadDescription}
                  onChange={(e) => setUploadDescription(e.target.value)}
                  disabled={uploading}
                  rows={2}
                  className="resize-none"
                />
              </div>

              <Button
                onClick={handleUpload}
                disabled={uploading || !selectedFile || !uploadName.trim()}
                className="w-full sm:w-auto"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Script
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Existing scripts */}
          <Card>
            <CardHeader>
              <CardTitle>
                Project Scripts
                {scripts.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({scripts.length})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <p className="text-destructive text-sm">{error}</p>
              ) : scripts.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No scripts uploaded yet. Upload your first script above.
                </p>
              ) : (
                <div className="space-y-3">
                  {scripts.map((script) => (
                    <div
                      key={script.id}
                      className={`flex items-start justify-between gap-4 p-4 rounded-lg border transition-colors ${
                        script.is_current
                          ? "border-primary/40 bg-primary/5"
                          : "border-border bg-muted/30 hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <FileText className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">
                              {script.name}
                            </span>
                            {script.is_current && (
                              <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                                Current
                              </span>
                            )}
                            {script.is_locked && (
                              <span className="text-xs bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                                Locked
                              </span>
                            )}
                          </div>
                          <div className="flex gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span>
                              Uploaded{" "}
                              {new Date(script.uploaded_at).toLocaleDateString(
                                "en-GB"
                              )}
                            </span>
                            {script.page_count && (
                              <span>{script.page_count} pages</span>
                            )}
                            {script.series && <span>{script.series}</span>}
                            {script.episode && <span>{script.episode}</span>}
                          </div>
                          {script.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                              {script.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!script.is_current && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetCurrentClick(script.id)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Set Current
                          </Button>
                        )}
                        <Button
                          variant={script.is_current ? "default" : "outline"}
                          size="sm"
                          onClick={() =>
                            router.push(
                              `/project/${projectId}/script/${script.id}`
                            )
                          }
                        >
                          Open
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />

      <AlertDialog
        open={setCurrentDialogOpen}
        onOpenChange={(open) => {
          setSetCurrentDialogOpen(open);
          if (!open) setPendingCurrentId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set as Current Script?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make the selected script the active script for this
              project. All tools will use this script as the source of truth.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSetCurrent}>
              Set as Current
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function ScriptsPage() {
  return (
    <SessionAuth>
      <ScriptsPageInner />
    </SessionAuth>
  );
}
