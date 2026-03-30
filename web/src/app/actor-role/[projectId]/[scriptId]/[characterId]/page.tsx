import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Film } from "lucide-react";
import { AddToHomeHint } from "./AddToHomeHint";

export const metadata: Metadata = {
  title: "MovieShaker Role Share",
  description: "Public role details shared from MovieShaker.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Role Share",
  },
};

type RouteParams = {
  projectId: string;
  scriptId: string;
  characterId: string;
};

type ActorRolePayload = {
  project_id: string;
  project_name: string;
  script_id: string;
  script_name: string;
  character_id: string;
  character_name: string;
  casting_notes?: string | null;
};

function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}

async function loadActorRole(params: RouteParams): Promise<{
  status: "ok" | "not_found" | "error";
  data?: ActorRolePayload;
}> {
  const baseUrl = getApiBaseUrl();
  const endpoint =
    `${baseUrl}/public/actor-role/` +
    `${encodeURIComponent(params.projectId)}/` +
    `${encodeURIComponent(params.scriptId)}/` +
    `${encodeURIComponent(params.characterId)}`;

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 404) {
      return { status: "not_found" };
    }
    if (!response.ok) {
      return { status: "error" };
    }

    const data = (await response.json()) as ActorRolePayload;
    if (!data?.character_id || !data?.script_id || !data?.project_id) {
      return { status: "error" };
    }
    return { status: "ok", data };
  } catch {
    return { status: "error" };
  }
}

export default async function PublicActorRolePage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const resolvedParams = await params;
  const result = await loadActorRole(resolvedParams);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-background to-muted/20">
      <main
        className="mx-auto w-full max-w-md px-4 pb-6"
        style={{
          paddingTop: "max(14px, env(safe-area-inset-top))",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
        }}
      >
        <div className="mb-4 rounded-2xl border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70 shadow-sm">
          <div className="flex items-center gap-2 px-4 py-3">
            <Film className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold tracking-wide">MovieShaker</p>
            <span className="ml-auto text-xs text-muted-foreground">
              Role Share
            </span>
          </div>
        </div>

        <AddToHomeHint />

        <div className="space-y-4">
          {result.status === "ok" && result.data ? (
            <Card className="rounded-2xl shadow-sm">
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Badge variant="secondary">Shareable Role</Badge>
                </div>
                <CardTitle className="text-2xl">
                  {result.data.character_name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-md border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Project
                    </p>
                    <p className="mt-1 font-medium">{result.data.project_name}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Script
                    </p>
                    <p className="mt-1 font-medium">{result.data.script_name}</p>
                  </div>
                </div>

                <div className="rounded-md border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    General Role Comments
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                    {result.data.casting_notes?.trim()
                      ? result.data.casting_notes
                      : "No additional role comments have been added yet."}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : result.status === "not_found" ? (
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="text-xl">Role Link Not Found</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  This shareable role link is invalid, expired, or no longer
                  available.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="text-xl">
                  Unable To Load Shareable Role
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  We could not load this role right now. Please try again in a
                  moment.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
