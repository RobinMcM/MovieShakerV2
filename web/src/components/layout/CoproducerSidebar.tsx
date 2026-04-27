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
    activeAgent?: string;
}

const AGENT_CONFIG: Record<string, { icon: string; description: string }> = {
    CoWriter:   { icon: "✍️",  description: "Script & Story" },
    CoProducer: { icon: "🎬", description: "Production" },
    CoDirector: { icon: "🎥", description: "Visual Direction" },
    CoDesigner: { icon: "🎨", description: "Visual Identity" },
};

const CONTEXT_LABELS: Record<string, string> = {
    scripts: "Scripts",
    budgets: "Budgets",
    schedule: "Schedule",
    scheduling: "Scheduling",
    shotlist: "Shot List",
    moodboard: "Moodboard",
    objects: "Objects",
    general: "General",
};

// Moodboard generation passes — dispatched to the page via 'generateMoodboard' custom event.
// The page holds the generation logic; the sidebar is the trigger surface only.
const MOODBOARD_PASS_OPTIONS = [
    { value: "sketch",    label: "✏️ Pencil Sketch",  description: "Start here" },
    { value: "draft",     label: "🖊️ Ink Draft",       description: "Refine lines" },
    { value: "tonal",     label: "◑ Tonal Study",      description: "Add light/shadow" },
    { value: "colour",    label: "🎨 Colour Study",     description: "Establish palette" },
    { value: "cinematic", label: "🎬 Cinematic",        description: "Final quality" },
    { value: "reference", label: "📷 Reference Shot",   description: "Visualize ready" },
];

interface PromptOverrideResponse {
    prompt_override?: string | null;
    prompt_override_mode: string;
}

