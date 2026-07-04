"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Gavel } from "lucide-react";
import { api, Evaluation, JudgeModel, JudgeRunResult } from "@/lib/api";
import { formatCost } from "@/lib/format";
import { StatusBadge, StatusBadgeKind } from "@/components/StatusBadge";
import { MetricText } from "@/components/MetricText";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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

function verdictKind(verdict: string | null): StatusBadgeKind {
  if (verdict === "replaceable" || verdict === "pass") return verdict;
  if (verdict === "not_replaceable" || verdict === "fail") return verdict;
  return "warning";
}

function ScoreBar({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-4 text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded bg-secondary">
        <div className="h-full bg-primary" style={{ width: `${((score ?? 0) / 10) * 100}%` }} />
      </div>
      <MetricText value={score !== null ? String(score) : "—"} className="w-6 text-right font-semibold" />
    </div>
  );
}

function EvalCard({
  ev, onRerun, rerunning,
}: {
  ev: Evaluation;
  onRerun: (judgeModel: string) => void;
  rerunning: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind={verdictKind(ev.verdict)} label={ev.verdict ?? undefined} />
          <span className="text-sm font-medium">{ev.judge_model}</span>
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
        <div className="space-y-1.5">
          <ScoreBar label="A" score={ev.score} />
          {ev.score_b !== null && <ScoreBar label="B" score={ev.score_b} />}
        </div>
        {ev.reasoning && (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{ev.reasoning}</p>
        )}
        <p className="text-xs text-muted-foreground">
          <MetricText value={formatCost(ev.cost)} /> · {new Date(ev.created_at).toLocaleString("zh-CN")}
        </p>
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
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [runningModels, setRunningModels] = useState<string[]>([]);
  const [rerunningModel, setRerunningModel] = useState<string | null>(null);

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
    try {
      const { results } = await api.evaluate({
        subject_trace_id: subjectId, compare_trace_id: compareId, judge_models: selected,
      });
      const errs: Record<string, string> = {};
      results.forEach((r: JudgeRunResult) => {
        if (r.status === "error" && r.error) errs[r.judge_model] = r.error;
      });
      setErrors(errs);
      setEvaluations(await api.getEvaluations(subjectId, compareId));
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
    try {
      const { results } = await api.evaluate({
        subject_trace_id: subjectId, compare_trace_id: compareId, judge_models: [judgeModel], force: true,
      });
      const r = results[0];
      if (r?.status === "error" && r.error) {
        setErrors((prev) => ({ ...prev, [judgeModel]: r.error as string }));
      }
      setEvaluations(await api.getEvaluations(subjectId, compareId));
    } catch (e) {
      setErrors((prev) => ({ ...prev, [judgeModel]: String(e) }));
    } finally {
      setRerunningModel(null);
    }
  };

  return (
    <Card className="sticky top-6 self-start">
      <CardHeader className="pb-3">
        <p className="text-sm font-semibold">Judge 评分</p>
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
            <div className="space-y-2">
              {judgeModels.map((m) => (
                <label key={m.model} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selected.includes(m.model)} onCheckedChange={() => toggle(m.model)} />
                  <span>{m.model}</span>
                  <span className="text-xs text-muted-foreground">({m.provider_name})</span>
                </label>
              ))}
            </div>
            <Button onClick={run} disabled={selected.length === 0 || running} size="sm" className="w-full">
              {running ? "评分中…" : "运行 Judge ▶"}
            </Button>
            <p className="text-xs text-muted-foreground">相同组合默认返回缓存结果；重新评分会追加新记录。</p>
          </>
        )}

        {errors._global && <p className="text-sm text-destructive">{errors._global}</p>}
        {Object.entries(errors).filter(([k]) => k !== "_global").map(([model, err]) => (
          <p key={model} className="text-sm text-destructive">{model}: {err}</p>
        ))}

        <div className="space-y-3">
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
          {dedupeLatestByJudgeContext(evaluations).map((ev) => (
            <EvalCard key={ev.id} ev={ev} onRerun={rerun} rerunning={rerunningModel === ev.judge_model} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
