"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, FileText, FolderKanban, PanelLeftClose, PanelLeftOpen, Plus, Upload } from "lucide-react";
import {
    PROJECT_EXTERNAL_NAV,
    PROJECT_TOOL_NAV,
} from "@/app/project/[projectId]/projectNav";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface ScriptItem {
    id: string;
    name: string;
    is_current: boolean;
}

interface ProjectItem {
    id: string;
    name: string;
}

interface ProjectSidebarNavProps {
    projectId?: string;
    scripts: ScriptItem[];
    scriptsLoading?: boolean;
    isVisible: boolean;
    onToggle: () => void;
}

export function ProjectSidebarNav({
    projectId,
    scripts,
    scriptsLoading = false,
    isVisible,
    onToggle,
}: ProjectSidebarNavProps) {
    const pathname = usePathname();
    const [scriptsExpanded, setScriptsExpanded] = useState(false);
    const [projectsExpanded, setProjectsExpanded] = useState(false);
    const [projects, setProjects] = useState<ProjectItem[]>([]);

    useEffect(() => {
        let cancelled = false;
        api.get<ProjectItem[]>("/projects/")
            .then((data) => {
                if (cancelled) return;
                const list = Array.isArray(data) ? data : [];
                setProjects(list);
            })
            .catch(() => {
                if (!cancelled) setProjects([]);
            });
        return () => { cancelled = true; };
    }, []);

    const scriptLinks = useMemo(
        () =>
            projectId
                ? scripts
                    .slice(0, 8)
                    .map((s) => ({ ...s, href: `/project/${projectId}/script/${s.id}` }))
                : [],
        [scripts, projectId]
    );

    return (
        <>
            {/* Toggle tab — always present, sits on the right edge of the panel */}
            <button
                type="button"
                onClick={onToggle}
                className={`hidden md:flex fixed top-1/2 -translate-y-1/2 z-[41]
                            h-16 w-8 items-center justify-center
                            bg-background border border-l-0 border-border
                            rounded-r-md shadow-lg hover:bg-accent
                            transition-[left] duration-300 ease-in-out
                            ${isVisible ? "left-[256px]" : "left-0"}`}
                aria-label={isVisible ? "Close project sidebar" : "Open project sidebar"}
                title={isVisible ? "Close sidebar" : "Open sidebar"}
            >
                {isVisible ? (
                    <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
                ) : (
                    <PanelLeftOpen className="h-4 w-4 text-muted-foreground" />
                )}
            </button>

            <aside className={`hidden md:flex flex-col fixed left-0 top-0 bottom-0 w-64 border-r bg-background/95 backdrop-blur z-40
                               transition-transform duration-300 ease-in-out
                               ${isVisible ? "translate-x-0" : "-translate-x-full"}`}>
                {/* Scrollable nav area */}
                <div className="flex-1 min-h-0 overflow-y-auto pt-5 pb-4 px-3">

                    {/* Projects section */}
                    <div>
                        <button
                            type="button"
                            onClick={() => setProjectsExpanded((v) => !v)}
                            className="w-full flex items-center justify-between rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <span className="flex items-center gap-2">
                                <FolderKanban className="h-4 w-4" />
                                Projects
                            </span>
                            {projectsExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                            ) : (
                                <ChevronRight className="h-4 w-4" />
                            )}
                        </button>

                        {projectsExpanded && (
                            <div className="mt-1 space-y-1">
                                {projects.length === 0 && (
                                    <p className="text-xs text-muted-foreground px-2.5 py-1">
                                        No projects found.
                                    </p>
                                )}
                                {projects.map((p) => {
                                    const isActive = p.id === projectId;
                                    return (
                                        <Link
                                            key={p.id}
                                            href={`/project/${p.id}`}
                                            className={cn(
                                                "block rounded-md px-2.5 py-1.5 text-xs transition-colors truncate",
                                                isActive
                                                    ? "bg-primary/15 text-primary font-medium"
                                                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                            )}
                                            title={p.name}
                                        >
                                            {p.name}
                                        </Link>
                                    );
                                })}
                                <Link
                                    href="/projects"
                                    className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors font-medium text-primary/80 hover:bg-accent hover:text-foreground"
                                >
                                    <Plus className="h-3 w-3" />
                                    New Project
                                </Link>
                            </div>
                        )}
                    </div>

                    {/* Scripts section */}
                    <div className="mt-2 pt-2 border-t">
                        <button
                            type="button"
                            onClick={() => setScriptsExpanded((v) => !v)}
                            className="w-full flex items-center justify-between rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <span className="flex items-center gap-2">
                                <FileText className="h-4 w-4" />
                                Scripts
                            </span>
                            {scriptsExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                            ) : (
                                <ChevronRight className="h-4 w-4" />
                            )}
                        </button>

                        {scriptsExpanded && (
                            <div className="mt-1 space-y-1">
                                {!projectId ? (
                                    <p className="text-xs text-muted-foreground px-2.5 py-1">
                                        Select a project to view scripts.
                                    </p>
                                ) : scriptsLoading ? (
                                    <p className="text-xs text-muted-foreground px-2.5 py-1">
                                        Loading scripts...
                                    </p>
                                ) : scriptLinks.length === 0 ? (
                                    <p className="text-xs text-muted-foreground px-2.5 py-1">
                                        No scripts available.
                                    </p>
                                ) : (
                                    scriptLinks.map((s) => {
                                        const isActive = pathname === s.href;
                                        return (
                                            <Link
                                                key={s.id}
                                                href={s.href}
                                                className={cn(
                                                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                                                    isActive
                                                        ? "bg-primary/15 text-primary font-medium"
                                                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                                )}
                                                title={s.name}
                                            >
                                                <span className="truncate flex-1">{s.name}</span>
                                                {s.is_current && (
                                                    <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-primary/20 text-primary font-medium leading-none">
                                                        Current
                                                    </span>
                                                )}
                                            </Link>
                                        );
                                    })
                                )}
                                {projectId && (
                                    <Link
                                        href={`/project/${projectId}/scripts`}
                                        className={cn(
                                            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors font-medium",
                                            pathname === `/project/${projectId}/scripts`
                                                ? "bg-primary/15 text-primary"
                                                : "text-primary/80 hover:bg-accent hover:text-foreground"
                                        )}
                                    >
                                        <Upload className="h-3 w-3" />
                                        Upload Script
                                    </Link>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Project tool nav — always visible; greyed out until a project is selected */}
                    <div className="mt-5 pt-4 border-t">
                        <nav className="space-y-1">
                            {PROJECT_TOOL_NAV.map((item) => {
                                const href = projectId ? item.href(projectId) : "/projects";
                                const isActive = projectId ? pathname === item.href(projectId) : false;
                                const Icon = item.icon;
                                return (
                                    <Link
                                        key={item.id}
                                        href={href}
                                        className={cn(
                                            "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                                            isActive
                                                ? "bg-primary/15 text-primary font-medium"
                                                : projectId
                                                ? "text-muted-foreground hover:bg-accent hover:text-foreground"
                                                : "text-muted-foreground/40 hover:bg-accent/50 hover:text-muted-foreground"
                                        )}
                                    >
                                        <Icon className="h-4 w-4" />
                                        <span>{item.label}</span>
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>

                    {/* Additional Tools — always visible */}
                    <div className="mt-5 pt-4 border-t">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground px-2.5 mb-2">
                            Additional Tools
                        </p>
                        <div className="space-y-1">
                            {PROJECT_EXTERNAL_NAV.map((item) => {
                                const href = projectId ? item.href(projectId) : "/projects";
                                const isActive = projectId ? pathname === item.href(projectId) : false;
                                const Icon = item.icon;
                                return (
                                    <Link
                                        key={item.id}
                                        href={href}
                                        className={cn(
                                            "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                                            isActive
                                                ? "bg-primary/15 text-primary font-medium"
                                                : projectId
                                                ? "text-muted-foreground hover:bg-accent hover:text-foreground"
                                                : "text-muted-foreground/40 hover:bg-accent/50 hover:text-muted-foreground"
                                        )}
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

        </>
    );
}
