"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode, type SVGProps } from "react";
import { LogOut, Monitor, Moon, Plus, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { useProject } from "@/contexts/ProjectContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSidebar } from "@/components/layout/SidebarContext";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { api, type Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Icons below are copied verbatim (viewBox/paths) from docs/design/Traces.dc.html's
// _injectIcons() nav + theme SVG maps, with stroke colors swapped from the design's
// var(--accent)/currentColor to plain currentColor so they inherit our token classes.
export function LogoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.4" opacity="0.9" />
      <circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <path
        d="M12 0.6V4.2M12 19.8V23.4M0.6 12H4.2M19.8 12H23.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M7 9l5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TracesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="6" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6" cy="18" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8.4 6H14a2.5 2.5 0 012.5 2.5V10M8.4 18H14a2.5 2.5 0 002.5-2.5V14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CompareIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="3.5" y="4.5" width="7" height="15" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13.5" y="4.5" width="7" height="15" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function PromptsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M5 5l4 4-4 4M11 15h7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M4 7h10M4 12h16M4 17h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="17" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="14" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/traces", label: "链路", icon: TracesIcon },
  { href: "/compare", label: "对比", icon: CompareIcon },
  { href: "/prompts", label: "提示词", icon: PromptsIcon },
  { href: "/settings", label: "设置", icon: SettingsIcon },
] as const;

const THEME_OPTS = [
  { key: "light", label: "亮", tooltip: "浅色", icon: Sun },
  { key: "dark", label: "暗", tooltip: "深色", icon: Moon },
  { key: "system", label: "系统", tooltip: "跟随系统", icon: Monitor },
] as const;

function ThemeSegmented({ collapsed }: { collapsed: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className={collapsed ? "h-[92px] w-[26px]" : "h-8 w-full"} />;

  return (
    <div
      className={cn(
        "flex gap-0.5 rounded-md border border-border-soft bg-bg-grid p-0.5",
        collapsed ? "flex-col" : "flex-row"
      )}
    >
      {THEME_OPTS.map(({ key, label, tooltip, icon: Icon }) => {
        const active = theme === key;
        const button = (
          <button
            key={key}
            type="button"
            title={tooltip}
            aria-label={tooltip}
            onClick={() => setTheme(key)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-[7px] font-sans text-xs font-semibold transition-colors",
              collapsed ? "h-[26px] w-[26px]" : "h-[30px] flex-1 px-1.5",
              active
                ? "bg-surface-2 text-primary shadow-[inset_0_0_0_1px_hsl(var(--border))]"
                : "text-text-3 hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {!collapsed && <span>{label}</span>}
          </button>
        );
        return collapsed ? (
          <Tooltip key={key}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="right">{tooltip}</TooltipContent>
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}

function initialOf(text: string | undefined | null): string {
  if (!text) return "?";
  const ch = Array.from(text.trim())[0] ?? "?";
  return /[a-z]/.test(ch) ? ch.toUpperCase() : ch;
}

function WorkspaceAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-xs font-bold text-primary-foreground",
        className
      )}
      style={{ background: "linear-gradient(140deg, hsl(var(--primary)), hsl(var(--replay)))" }}
    >
      {initialOf(name)}
    </span>
  );
}

function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { projects, currentProject, setCurrentProject, refreshProjects } = useProject();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (collapsed) setOpen(false);
  }, [collapsed]);

  const pick = (p: Project) => {
    setCurrentProject(p);
    setOpen(false);
  };

  const openCreate = () => {
    setOpen(false);
    setCreateOpen(true);
  };

  const handleCreated = async (p: Project) => {
    await refreshProjects();
    setCurrentProject(p);
    setOpen(false);
  };

  const trigger = (
    <button
      type="button"
      aria-label="切换项目"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
      className={cn(
        "flex h-11 w-full items-center gap-2.5 rounded-[10px] border border-border bg-surface-2 font-sans text-foreground",
        collapsed ? "justify-center px-0" : "px-2.5"
      )}
    >
      <WorkspaceAvatar name={currentProject?.name ?? "无"} />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold">
            {currentProject?.name ?? "无项目"}
          </span>
          <ChevronDownIcon className="h-[15px] w-[15px] shrink-0 text-text-3" />
        </>
      )}
    </button>
  );

  return (
    <div className="relative mt-3.5">
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{currentProject?.name ?? "无项目"}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      {open && (
        <>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 min-w-[212px] rounded-[11px] border border-border bg-surface-2 p-1.5 shadow-lg">
            {projects.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">暂无项目</p>
            )}
            {projects.map((p) => {
              const active = p.id === currentProject?.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-label={p.name}
                  onClick={() => pick(p)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left font-sans",
                    active ? "bg-accent" : "hover:bg-accent"
                  )}
                >
                  <WorkspaceAvatar name={p.name} className="h-[22px] w-[22px] text-[11px]" />
                  <span className="flex-1 truncate text-[13px] font-medium text-foreground">{p.name}</span>
                  {active && <CheckIcon className="h-[15px] w-[15px] shrink-0 text-primary" />}
                </button>
              );
            })}
            <div className="my-1.5 h-px bg-border-soft" />
            <button
              type="button"
              onClick={openCreate}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left font-sans text-primary hover:bg-accent"
            >
              <Plus className="h-[15px] w-[15px] shrink-0" />
              <span className="flex-1 truncate text-[13px] font-medium">新建项目</span>
            </button>
          </div>
        </>
      )}
      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
    </div>
  );
}

