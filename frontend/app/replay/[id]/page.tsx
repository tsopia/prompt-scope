"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2, ChevronDown, ChevronRight as ChevronRightIcon, Info, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api, Divergence, JudgeModel, ObservationNode, PromptDetail, PromptSummary, ReplayRun, TraceDetail } from "@/lib/api";
import { formatCost, formatCostFull, formatLatency } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricText } from "@/components/MetricText";
import { CodeBlock } from "@/components/CodeBlock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

function flatten(nodes: ObservationNode[]): ObservationNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function modelSummary(trace: TraceDetail): string {
  const models = Array.from(
    new Set(flatten(trace.observations).filter((o) => o.type === "llm" && o.model).map((o) => o.model as string))
  ).sort();
  return models.join(", ");
}

function findSystemPrompt(node: ObservationNode | null | undefined): string {
  if (!node?.messages) return "";
  const sys = node.messages.find((m) => (m as Record<string, unknown>).role === "system");
  if (!sys) return "";
  const content = (sys as Record<string, unknown>).content;
  return typeof content === "string" ? content : "";
}

function runStatusKind(status: string): "success" | "error" | "running" {
  if (status === "success") return "success";
  if (status === "failed" || status === "error") return "error";
  return "running";
}

function DivergenceBadge({ type }: { type: string }) {
  if (type === "param_mismatch") return <StatusBadge kind="warning" label={type} />;
  if (type === "unrecorded_call") return <StatusBadge kind="error" label={type} />;
  // max_steps_exceeded / wall_clock_exceeded -> muted (no semantic StatusBadge kind fits; use secondary badge)
  return <Badge variant="secondary">{type}</Badge>;
}

function Json({ value }: { value: unknown }) {
  const code = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <CodeBlock code={code} />;
}

function DivergenceItem({ d }: { d: Divergence }) {
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex items-center gap-2">
        <DivergenceBadge type={d.type} />
        {d.tool && <span className="font-medium">{d.tool}</span>}
        <span className="text-xs text-muted-foreground">step {d.step}</span>
      </div>
      {d.recorded_input !== undefined && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">录制入参</p>
          <Json value={d.recorded_input} />
        </div>
      )}
      {d.actual_input !== undefined && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">实际入参</p>
          <Json value={d.actual_input} />
        </div>
      )}
      {d.arguments !== undefined && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">调用参数</p>
          <Json value={d.arguments} />
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}

