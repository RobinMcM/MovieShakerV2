"use client";

import { useRef, useState } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { api } from "@/lib/api";

const CANVAS_W = 320;
const CANVAS_H = 180;
const GROUND_Y = 152;

interface BlockingCharacter {
    name: string;
    x: number;
    y: number;
    scale: number;
    color: string;
    flip: boolean;
    // Resolved at generate time; carried through on adjust so Pass 2 has the GUID without re-lookup
    character_id?: string | null;
    character_image_url?: string | null;
}

interface BlockingData {
    mode: string;
    shot_type: string;
    line_label: string;
    characters: BlockingCharacter[];
    svg_content: string;
}

interface BlockingResult {
    line_number: string;
    composition_id: string;
    characters: BlockingCharacter[];
}

export interface BlockingDiagramProps {
    scriptId: string;
    sceneNumber: number;
    lineLabel: string;
    initialData?: BlockingData | null;
    onUpdated?: (result: BlockingResult) => void;
}

export function BlockingDiagram({
    scriptId,
    sceneNumber,
    lineLabel,
    initialData,
    onUpdated,
}: BlockingDiagramProps) {
    const [data, setData] = useState<BlockingData | null>(initialData ?? null);
    const [chars, setChars] = useState<BlockingCharacter[]>(initialData?.characters ?? []);
    const [generating, setGenerating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragging = useRef<{
        idx: number;
        startX: number;
        startY: number;
        origX: number;
        origY: number;
    } | null>(null);

    async function handleGenerate() {
        setGenerating(true);
        setError(null);
        try {
            const res = await api.post<BlockingResult & { svg_content?: string }>(
                `scripts/${scriptId}/scenes/${sceneNumber}/shots/${lineLabel}/blocking-diagram`,
                {}
            );
            // Re-fetch full composition data after generation
            const newChars = res.characters ?? [];
            setChars(newChars);
            // The backend doesn't return svg_content directly in this response,
            // so we regenerate it by calling the endpoint which upserts the composition.
            // The moodboard page will reload compositions; here we update local state.
            setData((prev) => ({
                mode: "blocking",
                shot_type: prev?.shot_type ?? "",
                line_label: lineLabel,
                characters: newChars,
                svg_content: res.svg_content ?? prev?.svg_content ?? "",
            }));
            onUpdated?.(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Generation failed");
        } finally {
            setGenerating(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        setError(null);
        try {
            const res = await api.post<BlockingResult & { svg_content?: string }>(
                `scripts/${scriptId}/scenes/${sceneNumber}/shots/${lineLabel}/adjust-blocking`,
                { positions: chars }
            );
            if (res.svg_content) {
                setData((prev) => prev ? { ...prev, svg_content: res.svg_content!, characters: res.characters } : null);
            }
            setChars(res.characters);
            setDirty(false);
            onUpdated?.(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Save failed");
        } finally {
            setSaving(false);
        }
    }

    function onPointerDown(idx: number, e: React.PointerEvent) {
        e.preventDefault();
        if (!containerRef.current) return;
        dragging.current = {
            idx,
            startX: e.clientX,
            startY: e.clientY,
            origX: chars[idx].x,
            origY: chars[idx].y,
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: React.PointerEvent) {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const scaleX = CANVAS_W / rect.width;
        const scaleY = CANVAS_H / rect.height;
        const dx = (e.clientX - dragging.current.startX) * scaleX;
        const dy = (e.clientY - dragging.current.startY) * scaleY;
        const newX = Math.max(10, Math.min(CANVAS_W - 10, dragging.current.origX + dx));
        const newY = Math.max(20, Math.min(GROUND_Y, dragging.current.origY + dy));
        const idx = dragging.current.idx;
        setChars((prev) =>
            prev.map((c, i) =>
                i === idx ? { ...c, x: Math.round(newX), y: Math.round(newY) } : c
            )
        );
    }

    function onPointerUp() {
        if (dragging.current) setDirty(true);
        dragging.current = null;
    }

    if (!data) {
        return (
            <div className="flex flex-col items-center gap-3 p-6 border border-dashed rounded-lg bg-muted/10">
                <p className="text-sm text-muted-foreground">No blocking diagram yet.</p>
                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating}
                    className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
                >
                    {generating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <RefreshCw className="h-4 w-4" />
                    )}
                    {generating ? "Generating..." : "Generate blocking diagram"}
                </button>
                {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* SVG diagram with draggable character handles */}
            <div
                ref={containerRef}
                className="relative w-full rounded-lg overflow-hidden border border-border bg-[#0f0f1a] select-none"
                style={{ aspectRatio: "16/9" }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
            >
                {data.svg_content && (
                    <div
                        className="w-full h-full pointer-events-none [&>svg]:w-full [&>svg]:h-full"
                        // SVG is engine-generated, not user input
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: data.svg_content }}
                    />
                )}
                {/* Draggable handles at character foot positions */}
                {chars.map((char, idx) => (
                    <div
                        key={`${char.name}-${idx}`}
                        className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10 touch-none"
                        style={{
                            left: `${(char.x / CANVAS_W) * 100}%`,
                            top: `${(char.y / CANVAS_H) * 100}%`,
                        }}
                        onPointerDown={(e) => onPointerDown(idx, e)}
                        title={`Drag to reposition ${char.name}`}
                    >
                        <div
                            className="w-4 h-4 rounded-full border-2 border-white/80 shadow-lg"
                            style={{ backgroundColor: char.color }}
                        />
                    </div>
                ))}
            </div>

            {/* Character colour legend */}
            <div className="flex flex-wrap gap-2 px-1">
                {chars.map((char, idx) => (
                    <span
                        key={`${char.name}-${idx}`}
                        className="text-xs px-2 py-0.5 rounded-full border"
                        style={{ borderColor: char.color, color: char.color }}
                    >
                        {char.name}
                    </span>
                ))}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2 flex-wrap">
                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating || saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs hover:bg-accent disabled:opacity-50 transition-colors"
                >
                    {generating ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <RefreshCw className="h-3 w-3" />
                    )}
                    Regenerate
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || generating}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs disabled:opacity-50 transition-colors ${
                        dirty
                            ? "bg-amber-500 hover:bg-amber-600 text-white"
                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                    }`}
                >
                    {saving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <Save className="h-3 w-3" />
                    )}
                    {saving ? "Saving..." : dirty ? "Save positions*" : "Save positions"}
                </button>
                {dirty && !saving && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                        Positions moved — save to apply
                    </span>
                )}
                {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
        </div>
    );
}
