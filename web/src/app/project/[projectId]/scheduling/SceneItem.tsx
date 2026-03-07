"use client";

import React from "react";
import { CalendarClock, Film, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import type {
  Scene,
  SceneCharacter,
  SceneWithCharacters,
  TimeOfDay,
} from "./types";
import { SceneEditor } from "./SceneEditor";

interface SceneItemProps {
  data: SceneWithCharacters;
  index: number;
  timeOfDayOptions: TimeOfDay[];
  sceneCost?: number;
  getTramlineColor: (day: string | null) => string;
  getTimeOfDayName: (
    id: string | null | undefined
  ) => string | null;
  formatCurrency: (value: number) => string;
  onUpdateLocal: (sceneId: string, updates: Partial<Scene>) => void;
  onSave: (
    sceneId: string,
    field: string,
    value: string | number | null
  ) => void;
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
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

export function SceneItem({
  data,
  index,
  timeOfDayOptions,
  sceneCost,
  getTramlineColor,
  getTimeOfDayName,
  formatCurrency,
  onUpdateLocal,
  onSave,
  onUpdateCharacterStatus,
  onUpdateCharacterNotes,
  onLocalUpdateCharacter,
  isSelected = false,
  onToggleSelect,
}: SceneItemProps) {
  const { scene, characters } = data;

  return (
    <AccordionItem value={scene.id} className="border rounded-lg">
      <AccordionTrigger className="hover:no-underline px-4">
        <div className="flex items-center w-full gap-3">
          {onToggleSelect && (
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggleSelect();
                }
              }}
              className="p-1 cursor-pointer hover:bg-muted rounded-full transition-colors"
            >
              <Star
                className={`h-5 w-5 ${
                  isSelected
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-muted-foreground hover:text-yellow-400"
                }`}
              />
            </div>
          )}

          <div
            className={`w-1 h-12 rounded ${getTramlineColor(
              scene.shooting_day ?? null
            )}`}
          />

          <div className="flex flex-col flex-1 gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-left">
                <CalendarClock className="h-4 w-4 text-primary flex-shrink-0" />
                <div>
                  <div className="font-semibold">
                    Scene {index + 1}: {scene.heading}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {scene.location_details}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {scene.shooting_day && (
                  <Badge variant="secondary" className="text-xs">
                    {scene.shooting_day}
                  </Badge>
                )}
                {scene.continuity_day != null && (
                  <Badge variant="outline" className="text-xs">
                    <Film className="h-3 w-3 mr-1" />
                    Day {scene.continuity_day}
                  </Badge>
                )}
                {getTimeOfDayName(scene.time_of_day_id) && (
                  <Badge variant="outline" className="text-xs">
                    {getTimeOfDayName(scene.time_of_day_id)}
                  </Badge>
                )}
                {scene.length_in_eighths != null && (
                  <Badge variant="outline" className="text-xs">
                    {scene.length_in_eighths >= 8
                      ? `${Math.floor(scene.length_in_eighths / 8)} pg ${scene.length_in_eighths % 8}/8`
                      : `${scene.length_in_eighths}/8 pg`}
                  </Badge>
                )}
                {sceneCost !== undefined && sceneCost > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-xs bg-blue-600 text-white dark:bg-blue-500 dark:text-white"
                  >
                    {formatCurrency(sceneCost)}
                  </Badge>
                )}
              </div>
            </div>
            {characters.length > 0 && (
              <div className="flex flex-wrap gap-1 ml-7">
                {characters.map((character) => {
                  const sceneChar = scene.scene_characters?.find(
                    (sc) => sc.character_id === character.id
                  );
                  return (
                    <span
                      key={character.id}
                      className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs flex items-center gap-1"
                    >
                      {sceneChar?.status && (
                        <span className="font-bold text-[10px] uppercase opacity-70">
                          {sceneChar.status}:
                        </span>
                      )}
                      {character.name}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <SceneEditor
          data={data}
          timeOfDayOptions={timeOfDayOptions}
          onUpdateLocal={onUpdateLocal}
          onSave={onSave}
          onUpdateCharacterStatus={onUpdateCharacterStatus}
          onUpdateCharacterNotes={onUpdateCharacterNotes}
          onLocalUpdateCharacter={onLocalUpdateCharacter}
        />
      </AccordionContent>
    </AccordionItem>
  );
}
