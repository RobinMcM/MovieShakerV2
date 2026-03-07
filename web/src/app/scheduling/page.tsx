import { redirect } from "next/navigation";

/**
 * Legacy URL: /scheduling?project=<id>
 * Redirects to the new route: /project/[projectId]/scheduling
 */
export default async function SchedulingRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const params = await searchParams;
  const projectId = params?.project;
  if (projectId && typeof projectId === "string") {
    redirect(`/project/${projectId}/scheduling`);
  }
  redirect("/projects");
}
