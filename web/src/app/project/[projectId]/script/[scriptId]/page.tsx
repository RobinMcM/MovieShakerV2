"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Loader2 } from "lucide-react";
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
    description?: string;
}

function ScriptManagementPage() {
    const params = useParams();
    const projectId = typeof params.projectId === "string" ? params.projectId : params.projectId?.[0];
    const scriptId = typeof params.scriptId === "string" ? params.scriptId : params.scriptId?.[0];

    const [script, setScript] = useState<Script | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!projectId || !scriptId) {
            setLoading(false);
            return;
        }

        async function load() {
            try {
                const res = await api.get<{ scripts: Script[] }>(`/projects/${projectId}/scripts`);
                const found = res.scripts?.find((s) => s.id === scriptId) ?? null;
                setScript(found);
                if (!found) setError("Script not found.");
            } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to load script.");
            } finally {
                setLoading(false);
            }
        }

        load();
    }, [projectId, scriptId]);

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
                <div className="max-w-3xl mx-auto space-y-6">
                    <Link
                        href={`/project/${projectId}`}
                        className="text-primary underline hover:no-underline text-sm inline-block"
                    >
                        Back to Project
                    </Link>
                    <Card>
                        <CardHeader>
                            <div className="flex items-start gap-3">
                                <FileText className="h-6 w-6 text-primary flex-shrink-0 mt-0.5" />
                                <div>
                                    <CardTitle className="text-2xl">{script.name}</CardTitle>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Uploaded {new Date(script.uploaded_at).toLocaleDateString("en-GB")} at{" "}
                                        {new Date(script.uploaded_at).toLocaleTimeString("en-GB")}
                                    </p>
                                    {script.is_current && (
                                        <span className="inline-flex items-center gap-1 rounded-md border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-500 mt-2">
                                            Current script
                                        </span>
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <p className="text-muted-foreground text-sm">
                                Script management and parsing can be added here (e.g. Parse, View PDF, scenes/characters, set current).
                            </p>
                        </CardContent>
                    </Card>
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
