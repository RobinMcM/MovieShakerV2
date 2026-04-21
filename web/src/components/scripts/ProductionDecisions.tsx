"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DecisionItem {
    decision_type: string;
    summary: string;
    detail?: string | null;
    scene_refs?: number[] | null;
    created_at?: string | null;
}

interface DecisionsApiResponse {
    script_id: string;
    decisions: Record<string, DecisionItem[]>;
    total: number;
}

export interface ProductionDecisionsProps {
    scriptId: string;
    refreshTrigger: number;
    onReconsider: (summary: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DECISION_ORDER = ["location", "cast", "schedule", "budget", "creative"] as const;

const DECISION_LABELS: Record<string, string> = {
    location: "Location",
    cast: "Cast",
    schedule: "Schedule",
    budget: "Budget",
    creative: "Creative",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "";
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DecisionRow({
    item,
    onReconsider,
}: {
    item: DecisionItem;
    onReconsider: (summary: string) => void;
}) {
    const [detailOpen, setDetailOpen] = useState(false);

    return (
        <div className="py-2.5 border-b border-border/40 last:border-0 space-y-1.5">
            <p className="text-sm leading-snug">{item.summary}</p>

            {item.detail && (
                <div>
                    <button
                        type="button"
                        onClick={() => setDetailOpen((v) => !v)}
                        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                        {detailOpen ? "Hide detail ↑" : "Show detail ↓"}
                    </button>
                    {detailOpen && (
                        <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                            {item.detail}
                        </p>
                    )}
                </div>
            )}

            {item.scene_refs && item.scene_refs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {item.scene_refs.map((n) => (
                        <span
                            key={n}
                            className="px-1.5 py-0.5 bg-muted text-muted-foreground text-[10px] rounded"
                        >
                            Sc.{n}
                        </span>
                    ))}
                </div>
            )}

            <div className="flex items-center justify-between pt-0.5">
                {item.created_at ? (
                    <span className="text-[10px] text-muted-foreground/50">
                        {relativeTime(item.created_at)}
                    </span>
                ) : (
                    <span />
                )}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onReconsider(item.summary)}
                    className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground -mr-1"
                >
                    Reconsider
                </Button>
            </div>
        </div>
    );
}

function DecisionGroup({
    type,
    items,
    onReconsider,
}: {
    type: string;
    items: DecisionItem[];
    onReconsider: (summary: string) => void;
}) {
    const [open, setOpen] = useState(true);
    const label = DECISION_LABELS[type] ?? type;

    return (
        <div>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between py-1.5 text-left"
            >
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {label}
                </span>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground/60">{items.length}</span>
                    {open ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
                    ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                    )}
                </div>
            </button>
            {open && (
                <div className="pl-1">
                    {items.map((item, i) => (
                        <DecisionRow key={i} item={item} onReconsider={onReconsider} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProductionDecisions({
    scriptId,
    refreshTrigger,
    onReconsider,
}: ProductionDecisionsProps) {
    const [decisions, setDecisions] = useState<Record<string, DecisionItem[]>>({});
    const [total, setTotal] = useState(0);
    const [collapsed, setCollapsed] = useState(false);

    const fetchDecisions = useCallback(async () => {
        try {
            const res = await api.get<DecisionsApiResponse>(`/scripts/${scriptId}/decisions`);
            setDecisions(res.decisions ?? {});
            setTotal(res.total ?? 0);
        } catch {
            // Silently skip — decisions panel is non-critical
        }
    }, [scriptId]);

    useEffect(() => {
        fetchDecisions();
    }, [fetchDecisions, refreshTrigger]);

    const activeGroups = DECISION_ORDER.filter(
        (t) => (decisions[t]?.length ?? 0) > 0
    );

    return (
        <Card>
            {/* Header */}
            <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Production decisions
                        </CardTitle>
                        {total > 0 && (
                            <span className="text-[10px] font-semibold bg-primary/10 text-primary rounded-full px-1.5 py-0.5">
                                {total}
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => setCollapsed((v) => !v)}
                        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        title={collapsed ? "Expand" : "Collapse"}
                    >
                        {collapsed ? (
                            <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                        )}
                    </button>
                </div>
            </CardHeader>

            {!collapsed && (
                <CardContent className="px-4 pb-4">
                    {activeGroups.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground leading-snug">
                            Decisions made during chat will appear here.
                        </p>
                    ) : (
                        <div className="space-y-1 divide-y divide-border/30">
                            {activeGroups.map((type) => (
                                <DecisionGroup
                                    key={type}
                                    type={type}
                                    items={decisions[type]}
                                    onReconsider={onReconsider}
                                />
                            ))}
                        </div>
                    )}
                </CardContent>
            )}
        </Card>
    );
}
