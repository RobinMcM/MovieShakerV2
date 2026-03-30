"use client";

import { useSearchParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { Settings } from "lucide-react";

import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function ProjectAdministrationPlaceholderPage() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <main className="flex-1 container mx-auto px-4 py-8 space-y-6">
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Project Administration
            </CardTitle>
            <CardDescription>
              This page has been migrated into the Next app as a placeholder.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Team invitations and member management are intentionally deferred and will be handled in a
              dedicated follow-up plan.
            </p>
            {projectId ? (
              <p className="text-sm text-muted-foreground">
                Current project context: <span className="font-mono">{projectId}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No project query was provided. Open this page from a project quick action to include context.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}

export default function ProjectAdministrationRoute() {
  return (
    <SessionAuth>
      <ProjectAdministrationPlaceholderPage />
    </SessionAuth>
  );
}
