"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function RushesRedirect() {
  const params = useParams();
  const router = useRouter();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId as string;

  useEffect(() => {
    router.replace(`/project/${projectId}/editor`);
  }, [projectId, router]);

  return null;
}