function HistoryEntry({
  run,
  sourceId,
  defaultExpanded,
  isLast,
}: {
  run: ReplayRun;
  sourceId: string;
  defaultExpanded: boolean;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasDetail = Boolean(run.error) || (run.divergences && run.divergences.length > 0);

  return (
    <div className="relative pl-6">
      {!isLast && <div className="absolute bottom-0 left-[5px] top-5 w-px bg-border" />}
      <div className="absolute left-0 top-1.5">
        <StatusBadge kind={runStatusKind(run.status)} label="" className="h-2.5 w-2.5 rounded-full p-0" />
      </div>
      <div className="pb-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge kind={runStatusKind(run.status)} />
          {run.override_model && <MetricText value={run.override_model} className="text-xs" />}
          <span className="text-xs text-muted-foreground">{formatRelativeTime(run.created_at)}</span>
          {run.divergences && run.divergences.length > 0 && (
            <StatusBadge kind="warning" label={`${run.divergences.length} 处 divergence`} />
          )}
          {hasDetail && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
              详情
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {run.result_trace_id && (
              <>
                <Button asChild variant="outline" size="sm" className="h-6 px-2 text-xs">
                  <a href={`/compare?a=${sourceId}&b=${run.result_trace_id}`}>对比</a>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-6 px-2 text-xs">
                  <a href={`/traces/${run.result_trace_id}`}>查看 trace</a>
                </Button>
              </>
            )}
          </div>
        </div>
        {expanded && (
          <div className="mt-2 space-y-2">
            {run.error && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Error</p>
                <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {run.error}
                </p>
              </div>
            )}
            {run.divergences && run.divergences.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Divergences</p>
                {run.divergences.map((d, i) => (
                  <DivergenceItem key={i} d={d} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReplayContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetId = searchParams.get("target");
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [replays, setReplays] = useState<ReplayRun[]>([]);
  const [judgeModels, setJudgeModels] = useState<JudgeModel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("");
  const [prompt, setPrompt] = useState("");
  const [promptEdited, setPromptEdited] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const [libraryPrompts, setLibraryPrompts] = useState<PromptSummary[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [libraryDetail, setLibraryDetail] = useState<PromptDetail | null>(null);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [latestRunId, setLatestRunId] = useState<string | null>(null);

  const targetNode = useMemo(() => {
    if (!trace || !targetId) return null;
    return flatten(trace.observations).find((o) => o.id === targetId) ?? null;
  }, [trace, targetId]);

  useEffect(() => {
    api.getTrace(id)
      .then((t) => {
        setTrace(t);
        const target = targetId ? flatten(t.observations).find((o) => o.id === targetId) ?? null : null;
        setPrompt(findSystemPrompt(target ?? flatten(t.observations).find((o) => o.type === "llm")));
        api.getJudgeModels(t.project_id).then(setJudgeModels).catch(() => setJudgeModels([]));
      })
      .catch((e) => setLoadError(String(e)));
    api.getReplays(id).then(setReplays).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!trace) return;
    api.getPrompts(trace.project_id).then(setLibraryPrompts).catch(() => setLibraryPrompts([]));
  }, [trace]);

  // ?promptVersion=<versionId> preselects the owning library prompt + that version, once the
  // prompt list for this trace's project has loaded.
  useEffect(() => {
    const preselectVersionId = searchParams.get("promptVersion");
    if (!preselectVersionId || libraryPrompts.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const p of libraryPrompts) {
        const detail = await api.getPrompt(p.id).catch(() => null);
        if (cancelled) return;
        const version = detail?.versions.find((v) => v.id === preselectVersionId);
        if (detail && version) {
          setSelectedPromptId(detail.id);
          setLibraryDetail(detail);
          setSelectedVersionId(version.id);
          setPrompt(version.content);
          setPromptEdited(false);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryPrompts]);

  const summary = useMemo(() => (trace ? modelSummary(trace) : ""), [trace]);

  const selectLibraryPrompt = (promptId: string) => {
    setSelectedPromptId(promptId);
    setLibraryDetail(null);
    setSelectedVersionId(null);
    if (!promptId) return;
    api.getPrompt(promptId).then(setLibraryDetail).catch(() => setLibraryDetail(null));
  };

  const selectLibraryVersion = (versionId: string) => {
    setSelectedVersionId(versionId || null);
    if (!versionId || !libraryDetail) return;
    const v = libraryDetail.versions.find((x) => x.id === versionId);
    if (v) {
      setPrompt(v.content);
      setPromptEdited(false);
    }
  };

  const runReplay = async () => {
    if (!trace) return;
    setRunning(true);
    setRunError(null);
    try {
      const useVersion = selectedVersionId && !promptEdited;
      const useTarget = Boolean(targetId) && targetNode !== null;
      const run = await api.createReplay({
        source_trace_id: id,
        target_observation_id: useTarget ? targetId! : undefined,
        override_model: model || undefined,
        override_model_params: temperature !== "" ? { temperature: parseFloat(temperature) } : undefined,
        override_prompt_version_id: useVersion ? selectedVersionId : undefined,
        override_prompt_text: !useVersion && promptEdited ? prompt : undefined,
      });
      setReplays(await api.getReplays(id));
      if (run.status === "success" && run.result_trace_id) {
        toast.success("回放完成，正在打开对比…");
        router.push(`/compare?a=${trace.id}&b=${run.result_trace_id}`);
      } else {
        const message = run.error ? (run.error.length > 160 ? `${run.error.slice(0, 160)}…` : run.error) : "回放失败";
        toast.error(message);
        setLatestRunId(run.id);
      }
    } catch (e) {
      setRunError(String(e));
      toast.error(String(e).length > 160 ? `${String(e).slice(0, 160)}…` : String(e));
    } finally {
      setRunning(false);
    }
  };

  if (loadError) return <main className="p-8 text-sm text-destructive">加载失败：{loadError}</main>;
  if (!trace) return <main className="p-8 text-sm text-muted-foreground">加载中…</main>;

  const traceName = trace.name || trace.id.slice(0, 8);
  const sortedReplays = replays.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: "Traces", href: "/traces" },
          { label: traceName, href: `/traces/${trace.id}` },
          { label: "回放" },
        ]}
      />

      <main className="mx-auto max-w-6xl p-6">
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">{traceName}</span>
                  <StatusBadge kind={trace.origin === "replay" ? "replay" : "live"} />
                  {trace.status === "error" && <StatusBadge kind="error" />}
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
                  <div>
                    模型 <MetricText value={summary || "—"} className="ml-1" />
                  </div>
                  <div>
                    总成本 <MetricText value={formatCost(trace.total_cost)} title={formatCostFull(trace.total_cost)} className="ml-1" />
                  </div>
                  <div>
                    总延迟 <MetricText value={formatLatency(trace.latency_ms)} className="ml-1" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {targetId && (
              targetNode ? (
                <div className="flex items-center gap-2 rounded-md border border-live/30 bg-live/10 px-3 py-2 text-sm text-live">
                  <Info className="h-4 w-4 shrink-0" />
                  <span>
                    单点回放：{targetNode.name || targetNode.id.slice(0, 8)}（step {targetNode.seq}）
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>未找到目标节点（target={targetId}），已按普通回放处理。</span>
                </div>
              )
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">模型</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    覆盖模型
                  </label>
                  <select
                    className="w-full max-w-md rounded-md border border-input bg-background px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    value={model}
                    disabled={running}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="">（沿用源模型）</option>
                    {judgeModels.map((m) => (
                      <option key={m.model} value={m.model}>
                        {m.model} ({m.provider_name})
                      </option>
                    ))}
                  </select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">参数</CardTitle>
              </CardHeader>
              <CardContent>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Temperature
                </label>
                <input
                  type="number"
                  step="0.1"
                  className="w-32 rounded-md border border-input bg-background px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  value={temperature}
                  disabled={running}
                  onChange={(e) => setTemperature(e.target.value)}
                  placeholder="不覆盖"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Prompt</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    从 Prompt 库选择
                  </label>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      value={selectedPromptId}
                      disabled={running}
                      onChange={(e) => selectLibraryPrompt(e.target.value)}
                    >
                      <option value="">（不使用 Prompt 库）</option>
                      {libraryPrompts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      value={selectedVersionId ?? ""}
                      disabled={!libraryDetail || running}
                      onChange={(e) => selectLibraryVersion(e.target.value)}
                    >
                      <option value="">选择版本</option>
                      {libraryDetail?.versions
                        .slice()
                        .sort((a, b) => b.version - a.version)
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            v{v.version}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    System Prompt
                  </label>
                  <Textarea
                    className="h-32 font-mono text-sm"
                    value={prompt}
                    disabled={running}
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      setPromptEdited(true);
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Button onClick={runReplay} disabled={running}>
                {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                运行回放 ▶
              </Button>
              {running && (
                <p className="text-sm text-muted-foreground">同步执行中，工具调用将使用录制结果 mock…</p>
              )}
              {runError && <p className="text-sm text-destructive">{runError}</p>}
            </div>
          </div>

          <div>
            <Card className="sticky top-6 self-start">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">历史回放</CardTitle>
              </CardHeader>
              <CardContent>
                {sortedReplays.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无历史回放记录。</p>
                ) : (
                  <div>
                    {sortedReplays.map((r, i) => (
                      <HistoryEntry
                        key={r.id}
                        run={r}
                        sourceId={trace.id}
                        defaultExpanded={r.id === latestRunId}
                        isLast={i === sortedReplays.length - 1}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ReplayPage() {
  return (
    <Suspense fallback={<main className="p-8 text-sm text-muted-foreground">加载中…</main>}>
      <ReplayContent />
    </Suspense>
  );
}
