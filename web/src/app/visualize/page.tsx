"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function VisualizeRedirectPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get("project");
  const scene = searchParams.get("scene");
  const tramLine = searchParams.get("tramLine");
  const moodboardImage = searchParams.get("moodboardImage");

  useEffect(() => {
    if (projectId) {
      const path = `/project/${projectId}/visualize`;
      const params = new URLSearchParams();
      if (scene) params.set("scene", scene);
      if (tramLine) params.set("tramLine", tramLine);
      if (moodboardImage) params.set("moodboardImage", moodboardImage);
      const q = params.toString();
      router.replace(q ? `${path}?${q}` : path);
    } else {
      router.replace("/");
    }
  }, [projectId, scene, tramLine, moodboardImage, router]);

  return null;
}
