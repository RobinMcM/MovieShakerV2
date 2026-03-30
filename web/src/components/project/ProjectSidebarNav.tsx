"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, FileText, FolderKanban } from "lucide-react";
import { PROJECT_EXTERNAL_NAV, PROJECT_TOOL_NAV } from "@/app/project/[projectId]/projectNav";
import { cn } from "@/lib/utils";

interface ScriptItem {
  id: string;
  name: string;
  is_current: boolean;
}

interface ProjectSidebarNavProps {
  projectId: string;
  scripts: ScriptItem[];
  scriptsLoading?: boolean;
}

export function ProjectSidebarNav({
  projectId,
  scripts,
  scriptsLoading = false,
}: ProjectSidebarNavProps) {
  const pathname = usePathname();
  const [scriptsExpanded, setScriptsExpanded] = useState(true);

  const scriptLinks = useMemo(
    () => scripts.slice(0, 8).map((s) => ({ ...s, href: `/project/${projectId}/script/${s.id}` })),
    [scripts, projectId]
  );

  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 w-64 border-r bg-background/95 backdrop-blur z-40">
      <div className="w-full pt-5 pb-4 px-3 overflow-y-auto">
        <div className="flex items-center gap-2 px-2 mb-4">
          <FolderKanban className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold">Project Navigation</h2>
        </div>

        <nav className="space-y-1">
          {PROJECT_TOOL_NAV.map((item) => {
            const href = item.href(projectId);
            const isActive = pathname === href;
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-5 pt-4 border-t">
          <button
            type="button"
            onClick={() => setScriptsExpanded((v) => !v)}
            className="w-full flex items-center justify-between rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Scripts
            </span>
            {scriptsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>

          {scriptsExpanded && (
            <div className="mt-1 space-y-1">
              {scriptsLoading && (
                <p className="text-xs text-muted-foreground px-2.5 py-1">Loading scripts...</p>
              )}
              {!scriptsLoading && scriptLinks.length === 0 && (
                <p className="text-xs text-muted-foreground px-2.5 py-1">
                  No scripts available.
                </p>
              )}
              {scriptLinks.map((s) => {
                const isActive = pathname === s.href;
                return (
                  <Link
                    key={s.id}
                    href={s.href}
                    className={cn(
                      "block rounded-md px-2.5 py-1.5 text-xs transition-colors truncate",
                      isActive
                        ? "bg-primary/15 text-primary font-medium"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                    title={s.name}
                  >
                    {s.is_current ? "Current: " : ""}
                    {s.name}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-5 pt-4 border-t">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground px-2.5 mb-2">
            Additional Tools
          </p>
          <div className="space-y-1">
            {PROJECT_EXTERNAL_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  href={item.href(projectId)}
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
