"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function ObjectsRedirectPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get("project");

  useEffect(() => {
    if (projectId) {
      router.replace(`/project/${projectId}/objects`);
    } else {
      router.replace("/");
    }
  }, [projectId, router]);

  return null;
}
