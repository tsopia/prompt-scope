"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, Gavel, Zap } from "lucide-react";
import { api, DimensionScore, Evaluation, JudgeModel, JudgeRunResult, JudgeTemplate } from "@/lib/api";
import { formatCost } from "@/lib/format";
import {
  classifyVerdict,
  consensusSentence,
  judgeSpectrumPosition,
  majorityLabel,
  splitPct,
  tallyVerdicts,
  type VerdictTally,
} from "@/lib/juryTally";
import { MetricText } from "@/components/MetricText";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

// 后端（backend/schemas/evaluations.py EvaluateRequest.context_mode）支持三种口径：
// with_trace（完整对话）/ output_only（仅最终输出）/ tools_aligned（工具输出对齐）。
type ContextMode = "with_trace" | "output_only" | "tools_aligned";
const CONTEXT_OPTIONS: { value: ContextMode; label: string }[] = [
  { value: "with_trace", label: "完整对话" },
  { value: "output_only", label: "仅最终输出" },
  { value: "tools_aligned", label: "工具输出对齐" },
];

// 「系统默认」不是一条 judge_templates 记录，选中它时请求体里省略 judge_template_id，
// 后端 run_judge() 回落到内置通用 rubric（见 backend/services/judge_service.py）。
const SYSTEM_DEFAULT_TEMPLATE = "__system_default__";

function judgeTemplateStorageKey(projectId: string): string {
  return `promptscope.judgeTemplate.${projectId}`;
}

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

// verdict 三态展示文案（可替代/两者相当/倾向保留 A）由 lib/juryTally.classifyVerdict
// 统一判定（replaceable→B, not_replaceable+分差小→TIE, 其余 not_replaceable→A），
// 这里只负责映射成中文文案，判定逻辑不重复。
function verdictText(ev: Evaluation): string {
  const category = classifyVerdict(ev);
  if (category === "B") return "B 可替代 A";
  if (category === "A") return "倾向保留 A";
  return "两者相当";
}

// 三态映射（见 CLAUDE.md 状态色约定）：B（可替代）→绿, TIE（两者相当）→中性灰,
// A（倾向保留 A）→琥珀。复用 StatusBadge 而非各自手搓 pill，避免与全局徽章样式漂移。
function VerdictBadge({ ev }: { ev: Evaluation }) {
  const category = classifyVerdict(ev);
  const text = verdictText(ev);
  if (category === "B") {
    return <StatusBadge kind="success" label={text} />;
  }
  if (category === "TIE") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-bg-grid px-2.5 py-0.5 text-[11.5px] font-semibold text-text-3">
        {text}
      </span>
    );
  }
  return <StatusBadge kind="warning" label={text} />;
}

const scoreText = (score: number | null): string => (score !== null ? score.toFixed(1) : "—");

