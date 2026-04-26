"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  Plus,
  Upload,
  Trash2,
  CheckCircle2,
  Circle,
  Palette,
  ImageIcon,
  Search,
  ChevronLeft,
  Sparkles,
  ScanSearch,
} from "lucide-react";
import { useObjects } from "./useObjects";
import type { BackgroundLocation } from "./useObjects";
import type { CharacterMood } from "../moodboard/types";
import { storageImageUrl } from "@/lib/api";

const PROJECT_ASPECT_RATIO_OPTIONS = [
  { value: "16:9", label: "Landscape (16:9) - most common" },
  { value: "9:16", label: "Vertical (9:16) - mobile / social media" },
  { value: "1:1", label: "Square (1:1) - simple / training datasets" },
  { value: "2.39:1", label: "Cinematic (2.39:1) - film style" },
];

function getAspectRatioClass(aspectRatio: string | null | undefined): string {
  switch (aspectRatio) {
    case "1:1": return "aspect-square";
    case "16:9": return "aspect-[16/9]";
    case "9:16": return "aspect-[9/16]";
    case "4:3": return "aspect-[4/3]";
    case "3:4": return "aspect-[3/4]";
    case "2.39:1": return "aspect-[2.39/1]";
    default: return "aspect-square";
  }
}

function parseSceneTags(sceneTags: string | null | undefined): string[] {
  if (!sceneTags) return [];
  try {
    const parsed = JSON.parse(sceneTags);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// ─── Character / Artifact card (existing objects) ───────────────────────────

function ObjectCard({
  object,
  onUpdate,
  onDelete,
  onGenerate,
  onTriggerFileInput,
  uploadingId,
  setToastMessage,
  showSceneTags = false,
}: {
  object: CharacterMood;
  onUpdate: (id: string, u: { casting_notes?: string; aspect_ratio?: string; hide_from_view?: boolean }) => Promise<void>;
  onDelete: (obj: CharacterMood) => void;
  onGenerate: (id: string, prompt: string, aspectRatio?: string | null) => Promise<void>;
  onTriggerFileInput: (id: string) => void;
  uploadingId: string | null;
  setToastMessage: (m: { title: string; description?: string; variant?: "default" | "destructive" } | null) => void;
  showSceneTags?: boolean;
}) {
  const [description, setDescription] = useState(object.casting_notes ?? object.name);
  const [isGenerating, setIsGenerating] = useState(false);
  const imageUrl = storageImageUrl(object.character_image_url) ?? object.character_image_url ?? null;
  const sceneTags = showSceneTags ? parseSceneTags(object.scene_tags) : [];

  useEffect(() => {
    setDescription(object.casting_notes ?? object.name);
  }, [object.casting_notes, object.name]);

  const handleBlur = () => {
    const v = description.trim();
    if (v !== (object.casting_notes ?? "")) {
      onUpdate(object.id, { casting_notes: v }).catch(() =>
        setToastMessage({ title: "Failed to save description", variant: "destructive" })
      );
    }
  };

  const handleGenerate = async () => {
    const prompt = description.trim();
    if (!prompt) {
      setToastMessage({ title: "Prompt is required", variant: "destructive" });
      return;
    }
    try {
      setIsGenerating(true);
      await onGenerate(object.id, prompt, object.aspect_ratio ?? null);
      setToastMessage({ title: "Image generated" });
    } catch (e) {
      setToastMessage({
        title: "Failed to generate image",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex flex-col items-start gap-1">
          {object.object_type && (
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {object.object_type.replace(/_/g, " ")}
            </span>
          )}
          <CardTitle className="text-xl w-full break-words">{object.name}</CardTitle>
          {showSceneTags && sceneTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {sceneTags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border"
                >
                  Sc.{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant={!object.hide_from_view ? "default" : "outline"}
              onClick={() => onUpdate(object.id, { hide_from_view: !object.hide_from_view })}
              className="h-8 w-8"
              title={!object.hide_from_view ? "Published" : "Publish"}
              aria-label={!object.hide_from_view ? "Published" : "Publish"}
            >
              {!object.hide_from_view ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
            </Button>
            <span className="text-sm">Publish</span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onDelete(object)}
            className="h-8 w-8 text-destructive hover:text-destructive"
            title="Delete"
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4">
        <div className={`${getAspectRatioClass(object.aspect_ratio)} bg-muted rounded-lg overflow-hidden relative`}>
          {imageUrl ? (
            <img src={imageUrl} alt={object.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground py-8">
              <ImageIcon className="h-12 w-12 mb-2" />
              <p className="text-sm">No image</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onTriggerFileInput(object.id)}
            disabled={uploadingId === object.id}
          >
            {uploadingId === object.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <><Upload className="h-4 w-4 mr-1" />Upload</>
            )}
          </Button>
          <Button size="sm" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <><Sparkles className="h-4 w-4 mr-1" />Generate</>
            )}
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Description (AI prompt)</Label>
          <Textarea
            placeholder="Describe for AI image generation..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleBlur}
            className="min-h-[60px] resize-none"
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Background location card ─────────────────────────────────────────────────

function BackgroundLocationCard({
  location,
  scriptId,
  onGenerateSketch,
  onUpload,
  uploadingLocation,
  setToastMessage,
}: {
  location: BackgroundLocation;
  scriptId: string;
  onGenerateSketch: (scriptId: string, locationName: string, locationType: string | null, sceneNumbers: number[]) => Promise<void>;
  onUpload: (locationName: string, backgroundId: string | null, file: File) => Promise<void>;
  uploadingLocation: string | null;
  setToastMessage: (m: { title: string; description?: string; variant?: "default" | "destructive" } | null) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageUrl = storageImageUrl(location.image_url) ?? location.image_url ?? null;
  const isUploading = uploadingLocation === location.location_name;

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await onGenerateSketch(scriptId, location.location_name, location.location_type, location.scene_numbers);
      setToastMessage({ title: "Background sketch generated" });
    } catch (e) {
      setToastMessage({
        title: "Failed to generate sketch",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {location.location_type && (
              <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">
                {location.location_type}
              </span>
            )}
            <CardTitle className="text-base break-words leading-snug">{location.location_name}</CardTitle>
          </div>
          {location.scene_numbers.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {location.scene_numbers.map((n) => (
                <span
                  key={n}
                  className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border"
                >
                  Sc.{n}
                </span>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4">
        <div className="aspect-[16/9] bg-muted rounded-lg overflow-hidden relative">
          {imageUrl ? (
            <img src={imageUrl} alt={location.location_name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
              <ImageIcon className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-xs text-muted-foreground">No background yet</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={generating || isUploading}
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1" />
            )}
            {generating ? "Generating..." : "Generate sketch"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={generating || isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <><Upload className="h-4 w-4 mr-1" />Upload</>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(location.location_name, location.background_id, file);
              e.target.value = "";
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">
        No {label} yet. Click Add to create one.
      </CardContent>
    </Card>
  );
}

function ObjectGrid({
  items,
  emptyLabel,
  onUpdate,
  onDelete,
  onGenerate,
  onTriggerFileInput,
  uploadingId,
  setToastMessage,
  showSceneTags = false,
}: {
  items: CharacterMood[];
  emptyLabel: string;
  onUpdate: (id: string, u: { casting_notes?: string; aspect_ratio?: string; hide_from_view?: boolean }) => Promise<void>;
  onDelete: (obj: CharacterMood) => void;
  onGenerate: (id: string, prompt: string, aspectRatio?: string | null) => Promise<void>;
  onTriggerFileInput: (id: string) => void;
  uploadingId: string | null;
  setToastMessage: (m: { title: string; description?: string; variant?: "default" | "destructive" } | null) => void;
  showSceneTags?: boolean;
}) {
  if (items.length === 0) return <EmptyState label={emptyLabel} />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {items.map((obj) => (
        <ObjectCard
          key={obj.id}
          object={obj}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onGenerate={onGenerate}
          onTriggerFileInput={onTriggerFileInput}
          uploadingId={uploadingId}
          setToastMessage={setToastMessage}
          showSceneTags={showSceneTags}
        />
      ))}
    </div>
  );
}

// ─── Tab types / config ───────────────────────────────────────────────────────

type TabKey = "characters" | "backgrounds" | "artifacts";

const TAB_CONFIG: Record<TabKey, { label: string; addLabel: string; objectType: string; type: "character" | "object"; defaultAspect: string }> = {
  characters: { label: "Characters", addLabel: "Add Character", objectType: "principal", type: "character", defaultAspect: "1:1" },
  backgrounds: { label: "Backgrounds", addLabel: "Add Background", objectType: "background", type: "object", defaultAspect: "16:9" },
  artifacts: { label: "Artifacts", addLabel: "Add Artifact", objectType: "prop", type: "object", defaultAspect: "1:1" },
};

// ─── Create dialog ─────────────────────────────────────────────────────────────

function CreateDialog({
  tab,
  currentScriptId,
  onCreate,
}: {
  tab: TabKey;
  currentScriptId: string | null;
  onCreate: (params: { name: string; type: "character" | "object"; object_type: string; casting_notes?: string; aspect_ratio?: string }) => Promise<void>;
}) {
  const config = TAB_CONFIG[tab];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [aspectRatio, setAspectRatio] = useState(config.defaultAspect);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setIsCreating(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        type: config.type,
        object_type: config.objectType,
        casting_notes: description.trim() || undefined,
        aspect_ratio: aspectRatio,
      });
      setOpen(false);
      setName("");
      setDescription("");
      setAspectRatio(config.defaultAspect);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setName(""); setDescription(""); setAspectRatio(config.defaultAspect); setError(null); } }}>
      <DialogTrigger asChild>
        <Button disabled={!currentScriptId} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          {config.addLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{config.addLabel}</DialogTitle>
          <DialogDescription>
            Add a {config.label.toLowerCase().slice(0, -1)} to maintain consistent visual identity across your production.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input
              placeholder={tab === "characters" ? "e.g., Detective Kane" : tab === "backgrounds" ? "e.g., Police Station Interior" : "e.g., Red Sports Car"}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="Describe appearance for AI image generation..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[60px]"
            />
          </div>
          <div className="space-y-2">
            <Label>Aspect Ratio</Label>
            <Select value={aspectRatio} onValueChange={setAspectRatio}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROJECT_ASPECT_RATIO_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page content ────────────────────────────────────────────────────────

function ObjectsContent() {
  const params = useParams();
  const projectId = (params?.projectId as string) ?? null;
  const {
    loading,
    project,
    currentScriptId,
    objectImageModels,
    characterObjects,
    artifactObjects,
    backgroundLocations,
    createObject,
    updateObject,
    deleteObject,
    uploadImage,
    generateImage,
    generateBackgroundSketch,
    uploadBackgroundImage,
  } = useObjects(projectId);

  const [activeTab, setActiveTab] = useState<TabKey>("characters");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedImageModel, setSelectedImageModel] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadingLocation, setUploadingLocation] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    title: string;
    description?: string;
    variant?: "default" | "destructive";
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CharacterMood | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileTargetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!Array.isArray(objectImageModels) || objectImageModels.length === 0) {
      setSelectedImageModel(null);
      return;
    }
    if (selectedImageModel && objectImageModels.some((m) => m.id === selectedImageModel)) return;
    const defaultModel =
      objectImageModels.find(
        (m) => (m.default_for_media_type || "").toLowerCase() === "image-generation"
      )?.id || objectImageModels[0]?.id || null;
    setSelectedImageModel(defaultModel);
  }, [objectImageModels, selectedImageModel]);

  // Dismiss toast after 3 seconds
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const allObjects = useMemo(
    () => [...characterObjects, ...artifactObjects],
    [characterObjects, artifactObjects]
  );

  const filteredCharacters = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return term ? characterObjects.filter((o) => o.name.toLowerCase().includes(term)) : characterObjects;
  }, [characterObjects, searchTerm]);

  const filteredArtifacts = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return term ? artifactObjects.filter((o) => o.name.toLowerCase().includes(term)) : artifactObjects;
  }, [artifactObjects, searchTerm]);

  const filteredBackgroundLocations = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return term
      ? backgroundLocations.filter((l) => l.location_name.toLowerCase().includes(term))
      : backgroundLocations;
  }, [backgroundLocations, searchTerm]);

  const handleCreate = async (params: {
    name: string;
    type: "character" | "object";
    object_type: string;
    casting_notes?: string;
    aspect_ratio?: string;
  }) => {
    await createObject({ ...params });
    setToastMessage({ title: "Item created" });
  };

  const handleDeleteClick = (obj: CharacterMood) => setDeleteTarget(obj);
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteObject(deleteTarget.id);
      setDeleteTarget(null);
      setToastMessage({ title: `${deleteTarget.name} deleted` });
    } catch {
      setToastMessage({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const handleUpload = async (characterId: string, file: File) => {
    setUploadingId(characterId);
    try {
      await uploadImage(characterId, file);
      setToastMessage({ title: "Image uploaded" });
    } catch {
      setToastMessage({ title: "Failed to upload image", variant: "destructive" });
    } finally {
      setUploadingId(null);
    }
  };

  const handleGenerate = async (characterId: string, prompt: string, aspectRatio?: string | null) => {
    await generateImage(characterId, prompt, aspectRatio ?? undefined, selectedImageModel);
  };

  const triggerFileInput = (objectId: string) => {
    fileTargetIdRef.current = objectId;
    fileInputRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const id = fileTargetIdRef.current;
    if (file && id) handleUpload(id, file);
    e.target.value = "";
    fileTargetIdRef.current = null;
  };

  const handleBackgroundUpload = async (
    locationName: string,
    backgroundId: string | null,
    file: File
  ) => {
    if (!currentScriptId) return;
    setUploadingLocation(locationName);
    try {
      await uploadBackgroundImage(currentScriptId, locationName, backgroundId, file);
      setToastMessage({ title: "Background image uploaded" });
    } catch {
      setToastMessage({ title: "Failed to upload background", variant: "destructive" });
    } finally {
      setUploadingLocation(null);
    }
  };

  const handleIdentifyArtifacts = () => {
    window.dispatchEvent(new Event("openCoproducer"));
    window.dispatchEvent(
      new CustomEvent("coproducerSendMessage", {
        detail: {
          message:
            "Read the action lines in script.json and identify all physical objects that:\n" +
            "1. Are physically handled by a character\n" +
            "2. Appear in more than one scene\n" +
            "3. Are plot-significant\n\n" +
            "For each artifact return:\n" +
            "- name\n" +
            "- description\n" +
            "- scene numbers where it appears\n" +
            "- why it needs continuity tracking\n\n" +
            "Format as a list I can review before adding to the objects library.",
        },
      })
    );
  };

  const gridProps = {
    onUpdate: updateObject,
    onDelete: handleDeleteClick,
    onGenerate: handleGenerate,
    onTriggerFileInput: triggerFileInput,
    uploadingId,
    setToastMessage,
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
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href={projectId ? `/project/${projectId}` : "/"}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Link>
        </div>

        {project && (
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">{project.title ?? project.name}</h1>
          </div>
        )}

        <div className="flex items-center gap-2 mb-6">
          <Palette className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-bold">Objects</h2>
        </div>

        {(allObjects.length > 0 || backgroundLocations.length > 0) && (
          <div className="mb-6 flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="sm:w-[360px]">
              <Select
                value={selectedImageModel || "__none__"}
                onValueChange={(value) => setSelectedImageModel(value === "__none__" ? null : value)}
              >
                <SelectTrigger><SelectValue placeholder="Text-to-Image model" /></SelectTrigger>
                <SelectContent>
                  {objectImageModels.length === 0 ? (
                    <SelectItem value="__none__">No models available</SelectItem>
                  ) : (
                    objectImageModels
                      .filter((model) => (model.status || "active") !== "deprecated")
                      .map((model) => (
                        <SelectItem key={`obj-model-${model.id}`} value={model.id}>
                          {model.name || model.id}{model.provider ? ` (${model.provider})` : ""}
                        </SelectItem>
                      ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Hidden file input for character/artifact uploads */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onFileChange}
        />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              <TabsTrigger value="characters">
                Characters{characterObjects.length > 0 && <span className="ml-1.5 text-xs opacity-70">({characterObjects.length})</span>}
              </TabsTrigger>
              <TabsTrigger value="backgrounds">
                Backgrounds{filteredBackgroundLocations.length > 0 && <span className="ml-1.5 text-xs opacity-70">({filteredBackgroundLocations.length})</span>}
              </TabsTrigger>
              <TabsTrigger value="artifacts">
                Artifacts{artifactObjects.length > 0 && <span className="ml-1.5 text-xs opacity-70">({artifactObjects.length})</span>}
              </TabsTrigger>
            </TabsList>
            {activeTab !== "backgrounds" && (
              <CreateDialog
                tab={activeTab}
                currentScriptId={currentScriptId}
                onCreate={handleCreate}
              />
            )}
          </div>

          {/* ── Characters tab ── */}
          <TabsContent value="characters">
            <ObjectGrid
              items={filteredCharacters}
              emptyLabel="characters"
              showSceneTags={true}
              {...gridProps}
            />
          </TabsContent>

          {/* ── Backgrounds tab ── */}
          <TabsContent value="backgrounds">
            {filteredBackgroundLocations.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  {currentScriptId
                    ? "No locations found in this script. Parse the script to populate scene locations."
                    : "No script found for this project."}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredBackgroundLocations.map((location) => (
                  <BackgroundLocationCard
                    key={location.location_name}
                    location={location}
                    scriptId={currentScriptId!}
                    onGenerateSketch={generateBackgroundSketch}
                    onUpload={handleBackgroundUpload}
                    uploadingLocation={uploadingLocation}
                    setToastMessage={setToastMessage}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Artifacts tab ── */}
          <TabsContent value="artifacts">
            <div className="flex flex-col gap-6">
              <div className="flex justify-start">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleIdentifyArtifacts}
                  disabled={!currentScriptId}
                  className="gap-2"
                >
                  <ScanSearch className="h-4 w-4" />
                  Identify artifacts in this script
                </Button>
              </div>
              <ObjectGrid
                items={filteredArtifacts}
                emptyLabel="artifacts"
                {...gridProps}
              />
            </div>
          </TabsContent>
        </Tabs>

        {toastMessage && (
          <div
            className={`fixed bottom-4 right-4 px-4 py-2 rounded-md border ${
              toastMessage.variant === "destructive"
                ? "bg-destructive/10 border-destructive text-destructive"
                : "bg-muted border-border"
            }`}
          >
            <p className="font-medium">{toastMessage.title}</p>
            {toastMessage.description && (
              <p className="text-sm opacity-90">{toastMessage.description}</p>
            )}
          </div>
        )}

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This cannot be undone. This will permanently delete this item and remove it from the project.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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

export default function ObjectsPage() {
  return (
    <SessionAuth>
      <ObjectsContent />
    </SessionAuth>
  );
}