// Responds to window.matchMedia — initialises to false (safe for SSR)
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
    coproducerActive = false,
    activeAgent = "CoProducer",
}: CoproducerSidebarProps) {
    const contextLabel = CONTEXT_LABELS[contextMode] ?? "General";
    const agentConfig = AGENT_CONFIG[activeAgent] ?? AGENT_CONFIG.CoProducer;

    // Desktop: sidebar always visible when coproducerActive, collapses to icon strip.
    // Mobile: overlay behaviour unchanged — isOpen controls translate-x.
    const isMobile = useMediaQuery("(max-width: 767px)");

    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptOverride, setPromptOverride] = useState("");
    const [promptOverrideMode, setPromptOverrideMode] = useState<"append" | "prepend">("append");
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

    // Opening-message state — keyed by contextMode so switching pages resets it
    const [openingDismissed, setOpeningDismissed] = useState<Record<string, boolean>>({});
    const [generating, setGenerating] = useState(false);
    const [generatingLabel, setGeneratingLabel] = useState("");
    const [generateDoneLabel, setGenerateDoneLabel] = useState<string | null>(null);
    const [generateError, setGenerateError] = useState<string | null>(null);
    const chatRef = useRef<ScriptChatHandle>(null);
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);

    const showOpening = (
        contextMode === "scheduling" ||
        contextMode === "shotlist" ||
        contextMode === "moodboard" ||
        contextMode === "objects"
    ) && !!contextId && !openingDismissed[contextMode];

    // Send pendingMessage once opening is dismissed and chat ref is ready
    useEffect(() => {
        if (!pendingMessage || showOpening) return;
        const t = setTimeout(() => {
            chatRef.current?.sendMessage(pendingMessage);
            setPendingMessage(null);
        }, 150);
        return () => clearTimeout(t);
    }, [pendingMessage, showOpening]);

    // Bridge: listen for moodboard generation events dispatched by the page.
    // 'generateMoodboard' → show progress. 'moodboardGenerated' → show result.
    useEffect(() => {
        const startHandler = (e: Event) => {
            const { passType } = (e as CustomEvent).detail ?? {};
            const opt = MOODBOARD_PASS_OPTIONS.find((o) => o.value === passType);
            setGenerating(true);
            setGeneratingLabel(opt?.label ?? "Moodboard");
            setGenerateDoneLabel(null);
            setGenerateError(null);
        };
        const doneHandler = (e: Event) => {
            const { passType, error } = (e as CustomEvent).detail ?? {};
            const opt = MOODBOARD_PASS_OPTIONS.find((o) => o.value === passType);
            setGenerating(false);
            setGeneratingLabel("");
            if (error) {
                setGenerateError("Generation failed — please try again.");
                setTimeout(() => setGenerateError(null), 5000);
            } else {
                setGenerateDoneLabel(opt?.label ? `${opt.label} complete ✓` : "Complete ✓");
                setTimeout(() => setGenerateDoneLabel(null), 3000);
            }
        };
        window.addEventListener("generateMoodboard", startHandler);
        window.addEventListener("moodboardGenerated", doneHandler);
        return () => {
            window.removeEventListener("generateMoodboard", startHandler);
            window.removeEventListener("moodboardGenerated", doneHandler);
        };
    }, []);

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

    // Sidebar geometry:
    //   Mobile  — full-width overlay; translate in/out based on isOpen
    //   Desktop — fixed strip; always visible when coproducerActive
    //             isOpen=true → w-[420px], isOpen=false → w-12 (icon strip)
    const widthClass = isMobile
        ? "w-full"
        : isOpen
            ? "w-[420px]"
            : "w-12";

    const transformClass = isMobile
        ? (isOpen ? "translate-x-0" : "translate-x-full")
        : coproducerActive
            ? "translate-x-0"
            : "translate-x-full";

    // Desktop collapsed: show only the agent icon
    const isCollapsedDesktop = !isMobile && !isOpen && coproducerActive;

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

            {/* Toggle tab — desktop only, hugs the left edge of the sidebar.
                On desktop: always rendered when coproducerActive; toggles expand/collapse.
                right-[420px] when expanded, right-12 when collapsed to icon strip. */}
            {coproducerActive && (
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
            )}

            {/* Sidebar panel */}
            <aside
                className={`fixed inset-y-0 right-0 z-[80]
                            bg-background border-l shadow-xl flex flex-col
                            transition-all duration-300 ease-in-out
                            ${widthClass} ${transformClass}`}
                aria-label="CoProducer sidebar"
            >
                {/* Desktop collapsed — icon strip only */}
                {isCollapsedDesktop ? (
                    <div className="flex flex-col items-center py-4 gap-4">
                        <span className="text-xl" title={activeAgent}>{agentConfig.icon}</span>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="flex items-center px-4 py-3 border-b shrink-0">
                            <span className="mr-2 text-base leading-none">{agentConfig.icon}</span>
                            <div className="flex flex-col min-w-0">
                                <span className="text-sm font-semibold leading-tight">{activeAgent}</span>
                                <span className="text-[10px] text-muted-foreground leading-tight">{agentConfig.description}</span>
                            </div>
                            <span className="ml-auto text-[10px] uppercase tracking-wide bg-muted text-muted-foreground px-2 py-0.5 rounded-full shrink-0">
                                {contextLabel}
                            </span>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">

                            {/* Scheduling opening */}
                            {contextMode === "scheduling" && contextId && showOpening && (
                                <div className="flex flex-col gap-4 p-5">
                                    <p className="text-sm text-foreground leading-relaxed">
                                        I&apos;m {activeAgent}, your production scheduler. I&apos;ve read
                                        the script and I&apos;m ready to build your shoot schedule.
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

                            {/* Shotlist opening */}
                            {contextMode === "shotlist" && contextId && showOpening && (
                                <div className="flex flex-col gap-4 p-5">
                                    <p className="text-sm text-foreground leading-relaxed">
                                        I&apos;m {activeAgent}, your shot designer. Select a scene
                                        and I&apos;ll suggest camera setups and tram line placements
                                        based on the dialogue and action.
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

                            {/* Moodboard opening — CoDesigner: 2-column pass grid
                                Clicking a chip dispatches 'generateMoodboard' to the page
                                and dismisses the opening, transitioning to chat. */}
                            {contextMode === "moodboard" && contextId && showOpening && activeAgent !== "CoDirector" && (
                                <div className="flex flex-col gap-3 p-5">
                                    <p className="text-sm text-foreground leading-relaxed">
                                        I&apos;m CoDesigner — ready to build your visual world.
                                        Select a scene and I&apos;ll generate the moodboard progression.
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {MOODBOARD_PASS_OPTIONS.map((opt) => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => {
                                                    window.dispatchEvent(
                                                        new CustomEvent("generateMoodboard", {
                                                            detail: { passType: opt.value },
                                                        })
                                                    );
                                                    setOpeningDismissed((prev) => ({ ...prev, [contextMode]: true }));
                                                }}
                                                className="flex flex-col items-start p-2 rounded-md border border-border bg-background hover:bg-accent hover:border-teal-500 transition-colors text-left"
                                            >
                                                <span className="text-sm font-medium">{opt.label}</span>
                                                <span className="text-xs text-muted-foreground">{opt.description}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Moodboard opening — CoDirector: framing and shot analysis chips */}
                            {contextMode === "moodboard" && contextId && showOpening && activeAgent === "CoDirector" && (
                                <div className="flex flex-col gap-4 p-5">
                                    <p className="text-sm text-foreground leading-relaxed">
                                        I&apos;m CoDirector on the moodboard. I can help you refine
                                        shot framing and develop the visual approach for each setup.
                                    </p>
                                    <div className="flex flex-col gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOpeningDismissed((prev) => ({ ...prev, [contextMode]: true }));
                                                setPendingMessage(
                                                    "Review the current moodboard compositions and suggest how to improve the visual storytelling for this scene."
                                                );
                                            }}
                                            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-left"
                                        >
                                            Suggest improvements
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOpeningDismissed((prev) => ({ ...prev, [contextMode]: true }));
                                                setPendingMessage(
                                                    "Review the shot list and confirm every setup in this scene has a moodboard composition. Flag any gaps."
                                                );
                                            }}
                                            className="text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-accent transition-colors text-left"
                                        >
                                            Check shot coverage
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOpeningDismissed((prev) => ({ ...prev, [contextMode]: true }));
                                                setPendingMessage(
                                                    "Looking at the current composition, what would make this shot more cinematic? Consider lighting, framing, and character positioning."
                                                );
                                            }}
                                            className="text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-accent transition-colors text-left"
                                        >
                                            Develop this shot further
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* CoDesigner opening (objects context) */}
                            {contextMode === "objects" && contextId && showOpening && (
                                <div className="flex flex-col gap-4 p-5">
                                    <p className="text-sm text-foreground leading-relaxed">
                                        I&apos;m CoDesigner — your visual identity guardian. I manage
                                        how everything looks in your film.
                                    </p>
                                    <p className="text-sm text-foreground leading-relaxed">
                                        I can:
                                    </p>
                                    <ul className="text-sm text-muted-foreground space-y-1 pl-1">
                                        <li>· Generate background sketches for each location</li>
                                        <li>· Identify props and artifacts that need continuity tracking</li>
                                        <li>· Ensure your characters look consistent across every scene</li>
                                    </ul>
                                    <p className="text-sm text-foreground leading-relaxed">
                                        What would you like to work on?
                                    </p>
                                    <div className="flex gap-2 flex-wrap">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOpeningDismissed((prev) => ({ ...prev, [contextMode]: true }));
                                                setPendingMessage(
                                                    "Read the script and identify all unique locations. Generate a pencil sketch background for each one."
                                                );
                                            }}
                                            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                        >
                                            Generate backgrounds
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOpeningDismissed((prev) => ({ ...prev, [contextMode]: true }));
                                                setPendingMessage(
                                                    "Read the action lines in the script and identify all physical objects that appear in multiple scenes or are plot-significant. List them with the scenes they appear in."
                                                );
                                            }}
                                            className="text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-accent transition-colors"
                                        >
                                            Identify artifacts
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOpeningDismissed((prev) => ({ ...prev, [contextMode]: true }));
                                                setPendingMessage(
                                                    "Review all approved character images and backgrounds. Flag any that are missing or inconsistent with the script descriptions."
                                                );
                                            }}
                                            className="text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-accent transition-colors"
                                        >
                                            Check visual consistency
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Chat — scripts always; other contexts once opening is dismissed */}
                            {(contextMode === "scripts" ||
                              ((contextMode === "scheduling" || contextMode === "shotlist" || contextMode === "moodboard" || contextMode === "objects") && !showOpening))
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
                                        {activeAgent} is ready. Navigate to a script to begin.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Moodboard generation progress banner — pinned above personalise panel */}
                        {contextMode === "moodboard" && generating && (
                            <div className="flex items-center gap-2 p-3 bg-teal-950 border-t border-teal-800 shrink-0">
                                <Loader2 className="h-4 w-4 animate-spin text-teal-400" />
                                <span className="text-sm text-teal-300">Generating {generatingLabel}...</span>
                            </div>
                        )}
                        {contextMode === "moodboard" && generateDoneLabel && !generating && (
                            <div className="p-3 bg-teal-950 border-t border-teal-800 shrink-0">
                                <span className="text-sm text-teal-300">{generateDoneLabel}</span>
                            </div>
                        )}
                        {contextMode === "moodboard" && generateError && !generating && (
                            <div className="p-3 border-t border-border shrink-0">
                                <span className="text-xs text-destructive">{generateError}</span>
                            </div>
                        )}

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
