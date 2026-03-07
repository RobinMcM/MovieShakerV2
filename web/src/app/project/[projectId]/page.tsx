"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSessionContext } from "supertokens-auth-react/recipe/session";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Loader2,
    Upload,
    FileText,
    Trash2,
    CheckCircle2,
    Calculator,
    Calendar,
    List,
    Users,
    UsersRound,
    Palette,
    Settings,
    Eye,
    Box,
    BarChart3,
    Clapperboard,
    Ticket,
    CreditCard,
} from "lucide-react";
import { api, API_URL } from "@/lib/api";

interface ProjectData {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    start_date?: string | null;
    end_date?: string | null;
    series?: string | null;
    episode?: string | null;
    director?: string | null;
    role: string;
}

interface Script {
    id: string;
    project_id: string;
    name: string;
    file_url: string;
    uploaded_at: string;
    is_current: boolean;
    series: string | null;
    episode: string | null;
    description?: string;
}

interface ScriptCounts {
    scenes: number;
    characters: number;
}

function getStatusColor(status: string) {
    switch (status) {
        case "planning":
            return "bg-blue-500/10 text-blue-500";
        case "in-progress":
        case "pre-production":
        case "production":
        case "post-production":
        case "distribution":
            return "bg-yellow-500/10 text-yellow-500";
        case "completed":
            return "bg-green-500/10 text-green-500";
        default:
            return "bg-gray-500/10 text-gray-500";
    }
}