// A/B 对决条：A 分数 · 按比例分色的横条 · B 分数。单侧评审（score_b 为 null）时退化成单个分数。
function DuelBar({ scoreA, scoreB }: { scoreA: number | null; scoreB: number | null }) {
  if (scoreA === null && scoreB === null) return null;
  if (scoreB === null) {
    return (
      <span className="font-mono text-sm font-semibold tabular-nums">
        {scoreText(scoreA)}
        <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">/ 10</span>
      </span>
    );
  }
  const aPct = splitPct(scoreA, scoreB);
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-14 shrink-0 font-mono text-xs font-semibold tabular-nums text-primary">
        A {scoreText(scoreA)}
      </span>
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-bg-grid">
        <div className="h-full bg-primary" style={{ width: `${aPct}%` }} />
        <div className="h-full bg-replay" style={{ width: `${100 - aPct}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-replay-fg">
        B {scoreText(scoreB)}
      </span>
    </div>
  );
}

// 一条评审维度：成对评审用 score_a/score_b 拆分横条，单一评审只有 score 时是单色实心条。
function DimensionRow({ dim }: { dim: DimensionScore }) {
  const isPair = dim.score_a !== null || dim.score_b !== null;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 truncate text-text-3">{dim.name}</span>
      {isPair ? (
        <>
          <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-bg-grid">
            <div className="h-full bg-primary" style={{ width: `${splitPct(dim.score_a, dim.score_b)}%` }} />
            <div className="h-full bg-replay" style={{ width: `${100 - splitPct(dim.score_a, dim.score_b)}%` }} />
          </div>
          <MetricText
            value={`${scoreText(dim.score_a)} · ${scoreText(dim.score_b)}`}
            className="w-16 shrink-0 text-right text-[11px] text-muted-foreground"
          />
        </>
      ) : (
        <>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-grid">
            <div className="h-full bg-primary" style={{ width: `${((dim.score ?? 0) / 10) * 100}%` }} />
          </div>
          <MetricText value={scoreText(dim.score)} className="w-16 shrink-0 text-right text-[11px] text-muted-foreground" />
        </>
      )}
    </div>
  );
}

function EvidenceBlock({ evidence, step }: { evidence: string; step: string | null }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[11.5px] text-text-3">
        <span>证据</span>
        {step && (
          <span className="rounded-md border border-border-soft bg-bg-grid px-1.5 py-0.5 font-mono text-[10.5px] text-text-3">
            {step}
          </span>
        )}
      </div>
      <div className="whitespace-pre-wrap rounded-md bg-bg-grid p-3 font-mono text-[12px] leading-relaxed text-muted-foreground">
        {evidence}
      </div>
    </div>
  );
}

function ConfidenceDots({ confidence }: { confidence: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] text-text-3">
      <span>置信</span>
      <span className="flex items-center gap-1">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i <= confidence ? "bg-primary" : "bg-muted")} />
        ))}
      </span>
    </div>
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

// 合议摘要条：真实裁判 verdict 的客观聚合展示，不是额外的一位裁判。
function JurySummaryStrip({ evaluations }: { evaluations: Evaluation[] }) {
  const t = tallyVerdicts(evaluations);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border-soft bg-bg-grid px-3 py-2 text-xs">
      <span className="font-semibold text-foreground">{t.total} 位裁判</span>
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-replay" />
        {t.b} 判 B 可替代
      </span>
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        {t.a} 判 A 保留
      </span>
      <span className="ml-auto font-semibold text-foreground">最终：{majorityLabel(t)}</span>
    </div>
  );
}

function boardAverage(evs: Evaluation[], key: "score" | "score_b"): number | null {
  const vals = evs.map((e) => e[key]).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// 计分板：A/B 均分对决 + 频谱条（每位裁判的判决沿「保留 A ←→ B 可替代」轴定位）。
function Scoreboard({ evaluations, modelA, modelB }: { evaluations: Evaluation[]; modelA: string; modelB: string }) {
  const boardA = boardAverage(evaluations, "score");
  const boardB = boardAverage(evaluations, "score_b");
  return (
    <div className="space-y-3 rounded-md border border-border-soft p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[10px] font-bold text-primary">
            A
          </span>
          <span className="truncate font-medium text-muted-foreground">{modelA}</span>
          <MetricText value={boardA !== null ? boardA.toFixed(1) : "—"} className="text-base font-bold" />
        </span>
        <span className="shrink-0 text-xs font-semibold text-text-3">VS</span>
        <span className="flex min-w-0 items-center justify-end gap-2">
          <MetricText value={boardB !== null ? boardB.toFixed(1) : "—"} className="text-base font-bold" />
          <span className="truncate font-medium text-muted-foreground">{modelB}</span>
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-replay/15 text-[10px] font-bold text-replay-fg">
            B
          </span>
        </span>
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between text-[10px] text-text-3">
          <span>← 保留 A</span>
          <span>B 可替代 →</span>
        </div>
        <div className="relative h-1.5 rounded-full bg-bg-grid">
          {evaluations.map((ev) => {
            const category = classifyVerdict(ev);
            const dotClass = category === "B" ? "bg-replay" : category === "A" ? "bg-warning" : "bg-text-3";
            return (
              <Tooltip key={ev.id}>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full border-2 border-background",
                      dotClass,
                    )}
                    style={{ left: `${judgeSpectrumPosition(ev)}%` }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {ev.judge_model} · {verdictText(ev)}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// 一位裁判的完整发言：verdict + 对决条 + 维度（可选）+ 证据（可选）+ 理由 + 置信（可选）。
// dimensions/evidence/confidence 任一为 null/空时整体省略对应子块——绝不补 0 或假文案。
function JuryBubble({
  ev, cached, onRerun, rerunning, index,
}: {
  ev: Evaluation;
  cached: boolean;
  onRerun: (judgeModel: string) => void;
  rerunning: boolean;
  index: number;
}) {
  return (
    <Card
      className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300"
      style={{ animationDelay: `${Math.min(index, 6) * 60}ms` }}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-soft bg-bg-grid text-[11px] font-bold text-muted-foreground">
            {ev.judge_model.charAt(0).toUpperCase()}
          </span>
          <span className="font-mono text-[12.5px] font-semibold">{ev.judge_model}</span>
          <VerdictBadge ev={ev} />
          {cached && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10.5px] text-text-3">
              <Zap className="h-3 w-3" />
              缓存命中
            </span>
          )}
          {ev.judge_template_name && (
            <span className="rounded-md border border-border-soft bg-bg-grid px-1.5 py-0.5 font-mono text-[10.5px] text-text-3">
              模板 · {ev.judge_template_name}
            </span>
          )}
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

        <DuelBar scoreA={ev.score} scoreB={ev.score_b} />

        {ev.dimensions && ev.dimensions.length > 0 && (
          <div className="space-y-1.5 border-t border-border-soft pt-2.5">
            {ev.dimensions.map((d) => (
              <DimensionRow key={d.name} dim={d} />
            ))}
          </div>
        )}

        {ev.evidence && <EvidenceBlock evidence={ev.evidence} step={ev.evidence_step} />}

        {ev.reasoning && <ReasoningPanel text={ev.reasoning} />}

        <div className="flex items-center justify-between gap-2">
          {ev.confidence !== null ? <ConfidenceDots confidence={ev.confidence} /> : <span />}
          <p className="shrink-0 text-xs text-muted-foreground">
            <MetricText value={formatCost(ev.cost)} /> · {new Date(ev.created_at).toLocaleString("zh-CN")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// 合议汇总：真实 verdict 的客观聚合投票 + 一句话结论，标注为「合议汇总」而非又一位裁判。
function ConsensusBubble({ evaluations }: { evaluations: Evaluation[] }) {
  const t: VerdictTally = tallyVerdicts(evaluations);
  return (
    <Card className="animate-in fade-in-0 border-dashed duration-300">
      <CardContent className="space-y-2.5 p-4">
        <p className="text-xs font-semibold text-text-3">合议汇总</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {evaluations.map((ev) => {
            const category = classifyVerdict(ev);
            const cls =
              category === "B"
                ? "bg-replay/15 text-replay-fg"
                : category === "A"
                  ? "bg-warning/15 text-warning-fg"
                  : "border border-border-soft bg-bg-grid text-text-3";
            const label = category === "B" ? "B" : category === "A" ? "A" : "=";
            return (
              <Tooltip key={ev.id}>
                <TooltipTrigger asChild>
                  <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold", cls)}>
                    {label}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{ev.judge_model}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <p className="text-sm font-medium">{consensusSentence(t)}</p>
      </CardContent>
    </Card>
  );
}

// 批量/单条评分调用中某个 judge 失败时（results[].status === "error"），不再降级成裸文字，
// 而是复用与结果卡相同的 Card 外框，保持"目的性破坏"（destructive）语义一致。
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
  modelA = "A 模型",
  modelB = "B 模型",
}: {
  subjectId: string;
  compareId: string;
  projectId: string;
  modelA?: string;
  modelB?: string;
}) {
  const [judgeModels, setJudgeModels] = useState<JudgeModel[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [ctxMode, setCtxMode] = useState<ContextMode>("output_only");
  const [judgesOpen, setJudgesOpen] = useState(false);
  const [judgeTemplates, setJudgeTemplates] = useState<JudgeTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>(SYSTEM_DEFAULT_TEMPLATE);
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
    // 评分模板是可选增强：拉取失败（如权限/网络问题）时静默降级为只有「系统默认」，
    // 不阻塞评分面板本身可用。
    api.getJudgeTemplates(projectId).then(setJudgeTemplates).catch(() => setJudgeTemplates([]));
    const stored = typeof window !== "undefined" ? localStorage.getItem(judgeTemplateStorageKey(projectId)) : null;
    setTemplateId(stored ?? SYSTEM_DEFAULT_TEMPLATE);
  }, [subjectId, compareId, projectId]);

  // 存储的模板 id 若已不存在于当前项目模板列表中（被删除，或跨项目残留的 localStorage
  // 值），回落到系统默认，避免 Select 展示一个不存在的选项。
  useEffect(() => {
    if (templateId === SYSTEM_DEFAULT_TEMPLATE) return;
    if (judgeTemplates.length === 0) return;
    if (!judgeTemplates.some((t) => t.id === templateId)) {
      setTemplateId(SYSTEM_DEFAULT_TEMPLATE);
    }
  }, [judgeTemplates, templateId]);

  const selectTemplate = (value: string) => {
    setTemplateId(value);
    if (typeof window !== "undefined") {
      localStorage.setItem(judgeTemplateStorageKey(projectId), value);
    }
  };

  const templatePayload =
    templateId === SYSTEM_DEFAULT_TEMPLATE ? {} : { judge_template_id: templateId };

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
        judge_models: selected, context_mode: ctxMode, ...templatePayload,
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
        judge_models: [judgeModel], context_mode: ctxMode, force: true, ...templatePayload,
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
              <div className="w-[170px]">
                <p className="mb-1.5 text-xs text-muted-foreground">评分模板</p>
                <Select value={templateId} onValueChange={selectTemplate}>
                  <SelectTrigger className="h-9 bg-bg-grid text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SYSTEM_DEFAULT_TEMPLATE}>系统默认</SelectItem>
                    {judgeTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
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

        {running && runningModels.length > 0 && (
          <div className="space-y-3">
            {runningModels.map((m) => (
              <Card key={m}>
                <CardContent className="space-y-3 p-4">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-2 w-full" />
                  <Skeleton className="h-2 w-full" />
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {visibleEvaluations.length > 0 && (
          <div className="space-y-4">
            <JurySummaryStrip evaluations={visibleEvaluations} />
            <Scoreboard evaluations={visibleEvaluations} modelA={modelA} modelB={modelB} />
            <div className="space-y-3">
              {visibleEvaluations.map((ev, i) => (
                <JuryBubble
                  key={ev.id}
                  ev={ev}
                  cached={isCached(ev)}
                  onRerun={rerun}
                  rerunning={rerunningModel === ev.judge_model}
                  index={i}
                />
              ))}
            </div>
            <ConsensusBubble evaluations={visibleEvaluations} />
          </div>
        )}

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
