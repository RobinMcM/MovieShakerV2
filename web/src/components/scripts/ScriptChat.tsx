"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Send } from "lucide-react";
import { api } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    scene_refs: number[];
    model_used?: string;
    timestamp: Date;
}

export interface ScriptChatHandle {
    sendMessage: (text: string) => void;
}

export interface ScriptChatProps {
    scriptId: string;
    initialChatId?: string;
    onAfterResponse?: () => void;
    ref?: Ref<ScriptChatHandle>;
}

interface ChatApiResponse {
    reply: string;
    chat_id: string;
    scene_refs: number[];
    model_used: string;
}

interface MessagesApiResponse {
    chat_id: string;
    messages: Array<{
        role: string;
        content: string;
        scene_refs: number[];
        model_used?: string | null;
        created_at?: string | null;
    }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateModelId(model: string): string {
    // "anthropic/claude-3.5-sonnet" → "claude-3.5"
    // "google/gemma-3-12b-it:free" → "gemma-3"
    const slug = model.split("/").pop() ?? model;
    const base = slug.split(":")[0];
    return base.split("-").slice(0, 2).join("-");
}

let _msgCounter = 0;
function newId() {
    return `msg-${++_msgCounter}-${Date.now()}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TypingIndicator() {
    return (
        <div className="flex justify-start">
            <div className="rounded-lg px-4 py-3 bg-muted text-sm">
                <div className="flex gap-1 items-center h-4">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                </div>
            </div>
        </div>
    );
}

function MessageBubble({
    message,
    onSceneClick,
}: {
    message: ChatMessage;
    onSceneClick: (n: number) => void;
}) {
    const [modelExpanded, setModelExpanded] = useState(false);
    const isUser = message.role === "user";

    return (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[85%] space-y-1">
                <div
                    className={`rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap break-words leading-relaxed ${
                        isUser
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                    }`}
                >
                    {message.content}
                </div>

                {/* Scene ref chips */}
                {!isUser && message.scene_refs.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-1">
                        {message.scene_refs.map((n) => (
                            <button
                                key={n}
                                type="button"
                                onClick={() => onSceneClick(n)}
                                className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full hover:bg-primary/20 transition-colors"
                            >
                                Scene {n}
                            </button>
                        ))}
                    </div>
                )}

                {/* Model badge */}
                {!isUser && message.model_used && (
                    <div className="px-1">
                        <button
                            type="button"
                            onClick={() => setModelExpanded((v) => !v)}
                            title={message.model_used}
                            className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
                        >
                            {modelExpanded
                                ? message.model_used
                                : truncateModelId(message.model_used)}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ScriptChat({ scriptId, initialChatId, onAfterResponse, ref }: ScriptChatProps) {
    const router = useRouter();
    const pathname = usePathname();

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [chatId, setChatId] = useState<string | null>(initialChatId ?? null);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const bottomRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Load history when chat_id is available
    useEffect(() => {
        if (!chatId) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await api.get<MessagesApiResponse>(
                    `/scripts/${scriptId}/messages?chat_id=${encodeURIComponent(chatId)}`
                );
                if (cancelled) return;
                setMessages(
                    res.messages.map((m) => ({
                        id: newId(),
                        role: m.role as "user" | "assistant",
                        content: m.content,
                        scene_refs: m.scene_refs ?? [],
                        model_used: m.model_used ?? undefined,
                        timestamp: m.created_at ? new Date(m.created_at) : new Date(),
                    }))
                );
            } catch {
                // Fresh start — ignore 404 or network errors
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [scriptId, chatId]);

    // Persist chat_id in URL without triggering navigation
    useEffect(() => {
        if (!chatId) return;
        router.replace(`${pathname}?chat_id=${encodeURIComponent(chatId)}`, { scroll: false });
    }, [chatId, pathname, router]);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isLoading]);

    const sendMessage = useCallback(
        async (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || isLoading) return;

            setInputValue("");
            setError(null);
            textareaRef.current?.focus();

            const optimisticId = newId();
            const optimisticMsg: ChatMessage = {
                id: optimisticId,
                role: "user",
                content: trimmed,
                scene_refs: [],
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, optimisticMsg]);
            setIsLoading(true);

            try {
                const res = await api.post<ChatApiResponse>(
                    `/scripts/${scriptId}/chat`,
                    { message: trimmed, chat_id: chatId },
                    90_000
                );

                if (!chatId) setChatId(res.chat_id);

                setMessages((prev) => [
                    ...prev,
                    {
                        id: newId(),
                        role: "assistant",
                        content: res.reply,
                        scene_refs: res.scene_refs ?? [],
                        model_used: res.model_used,
                        timestamp: new Date(),
                    },
                ]);
                onAfterResponse?.();
            } catch (e) {
                setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
                setError(e instanceof Error ? e.message : "Failed to send message.");
            } finally {
                setIsLoading(false);
            }
        },
        [scriptId, chatId, isLoading, onAfterResponse]
    );

    useImperativeHandle(ref, () => ({ sendMessage }), [sendMessage]);

    const handleSceneClick = useCallback(
        (n: number) => {
            sendMessage(`Tell me more about scene ${n}`);
        },
        [sendMessage]
    );

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            sendMessage(inputValue);
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Message history */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
                {messages.length === 0 && !isLoading && (
                    <div className="h-full flex items-center justify-center text-center">
                        <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">
                                Ask anything about this script
                            </p>
                            <p className="text-xs text-muted-foreground/60">
                                Scene details, production decisions, scheduling…
                            </p>
                        </div>
                    </div>
                )}
                {messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} onSceneClick={handleSceneClick} />
                ))}
                {isLoading && <TypingIndicator />}
                {error && (
                    <p className="text-xs text-destructive px-1">{error}</p>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input area */}
            <div className="border-t p-3 shrink-0">
                <div className="flex gap-2 items-end">
                    <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isLoading}
                        placeholder="Ask about the script…"
                        rows={2}
                        className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <Button
                        type="button"
                        onClick={() => sendMessage(inputValue)}
                        disabled={isLoading || !inputValue.trim()}
                        size="sm"
                        className="shrink-0"
                    >
                        {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Send className="h-4 w-4" />
                        )}
                    </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/50 mt-1.5">
                    ⌘/Ctrl+Enter to send
                </p>
            </div>
        </div>
    );
}
