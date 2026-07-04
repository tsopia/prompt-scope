"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, TraceSummary } from "@/lib/api";
import { formatCost } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { MetricText } from "@/components/MetricText";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Inbox } from "lucide-react";

export function ReplayWithVersionDialog({
  versionId,
  projectId,
  open,
  onOpenChange,
}: {
  versionId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [traces, setTraces] = useState<TraceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTraces(null);
    setError(null);
    setSelectedId(null);
    api
      .getTraces({ projectId, origin: "live", limit: 50 })
      .then((r) => setTraces(r.items))
      .catch((e) => setError(String(e)));
  }, [open, projectId]);

  const goReplay = () => {
    if (!selectedId) return;
    router.push(`/replay/${selectedId}?promptVersion=${versionId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>用此版本回放</DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">加载失败：{error}</p>}
        {!error && traces === null && (
          <p className="text-sm text-muted-foreground">加载中…</p>
        )}
        {!error && traces !== null && traces.length === 0 && (
          <EmptyState icon={Inbox} title="暂无 live trace" description="该项目还没有可用于回放的 live trace。" />
        )}
        {!error && traces !== null && traces.length > 0 && (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {traces.map((t) => (
              <label
                key={t.id}
                className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                  selectedId === t.id ? "border-primary bg-accent/50" : "border-input"
                }`}
              >
                <input
                  type="radio"
                  name="replay-trace"
                  className="shrink-0"
                  checked={selectedId === t.id}
                  onChange={() => setSelectedId(t.id)}
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {t.name || t.id.slice(0, 8)}
                </span>
                <MetricText value={t.model_summary || "—"} className="shrink-0 text-xs text-muted-foreground" />
                <MetricText value={formatCost(t.total_cost)} className="shrink-0 text-xs" />
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button onClick={goReplay} disabled={!selectedId}>
            去回放
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
