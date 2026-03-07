import { redirect } from "next/navigation";

/**
 * Legacy URL: /crew?project=<id>
 * Redirects to the new route: /project/[projectId]/crewmanagement
 */
export default async function CrewRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const params = await searchParams;
  const projectId = params?.project;
  if (projectId && typeof projectId === "string") {
    redirect(`/project/${projectId}/crewmanagement`);
  }
  redirect("/projects");
}
