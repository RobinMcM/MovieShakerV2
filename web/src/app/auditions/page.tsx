import { redirect } from "next/navigation";

/**
 * Legacy URL: /auditions?project=<id>
 * Redirects to the new route: /project/[projectId]/castmanagement
 */
export default async function AuditionsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const params = await searchParams;
  const projectId = params?.project;
  if (projectId && typeof projectId === "string") {
    redirect(`/project/${projectId}/castmanagement`);
  }
  redirect("/projects");
}
