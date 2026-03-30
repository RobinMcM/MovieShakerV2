"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, FileText, Home, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { PROJECT_EXTERNAL_NAV, PROJECT_TOOL_NAV } from "@/app/project/[projectId]/projectNav";
import { cn } from "@/lib/utils";

interface ScriptItem {
  id: string;
  name: string;
  is_current: boolean;
}

interface ProjectMobileNavProps {
  projectId: string;
  scripts: ScriptItem[];
  scriptsLoading?: boolean;
}

export function ProjectMobileNav({
  projectId,
  scripts,
  scriptsLoading = false,
}: ProjectMobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scriptsExpanded, setScriptsExpanded] = useState(true);

  const scriptLinks = useMemo(
    () => scripts.slice(0, 6).map((s) => ({ ...s, href: `/project/${projectId}/script/${s.id}` })),
    [scripts, projectId]
  );

  const onNavigate = () => setOpen(false);

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="md:hidden fixed top-4 left-4 z-[60] h-10 w-10 rounded-full shadow-lg"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={open ? "Close project navigation menu" : "Open project navigation menu"}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-0 left-0 right-auto bottom-0 h-screen max-h-screen w-[86vw] max-w-[340px] rounded-none border-r p-0">
          <DialogTitle className="sr-only">Project Navigation</DialogTitle>
          <div className="h-full overflow-y-auto p-4 space-y-5">
            <div>
              <h2 className="text-base font-semibold">Project Menu</h2>
            </div>

            <div className="space-y-1">
              <Link
                href="/"
                onClick={onNavigate}
                className="flex items-center gap-2 rounded-md px-2.5 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Home className="h-4 w-4" />
                <span>Home</span>
              </Link>
            </div>

            <nav className="space-y-1">
              {PROJECT_TOOL_NAV.map((item) => {
                const href = item.href(projectId);
                const isActive = pathname === href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    href={href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 py-2.5 text-sm transition-colors",
                      isActive
                        ? "bg-primary/15 text-primary font-medium"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="pt-3 border-t">
              <button
                type="button"
                onClick={() => setScriptsExpanded((v) => !v)}
                className="w-full flex items-center justify-between rounded-md px-2.5 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Scripts
                </span>
                {scriptsExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              {scriptsExpanded && (
                <div className="space-y-1 mt-1">
                  {scriptsLoading && (
                    <p className="text-xs text-muted-foreground px-2.5 py-1">Loading scripts...</p>
                  )}
                  {!scriptsLoading && scriptLinks.length === 0 && (
                    <p className="text-xs text-muted-foreground px-2.5 py-1">No scripts available.</p>
                  )}
                  {scriptLinks.map((s) => {
                    const isActive = pathname === s.href;
                    return (
                      <Link
                        key={s.id}
                        href={s.href}
                        onClick={onNavigate}
                        className={cn(
                          "block rounded-md px-2.5 py-2 text-xs truncate",
                          isActive
                            ? "bg-primary/15 text-primary font-medium"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                        title={s.name}
                      >
                        {s.is_current ? "Current: " : ""}
                        {s.name}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-3 border-t">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground px-2.5 mb-2">
                Additional Tools
              </p>
              <div className="space-y-1">
                {PROJECT_EXTERNAL_NAV.map((item) => {
                  const href = item.href(projectId);
                  const isActive = pathname === href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.id}
                      href={href}
                      onClick={onNavigate}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2.5 py-2.5 text-sm transition-colors",
                        isActive
                          ? "bg-primary/15 text-primary font-medium"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
