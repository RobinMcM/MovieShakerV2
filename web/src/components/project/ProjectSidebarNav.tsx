"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bot, ChevronDown, ChevronRight, FileText, FolderKanban, PanelLeftClose, PanelLeftOpen, Plus, Upload } from "lucide-react";
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
    aiCredits: number | null;
    coproducerActive: boolean;
    onCoproducerActivate: () => void;
    isVisible: boolean;
    onToggle: () => void;
    activeAgent?: string;
}

export function ProjectSidebarNav({
    projectId,
    scripts,
    scriptsLoading = false,
    aiCredits,
    coproducerActive,
    onCoproducerActivate,
    isVisible,
    onToggle,
    activeAgent = "CoProducer",
}: ProjectSidebarNavProps) {
    const pathname = usePathname();
    const router = useRouter();
    const [scriptsExpanded, setScriptsExpanded] = useState(true);
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

    const hasCredits = aiCredits !== null && aiCredits > 0;

    function handleCoproducerClick() {
        if (!projectId) return;
        if (hasCredits) {
            onCoproducerActivate();
        } else {
            router.push("/credits");
        }
    }

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

                    {/* Project tool nav — only when a project is selected */}
                    {projectId && (
                        <div className="mt-5 pt-4 border-t">
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
                        </div>
                    )}

                    {/* Scripts section */}
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

                    {/* Additional Tools — only when a project is selected */}
                    {projectId && (
                        <div className="mt-5 pt-4 border-t">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground px-2.5 mb-2">
                                Additional Tools
                            </p>
                            <div className="space-y-1">
                                {PROJECT_EXTERNAL_NAV.map((item) => {
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
                            </div>
                        </div>
                    )}
                </div>

                {/* CoProducer button — pinned at bottom */}
                <div className="shrink-0 border-t px-3 py-3">
                    <button
                        type="button"
                        onClick={handleCoproducerClick}
                        disabled={!projectId}
                        className={cn(
                            "w-full flex items-center rounded-md border text-sm overflow-hidden transition-colors",
                            !projectId
                                ? "border-border text-muted-foreground/50 cursor-default"
                                : coproducerActive && hasCredits
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                        )}
                    >
                        <span className="flex items-center gap-2 px-2.5 py-2 flex-1 min-w-0">
                            <Bot className="h-4 w-4 shrink-0" />
                            <span className="truncate">{activeAgent}</span>
                        </span>
                        <span className="w-px self-stretch bg-border/60 shrink-0" />
                        <span className="px-2.5 py-2 text-xs shrink-0">
                            {!projectId
                                ? "—"
                                : aiCredits === null
                                ? "…"
                                : hasCredits
                                ? `${aiCredits} credits`
                                : "Buy Credits"}
                        </span>
                    </button>
                    {!projectId && (
                        <p className="mt-1.5 text-[11px] text-center text-muted-foreground/60 px-1">
                            Select a project to begin
                        </p>
                    )}
                </div>
            </aside>

        </>
    );
}
