"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { ScriptChat } from "@/components/scripts/ScriptChat";

interface CoproducerSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    contextMode: string;
    contextId?: string;
    userModel: string;
    coproducerActive?: boolean;
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
    coproducerActive = false,
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

            {/* Toggle tab — separate fixed element, independent of the panel.
                Always accessible when coproducerActive, moves with the panel edge. */}
            {coproducerActive && (
                <button
                    type="button"
                    onClick={onClose}
                    className={`hidden md:flex fixed top-1/2 -translate-y-1/2 z-[81]
                                h-16 w-8 items-center justify-center
                                bg-background border border-r-0 border-border
                                rounded-l-md shadow-lg hover:bg-accent
                                transition-[right] duration-300 ease-in-out
                                ${isOpen ? "right-[420px]" : "right-0"}`}
                    aria-label={isOpen ? "Close CoProducer" : "Open CoProducer"}
                    title={isOpen ? "Close CoProducer" : "Open CoProducer"}
                >
                    {isOpen ? (
                        <PanelRightClose className="h-4 w-4 text-muted-foreground" />
                    ) : (
                        <PanelRightOpen className="h-4 w-4 text-muted-foreground" />
                    )}
                </button>
            )}

            {/* Sidebar panel — directly fixed with explicit width.
                translate-x-full on a directly-fixed element with known width
                is guaranteed to slide it fully off the right edge. */}
            <aside
                className={`fixed inset-y-0 right-0 z-[80] w-full md:w-[420px]
                            bg-background border-l shadow-xl flex flex-col
                            transition-transform duration-300 ease-in-out
                            ${isOpen ? "translate-x-0" : "translate-x-full"}`}
                aria-label="CoProducer sidebar"
            >
                {/* Header */}
                <div className="flex items-center px-4 py-3 border-b shrink-0">
                    <span className="text-sm font-semibold">CoProducer</span>
                    <span className="ml-3 text-[10px] uppercase tracking-wide bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                        {contextLabel}
                    </span>
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
