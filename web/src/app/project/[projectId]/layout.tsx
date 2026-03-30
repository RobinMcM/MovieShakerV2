"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { ProjectMobileNav } from "@/components/project/ProjectMobileNav";
import { ProjectSidebarNav } from "@/components/project/ProjectSidebarNav";
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

  if (!projectId) {
    return <>{children}</>;
  }

  return (
    <>
      <ProjectSidebarNav projectId={projectId} scripts={scripts} scriptsLoading={loading} />
      <ProjectMobileNav projectId={projectId} scripts={scripts} scriptsLoading={loading} />
      <div className="md:pl-64">{children}</div>
    </>
  );
}
