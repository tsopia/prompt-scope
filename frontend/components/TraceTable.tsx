"use client";
import { useRouter } from "next/navigation";
import { TraceSummary } from "@/lib/api";
import { formatCost, formatCostFull, formatLatency, formatTokens } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricText } from "@/components/MetricText";

function ModelBadges({ modelSummary }: { modelSummary: string }) {
  if (!modelSummary) return <span className="text-muted-foreground">—</span>;
  const models = modelSummary.split(",").map((m) => m.trim()).filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1">
      {models.map((m, i) => (
        <Badge key={`${m}-${i}`} variant="secondary" className="font-normal">
          {m}
        </Badge>
      ))}
    </div>
  );
}

const COLUMN_COUNT = 9;

export function TraceTable({
  traces,
  compareIds,
  onToggleCompare,
  loading,
}: {
  traces: TraceSummary[];
  compareIds: string[];
  onToggleCompare: (id: string) => void;
  loading?: boolean;
}) {
  const router = useRouter();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10"></TableHead>
          <TableHead>名称</TableHead>
          <TableHead>来源</TableHead>
          <TableHead>模型</TableHead>
          <TableHead className="text-right">步数</TableHead>
          <TableHead className="text-right">Tokens (in/out)</TableHead>
          <TableHead className="text-right">成本</TableHead>
          <TableHead className="text-right">延迟</TableHead>
          <TableHead>时间</TableHead>
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
              return (
                <TableRow
                  key={t.id}
                  onClick={() => router.push(`/traces/${t.id}`)}
                  className={`cursor-pointer ${selected ? "bg-accent/50" : ""}`}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => onToggleCompare(t.id)}
                      aria-label={`选中 ${t.name || t.id.slice(0, 8)}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{t.name || t.id.slice(0, 8)}</TableCell>
                  <TableCell>
                    <StatusBadge kind={t.origin === "replay" ? "replay" : "live"} />
                  </TableCell>
                  <TableCell>
                    <ModelBadges modelSummary={t.model_summary} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MetricText value={String(t.observation_count)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MetricText
                      value={`${formatTokens(t.total_input_tokens)} / ${formatTokens(t.total_output_tokens)}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <MetricText value={formatCost(t.total_cost)} title={formatCostFull(t.total_cost)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MetricText value={formatLatency(t.latency_ms)} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(t.created_at).toLocaleString("zh-CN")}
                  </TableCell>
                </TableRow>
              );
            })}
      </TableBody>
    </Table>
  );
}
