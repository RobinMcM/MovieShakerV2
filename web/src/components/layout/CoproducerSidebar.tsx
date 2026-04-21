"use client";

import { X } from "lucide-react";
import { ScriptChat } from "@/components/scripts/ScriptChat";

interface CoproducerSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    contextMode: string;
    contextId?: string;
    userModel: string;
}

const CONTEXT_LABELS: Record<string, string> = {
    scripts: "Scripts",
    budgets: "Budgets",
    schedule: "Schedule",
    general: "General",
};

export function CoproducerSidebar({
    isOpen,
    onClose,
    contextMode,
    contextId,
}: CoproducerSidebarProps) {
    const contextLabel = CONTEXT_LABELS[contextMode] ?? "General";

    return (
        <>
            {/* Mobile backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-[70] bg-black/40 md:hidden"
                    onClick={onClose}
                    aria-hidden="true"
                />
            )}

            {/* Sidebar panel */}
            <aside
                className={`fixed top-0 right-0 bottom-0 z-[80] w-full md:w-[420px] bg-background border-l shadow-xl flex flex-col transition-transform duration-300 ease-in-out ${
                    isOpen ? "translate-x-0" : "translate-x-full"
                }`}
                aria-label="CoProducer sidebar"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold">CoProducer</span>
                        <span className="text-[10px] uppercase tracking-wide bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                            {contextLabel}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Close CoProducer"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0 overflow-hidden">
                    {contextMode === "scripts" && contextId ? (
                        <ScriptChat scriptId={contextId} embedded={true} />
                    ) : (
                        <div className="flex items-center justify-center h-full p-6 text-center">
                            <p className="text-sm text-muted-foreground">
                                CoProducer is ready. Navigate to a script to begin.
                            </p>
                        </div>
                    )}
                </div>
            </aside>
        </>
    );
}
