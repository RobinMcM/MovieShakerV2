"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { ProjectMobileNav } from "@/components/project/ProjectMobileNav";
import { ProjectSidebarNav } from "@/components/project/ProjectSidebarNav";
import { CoproducerSidebar } from "@/components/layout/CoproducerSidebar";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useProjectScriptsNav } from "./useProjectScriptsNav";

const SIDEBAR_STORAGE_KEY = "movieshaker:project-nav-visible";
const COPRODUCER_OPEN_KEY = "coproducer_sidebar_open";
const COPRODUCER_ACTIVE_KEY = "coproducer_active";

interface ProfileData {
    ai_credits?: number;
    model_fiab_text?: string;
}

export default function ProjectLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const params = useParams();
    const pathname = usePathname();
    const projectId = useMemo(
        () =>
            typeof params.projectId === "string"
                ? params.projectId
                : params.projectId?.[0] || null,
        [params.projectId]
    );

    const { scripts, loading } = useProjectScriptsNav(projectId);
    const [desktopNavVisible, setDesktopNavVisible] = useState(true);
    const [coproducerActive, setCoproducerActive] = useState(false);
    const [coproducerOpen, setCoproducerOpen] = useState(false);
    const [aiCredits, setAiCredits] = useState<number | null>(null);
    const [userModel, setUserModel] = useState("anthropic/claude-3.7-sonnet");

    // Left sidebar persistence
    useEffect(() => {
        const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
        if (stored === "false") setDesktopNavVisible(false);
    }, []);

    useEffect(() => {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, desktopNavVisible ? "true" : "false");
    }, [desktopNavVisible]);

    // CoProducer active persistence
    useEffect(() => {
        const stored = window.localStorage.getItem(COPRODUCER_ACTIVE_KEY);
        if (stored === "true") setCoproducerActive(true);
    }, []);

    useEffect(() => {
        window.localStorage.setItem(COPRODUCER_ACTIVE_KEY, coproducerActive ? "true" : "false");
    }, [coproducerActive]);

    // CoProducer open persistence
    useEffect(() => {
        const stored = window.localStorage.getItem(COPRODUCER_OPEN_KEY);
        if (stored === "true") setCoproducerOpen(true);
    }, []);

    useEffect(() => {
        window.localStorage.setItem(COPRODUCER_OPEN_KEY, coproducerOpen ? "true" : "false");
    }, [coproducerOpen]);

    useEffect(() => {
        const handler = () => { setCoproducerOpen(true); };
        window.addEventListener("openCoproducer", handler);
        return () => window.removeEventListener("openCoproducer", handler);
    }, []);

    function handleCoproducerActivate() {
        if (coproducerActive) {
            setCoproducerActive(false);
            setCoproducerOpen(false);
        } else {
            setCoproducerActive(true);
        }
    }

    // Profile fetch — source of truth for credits and user model
    useEffect(() => {
        api.get<ProfileData>("/profile/")
            .then((p) => {
                setAiCredits(p.ai_credits ?? 0);
                if (p.model_fiab_text) setUserModel(p.model_fiab_text);
            })
            .catch(() => setAiCredits(0));
    }, []);

    // Context detection for CoProducer sidebar
    const contextMode = pathname?.includes("/script/")
        ? "scripts"
        : pathname?.includes("/scheduling")
        ? "scheduling"
        : pathname?.includes("/shotlist")
        ? "shotlist"
        : pathname?.includes("/moodboard")
        ? "moodboard"
        : pathname?.includes("/objects")
        ? "objects"
        : pathname?.includes("/budget")
        ? "budgets"
        : "general";

    const activeAgent = pathname?.includes("/script/")
        ? "CoWriter"
        : pathname?.includes("/scheduling")
        ? "CoProducer"
        : pathname?.includes("/shotlist")
        ? "CoDirector"
        : pathname?.includes("/moodboard")
        ? "CoDirector"
        : pathname?.includes("/visualize")
        ? "CoDirector"
        : pathname?.includes("/objects")
        ? "CoDesigner"
        : pathname?.includes("/film-in-a-box")
        ? "CoWriter"
        : pathname?.includes("/budgeting")
        ? "CoProducer"
        : "CoProducer";

    const [schedulingScriptId, setSchedulingScriptId] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (contextMode !== "scheduling" || !projectId) return;
        api.get<{ scripts: { id: string; is_current: boolean }[] }>(`/projects/${projectId}/scripts`)
            .then((res) => {
                const current = res.scripts?.find((s) => s.is_current);
                if (current) setSchedulingScriptId(current.id);
            })
            .catch(() => {});
    }, [contextMode, projectId]);

    const contextId = pathname?.includes("/script/")
        ? pathname.split("/script/")[1]?.split("/")[0]
        : contextMode === "scheduling"
        ? schedulingScriptId
        : contextMode === "moodboard"
        ? (projectId ?? undefined)
        : undefined;

    if (!projectId) {
        return <>{children}</>;
    }

    return (
        <>
            <ProjectSidebarNav
                projectId={projectId}
                scripts={scripts}
                scriptsLoading={loading}
                aiCredits={aiCredits}
                coproducerActive={coproducerActive}
                onCoproducerActivate={handleCoproducerActivate}
                isVisible={desktopNavVisible}
                onToggle={() => setDesktopNavVisible((prev: boolean) => !prev)}
                activeAgent={activeAgent}
            />
            <ProjectMobileNav projectId={projectId} scripts={scripts} scriptsLoading={loading} />
            <div className={cn(desktopNavVisible && "md:pl-64")}>{children}</div>
            <CoproducerSidebar
                isOpen={coproducerOpen}
                onClose={() => setCoproducerOpen((v: boolean) => !v)}
                contextMode={contextMode}
                contextId={contextId}
                userModel={userModel}
                coproducerActive={coproducerActive}
                activeAgent={activeAgent}
            />
        </>
    );
}
