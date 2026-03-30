"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
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
import { Loader2, DollarSign, RefreshCw, Film, Calculator } from "lucide-react";
import { useBudget } from "./useBudget";
import { BUDGET_STRATEGIES } from "./types";
import type { BudgetLineItem } from "./types";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function BudgetingPageInner() {
  const params = useParams();
  const projectId =
    typeof params.projectId === "string"
      ? params.projectId
      : params.projectId?.[0];

  const {
    loading,
    project,
    budgetData,
    totalBudget,
    setTotalBudget,
    strategy,
    setStrategy,
    generating,
    toastMessage,
    clearToast,
    refresh,
    generateBudget,
  } = useBudget(projectId ?? null);

  const templateItems =
    budgetData?.lineItems?.filter((i) => i.view_type === "template") ?? [];
  const timelineItems =
    budgetData?.lineItems?.filter((i) => i.view_type === "timeline") ?? [];
  const marketingItems =
    budgetData?.lineItems?.filter((i) => i.view_type === "marketing") ?? [];

  const groupedTemplate = templateItems.reduce(
    (acc: Record<string, BudgetLineItem[]>, item) => {
      const cat = item.category ?? "Other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    },
    {}
  );

  const phases = Array.from(
    new Set(timelineItems.map((i) => i.phase).filter(Boolean))
  ) as string[];
  const timelineRowNames = Array.from(
    new Set(timelineItems.map((i) => i.item_name))
  );

  const groupedMarketing = marketingItems.reduce(
    (acc: Record<string, BudgetLineItem[]>, item) => {
      const cat = item.category ?? "Other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    },
    {}
  );

  const handleTotalBudgetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^\d]/g, "");
    const formatted = value ? parseInt(value, 10).toLocaleString("en-GB") : "";
    setTotalBudget(formatted);
  };

  const handleGenerate = () => {
    generateBudget(totalBudget, "GBP", strategy);
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
            href={`/project/${projectId}/scheduling`}
            className="text-primary hover:underline text-sm"
          >
            ← Back to Scheduling
          </Link>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <div className="flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Budget Management
            </h1>
          </div>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {budgetData?.budget && (
            <Button variant="default" size="sm" asChild>
              <Link href={`/project/${projectId}/scene-costs`}>
                <Film className="h-4 w-4 mr-2" />
                Scene Costs
              </Link>
            </Button>
          )}
        </div>

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-2">
                <Label htmlFor="budget">Total Budget (£)</Label>
                <Input
                  id="budget"
                  type="text"
                  placeholder="500,000"
                  value={totalBudget}
                  onChange={handleTotalBudgetChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="strategy">Budget Strategy</Label>
                <Select value={strategy} onValueChange={setStrategy}>
                  <SelectTrigger id="strategy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUDGET_STRATEGIES.map((strat) => (
                      <SelectItem key={strat.value} value={strat.value}>
                        <div>
                          <div className="font-medium">{strat.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {strat.description}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-transparent">Action</Label>
                <Button
                  onClick={handleGenerate}
                  disabled={generating || !totalBudget}
                  className="w-full"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <DollarSign className="h-4 w-4 mr-2" />
                      Generate Budget
                    </>
                  )}
                </Button>
              </div>
              {budgetData?.budget && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">
                    Current Budget
                  </Label>
                  <div className="text-2xl font-bold text-primary">
                    {formatCurrency(
                      Number(budgetData.budget.total_budget) || 0
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="template" className="w-full">
          <div className="mb-6 overflow-x-auto">
            <TabsList className="h-12 min-w-max rounded-full bg-secondary p-1 border border-border/50 shadow-inner">
              <TabsTrigger
                value="template"
                className="rounded-full px-4 sm:px-8 py-2.5 text-sm font-semibold transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-background/40 data-[state=inactive]:hover:text-foreground"
              >
                Budget
              </TabsTrigger>
              <TabsTrigger
                value="timeline"
                className="rounded-full px-4 sm:px-8 py-2.5 text-sm font-semibold transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-background/40 data-[state=inactive]:hover:text-foreground"
              >
                Timeline
              </TabsTrigger>
              <TabsTrigger
                value="marketing"
                className="rounded-full px-4 sm:px-8 py-2.5 text-sm font-semibold transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-background/40 data-[state=inactive]:hover:text-foreground"
              >
                Marketing
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="template" className="space-y-4">
            {Object.keys(groupedTemplate).length > 0 ? (
              Object.entries(groupedTemplate).map(([category, items]) => (
                <Card key={category}>
                  <CardContent className="pt-6">
                    <CardTitle className="mb-4">{category}</CardTitle>
                    <div className="space-y-2">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between items-center p-3 bg-accent/5 rounded-lg"
                        >
                          <div className="flex-1">
                            <div className="font-medium">
                              {item.account_code
                                ? `${item.account_code} - ${item.item_name}`
                                : item.item_name}
                            </div>
                            {item.notes && (
                              <div className="text-sm text-muted-foreground">
                                {item.notes}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="font-semibold">
                              {formatCurrency(
                                Number(item.estimated_amount) || 0
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {item.percentage != null &&
                              !isNaN(Number(item.percentage))
                                ? Number(item.percentage).toFixed(2)
                                : "0.00"}
                              %
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between items-center p-3 bg-primary/10 rounded-lg font-bold">
                        <div>Subtotal</div>
                        <div>
                          {formatCurrency(
                            items.reduce(
                              (sum, i) =>
                                sum + (Number(i.estimated_amount) || 0),
                              0
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Calculator className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <h3 className="text-lg font-semibold mb-2">
                    No Template Items
                  </h3>
                  <p>
                    Generate a budget above to see account code breakdown
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="timeline" className="space-y-4">
            {timelineItems.length > 0 ? (
              <Card>
                <CardContent className="pt-6 overflow-x-auto">
                  <p className="text-xs text-muted-foreground mb-2 md:hidden">
                    Scroll horizontally to view the full timeline matrix.
                  </p>
                  <div className="min-w-[800px]">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b-2 border-border">
                          <th className="text-left p-3 font-semibold">
                            Category
                          </th>
                          {phases.map((phase) => (
                            <th
                              key={phase}
                              className="text-right p-3 font-semibold"
                            >
                              {phase}
                            </th>
                          ))}
                          <th className="text-right p-3 font-semibold bg-accent/10">
                            TOTAL
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {timelineRowNames.map((itemName) => {
                          const itemsByPhase = timelineItems.filter(
                            (i) => i.item_name === itemName
                          );
                          const rowTotal = itemsByPhase.reduce(
                            (sum, i) =>
                              sum + (Number(i.estimated_amount) || 0),
                            0
                          );
                          return (
                            <tr
                              key={itemName}
                              className="border-b border-border/40 hover:bg-accent/5"
                            >
                              <td className="p-3 font-medium">{itemName}</td>
                              {phases.map((phase) => {
                                const phaseItem = itemsByPhase.find(
                                  (i) => i.phase === phase
                                );
                                const amount = phaseItem
                                  ? Number(phaseItem.estimated_amount) || 0
                                  : 0;
                                return (
                                  <td
                                    key={phase}
                                    className="text-right p-3"
                                  >
                                    {amount > 0
                                      ? formatCurrency(amount)
                                      : "—"}
                                  </td>
                                );
                              })}
                              <td className="text-right p-3 font-semibold bg-accent/10">
                                {formatCurrency(rowTotal)}
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="border-t-2 border-border bg-primary/5 font-bold">
                          <td className="p-3">PHASE TOTAL</td>
                          {phases.map((phase) => {
                            const phaseTotal = timelineItems
                              .filter((i) => i.phase === phase)
                              .reduce(
                                (sum, i) =>
                                  sum + (Number(i.estimated_amount) || 0),
                                0
                              );
                            return (
                              <td
                                key={phase}
                                className="text-right p-3"
                              >
                                {formatCurrency(phaseTotal)}
                              </td>
                            );
                          })}
                          <td className="text-right p-3 bg-primary/10">
                            {formatCurrency(
                              timelineItems.reduce(
                                (sum, i) =>
                                  sum + (Number(i.estimated_amount) || 0),
                                0
                              )
                            )}
                          </td>
                        </tr>
                        <tr className="bg-accent/10 font-semibold">
                          <td className="p-3">CUMULATIVE SPEND</td>
                          {(() => {
                            let cumulative = 0;
                            return phases.map((phase) => {
                              const phaseTotal = timelineItems
                                .filter((i) => i.phase === phase)
                                .reduce(
                                  (sum, i) =>
                                    sum + (Number(i.estimated_amount) || 0),
                                  0
                                );
                              cumulative += phaseTotal;
                              return (
                                <td
                                  key={phase}
                                  className="text-right p-3"
                                >
                                  {formatCurrency(cumulative)}
                                </td>
                              );
                            });
                          })()}
                          <td className="text-right p-3 bg-primary/10">
                            {formatCurrency(
                              timelineItems.reduce(
                                (sum, i) =>
                                  sum + (Number(i.estimated_amount) || 0),
                                0
                              )
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Calculator className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <h3 className="text-lg font-semibold mb-2">
                    No Timeline Items
                  </h3>
                  <p>
                    Generate a budget above to see production phase breakdown
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="marketing" className="space-y-4">
            {marketingItems.length > 0 ? (
              <>
                {Object.entries(groupedMarketing).map(([category, items]) => (
                  <Card key={category}>
                    <CardContent className="pt-6">
                      <CardTitle className="mb-4">{category}</CardTitle>
                      <div className="space-y-2">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="flex justify-between items-center p-3 bg-accent/5 rounded-lg"
                          >
                            <div className="flex-1">
                              <div className="font-medium">{item.item_name}</div>
                              {item.notes && (
                                <div className="text-sm text-muted-foreground">
                                  {item.notes}
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="font-semibold">
                                {formatCurrency(
                                  Number(item.estimated_amount) || 0
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                        <div className="flex justify-between items-center p-3 bg-primary/10 rounded-lg font-bold">
                          <div>Subtotal</div>
                          <div>
                            {formatCurrency(
                              items.reduce(
                                (sum, i) =>
                                  sum + (Number(i.estimated_amount) || 0),
                                0
                              )
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex justify-between items-center p-4 bg-gradient-to-r from-primary/20 to-primary/10 rounded-lg">
                      <div className="text-lg font-bold">
                        TOTAL MARKETING BUDGET
                      </div>
                      <div className="text-xl font-bold text-primary">
                        {formatCurrency(
                          marketingItems.reduce(
                            (sum, i) =>
                              sum + (Number(i.estimated_amount) || 0),
                            0
                          )
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Calculator className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <h3 className="text-lg font-semibold mb-2">
                    No Marketing Items
                  </h3>
                  <p>
                    Generate a budget above to see festival & marketing
                    breakdown
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
}

export default function BudgetingPage() {
  return (
    <SessionAuth>
      <BudgetingPageInner />
    </SessionAuth>
  );
}
