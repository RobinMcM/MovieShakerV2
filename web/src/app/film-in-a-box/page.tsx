"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { api, API_URL } from "@/lib/api";
import {
  CheckCircle,
  ChevronRight,
  Clapperboard,
  FileText,
  Film,
  FolderOpen,
  Loader2,
  RefreshCw,
  Upload,
  Users,
} from "lucide-react";
import {
  supportsLocalDirectory,
  saveDirectoryHandle,
  loadDirectoryHandle,
  listMediaFiles,
  verifyPermission,
  writeFileToDirectory,
  type LocalFile,
} from "@/lib/localFileStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Stage = 1 | 2 | 3 | 4 | 5;
type DialogueStyle = "monologue" | "interview" | "mixed";

interface DocSession {
  stage: Stage;
  subjectName: string;
  workingTitle: string;
  context: string;
  rawTranscript: string;
  cleanedDialogue: string;
  dialogueStyle: DialogueStyle;
  generatedScript: string;
}

interface ShotSuggestion {
  id: string;
  description: string;
  contextQuote: string;
  sceneId?: string;
  selected: boolean;
}

interface Entity {
  id: string;
  name: string;
  type: string;
  objectType: string;
}

const BASE = "/api/documentary/projects";

const EMPTY_SESSION: DocSession = {
  stage: 1,
  subjectName: "",
  workingTitle: "",
  context: "",
  rawTranscript: "",
  cleanedDialogue: "",
  dialogueStyle: "monologue",
  generatedScript: "",
};

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEP_LABELS = ["Source", "Transcript", "Dialogue", "Script", "Shots"];

