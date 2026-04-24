"use client";

import { useEffect, useState } from "react";
import { ProjectSidebarNav } from "@/components/project/ProjectSidebarNav";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const SIDEBAR_STORAGE_KEY = "movieshaker:project-nav-visible";

interface ProfileData {
    ai_credits?: number;
}

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
    const [desktopNavVisible, setDesktopNavVisible] = useState(true);
    const [aiCredits, setAiCredits] = useState<number | null>(null);

    useEffect(() => {
        const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
        if (stored === "false") setDesktopNavVisible(false);
    }, []);

    useEffect(() => {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, desktopNavVisible ? "true" : "false");
    }, [desktopNavVisible]);

    useEffect(() => {
        api.get<ProfileData>("/profile/")
            .then((p) => setAiCredits(p.ai_credits ?? 0))
            .catch(() => setAiCredits(0));
    }, []);

    return (
        <>
            <ProjectSidebarNav
                scripts={[]}
                scriptsLoading={false}
                aiCredits={aiCredits}
                coproducerActive={false}
                onCoproducerActivate={() => {}}
                isVisible={desktopNavVisible}
                onToggle={() => setDesktopNavVisible((prev) => !prev)}
            />
            <div className={cn(desktopNavVisible && "md:pl-64")}>{children}</div>
        </>
    );
}
