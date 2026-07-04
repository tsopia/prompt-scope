"use client";
import Link from "next/link";
import { X } from "lucide-react";
import { TraceSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";

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

  const canCompare = selected.length === 2;

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="flex max-w-2xl flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-2">
          {selected.map((t) => (
            <span
              key={t.id}
              className="inline-flex max-w-[180px] items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground"
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
          {canCompare ? (
            <Button asChild size="sm">
              <Link href={`/compare?a=${selected[0].id}&b=${selected[1].id}`}>开始对比</Link>
            </Button>
          ) : (
            <Button size="sm" disabled>
              开始对比
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClear}>
            清空
          </Button>
        </div>
      </div>
    </div>
  );
}
