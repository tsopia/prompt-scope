"use client";

import Link from "next/link";
import { Fragment, type ReactNode, type SVGProps } from "react";

import { useSidebar } from "@/components/layout/SidebarContext";
import { useProject } from "@/contexts/ProjectContext";
import { cn } from "@/lib/utils";

interface Crumb {
  label: string;
  href?: string;
  mono?: boolean;
}

interface PageHeaderProps {
  crumbs: Crumb[];
  subtitle?: string;
  actions?: ReactNode;
}

// Copied verbatim from docs/design/Traces.dc.html's sidebar-collapse button icon.
function CollapseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 4.5v15" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function PageHeader({ crumbs, subtitle, actions }: PageHeaderProps) {
  const { toggleCollapsed } = useSidebar();
  const { currentProject } = useProject();
  const title = crumbs[crumbs.length - 1]?.label ?? "";

  return (
    <div className="shrink-0 px-8 pt-6">
      <div className="mb-2.5 flex items-center gap-1.5 text-[12.5px] text-text-3">
        <button
          type="button"
          onClick={toggleCollapsed}
          title="折叠侧边栏"
          aria-label="折叠侧边栏"
          className="-ml-1 mr-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <CollapseIcon />
        </button>
        {currentProject && (
          <>
            <span>{currentProject.name}</span>
            <span className="opacity-50">/</span>
          </>
        )}
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              {index > 0 && <span className="opacity-50">/</span>}
              {crumb.href && !isLast ? (
                <Link href={crumb.href} className={crumb.mono ? "font-mono hover:text-foreground" : "hover:text-foreground"}>
                  {crumb.label}
                </Link>
              ) : (
                <span className={cn(isLast && "text-muted-foreground", crumb.mono && "font-mono")}>
                  {crumb.label}
                </span>
              )}
            </Fragment>
          );
        })}
      </div>
      <div className="flex items-end justify-between gap-4 pb-5">
        <div>
          <h1 className="text-[23px] font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-[5px] text-[13px] text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2.5 pb-0.5">{actions}</div>}
      </div>
    </div>
  );
}
