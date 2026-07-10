"use client";
import { useRouter } from "next/navigation";
import { TraceSummary } from "@/lib/api";
import { formatCost, formatCostFull, formatLatency, formatRelativeTime, formatTokens } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, StatusBadgeKind } from "@/components/StatusBadge";
import { MetricText } from "@/components/MetricText";
import { cn } from "@/lib/utils";

const LATENCY_WARN_MS = 8000;

const COLUMN_COUNT = 11;

function traceStatus(t: TraceSummary): { kind: StatusBadgeKind; label: string } {
  if (t.status === "success" && t.divergence_count > 0) return { kind: "warning", label: "偏离" };
  if (t.status === "error") return { kind: "error", label: "失败" };
  if (t.status === "running") return { kind: "running", label: "运行中" };
  return { kind: "success", label: "通过" };
}

const HEAD_CLASS = "sticky top-0 z-10 whitespace-nowrap bg-surface-2 text-[11.5px] font-semibold tracking-wide text-text-3";

export function TraceTable({
  traces,
  compareIds,
  onToggleCompare,
  onToggleAll,
  loading,
}: {
  traces: TraceSummary[];
  compareIds: string[];
  onToggleCompare: (id: string) => void;
  onToggleAll: () => void;
  loading?: boolean;
}) {
  const router = useRouter();

  const visibleIds = traces.map((t) => t.id);
  const selectedVisible = visibleIds.filter((id) => compareIds.includes(id));
  const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;

  return (
    <Table className="min-w-[1180px] table-fixed">
      <colgroup>
        <col style={{ width: 44 }} />
        <col />
        <col style={{ width: 96 }} />
        <col style={{ width: 104 }} />
        <col style={{ width: 190 }} />
        <col style={{ width: 70 }} />
        <col style={{ width: 106 }} />
        <col style={{ width: 106 }} />
        <col style={{ width: 100 }} />
        <col style={{ width: 92 }} />
        <col style={{ width: 118 }} />
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD_CLASS}>
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={onToggleAll}
              aria-label="全选"
              disabled={visibleIds.length === 0}
            />
          </TableHead>
          <TableHead className={HEAD_CLASS}>名称</TableHead>
          <TableHead className={HEAD_CLASS}>来源</TableHead>
          <TableHead className={HEAD_CLASS}>状态</TableHead>
          <TableHead className={HEAD_CLASS}>模型</TableHead>
          <TableHead className={cn(HEAD_CLASS, "text-right")}>步数</TableHead>
          <TableHead className={cn(HEAD_CLASS, "text-right")}>输入</TableHead>
          <TableHead className={cn(HEAD_CLASS, "text-right")}>输出</TableHead>
          <TableHead className={cn(HEAD_CLASS, "text-right")}>成本</TableHead>
          <TableHead className={cn(HEAD_CLASS, "text-right")}>延迟</TableHead>
          <TableHead className={cn(HEAD_CLASS, "text-right")}>创建时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {Array.from({ length: COLUMN_COUNT }).map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : traces.map((t) => {
              const selected = compareIds.includes(t.id);
              const st = traceStatus(t);
              const warnLatency = (t.latency_ms ?? 0) >= LATENCY_WARN_MS;
              return (
                <TableRow
                  key={t.id}
                  onClick={() => router.push(`/traces/${t.id}`)}
                  className={cn(
                    "h-[58px] cursor-pointer border-b-border-soft",
                    selected ? "border-l-2 border-l-primary bg-primary/10" : "border-l-2 border-l-transparent",
                  )}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => onToggleCompare(t.id)}
                      aria-label={`选中 ${t.name || t.id.slice(0, 8)}`}
                    />
                  </TableCell>
                  <TableCell className="max-w-0">
                    <div className="flex flex-col gap-0.5 overflow-hidden">
                      <span className="truncate text-[13.5px] font-medium text-foreground">
                        {t.name || t.id.slice(0, 8)}
                      </span>
                      <span className="truncate font-mono text-[11px] text-text-3">{t.id}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind={t.origin === "replay" ? "replay" : "live"} label={t.origin === "replay" ? "回放" : "实时"} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind={st.kind} label={st.label} />
                  </TableCell>
                  <TableCell className="max-w-0">
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {t.model_summary || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <MetricText value={String(t.observation_count)} className="text-muted-foreground" />
                  </TableCell>
                  <TableCell className="text-right">
                    <MetricText value={formatTokens(t.total_input_tokens)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MetricText value={formatTokens(t.total_output_tokens)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MetricText
                      value={formatCost(t.total_cost)}
                      title={formatCostFull(t.total_cost)}
                      className="text-muted-foreground"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <MetricText
                      value={formatLatency(t.latency_ms)}
                      className={warnLatency ? "text-warning-foreground" : "text-muted-foreground"}
                    />
                  </TableCell>
                  <TableCell className="text-right text-xs text-text-3">
                    {formatRelativeTime(t.created_at)}
                  </TableCell>
                </TableRow>
              );
            })}
      </TableBody>
    </Table>
  );
}
