"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw } from "lucide-react";

// ── Data types ────────────────────────────────────────────────────────────────

interface RiskEntry {
    score: number;
    rationale?: string | null;
}

interface RiskScores {
    schedule?: RiskEntry | null;
    budget?: RiskEntry | null;
    vfx?: RiskEntry | null;
    stunt?: RiskEntry | null;
    location?: RiskEntry | null;
}

interface ActEntry {
    act?: string | null;
    scene_range?: [number, number] | null;
    page_range?: [number, number] | null;
    turning_point?: string | null;
}

interface LocationEntry {
    name?: string | null;
    location_type?: string | null;
    scenes?: number[];
}

interface CastSizeByType {
    principal?: number | null;
    supporting?: number | null;
    voice?: number | null;
    entity?: number | null;
    crowd?: number | null;
}

interface ProductionMetrics {
    estimated_shooting_days?: number | null;
    cast_size_by_type?: CastSizeByType | null;
    night_shoot_count?: number | null;
}

export interface ScriptAnalysis {
    script_id?: string;
    act_structure?: { acts?: ActEntry[] | null } | null;
    location_map?: { locations?: LocationEntry[] | null } | null;
    cast_summary?: { characters?: { name: string; character_type?: string }[] | null } | null;
    risk_scores?: RiskScores | null;
    production_metrics?: ProductionMetrics | null;
    analysed_at?: string | null;
    model_used?: string | null;
}

export interface ScriptAnalysisPanelProps {
    scriptId: string;
    analysis: ScriptAnalysis | null;
    onReanalyse: () => void;
    isReanalysing: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RISK_LABELS: Array<{ key: keyof RiskScores; label: string }> = [
    { key: "schedule", label: "Schedule" },
    { key: "budget", label: "Budget" },
    { key: "vfx", label: "VFX" },
    { key: "stunt", label: "Stunt" },
    { key: "location", label: "Location" },
];

function scoreBarColor(score: number): string {
    if (score <= 3) return "bg-green-500";
    if (score <= 6) return "bg-amber-500";
    return "bg-red-500";
}

function scoreTextColor(score: number): string {
    if (score <= 3) return "text-green-600 dark:text-green-400";
    if (score <= 6) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
}

function actLabel(act?: string | null): string {
    if (!act) return "Act";
    const n = parseInt(act, 10);
    if (!isNaN(n)) return `Act ${n}`;
    const words: Record<string, string> = { one: "I", two: "II", three: "III", four: "IV" };
    return `Act ${words[act.toLowerCase()] ?? act}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScriptAnalysisPanel({
    analysis,
    onReanalyse,
    isReanalysing,
}: ScriptAnalysisPanelProps) {
    const riskScores = analysis?.risk_scores;
    const acts = analysis?.act_structure?.acts ?? [];
    const locations = analysis?.location_map?.locations ?? [];
    const metrics = analysis?.production_metrics;

    // INT/EXT ratio derived from location_map
    const intCount = locations.filter((l) => l.location_type === "INT").length;
    const extCount = locations.filter((l) => l.location_type === "EXT").length;

    // Act timeline proportions
    const allSceneEnds = acts.map((a) => a.scene_range?.[1] ?? 0);
    const totalScenes = allSceneEnds.length > 0 ? Math.max(...allSceneEnds) : 0;

    // ── No analysis state ──────────────────────────────────────────────────────
    if (!analysis) {
        return (
            <Card>
                <CardContent className="py-8 flex flex-col items-center gap-4 text-center">
                    <p className="text-sm text-muted-foreground">No analysis yet</p>
                    <Button onClick={onReanalyse} disabled={isReanalysing} size="sm">
                        {isReanalysing ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Analysing…
                            </>
                        ) : (
                            "Analyse script"
                        )}
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-3">
            {/* ── Risk scores ─────────────────────────────────────────────────── */}
            {riskScores && (
                <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Risk Scores
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-3">
                        {RISK_LABELS.map(({ key, label }) => {
                            const entry = riskScores[key];
                            if (!entry) return null;
                            const score = entry.score ?? 0;
                            return (
                                <div key={key}>
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-xs font-medium">{label}</span>
                                        <span className={`text-xs font-semibold ${scoreTextColor(score)}`}>
                                            {score}/10
                                        </span>
                                    </div>
                                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full ${scoreBarColor(score)}`}
                                            style={{ width: `${(score / 10) * 100}%` }}
                                        />
                                    </div>
                                    {entry.rationale && (
                                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                                            {entry.rationale}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </CardContent>
                </Card>
            )}

