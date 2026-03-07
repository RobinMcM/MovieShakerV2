"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  User,
  Briefcase,
  CheckCircle2,
  UserCog,
  UsersRound,
} from "lucide-react";
import { useCrewManagement } from "./useCrewManagement";
import { groupSkillsByType, type Skill } from "./types";

function CrewManagementPageInner() {
  const params = useParams();
  const projectId =
    typeof params.projectId === "string"
      ? params.projectId
      : params.projectId?.[0];

  const {
    loading,
    project,
    userRoles,
    actorSkills,
    crewSkills,
    userSkillIds,
    producerRoles,
    userProducerRoleIds,
    toastMessage,
    clearToast,
    toggleSkill,
    toggleProducerRole,
  } = useCrewManagement(projectId ?? null);

  const hasAnyRole =
    userRoles.includes("actor") ||
    userRoles.includes("crew") ||
    userRoles.includes("project_owner") ||
    userRoles.includes("project_participant");

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
          <UsersRound className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Crew Management
          </h1>
        </div>

        <div className="max-w-4xl mx-auto space-y-6">
          {userRoles.includes("actor") && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  <CardTitle>Actor Skills</CardTitle>
                </div>
                <CardDescription>
                  Select the acting skills that apply to you
                </CardDescription>
              </CardHeader>
              <CardContent>
                {actorSkills.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No actor skills available yet.
                  </p>
                ) : (
                  <Accordion type="multiple" className="w-full">
                    {Object.entries(groupSkillsByType(actorSkills)).map(
                      ([skillType, skills]) => (
                        <AccordionItem key={skillType} value={skillType}>
                          <AccordionTrigger className="text-sm font-semibold">
                            {skillType} ({skills.length})
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                              {skills.map((skill: Skill) => (
                                <div
                                  key={skill.id}
                                  className="flex items-center space-x-3 p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                                >
                                  <Checkbox
                                    id={`actor-${skill.id}`}
                                    checked={userSkillIds.includes(skill.id)}
                                    onCheckedChange={(checked) =>
                                      toggleSkill(skill.id, !!checked)
                                    }
                                  />
                                  <label
                                    htmlFor={`actor-${skill.id}`}
                                    className="flex-1 text-sm font-medium leading-none cursor-pointer"
                                  >
                                    {skill.name}
                                  </label>
                                  {userSkillIds.includes(skill.id) && (
                                    <CheckCircle2 className="h-4 w-4 text-primary" />
                                  )}
                                </div>
                              ))}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      )
                    )}
                  </Accordion>
                )}
              </CardContent>
            </Card>
          )}

          {userRoles.includes("crew") && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5" />
                  <CardTitle>Crew Skills</CardTitle>
                </div>
                <CardDescription>
                  Select the crew skills that apply to you
                </CardDescription>
              </CardHeader>
              <CardContent>
                {crewSkills.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No crew skills available yet.
                  </p>
                ) : (
                  <Accordion type="multiple" className="w-full">
                    {Object.entries(groupSkillsByType(crewSkills)).map(
                      ([skillType, skills]) => (
                        <AccordionItem key={skillType} value={skillType}>
                          <AccordionTrigger className="text-sm font-semibold">
                            {skillType} ({skills.length})
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                              {skills.map((skill: Skill) => (
                                <div
                                  key={skill.id}
                                  className="flex items-center space-x-3 p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                                >
                                  <Checkbox
                                    id={`crew-${skill.id}`}
                                    checked={userSkillIds.includes(skill.id)}
                                    onCheckedChange={(checked) =>
                                      toggleSkill(skill.id, !!checked)
                                    }
                                  />
                                  <label
                                    htmlFor={`crew-${skill.id}`}
                                    className="flex-1 text-sm font-medium leading-none cursor-pointer"
                                  >
                                    {skill.name}
                                  </label>
                                  {userSkillIds.includes(skill.id) && (
                                    <CheckCircle2 className="h-4 w-4 text-primary" />
                                  )}
                                </div>
                              ))}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      )
                    )}
                  </Accordion>
                )}
              </CardContent>
            </Card>
          )}

          {(userRoles.includes("project_owner") ||
            userRoles.includes("project_participant")) && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <UserCog className="h-5 w-5" />
                  <CardTitle>Production Roles</CardTitle>
                </div>
                <CardDescription>
                  Select the roles that apply to you
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold mb-3">
                    Producer Roles
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {producerRoles
                      .filter((r) => r.category === "producer")
                      .map((role) => (
                        <div
                          key={role.id}
                          className="flex items-center space-x-3 p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                        >
                          <Checkbox
                            id={`producer-${role.id}`}
                            checked={userProducerRoleIds.includes(role.id)}
                            onCheckedChange={(checked) =>
                              toggleProducerRole(role.id, !!checked)
                            }
                          />
                          <label
                            htmlFor={`producer-${role.id}`}
                            className="flex-1 text-sm font-medium leading-none cursor-pointer"
                          >
                            {role.name}
                          </label>
                          {userProducerRoleIds.includes(role.id) && (
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          )}
                        </div>
                      ))}
                  </div>
                  {producerRoles.filter((r) => r.category === "producer")
                    .length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No producer roles available yet.
                    </p>
                  )}
                </div>
                <div className="border-t pt-6">
                  <h3 className="text-sm font-semibold mb-3">
                    Director Roles
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {producerRoles
                      .filter((r) => r.category === "director")
                      .map((role) => (
                        <div
                          key={role.id}
                          className="flex items-center space-x-3 p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                        >
                          <Checkbox
                            id={`director-${role.id}`}
                            checked={userProducerRoleIds.includes(role.id)}
                            onCheckedChange={(checked) =>
                              toggleProducerRole(role.id, !!checked)
                            }
                          />
                          <label
                            htmlFor={`director-${role.id}`}
                            className="flex-1 text-sm font-medium leading-none cursor-pointer"
                          >
                            {role.name}
                          </label>
                          {userProducerRoleIds.includes(role.id) && (
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          )}
                        </div>
                      ))}
                  </div>
                  {producerRoles.filter((r) => r.category === "director")
                    .length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No director roles available yet.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {!hasAnyRole && (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-8">
                  <p className="text-muted-foreground">
                    Please set up your profile as an Actor or Crew member to
                    select your skills.
                  </p>
                  <Button variant="outline" className="mt-4" asChild>
                    <Link href="/profile">Go to Profile</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function CrewManagementPage() {
  return (
    <SessionAuth>
      <CrewManagementPageInner />
    </SessionAuth>
  );
}
