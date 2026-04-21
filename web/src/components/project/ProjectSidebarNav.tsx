"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ChevronDown, ChevronRight, FileText, FolderKanban, PanelLeftClose, PanelLeftOpen, Upload } from "lucide-react";
import {
    PROJECT_EXTERNAL_NAV,
    PROJECT_TOOL_NAV,
} from "@/app/project/[projectId]/projectNav";
import { cn } from "@/lib/utils";
import { CoProducerModal } from "@/components/CoProducerModal";

interface ScriptItem {
    id: string;
    name: string;
    is_current: boolean;
}

interface ProjectSidebarNavProps {
    projectId: string;
    scripts: ScriptItem[];
    scriptsLoading?: boolean;
    aiCredits: number | null;
    coproducerActive: boolean;
    onCoproducerActivate: () => void;
    isVisible: boolean;
    onToggle: () => void;
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
}: ProjectSidebarNavProps) {
    const pathname = usePathname();
    const [scriptsExpanded, setScriptsExpanded] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);

    const scriptLinks = useMemo(
        () =>
            scripts
                .slice(0, 8)
                .map((s) => ({ ...s, href: `/project/${projectId}/script/${s.id}` })),
        [scripts, projectId]
    );

    const hasCredits = aiCredits !== null && aiCredits > 0;

    function handleCoproducerClick() {
        if (hasCredits) {
            onCoproducerActivate();
        } else {
            setModalOpen(true);
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
                        <div className="space-y-1">
                            <button
                                type="button"
                                onClick={handleCoproducerClick}
                                className={cn(
                                    "w-full flex items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors",
                                    coproducerActive
                                        ? "bg-primary/15 text-primary font-medium"
                                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                )}
                            >
                                <span className="flex items-center gap-2">
                                    <Bot className="h-4 w-4" />
                                    CoProducer
                                </span>
                                <span
                                    className={cn(
                                        "text-xs px-2 py-0.5 rounded-full",
                                        hasCredits
                                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                            : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                                    )}
                                >
                                    {aiCredits === null
                                        ? "…"
                                        : hasCredits
                                        ? `${aiCredits} credits`
                                        : "Buy Credits"}
                                </span>
                            </button>
                        </div>
                    </div>

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
                                    Upload / Manage Scripts
                                </Link>
                                {scriptsLoading && (
                                    <p className="text-xs text-muted-foreground px-2.5 py-1">
                                        Loading scripts...
                                    </p>
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
                </div>

                {/* CoProducer button — pinned at bottom */}
                <div className="shrink-0 border-t px-3 py-3">
                    <button
                        type="button"
                        onClick={handleCoproducerClick}
                        className={cn(
                            "w-full flex items-center rounded-md border text-sm overflow-hidden transition-colors",
                            coproducerActive && hasCredits
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                        )}
                    >
                        <span className="flex items-center gap-2 px-2.5 py-2 flex-1 min-w-0">
                            <Bot className="h-4 w-4 shrink-0" />
                            <span className="truncate">CoProducer</span>
                        </span>
                        <span className="w-px self-stretch bg-border/60 shrink-0" />
                        <span className="px-2.5 py-2 text-xs shrink-0">
                            {aiCredits === null
                                ? "…"
                                : hasCredits
                                ? `${aiCredits} credits`
                                : "Buy Credits"}
                        </span>
                    </button>
                </div>
            </aside>

            <CoProducerModal open={modalOpen} onClose={() => setModalOpen(false)} />
        </>
    );
}
