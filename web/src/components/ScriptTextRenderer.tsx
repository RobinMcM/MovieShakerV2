"use client";

export function ScriptTextRenderer({ text }: { text: string }) {
  if (!text) {
    return (
      <p className="text-muted-foreground italic">
        No script content available for this shot.
      </p>
    );
  }

  const lines = text.split("\n");
  let previousType = "action";

  return (
    <div className="font-courier text-sm leading-relaxed text-foreground select-text">
      <style>{`
        .font-courier { font-family: 'Courier Prime', 'Courier New', Courier, monospace; }
      `}</style>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        let type = "action";
        let styleClass = "text-left max-w-full my-2";

        if (
          trimmed.includes("(MORE)") ||
          trimmed.includes("(CONT'D)") ||
          /^\d+\.$/.test(trimmed) ||
          /^\d+$/.test(trimmed)
        ) {
          return null;
        }

        if (!trimmed) {
          previousType = "action";
          return <div key={i} className="h-4" />;
        }

        if (/^(INT\.|EXT\.|I\/E|INT\/EXT)/i.test(trimmed)) {
          type = "scene_heading";
          styleClass = "font-bold uppercase mt-4 mb-2 text-left";
        } else if (/^PAGE \d+/i.test(trimmed) || /^INSERT/i.test(trimmed)) {
          styleClass = "text-left font-bold mt-2 mb-2";
        } else if (
          /^[A-Z][A-Z0-9\s\W]*$/.test(trimmed) &&
          trimmed.length < 50 &&
          !trimmed.endsWith(":") &&
          !trimmed.includes("CONTINUED")
        ) {
          type = "character";
          styleClass = "text-center font-bold mt-4 mb-0 mx-auto w-2/3";
        } else if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
          type = "parenthetical";
          styleClass = "text-center mx-auto w-1/2 -mt-1 mb-0";
        } else if (
          /^(CUT TO:|FADE TO:|DISSOLVE TO:|SMASH CUT TO:)$/.test(trimmed)
        ) {
          type = "transition";
          styleClass = "text-right font-bold uppercase mt-4 mb-2 ml-auto w-1/3";
        } else if (
          previousType === "character" ||
          previousType === "parenthetical"
        ) {
          type = "dialogue";
          styleClass = "text-center mx-auto w-3/4 mb-1";
        } else if (previousType === "dialogue" && trimmed.length > 0) {
          type = "dialogue";
          styleClass = "text-center mx-auto w-3/4 mb-1";
        } else {
          styleClass = "text-left max-w-full my-2";
        }

        previousType = type;
        return (
          <div key={i} className={styleClass}>
            {line}
          </div>
        );
      })}
    </div>
  );
}
