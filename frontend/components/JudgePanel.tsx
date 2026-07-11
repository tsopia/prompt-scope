"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, Gavel } from "lucide-react";
import { api, Evaluation, JudgeModel, JudgeRunResult } from "@/lib/api";
import { formatCost } from "@/lib/format";
import { MetricText } from "@/components/MetricText";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// D2: 后端支持 output_only / with_trace / tools_aligned 三种口径，本次前端只映射既有
// 两种（完整对话→with_trace，仅最终输出→output_only）；tools_aligned 属降级项延后
// （见 docs/superpowers/plans/2026-07-10-ui-redesign-implementation-plan.md D2）。
type ContextMode = "with_trace" | "output_only";
const CONTEXT_OPTIONS: { value: ContextMode; label: string }[] = [
  { value: "with_trace", label: "完整对话" },
  { value: "output_only", label: "仅最终输出" },
];

// evaluations 已按 created_at 倒序返回；同一 (judge_model, context_mode) 组合
// 只保留最新一条（force 重评后旧记录不会被覆盖，只会追加新记录）。
function dedupeLatestByJudgeContext(evaluations: Evaluation[]): Evaluation[] {
  const seen = new Set<string>();
  return evaluations.filter((ev) => {
    const key = `${ev.judge_model}::${ev.context_mode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// D3: 后端 Evaluation.verdict 只有 replaceable/not_replaceable 两态原始判决（见
// CLAUDE.md Key Design Decisions）；三值展示文案（可替代/两者相当/倾向保留 A）按
// verdict + 分差在前端映射，后端三值 schema 本次降级延后。
const TIE_THRESHOLD = 0.3;

function isTie(ev: Evaluation): boolean {
  return ev.score !== null && ev.score_b !== null && Math.abs(ev.score - ev.score_b) <= TIE_THRESHOLD;
}

function verdictText(ev: Evaluation): string {
  if (ev.verdict === "replaceable") return "B 可替代 A";
  if (ev.verdict === "not_replaceable") return isTie(ev) ? "两者相当" : "倾向保留 A";
  return ev.verdict ?? "—";
}

// D3 三态映射（见 CLAUDE.md）：replaceable→绿, "两者相当"(打平)→中性灰（StatusBadge
// 无对应 kind，保留自定义样式), 其余 not_replaceable("倾向保留 A")→琥珀 —— 与设计稿
// docs/design/Compare.dc.html 的 verdictMap（kind: pass/warn/tie）逐一对应，不是随意配色；
// 绿/琥珀两态复用 StatusBadge 而非各自手搓 pill，避免与全局徽章样式漂移。
function VerdictBadge({ ev }: { ev: Evaluation }) {
  const text = verdictText(ev);
  if (ev.verdict === "replaceable") {
    return <StatusBadge kind="success" label={text} />;
  }
  if (ev.verdict === "not_replaceable" && isTie(ev)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-bg-grid px-2.5 py-0.5 text-[11.5px] font-semibold text-text-3">
        {text}
      </span>
    );
  }
  return <StatusBadge kind="warning" label={text} />;
}

// context_mode 展示 chip：复用 CONTEXT_OPTIONS 的中文文案，未知取值原样展示（防御性兜底）。
function ContextModeChip({ mode }: { mode: string }) {
  const label = CONTEXT_OPTIONS.find((o) => o.value === mode)?.label ?? mode;
  return (
    <span className="rounded-md border border-border-soft bg-bg-grid px-1.5 py-0.5 font-mono text-[10.5px] text-text-3">
      {label}
    </span>
  );
}

const scoreText = (score: number | null): string => (score !== null ? score.toFixed(1) : "—");

// pair 模式紧凑展示「A 8.2 · B 8.6」，分高的一侧加粗强调；single 模式只有一个分数。
function ScoreDisplay({ ev }: { ev: Evaluation }) {
  if (ev.score_b === null) {
    return (
      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
        {scoreText(ev.score)}
        <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">/ 10</span>
      </span>
    );
  }
  const aHigher = (ev.score ?? -Infinity) >= (ev.score_b ?? -Infinity);
  return (
    <span className="font-mono text-sm tabular-nums">
      <span className={cn(aHigher ? "font-semibold text-foreground" : "text-muted-foreground")}>
        A {scoreText(ev.score)}
      </span>
      <span className="mx-1.5 text-text-3">·</span>
      <span className={cn(!aHigher ? "font-semibold text-foreground" : "text-muted-foreground")}>
        B {scoreText(ev.score_b)}
      </span>
    </span>
  );
}

const REASONING_COLLAPSE_THRESHOLD = 280;

function ReasoningPanel({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > REASONING_COLLAPSE_THRESHOLD;
  return (
    <div className="space-y-1">
      <p className="text-[11.5px] text-text-3">评审理由</p>
      <div
        className={cn(
          "whitespace-pre-wrap rounded-md bg-bg-grid p-3 text-[13px] leading-relaxed text-foreground",
          isLong && !expanded && "line-clamp-4",
        )}
      >
        {text}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
    </div>
  );
}

function EvalCard({
  ev, cached, onRerun, rerunning,
}: {
  ev: Evaluation;
  cached: boolean;
  onRerun: (judgeModel: string) => void;
  rerunning: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[12.5px] font-semibold">{ev.judge_model}</span>
          <VerdictBadge ev={ev} />
          {cached && (
            <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-text-3">
              已缓存
            </span>
          )}
          <ContextModeChip mode={ev.context_mode} />
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={() => onRerun(ev.judge_model)}
            disabled={rerunning}
          >
            重新评分
          </Button>
        </div>
        <ScoreDisplay ev={ev} />
        {ev.reasoning && <ReasoningPanel text={ev.reasoning} />}
        <p className="text-xs text-muted-foreground">
          <MetricText value={formatCost(ev.cost)} /> · {new Date(ev.created_at).toLocaleString("zh-CN")}
        </p>
      </CardContent>
    </Card>
  );
}

// 批量/单条评分调用中某个 judge 失败时（results[].status === "error"），不再降级成裸文字，
// 而是复用与 EvalCard 相同的 Card 外框，保持"目的性破坏"（destructive）语义一致。
function ErrorCard({ judgeModel, error }: { judgeModel: string; error: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[12.5px] font-semibold">{judgeModel}</span>
          <StatusBadge kind="error" label="评分失败" />
        </div>
        <p className="text-sm text-destructive">{error}</p>
      </CardContent>
    </Card>
  );
}

export function JudgePanel({
  subjectId,
  compareId,
  projectId,
}: {
  subjectId: string;
  compareId: string;
  projectId: string;
}) {
  const [judgeModels, setJudgeModels] = useState<JudgeModel[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [ctxMode, setCtxMode] = useState<ContextMode>("output_only");
  const [judgesOpen, setJudgesOpen] = useState(false);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [runningModels, setRunningModels] = useState<string[]>([]);
  const [rerunningModel, setRerunningModel] = useState<string | null>(null);
  // 缓存徽章判定：run_judge() 命中缓存时复用同一条 Evaluation 行（created_at 不变），
  // 只有真正新跑的评分 created_at 会 >= 本次运行发起时间。没有更干净的“是否命中缓存”
  // 信号时，用这个时间戳比较代替（相当于“运行前已存在的评分记为已缓存”）。
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);

  useEffect(() => {
    api.getJudgeModels(projectId).then(setJudgeModels).catch(() => setJudgeModels([]));
    api.getEvaluations(subjectId, compareId).then(setEvaluations).catch(() => {});
  }, [subjectId, compareId, projectId]);

  const toggle = (m: string) =>
    setSelected((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);

  const run = async () => {
    setRunning(true);
    setRunningModels(selected);
    setErrors({});
    const startedAt = Date.now();
    try {
      const { results } = await api.evaluate({
        subject_trace_id: subjectId, compare_trace_id: compareId,
        judge_models: selected, context_mode: ctxMode,
      });
      const errs: Record<string, string> = {};
      results.forEach((r: JudgeRunResult) => {
        if (r.status === "error" && r.error) errs[r.judge_model] = r.error;
      });
      setErrors(errs);
      setEvaluations(await api.getEvaluations(subjectId, compareId));
      setLastRunAt(startedAt);
    } catch (e) {
      setErrors({ _global: String(e) });
    } finally {
      setRunning(false);
      setRunningModels([]);
    }
  };

  const rerun = async (judgeModel: string) => {
    setRerunningModel(judgeModel);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[judgeModel];
      return next;
    });
    const startedAt = Date.now();
    try {
      const { results } = await api.evaluate({
        subject_trace_id: subjectId, compare_trace_id: compareId,
        judge_models: [judgeModel], context_mode: ctxMode, force: true,
      });
      const r = results[0];
      if (r?.status === "error" && r.error) {
        setErrors((prev) => ({ ...prev, [judgeModel]: r.error as string }));
      }
      setEvaluations(await api.getEvaluations(subjectId, compareId));
      setLastRunAt(startedAt);
    } catch (e) {
      setErrors((prev) => ({ ...prev, [judgeModel]: String(e) }));
    } finally {
      setRerunningModel(null);
    }
  };

  const isCached = (ev: Evaluation): boolean => {
    if (lastRunAt === null) return true;
    return new Date(ev.created_at).getTime() < lastRunAt - 1500;
  };

  const visibleEvaluations = dedupeLatestByJudgeContext(
    evaluations.filter((ev) => ev.context_mode === ctxMode),
  );

  return (
    <Card className="sticky top-6 self-start">
      <CardHeader className="pb-3">
        <p className="text-sm font-semibold">多模型评分</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {judgeModels.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="没有可用的 judge 模型"
            description="先到 Settings 配置 provider 并在定价表中关联模型"
            action={
              <Button asChild size="sm">
                <Link href="/settings">前往 Settings</Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[160px]">
                <p className="mb-1.5 text-xs text-muted-foreground">裁判模型</p>
                <DropdownMenu open={judgesOpen} onOpenChange={setJudgesOpen}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-bg-grid px-3 text-sm"
                    >
                      <span className="flex-1 text-left">已选 {selected.length} 个模型</span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[220px]">
                    {judgeModels.map((m) => (
                      <DropdownMenuCheckboxItem
                        key={m.model}
                        checked={selected.includes(m.model)}
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={() => toggle(m.model)}
                        className="font-mono text-xs"
                      >
                        {m.model}
                        <span className="ml-1.5 font-sans text-[10px] text-muted-foreground">({m.provider_name})</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="w-[150px]">
                <p className="mb-1.5 text-xs text-muted-foreground">上下文模式</p>
                <Select value={ctxMode} onValueChange={(v) => setCtxMode(v as ContextMode)}>
                  <SelectTrigger className="h-9 bg-bg-grid text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTEXT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={run} disabled={selected.length === 0 || running} size="sm" className="w-full">
              {running ? "评分中…" : "运行评分"}
            </Button>
            <p className="text-xs text-muted-foreground">相同「trace 对 + 裁判 + 上下文」组合默认返回缓存结果；重新评分会追加新记录。</p>
          </>
        )}

        {errors._global && <p className="text-sm text-destructive">{errors._global}</p>}
        {Object.entries(errors).filter(([k]) => k !== "_global").map(([model, err]) => (
          <ErrorCard key={model} judgeModel={model} error={err} />
        ))}

        <div className={cn("space-y-3", visibleEvaluations.length === 0 && !running && "hidden")}>
          {running && runningModels.map((m) => (
            <Card key={m}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
          {visibleEvaluations.map((ev) => (
            <EvalCard key={ev.id} ev={ev} cached={isCached(ev)} onRerun={rerun} rerunning={rerunningModel === ev.judge_model} />
          ))}
        </div>

        {!running && visibleEvaluations.length === 0 && judgeModels.length > 0 && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Gavel className="h-6 w-6 text-text-3" />
            <p className="text-sm font-medium text-muted-foreground">选择裁判模型后运行评分</p>
            <p className="max-w-[280px] text-xs text-text-3">
              交叉裁决 A / B 哪个可替代，结果按「trace 对 + 裁判 + 上下文」缓存，重复运行直接复用。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
