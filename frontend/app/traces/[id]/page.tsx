"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { api, ObservationNode, TraceDetail } from "@/lib/api";
import { formatCost, formatLatency, formatTokens } from "@/lib/format";
import { TraceTree } from "@/components/TraceTree";
import { ObservationDetail } from "@/components/ObservationDetail";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge, StatusBadgeKind } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function flatten(nodes: ObservationNode[]): ObservationNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function nodeStatus(status: string): { kind: StatusBadgeKind; label: string } {
  if (status === "error") return { kind: "error", label: "失败" };
  if (status === "running") return { kind: "running", label: "运行中" };
  return { kind: "success", label: "通过" };
}

function traceStatus(trace: TraceDetail): { kind: StatusBadgeKind; label: string } {
  if (trace.status === "success" && trace.divergence_count > 0) return { kind: "warning", label: "偏离" };
  if (trace.status === "error") return { kind: "error", label: "失败" };
  if (trace.status === "running") return { kind: "running", label: "运行中" };
  return { kind: "success", label: "通过" };
}

export default function TraceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);

  useEffect(() => {
    api.getTrace(id)
      .then((t) => {
        setTrace(t);
        setSelectedId(t.observations[0]?.id ?? null);
      })
      .catch((e) => setError(String(e)));
  }, [id]);

  const flatNodes = useMemo(() => (trace ? flatten(trace.observations) : []), [trace]);
  const selected = useMemo(
    () => flatNodes.find((n) => n.id === selectedId) ?? null,
    [flatNodes, selectedId],
  );

  const handleRerun = async () => {
    const runId = trace?.metadata?.replay_run_id;
    if (typeof runId !== "string") return;
    setRerunning(true);
    try {
      const run = await api.getReplay(runId);
      const newRun = await api.createReplay({
        source_trace_id: run.source_trace_id,
        override_model: run.override_model ?? undefined,
        override_model_params: run.override_model_params ?? undefined,
        override_prompt_text: run.override_prompt_text ?? undefined,
        override_prompt_version_id: run.override_prompt_version_id ?? undefined,
      });
      if (newRun.status === "success" && newRun.result_trace_id) {
        toast.success("重跑完成，正在打开对比…");
        router.push(`/compare?a=${run.source_trace_id}&b=${newRun.result_trace_id}`);
      } else {
        toast.error(newRun.error || "重跑失败，请查看回放历史");
        router.push(`/replay/${run.source_trace_id}`);
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRerunning(false);
    }
  };

  if (error) return <main className="p-8 text-sm text-destructive">加载失败：{error}</main>;
  if (!trace) return <main className="p-8 text-sm text-muted-foreground">加载中…</main>;

  const traceName = trace.name || trace.id.slice(0, 8);
  const st = traceStatus(trace);
  const canStepReplay = trace.origin === "live" && selected?.type === "llm";
  const totalTokens = trace.total_input_tokens + trace.total_output_tokens;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "链路", href: "/traces" }, { label: trace.id, mono: true }]}
      />

      <main className="mx-auto max-w-6xl space-y-4 px-6 pb-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-[22px] font-bold tracking-tight">{traceName}</h1>
              <StatusBadge kind={trace.origin === "replay" ? "replay" : "live"} label={trace.origin === "replay" ? "回放" : "实时"} />
              <StatusBadge kind={st.kind} label={st.label} />
            </div>
            <div className="mt-3.5 flex flex-wrap items-center gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium text-text-3">总成本</span>
                <span className="font-mono text-[17px] font-semibold tabular-nums tracking-tight">
                  {formatCost(trace.total_cost)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium text-text-3">总延迟</span>
                <span className="font-mono text-[17px] font-semibold tabular-nums tracking-tight">
                  {formatLatency(trace.latency_ms)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium text-text-3">总 token</span>
                <span className="font-mono text-[17px] font-semibold tabular-nums tracking-tight">
                  {formatTokens(totalTokens)}
                  <span className="ml-1.5 text-[11px] font-normal text-text-3">
                    ↑{formatTokens(trace.total_input_tokens)} ↓{formatTokens(trace.total_output_tokens)}
                  </span>
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium text-text-3">步数</span>
                <span className="font-mono text-[17px] font-semibold tabular-nums tracking-tight">
                  {flatNodes.length}
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            {trace.origin === "live" && (
              <Button asChild className="gap-1.5">
                <Link href={`/replay/${trace.id}`}>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  回放整条
                </Link>
              </Button>
            )}
            {trace.origin === "replay" && trace.metadata?.replay_run_id !== undefined && (
              <Button variant="outline" className="gap-1.5" onClick={handleRerun} disabled={rerunning}>
                {rerunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                重跑
              </Button>
            )}
          </div>
        </div>

        <div className="flex min-h-0 gap-4">
          <Card className="w-[400px] shrink-0 overflow-hidden rounded-xl p-0">
            <div className="flex h-[42px] items-center justify-between border-b border-border-soft px-4">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground">调用链</span>
              <span className="font-mono text-[11.5px] text-text-3">{flatNodes.length} 步</span>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              <TraceTree nodes={trace.observations} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          </Card>

          <div className="min-w-0 flex-1">
            {selected ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center rounded-md border border-border-soft bg-bg-grid px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-muted-foreground">
                    {selected.type.toUpperCase()}
                  </span>
                  <h2 className="truncate text-[17px] font-semibold tracking-tight">
                    {selected.name || selected.id.slice(0, 8)}
                  </h2>
                  <StatusBadge kind={nodeStatus(selected.status).kind} label={nodeStatus(selected.status).label} />
                  {selected.type === "tool" && selected.metadata?.mocked === true && (
                    <span
                      title="回放模式下，该工具调用不会真正执行，返回的是录制时保存的结果。"
                      className="inline-flex cursor-help items-center gap-1.5 rounded-full bg-replay/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-replay-foreground"
                    >
                      mocked · 录制结果
                    </span>
                  )}
                  {canStepReplay && (
                    <Button asChild variant="outline" size="sm" className="ml-auto gap-1.5 border-primary/40 text-primary">
                      <Link href={`/replay/${trace.id}?target=${selected.id}`}>
                        <Play className="h-3.5 w-3.5 fill-current" />
                        单步回放此步
                      </Link>
                    </Button>
                  )}
                </div>
                <ObservationDetail node={selected} />
              </div>
            ) : (
              <div className="p-8 text-sm text-muted-foreground">点击左侧节点查看详情</div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
