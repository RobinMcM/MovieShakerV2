"use client";

import { useEffect, useState } from "react";
import { ProjectSidebarNav } from "@/components/project/ProjectSidebarNav";
import { cn } from "@/lib/utils";

const SIDEBAR_STORAGE_KEY = "movieshaker:project-nav-visible";

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
    const [desktopNavVisible, setDesktopNavVisible] = useState(true);

    useEffect(() => {
        const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
        if (stored === "false") setDesktopNavVisible(false);
    }, []);

    useEffect(() => {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, desktopNavVisible ? "true" : "false");
    }, [desktopNavVisible]);

    return (
        <>
            <ProjectSidebarNav
                scripts={[]}
                scriptsLoading={false}
                isVisible={desktopNavVisible}
                onToggle={() => setDesktopNavVisible((prev) => !prev)}
            />
            <div className={cn(desktopNavVisible && "md:pl-64")}>{children}</div>
        </>
    );
}
