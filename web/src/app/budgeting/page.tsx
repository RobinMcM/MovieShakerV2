import { redirect } from "next/navigation";

/**
 * Legacy URL: /budgeting?project=<id>
 * Redirects to the new route: /project/[projectId]/budgeting
 */
export default async function BudgetingRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const params = await searchParams;
  const projectId = params?.project;
  if (projectId && typeof projectId === "string") {
    redirect(`/project/${projectId}/budgeting`);
  }
  redirect("/projects");
}
