"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Code2, RefreshCw, Search, SearchX } from "lucide-react";
import { toast } from "sonner";
import { api, TraceSummary } from "@/lib/api";
import { useProject } from "@/contexts/ProjectContext";
import { useDebounce } from "@/lib/hooks";
import { TraceTable } from "@/components/TraceTable";
import { CompareTray } from "@/components/CompareTray";
import { OnboardingCard } from "@/components/OnboardingCard";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ORIGINS: { value: string; label: string; dotClassName?: string }[] = [
  { value: "", label: "全部" },
  { value: "live", label: "实时", dotClassName: "bg-live" },
  { value: "replay", label: "回放", dotClassName: "bg-replay" },
];

export default function TracesPage() {
  const { currentProject } = useProject();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [origin, setOrigin] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [sdkDialogOpen, setSdkDialogOpen] = useState(false);

  const toggleCompare = (id: string) =>
    setCompareIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleAll = () =>
    setCompareIds((prev) => {
      const visibleIds = traces.map((t) => t.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...prev, ...visibleIds]));
    });

  const load = useCallback(() => {
    if (!currentProject) return;
    setLoading(true);
    setError(null);
    api
      .getTraces({
        projectId: currentProject.id,
        origin: origin || undefined,
        search: debouncedSearch || undefined,
      })
      .then((r) => {
        setTraces(r.items);
        setTotal(r.total);
      })
      .catch((e) => {
        setError(String(e));
        toast.error("加载 trace 列表失败");
      })
      .finally(() => setLoading(false));
  }, [currentProject, origin, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  const compareSelected = traces.filter((t) => compareIds.includes(t.id));
  const showTray = compareIds.length > 0;
  const showOnboarding = !loading && !error && traces.length === 0 && !debouncedSearch && !origin;
  const showNoMatch = !loading && !error && traces.length === 0 && (!!debouncedSearch || !!origin);

  return (
    <div className={showTray ? "pb-24" : undefined}>
      <PageHeader
        crumbs={[{ label: "链路" }]}
        subtitle="agent 每次运行的完整调用链，实时上报与录制回放。"
        actions={
          <>
            <Button variant="outline" className="gap-1.5 border-border bg-background text-muted-foreground" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </Button>
            <Button
              variant="outline"
              className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
              onClick={() => setSdkDialogOpen(true)}
            >
              <Code2 className="h-3.5 w-3.5" />
              接入 SDK
            </Button>
          </>
        }
      />
      <main className="mx-auto max-w-6xl space-y-4 px-6 pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-[340px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
            <Input
              className="pl-9"
              placeholder="按名称搜索链路…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-0.5 rounded-lg border border-border bg-background p-0.5">
            {ORIGINS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setOrigin(o.value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-colors",
                  origin === o.value
                    ? "bg-surface-2 font-semibold text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]"
                    : "font-medium text-text-3 hover:text-foreground",
                )}
              >
                {o.dotClassName && <span className={cn("h-1.5 w-1.5 rounded-full", o.dotClassName)} />}
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <span className="font-mono text-xs tabular-nums text-text-3">
            {traces.length} 条 · 共 {total}
          </span>
        </div>

        {error ? (
          <EmptyState icon={AlertCircle} title="加载失败" description={error} />
        ) : showOnboarding ? (
          <OnboardingCard projectName={currentProject?.name} onRefresh={load} />
        ) : showNoMatch ? (
          origin ? (
            <EmptyState icon={SearchX} title="没有匹配的 trace" description="该来源下暂无 trace" />
          ) : (
            <EmptyState icon={SearchX} title="没有匹配的 trace" description="换个关键词试试" />
          )
        ) : (
          <Card className="overflow-x-auto rounded-xl">
            <TraceTable
              traces={traces}
              compareIds={compareIds}
              onToggleCompare={toggleCompare}
              onToggleAll={toggleAll}
              loading={loading}
            />
          </Card>
        )}
      </main>
      <CompareTray
        selected={compareSelected}
        onRemove={toggleCompare}
        onClear={() => setCompareIds([])}
      />

      <Dialog open={sdkDialogOpen} onOpenChange={setSdkDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>接入 SDK</DialogTitle>
          </DialogHeader>
          <OnboardingCard
            projectName={currentProject?.name}
            onRefresh={() => {
              load();
              setSdkDialogOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
