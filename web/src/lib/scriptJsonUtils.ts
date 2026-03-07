/**
 * Utility functions for manipulating script JSON with tramline metadata
 */

export interface ScriptElement {
  type:
    | "scene_heading"
    | "action"
    | "character"
    | "dialogue"
    | "parenthetical"
    | "transition"
    | "general"
    | "shot"
    | "page_number";
  text: string;
  element_id?: string;
}

/**
 * Ensure all elements have unique element_id
 */
export function ensureElementIds(
  elements: ScriptElement[]
): ScriptElement[] {
  return elements.map((el, idx) => ({
    ...el,
    element_id: el.element_id || `elem-${idx}`,
  }));
}

/**
 * Match scraped text to JSON elements
 * Takes DOM-scraped text and finds corresponding elements in the script JSON
 */
export function matchTextToElements(
  scrapedText: string,
  scriptElements: ScriptElement[]
): ScriptElement[] {
  if (!scrapedText || !scriptElements || scriptElements.length === 0) {
    return [];
  }

  const matchedElements: ScriptElement[] = [];
  const lines = scrapedText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const usedIndices = new Set<number>();

  for (const line of lines) {
    const normalizedLine = line.replace(/\s+/g, " ").trim();

    const elementIndex = scriptElements.findIndex((el, idx) => {
      if (usedIndices.has(idx)) return false;
      const normalizedElementText = el.text.replace(/\s+/g, " ").trim();
      return normalizedElementText === normalizedLine;
    });

    if (elementIndex !== -1) {
      const element = scriptElements[elementIndex];

      if (element.type === "page_number") {
        usedIndices.add(elementIndex);
        continue;
      }

      let cleanedText = element.text;
      if (element.type === "character") {
        cleanedText = element.text
          .replace(/\s*\(CONT'D\)\s*$/i, "")
          .trim();
      }

      matchedElements.push({
        type: element.type,
        text: cleanedText,
        element_id: element.element_id,
      });
      usedIndices.add(elementIndex);
    }
  }

  return matchedElements;
}
