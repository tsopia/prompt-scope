"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  GitCompare,
  List,
  Settings,
  User,
} from "lucide-react";

import { useProject } from "@/contexts/ProjectContext";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STORAGE_KEY = "promptscope.sidebarCollapsed";

const NAV_ITEMS = [
  { href: "/traces", label: "Traces", icon: List },
  { href: "/compare", label: "Compare", icon: GitCompare },
  { href: "/prompts", label: "Prompts", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const { projects, currentProject, setCurrentProject } = useProject();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setCollapsed(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "flex h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200",
          collapsed ? "w-14" : "w-60"
        )}
      >
        {/* Logo */}
        <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
          <Link
            href="/traces"
            className="truncate text-lg font-bold text-foreground"
          >
            {collapsed ? "PS" : "PromptScope"}
          </Link>
        </div>

        {/* Project switcher */}
        <div className="border-b border-border p-2">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex h-8 w-full items-center justify-center rounded-md text-muted-foreground">
                  <List className="h-4 w-4" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                {currentProject?.name ?? "无项目"}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Select
              value={currentProject?.id ?? ""}
              onValueChange={(value) => {
                const p = projects.find((x) => x.id === value);
                if (p) setCurrentProject(p);
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="无项目" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-2">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname?.startsWith(href) ?? false;
            const link = (
              <Link
                key={href}
                href={href}
                className={cn(
                  "relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  active && "bg-accent text-primary",
                  collapsed && "justify-center px-0"
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                )}
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            );

            if (!collapsed) return link;

            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="space-y-2 border-t border-border p-2">
          <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
            <ThemeToggle />
          </div>

          {!collapsed && (
            <div className="px-1 text-xs text-muted-foreground">v0.5.0</div>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "flex h-8 items-center gap-2 rounded-md px-1 text-muted-foreground",
                  collapsed && "justify-center px-0"
                )}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="h-3.5 w-3.5" />
                </span>
                {!collapsed && <span className="text-xs">账户</span>}
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">登录功能规划中</TooltipContent>
          </Tooltip>

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
            className="flex h-8 w-full items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
