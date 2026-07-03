"use client";
import { useEffect, useState } from "react";
import { api, Evaluation, JudgeModel, JudgeRunResult } from "@/lib/api";
import { formatCost } from "@/lib/format";

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

function EvalCard({ ev }: { ev: Evaluation }) {
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

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold mb-3">LLM Judge 评分</h3>
      {judgeModels.length === 0 ? (
        <p className="text-sm text-gray-400">
          没有可用的 judge 模型——先到 Settings 配置 provider 并在定价表中关联模型。
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 mb-4">
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
      {errors._global && <p className="text-sm text-red-600 mb-2">{errors._global}</p>}
      {Object.entries(errors).filter(([k]) => k !== "_global").map(([model, err]) => (
        <p key={model} className="text-sm text-red-600 mb-2">{model}: {err}</p>
      ))}
      <div className="grid gap-3 md:grid-cols-2">
        {evaluations.map((ev) => <EvalCard key={ev.id} ev={ev} />)}
      </div>
    </section>
  );
}
