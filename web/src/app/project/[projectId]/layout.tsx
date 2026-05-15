"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { ProjectMobileNav } from "@/components/project/ProjectMobileNav";
import { ProjectSidebarNav } from "@/components/project/ProjectSidebarNav";
import { CoproducerSidebar } from "@/components/layout/CoproducerSidebar";
import { cn } from "@/lib/utils";
import { useProjectScriptsNav } from "./useProjectScriptsNav";

const SIDEBAR_STORAGE_KEY = "movieshaker:project-nav-visible";
const COPRODUCER_OPEN_KEY = "coproducer_sidebar_open";

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

    // Left sidebar persistence
    useEffect(() => {
        const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
        if (stored === "false") setDesktopNavVisible(false);
    }, []);

    useEffect(() => {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, desktopNavVisible ? "true" : "false");
    }, [desktopNavVisible]);

    // Right sidebar persistence
    useEffect(() => {
        const stored = window.localStorage.getItem(COPRODUCER_OPEN_KEY);
        if (stored === "true") setCoproducerOpen(true);
    }, []);

    useEffect(() => {
        window.localStorage.setItem(COPRODUCER_OPEN_KEY, coproducerOpen ? "true" : "false");
    }, [coproducerOpen]);

    // Other pages can dispatch this event to expand the right sidebar
    useEffect(() => {
        const handler = () => setCoproducerOpen(true);
        window.addEventListener("openCoproducer", handler);
        return () => window.removeEventListener("openCoproducer", handler);
    }, []);

    // Context detection for the chat panel
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

    // scriptId for script pages; projectId for everything else
    const contextId = pathname?.includes("/script/")
        ? pathname.split("/script/")[1]?.split("/")[0]
        : projectId ?? undefined;

    if (!projectId) {
        return <>{children}</>;
    }

    return (
        <>
            <ProjectSidebarNav
                projectId={projectId}
                scripts={scripts}
                scriptsLoading={loading}
                isVisible={desktopNavVisible}
                onToggle={() => setDesktopNavVisible((prev: boolean) => !prev)}
            />
            <ProjectMobileNav projectId={projectId} scripts={scripts} scriptsLoading={loading} />
            <div className={cn(
                desktopNavVisible && "md:pl-64",
                coproducerOpen ? "md:pr-[420px]" : "md:pr-12",
            )}>{children}</div>
            <CoproducerSidebar
                isOpen={coproducerOpen}
                onClose={() => setCoproducerOpen((v) => !v)}
                contextMode={contextMode}
                contextId={contextId}
            />
        </>
    );
}
