import { redirect } from "next/navigation";
import { PROJECT_DEFAULT_ROUTE } from "./projectNav";

export default async function ProjectRootRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/project/${projectId}/${PROJECT_DEFAULT_ROUTE}`);
}
