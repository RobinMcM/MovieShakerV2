"use client";

import { useEffect, useMemo, useState } from "react";
import { Smartphone } from "lucide-react";

function isLikelyMobile(userAgent: string) {
  return /Android|iPhone|iPad|iPod/i.test(userAgent);
}

export function AddToHomeHint() {
  const [isMobile, setIsMobile] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const ua = window.navigator.userAgent || "";
    const standaloneByMedia = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
    const standaloneByNavigator = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    setIsMobile(isLikelyMobile(ua));
    setIsStandalone(standaloneByMedia || standaloneByNavigator);
    setIsIOS(/iPhone|iPad|iPod/i.test(ua));
  }, []);

  const hintText = useMemo(() => {
    if (isIOS) {
      return "For app-style use: tap Share, then Add to Home Screen.";
    }
    return "For app-style use: open browser menu, then Add to Home screen.";
  }, [isIOS]);

  if (!isMobile || isStandalone) return null;

  return (
    <div className="mb-4 rounded-xl border bg-muted/40 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <Smartphone className="mt-0.5 h-4 w-4 text-primary" />
        <p className="text-xs text-muted-foreground">{hintText}</p>
      </div>
    </div>
  );
}
