"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { ArrowLeft, Loader2 } from "lucide-react";

import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

interface ProjectData {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  submit_for_funding?: boolean;
}

function SubmitFundingPage() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [project, setProject] = useState<ProjectData | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    void loadProject(projectId);
  }, [projectId]);

  async function loadProject(id: string) {
    try {
      setLoading(true);
      const list = await api.get<ProjectData[]>("/projects/");
      const found = (Array.isArray(list) ? list : []).find((p) => p.id === id) ?? null;
      setProject(found);
      if (!found) {
        setMessage({ kind: "error", text: "Project not found." });
      }
    } catch {
      setMessage({ kind: "error", text: "Failed to load project details." });
    } finally {
      setLoading(false);
    }
  }

  const supportsFundingToggle = useMemo(
    () => Boolean(project && typeof project.submit_for_funding === "boolean"),
    [project]
  );

  async function handleToggle(checked: boolean) {
    if (!project || !projectId) return;
    if (!supportsFundingToggle) return;
    const previous = project.submit_for_funding ?? false;
    setProject((prev) => (prev ? { ...prev, submit_for_funding: checked } : prev));

    try {
      setUpdating(true);
      await api.put(`/projects/${projectId}`, {
        submit_for_funding: checked,
      });
      setMessage({
        kind: "success",
        text: checked ? "Funding submission enabled." : "Funding submission disabled.",
      });
    } catch {
      setProject((prev) => (prev ? { ...prev, submit_for_funding: previous } : prev));
      setMessage({ kind: "error", text: "Could not update this setting." });
    } finally {
      setUpdating(false);
    }
  }

  const backHref = projectId ? `/project/${projectId}` : "/projects";

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <AppHeader />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </main>
        <Footer />
      </div>
    );
  }

  if (!projectId || !project) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <AppHeader />
        <main className="flex-1 container mx-auto px-4 py-8 space-y-4">
          <p className="text-muted-foreground">
            {!projectId ? "No project selected." : "Project not found."}
          </p>
          <Link href="/projects" className="text-primary underline inline-block">
            Back to Projects
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <main className="flex-1 container mx-auto px-4 py-8 space-y-6">
        <Link href={backHref}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>

        {message && (
          <div
            className={`p-3 rounded-md text-sm ${
              message.kind === "error"
                ? "bg-destructive/10 text-destructive border border-destructive/20"
                : "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
            }`}
          >
            {message.text}
          </div>
        )}

        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Submit for Funding</CardTitle>
            <CardDescription>
              Enable this option to allow your project to be submitted for funding opportunities.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="funding-toggle" className="text-base font-semibold">
                  Submit Project for Funding
                </Label>
                <p className="text-sm text-muted-foreground">
                  Project: {project.name}
                </p>
              </div>
              <Button
                id="funding-toggle"
                type="button"
                variant={project.submit_for_funding ? "default" : "outline"}
                onClick={() => handleToggle(!Boolean(project.submit_for_funding))}
                disabled={updating || !supportsFundingToggle}
              >
                {updating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : project.submit_for_funding ? (
                  "Enabled"
                ) : (
                  "Disabled"
                )}
              </Button>
            </div>

            {!supportsFundingToggle && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                Funding submission settings are not yet available in the current backend model.
                This page is migrated and ready, but this toggle will be enabled once that backend
                field is introduced.
              </div>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}

export default function SubmitFundingRoute() {
  return (
    <SessionAuth>
      <SubmitFundingPage />
    </SessionAuth>
  );
}
