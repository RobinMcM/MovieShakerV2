import { redirect } from "next/navigation";

/**
 * Legacy URL: /shotlist?project=<id>
 * Redirects to: /project/[projectId]/shotlist
 */
export default async function ShotlistRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const params = await searchParams;
  const projectId = params?.project;
  if (projectId && typeof projectId === "string") {
    redirect(`/project/${projectId}/shotlist`);
  }
  redirect("/projects");
}
