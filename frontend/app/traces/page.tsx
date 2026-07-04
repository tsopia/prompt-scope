"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, SearchX } from "lucide-react";
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

const ORIGINS = [
  { value: "", label: "全部" },
  { value: "live", label: "Live" },
  { value: "replay", label: "回放" },
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

  const toggleCompare = (id: string) =>
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
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
  const showOnboarding = !loading && !error && traces.length === 0 && !debouncedSearch;
  const showNoMatch = !loading && !error && traces.length === 0 && !!debouncedSearch;

  return (
    <div className={showTray ? "pb-24" : undefined}>
      <PageHeader crumbs={[{ label: "Traces" }]} />
      <main className="mx-auto max-w-6xl space-y-4 p-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">共 {total} 条</p>
          <div className="flex items-center gap-2">
            <Input
              className="w-56"
              placeholder="按名称搜索…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex rounded-md border border-input overflow-hidden">
              {ORIGINS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setOrigin(o.value)}
                  className={`px-3 py-1.5 text-xs ${
                    origin === o.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <EmptyState
            icon={AlertCircle}
            title="加载失败"
            description={error}
          />
        ) : showOnboarding ? (
          <OnboardingCard projectName={currentProject?.name} onRefresh={load} />
        ) : showNoMatch ? (
          <EmptyState icon={SearchX} title="没有匹配的 trace" description="换个关键词试试" />
        ) : (
          <Card className="overflow-x-auto">
            <TraceTable
              traces={traces}
              compareIds={compareIds}
              onToggleCompare={toggleCompare}
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
    </div>
  );
}
