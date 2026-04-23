"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { ScriptChat, type ScriptChatHandle } from "@/components/scripts/ScriptChat";
import { api } from "@/lib/api";

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
    scheduling: "Scheduling",
    shotlist: "Shot List",
    moodboard: "Moodboard",
    general: "General",
};

interface PromptOverrideResponse {
    prompt_override?: string | null;
    prompt_override_mode: string;
}

export function CoproducerSidebar({
    isOpen,
    onClose,
    contextMode,
    contextId,
    coproducerActive = false,
}: CoproducerSidebarProps) {
    const contextLabel = CONTEXT_LABELS[contextMode] ?? "General";

    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptOverride, setPromptOverride] = useState("");
    const [promptOverrideMode, setPromptOverrideMode] = useState<"append" | "prepend">("append");
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

    // Opening-message state — keyed by contextMode so switching pages resets it
    const [openingDismissed, setOpeningDismissed] = useState<Record<string, boolean>>({});
    const [generating, setGenerating] = useState(false);
    const [generateError, setGenerateError] = useState<string | null>(null);
    const chatRef = useRef<ScriptChatHandle>(null);
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);

    const showOpening = (contextMode === "scheduling" || contextMode === "shotlist" || contextMode === "moodboard")
        && !!contextId
        && !openingDismissed[contextMode];

    // Send pendingMessage once opening is dismissed and chat ref is ready
    useEffect(() => {
        if (!pendingMessage || showOpening) return;
        const t = setTimeout(() => {
            chatRef.current?.sendMessage(pendingMessage);
            setPendingMessage(null);
        }, 150);
        return () => clearTimeout(t);
    }, [pendingMessage, showOpening]);

    async function handleGenerate() {
        if (!contextId) return;
        setGenerating(true);
        setGenerateError(null);
        try {
            await api.post(`/scripts/${contextId}/schedule/generate`, {}, 120_000);
            window.dispatchEvent(new Event("scheduleGenerated"));
            setOpeningDismissed((prev) => ({ ...prev, [contextMode]: true }));
        } catch {
            setGenerateError("Generate failed — please try again.");
        } finally {
            setGenerating(false);
        }
    }

    function handleShowBreakdown() {
        setOpeningDismissed((prev) => ({ ...prev, [contextMode]: true }));
        setPendingMessage(
            "Give me a breakdown of the shoot schedule by location with cast requirements and eighths per group"
        );
    }

    function handleShotlistBreakdown() {
        setOpeningDismissed((prev) => ({ ...prev, [contextMode]: true }));
    }

    useEffect(() => {
        const handler = (e: Event) => {
            const msg = (e as CustomEvent<{ message: string }>).detail?.message;
            if (!msg) return;
            setOpeningDismissed((prev) => ({ ...prev, [contextMode]: true }));
            setPendingMessage(msg);
        };
        window.addEventListener("coproducerSendMessage", handler);
        return () => window.removeEventListener("coproducerSendMessage", handler);
    }, [contextMode]);

    useEffect(() => {
        api.get<PromptOverrideResponse>("/profile/prompt-override")
            .then((data) => {
                setPromptOverride(data.prompt_override || "");
                setPromptOverrideMode(
                    data.prompt_override_mode === "prepend" ? "prepend" : "append"
                );
            })
            .catch(() => {});
    }, []);

    async function handleSaveOverride() {
        setSaving(true);
        setSaveMessage(null);
        try {
            await api.put("/profile/prompt-override", {
                prompt_override: promptOverride,
                prompt_override_mode: promptOverrideMode,
            });
            setSaveMessage({ kind: "success", text: "Preferences saved." });
        } catch {
            setSaveMessage({ kind: "error", text: "Failed to save. Please try again." });
        } finally {
            setSaving(false);
        }
    }

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
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    {/* Scheduling opening message */}
                    {contextMode === "scheduling" && contextId && showOpening && (
                        <div className="flex flex-col gap-4 p-5">
                            <p className="text-sm text-foreground leading-relaxed">
                                I&apos;m your production scheduler. I&apos;ve read the script
                                and I&apos;m ready to build your shoot schedule.
                                Want me to generate it now?
                            </p>
                            {generateError && (
                                <p className="text-xs text-destructive">{generateError}</p>
                            )}
                            <div className="flex gap-2 flex-wrap">
                                <button
                                    type="button"
                                    onClick={handleGenerate}
                                    disabled={generating}
                                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
                                >
                                    {generating && <Loader2 className="h-3 w-3 animate-spin" />}
                                    Generate schedule
                                </button>
                                <button
                                    type="button"
                                    onClick={handleShowBreakdown}
                                    className="text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-accent transition-colors"
                                >
                                    Show me the breakdown
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Shotlist opening message */}
                    {contextMode === "shotlist" && contextId && showOpening && (
                        <div className="flex flex-col gap-4 p-5">
                            <p className="text-sm text-foreground leading-relaxed">
                                I&apos;m your shot designer. Select a scene and I&apos;ll
                                suggest camera setups and tram line placements based on
                                the dialogue and action.
                            </p>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleShotlistBreakdown}
                                    className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                >
                                    Let&apos;s start
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Moodboard opening message */}
                    {contextMode === "moodboard" && contextId && showOpening && (
                        <div className="flex flex-col gap-4 p-5">
                            <p className="text-sm text-foreground leading-relaxed">
                                I&apos;m your visual director. Select a scene and I&apos;ll
                                generate the complete moodboard from your shot list and
                                character references.
                            </p>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setOpeningDismissed((prev) => ({ ...prev, [contextMode]: true }))}
                                    className="text-xs px-3 py-1.5 rounded-md bg-teal-600 text-white hover:bg-teal-700 transition-colors"
                                >
                                    Generate moodboard for this scene
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Chat — shown for scripts, and for scheduling/shotlist/moodboard once opening dismissed */}
                    {(contextMode === "scripts" ||
                      ((contextMode === "scheduling" || contextMode === "shotlist" || contextMode === "moodboard") && !showOpening))
                     && contextId ? (
                        <ScriptChat
                            ref={chatRef}
                            scriptId={contextId}
                            embedded={true}
                            contextMode={contextMode}
                        />
                    ) : !showOpening && (
                        <div className="flex items-center justify-center h-full p-6 text-center">
                            <p className="text-sm text-muted-foreground">
                                CoProducer is ready. Navigate to a script to begin.
                            </p>
                        </div>
                    )}
                </div>

                {/* Personalise panel — pinned at bottom, collapsed by default */}
                <div className="shrink-0 border-t">
                    <button
                        type="button"
                        onClick={() => setSettingsOpen((prev) => !prev)}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                        <span>Personalise CoProducer</span>
                        {settingsOpen
                            ? <ChevronUp className="h-3.5 w-3.5" />
                            : <ChevronDown className="h-3.5 w-3.5" />
                        }
                    </button>

                    {settingsOpen && (
                        <div className="px-4 pb-4 space-y-3">
                            <textarea
                                value={promptOverride}
                                onChange={(e) => setPromptOverride(e.target.value)}
                                maxLength={2000}
                                rows={4}
                                placeholder="Add your own instructions to enhance the AI responses. Example: Always suggest low-budget alternatives. Focus on UK production rates."
                                className="w-full text-xs rounded-md border border-input bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />

                            <div className="space-y-1.5">
                                <p className="text-xs text-muted-foreground">Mode:</p>
                                <div className="flex flex-col gap-1.5">
                                    {(["append", "prepend"] as const).map((mode) => (
                                        <label key={mode} className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="prompt_override_mode"
                                                value={mode}
                                                checked={promptOverrideMode === mode}
                                                onChange={() => setPromptOverrideMode(mode)}
                                                className="accent-primary"
                                            />
                                            <span className="text-xs text-foreground">
                                                {mode === "append"
                                                    ? "Append — add after main instructions"
                                                    : "Prepend — add before main instructions"
                                                }
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-muted-foreground">
                                    {promptOverride.length}/2000
                                </span>
                                <button
                                    type="button"
                                    onClick={handleSaveOverride}
                                    disabled={saving}
                                    className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                >
                                    {saving ? "Saving…" : "Save preferences"}
                                </button>
                            </div>

                            {saveMessage && (
                                <p className={`text-xs ${saveMessage.kind === "success" ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                                    {saveMessage.text}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </aside>
        </>
    );
}
