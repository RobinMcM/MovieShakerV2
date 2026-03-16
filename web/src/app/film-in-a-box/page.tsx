"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { Loader2, Clapperboard, Save, Plus, ArrowLeft, FileText, Video, User } from "lucide-react";

import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";

type ContentType = "FILM" | "DOC";

interface SavedItem {
    id: string;
    name: string;
    type: ContentType;
    project_id?: string | null;
    created_at: string;
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

interface ProjectData {
    id: string;
    name: string;
}

interface ConfigStatusResponse {
    success: boolean;
    config: {
        gatewayConnected: boolean;
        hasGatewayKey: boolean;
        models: Array<{ id: string; name?: string; provider?: string }>;
    };
}

function FilmInABoxPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const projectId = searchParams.get("project");

    const [title, setTitle] = useState("");
    const [prompt, setPrompt] = useState("");
    const [type, setType] = useState<ContentType>("FILM");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const [filmResult, setFilmResult] = useState<string | null>(null);
    const [docResult, setDocResult] = useState<DocResult | null>(null);
    const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
    const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

    const [projectDetails, setProjectDetails] = useState<ProjectData | null>(null);
    const [configStatus, setConfigStatus] = useState<ConfigStatusResponse["config"] | null>(null);

    const hasContent = Boolean(filmResult || docResult);

    const clearMessage = () => setMessage(null);

    const loadConfigStatus = useCallback(async () => {
        try {
            const res = await api.get<ConfigStatusResponse>("/api/config/status");
            if (res?.success) {
                setConfigStatus(res.config);
            }
        } catch {
            setConfigStatus(null);
        }
    }, []);

    const loadProjectDetails = useCallback(async () => {
        if (!projectId) {
            setProjectDetails(null);
            return;
        }
        try {
            const all = await api.get<ProjectData[]>("/projects/");
            const found = (all || []).find((p) => p.id === projectId) || null;
            setProjectDetails(found);
            if (found?.name) {
                setTitle(found.name);
            }
        } catch {
            setProjectDetails(null);
        }
    }, [projectId]);

    const handleLoadItem = useCallback(
        async (itemId: string) => {
            setLoading(true);
            clearMessage();
            try {
                const data = await api.get<{ type: ContentType; content: unknown }>(`/api/film-in-a-box/content/${itemId}`);
                if (data.type === "FILM") {
                    setType("FILM");
                    setFilmResult(String(data.content ?? ""));
                    setDocResult(null);
                } else {
                    setType("DOC");
                    setDocResult((data.content as DocResult) || null);
                    setFilmResult(null);
                }
            } catch (err) {
                setMessage({
                    kind: "error",
                    text: err instanceof Error ? err.message : "Failed to load saved item.",
                });
            } finally {
                setLoading(false);
            }
        },
        []
    );

    const loadSavedItems = useCallback(async () => {
        try {
            const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
            const data = await api.get<{ list: SavedItem[] }>(`/api/film-in-a-box/list${query}`);
            const list = data?.list || [];
            setSavedItems(list);
            if (projectId && list.length > 0) {
                await handleLoadItem(list[0].id);
            }
        } catch {
            setSavedItems([]);
        }
    }, [projectId, handleLoadItem]);

    useEffect(() => {
        loadConfigStatus();
        loadProjectDetails();
    }, [loadConfigStatus, loadProjectDetails]);

    useEffect(() => {
        loadSavedItems();
    }, [loadSavedItems]);

