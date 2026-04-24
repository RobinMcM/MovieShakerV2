import type { RefObject } from "react";
import { api } from "@/lib/api";
import { findAvailableXPosition } from "@/app/project/[projectId]/shotlist/useShotList";
import { matchTextToElements } from "@/lib/scriptJsonUtils";
import type { ScriptElement } from "@/lib/scriptJsonUtils";
import type { TramLine } from "@/app/project/[projectId]/shotlist/types";

export interface ShotSuggestion {
  line_number: string;
  color: string;
  shot_type: string;
  camera_direction: string;
  start_element_text: string;
  end_element_text: string;
  rationale: string;
  is_insert: boolean;
  overlaps: string[];
}

interface TramLineRow {
  id: string;
  scene_id: string;
  line_number: string;
  color: string;
  start_y: number;
  end_y: number;
  x_position: number;
  camera_direction: string;
  shot_type?: string;
}

function normalise(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/…/g, "...")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .toLowerCase();
}

function extractTextBetweenElements(
  container: HTMLElement,
  startEl: Element,
  endEl: Element
): { actionText: string; characterNames: string } {
  const allLineEls = Array.from(container.querySelectorAll("[data-line-text]"));
  const startIdx = allLineEls.indexOf(startEl);
  const endIdx = allLineEls.indexOf(endEl);

  if (startIdx === -1) return { actionText: "", characterNames: "" };

  const from = startIdx;
  const to = endIdx === -1 ? startIdx : Math.max(startIdx, endIdx);

  const texts: string[] = [];
  const charNames = new Set<string>();

  for (let i = from; i <= to; i++) {
    const text = allLineEls[i].getAttribute("data-line-text") ?? "";
    if (text.length > 0) {
      texts.push(text);
      if (
        text === text.toUpperCase() &&
        text.length < 40 &&
        !text.startsWith("INT.") &&
        !text.startsWith("EXT.") &&
        !text.includes("CUT TO") &&
        !text.includes("FADE")
      ) {
        charNames.add(text);
      }
    }
  }

  return {
    actionText: texts.join("\n"),
    characterNames: Array.from(charNames).join(", "),
  };
}

export async function placeSuggestedShots(
  suggestions: ShotSuggestion[],
  containerRef: RefObject<HTMLElement | null>,
  sceneId: string,
  // scriptId is kept in signature for API symmetry but not sent to POST /api/tram-lines
  // (engine CreateTramLineBody does not accept script_id)
  _scriptId: string,
  existingLines: TramLine[],
  scriptElements: ScriptElement[],
  onLineCreated: (line: TramLine) => void
): Promise<{ placed: number; skipped: number }> {
  if (!containerRef.current) return { placed: 0, skipped: suggestions.length };

  const container = containerRef.current;
  const containerRect = container.getBoundingClientRect();
  const scrollHeight = container.scrollHeight;
  const scrollTop = container.scrollTop;

  let placed = 0;
  let skipped = 0;
  const batchLines: TramLine[] = [];

  for (const suggestion of suggestions) {
    const allLineEls = Array.from(container.querySelectorAll("[data-line-text]"));
    const normStart = normalise(suggestion.start_element_text);

    let startEl: Element | null = null;
    for (const el of allLineEls) {
      const attr = normalise(el.getAttribute("data-line-text") ?? "");
      if (attr.startsWith(normStart)) {
        startEl = el;
        break;
      }
    }

    if (!startEl) {
      console.warn(
        "[placeSuggestedShots] start element not found:",
        suggestion.start_element_text
      );
      skipped++;
      continue;
    }

    const normEnd = normalise(suggestion.end_element_text);
    let endEl: Element | null = null;
    for (const el of allLineEls) {
      const attr = normalise(el.getAttribute("data-line-text") ?? "");
      if (attr.startsWith(normEnd)) {
        endEl = el;
        break;
      }
    }
    if (!endEl) endEl = startEl;

    const startRect = startEl.getBoundingClientRect();
    const endRect = endEl.getBoundingClientRect();

    const startY = Math.max(
      0,
      Math.min(
        100,
        ((startRect.top - containerRect.top + scrollTop) / scrollHeight) * 100
      )
    );
    const endY = Math.max(
      0,
      Math.min(
        100,
        ((endRect.bottom - containerRect.top + scrollTop) / scrollHeight) * 100
      )
    );

    const allLines = [...existingLines, ...batchLines];
    const xPosition = findAvailableXPosition(startY, endY, allLines);

    try {
      const res = await api.post<{ success: boolean; tramLine: TramLineRow }>(
        "api/tram-lines",
        {
          scene_id: sceneId,
          line_number: suggestion.line_number,
          color: suggestion.color,
          start_y: startY,
          end_y: endY,
          x_position: xPosition,
          camera_direction: suggestion.camera_direction,
          shot_type: suggestion.shot_type,
        }
      );

      const row = (res as { tramLine?: TramLineRow }).tramLine;
      if (!row) throw new Error("No tramLine in response");

      const newLine: TramLine = {
        id: row.id,
        sceneId: row.scene_id,
        lineNumber: row.line_number,
        color: row.color,
        startY: Number(row.start_y),
        endY: Number(row.end_y),
        xPosition: Number(row.x_position),
        cameraDirection: row.camera_direction ?? "",
        shotType: row.shot_type,
      };

      const { actionText, characterNames } = extractTextBetweenElements(
        container,
        startEl,
        endEl
      );
      if (actionText && scriptElements.length > 0) {
        const structured = matchTextToElements(actionText, scriptElements);
        if (structured.length > 0) {
          await api.put(`api/tram-lines/${newLine.id}`, {
            script_elements: structured,
            character_names: characterNames || undefined,
          });
        }
      }

      batchLines.push(newLine);
      onLineCreated(newLine);
      placed++;
    } catch (err) {
      console.error(
        "[placeSuggestedShots] failed to create line:",
        suggestion.line_number,
        err
      );
      skipped++;
    }
  }

  return { placed, skipped };
}
