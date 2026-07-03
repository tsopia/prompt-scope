"use client";
import { useEffect, useState } from "react";
import { api, Evaluation, JudgeModel, JudgeRunResult } from "@/lib/api";
import { formatCost } from "@/lib/format";

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

function ScoreBar({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-16 text-gray-500">{label}</span>
      <span className="font-bold text-lg w-10">{score ?? "—"}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
        <div className="h-full bg-[#6366F1]" style={{ width: `${((score ?? 0) / 10) * 100}%` }} />
      </div>
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
  const positive = ev.verdict === "replaceable" || ev.verdict === "pass";
  return (
    <div className="border border-[#E5E7EB] rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold">{ev.judge_model}</span>
        <span className={`text-sm font-bold ${positive ? "text-green-600" : "text-red-600"}`}>
          {positive ? "✅" : "❌"} {ev.verdict}
        </span>
        <span className="ml-auto text-xs text-gray-400">
          {formatCost(ev.cost)} · {new Date(ev.created_at).toLocaleString("zh-CN")}
        </span>
        <button onClick={() => onRerun(ev.judge_model)} disabled={rerunning}
                className="text-xs px-2 py-0.5 rounded-md border border-[#E5E7EB] text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          重新评分
        </button>
      </div>
      <div className="space-y-1 mb-2">
        <ScoreBar label="A" score={ev.score} />
        {ev.score_b !== null && <ScoreBar label="B" score={ev.score_b} />}
      </div>
      {ev.reasoning && <p className="text-sm text-gray-600 whitespace-pre-wrap">{ev.reasoning}</p>}
    </div>
  );
}

export function JudgePanel({ subjectId, compareId }: { subjectId: string; compareId: string }) {
  const [judgeModels, setJudgeModels] = useState<JudgeModel[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [rerunningModel, setRerunningModel] = useState<string | null>(null);

  useEffect(() => {
    api.getJudgeModels().then(setJudgeModels).catch(() => setJudgeModels([]));
    api.getEvaluations(subjectId, compareId).then(setEvaluations).catch(() => {});
  }, [subjectId, compareId]);

  const toggle = (m: string) =>
    setSelected((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);

  const run = async () => {
    setRunning(true);
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
    <section className="mt-6">
      <h3 className="text-sm font-semibold mb-3">LLM Judge 评分</h3>
      {judgeModels.length === 0 ? (
        <p className="text-sm text-gray-400">
          没有可用的 judge 模型——先到 Settings 配置 provider 并在定价表中关联模型。
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 mb-2">
          {judgeModels.map((m) => (
            <label key={m.model} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={selected.includes(m.model)}
                     onChange={() => toggle(m.model)} />
              {m.model} <span className="text-xs text-gray-400">({m.provider_name})</span>
            </label>
          ))}
          <button onClick={run} disabled={selected.length === 0 || running}
                  className="text-sm px-4 py-1.5 rounded-md bg-[#6366F1] text-white disabled:opacity-50">
            {running ? "评分中…" : "运行 Judge ▶"}
          </button>
        </div>
      )}
      <p className="text-xs text-gray-400 mb-4">相同组合默认返回缓存结果；重新评分会追加新记录。</p>
      {errors._global && <p className="text-sm text-red-600 mb-2">{errors._global}</p>}
      {Object.entries(errors).filter(([k]) => k !== "_global").map(([model, err]) => (
        <p key={model} className="text-sm text-red-600 mb-2">{model}: {err}</p>
      ))}
      <div className="grid gap-3 md:grid-cols-2">
        {dedupeLatestByJudgeContext(evaluations).map((ev) => (
          <EvalCard key={ev.id} ev={ev} onRerun={rerun} rerunning={rerunningModel === ev.judge_model} />
        ))}
      </div>
    </section>
  );
}
