import {
  BarChart3,
  Box,
  Calendar,
  Clapperboard,
  CreditCard,
  Eye,
  List,
  Palette,
  Settings,
  Ticket,
  Users,
} from "lucide-react";

export interface ProjectNavItem {
  id: string;
  label: string;
  href: (projectId: string) => string;
  icon: React.ComponentType<{ className?: string }>;
}

export const PROJECT_DEFAULT_ROUTE = "scheduling";

export const PROJECT_TOOL_NAV: ProjectNavItem[] = [
  {
    id: "scheduling",
    label: "Scheduling",
    href: (projectId) => `/project/${projectId}/scheduling`,
    icon: Calendar,
  },
  {
    id: "budgeting",
    label: "Budgeting",
    href: (projectId) => `/project/${projectId}/budgeting`,
    icon: BarChart3,
  },
  {
    id: "scene-costs",
    label: "Scene Costs",
    href: (projectId) => `/project/${projectId}/scene-costs`,
    icon: BarChart3,
  },
  {
    id: "castmanagement",
    label: "Cast Management",
    href: (projectId) => `/project/${projectId}/castmanagement`,
    icon: Users,
  },
  {
    id: "objects",
    label: "Objects",
    href: (projectId) => `/project/${projectId}/objects`,
    icon: Box,
  },
  {
    id: "shotlist",
    label: "Shot List",
    href: (projectId) => `/project/${projectId}/shotlist`,
    icon: List,
  },
  {
    id: "moodboard",
    label: "Mood Board",
    href: (projectId) => `/project/${projectId}/moodboard`,
    icon: Palette,
  },
  {
    id: "visualize",
    label: "Visualize",
    href: (projectId) => `/project/${projectId}/visualize`,
    icon: Eye,
  },
];

export const PROJECT_EXTERNAL_NAV: ProjectNavItem[] = [
  {
    id: "film-festival",
    label: "The Film Festival",
    href: (projectId) => `/the-film-festival?project=${projectId}`,
    icon: Ticket,
  },
  {
    id: "submit-funding",
    label: "Submit for Funding",
    href: (projectId) => `/submit-funding?project=${projectId}`,
    icon: CreditCard,
  },
  {
    id: "project-admin",
    label: "Administration",
    href: (projectId) => `/projectadministration?project=${projectId}`,
    icon: Settings,
  },
  {
    id: "film-in-a-box",
    label: "Film in a Box",
    href: (projectId) => `/film-in-a-box?project=${projectId}`,
    icon: Clapperboard,
  },
];
