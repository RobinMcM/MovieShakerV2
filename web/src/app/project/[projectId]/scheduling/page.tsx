"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { useState } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Calendar, CalendarClock, X, Check } from "lucide-react";
import { useScenes } from "./useScenes";
import { SceneItem } from "./SceneItem";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function SchedulingPageInner() {
  const params = useParams();
  const projectId =
    typeof params.projectId === "string"
      ? params.projectId
      : params.projectId?.[0];
  const [viewMode, setViewMode] = useState<"list" | "schedule">("list");
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [groupLocationName, setGroupLocationName] = useState("");

  const {
    loading,
    project,
    scenesData,
    scriptPageCount,
    timeOfDayOptions,
    shootingDays,
    sceneCostsMap,
    toastMessage,
    clearToast,
    updateSceneField,
    updateCharacterField,
    updateLocalScene,
    updateLocalSceneCharacter,
    bulkUpdateSceneLocations,
  } = useScenes(projectId ?? null);

  const handleToggleSelect = (sceneId: string) => {
    setSelectedSceneIds((prev) =>
      prev.includes(sceneId)
        ? prev.filter((id) => id !== sceneId)
        : [...prev, sceneId]
    );
  };

  const handleBulkGroup = async () => {
    if (!groupLocationName.trim() || selectedSceneIds.length === 0) return;
    await bulkUpdateSceneLocations(selectedSceneIds, groupLocationName);
    setSelectedSceneIds([]);
    setGroupLocationName("");
  };

  const handleClearSelection = () => {
    setSelectedSceneIds([]);
    setGroupLocationName("");
  };

  const getTramlineColor = (shootingDay: string | null) => {
    if (!shootingDay) return "bg-muted";
    const colors = [
      "bg-blue-500",
      "bg-green-500",
      "bg-yellow-500",
      "bg-purple-500",
      "bg-pink-500",
      "bg-orange-500",
      "bg-cyan-500",
      "bg-red-500",
      "bg-indigo-500",
      "bg-teal-500",
    ];
    const index = shootingDays.indexOf(shootingDay);
    return colors[index % colors.length];
  };

  const getTimeOfDayName = (timeOfDayId: string | null | undefined) => {
    if (!timeOfDayId) return null;
    const timeOfDay = timeOfDayOptions.find((tod) => tod.id === timeOfDayId);
    return timeOfDay?.name ?? null;
  };

  const formatTimeFromEighths = (eighths: number): string => {
    const totalMinutes = eighths * 15;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
  };

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
        </main>
        <Footer />
      </div>
    );
  }

  const totalScenes = scenesData.length;
  const uniqueCharacters = new Set(
    scenesData.flatMap((item) => item.characters.map((c) => c.id))
  ).size;
  const expectedDuration = Math.max(0, scriptPageCount - 1);
  const sortedScenesData = scenesData;
  const groupedScenes = sortedScenesData.reduce(
    (acc, item) => {
      const location =
        item.scene.scene_location || item.scene.heading;
      if (!acc[location]) acc[location] = [];
      acc[location].push(item);
      return acc;
    },
    {} as Record<string, typeof scenesData>
  );

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-background via-background to-accent/5">
      <AppHeader />
      <main className="flex-1 container mx-auto px-4 py-6">
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

        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Schedule
            </h1>
          </div>

          <Card>
            <CardContent className="py-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
                <div>
                  <p className="text-2xl font-bold text-primary">
                    {totalScenes}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Total Scenes
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">
                    {uniqueCharacters}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Characters
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">
                    {expectedDuration}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Expected Duration (min)
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <CardTitle className="text-2xl">{project.name}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {project.status}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scene Breakdown</CardTitle>
              <CardDescription>
                View scenes and characters for scheduling
              </CardDescription>
            </CardHeader>
            <CardContent>
              {scenesData.length === 0 ? (
                <div className="text-center py-12">
                  <CalendarClock className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">No scenes found.</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Upload and set a current script from{" "}
                    <Link
                      href={`/project/${projectId}/scheduling`}
                      className="text-primary underline"
                    >
                      scheduling
                    </Link>{" "}
                    to see the schedule here.
                  </p>
                </div>
              ) : (
                <Tabs
                  value={viewMode}
                  onValueChange={(v) =>
                    setViewMode(v as "list" | "schedule")
                  }
                  className="w-full"
                >
                  <div className="mb-6 overflow-x-auto">
                    <TabsList className="h-12 min-w-max rounded-full bg-secondary p-1 border border-border/50 shadow-inner">
                      <TabsTrigger
                        value="list"
                        className="rounded-full px-4 sm:px-8 py-2.5 text-sm font-semibold transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-background/40 data-[state=inactive]:hover:text-foreground"
                      >
                        Script Supervision
                      </TabsTrigger>
                      <TabsTrigger
                        value="schedule"
                        className="rounded-full px-4 sm:px-8 py-2.5 text-sm font-semibold transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-background/40 data-[state=inactive]:hover:text-foreground"
                      >
                        Schedule
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  {selectedSceneIds.length > 1 && (
                    <div className="mb-6 p-4 border rounded-lg bg-primary/5 border-primary/20 sticky top-20 z-10 backdrop-blur-md shadow-lg">
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2 mr-auto">
                          <Badge className="h-8 px-3 text-sm bg-primary text-primary-foreground">
                            {selectedSceneIds.length} scenes selected
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleClearSelection}
                            className="h-8 w-8 rounded-full"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 max-w-md">
                          <Label
                            htmlFor="group-location"
                            className="sr-only"
                          >
                            New Location Name
                          </Label>
                          <Input
                            id="group-location"
                            placeholder="Enter location name to group..."
                            value={groupLocationName}
                            onChange={(e) =>
                              setGroupLocationName(e.target.value)
                            }
                            className="h-9 bg-background"
                          />
                          <Button
                            onClick={handleBulkGroup}
                            size="sm"
                            className="h-9 gap-2 w-full sm:w-auto"
                          >
                            <Check className="h-4 w-4" />
                            Group
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {shootingDays.length > 0 && (
                    <div className="mb-6 p-4 border rounded-lg bg-card">
                      <h3 className="text-sm font-medium mb-3">
                        Shooting Days Legend
                      </h3>
                      <div className="flex flex-wrap gap-3">
                        {shootingDays.map((day) => (
                          <div
                            key={day}
                            className="flex items-center gap-2"
                          >
                            <div
                              className={`w-4 h-8 rounded ${getTramlineColor(day)}`}
                            />
                            <span className="text-sm font-medium">{day}</span>
                          </div>
                        ))}
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-8 rounded bg-muted" />
                          <span className="text-sm">Unassigned</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <TabsContent value="list" className="space-y-4">
                    <Accordion
                      type="single"
                      collapsible
                      className="w-full space-y-2"
                    >
                      {sortedScenesData.map((item, index) => (
                        <SceneItem
                          key={item.scene.id}
                          data={item}
                          index={index}
                          timeOfDayOptions={timeOfDayOptions}
                          sceneCost={sceneCostsMap.get(item.scene.id)}
                          getTramlineColor={getTramlineColor}
                          getTimeOfDayName={getTimeOfDayName}
                          formatCurrency={formatCurrency}
                          onUpdateLocal={updateLocalScene}
                          onSave={updateSceneField}
                          onUpdateCharacterStatus={(id, status) =>
                            updateCharacterField(id, "status", status)
                          }
                          onUpdateCharacterNotes={(id, notes) =>
                            updateCharacterField(id, "notes", notes)
                          }
                          onLocalUpdateCharacter={updateLocalSceneCharacter}
                          isSelected={selectedSceneIds.includes(item.scene.id)}
                          onToggleSelect={() =>
                            handleToggleSelect(item.scene.id)
                          }
                        />
                      ))}
                    </Accordion>
                  </TabsContent>

                  <TabsContent value="schedule" className="space-y-4">
                    <Accordion type="multiple" className="space-y-2">
                      {Object.entries(groupedScenes).map(
                        ([location, scenes]) => {
                          const uniqueCharactersMap = new Map<
                            string,
                            string
                          >();
                          scenes.forEach((item) =>
                            item.characters.forEach((char) =>
                              uniqueCharactersMap.set(char.id, char.name)
                            )
                          );
                          const uniqueCharacterNames = Array.from(
                            uniqueCharactersMap.values()
                          ).sort();
                          const totalEighths = scenes.reduce(
                            (sum, item) =>
                              sum + (item.scene.length_in_eighths ?? 0),
                            0
                          );
                          const totalCost = scenes.reduce(
                            (sum, item) =>
                              sum + (sceneCostsMap.get(item.scene.id) ?? 0),
                            0
                          );
                          const firstScene = scenes[0];
                          return (
                            <AccordionItem
                              key={location}
                              value={location}
                              className="border rounded-lg"
                            >
                              <AccordionTrigger className="hover:no-underline px-4">
                                <div className="flex items-center w-full gap-3">
                                  <div
                                    className={`w-1 h-12 rounded ${getTramlineColor(
                                      firstScene?.scene.shooting_day ?? null
                                    )}`}
                                  />
                                  <div className="flex flex-col items-start gap-2 text-left flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <CalendarClock className="h-5 w-5 text-primary" />
                                      <span className="font-semibold">
                                        {location}
                                      </span>
                                      <span className="text-sm font-normal text-muted-foreground">
                                        ({scenes.length} scenes)
                                      </span>
                                      {totalEighths > 0 && (
                                        <Badge
                                          variant="outline"
                                          className="text-xs"
                                        >
                                          {formatTimeFromEighths(totalEighths)}
                                        </Badge>
                                      )}
                                      {totalCost > 0 && (
                                        <Badge
                                          variant="secondary"
                                          className="text-xs bg-blue-600 text-white dark:bg-blue-500 dark:text-white"
                                        >
                                          {formatCurrency(totalCost)}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </AccordionTrigger>
                              <AccordionContent className="px-4 pt-2">
                                <div className="space-y-4">
                                  <Accordion
                                    type="single"
                                    collapsible
                                    className="w-full space-y-2"
                                  >
                                    {scenes.map((sceneItem) => {
                                      const originalIndex =
                                        sortedScenesData.findIndex(
                                          (s) =>
                                            s.scene.id ===
                                            sceneItem.scene.id
                                        );
                                      return (
                                        <SceneItem
                                          key={sceneItem.scene.id}
                                          data={sceneItem}
                                          index={
                                            originalIndex !== -1
                                              ? originalIndex
                                              : 0
                                          }
                                          timeOfDayOptions={timeOfDayOptions}
                                          sceneCost={sceneCostsMap.get(
                                            sceneItem.scene.id
                                          )}
                                          getTramlineColor={getTramlineColor}
                                          getTimeOfDayName={getTimeOfDayName}
                                          formatCurrency={formatCurrency}
                                          onUpdateLocal={updateLocalScene}
                                          onSave={updateSceneField}
                                          onUpdateCharacterStatus={(id, status) =>
                                            updateCharacterField(
                                              id,
                                              "status",
                                              status
                                            )
                                          }
                                          onUpdateCharacterNotes={(id, notes) =>
                                            updateCharacterField(
                                              id,
                                              "notes",
                                              notes
                                            )
                                          }
                                          onLocalUpdateCharacter={() => {}}
                                        />
                                      );
                                    })}
                                  </Accordion>
                                  {uniqueCharacterNames.length > 0 ? (
                                    <div>
                                      <h4 className="text-sm font-medium mb-2">
                                        Cast:
                                      </h4>
                                      <div className="flex flex-wrap gap-1">
                                        {uniqueCharacterNames.map((name) => (
                                          <span
                                            key={name}
                                            className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs"
                                          >
                                            {name}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-muted-foreground">
                                      No characters in this group.
                                    </p>
                                  )}
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          );
                        }
                      )}
                    </Accordion>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function SchedulingPage() {
  return (
    <SessionAuth>
      <SchedulingPageInner />
    </SessionAuth>
  );
}
