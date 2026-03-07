"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { useState, useEffect } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Loader2,
  Users,
  Calendar,
  UserPlus,
  UserCircle,
  ExternalLink,
} from "lucide-react";
import { useCastManagement } from "./useCastManagement";

function CastManagementPageInner() {
  const params = useParams();
  const projectId =
    typeof params.projectId === "string"
      ? params.projectId
      : params.projectId?.[0];

  const {
    loading,
    project,
    currentScript,
    characters,
    toastMessage,
    clearToast,
    refresh,
    updateCastingNotes,
    updateCastingLocation,
  } = useCastManagement(projectId ?? null);

  const [castingLocationInput, setCastingLocationInput] = useState("");

  useEffect(() => {
    setCastingLocationInput(project?.casting_location ?? "");
  }, [project?.casting_location]);

  const handleCastingLocationBlur = () => {
    const trimmed = castingLocationInput.trim();
    if (trimmed !== (project?.casting_location ?? "")) {
      updateCastingLocation(trimmed);
    }
  };

  const totalApplicants = characters.reduce(
    (sum, c) => sum + c.applications.length,
    0
  );

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
        <main className="flex-1 container mx-auto px-4 py-8">
          <p className="text-muted-foreground">Project not found.</p>
          <Link
            href="/projects"
            className="text-primary underline mt-4 inline-block"
          >
            Back to Projects
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  const scriptId = currentScript?.id ?? null;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-background via-background to-accent/5">
      <AppHeader />
      <main className="flex-1 container mx-auto px-4 py-8">
        {toastMessage && (
          <div
            className={`mb-4 p-3 rounded-md text-sm ${
              toastMessage.variant === "destructive"
                ? "bg-destructive/10 text-destructive border border-destructive/20"
                : "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium">{toastMessage.title}</p>
                {toastMessage.description && (
                  <p className="mt-1 opacity-90">{toastMessage.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={clearToast}
                className="text-current opacity-70 hover:opacity-100"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        )}

        <div className="mb-4">
          <Link
            href={`/project/${projectId}`}
            className="text-primary hover:underline text-sm"
          >
            ← Back to project
          </Link>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Cast Management
          </h1>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Casting Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex flex-col items-center text-center gap-2">
                      <Calendar className="h-8 w-8 text-primary" />
                      <h3 className="font-semibold">Scheduled Auditions</h3>
                      <p className="text-3xl font-bold">0</p>
                      <p className="text-xs text-muted-foreground">
                        Upcoming sessions
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex flex-col items-center text-center gap-2">
                      <Users className="h-8 w-8 text-primary" />
                      <h3 className="font-semibold">Applicants</h3>
                      <p className="text-3xl font-bold">{totalApplicants}</p>
                      <p className="text-xs text-muted-foreground">
                        Total submissions
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex flex-col items-center text-center gap-2">
                      <UserPlus className="h-8 w-8 text-primary" />
                      <h3 className="font-semibold">Roles to Cast</h3>
                      <p className="text-3xl font-bold">{characters.length}</p>
                      <p className="text-xs text-muted-foreground">
                        Open positions
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {projectId && (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" asChild className="gap-2">
                    <Link
                      href={`/rolestocast?project=${projectId}${scriptId ? `&script=${scriptId}` : ""}`}
                    >
                      <UserCircle className="h-4 w-4" />
                      Characters
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="space-y-4">
                <CardTitle>Roles & Applications</CardTitle>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label
                      htmlFor="project-casting-location"
                      className="text-sm"
                    >
                      Casting Location
                    </Label>
                    <Input
                      id="project-casting-location"
                      placeholder="Enter casting location..."
                      value={castingLocationInput}
                      onChange={(e) => setCastingLocationInput(e.target.value)}
                      onBlur={handleCastingLocationBlur}
                      className="mt-1"
                    />
                  </div>
                  {castingLocationInput.trim() && (
                    <Button variant="outline" size="icon" asChild>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(castingLocationInput.trim())}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open location in Google Maps"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {characters.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No roles available</p>
                  <p className="text-sm">
                    Characters will appear here once added to the script
                  </p>
                </div>
              ) : (
                <Accordion type="single" collapsible className="w-full">
                  {characters.map((character) => (
                    <AccordionItem
                      key={character.id}
                      value={character.id}
                      className="border rounded-lg px-4"
                    >
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center justify-between w-full pr-4">
                          <span className="font-semibold">
                            {character.name}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {character.applications.length}{" "}
                            {character.applications.length === 1
                              ? "application"
                              : "applications"}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4">
                          {projectId && scriptId && (
                            <div className="flex justify-end">
                              <Button
                                variant="outline"
                                size="sm"
                                asChild
                                className="gap-2"
                              >
                                <a
                                  href={`/actor-role/${projectId}/${scriptId}/${character.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  View Shareable Actor Link
                                </a>
                              </Button>
                            </div>
                          )}
                          <div>
                            <Label
                              htmlFor={`notes-${character.id}`}
                              className="mb-2"
                            >
                              General Role Comments
                            </Label>
                            <Textarea
                              id={`notes-${character.id}`}
                              rows={3}
                              placeholder="Add notes about this role..."
                              defaultValue={character.casting_notes ?? ""}
                              onBlur={(e) =>
                                updateCastingNotes(
                                  character.id,
                                  e.target.value
                                )
                              }
                              className="resize-none"
                            />
                          </div>

                          <div className="border-t pt-4">
                            <h4 className="font-semibold mb-3">Applications</h4>
                            {character.applications.length === 0 ? (
                              <p className="text-sm text-muted-foreground py-4">
                                No applications yet for this role
                              </p>
                            ) : (
                              <div className="space-y-3">
                                {character.applications.map((application) => (
                                  <div
                                    key={application.id}
                                    className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex items-start gap-3">
                                        <div className="h-10 w-10 flex-shrink-0 rounded-full overflow-hidden bg-muted flex items-center justify-center text-sm font-medium">
                                          {application.profiles?.avatar_url ? (
                                            <img
                                              src={application.profiles.avatar_url}
                                              alt=""
                                              className="h-full w-full object-cover"
                                            />
                                          ) : (
                                            (application.profiles?.name ||
                                              application.applicant_name ||
                                              application.applicant_email)
                                              .split(" ")
                                              .map((n) => n[0])
                                              .join("")
                                              .toUpperCase()
                                              .slice(0, 2)
                                          )}
                                        </div>
                                        <div>
                                          <h4 className="font-medium flex items-center gap-2">
                                            <span>
                                              {application.applicant_name}
                                              {application.pronoun && (
                                                <span className="text-muted-foreground font-normal">
                                                  {" "}
                                                  ({application.pronoun})
                                                </span>
                                              )}
                                              {application.playing_age && (
                                                <span className="text-muted-foreground font-normal">
                                                  {" "}
                                                  - Age:{" "}
                                                  {application.playing_age}
                                                </span>
                                              )}
                                            </span>
                                          </h4>
                                          {application.notes && (
                                            <p className="text-sm mt-2">
                                              {application.notes}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                                        <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                                          {application.status}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {new Date(
                                            application.created_at
                                          ).toLocaleDateString()}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function CastManagementPage() {
  return (
    <SessionAuth>
      <CastManagementPageInner />
    </SessionAuth>
  );
}
