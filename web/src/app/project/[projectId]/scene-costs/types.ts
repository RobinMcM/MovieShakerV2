/**
 * Scene Costs page types. Aligned with engine /api/scene-costs response shape.
 */

export type LocationType =
  | "studio"
  | "local_interior"
  | "urban_exterior"
  | "remote";

export type CostStatus = "under" | "on-target" | "over";

export interface SceneCostConfig {
  shootDays: number;
  strategyId: string;
  totalBudget: number;
  baseCostPerEighth?: number;
  allocatableBudget?: number;
}

export interface SceneCost {
  sceneId: string;
  heading?: string;
  pageNumber?: string;
  eighths?: number;
  baseCost: number;
  castModifier: number;
  locationModifier: number;
  complexityModifier: number;
  finalCost: number;
  targetBudget: number;
  status: CostStatus;
  castPercentage: number;
  crewPercentage: number;
  locationPercentage: number;
  artPercentage: number;
  logisticsPercentage: number;
}

export interface ProjectCostSummary {
  totalScenes: number;
  totalShootUnits: number;
  baseCostPerEighth: number;
  allocatableBudget: number;
  totalSceneCost: number;
  scenesUnderBudget: number;
  scenesOnTarget: number;
  scenesOverBudget: number;
  budgetVariance: number;
  budgetVariancePercentage: number;
}

export interface SceneCostsResponse {
  success: boolean;
  config: SceneCostConfig;
  sceneCosts: SceneCost[];
  summary?: ProjectCostSummary;
  message?: string;
}

export interface SceneModifiers {
  locationType?: LocationType;
  isNightShoot?: boolean;
  hasStunts?: boolean;
  hasVfx?: boolean;
  extrasCount?: number;
  creativeImpact?: number;
}

export interface BudgetStrategy {
  value: string;
  label: string;
  description: string;
}

export const BUDGET_STRATEGIES: BudgetStrategy[] = [
  {
    value: "producer-centric",
    label: "Producer-Centric",
    description: "Cost Control",
  },
  { value: "talent-driven", label: "Talent-Driven", description: "Actors First" },
  {
    value: "director-led",
    label: "Director-Led",
    description: "Creative Priority",
  },
  {
    value: "marketing-heavy",
    label: "Marketing-Heavy",
    description: "Audience Growth",
  },
  {
    value: "genre-optimized",
    label: "Genre-Optimized",
    description: "Best Practices",
  },
  {
    value: "fast-turnaround",
    label: "Fast Turnaround",
    description: "Quick Production",
  },
  {
    value: "investor-first",
    label: "Investor-First",
    description: "ROI Focus",
  },
];

export function getStatusLabel(status: CostStatus): string {
  switch (status) {
    case "under":
      return "Under Budget";
    case "on-target":
      return "On Target";
    case "over":
      return "Over Budget";
    default:
      return "Unknown";
  }
}

export function getStatusColor(status: CostStatus): string {
  switch (status) {
    case "under":
      return "bg-green-500";
    case "on-target":
      return "bg-amber-500";
    case "over":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}

export function formatSceneCostCurrency(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
