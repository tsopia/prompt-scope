"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ObservationNode, TraceDetail } from "@/lib/api";
import { formatCost, formatCostFull, formatLatency, formatTokens } from "@/lib/format";
import { TraceTree } from "@/components/TraceTree";
import { ObservationDetail } from "@/components/ObservationDetail";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricText } from "@/components/MetricText";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";

function flatten(nodes: ObservationNode[]): ObservationNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

export default function TraceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    api.getTrace(id)
      .then((t) => {
        setTrace(t);
        setSelectedId(t.observations[0]?.id ?? null);
      })
      .catch((e) => setError(String(e)));
  }, [id]);

  const selected = useMemo(() => {
    if (!trace || !selectedId) return null;
    return flatten(trace.observations).find((n) => n.id === selectedId) ?? null;
  }, [trace, selectedId]);

  if (error) return <main className="p-8 text-sm text-destructive">加载失败：{error}</main>;
  if (!trace) return <main className="p-8 text-sm text-muted-foreground">加载中…</main>;

  const traceName = trace.name || trace.id.slice(0, 8);

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Traces", href: "/traces" }, { label: traceName }]}
        actions={
          <>
            {trace.origin === "live" && (
              <Button asChild size="sm">
                <Link href={`/replay/${trace.id}`}>回放 ▶</Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href={`/compare?a=${trace.id}`}>加入对比</Link>
            </Button>
            {trace.origin === "live" && selected?.type === "llm" && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/replay/${trace.id}?target=${selected.id}`}>单点回放此步 ▶</Link>
              </Button>
            )}
            {trace.origin === "replay" && typeof trace.metadata?.source_trace_id === "string" && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/traces/${trace.metadata.source_trace_id}`}>源 trace</Link>
              </Button>
            )}
          </>
        }
      />

      <main className="mx-auto max-w-6xl space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <StatusBadge kind={trace.origin === "replay" ? "replay" : "live"} />
          {trace.status === "error" && <StatusBadge kind="error" />}
          <Separator orientation="vertical" className="h-4" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            <MetricText
              value={`${formatTokens(trace.total_input_tokens)} / ${formatTokens(trace.total_output_tokens)} tokens`}
            />
            <MetricText value={formatCost(trace.total_cost)} title={formatCostFull(trace.total_cost)} />
            <MetricText value={formatLatency(trace.latency_ms)} />
          </div>
        </div>

        <div className="grid grid-cols-[minmax(280px,2fr)_3fr] gap-4">
          <Card className="max-h-[70vh] overflow-y-auto">
            <div className="border-b px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">调用链路</p>
            </div>
            <TraceTree nodes={trace.observations} selectedId={selectedId} onSelect={setSelectedId} />
          </Card>
          <Card className="max-h-[70vh] overflow-y-auto">
            {selected ? (
              <ObservationDetail node={selected} />
            ) : (
              <div className="p-8 text-sm text-muted-foreground">点击左侧节点查看详情</div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
