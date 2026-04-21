"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ProjectMobileNav } from "@/components/project/ProjectMobileNav";
import { ProjectSidebarNav } from "@/components/project/ProjectSidebarNav";
import { CoproducerSidebar } from "@/components/layout/CoproducerSidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useProjectScriptsNav } from "./useProjectScriptsNav";

const SIDEBAR_STORAGE_KEY = "movieshaker:project-nav-visible";
const COPRODUCER_STORAGE_KEY = "coproducer_sidebar_open";

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

    // CoProducer sidebar persistence
    useEffect(() => {
        const stored = window.localStorage.getItem(COPRODUCER_STORAGE_KEY);
        if (stored === "true") setCoproducerOpen(true);
    }, []);

    useEffect(() => {
        window.localStorage.setItem(
            COPRODUCER_STORAGE_KEY,
            coproducerOpen ? "true" : "false"
        );
    }, [coproducerOpen]);

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
        : pathname?.includes("/budget")
        ? "budgets"
        : pathname?.includes("/schedule")
        ? "schedule"
        : "general";

    const contextId = pathname?.includes("/script/")
        ? pathname.split("/script/")[1]?.split("/")[0]
        : undefined;

    if (!projectId) {
        return <>{children}</>;
    }

    return (
        <>
            {desktopNavVisible && (
                <ProjectSidebarNav
                    projectId={projectId}
                    scripts={scripts}
                    scriptsLoading={loading}
                    aiCredits={aiCredits}
                    coproducerOpen={coproducerOpen}
                    onCoproducerToggle={() => setCoproducerOpen((v: boolean) => !v)}
                />
            )}
            <ProjectMobileNav projectId={projectId} scripts={scripts} scriptsLoading={loading} />
            <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn(
                    "hidden md:inline-flex fixed top-4 z-[61] rounded-full shadow-lg",
                    desktopNavVisible ? "left-[15.5rem]" : "left-4"
                )}
                onClick={() => setDesktopNavVisible((prev: boolean) => !prev)}
                aria-label={desktopNavVisible ? "Hide project sidebar" : "Show project sidebar"}
                title={desktopNavVisible ? "Hide sidebar" : "Show sidebar"}
            >
                {desktopNavVisible ? (
                    <PanelLeftClose className="h-5 w-5" />
                ) : (
                    <PanelLeftOpen className="h-5 w-5" />
                )}
            </Button>
            <div className={cn(desktopNavVisible && "md:pl-64")}>{children}</div>
            <CoproducerSidebar
                isOpen={coproducerOpen}
                onClose={() => setCoproducerOpen(false)}
                contextMode={contextMode}
                contextId={contextId}
                userModel={userModel}
            />
        </>
    );
}
