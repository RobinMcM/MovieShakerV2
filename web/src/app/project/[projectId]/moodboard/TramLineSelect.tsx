"use client";

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TramLineWithScene } from "./types";

interface TramLineSelectProps {
  tramLines: TramLineWithScene[];
  selectedTramLineId: string | null;
  onSelect: (id: string) => void;
}

function getSceneNumber(tramLine: TramLineWithScene): string | number {
  return tramLine.scenes?.scene_number ?? "?";
}

export function TramLineSelect({
  tramLines,
  selectedTramLineId,
  onSelect,
}: TramLineSelectProps) {
  const sortedTramLines = useMemo(() => {
    if (!tramLines.length) return [];
    return [...tramLines].sort((a, b) => {
      const sceneA = a.scenes?.scene_number ?? 0;
      const sceneB = b.scenes?.scene_number ?? 0;
      if (sceneA !== sceneB) return Number(sceneA) - Number(sceneB);
      return (a.line_number || "").localeCompare(b.line_number || "", undefined, {
        numeric: true,
      });
    });
  }, [tramLines]);

  return (
    <Select
      value={selectedTramLineId ?? ""}
      onValueChange={onSelect}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a Tram Line..." />
      </SelectTrigger>
      <SelectContent>
        {sortedTramLines.map((tramLine) => (
          <SelectItem key={tramLine.id} value={tramLine.id}>
            <span className="font-semibold mr-2 text-primary">
              Scene {getSceneNumber(tramLine)}
            </span>
            <span className="mr-2 text-muted-foreground opacity-50">-</span>
            <span className="mr-2 font-medium">
              {tramLine.scenes?.heading ?? "Unknown"}
            </span>
            <span className="mr-2 border-l pl-2 border-border/50 font-mono text-muted-foreground">
              Shot {tramLine.line_number}
            </span>
            <span className="text-muted-foreground ml-auto pl-2 text-xs opacity-70 italic">
              {tramLine.camera_direction ?? ""} {tramLine.shot_type ?? ""}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
