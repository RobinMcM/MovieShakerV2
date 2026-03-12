"use client";

import { useState, useRef, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Loader2,
  Plus,
  Upload,
  Trash2,
  Palette,
  ImageIcon,
  Eye,
  EyeOff,
  Search,
  ChevronLeft,
} from "lucide-react";
import { useObjects } from "./useObjects";
import type { CharacterMood } from "../moodboard/types";
import { storageImageUrl } from "@/lib/api";

const ASPECT_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Wide)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
];

function getAspectRatioClass(aspectRatio: string | null | undefined): string {
  if (!aspectRatio) return "aspect-square";
  switch (aspectRatio) {
    case "1:1":
      return "aspect-square";
    case "16:9":
      return "aspect-[16/9]";
    case "9:16":
      return "aspect-[9/16]";
    case "4:3":
      return "aspect-[4/3]";
    case "3:4":
      return "aspect-[3/4]";
    default:
      return "aspect-square";
  }
}

function ObjectCard({
  object,
  onUpdate,
  onDelete,
  onUpload,
  fileInputRef,
  onTriggerFileInput,
  uploadingId,
  toastMessage,
  setToastMessage,
}: {
  object: CharacterMood;
  onUpdate: (id: string, u: { casting_notes?: string; aspect_ratio?: string; hide_from_view?: boolean }) => Promise<void>;
  onDelete: (obj: CharacterMood) => void;
  onUpload: (id: string, file: File) => Promise<string | undefined>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onTriggerFileInput: (id: string) => void;
  uploadingId: string | null;
  toastMessage: { title: string; description?: string; variant?: "default" | "destructive" } | null;
  setToastMessage: (m: { title: string; description?: string; variant?: "default" | "destructive" } | null) => void;
}) {
  const [localDescription, setLocalDescription] = useState(object.casting_notes ?? "");
  const imageUrl = storageImageUrl(object.character_image_url) ?? object.character_image_url ?? null;

  const handleBlur = () => {
    const v = localDescription.trim();
    if (v !== (object.casting_notes ?? "")) {
      onUpdate(object.id, { casting_notes: v }).catch(() =>
        setToastMessage({ title: "Failed to save description", variant: "destructive" })
      );
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-xl">{object.name}</CardTitle>
            <Badge variant={object.type === "character" ? "default" : object.type === "scene" ? "secondary" : "outline"}>
              {object.type ? object.type.charAt(0).toUpperCase() + object.type.slice(1) : "Object"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {object.hide_from_view ? (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Eye className="h-4 w-4 text-muted-foreground" />
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!object.hide_from_view}
                onChange={(e) => onUpdate(object.id, { hide_from_view: !e.target.checked })}
                className="rounded border-border"
              />
              <span>Visible</span>
            </label>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onDelete(object)}
              className="h-8 w-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label>Aspect Ratio</Label>
          <Select
            value={object.aspect_ratio ?? "1:1"}
            onValueChange={(value) => onUpdate(object.id, { aspect_ratio: value })}
            disabled={object.type === "character" || object.type === "scene"}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASPECT_RATIOS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className={`${getAspectRatioClass(object.aspect_ratio)} bg-muted rounded-lg overflow-hidden relative`}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={object.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground py-8">
              <ImageIcon className="h-12 w-12 mb-2" />
              <p className="text-sm">No image</p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Description</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onTriggerFileInput(object.id)}
              disabled={uploadingId === object.id}
            >
              {uploadingId === object.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-1" />
                  Upload
                </>
              )}
            </Button>
          </div>
          <Textarea
            placeholder="Describe appearance for reference..."
            value={localDescription}
            onChange={(e) => setLocalDescription(e.target.value)}
            onBlur={handleBlur}
            className="min-h-[60px] resize-none"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ObjectsContent() {
  const params = useParams();
  const projectId = (params?.projectId as string) ?? null;
  const {
    loading,
    project,
    currentScriptId,
    objects,
    refetch,
    createObject,
    updateObject,
    deleteObject,
    uploadImage,
  } = useObjects(projectId);

  const [searchTerm, setSearchTerm] = useState("");
  const [showVisibleOnly, setShowVisibleOnly] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAspectRatio, setNewAspectRatio] = useState("1:1");
  const [newType, setNewType] = useState<"character" | "object" | "scene">("object");
  const [isCreating, setIsCreating] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    title: string;
    description?: string;
    variant?: "default" | "destructive";
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CharacterMood | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileTargetIdRef = useRef<string | null>(null);

  const filteredObjects = useMemo(() => {
    return objects.filter((obj) => {
      const matchesSearch = obj.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesVisibility = showVisibleOnly ? !obj.hide_from_view : true;
      return matchesSearch && matchesVisibility;
    });
  }, [objects, searchTerm, showVisibleOnly]);

  const characterObjects = filteredObjects.filter((o) => o.type === "character");
  const objectItems = filteredObjects.filter((o) => o.type === "object");
  const sceneObjects = filteredObjects.filter((o) => o.type === "scene");

  const handleCreate = async () => {
    if (!newName.trim()) {
      setToastMessage({ title: "Name is required", variant: "destructive" });
      return;
    }
    setIsCreating(true);
    try {
      await createObject({
        name: newName.trim(),
        type: newType,
        casting_notes: newDescription.trim() || undefined,
        aspect_ratio: newAspectRatio,
      });
      setIsCreateDialogOpen(false);
      setNewName("");
      setNewDescription("");
      setNewAspectRatio("1:1");
      setNewType("object");
      setToastMessage({ title: "Item created" });
    } catch (e) {
      setToastMessage({
        title: "Failed to create",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
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

  const handleUpload = async (characterId: string, file: File): Promise<string | undefined> => {
    setUploadingId(characterId);
    try {
      const url = await uploadImage(characterId, file);
      setToastMessage({ title: "Image uploaded" });
      return url;
    } catch {
      setToastMessage({ title: "Failed to upload image", variant: "destructive" });
      return undefined;
    } finally {
      setUploadingId(null);
    }
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

        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Palette className="h-6 w-6 text-primary" />
            Objects
          </h2>
          <Dialog
            open={isCreateDialogOpen}
            onOpenChange={(open) => {
              setIsCreateDialogOpen(open);
              if (!open) {
                setNewName("");
                setNewDescription("");
                setNewAspectRatio("1:1");
                setNewType("object");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button disabled={!currentScriptId}>
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Item</DialogTitle>
                <DialogDescription>
                  Add a character, object, or scene to maintain consistent likeness across your production.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={newType}
                    onValueChange={(v: "character" | "object" | "scene") => setNewType(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="character">Person</SelectItem>
                      <SelectItem value="object">Prop</SelectItem>
                      <SelectItem value="scene">Scene</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input
                    placeholder="e.g., John Doe, Red Ferrari"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    placeholder="Describe appearance for AI or reference..."
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    className="min-h-[60px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Aspect Ratio</Label>
                  <Select value={newAspectRatio} onValueChange={setNewAspectRatio}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASPECT_RATIOS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={isCreating}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {objects.length > 0 && (
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
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showVisibleOnly}
                onChange={(e) => setShowVisibleOnly(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm">Show visible only</span>
            </label>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onFileChange}
        />

        {objects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No objects yet. Click Add Item to create props and items for your film.
            </CardContent>
          </Card>
        ) : filteredObjects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No objects match your search.</p>
              <Button variant="outline" className="mt-4" onClick={() => { setSearchTerm(""); setShowVisibleOnly(false); }}>
                Clear filters
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Accordion type="multiple" defaultValue={["characters", "objects", "scenes"]} className="space-y-4">
            {characterObjects.length > 0 && (
              <AccordionItem value="characters">
                <AccordionTrigger>Characters ({characterObjects.length})</AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pt-4">
                    {characterObjects.map((obj) => (
                      <ObjectCard
                        key={obj.id}
                        object={obj}
                        onUpdate={updateObject}
                        onDelete={handleDeleteClick}
                        onUpload={handleUpload}
                        fileInputRef={fileInputRef}
                        onTriggerFileInput={triggerFileInput}
                        uploadingId={uploadingId}
                        toastMessage={toastMessage}
                        setToastMessage={setToastMessage}
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
            {objectItems.length > 0 && (
              <AccordionItem value="objects">
                <AccordionTrigger>Objects ({objectItems.length})</AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pt-4">
                    {objectItems.map((obj) => (
                      <ObjectCard
                        key={obj.id}
                        object={obj}
                        onUpdate={updateObject}
                        onDelete={handleDeleteClick}
                        onUpload={handleUpload}
                        fileInputRef={fileInputRef}
                        onTriggerFileInput={triggerFileInput}
                        uploadingId={uploadingId}
                        toastMessage={toastMessage}
                        setToastMessage={setToastMessage}
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
            {sceneObjects.length > 0 && (
              <AccordionItem value="scenes">
                <AccordionTrigger>Scenes ({sceneObjects.length})</AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pt-4">
                    {sceneObjects.map((obj) => (
                      <ObjectCard
                        key={obj.id}
                        object={obj}
                        onUpdate={updateObject}
                        onDelete={handleDeleteClick}
                        onUpload={handleUpload}
                        fileInputRef={fileInputRef}
                        onTriggerFileInput={triggerFileInput}
                        uploadingId={uploadingId}
                        toastMessage={toastMessage}
                        setToastMessage={setToastMessage}
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        )}

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
              <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
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
