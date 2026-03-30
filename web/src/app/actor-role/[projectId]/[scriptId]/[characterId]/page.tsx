import type { Metadata } from "next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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

type RoleScene = {
  id: string;
  scene_number?: string | null;
  heading: string;
  description: string;
  page_number: string;
};

type ScriptElement = {
  type: string;
  text: string;
  character?: string | null;
};

type ActorRolePayload = {
  character: {
    name: string;
    character_image_url?: string | null;
  };
  project: string;
  script: string;
  script_json_url?: string | null;
  scenes: RoleScene[];
  script_elements: ScriptElement[];
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
    if (!data?.character?.name || !Array.isArray(data.scenes)) {
      return { status: "error" };
    }
    return { status: "ok", data };
  } catch {
    return { status: "error" };
  }
}

function normalizeHeading(input: string) {
  return input
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function scoreHeadingMatch(sceneHeading: string, candidateHeading: string) {
  const target = normalizeHeading(sceneHeading);
  const candidate = normalizeHeading(candidateHeading);
  if (!target || !candidate) return 0;
  if (target === candidate) return 1000;
  if (candidate.startsWith(target) || target.startsWith(candidate)) return 800;
  if (candidate.includes(target) || target.includes(candidate)) return 600;

  const targetTokens = new Set(target.split(" ").filter(Boolean));
  const candidateTokens = new Set(candidate.split(" ").filter(Boolean));
  if (targetTokens.size === 0 || candidateTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of targetTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }
  const ratio = overlap / Math.max(targetTokens.size, candidateTokens.size);
  return Math.round(ratio * 400);
}

function getSceneContent(elements: ScriptElement[], sceneHeading: string) {
  if (!Array.isArray(elements) || elements.length === 0) return null;
  const target = normalizeHeading(sceneHeading);

  let exactStartIndex = -1;
  let bestFuzzyStartIndex = -1;
  let bestFuzzyScore = 0;
  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i];
    const elType = (el.type || "").toLowerCase().replace("_", " ");
    if (elType !== "scene heading") continue;
    const headingText = el.text || "";
    const normalized = normalizeHeading(headingText);

    if (normalized === target) {
      exactStartIndex = i;
      break;
    }

    const score = scoreHeadingMatch(sceneHeading, headingText);
    if (score > bestFuzzyScore) {
      bestFuzzyScore = score;
      bestFuzzyStartIndex = i;
    }
  }

  const startIndex = exactStartIndex !== -1 ? exactStartIndex : bestFuzzyStartIndex;
  if (startIndex === -1) return null;

  const content: ScriptElement[] = [];
  for (let i = startIndex + 1; i < elements.length; i += 1) {
    const el = elements[i];
    const elType = (el.type || "").toLowerCase().replace("_", " ");
    if (elType === "scene heading") break;
    content.push(el);
  }
  return content;
}

export default async function PublicActorRolePage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const resolvedParams = await params;
  const result = await loadActorRole(resolvedParams);
  const roleData = result.status === "ok" && result.data ? result.data : null;

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
          {roleData ? (
            <>
              <Card className="rounded-2xl shadow-sm">
                <CardHeader className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Badge variant="secondary">Actor Rehearsal</Badge>
                  </div>
                  <CardTitle className="text-2xl text-center">
                    {roleData.character.name}
                  </CardTitle>
                  <p className="text-center text-sm text-muted-foreground">
                    {roleData.project} - {roleData.script}
                  </p>
                </CardHeader>
                {roleData.character.character_image_url ? (
                  <CardContent className="flex justify-center pb-6">
                    <img
                      src={roleData.character.character_image_url}
                      alt={roleData.character.name}
                      className="rounded-full w-24 h-24 object-cover border-4 border-primary/10"
                    />
                  </CardContent>
                ) : null}
              </Card>

              <Accordion type="single" collapsible className="w-full space-y-2">
                {roleData.scenes.map((scene) => {
                  const sceneContent = getSceneContent(
                    roleData.script_elements || [],
                    scene.heading
                  );
                  return (
                    <AccordionItem
                      key={scene.id}
                      value={scene.id}
                      className="border rounded-xl px-4 bg-card"
                    >
                      <AccordionTrigger className="hover:no-underline py-4">
                        <div className="flex items-center gap-3 text-left">
                          {scene.scene_number ? (
                            <span className="font-mono font-bold text-primary min-w-[2rem]">
                              {scene.scene_number}
                            </span>
                          ) : null}
                          <span className="font-semibold">
                            {scene.heading || "Untitled Scene"}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pt-2 pb-4 text-muted-foreground whitespace-pre-wrap">
                        {sceneContent && sceneContent.length > 0 ? (
                          <div className="space-y-3 text-foreground font-mono text-sm pl-3 border-l-2">
                            {sceneContent.map((el, idx) => {
                              const type = (el.type || "").toLowerCase().replace("_", " ");
                              const isCharacter = type === "character";
                              const isDialogue = type === "dialogue";
                              const isParenthetical = type === "parenthetical";
                              const actorName = roleData.character.name.toLowerCase();
                              const isMe =
                                (el.character && el.character.toLowerCase().includes(actorName)) ||
                                (isCharacter && el.text.toLowerCase().includes(actorName));

                              const highlightClass = isMe
                                ? "bg-yellow-100 dark:bg-yellow-900/30 -mx-2 px-2 py-1 rounded"
                                : "";

                              let alignmentClass = "";
                              if (isCharacter) alignmentClass = "text-center mt-3 uppercase";
                              else if (isDialogue) alignmentClass = "text-center max-w-lg mx-auto";
                              else if (isParenthetical) alignmentClass = "text-center italic text-xs";

                              return (
                                <div
                                  key={`${scene.id}-${idx}`}
                                  className={`${highlightClass} ${alignmentClass} mb-1`}
                                >
                                  {isCharacter ? <div className="font-bold">{el.text}</div> : null}
                                  {isParenthetical ? <div>{el.text}</div> : null}
                                  {isDialogue ? <div>{el.text}</div> : null}
                                  {type === "action" ? (
                                    <div className="text-muted-foreground">{el.text}</div>
                                  ) : null}
                                  {![
                                    "character",
                                    "dialogue",
                                    "parenthetical",
                                    "action",
                                    "scene heading",
                                  ].includes(type) ? (
                                    <div className="text-xs text-muted-foreground uppercase">
                                      {el.type}: {el.text}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div>{scene.description || "No description available."}</div>
                            <div className="text-xs italic text-muted-foreground">
                              Script content not available for this scene.
                            </div>
                          </div>
                        )}
                        {scene.page_number ? (
                          <div className="mt-3 text-xs text-muted-foreground/60 text-right">
                            Page {scene.page_number}
                          </div>
                        ) : null}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </>
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
