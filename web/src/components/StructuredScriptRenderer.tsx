"use client";

import type { ScriptElement } from "@/lib/scriptJsonUtils";

interface StructuredScriptRendererProps {
  elements: ScriptElement[];
}

export function StructuredScriptRenderer({
  elements,
}: StructuredScriptRendererProps) {
  if (!elements || elements.length === 0) {
    return (
      <p className="text-muted-foreground italic">
        No script content available for this shot.
      </p>
    );
  }

  const getElementStyle = (type: ScriptElement["type"]): string => {
    switch (type) {
      case "scene_heading":
        return "font-bold uppercase mt-4 mb-2 text-left";
      case "action":
        return "text-left max-w-full my-2";
      case "character":
        return "text-center font-bold mt-4 mb-0 mx-auto w-2/3";
      case "dialogue":
        return "text-center mx-auto w-3/4 mb-1";
      case "parenthetical":
        return "text-center mx-auto w-1/2 -mt-1 mb-0";
      case "transition":
        return "text-right font-bold uppercase mt-4 mb-2 ml-auto w-1/3";
      case "shot":
        return "text-left font-bold uppercase my-2";
      case "page_number":
        return "text-center text-muted-foreground text-xs my-4";
      default:
        return "text-left max-w-full my-2";
    }
  };

  return (
    <div className="font-courier text-sm leading-relaxed text-foreground select-text">
      <style>{`
        .font-courier { font-family: 'Courier Prime', 'Courier New', Courier, monospace; }
      `}</style>
      {elements.map((el, idx) => {
        const styleClass = getElementStyle(el.type);
        return (
          <div key={el.element_id ?? idx} className={styleClass}>
            {el.text}
          </div>
        );
      })}
    </div>
  );
}