function AccountRow({ collapsed }: { collapsed: boolean }) {
  const { user, logout } = useAuth();
  const { currentProject } = useProject();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!currentProject || !user) {
      setRole(null);
      return;
    }
    api
      .getMembers(currentProject.id)
      .then((members) => {
        if (!active) return;
        const self = members.find((m) => m.user_id === user.id);
        setRole(self ? (self.role === "owner" ? "管理员" : "成员") : null);
      })
      .catch(() => {
        if (active) setRole(null);
      });
    return () => {
      active = false;
    };
  }, [currentProject, user]);

  const name = user?.display_name || user?.email || "";

  const avatar = (
    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] border border-border bg-accent text-xs font-bold text-foreground">
      {initialOf(name)}
    </span>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center justify-center overflow-hidden rounded-[10px] p-2">{avatar}</div>
        </TooltipTrigger>
        <TooltipContent side="right">{name}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="mt-2.5 flex items-center gap-2.5 overflow-hidden rounded-[10px] p-2">
      {avatar}
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[12.5px] font-semibold text-foreground" title={user?.email}>
          {name}
        </span>
        {role && <span className="truncate text-[11px] text-text-3">{role}</span>}
      </span>
      <button
        type="button"
        onClick={() => logout()}
        title="退出登录"
        aria-label="退出登录"
        className="shrink-0 text-text-3 hover:text-foreground"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function NavLink({
  href,
  label,
  Icon,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => ReactNode;
  active: boolean;
  collapsed: boolean;
}) {
  const link = (
    <Link
      href={href}
      className={cn(
        "relative flex h-[38px] items-center gap-[11px] rounded-[9px] text-[13.5px] font-medium transition-colors",
        collapsed ? "justify-center px-0" : "px-[11px]",
        active ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {!collapsed && (
        <span
          className={cn(
            "absolute -left-[11px] top-[9px] bottom-[9px] w-[3px] rounded-r-[3px]",
            active ? "bg-primary" : "bg-transparent"
          )}
        />
      )}
      <Icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { collapsed } = useSidebar();

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-card p-3 transition-[width] duration-150",
        collapsed ? "w-[66px]" : "w-[244px]"
      )}
    >
      {/* Brand */}
      <div className="flex h-[34px] items-center gap-2.5 overflow-hidden px-2 pb-1 pt-1.5">
        <LogoIcon className="shrink-0 text-primary" />
        {!collapsed && (
          <span className="truncate text-[15px] font-bold tracking-tight text-foreground">PromptScope</span>
        )}
      </div>

      <WorkspaceSwitcher collapsed={collapsed} />

      {/* Nav */}
      <nav className="mt-[18px] flex flex-col gap-[3px]">
        {NAV_ITEMS.map(({ href, label, icon }) => (
          <NavLink
            key={href}
            href={href}
            label={label}
            Icon={icon}
            active={pathname?.startsWith(href) ?? false}
            collapsed={collapsed}
          />
        ))}
      </nav>

      <div className="flex-1" />

      <ThemeSegmented collapsed={collapsed} />
      <AccountRow collapsed={collapsed} />
    </aside>
  );
}
