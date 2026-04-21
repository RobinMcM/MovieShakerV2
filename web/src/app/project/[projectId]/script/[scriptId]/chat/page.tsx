"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, MessageSquare, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { api } from "@/lib/api";
import { ScriptAnalysisPanel, type ScriptAnalysis } from "@/components/scripts/ScriptAnalysisPanel";
import { ScriptChat, type ScriptChatHandle } from "@/components/scripts/ScriptChat";
import { ProductionDecisions } from "@/components/scripts/ProductionDecisions";

interface Script {
    id: string;
    project_id: string;
    name: string;
    page_count?: number | null;
    is_locked?: boolean;
}

interface SceneIndexEntry {
    scene_number: number;
    heading: string;
    page_number: number;
    location_type?: string | null;
    scene_location?: string | null;
    is_night_shoot?: boolean | null;
    characters?: string[];
}

interface SceneIndexResponse {
    script_id: string;
    scene_count: number;
    scenes: SceneIndexEntry[];
}

function ScriptChatPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const projectId = typeof params.projectId === "string" ? params.projectId : params.projectId?.[0];
    const scriptId = typeof params.scriptId === "string" ? params.scriptId : params.scriptId?.[0];
    const urlChatId = searchParams.get("chat_id") ?? undefined;

    const [script, setScript] = useState<Script | null>(null);
    const [sceneIndex, setSceneIndex] = useState<SceneIndexEntry[]>([]);
    const [analysis, setAnalysis] = useState<ScriptAnalysis | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [leftPanelOpen, setLeftPanelOpen] = useState(true);
    const [isReanalysing, setIsReanalysing] = useState(false);
    const [decisionsRefresh, setDecisionsRefresh] = useState(0);
    const chatRef = useRef<ScriptChatHandle>(null);

    const fetchAnalysis = useCallback(async () => {
        if (!scriptId) return;
        try {
            const res = await api.get<{ success: boolean; data: ScriptAnalysis }>(
                `/scripts/${scriptId}/analysis`
            );
            setAnalysis((res as { data?: ScriptAnalysis }).data ?? null);
        } catch {
            setAnalysis(null);
        }
    }, [scriptId]);

    const loadData = useCallback(async () => {
        if (!scriptId) return;

        const scriptRes = await api.get<{ success: boolean; data: Script }>(`/scripts/${scriptId}`);
        const scriptData = (scriptRes as { data?: Script }).data;
        if (!scriptData) throw new Error("Script not found");
        setScript(scriptData);

        const indexRes = await api.get<{ success: boolean; data: SceneIndexResponse }>(
            `/scripts/${scriptId}/scenes/index`
        );
        const indexData = (indexRes as { data?: SceneIndexResponse }).data;
        setSceneIndex(indexData?.scenes ?? []);

        // Analysis may not exist yet — treat 404 as empty
        await fetchAnalysis();
    }, [scriptId, fetchAnalysis]);

    useEffect(() => {
        if (!scriptId) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                await loadData();
                if (cancelled) return;
                setError(null);
            } catch (e) {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : "Failed to load script.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [scriptId, loadData]);

    const handleReanalyse = useCallback(async () => {
        if (!scriptId || isReanalysing) return;
        setIsReanalysing(true);
        try {
            await api.post(`/scripts/${scriptId}/analyse`, {});
            await fetchAnalysis();
        } catch {
            // analysis fetch will clear state on error; don't surface here
        } finally {
            setIsReanalysing(false);
        }
    }, [scriptId, isReanalysing, fetchAnalysis]);

    if (!projectId || !scriptId) {
        return (
            <div className="min-h-screen flex flex-col bg-background">
                <AppHeader />
                <main className="flex-1 container mx-auto px-4 py-8">
                    <p className="text-muted-foreground">Invalid project or script.</p>
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
                </main>
                <Footer />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col bg-background">
            <AppHeader />
            <main className="flex-1 container mx-auto px-4 py-6">
                {/* Header row */}
                <div className="flex items-center gap-3 mb-6">
                    <Link href={`/project/${projectId}/script/${scriptId}`}>
                        <Button variant="ghost" size="sm">
                            <ArrowLeft className="h-4 w-4 mr-1" />
                            Back
                        </Button>
                    </Link>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <MessageSquare className="h-5 w-5 text-primary shrink-0" />
                        <h1 className="text-lg font-semibold truncate">{script.name}</h1>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="md:hidden"
                        onClick={() => setLeftPanelOpen((v) => !v)}
                        title={leftPanelOpen ? "Hide script info" : "Show script info"}
                    >
                        {leftPanelOpen ? (
                            <PanelLeftClose className="h-4 w-4" />
                        ) : (
                            <PanelLeftOpen className="h-4 w-4" />
                        )}
                    </Button>
                </div>

                {/* Two-panel layout */}
                <div className="flex gap-4 min-h-[600px]">
                    {/* Left panel — 35% */}
                    <div
                        className={`flex-none w-full md:w-[35%] space-y-4 overflow-y-auto ${leftPanelOpen ? "block" : "hidden md:block"}`}
                    >
                        {/* Script metadata */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                                    Script
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <p className="font-medium">{script.name}</p>
                                {script.page_count != null && (
                                    <p className="text-muted-foreground">{script.page_count} pages</p>
                                )}
                                {sceneIndex.length > 0 && (
                                    <p className="text-muted-foreground">{sceneIndex.length} scenes</p>
                                )}
                            </CardContent>
                        </Card>

                        {/* Analysis panel — Task 17 */}
                        <ScriptAnalysisPanel
                            scriptId={scriptId}
                            analysis={analysis}
                            onReanalyse={handleReanalyse}
                            isReanalysing={isReanalysing}
                        />

                        {/* Task 19: Production decisions */}
                        <ProductionDecisions
                            scriptId={scriptId}
                            refreshTrigger={decisionsRefresh}
                            onReconsider={(summary) =>
                                chatRef.current?.sendMessage(
                                    `I want to reconsider the decision: ${summary}`
                                )
                            }
                        />
                    </div>

                    {/* Right panel — 65% */}
                    <div className="flex-1 min-w-0">
                        {/* Task 18: ScriptChat component */}
                        <Card className="h-full flex flex-col overflow-hidden">
                            <ScriptChat
                                ref={chatRef}
                                scriptId={scriptId}
                                initialChatId={urlChatId}
                                onAfterResponse={() => setDecisionsRefresh((v) => v + 1)}
                            />
                        </Card>
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
}

export default function ScriptChatRoute() {
    return (
        <SessionAuth>
            <ScriptChatPage />
        </SessionAuth>
    );
}
