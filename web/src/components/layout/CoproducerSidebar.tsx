"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, PanelRightClose, PanelRightOpen } from "lucide-react";
import { ScriptChat, type ScriptChatHandle } from "@/components/scripts/ScriptChat";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";

interface CoproducerSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    contextMode: string;
    contextId?: string;
}

const AGENT_CONFIG: Record<string, { icon: string; description: string }> = {
    CoWriter:   { icon: "✍️",  description: "Script & Story" },
    CoProducer: { icon: "🎬", description: "Production" },
    CoDirector: { icon: "🎥", description: "Visual Direction" },
    CoDesigner: { icon: "🎨", description: "Visual Identity" },
};

const CONTEXT_LABELS: Record<string, string> = {
    scripts:    "Scripts",
    budgets:    "Budgets",
    schedule:   "Schedule",
    scheduling: "Scheduling",
    shotlist:   "Shot List",
    moodboard:  "Moodboard",
    objects:    "Objects",
    general:    "General",
};

interface PromptOverrideResponse {
    prompt_override?: string | null;
    prompt_override_mode: string;
}

interface ProfileData {
    ai_credits?: number;
}

function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(false);
    useEffect(() => {
        const media = window.matchMedia(query);
        setMatches(media.matches);
        const listener = () => setMatches(media.matches);
        media.addEventListener("change", listener);
        return () => media.removeEventListener("change", listener);
    }, [query]);
    return matches;
}

export function CoproducerSidebar({
    isOpen,
    onClose,
    contextMode,
    contextId,
}: CoproducerSidebarProps) {
    const contextLabel = CONTEXT_LABELS[contextMode] ?? "General";
    const isMobile = useMediaQuery("(max-width: 767px)");

    const [activeAgent, setActiveAgent] = useState("CoProducer");
    const [aiCredits, setAiCredits] = useState<number | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptOverride, setPromptOverride] = useState("");
    const [promptOverrideMode, setPromptOverrideMode] = useState<"append" | "prepend">("append");
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

    const chatRef = useRef<ScriptChatHandle>(null);

    const agentConfig = AGENT_CONFIG[activeAgent] ?? AGENT_CONFIG.CoProducer;

    // Pages dispatch this event to send a preset message into the chat
    useEffect(() => {
        const handler = (e: Event) => {
            const msg = (e as CustomEvent<{ message: string }>).detail?.message;
            if (msg) chatRef.current?.sendMessage(msg);
        };
        window.addEventListener("coproducerSendMessage", handler);
        return () => window.removeEventListener("coproducerSendMessage", handler);
    }, []);

    useEffect(() => {
        api.get<ProfileData>("/profile/")
            .then((p) => setAiCredits(p.ai_credits ?? 0))
            .catch(() => setAiCredits(0));
    }, []);

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

    const widthClass = isMobile ? "w-full" : isOpen ? "w-[420px]" : "w-12";
    const transformClass = isMobile
        ? (isOpen ? "translate-x-0" : "translate-x-full")
        : "translate-x-0";
    const isCollapsedDesktop = !isMobile && !isOpen;

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

            {/* Expand/collapse toggle tab — desktop only */}
            <button
                type="button"
                onClick={onClose}
                className={`hidden md:flex fixed top-1/2 -translate-y-1/2 z-[81]
                            h-16 w-8 items-center justify-center
                            bg-background border border-r-0 border-border
                            rounded-l-md shadow-lg hover:bg-accent
                            transition-[right] duration-300 ease-in-out
                            ${isOpen ? "right-[420px]" : "right-12"}`}
                aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
                title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
                {isOpen ? (
                    <PanelRightClose className="h-4 w-4 text-muted-foreground" />
                ) : (
                    <PanelRightOpen className="h-4 w-4 text-muted-foreground" />
                )}
            </button>

            {/* Sidebar panel */}
            <aside
                className={`fixed inset-y-0 right-0 z-[80]
                            bg-background border-l shadow-xl flex flex-col
                            transition-all duration-300 ease-in-out
                            ${widthClass} ${transformClass}`}
                aria-label="AI assistant sidebar"
            >
                {/* Desktop collapsed — icon strip only */}
                {isCollapsedDesktop ? (
                    <div className="flex flex-col items-center py-4 gap-4">
                        <span className="text-xl" title={activeAgent}>{agentConfig.icon}</span>
                    </div>
                ) : (
                    <>
                        {/* Header: agent selector dropdown + credits */}
                        <div className="flex items-center gap-2 px-3 py-3 border-b shrink-0">
                            <Select value={activeAgent} onValueChange={setActiveAgent}>
                                <SelectTrigger className="h-8 flex-1 text-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent position="item-aligned">
                                    <SelectItem value="CoWriter">✍️ CoWriter</SelectItem>
                                    <SelectItem value="CoProducer">🎬 CoProducer</SelectItem>
                                    <SelectItem value="CoDirector">🎥 CoDirector</SelectItem>
                                    <SelectItem value="CoDesigner">🎨 CoDesigner</SelectItem>
                                </SelectContent>
                            </Select>
                            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                                {aiCredits !== null ? `${aiCredits} credits` : "…"}
                            </span>
                            <span className="text-[10px] uppercase tracking-wide bg-muted text-muted-foreground px-2 py-0.5 rounded-full shrink-0">
                                {contextLabel}
                            </span>
                        </div>

                        {/* Chat — full height, always shown when contextId is available */}
                        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                            {contextId ? (
                                contextMode === "scripts" ? (
                                    <ScriptChat
                                        ref={chatRef}
                                        scriptId={contextId}
                                        embedded={true}
                                        contextMode={contextMode}
                                        activeAgent={activeAgent}
                                    />
                                ) : (
                                    <ScriptChat
                                        ref={chatRef}
                                        projectId={contextId}
                                        embedded={true}
                                        contextMode={contextMode}
                                        activeAgent={activeAgent}
                                    />
                                )
                            ) : (
                                <div className="flex items-center justify-center h-full p-6 text-center">
                                    <p className="text-sm text-muted-foreground">
                                        {activeAgent} is ready. Select a project to begin.
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
                                <span>Personalise {activeAgent}</span>
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
                    </>
                )}
            </aside>
        </>
    );
}
