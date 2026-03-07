import { redirect } from "next/navigation";

/**
 * Legacy URL: /moodboard?project=<id>&tramLine=<id>
 * Redirects to: /project/[projectId]/moodboard (preserves tramLine query if present)
 */
export default async function MoodboardRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; tramLine?: string }>;
}) {
  const params = await searchParams;
  const projectId = params?.project;
  if (projectId && typeof projectId === "string") {
    const tramLine = params?.tramLine && typeof params.tramLine === "string" ? params.tramLine : "";
    const query = tramLine ? `?tramLine=${encodeURIComponent(tramLine)}` : "";
    redirect(`/project/${projectId}/moodboard${query}`);
  }
  redirect("/projects");
}
