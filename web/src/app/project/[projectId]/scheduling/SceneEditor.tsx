"use client";

import React from "react";
import { Wand2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type {
  Scene,
  SceneCharacter,
  SceneWithCharacters,
  TimeOfDay,
} from "./types";

interface SceneEditorProps {
  data: SceneWithCharacters;
  timeOfDayOptions: TimeOfDay[];
  onUpdateLocal: (sceneId: string, updates: Partial<Scene>) => void;
  onSave: (sceneId: string, field: string, value: string | number | null) => void;
  onUpdateCharacterStatus: (
    sceneCharacterId: string,
    status: string | null
  ) => void;
  onUpdateCharacterNotes: (
    sceneCharacterId: string,
    notes: string
  ) => void;
  onLocalUpdateCharacter: (
    sceneCharacterId: string,
    updates: Partial<SceneCharacter>
  ) => void;
}

export function SceneEditor({
  data,
  timeOfDayOptions,
  onUpdateLocal,
  onSave,
  onUpdateCharacterStatus,
  onUpdateCharacterNotes,
  onLocalUpdateCharacter,
}: SceneEditorProps) {
  const { scene, characters } = data;

  return (
    <div className="space-y-4 px-4 pt-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Label
              htmlFor={`scene-location-${scene.id}`}
              className="mb-0"
            >
              Scene Location
            </Label>
            <button
              type="button"
              onClick={() => {
                const heading = scene.heading || "";
                const match = heading.match(
                  /^(?:INT\.|EXT\.|INT\/EXT|I\/E)\s*(.+?)(?:\s*[-./,]|$)/i
                );
                let extracted = "";
                if (match?.[1]) {
                  extracted = match[1].trim();
                } else {
                  extracted = heading
                    .replace(/^(?:INT\.|EXT\.|INT\/EXT|I\/E)\.?\s*/i, "")
                    .split(/[-./,]/)[0]
                    .trim();
                }
                if (extracted) {
                  const formatted = extracted
                    .toLowerCase()
                    .split(" ")
                    .map(
                      (word) =>
                        word.charAt(0).toUpperCase() + word.slice(1)
                    )
                    .join(" ");
                  onUpdateLocal(scene.id, { scene_location: formatted });
                  onSave(scene.id, "scene_location", formatted);
                }
              }}
              className="h-5 w-5 inline-flex items-center justify-center rounded-full hover:bg-accent text-primary/70 hover:text-primary transition-colors"
              title="Auto-populate from heading"
            >
              <Wand2 className="h-3 w-3" />
            </button>
          </div>
          <Input
            id={`scene-location-${scene.id}`}
            value={scene.scene_location || ""}
            onChange={(e) =>
              onUpdateLocal(scene.id, { scene_location: e.target.value })
            }
            onBlur={(e) =>
              onSave(scene.id, "scene_location", e.target.value)
            }
            placeholder="Enter scene location"
          />
        </div>

        <div>
          <Label htmlFor={`continuity-${scene.id}`}>Continuity Day</Label>
          <Input
            id={`continuity-${scene.id}`}
            type="number"
            value={scene.continuity_day ?? ""}
            onChange={(e) =>
              onUpdateLocal(scene.id, {
                continuity_day: e.target.value
                  ? parseInt(e.target.value, 10)
                  : null,
              })
            }
            onBlur={(e) =>
              onSave(
                scene.id,
                "continuity_day",
                e.target.value ? parseInt(e.target.value, 10) : null
              )
            }
            placeholder="Enter day number"
          />
        </div>

        <div>
          <Label htmlFor={`time-of-day-${scene.id}`}>Time of Day</Label>
          <Select
            value={scene.time_of_day_id || "none"}
            onValueChange={(value) =>
              onSave(
                scene.id,
                "time_of_day_id",
                value === "none" ? null : value
              )
            }
          >
            <SelectTrigger
              id={`time-of-day-${scene.id}`}
              className="bg-background"
            >
              <SelectValue placeholder="Select time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {timeOfDayOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor={`scene-details-${scene.id}`}>Scene Details</Label>
        <Textarea
          id={`scene-details-${scene.id}`}
          value={scene.scene_details || ""}
          onChange={(e) =>
            onUpdateLocal(scene.id, { scene_details: e.target.value })
          }
          onBlur={(e) =>
            onSave(scene.id, "scene_details", e.target.value)
          }
          placeholder="Enter scene details..."
          className="min-h-[100px] resize-y"
        />
      </div>

      {characters.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm mb-3">Characters:</h4>
          <div className="space-y-4">
            {characters.map((character) => {
              const sceneChar = scene.scene_characters?.find(
                (sc) => sc.character_id === character.id
              );
              if (!sceneChar) return null;
              return (
                <div
                  key={character.id}
                  className="border rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="px-3 py-1">
                      {character.name}
                    </Badge>
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`status-${sceneChar.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Status:
                      </Label>
                      <Select
                        value={sceneChar.status || "none"}
                        onValueChange={(value) =>
                          onUpdateCharacterStatus(
                            sceneChar.id,
                            value === "none" ? null : value
                          )
                        }
                      >
                        <SelectTrigger
                          id={`status-${sceneChar.id}`}
                          className="w-24 h-8 text-xs bg-background"
                        >
                          <SelectValue placeholder="IN/OUT" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">-</SelectItem>
                          <SelectItem value="IN">IN</SelectItem>
                          <SelectItem value="OUT">OUT</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label
                      htmlFor={`notes-${sceneChar.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Additional Information:
                    </Label>
                    <Textarea
                      id={`notes-${sceneChar.id}`}
                      rows={1}
                      value={sceneChar.notes || ""}
                      onChange={(e) =>
                        onLocalUpdateCharacter(sceneChar.id, {
                          notes: e.target.value,
                        })
                      }
                      onBlur={(e) =>
                        onUpdateCharacterNotes(sceneChar.id, e.target.value)
                      }
                      placeholder="Add notes..."
                      className="mt-1 text-xs flex w-full rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y min-h-[2rem]"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
