import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";

interface Crumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  crumbs: Crumb[];
  actions?: ReactNode;
}

export function PageHeader({ crumbs, actions }: PageHeaderProps) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
      <nav className="flex items-center gap-1.5 text-sm">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              {index > 0 && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={
                    isLast
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {crumb.label}
                </span>
              )}
            </Fragment>
          );
        })}
      </nav>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