function StepIndicator({ current }: { current: Stage }) {
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 mb-8">
      {STEP_LABELS.map((label, i) => {
        const step = (i + 1) as Stage;
        const done = step < current;
        const active = step === current;
        return (
          <div key={step} className="flex items-center gap-1 sm:gap-2">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                  done ? "bg-primary text-primary-foreground" : "",
                  active ? "border-2 border-primary text-primary bg-primary/10" : "",
                  !done && !active ? "border border-border text-muted-foreground bg-muted/30" : "",
                ].join(" ")}
              >
                {done ? <CheckCircle className="w-4 h-4" /> : step}
              </div>
              <span className={`text-[10px] hidden sm:block ${active ? "text-primary font-medium" : "text-muted-foreground"}`}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mb-4" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page inner component
// ---------------------------------------------------------------------------

function DocumentaryStudioInner() {
  const params = useParams();
  const projectId =
    typeof params.projectId === "string" ? params.projectId : params.projectId?.[0];

  const [doc, setDoc] = useState<DocSession>(EMPTY_SESSION);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Step 1 — file picker
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // Step 1 — local working directory (Filesystem Access API)
  const [localDir, setLocalDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [localDirName, setLocalDirName] = useState<string>("");
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([]);
  const [selectedLocalNames, setSelectedLocalNames] = useState<Set<string>>(new Set());
  const [loadingDir, setLoadingDir] = useState(false);

  // Step 4
  const [broll, setBroll] = useState<ShotSuggestion[]>([]);
  const [scriptSaved, setScriptSaved] = useState(false);

  // Step 5
  const [entities, setEntities] = useState<Entity[]>([]);
  const [savedScriptId, setSavedScriptId] = useState<string | null>(null);

  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load session on mount
  useEffect(() => {
    if (!projectId) return;
    api
      .get<{ success: boolean; session: DocSession & { stage: number } }>(`${BASE}/${projectId}`)
      .then((data) => {
        if (data?.session) {
          setDoc({
            stage: (data.session.stage as Stage) ?? 1,
            subjectName: data.session.subjectName ?? "",
            workingTitle: data.session.workingTitle ?? "",
            context: data.session.context ?? "",
            rawTranscript: data.session.rawTranscript ?? "",
            cleanedDialogue: data.session.cleanedDialogue ?? "",
            dialogueStyle: (data.session.dialogueStyle as DialogueStyle) ?? "monologue",
            generatedScript: data.session.generatedScript ?? "",
          });
          if (data.session.generatedScript) {
            setBroll(extractBroll(data.session.generatedScript));
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  // Restore persisted working directory handle on mount
  useEffect(() => {
    if (!supportsLocalDirectory()) return;
    loadDirectoryHandle().then(async (handle) => {
      if (!handle) return;
      const ok = await verifyPermission(handle);
      if (!ok) return;
      setLocalDir(handle);
      setLocalDirName(handle.name);
      setLoadingDir(true);
      listMediaFiles(handle)
        .then(setLocalFiles)
        .finally(() => setLoadingDir(false));
    });
  }, []);

  async function pickDirectory() {
    if (!supportsLocalDirectory()) return;
    try {
      // @ts-expect-error — showDirectoryPicker not in all TS defs yet
      const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      await saveDirectoryHandle(handle);
      setLocalDir(handle);
      setLocalDirName(handle.name);
      setSelectedLocalNames(new Set());
      setLoadingDir(true);
      listMediaFiles(handle)
        .then(setLocalFiles)
        .finally(() => setLoadingDir(false));
    } catch {
      // user cancelled picker
    }
  }

  function toggleLocalFile(name: string) {
    setSelectedLocalNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function getFilesForTranscription(): Promise<File[]> {
    const files: File[] = [...selectedFiles];
    for (const lf of localFiles) {
      if (!selectedLocalNames.has(lf.name)) continue;
      try {
        const file = await lf.handle.getFile();
        files.push(file);
      } catch {
        // handle expired — skip
      }
    }
    return files;
  }

  function slugTitle(): string {
    return (doc.workingTitle || "documentary").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }

  async function saveToFolder(content: string, suffix: string) {
    if (!localDir || !content) return;
    try {
      const filename = `${slugTitle()}-${suffix}.txt`;
      await writeFileToDirectory(localDir, filename, content);
      showSuccess(`Saved ${filename} to ${localDirName}`);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to save file to directory");
    }
  }

  // Debounced auto-save on doc changes
  const autosave = useCallback(
    (updated: DocSession) => {
      if (!projectId) return;
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        api
          .put(`${BASE}/${projectId}`, {
            stage: updated.stage,
            subjectName: updated.subjectName,
            workingTitle: updated.workingTitle,
            context: updated.context,
            rawTranscript: updated.rawTranscript,
            cleanedDialogue: updated.cleanedDialogue,
            dialogueStyle: updated.dialogueStyle,
            generatedScript: updated.generatedScript,
          })
          .catch(() => {});
      }, 1200);
    },
    [projectId]
  );

  function updateDoc(patch: Partial<DocSession>) {
    setDoc((prev) => {
      const next = { ...prev, ...patch };
      autosave(next);
      return next;
    });
  }

  function goToStage(stage: Stage) {
    updateDoc({ stage });
  }

  function showError(msg: string) {
    setError(msg);
    setSuccess(null);
  }

  function showSuccess(msg: string) {
    setSuccess(msg);
    setError(null);
  }

  // ---------------------------------------------------------------------------
  // Step 2 — Transcribe
  // ---------------------------------------------------------------------------

  async function handleTranscribe() {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const files = await getFilesForTranscription();
      if (files.length === 0) {
        showError("Please select at least one video or audio file");
        setBusy(false);
        return;
      }
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }
      const res = await fetch(`${API_URL}${BASE}/${projectId}/transcribe`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Transcription failed");
      }
      const data: { transcript: string; segmentCount: number } = await res.json();
      updateDoc({ rawTranscript: data.transcript, stage: 2 });
      showSuccess(`Transcribed ${data.segmentCount} file(s) successfully`);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 3 — Generate dialogue
  // ---------------------------------------------------------------------------

  async function handleGenerateDialogue() {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ dialogue: string }>(`${BASE}/${projectId}/generate-dialogue`, {
        style: doc.dialogueStyle,
      });
      updateDoc({ cleanedDialogue: res.dialogue });
      showSuccess("Dialogue generated");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Dialogue generation failed");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 4 — Generate script
  // ---------------------------------------------------------------------------

  async function handleGenerateScript() {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ script: string; brollSuggestions: ShotSuggestion[] }>(
        `${BASE}/${projectId}/generate-script`,
        {}
      );
      const suggestions = (res.brollSuggestions || []).map((s) => ({ ...s, selected: false }));
      updateDoc({ generatedScript: res.script });
      setBroll(suggestions);
      showSuccess("Script generated");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Script generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveScript() {
    if (!projectId || !doc.generatedScript) return;
    setBusy(true);
    setError(null);
    try {
      const blob = new Blob([doc.generatedScript], { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", blob, `${doc.workingTitle || "documentary"}.txt`);
      formData.append("project_id", projectId);
      formData.append("name", doc.workingTitle || "Documentary Script");

      const res = await fetch(`${API_URL}/scripts/upload-text`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setSavedScriptId(data.id || data.script_id || null);
        setScriptSaved(true);
        showSuccess("Script saved to project");
      } else {
        setScriptSaved(true);
        showSuccess("Script generated — navigate to Scripts to upload manually");
      }
    } catch {
      setScriptSaved(true);
      showSuccess("Script generated — navigate to Scripts to upload manually");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 5 — Apply shots and extract entities
  // ---------------------------------------------------------------------------

  async function handleApplyShots() {
    if (!projectId) return;
    const selected = broll.filter((s) => s.selected);
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`${BASE}/${projectId}/apply-shots`, {
        shots: selected.map((s) => ({
          scene_id: s.sceneId || null,
          description: s.description,
          context_quote: s.contextQuote,
        })),
      });
      showSuccess(`${selected.length} shot(s) added to project shot list`);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to apply shots");
    } finally {
      setBusy(false);
    }
  }

  async function handleExtractEntities() {
    if (!projectId || !savedScriptId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ entities: Entity[]; created: number }>(
        `${BASE}/${projectId}/extract-entities`,
        { scriptId: savedScriptId }
      );
      setEntities(res.entities || []);
      showSuccess(`${res.created} entities extracted and added to Objects`);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Entity extraction failed");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!projectId || loading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <AppHeader />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <main className="flex-1 container max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Clapperboard className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Documentary Studio</h1>
            <p className="text-sm text-muted-foreground">
              Turn an interview into a documentary script
            </p>
          </div>
        </div>

        <StepIndicator current={doc.stage} />

        {/* Alerts */}
        {error && (
          <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 rounded-md bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400 text-sm">
            {success}
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STEP 1 — Source Material                                            */}
        {/* ------------------------------------------------------------------ */}
        {doc.stage === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Film className="w-5 h-5" />
                Source Material
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Subject Name *</Label>
                  <Input
                    className="mt-1"
                    placeholder="e.g. John Smith"
                    value={doc.subjectName}
                    onChange={(e) => updateDoc({ subjectName: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Working Title</Label>
                  <Input
                    className="mt-1"
                    placeholder="e.g. A Life in Three Acts"
                    value={doc.workingTitle}
                    onChange={(e) => updateDoc({ workingTitle: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label>Story Context</Label>
                <Textarea
                  className="mt-1"
                  rows={3}
                  placeholder="Briefly describe the story, key themes, and time period…"
                  value={doc.context}
                  onChange={(e) => updateDoc({ context: e.target.value })}
                />
              </div>

              <div className="space-y-3">
                <Label>Interview Files</Label>

                {/* Local working directory (Filesystem Access API — Chrome/Edge) */}
                {supportsLocalDirectory() && (
                  <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {localDirName || "No working directory set"}
                        </span>
                      </div>
                      <Button size="sm" variant="outline" onClick={pickDirectory}>
                        {localDir ? "Change" : "Set Directory"}
                      </Button>
                    </div>

                    {localDir && (
                      <>
                        {loadingDir && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Scanning folder…
                          </p>
                        )}
                        {!loadingDir && localFiles.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            No video or audio files found in this folder.
                          </p>
                        )}
                        {!loadingDir && localFiles.length > 0 && (
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {localFiles.map((lf) => (
                              <label
                                key={lf.name}
                                className="flex items-center gap-2 text-sm cursor-pointer rounded px-2 py-1 hover:bg-muted/40"
                              >
                                <input
                                  type="checkbox"
                                  className="rounded"
                                  checked={selectedLocalNames.has(lf.name)}
                                  onChange={() => toggleLocalFile(lf.name)}
                                />
                                <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate flex-1">{lf.name}</span>
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {(lf.size / 1024 / 1024).toFixed(1)} MB
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                        {selectedLocalNames.size > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {selectedLocalNames.size} file(s) selected from directory
                          </p>
                        )}
                      </>
                    )}

                    {!localDir && (
                      <p className="text-xs text-muted-foreground">
                        Set a local folder once — files stay on your Mac and are never stored on our servers.
                      </p>
                    )}
                  </div>
                )}

                {/* Standard file picker fallback */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {supportsLocalDirectory() ? "Or upload files directly:" : "Select video or audio files:"}
                  </p>
                  <div
                    className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => document.getElementById("file-input")?.click()}
                  >
                    <Upload className="w-6 h-6 mx-auto text-muted-foreground mb-1" />
                    <p className="text-sm text-muted-foreground">
                      Click to select files (MP4, MOV, MP3, M4A…)
                    </p>
                    <input
                      id="file-input"
                      type="file"
                      multiple
                      accept="video/*,audio/*"
                      className="hidden"
                      onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
                    />
                  </div>
                  {selectedFiles.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {selectedFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{f.name}</span>
                          <span className="shrink-0 text-xs">({(f.size / 1024 / 1024).toFixed(1)} MB)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  onClick={() => goToStage(2)}
                  disabled={!doc.subjectName.trim() || busy}
                >
                  Next: Set Up Transcript →
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STEP 2 — Transcript                                                 */}
        {/* ------------------------------------------------------------------ */}
        {doc.stage === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Transcript
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Auto-transcription section — only shown when files are selected */}
              {(selectedFiles.length > 0 || selectedLocalNames.size > 0) && (
                <div className="flex items-center justify-between gap-3 p-3 rounded-md bg-muted/30 border">
                  <p className="text-sm text-muted-foreground">
                    {selectedFiles.length + selectedLocalNames.size} file(s) selected
                    {" — "}transcription requires the media service to be active.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleTranscribe}
                    disabled={busy}
                  >
                    {busy
                      ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      : <RefreshCw className="w-4 h-4 mr-2" />}
                    {doc.rawTranscript ? "Re-transcribe" : "Transcribe"}
                  </Button>
                </div>
              )}

              {busy && (
                <div className="flex items-center gap-3 p-4 bg-muted/40 rounded-md">
                  <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    Transcribing… this may take several minutes for long recordings
                  </p>
                </div>
              )}

              <div>
                <Label>Transcript</Label>
                <p className="text-xs text-muted-foreground mb-1">
                  Paste your transcript below, or use the Transcribe button above if the media service is running.
                </p>
                <Textarea
                  rows={18}
                  className="font-mono text-sm mt-1"
                  placeholder="Paste transcript here, or use SPEAKER NAME: format e.g.&#10;&#10;INTERVIEWER: Tell me about your childhood.&#10;UNCLE BILL: It started in a small town in Yorkshire…"
                  value={doc.rawTranscript}
                  onChange={(e) => updateDoc({ rawTranscript: e.target.value })}
                />
              </div>

              {/* Speaker label renaming — only useful once there's content */}
              {doc.rawTranscript && (
                <div className="flex flex-wrap gap-4 p-3 bg-muted/20 rounded-md">
                  <p className="w-full text-xs text-muted-foreground font-medium">Rename speaker labels (find &amp; replace):</p>
                  <div>
                    <Label className="text-xs">Replace &ldquo;INTERVIEWER&rdquo; with</Label>
                    <Input
                      className="mt-0.5 h-8 text-sm w-44"
                      placeholder="e.g. ROBIN"
                      onBlur={(e) => {
                        const val = e.target.value.trim().toUpperCase();
                        if (val && val !== "INTERVIEWER") {
                          updateDoc({
                            rawTranscript: doc.rawTranscript.replace(/INTERVIEWER:/g, `${val}:`),
                          });
                        }
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Replace &ldquo;SUBJECT&rdquo; with</Label>
                    <Input
                      className="mt-0.5 h-8 text-sm w-44"
                      placeholder={doc.subjectName.toUpperCase() || "e.g. BILL"}
                      onBlur={(e) => {
                        const val = e.target.value.trim().toUpperCase();
                        const orig = (doc.subjectName || "SUBJECT").toUpperCase();
                        if (val && val !== orig) {
                          updateDoc({
                            rawTranscript: doc.rawTranscript
                              .replace(new RegExp(`\\b${orig}:`, "g"), `${val}:`)
                              .replace(/\[SUBJECT NAME\]/g, val),
                          });
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-1">
                <Button
                  onClick={() => goToStage(3)}
                  disabled={!doc.rawTranscript.trim()}
                >
                  Transcript looks good → Continue
                </Button>
                <Button variant="outline" onClick={() => goToStage(1)}>
                  ← Back
                </Button>
                {localDir && doc.rawTranscript && (
                  <Button variant="outline" onClick={() => saveToFolder(doc.rawTranscript, "transcript")}>
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Save to {localDirName}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STEP 3 — Story Dialogue                                             */}
        {/* ------------------------------------------------------------------ */}
        {doc.stage === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>Story Dialogue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Style picker */}
              <div>
                <Label className="mb-2 block">Dialogue style</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(
                    [
                      {
                        value: "monologue",
                        label: "Monologue",
                        desc: `${doc.subjectName || "Subject"} speaks alone — interviewer questions removed`,
                      },
                      {
                        value: "interview",
                        label: "Interview",
                        desc: "Q&A preserved as clean dialogue between interviewer and subject",
                      },
                      {
                        value: "mixed",
                        label: "Mixed Documentary",
                        desc: "Narrator bridges sections; subject's key quotes as direct speech",
                      },
                    ] as { value: DialogueStyle; label: string; desc: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateDoc({ dialogueStyle: opt.value })}
                      className={[
                        "text-left p-3 rounded-lg border transition-colors",
                        doc.dialogueStyle === opt.value
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/40",
                      ].join(" ")}
                    >
                      <p className="font-medium text-sm">{opt.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={handleGenerateDialogue} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Generate Dialogue
              </Button>

              {/* Side-by-side panels */}
              {(doc.rawTranscript || doc.cleanedDialogue) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Raw transcript (original)
                    </Label>
                    <Textarea
                      rows={16}
                      className="font-mono text-xs bg-muted/30"
                      readOnly
                      value={doc.rawTranscript}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Cleaned dialogue (editable)
                    </Label>
                    <Textarea
                      rows={16}
                      className="font-mono text-xs"
                      value={doc.cleanedDialogue}
                      onChange={(e) => updateDoc({ cleanedDialogue: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-1">
                <Button
                  onClick={() => goToStage(4)}
                  disabled={!doc.cleanedDialogue.trim()}
                >
                  Use this dialogue → Continue
                </Button>
                <Button variant="outline" onClick={() => goToStage(2)}>
                  ← Back
                </Button>
                {localDir && doc.cleanedDialogue && (
                  <Button variant="outline" onClick={() => saveToFolder(doc.cleanedDialogue, "dialogue")}>
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Save to {localDirName}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STEP 4 — Documentary Script                                         */}
        {/* ------------------------------------------------------------------ */}
        {doc.stage === 4 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScrollTextIcon className="w-5 h-5" />
                Documentary Script
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Button onClick={handleGenerateScript} disabled={busy}>
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {doc.generatedScript ? "Regenerate" : "Generate Script"}
                </Button>
                {doc.generatedScript && !scriptSaved && (
                  <Button variant="outline" onClick={handleSaveScript} disabled={busy}>
                    Save as Project Script
                  </Button>
                )}
                {scriptSaved && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Saved
                  </Badge>
                )}
              </div>

              {busy && !doc.generatedScript && (
                <div className="flex items-center gap-3 p-4 bg-muted/40 rounded-md">
                  <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    Writing your documentary screenplay…
                  </p>
                </div>
              )}

              {doc.generatedScript && (
                <div
                  className="rounded-md border bg-muted/20 p-4 overflow-auto max-h-[60vh] font-mono text-xs whitespace-pre-wrap leading-relaxed"
                >
                  {doc.generatedScript}
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-1">
                <Button
                  onClick={() => goToStage(5)}
                  disabled={!doc.generatedScript}
                >
                  Continue to Shot List →
                </Button>
                <Button variant="outline" onClick={() => goToStage(3)}>
                  ← Back
                </Button>
                {localDir && doc.generatedScript && (
                  <Button variant="outline" onClick={() => saveToFolder(doc.generatedScript, "screenplay")}>
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Save to {localDirName}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STEP 5 — Shot List & Entities                                       */}
        {/* ------------------------------------------------------------------ */}
        {doc.stage === 5 && (
          <div className="space-y-6">
            {/* B-Roll suggestions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Film className="w-5 h-5" />
                  B-Roll Suggestions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!scriptSaved && (
                  <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-3">
                    Save the script in Step 4 first to link shots to scenes in the project.
                  </p>
                )}

                {broll.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No B-ROLL markers found in the script. Go back to Step 4 and generate a script first.
                  </p>
                ) : (
                  <>
                    <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                      {broll.map((shot) => (
                        <div
                          key={shot.id}
                          className={[
                            "flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors",
                            shot.selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/30",
                          ].join(" ")}
                          onClick={() =>
                            setBroll((prev) =>
                              prev.map((s) =>
                                s.id === shot.id ? { ...s, selected: !s.selected } : s
                              )
                            )
                          }
                        >
                          <input
                            type="checkbox"
                            checked={shot.selected}
                            readOnly
                            className="mt-0.5 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{shot.description}</p>
                            {shot.contextQuote && (
                              <p className="text-xs text-muted-foreground mt-1 italic truncate">
                                &ldquo;{shot.contextQuote}&rdquo;
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button
                        onClick={handleApplyShots}
                        disabled={busy || broll.every((s) => !s.selected)}
                      >
                        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Add Selected to Shot List ({broll.filter((s) => s.selected).length})
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          setBroll((prev) => prev.map((s) => ({ ...s, selected: true })))
                        }
                      >
                        Select All
                      </Button>
                      {projectId && (
                        <Link href={`/project/${projectId}/shotlist`}>
                          <Button variant="outline">View Shot List →</Button>
                        </Link>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Entity extraction */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  People &amp; Places
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Extract named people, places, and organisations from the interview. They will
                  be added to your project Objects for use in the Moodboard and Shot List.
                </p>

                {!savedScriptId ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-3">
                    Save the script first (Step 4) to attach entities to the project.
                  </p>
                ) : (
                  <Button
                    onClick={handleExtractEntities}
                    disabled={busy}
                    variant="outline"
                  >
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Extract People &amp; Places
                  </Button>
                )}

                {entities.length > 0 && (
                  <div className="space-y-1">
                    {entities.map((e) => (
                      <div key={e.id} className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {e.objectType}
                        </Badge>
                        <span>{e.name}</span>
                      </div>
                    ))}
                    {projectId && (
                      <Link href={`/project/${projectId}/objects`} className="mt-2 inline-block">
                        <Button variant="link" className="p-0 h-auto text-sm">
                          View in Objects →
                        </Button>
                      </Link>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => goToStage(4)}>
                ← Back to Script
              </Button>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

// Tiny inline icon to avoid importing ScrollText (may not be available)
function ScrollTextIcon({ className }: { className?: string }) {
  return <FileText className={className} />;
}

function extractBroll(script: string): ShotSuggestion[] {
  const pattern = /\[B-ROLL:\s*([^\]]+)\]/gi;
  const lines = script.split("\n");
  const results: ShotSuggestion[] = [];
  lines.forEach((line, i) => {
    let match;
    const re = /\[B-ROLL:\s*([^\]]+)\]/gi;
    while ((match = re.exec(line)) !== null) {
      const context = [
        i > 0 ? lines[i - 1].trim() : "",
        i < lines.length - 1 ? lines[i + 1].trim() : "",
      ]
        .filter(Boolean)
        .join(" … ");
      results.push({
        id: crypto.randomUUID(),
        description: match[1].trim(),
        contextQuote: context,
        selected: false,
      });
    }
  });
  return results;
}

// ---------------------------------------------------------------------------
// Export with auth wrapper
// ---------------------------------------------------------------------------

export default function DocumentaryStudioPage() {
  return (
    <SessionAuth>
      <DocumentaryStudioInner />
    </SessionAuth>
  );
}
