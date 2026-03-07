import { redirect } from "next/navigation";

/**
 * Legacy URL: /scene-costs?project=<id>
 * Redirects to the new route: /project/[projectId]/scene-costs
 */
export default async function SceneCostsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const params = await searchParams;
  const projectId = params?.project;
  if (projectId && typeof projectId === "string") {
    redirect(`/project/${projectId}/scene-costs`);
  }
  redirect("/projects");
}