            {/* ── Production metrics ──────────────────────────────────────────── */}
            {metrics && (
                <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Production Metrics
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            {metrics.estimated_shooting_days != null && (
                                <div>
                                    <p className="text-base font-bold">{metrics.estimated_shooting_days}</p>
                                    <p className="text-[11px] text-muted-foreground">Shoot days</p>
                                </div>
                            )}
                            {locations.length > 0 && (
                                <div>
                                    <p className="text-base font-bold">{locations.length}</p>
                                    <p className="text-[11px] text-muted-foreground">Locations</p>
                                </div>
                            )}
                            {(intCount > 0 || extCount > 0) && (
                                <div>
                                    <p className="text-base font-bold">
                                        {intCount}/{extCount}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">INT/EXT</p>
                                </div>
                            )}
                            {metrics.night_shoot_count != null && (
                                <div>
                                    <p className="text-base font-bold">{metrics.night_shoot_count}</p>
                                    <p className="text-[11px] text-muted-foreground">Night shoots</p>
                                </div>
                            )}
                        </div>
                        {metrics.cast_size_by_type && (
                            <div className="mt-3 pt-3 border-t border-border/40">
                                <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                                    Cast breakdown
                                </p>
                                <div className="flex flex-wrap gap-x-3 gap-y-1">
                                    {(
                                        [
                                            ["principal", "Principal"],
                                            ["supporting", "Supporting"],
                                            ["voice", "Voice"],
                                            ["entity", "Entity"],
                                            ["crowd", "Crowd"],
                                        ] as const
                                    ).map(([k, label]) => {
                                        const val = metrics.cast_size_by_type?.[k];
                                        if (!val) return null;
                                        return (
                                            <span key={k} className="text-[11px] text-muted-foreground">
                                                <span className="font-semibold text-foreground">{val}</span>{" "}
                                                {label}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ── Act structure ────────────────────────────────────────────────── */}
            {acts.length > 0 && (
                <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Act Structure
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                        {/* Proportional horizontal bar */}
                        {totalScenes > 0 && (
                            <div className="flex h-2 w-full rounded-full overflow-hidden mb-3 gap-px">
                                {acts.map((act, i) => {
                                    const start = act.scene_range?.[0] ?? 1;
                                    const end = act.scene_range?.[1] ?? start;
                                    const width = ((end - start + 1) / totalScenes) * 100;
                                    const colors = [
                                        "bg-primary/70",
                                        "bg-primary/45",
                                        "bg-primary/25",
                                        "bg-primary/15",
                                    ];
                                    return (
                                        <div
                                            key={i}
                                            className={`h-full ${colors[i % colors.length]}`}
                                            style={{ width: `${width}%` }}
                                        />
                                    );
                                })}
                            </div>
                        )}
                        <div className="space-y-2">
                            {acts.map((act, i) => (
                                <div key={i} className="flex items-start gap-2">
                                    <span className="text-[11px] font-semibold text-foreground shrink-0 w-14">
                                        {actLabel(act.act)}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        {act.scene_range && (
                                            <span className="text-[11px] text-muted-foreground mr-2">
                                                Sc {act.scene_range[0]}–{act.scene_range[1]}
                                            </span>
                                        )}
                                        {act.turning_point && (
                                            <span className="text-[11px] text-muted-foreground leading-snug">
                                                {act.turning_point}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ── Re-analyse button ────────────────────────────────────────────── */}
            <div className="pt-1">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onReanalyse}
                    disabled={isReanalysing}
                    className="w-full text-muted-foreground hover:text-foreground text-xs"
                >
                    {isReanalysing ? (
                        <>
                            <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                            Re-analysing…
                        </>
                    ) : (
                        <>
                            <RefreshCw className="h-3 w-3 mr-1.5" />
                            Re-analyse script
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}