function ProjectPage() {
    const params = useParams();
    const projectId = typeof params.projectId === "string" ? params.projectId : params.projectId?.[0];
    const session = useSessionContext();
    const [loading, setLoading] = useState(true);
    const [project, setProject] = useState<ProjectData | null>(null);
    const [scripts, setScripts] = useState<Script[]>([]);
    const [scriptCounts, setScriptCounts] = useState<Record<string, ScriptCounts>>({});
    const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [scriptName, setScriptName] = useState("");
    const [scriptDescription, setScriptDescription] = useState("");
    const [scriptFile, setScriptFile] = useState<File | null>(null);
    const [scriptSeries, setScriptSeries] = useState("");
    const [scriptEpisode, setScriptEpisode] = useState("");
    const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const [scriptsMessage, setScriptsMessage] = useState<string | null>(null);
    const isOnlyParticipant = false;
    const isProductionCompany = true;

    const hasSession = !session.loading && "doesSessionExist" in session && (session as { doesSessionExist: boolean }).doesSessionExist;

    useEffect(() => {
        if (projectId && hasSession) {
            loadProject();
        }
    }, [projectId, hasSession]);

    useEffect(() => {
        if (projectId && project) {
            loadScripts();
            setScriptSeries(project.series || "");
            setScriptEpisode(project.episode || "");
        } else {
            setScripts([]);
        }
    }, [projectId, project]);

    async function loadProject() {
        if (!projectId) return;
        try {
            setLoading(true);
            const list = await api.get<ProjectData[]>("/projects/");
            const arr = Array.isArray(list) ? list : [];
            const found = arr.find((p) => p.id === projectId);
            setProject(found || null);
        } catch (err) {
            console.error(err);
            setMessage({ text: "Failed to load project.", type: "error" });
        } finally {
            setLoading(false);
        }
    }

    async function loadScripts() {
        if (!projectId) return;
        try {
            setScriptsMessage(null);
            const scriptsRes = await api.get<{ scripts: Script[] }>(`/projects/${projectId}/scripts`);
            const list = scriptsRes?.scripts ?? [];
            setScripts(list);
            if (list.length > 0) {
                const current = list.find((s) => s.is_current);
                if (current) loadScriptCounts(current.id);
            }
        } catch {
            setScripts([]);
            setScriptsMessage("Scripts API is not available yet.");
        }
    }

    async function loadScriptCounts(scriptId: string) {
        try {
            const statsRes = await api.get<{ stats: { scenes: number; characters: number } }>(
                `/scripts/${scriptId}/stats`
            );
            if (statsRes?.stats) {
                setScriptCounts((prev) => ({
                    ...prev,
                    [scriptId]: {
                        scenes: statsRes.stats.scenes,
                        characters: statsRes.stats.characters,
                    },
                }));
            }
        } catch {
            // ignore
        }
    }

    async function handleUploadScript() {
        if (!scriptName.trim() || !scriptFile || !projectId) {
            setMessage({ text: "Please provide a script name and file.", type: "error" });
            return;
        }
        const maxSize = 50 * 1024 * 1024;
        if (scriptFile.size > maxSize) {
            setMessage({ text: "File size must be less than 50MB.", type: "error" });
            return;
        }
        if (scriptFile.type !== "application/pdf") {
            setMessage({ text: "Only PDF files are allowed.", type: "error" });
            return;
        }
        try {
            setUploading(true);
            const formData = new FormData();
            formData.append("file", scriptFile);
            formData.append("name", scriptName.trim());
            if (scriptDescription.trim()) formData.append("description", scriptDescription.trim());
            if (scriptSeries.trim()) formData.append("series", scriptSeries.trim());
            if (scriptEpisode.trim()) formData.append("episode", scriptEpisode.trim());
            await api.postForm(
                `/projects/${projectId}/scripts`,
                formData
            );
            setMessage({ text: "Script uploaded successfully.", type: "success" });
            setScriptName("");
            setScriptDescription("");
            setScriptFile(null);
            setScriptSeries(project?.series || "");
            setScriptEpisode(project?.episode || "");
            setIsUploadDialogOpen(false);
            loadScripts();
        } catch (err) {
            setMessage({
                text: err instanceof Error ? err.message : "Scripts API is not available yet.",
                type: "error",
            });
        } finally {
            setUploading(false);
        }
    }

    async function handleDeleteScript(scriptId: string, scriptName: string, _filePath: string) {
        const confirmed = window.confirm(
            `Delete script "${scriptName}"? This cannot be undone.`
        );
        if (!confirmed) return;
        try {
            await api.delete(`/scripts/${scriptId}`);
            setMessage({ text: "Script deleted successfully.", type: "success" });
            loadScripts();
        } catch (err) {
            setMessage({
                text: err instanceof Error ? err.message : "Failed to delete script.",
                type: "error",
            });
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex flex-col bg-background">
                <AppHeader />
                <main className="flex-1 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </main>
                <Footer />
            </div>
        );
    }

    if (!projectId || !project) {
        return (
            <div className="min-h-screen flex flex-col bg-background">
                <AppHeader />
                <main className="flex-1 container mx-auto px-4 py-8">
                    <p className="text-muted-foreground">Project not found.</p>
                    <Link href="/projects" className="text-primary underline mt-4 inline-block">
                        Back to Projects
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
                <div className="max-w-3xl mx-auto space-y-8">
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

                    <Card>
                        <CardHeader>
                            <div className="flex items-start justify-between">
                                <div className="w-full">
                                    {(project.series || project.episode) && (
                                        <div className="flex gap-4 mb-4 pb-3 border-b border-border/40">
                                            {project.series && (
                                                <div>
                                                    <h3 className="font-semibold mb-1 text-muted-foreground text-sm">Series</h3>
                                                    <p className="text-foreground">{project.series}</p>
                                                </div>
                                            )}
                                            {project.episode && (
                                                <div>
                                                    <h3 className="font-semibold mb-1 text-muted-foreground text-sm">Episode</h3>
                                                    <p className="text-foreground">{project.episode}</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <CardTitle className="text-3xl mb-2">{project.name}</CardTitle>
                                    <span
                                        className={`inline-block text-xs px-3 py-1 rounded-full font-medium ${getStatusColor(
                                            project.status
                                        )}`}
                                    >
                                        {project.status}
                                    </span>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {project.description && (
                                <div>
                                    <h3 className="font-semibold mb-2 text-muted-foreground">Description</h3>
                                    <p className="text-foreground">{project.description}</p>
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                                {project.start_date && (
                                    <div>
                                        <h3 className="font-semibold mb-1 text-muted-foreground text-sm">Start Date</h3>
                                        <p className="text-foreground">
                                            {new Date(project.start_date).toLocaleDateString("en-GB")}
                                        </p>
                                    </div>
                                )}
                                {project.end_date && (
                                    <div>
                                        <h3 className="font-semibold mb-1 text-muted-foreground text-sm">End Date</h3>
                                        <p className="text-foreground">
                                            {new Date(project.end_date).toLocaleDateString("en-GB")}
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="pt-4 border-t">
                                <h3 className="font-semibold mb-4 text-muted-foreground text-sm text-center">
                                    Quick Actions
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    <Link href={`/film-in-a-box?project=${projectId}`}>
                                        <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 cursor-pointer bg-primary/5 border-primary/20">
                                            <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                <Clapperboard className="h-12 w-12 text-primary" />
                                                <span className="font-semibold text-base">Film in a Box</span>
                                                <p className="text-xs text-muted-foreground text-center">AI-Powered Production Planning</p>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                    <Link href={`/the-film-festival?project=${projectId}`}>
                                        <Card className="h-full transition-all hover:shadow-lg hover:border-purple-500/50 cursor-pointer bg-gradient-to-br from-purple-500/5 to-pink-500/5 border-purple-500/20">
                                            <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                <Ticket className="h-12 w-12 text-purple-500" />
                                                <span className="font-semibold text-base">The Film Festival</span>
                                                <p className="text-xs text-muted-foreground text-center">Strategy, Funding & Festival Planning</p>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                    <Link href={`/submit-funding?project=${projectId}`}>
                                        <Card className="h-full transition-all hover:shadow-lg hover:border-green-500/50 cursor-pointer bg-gradient-to-br from-green-500/5 to-emerald-500/5 border-green-500/20">
                                            <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                <CreditCard className="h-12 w-12 text-green-500" />
                                                <span className="font-semibold text-base">Submit for Funding</span>
                                                <p className="text-xs text-muted-foreground text-center">Get funding for your project</p>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                    <Link href={`/project/${projectId}/budgeting`}>
                                        <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 cursor-pointer">
                                            <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                <Calculator className="h-12 w-12 text-primary" />
                                                <span className="font-semibold text-base">Budgeting</span>
                                                <p className="text-xs text-muted-foreground text-center">Manage project budget and expenses</p>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                    <Link href={`/project/${projectId}/scheduling`}>
                                        <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 cursor-pointer">
                                            <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                <Calendar className="h-12 w-12 text-primary" />
                                                <span className="font-semibold text-base">Scheduling</span>
                                                <p className="text-xs text-muted-foreground text-center">View and manage production schedule</p>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                    <Link href={`/project/${projectId}/castmanagement`}>
                                        <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 cursor-pointer">
                                            <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                <Users className="h-12 w-12 text-primary" />
                                                <span className="font-semibold text-base">Cast Management</span>
                                                <p className="text-xs text-muted-foreground text-center">Manage casting and actor auditions</p>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                    <Link href={`/project/${projectId}/crewmanagement`}>
                                        <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 cursor-pointer">
                                            <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                <UsersRound className="h-12 w-12 text-primary" />
                                                <span className="font-semibold text-base">Crew Management</span>
                                                <p className="text-xs text-muted-foreground text-center">Organize team and assign roles</p>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                    <Link href={`/scene-costs?project=${projectId}`}>
                                        <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 cursor-pointer">
                                            <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                <BarChart3 className="h-12 w-12 text-primary" />
                                                <span className="font-semibold text-base">Scene Costs</span>
                                                <p className="text-xs text-muted-foreground text-center">Visualize budget by scene</p>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                    <Link href={`/objects?project=${projectId}`}>
                                        <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 cursor-pointer">
                                            <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                <Box className="h-12 w-12 text-primary" />
                                                <span className="font-semibold text-base">Objects</span>
                                                <p className="text-xs text-muted-foreground text-center">Manage film props and objects</p>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                    <Link href={`/shotlist?project=${projectId}`}>
                                        <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 cursor-pointer">
                                            <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                <List className="h-12 w-12 text-primary" />
                                                <span className="font-semibold text-base">Shot List</span>
                                                <p className="text-xs text-muted-foreground text-center">Create and organize shot lists</p>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                    <Link href={`/moodboard?project=${projectId}`}>
                                        <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 cursor-pointer">
                                            <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                <Palette className="h-12 w-12 text-primary" />
                                                <span className="font-semibold text-base">Mood Board</span>
                                                <p className="text-xs text-muted-foreground text-center">Collect visual references and inspiration</p>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                    <Link href={`/visualize?project=${projectId}`}>
                                        <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 cursor-pointer">
                                            <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                <Eye className="h-12 w-12 text-primary" />
                                                <span className="font-semibold text-base">Visualize</span>
                                                <p className="text-xs text-muted-foreground text-center">Preview and visualize your project</p>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                    {isProductionCompany && (
                                        <Link href={`/projectadministration?project=${projectId}`}>
                                            <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 cursor-pointer">
                                                <CardContent className="flex flex-col items-center justify-center p-6 space-y-3">
                                                    <Settings className="h-12 w-12 text-primary" />
                                                    <span className="font-semibold text-base">Administration</span>
                                                    <p className="text-xs text-muted-foreground text-center">Manage team access and invitations</p>
                                                </CardContent>
                                            </Card>
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle>Scripts</CardTitle>
                                {!isOnlyParticipant && (
                                    <Dialog
                                        open={isUploadDialogOpen}
                                        onOpenChange={(open) => {
                                            setIsUploadDialogOpen(open);
                                            if (open) {
                                                setScriptSeries(project?.series || "");
                                                setScriptEpisode(project?.episode || "");
                                            }
                                        }}
                                    >
                                        <DialogTrigger asChild>
                                            <Button size="sm">
                                                <Upload className="h-4 w-4 mr-2" />
                                                Upload Script
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent>
                                            <DialogHeader>
                                                <DialogTitle>Upload Script</DialogTitle>
                                                <DialogDescription>Upload a script file for this project</DialogDescription>
                                            </DialogHeader>
                                            <div className="space-y-4 py-4">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="space-y-2">
                                                        <Label htmlFor="scriptSeries">Series</Label>
                                                        <Input id="scriptSeries" value={scriptSeries} readOnly className="bg-muted" placeholder="No series set" />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label htmlFor="scriptEpisode">Episode</Label>
                                                        <Input id="scriptEpisode" value={scriptEpisode} readOnly className="bg-muted" placeholder="No episode set" />
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="scriptName">Script Name *</Label>
                                                    <Input id="scriptName" value={scriptName} onChange={(e) => setScriptName(e.target.value)} placeholder="e.g., Final Draft" />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="scriptDescription">Description</Label>
                                                    <textarea
                                                        id="scriptDescription"
                                                        value={scriptDescription}
                                                        onChange={(e) => setScriptDescription(e.target.value)}
                                                        placeholder="Brief description of the script"
                                                        rows={3}
                                                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="scriptFile">Script File *</Label>
                                                    <Input
                                                        id="scriptFile"
                                                        type="file"
                                                        accept=".pdf"
                                                        onChange={(e) => setScriptFile(e.target.files?.[0] || null)}
                                                    />
                                                    <p className="text-sm text-muted-foreground">Only PDF files are accepted</p>
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button onClick={handleUploadScript} disabled={uploading} className="flex-1">
                                                    {uploading ? (
                                                        <>
                                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                            Uploading...
                                                        </>
                                                    ) : (
                                                        "Upload"
                                                    )}
                                                </Button>
                                                <Button variant="outline" onClick={() => setIsUploadDialogOpen(false)} disabled={uploading}>
                                                    Cancel
                                                </Button>
                                            </div>
                                        </DialogContent>
                                    </Dialog>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {scriptsMessage && (
                                <p className="text-center text-muted-foreground py-4">{scriptsMessage}</p>
                            )}
                            {scripts.length === 0 && !scriptsMessage && (
                                <p className="text-center text-muted-foreground py-8">No scripts uploaded yet</p>
                            )}
                            {scripts.length > 0 && (
                                <div className="space-y-3">
                                    {scripts.map((script) => (
                                        <div key={script.id} className="border rounded-lg hover:bg-accent/50 transition-colors">
                                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3">
                                                <Link
                                                    href={projectId ? `/project/${projectId}/script/${script.id}` : "#"}
                                                    className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer"
                                                    aria-label={`Open script ${script.name}`}
                                                >
                                                    <FileText className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <p className="font-medium break-words hover:text-primary transition-colors">{script.name}</p>
                                                            {script.is_current && (
                                                                <span className="inline-flex items-center gap-1 rounded-md border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-500 flex-shrink-0">
                                                                    <CheckCircle2 className="h-3 w-3" />
                                                                    Current
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-sm text-muted-foreground">
                                                            {new Date(script.uploaded_at).toLocaleDateString("en-GB")} at{" "}
                                                            {new Date(script.uploaded_at).toLocaleTimeString("en-GB")}
                                                        </p>
                                                        {script.is_current && scriptCounts[script.id] && (
                                                            <div className="flex gap-4 mt-1 text-sm flex-wrap">
                                                                <span className="text-muted-foreground">
                                                                    Scenes: <span className="font-semibold text-foreground">{scriptCounts[script.id].scenes}</span>
                                                                </span>
                                                                <span className="text-muted-foreground">
                                                                    Characters: <span className="font-semibold text-foreground">{scriptCounts[script.id].characters}</span>
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </Link>
                                                <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-shrink-0 sm:ml-2">
                                                    <Button
                                                        variant="link"
                                                        className="p-0 h-auto text-primary font-medium text-sm"
                                                        onClick={async () => {
                                                            try {
                                                                const r = await fetch(`${API_URL}/scripts/${script.id}/file`, { credentials: "include" });
                                                                if (!r.ok) throw new Error("Failed to load PDF");
                                                                const blob = await r.blob();
                                                                const url = URL.createObjectURL(blob);
                                                                window.open(url);
                                                            } catch {
                                                                setMessage({ text: "Failed to open PDF.", type: "error" });
                                                            }
                                                        }}
                                                    >
                                                        View PDF
                                                    </Button>
                                                    <Button
                                                        variant="link"
                                                        className="p-0 h-auto text-muted-foreground text-xs"
                                                        onClick={async () => {
                                                            try {
                                                                const r = await fetch(`${API_URL}/scripts/${script.id}/file?variant=json`, { credentials: "include" });
                                                                if (!r.ok) throw new Error("JSON not found");
                                                                const blob = await r.blob();
                                                                const url = URL.createObjectURL(blob);
                                                                window.open(url);
                                                            } catch {
                                                                setMessage({ text: "Script JSON not available.", type: "error" });
                                                            }
                                                        }}
                                                    >
                                                        View Script
                                                    </Button>
                                                    {!isOnlyParticipant && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleDeleteScript(script.id, script.name, script.file_url)}
                                                            disabled={script.is_current}
                                                            className="text-destructive hover:text-destructive"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
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
        </div>
    );
}

export default function Project() {
    return (
        <SessionAuth>
            <ProjectPage />
        </SessionAuth>
    );
}
