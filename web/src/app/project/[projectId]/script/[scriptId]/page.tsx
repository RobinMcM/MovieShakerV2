"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
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
import { FileText, Loader2, CheckCircle2, Lock, Unlock } from "lucide-react";
import { api, API_URL } from "@/lib/api";

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

interface SceneRow {
    id: string;
    heading: string;
    page_number: string;
    length_in_eighths?: number | null;
    scene_number?: number | null;
}

interface CharacterRow {
    id: string;
    name: string;
}

interface SceneCharacterRow {
    id: string;
    scene_id: string;
    character_id: string;
}

function ScriptManagementPage() {
    const params = useParams();
    const projectId = typeof params.projectId === "string" ? params.projectId : params.projectId?.[0];
    const scriptId = typeof params.scriptId === "string" ? params.scriptId : params.scriptId?.[0];

    const [script, setScript] = useState<Script | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);
    const [loadedScenes, setLoadedScenes] = useState<SceneRow[]>([]);
    const [loadedCharacters, setLoadedCharacters] = useState<string[]>([]);
    const [sceneCharacters, setSceneCharacters] = useState<Map<string, string[]>>(new Map());
    const [parsingScenes, setParsingScenes] = useState(false);
    const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
    const [unlockConfirmation, setUnlockConfirmation] = useState("");
    const [reparseConfirmDialogOpen, setReparseConfirmDialogOpen] = useState(false);
    const [reparseConfirmation, setReparseConfirmation] = useState("");
    const pdfBlobUrlRef = useRef<string | null>(null);

    const loadScript = useCallback(async () => {
        if (!scriptId) return;
        try {
            const res = await api.get<{ success: boolean; data: Script }>(`/scripts/${scriptId}`);
            const data = res && (res as { success?: boolean; data?: Script }).data;
            if (!data) throw new Error("Failed to fetch script");
            setScript(data);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load script.");
            setScript(null);
        }
    }, [scriptId]);

    const loadScenesAndCharacters = useCallback(async () => {
        if (!scriptId) return;
        try {
            const [scenesRes, charactersRes, sceneCharsRes] = await Promise.all([
                api.get<{ success: boolean; data: SceneRow[] }>(`/scripts/${scriptId}/scenes`),
                api.get<{ success: boolean; data: CharacterRow[] }>(`/scripts/${scriptId}/characters`),
                api.get<{ success: boolean; data: SceneCharacterRow[] }>(`/scripts/${scriptId}/scene-characters`),
            ]);
            const scenes = (scenesRes as { data?: SceneRow[] }).data ?? [];
            const chars = (charactersRes as { data?: CharacterRow[] }).data ?? [];
            const sceneChars = (sceneCharsRes as { data?: SceneCharacterRow[] }).data ?? [];
            setLoadedScenes(scenes);
            setLoadedCharacters(chars.map((c) => c.name));
            const charIdToName = new Map(chars.map((c) => [c.id, c.name]));
            const map = new Map<string, string[]>();
            sceneChars.forEach((sc) => {
                const name = charIdToName.get(sc.character_id);
                if (name) {
                    const arr = map.get(sc.scene_id) ?? [];
                    map.set(sc.scene_id, [...arr, name]);
                }
            });
            setSceneCharacters(map);
        } catch {
            setLoadedScenes([]);
            setLoadedCharacters([]);
            setSceneCharacters(new Map());
        }
    }, [scriptId]);

    useEffect(() => {
        if (!scriptId) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            await loadScript();
            if (cancelled) return;
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [scriptId, loadScript]);

    useEffect(() => {
        if (!scriptId || !script) return;
        loadScenesAndCharacters();
    }, [scriptId, script, loadScenesAndCharacters]);

    useEffect(() => {
        if (!scriptId || !script) return;
        setPdfLoadError(null);
        setPdfUrl(null);
        if (pdfBlobUrlRef.current) {
            URL.revokeObjectURL(pdfBlobUrlRef.current);
            pdfBlobUrlRef.current = null;
        }
        (async () => {
            try {
                const r = await fetch(`${API_URL}/scripts/${scriptId}/file`, { credentials: "include" });
                if (!r.ok) throw new Error("Failed to load PDF");
                const blob = await r.blob();
                const url = URL.createObjectURL(blob);
                pdfBlobUrlRef.current = url;
                setPdfUrl(url);
            } catch (e) {
                setPdfLoadError(e instanceof Error ? e.message : "Failed to load PDF");
            }
        })();
        return () => {
            if (pdfBlobUrlRef.current) {
                URL.revokeObjectURL(pdfBlobUrlRef.current);
                pdfBlobUrlRef.current = null;
            }
        };
    }, [scriptId, script?.id]);

    const handleSetCurrent = async () => {
        if (!scriptId) return;
        try {
            await api.post(`/scripts/${scriptId}/set-current`, {});
            setMessage({ text: "Current script updated.", type: "success" });
            await loadScript();
        } catch (e) {
            setMessage({ text: e instanceof Error ? e.message : "Failed to set current.", type: "error" });
        }
    };

    const handleToggleLock = async () => {
        if (!script) return;
        if (script.is_locked) {
            setUnlockConfirmation("");
            setUnlockDialogOpen(true);
            return;
        }
        await executeToggleLock(true);
    };

    const handleConfirmUnlock = async () => {
        if (!script || unlockConfirmation !== script.name) {
            setMessage({ text: "Script name does not match.", type: "error" });
            return;
        }
        await executeToggleLock(false);
        setUnlockDialogOpen(false);
    };

    const executeToggleLock = async (targetLock: boolean) => {
        if (!scriptId) return;
        try {
            const res = await api.post<{ success: boolean; data: Script }>(`/scripts/${scriptId}/set-lock`, {
                is_locked: targetLock,
            });
            const data = (res as { data?: Script }).data;
            if (data) setScript(data);
            setMessage({
                text: targetLock ? "Script locked." : "Script unlocked.",
                type: "success",
            });
        } catch (e) {
            setMessage({ text: e instanceof Error ? e.message : "Failed to update lock.", type: "error" });
        }
    };

    const handleParseScenes = () => {
        const hasData = loadedScenes.length > 0 || loadedCharacters.length > 0;
        if (hasData) {
            setReparseConfirmation("");
            setReparseConfirmDialogOpen(true);
        } else {
            executeParseScenes();
        }
    };

    const executeParseScenes = async () => {
        if (!scriptId) return;
        setReparseConfirmDialogOpen(false);
        setParsingScenes(true);
        try {
            const res = await api.post<{ success: boolean; data?: { scenes: number; characters: number } }>(
                `/scripts/${scriptId}/parse`,
                {}
            );
            const data = (res as { data?: { scenes: number; characters: number } }).data;
            setMessage({
                text: data ? `Parsed ${data.scenes} scenes and ${data.characters} characters.` : "Parse complete.",
                type: "success",
            });
            await loadScript();
            await loadScenesAndCharacters();
        } catch (e) {
            setMessage({ text: e instanceof Error ? e.message : "Failed to parse script.", type: "error" });
        } finally {
            setParsingScenes(false);
        }
    };

    const scriptCounts = loadedScenes.length || loadedCharacters.length ? { scenes: loadedScenes.length, characters: loadedCharacters.length } : null;

    if (!projectId || !scriptId) {
        return (
            <div className="min-h-screen flex flex-col bg-background">
                <AppHeader />
                <main className="flex-1 container mx-auto px-4 py-8">
                    <p className="text-muted-foreground">Invalid project or script.</p>
                    <Link href="/projects" className="text-primary underline mt-4 inline-block">
                        Back to Projects
                    </Link>
                </main>
                <Footer />
            </div>
        );
    }

    if (loading) {
        return (
            <div className="min-h-screen flex flex-col bg-background">
                <AppHeader />
                <main className="flex-1 container mx-auto px-4 py-8 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </main>
                <Footer />
            </div>
        );
    }

    if (error || !script) {
        return (
            <div className="min-h-screen flex flex-col bg-background">
                <AppHeader />
                <main className="flex-1 container mx-auto px-4 py-8">
                    <p className="text-muted-foreground">{error ?? "Script not found."}</p>
                    <Link href={`/project/${projectId}`} className="text-primary underline mt-4 inline-block">
                        Back to Project
                    </Link>
                </main>
                <Footer />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col bg-background">
            <AppHeader />
            <main className="flex-1 container mx-auto px-4 py-8">
                <div className="max-w-4xl mx-auto space-y-6">
                    <Link
                        href={`/project/${projectId}`}
                        className="text-primary underline hover:no-underline text-sm inline-block"
                    >
                        Back to Project
                    </Link>

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

                    {scriptCounts && (
                        <Card>
                            <CardContent className="py-6">
                                <div className="grid grid-cols-3 gap-6 text-center">
                                    <div>
                                        <p className="text-2xl font-bold text-primary">{loadedScenes.length}</p>
                                        <p className="text-sm text-muted-foreground mt-1">Total Scenes</p>
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold text-primary">{loadedCharacters.length}</p>
                                        <p className="text-sm text-muted-foreground mt-1">Characters</p>
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold text-primary">
                                            {script.page_count ? Math.max(0, script.page_count - 1) : 0}
                                        </p>
                                        <p className="text-sm text-muted-foreground mt-1">Expected Duration (min)</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-3">
                                <FileText className="h-6 w-6 text-primary" />
                                <div className="flex-1">
                                    <CardTitle className="text-2xl">{script.name}</CardTitle>
                                    <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
                                        <button
                                            type="button"
                                            className="text-primary hover:underline"
                                            onClick={() => {
                                                const u = `${API_URL}/scripts/${scriptId}/file?variant=json`;
                                                window.open(u, "_blank");
                                            }}
                                        >
                                            <FileText className="h-3 w-3 inline mr-1" /> View Formatted Script
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {(script.series || script.episode || script.description || script.uploaded_at) && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-4 border-b border-border/40">
                                    {script.series && (
                                        <div>
                                            <h3 className="font-semibold mb-1 text-muted-foreground text-sm">Series</h3>
                                            <p className="text-foreground">{script.series}</p>
                                        </div>
                                    )}
                                    {script.episode && (
                                        <div>
                                            <h3 className="font-semibold mb-1 text-muted-foreground text-sm">Episode</h3>
                                            <p className="text-foreground">{script.episode}</p>
                                        </div>
                                    )}
                                    {script.description && (
                                        <div className="sm:col-span-2 lg:col-span-1">
                                            <h3 className="font-semibold mb-1 text-sm text-muted-foreground">Description</h3>
                                            <p className="text-foreground">{script.description || "No description provided."}</p>
                                        </div>
                                    )}
                                    <div>
                                        <h3 className="font-semibold mb-1 text-sm text-muted-foreground">Uploaded</h3>
                                        <p className="text-foreground">
                                            {new Date(script.uploaded_at).toLocaleDateString("en-GB")} at{" "}
                                            {new Date(script.uploaded_at).toLocaleTimeString("en-GB")}
                                        </p>
                                    </div>
                                    {script.is_current && (
                                        <div>
                                            <p className="text-green-500 font-medium">Current Script</p>
                                        </div>
                                    )}
                                </div>
                            )}
                            {!script.is_current && (
                                <div className="pt-4">
                                    <Button variant="outline" onClick={handleSetCurrent}>
                                        <CheckCircle2 className="h-4 w-4 mr-2" />
                                        Set as Current
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {pdfLoadError && !pdfUrl && (
                        <Card className="border-destructive/50">
                            <CardContent className="py-6">
                                <p className="text-destructive text-sm">Failed to load PDF viewer: {pdfLoadError}</p>
                            </CardContent>
                        </Card>
                    )}

                    {pdfUrl && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Script Viewer</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Accordion type="single" collapsible defaultValue="viewer">
                                    <AccordionItem value="viewer">
                                        <AccordionTrigger>
                                            <span className="font-semibold">PDF Viewer</span>
                                        </AccordionTrigger>
                                        <AccordionContent>
                                            <div className="w-full h-[800px] border rounded-lg overflow-hidden bg-muted">
                                                <iframe
                                                    src={`${pdfUrl}#toolbar=1&navpanes=1&scrollbar=1`}
                                                    className="w-full h-full"
                                                    title="Script PDF Viewer"
                                                    allow="fullscreen"
                                                />
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-2">
                                                <a
                                                    href={pdfUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-primary hover:underline"
                                                >
                                                    Open in new tab
                                                </a>
                                            </p>
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <CardTitle className="flex items-center gap-2">
                                    Scene Headings & Characters
                                    {parsingScenes && <Loader2 className="h-4 w-4 animate-spin" />}
                                </CardTitle>
                                {script.is_current && pdfUrl && (
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handleToggleLock}
                                                title={script.is_locked ? "Unlock to allow re-parsing" : "Lock to prevent accidental re-parsing"}
                                            >
                                                {script.is_locked ? (
                                                    <Lock className="h-4 w-4 mr-2" />
                                                ) : (
                                                    <Unlock className="h-4 w-4 mr-2" />
                                                )}
                                                {script.is_locked ? "Locked" : "Lock"}
                                            </Button>
                                            <Button
                                                onClick={handleParseScenes}
                                                disabled={parsingScenes || !!script.is_locked}
                                                size="sm"
                                            >
                                                {parsingScenes
                                                    ? "Parsing..."
                                                    : scriptCounts && (scriptCounts.scenes > 0 || scriptCounts.characters > 0)
                                                      ? "Re-Parse Script"
                                                      : "Parse Script"}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            {scriptCounts && (scriptCounts.scenes > 0 || scriptCounts.characters > 0) && !parsingScenes && (
                                <div className="flex gap-4 mt-3 text-sm">
                                    <span className="text-muted-foreground">
                                        Scenes: <span className="font-semibold text-foreground">{scriptCounts.scenes}</span>
                                    </span>
                                    <span className="text-muted-foreground">
                                        Characters: <span className="font-semibold text-foreground">{scriptCounts.characters}</span>
                                    </span>
                                </div>
                            )}
                        </CardHeader>
                        <CardContent>
                            {!script.is_current ? (
                                <p className="text-muted-foreground">
                                    Set this script as current to parse scenes and characters.
                                </p>
                            ) : !pdfUrl ? (
                                <p className="text-muted-foreground">Load the script viewer first to enable parsing.</p>
                            ) : parsingScenes ? (
                                <p className="text-muted-foreground">Parsing script...</p>
                            ) : loadedScenes.length > 0 || loadedCharacters.length > 0 ? (
                                <div className="space-y-6">
                                    {loadedScenes.length > 0 && (
                                        <div>
                                            <h3 className="font-semibold mb-3">Scene Headings ({loadedScenes.length})</h3>
                                            <Accordion type="single" collapsible className="w-full">
                                                {loadedScenes.map((scene, index) => (
                                                    <AccordionItem key={scene.id} value={`scene-${index}`}>
                                                        <AccordionTrigger className="hover:no-underline">
                                                            <div className="flex items-center gap-4 text-left">
                                                                <FileText className="h-4 w-4 text-primary" />
                                                                <span className="font-semibold">Scene {index + 1}:</span>
                                                                <span>{scene.heading}</span>
                                                                {scene.length_in_eighths != null && (
                                                                    <span className="ml-auto text-xs text-muted-foreground">
                                                                        {scene.length_in_eighths >= 8
                                                                            ? `${Math.floor(scene.length_in_eighths / 8)} pg ${scene.length_in_eighths % 8}/8`
                                                                            : `${scene.length_in_eighths}/8 pg`}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </AccordionTrigger>
                                                        <AccordionContent>
                                                            <div className="pt-2 space-y-3">
                                                                <p className="text-sm text-muted-foreground">
                                                                    <strong>Page Number:</strong> {scene.page_number}
                                                                </p>
                                                                {scene.length_in_eighths != null && (
                                                                    <p className="text-sm text-muted-foreground">
                                                                        <strong>Length:</strong> {scene.length_in_eighths} eighths
                                                                    </p>
                                                                )}
                                                                {sceneCharacters.get(scene.id)?.length ? (
                                                                    <div>
                                                                        <p className="text-sm font-semibold mb-2">Characters in this scene:</p>
                                                                        <div className="flex flex-wrap gap-2">
                                                                            {sceneCharacters.get(scene.id)!.map((char, charIdx) => (
                                                                                <span
                                                                                    key={charIdx}
                                                                                    className="px-2 py-1 bg-primary/10 text-primary rounded-md text-xs font-medium"
                                                                                >
                                                                                    {char}
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        </AccordionContent>
                                                    </AccordionItem>
                                                ))}
                                            </Accordion>
                                        </div>
                                    )}
                                    {loadedCharacters.length > 0 && (
                                        <div>
                                            <h3 className="font-semibold mb-3">Characters ({loadedCharacters.length})</h3>
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                                {loadedCharacters.map((name, index) => (
                                                    <div
                                                        key={index}
                                                        className="px-3 py-2 bg-muted rounded-md text-sm font-mono font-semibold"
                                                    >
                                                        {name}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="text-muted-foreground">
                                    {script.is_current && pdfUrl
                                        ? 'Click "Parse Script" to extract scene headings and character names.'
                                        : script.is_current
                                          ? "Load the script viewer first to enable parsing."
                                          : "Set this script as current to parse scenes and characters."}
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    <AlertDialog
                        open={unlockDialogOpen}
                        onOpenChange={(open) => {
                            setUnlockDialogOpen(open);
                            if (!open) setUnlockConfirmation("");
                        }}
                    >
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Unlock Script?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Unlocking allows re-parsing, which will permanently delete existing scene data. To confirm, type the script name{" "}
                                    <b>{script.name}</b> below:
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="py-2">
                                <Input
                                    value={unlockConfirmation}
                                    onChange={(e) => setUnlockConfirmation(e.target.value)}
                                    placeholder={script.name ?? undefined}
                                    className={unlockConfirmation === script.name ? "border-green-500" : ""}
                                />
                            </div>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={(e) => {
                                        e.preventDefault();
                                        handleConfirmUnlock();
                                    }}
                                    disabled={unlockConfirmation !== script.name}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    I understand, Unlock Script
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>

                    <AlertDialog
                        open={reparseConfirmDialogOpen}
                        onOpenChange={(open) => {
                            setReparseConfirmDialogOpen(open);
                            if (!open) setReparseConfirmation("");
                        }}
                    >
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Re-Parse Script?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Re-parsing will permanently delete all existing scene data. To confirm, type the script name{" "}
                                    <b>{script.name}</b> below:
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="py-2">
                                <Input
                                    value={reparseConfirmation}
                                    onChange={(e) => setReparseConfirmation(e.target.value)}
                                    placeholder={script.name ?? undefined}
                                    className={reparseConfirmation === script.name ? "border-green-500" : ""}
                                />
                            </div>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={(e) => {
                                        e.preventDefault();
                                        executeParseScenes();
                                    }}
                                    disabled={reparseConfirmation !== script.name}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    I understand, Re-Parse Script
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </main>
            <Footer />
        </div>
    );
}

export default function ScriptManagement() {
    return (
        <SessionAuth>
            <ScriptManagementPage />
        </SessionAuth>
    );
}
