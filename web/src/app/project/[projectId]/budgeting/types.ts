/**
 * Budgeting page types. Aligned with budget API response shape.
 * Engine/budget API returns { budget?, lineItems? }.
 */

export interface Project {
  id: string;
  name: string;
  title?: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  series: string | null;
  episode: string | null;
}

export interface Budget {
  total_budget: number | string;
  template_id?: string;
}

export type BudgetLineItemViewType =
  | "template"
  | "timeline"
  | "budget"
  | "marketing";

export interface BudgetLineItem {
  id: string;
  view_type: BudgetLineItemViewType;
  category?: string;
  phase?: string;
  account_code?: string;
  item_name: string;
  notes?: string | null;
  estimated_amount?: number | string | null;
  percentage?: number | string | null;
}

export interface BudgetData {
  budget?: Budget;
  lineItems?: BudgetLineItem[];
}

export interface BudgetStrategy {
  value: string;
  label: string;
  description: string;
}

export const BUDGET_STRATEGIES: BudgetStrategy[] = [
  { value: "producer-centric", label: "Producer-Centric", description: "Cost Control & Efficiency" },
  { value: "talent-driven", label: "Talent-Driven", description: "Actors First" },
  { value: "director-led", label: "Director-Led", description: "Creative Priority" },
  { value: "marketing-heavy", label: "Marketing-Heavy", description: "Audience Growth" },
  { value: "star-marketing", label: "Star + Marketing", description: "Celebrity & Promotion" },
  { value: "genre-optimized", label: "Genre-Optimized", description: "Category-Specific Allocation" },
  { value: "incentive-maximized", label: "Incentive-Maximized", description: "Tax Rebates & Credits" },
  { value: "festival-prestige", label: "Festival Prestige", description: "Awards & Recognition" },
  { value: "fast-turnaround", label: "Fast Turnaround", description: "Quick Production" },
  { value: "investor-first", label: "Investor-First", description: "ROI Optimization" },
];
