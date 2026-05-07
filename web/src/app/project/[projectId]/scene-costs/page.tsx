"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3,
  Calculator,
  Film,
  RefreshCw,
  Settings2,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";
import { useSceneCosts } from "./useSceneCosts";
import {
  BUDGET_STRATEGIES,
  getStatusLabel,
  getStatusColor,
  formatSceneCostCurrency,
  type SceneCost,
  type SceneCostConfig,
  type ProjectCostSummary,
  type LocationType,
} from "./types";

const LOCATION_OPTIONS: { value: LocationType; label: string }[] = [
  { value: "studio", label: "Studio" },
  { value: "local_interior", label: "Local Interior" },
  { value: "urban_exterior", label: "Urban Exterior" },
  { value: "remote", label: "Remote Location" },
];

function SceneCostBar({
  scene,
  maxCost,
  onSelect,
  isSelected,
  formatCurrency,
}: {
  scene: SceneCost;
  maxCost: number;
  onSelect: (sceneId: string) => void;
  isSelected: boolean;
  formatCurrency: (v: number) => string;
}) {
  const progress = maxCost > 0 ? (scene.finalCost / maxCost) * 100 : 0;
  const targetProgress = maxCost > 0 ? (scene.targetBudget / maxCost) * 100 : 0;
  const statusColorClass = getStatusColor(scene.status);

  return (
    <div
      className={`p-3 rounded-lg border cursor-pointer transition-all ${
        isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
      }`}
      onClick={() => onSelect(scene.sceneId)}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Film className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm truncate max-w-[170px] sm:max-w-[220px]">
            {scene.heading || `Scene ${scene.pageNumber || "?"}`}
          </span>
          {scene.eighths != null && (
            <Badge variant="outline" className="text-xs">
              {scene.eighths}/8
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{formatCurrency(scene.finalCost)}</span>
          <Badge className={`${statusColorClass} text-white text-xs`}>
            {scene.status === "under" && <TrendingDown className="w-3 h-3 mr-1" />}
            {scene.status === "over" && <TrendingUp className="w-3 h-3 mr-1" />}
            {scene.status === "on-target" && <Minus className="w-3 h-3 mr-1" />}
            {getStatusLabel(scene.status)}
          </Badge>
        </div>
      </div>
      <div className="relative h-3 bg-muted rounded-full overflow-hidden">
        <div
          className="absolute h-full w-0.5 bg-gray-400 z-10"
          style={{ left: `${Math.min(targetProgress, 100)}%` }}
        />
        <div
          className={`h-full rounded-full transition-all ${statusColorClass}`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
      <div className="flex justify-between mt-1 text-xs text-muted-foreground">
        <span>Target: {formatCurrency(scene.targetBudget)}</span>
      </div>
    </div>
  );
}

function SummaryCard({
  summary,
  config,
  formatCurrency,
}: {
  summary: ProjectCostSummary;
  config: SceneCostConfig;
  formatCurrency: (v: number) => string;
}) {
  const varianceIsPositive = summary.budgetVariance > 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Budget Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Total Budget</p>
            <p className="text-xl font-bold">{formatCurrency(config.totalBudget)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Scene Allocatable</p>
            <p className="text-xl font-bold">{formatCurrency(summary.allocatableBudget)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Base Cost/⅛</p>
            <p className="text-xl font-bold">{formatCurrency(summary.baseCostPerEighth)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Variance</p>
            <p
              className={`text-xl font-bold ${
                varianceIsPositive ? "text-red-500" : "text-green-500"
              }`}
            >
              {varianceIsPositive ? "+" : ""}
              {formatCurrency(summary.budgetVariance)}
              <span className="text-sm ml-1">
                ({varianceIsPositive ? "+" : ""}
                {summary.budgetVariancePercentage}%)
              </span>
            </p>
          </div>
        </div>
        <div className="border-t my-4" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
          <div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-2xl font-bold">{summary.scenesUnderBudget}</span>
            </div>
            <p className="text-sm text-muted-foreground">Under Budget</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <span className="text-2xl font-bold">{summary.scenesOnTarget}</span>
            </div>
            <p className="text-sm text-muted-foreground">On Target</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-2xl font-bold">{summary.scenesOverBudget}</span>
            </div>
            <p className="text-sm text-muted-foreground">Over Budget</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SceneDetailPanel({
  scene,
  formatCurrency,
}: {
  scene: SceneCost;
  formatCurrency: (v: number) => string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {scene.heading || `Scene ${scene.pageNumber || "?"}`}
        </CardTitle>
        <CardDescription>Cost Breakdown</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="text-sm">
            <div className="flex justify-between">
              <span>Base Cost ({scene.eighths ?? 1}/8):</span>
              <span className="font-medium">{formatCurrency(scene.baseCost)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>× Cast Modifier:</span>
              <span>{scene.castModifier}x</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>× Location Modifier:</span>
              <span>{scene.locationModifier}x</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>× Complexity:</span>
              <span>{scene.complexityModifier}x</span>
            </div>
            <div className="border-t my-2" />
            <div className="flex justify-between font-bold">
              <span>Final Cost:</span>
              <span>{formatCurrency(scene.finalCost)}</span>
            </div>
          </div>
          <div className="border-t" />
          <div>
            <p className="text-sm font-medium mb-2">Department Allocation</p>
            <div className="space-y-1">
              {[
                { label: "Cast", value: scene.castPercentage },
                { label: "Crew", value: scene.crewPercentage },
                { label: "Location", value: scene.locationPercentage },
                { label: "Art", value: scene.artPercentage },
                { label: "Logistics", value: scene.logisticsPercentage },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-20 text-xs text-muted-foreground">{label}</div>
                  <div className="h-2 flex-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.min(100, value)}%` }}
                    />
                  </div>
                  <div className="w-12 text-xs text-right">{value}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WhatIfPanel({
  scene,
  baseCostPerEighth,
  onApply,
  isApplying,
}: {
  scene: SceneCost;
  baseCostPerEighth: number;
  onApply: (modifiers: {
    locationType?: LocationType;
    isNightShoot?: boolean;
    hasStunts?: boolean;
    hasVfx?: boolean;
  }) => Promise<void>;
  isApplying: boolean;
}) {
  const [locationType, setLocationType] = useState<LocationType>("studio");
  const [isNightShoot, setIsNightShoot] = useState(false);
  const [hasStunts, setHasStunts] = useState(false);
  const [hasVfx, setHasVfx] = useState(false);

  const handleApply = () => {
    onApply({
      locationType,
      isNightShoot,
      hasStunts,
      hasVfx,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">What-If Analysis</CardTitle>
        <CardDescription>
          Adjust scene properties to preview cost changes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-sm">Location Type</Label>
          <Select
            value={locationType}
            onValueChange={(v) => setLocationType(v as LocationType)}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCATION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-sm">Complexity</Label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={isNightShoot ? "default" : "outline"}
              size="sm"
              onClick={() => setIsNightShoot(!isNightShoot)}
            >
              Night Shoot
            </Button>
            <Button
              type="button"
              variant={hasStunts ? "default" : "outline"}
              size="sm"
              onClick={() => setHasStunts(!hasStunts)}
            >
              Stunts
            </Button>
            <Button
              type="button"
              variant={hasVfx ? "default" : "outline"}
              size="sm"
              onClick={() => setHasVfx(!hasVfx)}
            >
              VFX
            </Button>
          </div>
        </div>
        <Button
          onClick={handleApply}
          disabled={isApplying}
          className="w-full"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isApplying ? "animate-spin" : ""}`} />
          Apply Changes & Recalculate
        </Button>
      </CardContent>
    </Card>
  );
}

function SceneCostsPageInner() {
  const params = useParams();
  const projectId =
    typeof params.projectId === "string"
      ? params.projectId
      : params.projectId?.[0];

  const {
    loading,
    calculating,
    project,
    config,
    sceneCosts,
    summary,
    selectedSceneId,
    setSelectedSceneId,
    toastMessage,
    clearToast,
    handleCalculate,
    handleUpdateConfig,
    handleUpdateModifiers,
  } = useSceneCosts(projectId ?? null);

  const [editShootDays, setEditShootDays] = useState(30);

  useEffect(() => {
    if (config) {
      setEditShootDays(config.shootDays);
    }
  }, [config]);

  const maxCost = Math.max(...sceneCosts.map((s) => s.finalCost), 1);
  const selectedScene = sceneCosts.find((s) => s.sceneId === selectedSceneId);
  const formatCurrency = formatSceneCostCurrency;

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <AppHeader />
        <main className="flex-1 flex items-center justify-center">
          <div className="animate-pulse flex flex-col gap-4 w-full max-w-2xl p-8">
            <div className="h-8 bg-muted rounded w-1/3" />
            <div className="h-32 bg-muted rounded" />
            <div className="h-64 bg-muted rounded" />
          </div>
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
          <Link href="/projects" className="text-primary underline mt-4 inline-block">
            Go to Projects
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  const onApplyConfig = () => {
    handleUpdateConfig(editShootDays);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <main className="flex-1 container px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Scene Costs: {project.name}</h1>
        </div>

        {toastMessage && (
          <div
            className={`mb-4 p-3 rounded-md text-sm ${
              toastMessage.variant === "destructive"
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary"
            }`}
          >
            <span className="font-medium">{toastMessage.title}</span>
            {toastMessage.description && (
              <span className="ml-2">{toastMessage.description}</span>
            )}
            <button
              type="button"
              onClick={clearToast}
              className="ml-2 underline"
              aria-label="Dismiss"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings2 className="w-5 h-5" />
                Scene Cost Configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-[200px]">
                  <Label>Shoot Days</Label>
                  <Input
                    type="number"
                    value={editShootDays}
                    onChange={(e) =>
                      setEditShootDays(parseInt(e.target.value, 10) || 30)
                    }
                    min={1}
                    max={365}
                    className="mt-1"
                  />
                </div>
                <div className="flex-1 min-w-[250px]">
                  <Label>Budget Strategy</Label>
                  <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                    <span className="flex-1 text-foreground">
                      {BUDGET_STRATEGIES.find((s) => s.value === config?.strategyId)?.label ?? "—"}
                    </span>
                    <Link
                      href={`/project/${projectId}/budgeting`}
                      className="shrink-0 text-xs text-primary/80 hover:text-primary hover:underline"
                    >
                      Change in Budgeting →
                    </Link>
                  </div>
                </div>
                <Button onClick={onApplyConfig} disabled={calculating} className="w-full sm:w-auto">
                  <RefreshCw
                    className={`w-4 h-4 mr-2 ${calculating ? "animate-spin" : ""}`}
                  />
                  Apply & Calculate
                </Button>
              </div>
              {config?.totalBudget === 0 && (
                <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded text-amber-700 dark:text-amber-400 text-sm">
                  No budget set for this project. Set a budget on the Budgeting page
                  first.
                  <Link
                    href={`/project/${projectId}/budgeting`}
                    className="ml-2 underline font-medium"
                  >
                    Go to Budgeting →
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {summary && config && (
            <SummaryCard
              summary={summary}
              config={config}
              formatCurrency={formatCurrency}
            />
          )}

          {sceneCosts.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-2">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <Film className="w-5 h-5" />
                    Scenes ({sceneCosts.length})
                  </h3>
                  <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
                    {sceneCosts.map((scene) => (
                      <SceneCostBar
                        key={scene.sceneId}
                        scene={scene}
                        maxCost={maxCost}
                        onSelect={setSelectedSceneId}
                        isSelected={selectedSceneId === scene.sceneId}
                        formatCurrency={formatCurrency}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  {selectedScene ? (
                    <Tabs defaultValue="detail">
                      <TabsList className="w-full">
                        <TabsTrigger value="detail" className="flex-1">
                          Detail
                        </TabsTrigger>
                        <TabsTrigger value="whatif" className="flex-1">
                          What-If
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="detail">
                        <SceneDetailPanel
                          scene={selectedScene}
                          formatCurrency={formatCurrency}
                        />
                      </TabsContent>
                      <TabsContent value="whatif">
                        <WhatIfPanel
                          scene={selectedScene}
                          baseCostPerEighth={summary?.baseCostPerEighth ?? 0}
                          onApply={async (modifiers) => {
                            await handleUpdateModifiers(
                              selectedScene.sceneId,
                              modifiers
                            );
                          }}
                          isApplying={calculating}
                        />
                      </TabsContent>
                    </Tabs>
                  ) : (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground">
                        Click a scene to view details
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Calculator className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Scene Costs Yet</h3>
                <p className="text-muted-foreground mb-4">
                  Calculate scene costs to see budget allocation by scene.
                </p>
                <Button onClick={handleCalculate} disabled={calculating}>
                  <Calculator className="w-4 h-4 mr-2" />
                  Calculate Scene Costs
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function SceneCostsPage() {
  return (
    <SessionAuth>
      <SceneCostsPageInner />
    </SessionAuth>
  );
}
