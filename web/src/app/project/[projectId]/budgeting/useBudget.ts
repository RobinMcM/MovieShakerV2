"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { Project, BudgetData, BudgetLineItem } from "./types";

interface ProjectListItem {
  id: string;
  name: string;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  series?: string | null;
  episode?: string | null;
}

const BUDGET_BASE = "/api/budget/projects";

function parseBudgetResponse(raw: unknown): BudgetData | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.data != null && typeof obj.data === "object") {
    return obj.data as BudgetData;
  }
  return raw as BudgetData;
}

export function useBudget(projectId: string | null) {
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
  const [totalBudget, setTotalBudget] = useState("");
  const [strategy, setStrategy] = useState("producer-centric");
  const [generating, setGenerating] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    title: string;
    description?: string;
    variant?: "default" | "destructive";
  } | null>(null);

  const showToast = useCallback(
    (title: string, description?: string, variant?: "default" | "destructive") => {
      setToastMessage({ title, description, variant });
    },
    []
  );

  const loadProject = useCallback(
    async (pid: string) => {
      try {
        const list = await api.get<ProjectListItem[]>("/projects/");
        const arr = Array.isArray(list) ? list : [];
        const found = arr.find((p) => p.id === pid);
        if (found) {
          setProject({
            id: found.id,
            name: found.name,
            title: found.name,
            status: found.status,
            start_date: found.start_date ?? null,
            end_date: found.end_date ?? null,
            series: found.series ?? null,
            episode: found.episode ?? null,
          });
        } else {
          setProject(null);
        }
      } catch {
        setProject(null);
        showToast("Error", "Failed to load project details", "destructive");
      }
    },
    [showToast]
  );

  const loadBudget = useCallback(
    async (pid: string) => {
      try {
        const raw = await api.get<unknown>(`${BUDGET_BASE}/${pid}/budget`);
        const data = parseBudgetResponse(raw);
        setBudgetData(data ?? null);
        if (data?.budget) {
          if (data.budget.total_budget != null) {
            const val = Number(data.budget.total_budget);
            setTotalBudget(isNaN(val) ? "" : val.toLocaleString("en-GB"));
          }
          if (data.budget.template_id) {
            setStrategy(data.budget.template_id);
          }
        }
      } catch {
        setBudgetData(null);
        showToast("Error", "Failed to load budget data", "destructive");
      }
    },
    [showToast]
  );

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      await Promise.all([loadProject(projectId), loadBudget(projectId)]);
    } finally {
      setLoading(false);
    }
  }, [projectId, loadProject, loadBudget]);

  const generateBudget = useCallback(
    async (totalBudgetValue: string, currency: string, strategyValue: string) => {
      if (!projectId) return;
      const budgetValue = parseFloat(totalBudgetValue.replace(/[£,\s]/g, ""));
      if (isNaN(budgetValue) || budgetValue <= 0) {
        showToast("Error", "Please enter a valid budget amount", "destructive");
        return;
      }
      setGenerating(true);
      try {
        await api.post(`${BUDGET_BASE}/${projectId}/budget/generate`, {
          totalBudget: budgetValue,
          currency,
          strategy: strategyValue,
        });
        showToast("Success!", `Budget generated with ${currency} ${budgetValue.toLocaleString("en-GB")}`);
        await loadBudget(projectId);
      } catch {
        showToast("Error", "Failed to generate budget", "destructive");
      } finally {
        setGenerating(false);
      }
    },
    [projectId, loadBudget, showToast]
  );

  const updateLineItem = useCallback(
    async (id: string, data: Partial<BudgetLineItem>) => {
      if (!projectId) return;
      try {
        await api.put(`${BUDGET_BASE}/${projectId}/budget/line-items/${id}`, data);
        await loadBudget(projectId);
        showToast("Saved", "Line item updated");
      } catch {
        showToast("Error", "Failed to update line item", "destructive");
      }
    },
    [projectId, loadBudget, showToast]
  );

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setBudgetData(null);
      setTotalBudget("");
      setStrategy("producer-centric");
      return;
    }
    setLoading(true);
    Promise.all([loadProject(projectId), loadBudget(projectId)])
      .finally(() => setLoading(false));
  }, [projectId, loadProject, loadBudget]);

  return {
    loading,
    project,
    budgetData,
    totalBudget,
    setTotalBudget,
    strategy,
    setStrategy,
    generating,
    toastMessage,
    clearToast: () => setToastMessage(null),
    refresh,
    generateBudget,
    updateLineItem,
  };
}