    const handleGenerate = async () => {
        clearMessage();
        if (!title.trim() || !prompt.trim()) {
            setMessage({ kind: "error", text: "Title and prompt are required." });
            return;
        }
        if (!configStatus?.gatewayConnected || !configStatus?.hasGatewayKey) {
            setMessage({
                kind: "error",
                text: "AI gateway is not connected. Check gateway status and key configuration first.",
            });
            return;
        }

        const isContinuing = Boolean((type === "FILM" && filmResult) || (type === "DOC" && docResult));

        if (!isContinuing) {
            setFilmResult(null);
            setDocResult(null);
        }

        setLoading(true);
        try {
            const res = await api.post<{ result: string | DocResult }>("/api/film-in-a-box/generate", {
                title: title.trim(),
                prompt: prompt.trim(),
                type,
                previousContent: isContinuing ? (type === "FILM" ? filmResult : docResult) : undefined,
            });

            if (type === "FILM") {
                const next = String(res.result || "");
                setFilmResult((prev) => (isContinuing && prev ? `${prev}\n\n${next}` : next));
                setDocResult(null);
            } else {
                setDocResult((res.result as DocResult) || null);
                setFilmResult(null);
            }
        } catch (err) {
            setMessage({
                kind: "error",
                text: err instanceof Error ? err.message : "Failed to generate content.",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        clearMessage();
        const content = type === "FILM" ? filmResult : docResult;
        if (!content) return;

        setSaving(true);
        try {
            if (projectId) {
                await api.post("/api/film-in-a-box/save", {
                    projectId,
                    title: title.trim(),
                    type,
                    content,
                    prompt: prompt.trim() || undefined,
                });
                setMessage({ kind: "success", text: "Saved to project successfully." });
                await loadSavedItems();
            } else {
                const res = await api.post<{ projectId: string }>("/api/film-in-a-box/create-project", {
                    title: title.trim(),
                    type,
                    content,
                    prompt: prompt.trim() || undefined,
                });
                setMessage({ kind: "success", text: "Project created successfully." });
                router.push(`/project/${res.projectId}`);
            }
        } catch (err) {
            setMessage({
                kind: "error",
                text: err instanceof Error ? err.message : "Failed to save.",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleNewDraft = () => {
        clearMessage();
        setType("FILM");
        setPrompt("");
        setFilmResult(null);
        setDocResult(null);
        if (projectId && projectDetails?.name) {
            setTitle(projectDetails.name);
            return;
        }
        setTitle("");
    };

    const backHref = projectId ? `/project/${projectId}` : "/projects";
    const gatewaySummary = useMemo(() => {
        if (!configStatus) return "Gateway status unavailable";
        const modelCount = Array.isArray(configStatus.models) ? configStatus.models.length : 0;
        if (configStatus.gatewayConnected && configStatus.hasGatewayKey) {
            return `Gateway connected (${modelCount} model${modelCount === 1 ? "" : "s"})`;
        }
        return "Gateway not ready";
    }, [configStatus]);

    return (
        <div className="min-h-screen flex flex-col bg-background">
            <AppHeader />

            <main className="flex-1 container mx-auto px-4 py-8 space-y-6">
                <div className="flex items-center justify-between gap-3">
                    <Link href={backHref}>
                        <Button variant="outline" size="sm">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back
                        </Button>
                    </Link>
                    <div className="text-right">
                        <h1 className="text-2xl font-bold">Film in a Box</h1>
                        <p className="text-sm text-muted-foreground">AI-Powered Production Planning Suite</p>
                    </div>
                </div>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-sm text-muted-foreground">{gatewaySummary}</div>
                            <div
                                className={`text-xs px-2 py-1 rounded-full ${
                                    configStatus?.gatewayConnected && configStatus?.hasGatewayKey
                                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                                        : "bg-destructive/10 text-destructive"
                                }`}
                            >
                                {configStatus?.gatewayConnected && configStatus?.hasGatewayKey ? "AI Ready" : "AI Not Ready"}
                            </div>
                        </div>
                    </CardContent>
                </Card>

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

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <Card className="h-fit">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <div className="space-y-1">
                                <CardTitle>Project Details</CardTitle>
                                <CardDescription>Define your story parameters.</CardDescription>
                            </div>
                            <Button variant="ghost" size="sm" onClick={handleNewDraft}>
                                <Plus className="h-4 w-4 mr-2" />
                                New
                            </Button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {!projectId && savedItems.length > 0 && (
                                <div className="space-y-2">
                                    <Label>Load Previous Generation</Label>
                                    <Select onValueChange={handleLoadItem}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select from history..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {savedItems.map((item) => (
                                                <SelectItem key={item.id} value={item.id}>
                                                    {item.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="type">Project Type</Label>
                                <Select
                                    value={type}
                                    onValueChange={(v) => setType(v as ContentType)}
                                    disabled={hasContent || Boolean(projectId)}
                                >
                                    <SelectTrigger id="type">
                                        <SelectValue placeholder="Select type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="FILM">Short Film Script</SelectItem>
                                        <SelectItem value="DOC">Documentary Plan</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="title">Title</Label>
                                <Input
                                    id="title"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="e.g. The Last Barista"
                                    disabled={hasContent || Boolean(projectId)}
                                    readOnly={Boolean(projectId)}
                                    className={projectId ? "bg-muted" : ""}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="prompt">Idea / Synopsis</Label>
                                <Textarea
                                    id="prompt"
                                    className="min-h-[160px]"
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder={
                                        hasContent
                                            ? "Describe what should happen next..."
                                            : "Describe your story idea, characters, and tone..."
                                    }
                                />
                            </div>
                        </CardContent>
                        <div className="p-6 pt-0">
                            <Button onClick={handleGenerate} disabled={loading} className="w-full">
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clapperboard className="mr-2 h-4 w-4" />}
                                {hasContent ? "Generate / Continue" : "Generate Script / Plan"}
                            </Button>
                        </div>
                    </Card>

                    <div className="lg:col-span-2">
                        <Tabs defaultValue="draft" className="w-full">
                            <TabsList className="grid w-full grid-cols-2 mb-4">
                                <TabsTrigger value="draft">Draft</TabsTrigger>
                                <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
                            </TabsList>

                            <TabsContent value="draft" className="mt-0 space-y-4">
                                {hasContent && (
                                    <div className="flex justify-end">
                                        <Button onClick={handleSave} disabled={saving} variant="secondary">
                                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                            {projectId ? "Save Script" : "Create Project"}
                                        </Button>
                                    </div>
                                )}

                                {loading && (
                                    <div className="min-h-[360px] flex items-center justify-center border border-dashed rounded-lg">
                                        <div className="text-center space-y-3">
                                            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
                                            <p className="text-muted-foreground">Generating your content...</p>
                                        </div>
                                    </div>
                                )}

                                {!loading && !filmResult && !docResult && (
                                    <div className="min-h-[360px] flex items-center justify-center border border-dashed rounded-lg bg-muted/40">
                                        <div className="text-center text-muted-foreground">
                                            <Clapperboard className="h-12 w-12 mx-auto mb-4 opacity-60" />
                                            <p>Enter your idea and click generate to begin.</p>
                                        </div>
                                    </div>
                                )}

                                {!loading && filmResult && (
                                    <Card>
                                        <CardHeader>
                                            <CardTitle>Screenplay Draft</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <pre className="whitespace-pre-wrap font-mono text-sm bg-muted p-4 rounded-md overflow-x-auto">
                                                {filmResult}
                                            </pre>
                                        </CardContent>
                                    </Card>
                                )}

                                {!loading && docResult && (
                                    <Tabs defaultValue="script" className="w-full">
                                        <TabsList className="grid w-full grid-cols-3 mb-4">
                                            <TabsTrigger value="script">Script</TabsTrigger>
                                            <TabsTrigger value="outline">Creative Outline</TabsTrigger>
                                            <TabsTrigger value="production">Production Plan</TabsTrigger>
                                        </TabsList>

                                        <TabsContent value="script" className="space-y-4">
                                            <Card>
                                                <CardHeader>
                                                    <CardTitle className="flex items-center gap-2">
                                                        <FileText className="h-5 w-5" />
                                                        Documentary Script
                                                    </CardTitle>
                                                </CardHeader>
                                                <CardContent>
                                                    {Array.isArray(docResult.script) ? (
                                                        <div className="border rounded-md overflow-hidden">
                                                            <table className="w-full text-sm">
                                                                <thead className="bg-muted">
                                                                    <tr>
                                                                        <th className="px-4 py-2 text-left w-1/2 border-r">VIDEO</th>
                                                                        <th className="px-4 py-2 text-left w-1/2">AUDIO</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y">
                                                                    {docResult.script.map((scene, idx) => (
                                                                        <tr key={idx}>
                                                                            <td className="px-4 py-3 align-top border-r whitespace-pre-wrap">
                                                                                {scene.VIDEO || scene.video || ""}
                                                                            </td>
                                                                            <td className="px-4 py-3 align-top whitespace-pre-wrap">
                                                                                {scene.AUDIO || scene.audio || ""}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    ) : (
                                                        <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-md">
                                                            {String(docResult.script || "")}
                                                        </pre>
                                                    )}
                                                </CardContent>
                                            </Card>
                                        </TabsContent>

                                        <TabsContent value="outline" className="space-y-4">
                                            <Card>
                                                <CardHeader>
                                                    <CardTitle className="flex items-center gap-2">
                                                        <Video className="h-5 w-5" />
                                                        Creative Outline
                                                    </CardTitle>
                                                </CardHeader>
                                                <CardContent className="space-y-4">
                                                    <div>
                                                        <h3 className="font-semibold mb-1">Logline</h3>
                                                        <p className="text-sm text-muted-foreground">{docResult.logline}</p>
                                                    </div>
                                                    <div>
                                                        <h3 className="font-semibold mb-1">Thematic Statement</h3>
                                                        <p className="text-sm text-muted-foreground">{docResult.thematicStatement}</p>
                                                    </div>
                                                    <div>
                                                        <h3 className="font-semibold mb-2">Chapters</h3>
                                                        <div className="space-y-3">
                                                            {(docResult.chapters || []).map((chapter, idx) => (
                                                                <div key={idx} className="border rounded-md p-3">
                                                                    <p className="font-medium">
                                                                        {chapter.chapterNumber}. {chapter.title}
                                                                    </p>
                                                                    <p className="text-sm text-muted-foreground mt-1">{chapter.summary}</p>
                                                                    <p className="text-sm mt-2">
                                                                        <span className="font-medium">Visuals:</span> {chapter.visuals}
                                                                    </p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </TabsContent>

                                        <TabsContent value="production" className="space-y-4">
                                            <Card>
                                                <CardHeader>
                                                    <CardTitle className="flex items-center gap-2">
                                                        <User className="h-5 w-5" />
                                                        Production Plan
                                                    </CardTitle>
                                                </CardHeader>
                                                <CardContent className="space-y-4">
                                                    <div>
                                                        <h3 className="font-semibold mb-1">Interview Candidates</h3>
                                                        <div className="space-y-2">
                                                            {(docResult.interviewCandidates || []).map((item, idx) => (
                                                                <div key={idx} className="border rounded-md p-3">
                                                                    <p className="font-medium">{item.role}</p>
                                                                    <p className="text-sm text-muted-foreground">{item.description}</p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <h3 className="font-semibold mb-1">Visual Style</h3>
                                                        <p className="text-sm text-muted-foreground">{docResult.visualStyle}</p>
                                                    </div>
                                                    <div>
                                                        <h3 className="font-semibold mb-1">B-Roll Wishlist</h3>
                                                        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                                                            {(docResult.bRollWishlist || []).map((item, idx) => (
                                                                <li key={idx}>{item}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </TabsContent>
                                    </Tabs>
                                )}
                            </TabsContent>

                            <TabsContent value="suggestions" className="mt-0">
                                {type === "FILM" ? (
                                    <Card>
                                        <CardHeader>
                                            <CardTitle>Short Film Suggestions</CardTitle>
                                        </CardHeader>
                                        <CardContent className="text-sm text-muted-foreground space-y-3">
                                            <p>Define one strong central idea and avoid subplots.</p>
                                            <p>Plan your ending early and build toward it.</p>
                                            <p>Keep scope practical: fewer locations, fewer characters, tighter runtime.</p>
                                            <p>Write visually first; dialogue should support action, not replace it.</p>
                                        </CardContent>
                                    </Card>
                                ) : (
                                    <Card>
                                        <CardHeader>
                                            <CardTitle>Documentary Suggestions</CardTitle>
                                        </CardHeader>
                                        <CardContent className="text-sm text-muted-foreground space-y-3">
                                            <p>Start with the core question and why it matters now.</p>
                                            <p>Define your documentary point of view early.</p>
                                            <p>Do research and pre-interviews before fixing structure.</p>
                                            <p>Build a flexible outline with clear stakes and narrative change.</p>
                                        </CardContent>
                                    </Card>
                                )}
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}

export default function FilmInABoxRoute() {
    return (
        <SessionAuth>
            <FilmInABoxPage />
        </SessionAuth>
    );
}
