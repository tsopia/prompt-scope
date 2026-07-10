"use client";
import Link from "next/link";
import { ArrowLeftRight, X } from "lucide-react";
import { TraceSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CompareTray({
  selected,
  onRemove,
  onClear,
}: {
  selected: TraceSummary[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (selected.length === 0) return null;

  const count = selected.length;
  const canCompare = count === 2;
  const hint =
    count === 2 ? "可开始对比" : count < 2 ? `还需选 ${2 - count} 条` : "对比仅支持 2 条，请取消部分";

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="flex max-w-3xl flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface-2 py-2.5 pl-5 pr-2.5 shadow-lg">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex h-[22px] min-w-6 items-center justify-center rounded-md bg-primary/15 px-1.5 font-mono text-xs font-semibold text-primary">
            {count}
          </span>
          <span className="whitespace-nowrap text-sm text-foreground">
            已选 <b className="font-semibold">{count}</b> 条链路
          </span>
          <span className="whitespace-nowrap text-xs text-text-3">{hint}</span>
        </div>
        <div className="hidden h-6 w-px bg-border sm:block" />
        <div className="flex flex-wrap items-center gap-2">
          {selected.map((t) => (
            <span
              key={t.id}
              className="inline-flex max-w-[160px] items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
            >
              <span className="truncate">{t.name || t.id.slice(0, 8)}</span>
              <button
                type="button"
                onClick={() => onRemove(t.id)}
                aria-label={`移除 ${t.name || t.id.slice(0, 8)}`}
                className="shrink-0 rounded-full hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClear}>
            清除
          </Button>
          {canCompare ? (
            <Button asChild size="sm" className={cn("gap-1.5")}>
              <Link href={`/compare?a=${selected[0].id}&b=${selected[1].id}`}>
                <ArrowLeftRight className="h-3.5 w-3.5" />
                开始对比
              </Link>
            </Button>
          ) : (
            <Button size="sm" disabled className="gap-1.5">
              <ArrowLeftRight className="h-3.5 w-3.5" />
              开始对比
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
