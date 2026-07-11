"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown, ChevronRight as ChevronRightIcon, Loader2, Play,
} from "lucide-react";
import { toast } from "sonner";
import { api, Divergence, JudgeModel, ObservationNode, PromptDetail, PromptSummary, ReplayRun, TraceDetail } from "@/lib/api";
import { formatCost, formatCostFull, formatLatency, formatRelativeTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricText } from "@/components/MetricText";
import { CodeBlock } from "@/components/CodeBlock";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NO_OVERRIDE = "__source__";
const CUSTOM_BASE = "__custom__";

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

interface FlatPromptVersion {
  key: string;
  promptId: string;
  promptName: string;
  versionId: string;
  version: number;
  content: string;
}

function DivergenceBadge({ type }: { type: string }) {
  if (type === "param_mismatch") return <StatusBadge kind="warning" label={type} />;
  if (type === "unrecorded_call") return <StatusBadge kind="error" label={type} />;
  return (
    <span className="rounded-md border border-border-soft bg-bg-grid px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-3">
      {type}
    </span>
  );
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
        <span className="font-mono text-xs text-muted-foreground">步骤 {d.step}</span>
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

// 简化的 divergence 描述，供结果卡的「偏离项」列表使用（code + 步骤 N + desc）
function divergenceDesc(d: Divergence): string {
  if (d.type === "param_mismatch") return `${d.tool ?? "工具"} 的入参与录制值不一致，已使用录制结果继续。`;
  if (d.type === "unrecorded_call") return `模型尝试调用未录制的 ${d.tool ?? "工具"}，回放无对应 mock 结果。`;
  if (d.type === "max_steps_exceeded") return "回放步数超出上限，已中断。";
  if (d.type === "wall_clock_exceeded") return "回放耗时超出上限，已中断。";
  return "回放与录制存在偏离。";
}

function ResultCard({ run, sourceId }: { run: ReplayRun; sourceId: string }) {
  const kind = runStatusKind(run.status);
  const divergences = run.divergences ?? [];
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <StatusBadge kind={kind} label={kind === "error" ? "失败" : kind === "success" ? "成功" : "运行中"} />
        <span className="text-sm text-muted-foreground">
          回放完成 · 用时 <MetricText value={formatLatency(run.result_latency_ms)} className="text-foreground" />
        </span>
        <div className="flex-1" />
        {run.result_trace_id && (
          <span className="font-mono text-xs text-muted-foreground">
            → <span className="text-replay-fg">{run.result_trace_id.slice(0, 12)}</span>
          </span>
        )}
      </div>
      <CardContent className="space-y-4 p-5">
        {run.error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="mb-1 text-xs font-semibold">回放失败</p>
            <pre className="whitespace-pre-wrap font-mono text-xs">{run.error}</pre>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">偏离项</span>
            <span className="rounded-md bg-warning/15 px-1.5 py-0.5 font-mono text-[11px] text-warning-fg">
              {divergences.length}
            </span>
          </div>
          {divergences.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">无偏离，回放与录制完全一致。</p>
          ) : (
            <div className="space-y-2">
              {divergences.map((d, i) => (
                <div key={i} className="flex gap-2.5 rounded-md bg-warning/10 p-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11.5px] font-semibold text-warning-fg">{d.type}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">步骤 {d.step}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{divergenceDesc(d)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {run.result_trace_id && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <span className="mr-auto text-xs text-muted-foreground">下一步</span>
            <Button asChild variant="outline" size="sm">
              <Link href={`/traces/${run.result_trace_id}`}>查看结果链路</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/compare?a=${sourceId}&b=${run.result_trace_id}`}>与源链路对比</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryEntry({ run, sourceId }: { run: ReplayRun; sourceId: string }) {
  const [expanded, setExpanded] = useState(false);
  const kind = runStatusKind(run.status);
  const hasDetail = Boolean(run.error) || (run.divergences && run.divergences.length > 0);
  const parts = [
    run.override_model,
    run.override_model_params?.temperature !== undefined ? `temp ${run.override_model_params?.temperature}` : null,
  ].filter(Boolean);
  const metaParts = [
    `${(run.divergences ?? []).length} 偏离`,
    run.result_cost !== null ? formatCost(run.result_cost) : null,
    run.result_latency_ms !== null ? formatLatency(run.result_latency_ms) : null,
  ].filter(Boolean);

  return (
    <div className="relative pl-6">
      <span className="absolute left-0 top-3 h-2.5 w-2.5 rounded-full border-2 border-border bg-background" />
      <div className="rounded-md border px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge kind={kind} label={kind === "error" ? "失败" : kind === "success" ? "成功" : "运行中"} />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {parts.length > 0 ? parts.join(" · ") : "沿用源配置"}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{metaParts.join(" · ")}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(run.created_at)}</span>
          {run.result_trace_id && (
            <Button asChild variant="link" size="sm" className="h-auto shrink-0 p-0 text-xs">
              <Link href={`/traces/${run.result_trace_id}`}>查看</Link>
            </Button>
          )}
          {hasDetail && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-1.5 text-xs text-muted-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
              详情
            </Button>
          )}
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

function AdvancedParams({
  topP, onTopP, topPDirty,
  freqPen, onFreqPen, freqPenDirty,
  presPen, onPresPen, presPenDirty,
  maxTokens, onMaxTokens,
  stopSeq, onStopSeq,
  disabled,
}: {
  topP: number; onTopP: (v: number) => void; topPDirty: boolean;
  freqPen: number; onFreqPen: (v: number) => void; freqPenDirty: boolean;
  presPen: number; onPresPen: (v: number) => void; presPenDirty: boolean;
  maxTokens: string; onMaxTokens: (v: string) => void;
  stopSeq: string; onStopSeq: (v: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dirty = topPDirty || freqPenDirty || presPenDirty || maxTokens.trim() !== "" || stopSeq.trim() !== "";

  return (
    <div className="overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between bg-bg-grid px-3.5 text-xs font-semibold text-muted-foreground"
      >
        <span className="flex items-center gap-2">
          高级参数
          {dirty && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
        </span>
        <ChevronRightIcon className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="space-y-4 px-3.5 py-4">
          {[
            { label: "Top P", k: "top_p", value: topP, set: onTopP, min: 0, max: 1, step: 0.05, fmt: (v: number) => v.toFixed(2) },
            { label: "频率惩罚", k: "frequency_penalty", value: freqPen, set: onFreqPen, min: -2, max: 2, step: 0.1, fmt: (v: number) => (v > 0 ? "+" : "") + v.toFixed(1) },
            { label: "存在惩罚", k: "presence_penalty", value: presPen, set: onPresPen, min: -2, max: 2, step: 0.1, fmt: (v: number) => (v > 0 ? "+" : "") + v.toFixed(1) },
          ].map((s) => (
            <div key={s.k}>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  {s.label}<span className="font-mono text-[10.5px] text-text-3">{s.k}</span>
                </label>
                <MetricText value={s.fmt(s.value)} className="text-xs font-semibold text-primary" />
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={s.value}
                disabled={disabled}
                onChange={(e) => s.set(parseFloat(e.target.value))}
                className="h-1 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                最大 tokens <span className="font-mono text-[10.5px] text-text-3">max_tokens</span>
              </label>
              <Input
                type="number"
                min={1}
                max={128000}
                value={maxTokens}
                disabled={disabled}
                placeholder="不覆盖"
                onChange={(e) => onMaxTokens(e.target.value)}
                className="h-9 font-mono text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                停止序列 <span className="font-mono text-[10.5px] text-text-3">stop</span>
              </label>
              <Input
                value={stopSeq}
                disabled={disabled}
                placeholder="逗号分隔，如 END,STOP"
                onChange={(e) => onStopSeq(e.target.value)}
                className="h-9 font-mono text-sm"
              />
            </div>
          </div>
        </div>
      )}
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

  // 覆盖模型：只有用户主动切换过才作为 override_model 提交；否则视为「沿用源模型」
  const [model, setModel] = useState(NO_OVERRIDE);

  // 温度 + 高级参数：逐项 dirty 追踪，只把用户真正碰过的键塞进 override_model_params
  const [temperature, setTemperature] = useState(0.7);
  const [tempDirty, setTempDirty] = useState(false);
  const [topP, setTopP] = useState(1.0);
  const [topPDirty, setTopPDirty] = useState(false);
  const [freqPen, setFreqPen] = useState(0.0);
  const [freqPenDirty, setFreqPenDirty] = useState(false);
  const [presPen, setPresPen] = useState(0.0);
  const [presPenDirty, setPresPenDirty] = useState(false);
  const [maxTokens, setMaxTokens] = useState("");
  const [stopSeq, setStopSeq] = useState("");

  const [prompt, setPrompt] = useState("");
  const [promptEdited, setPromptEdited] = useState(false);
  const [promptBase, setPromptBase] = useState(CUSTOM_BASE);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [flatVersions, setFlatVersions] = useState<FlatPromptVersion[]>([]);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ReplayRun | null>(null);

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

  // Prompt 库版本基准选择器：把项目下所有 prompt 的全部版本拍平成 "prompt名 vN" 条目
  useEffect(() => {
    if (!trace) return;
    let cancelled = false;
    api.getPrompts(trace.project_id)
      .then(async (prompts: PromptSummary[]) => {
        const details = await Promise.all(prompts.map((p) => api.getPrompt(p.id).catch(() => null)));
        if (cancelled) return;
        const flat: FlatPromptVersion[] = [];
        details.forEach((d: PromptDetail | null) => {
          if (!d) return;
          d.versions.slice().sort((a, b) => b.version - a.version).forEach((v) => {
            flat.push({ key: `${d.id}:${v.id}`, promptId: d.id, promptName: d.name, versionId: v.id, version: v.version, content: v.content });
          });
        });
        setFlatVersions(flat);
      })
      .catch(() => setFlatVersions([]));
    return () => { cancelled = true; };
  }, [trace]);

  // ?promptVersion=<versionId> 预选中该版本作为基准（来自 Prompt 库「用此版本回放」）
  useEffect(() => {
    const preselectVersionId = searchParams.get("promptVersion");
    if (!preselectVersionId || flatVersions.length === 0) return;
    const match = flatVersions.find((v) => v.versionId === preselectVersionId);
    if (match) {
      setPromptBase(match.key);
      setSelectedVersionId(match.versionId);
      setPrompt(match.content);
      setPromptEdited(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatVersions]);

  const summary = useMemo(() => (trace ? modelSummary(trace) : ""), [trace]);
  const originModel = useMemo(() => {
    if (!trace) return null;
    const entry = targetNode ?? flatten(trace.observations).find((o) => o.type === "llm");
    return entry?.model ?? null;
  }, [trace, targetNode]);

  // 覆盖模型下拉：judge-models 列表 + 源模型（即使不在 judge-models 里也要出现，标「源」）
  const modelOptions = useMemo(() => {
    const opts = judgeModels.map((m) => ({
      value: m.model, label: m.model, providerName: m.provider_name as string | null,
      isOrigin: m.model === originModel,
    }));
    if (originModel && !opts.some((o) => o.value === originModel)) {
      opts.unshift({ value: originModel, label: originModel, providerName: null, isOrigin: true });
    }
    return opts;
  }, [judgeModels, originModel]);

  const selectPromptBase = (key: string) => {
    setPromptBase(key);
    if (key === CUSTOM_BASE) {
      setSelectedVersionId(null);
      return;
    }
    const v = flatVersions.find((x) => x.key === key);
    if (v) {
      setSelectedVersionId(v.versionId);
      setPrompt(v.content);
      setPromptEdited(false);
    }
  };

  const resetPrompt = () => {
    const v = flatVersions.find((x) => x.key === promptBase);
    if (v) {
      setPrompt(v.content);
      setPromptEdited(false);
    }
  };

  const currentBaseLabel = promptBase === CUSTOM_BASE
    ? "自定义（不基于版本）"
    : (() => {
        const v = flatVersions.find((x) => x.key === promptBase);
        return v ? `${v.promptName} v${v.version}` : "自定义（不基于版本）";
      })();

  const runReplay = async () => {
    if (!trace) return;
    setRunning(true);
    setRunError(null);
    try {
      const useVersion = selectedVersionId && !promptEdited;
      const useTarget = Boolean(targetId) && targetNode !== null;

      const modelParams: Record<string, unknown> = {};
      if (tempDirty) modelParams.temperature = temperature;
      if (topPDirty) modelParams.top_p = topP;
      if (freqPenDirty) modelParams.frequency_penalty = freqPen;
      if (presPenDirty) modelParams.presence_penalty = presPen;
      if (maxTokens.trim() !== "") modelParams.max_tokens = parseInt(maxTokens, 10);
      if (stopSeq.trim() !== "") {
        modelParams.stop = stopSeq.split(",").map((s) => s.trim()).filter(Boolean);
      }

      const run = await api.createReplay({
        source_trace_id: id,
        target_observation_id: useTarget ? targetId! : undefined,
        override_model: model !== NO_OVERRIDE ? model : undefined,
        override_model_params: Object.keys(modelParams).length > 0 ? modelParams : undefined,
        override_prompt_version_id: useVersion ? selectedVersionId! : undefined,
        override_prompt_text: !useVersion && promptEdited ? prompt : undefined,
      });
      const refreshed = await api.getReplays(id);
      setReplays(refreshed);
      const enriched = refreshed.find((r) => r.id === run.id) ?? run;

      if (run.status === "success" && run.result_trace_id) {
        toast.success("回放完成，正在打开对比…");
        router.push(`/compare?a=${trace.id}&b=${run.result_trace_id}`);
      } else {
        const message = run.error ? (run.error.length > 160 ? `${run.error.slice(0, 160)}…` : run.error) : "回放失败";
        toast.error(message);
        setLastResult(enriched);
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
  const isStep = Boolean(targetId && targetNode);

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: "链路", href: "/traces" },
          { label: traceName, href: `/traces/${trace.id}` },
          { label: isStep ? "单步回放" : "回放" },
        ]}
      />

      <main className="mx-auto max-w-6xl p-6">
        <div className="mb-4 flex items-center gap-3 rounded-md border bg-surface-2 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-replay/15 text-replay-fg">
            <Play className="h-4 w-4" fill="currentColor" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold">回放 · {traceName}</h1>
            <p className="text-xs text-muted-foreground">
              源链路 <MetricText value={trace.id.slice(0, 12)} />
              {isStep && targetNode && (
                <span className="text-warning-fg"> · 单步回放：步骤 {targetNode.seq}「{targetNode.name || targetNode.id.slice(0, 8)}」</span>
              )}
              {targetId && !targetNode && (
                <span className="text-warning-fg"> · 未找到目标节点（target={targetId}），已按整条回放处理</span>
              )}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <MetricText value={summary || "—"} />
            <MetricText value={formatCost(trace.total_cost)} title={formatCostFull(trace.total_cost)} />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          {/* ===== 配置列 ===== */}
          <div className="space-y-4">
            <div>
              <h2 className="mb-1 text-sm font-semibold">回放配置</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                覆盖以下参数后重跑；工具调用将使用录制结果 mock，不会真正执行。
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">覆盖模型</label>
              <Select
                value={model}
                disabled={running}
                onValueChange={(v) => setModel(v)}
              >
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue>
                    {model === NO_OVERRIDE ? "（沿用源模型）" : model}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OVERRIDE}>（沿用源模型）</SelectItem>
                  {modelOptions.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      <span className="font-mono">{m.label}</span>
                      {m.providerName && <span className="ml-1.5 text-[11px] text-muted-foreground">({m.providerName})</span>}
                      {m.isOrigin && <span className="ml-2 font-mono text-[10px] text-text-3">源</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-semibold text-muted-foreground">温度</label>
                <MetricText value={temperature.toFixed(1)} className="text-sm font-semibold text-primary" />
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                disabled={running}
                onChange={(e) => { setTemperature(parseFloat(e.target.value)); setTempDirty(true); }}
                className="h-1 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
              />
              <div className="mt-1 flex justify-between font-mono text-[10.5px] text-text-3">
                <span>0.0 精确</span>
                <span>2.0 发散</span>
              </div>
            </div>

            <AdvancedParams
              topP={topP} onTopP={(v) => { setTopP(v); setTopPDirty(true); }} topPDirty={topPDirty}
              freqPen={freqPen} onFreqPen={(v) => { setFreqPen(v); setFreqPenDirty(true); }} freqPenDirty={freqPenDirty}
              presPen={presPen} onPresPen={(v) => { setPresPen(v); setPresPenDirty(true); }} presPenDirty={presPenDirty}
              maxTokens={maxTokens} onMaxTokens={setMaxTokens}
              stopSeq={stopSeq} onStopSeq={setStopSeq}
              disabled={running}
            />

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-semibold text-muted-foreground">System Prompt</label>
                {promptEdited && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-warning-fg">
                    已修改
                  </span>
                )}
              </div>
              <Select value={promptBase} disabled={running} onValueChange={selectPromptBase}>
                <SelectTrigger className="mb-2.5 h-10 text-sm">
                  <SelectValue>{currentBaseLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CUSTOM_BASE}>自定义（不基于版本）</SelectItem>
                  {flatVersions.map((v) => (
                    <SelectItem key={v.key} value={v.key}>
                      <span className="font-mono">{v.promptName} v{v.version}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                className="h-32 font-mono text-sm"
                value={prompt}
                disabled={running}
                placeholder="在此撰写 system prompt，或从上方选择一个已有版本作为基准再修改…"
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setPromptEdited(true);
                }}
              />
              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex-1">
                  {promptBase === CUSTOM_BASE
                    ? "自由撰写的 system prompt，不关联任何版本。"
                    : promptEdited
                      ? `已在 ${currentBaseLabel} 基础上修改（不会改动原版本）。`
                      : `已载入 ${currentBaseLabel}，可直接编辑。`}
                </span>
                {promptEdited && promptBase !== CUSTOM_BASE && (
                  <button type="button" onClick={resetPrompt} className="shrink-0 font-medium text-muted-foreground hover:text-primary">
                    还原到 {currentBaseLabel}
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1.5 border-t pt-4">
              <Button onClick={runReplay} disabled={running} className="w-full">
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" fill="currentColor" />}
                {running ? "回放中…" : "运行回放"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">成功后将自动跳转到对比页</p>
              {runError && <p className="text-sm text-destructive">{runError}</p>}
            </div>
          </div>

          {/* ===== 结果 + 历史 ===== */}
          <div className="space-y-6">
            {!lastResult && !running && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-14 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-replay/15 text-replay-fg">
                  <Play className="h-6 w-6" fill="currentColor" />
                </span>
                <p className="text-sm font-semibold">配置左侧参数后运行回放</p>
                <p className="max-w-[340px] text-xs leading-relaxed text-muted-foreground">
                  回放会用录制的工具结果 mock 执行，重跑后在此展示状态、偏离与跳转。
                </p>
              </div>
            )}
            {running && (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed p-14 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> 同步执行中，工具调用将使用录制结果 mock…
              </div>
            )}
            {lastResult && !running && <ResultCard run={lastResult} sourceId={trace.id} />}

            <div>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-muted-foreground">回放历史</h2>
                <span className="font-mono text-xs text-muted-foreground">{sortedReplays.length} 次</span>
              </div>
              {sortedReplays.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无历史回放记录。</p>
              ) : (
                <div className="space-y-3">
                  {sortedReplays.map((r) => (
                    <HistoryEntry key={r.id} run={r} sourceId={trace.id} />
                  ))}
                </div>
              )}
            </div>
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
