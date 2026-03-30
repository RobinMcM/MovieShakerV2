"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ProjectMobileNav } from "@/components/project/ProjectMobileNav";
import { ProjectSidebarNav } from "@/components/project/ProjectSidebarNav";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useProjectScriptsNav } from "./useProjectScriptsNav";

export default function ProjectLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const params = useParams();
  const projectId = useMemo(
    () =>
      typeof params.projectId === "string" ? params.projectId : params.projectId?.[0] || null,
    [params.projectId]
  );

  const { scripts, loading } = useProjectScriptsNav(projectId);
  const [desktopNavVisible, setDesktopNavVisible] = useState(true);
  const sidebarStorageKey = "movieshaker:project-nav-visible";

  if (!projectId) {
    return <>{children}</>;
  }

  useEffect(() => {
    const stored = window.localStorage.getItem(sidebarStorageKey);
    if (stored === "false") {
      setDesktopNavVisible(false);
    }
  }, [sidebarStorageKey]);

  useEffect(() => {
    window.localStorage.setItem(sidebarStorageKey, desktopNavVisible ? "true" : "false");
  }, [sidebarStorageKey, desktopNavVisible]);

  return (
    <>
      {desktopNavVisible && (
        <ProjectSidebarNav projectId={projectId} scripts={scripts} scriptsLoading={loading} />
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
        onClick={() => setDesktopNavVisible((prev) => !prev)}
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
    </>
  );
}
