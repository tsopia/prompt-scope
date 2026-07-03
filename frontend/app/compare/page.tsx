"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, TraceDetail, TraceSummary } from "@/lib/api";
import { alignTraces, flattenTree } from "@/lib/align";
import { formatCost, formatLatency } from "@/lib/format";
import { AlignedTraceView } from "@/components/AlignedTraceView";
import { JudgePanel } from "@/components/JudgePanel";
import { useProject } from "@/contexts/ProjectContext";

function pct(a: number | null, b: number | null): string {
  if (a === null || b === null || a === 0) return "—";
  const d = ((b - a) / a) * 100;
  return `${d > 0 ? "↑" : "↓"} ${Math.abs(d).toFixed(0)}%`;
}

function Summary({ a, b }: { a: TraceDetail; b: TraceDetail }) {
  const stepsA = flattenTree(a.observations).length;
  const stepsB = flattenTree(b.observations).length;
  const items = [
    { label: "总成本", value: `${formatCost(a.total_cost)} → ${formatCost(b.total_cost)}`,
      delta: pct(a.total_cost, b.total_cost) },
    { label: "总延迟", value: `${formatLatency(a.latency_ms)} → ${formatLatency(b.latency_ms)}`,
      delta: pct(a.latency_ms, b.latency_ms) },
    { label: "Tokens (in)", value: `${a.total_input_tokens} → ${b.total_input_tokens}`,
      delta: pct(a.total_input_tokens, b.total_input_tokens) },
    { label: "步数", value: `${stepsA} → ${stepsB}`, delta: pct(stepsA, stepsB) },
  ];
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] px-4 py-3 mb-4 flex flex-wrap gap-x-8 gap-y-2">
      {items.map((it) => (
        <div key={it.label} className="text-sm">
          <span className="text-gray-400 mr-2">{it.label}</span>
          <span className="font-mono">{it.value}</span>
          <span className={`ml-2 font-semibold ${
            it.delta.startsWith("↓") ? "text-green-600" :
            it.delta.startsWith("↑") ? "text-red-600" : "text-gray-400"}`}>
            {it.delta}
          </span>
        </div>
      ))}
    </div>
  );
}

function PickB({ aId }: { aId: string }) {
  const { currentProject } = useProject();
  const router = useRouter();
  const [candidates, setCandidates] = useState<TraceSummary[]>([]);

  useEffect(() => {
    if (!currentProject) return;
    api.getTraces({ projectId: currentProject.id, limit: 100 })
      .then((r) => setCandidates(r.items.filter((t) => t.id !== aId)))
      .catch(() => {});
  }, [currentProject, aId]);

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 text-sm">
      <p className="mb-3 text-gray-600">选择要与之对比的另一条 trace：</p>
      <select className="border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm w-full max-w-xl"
              defaultValue=""
              onChange={(e) => e.target.value && router.push(`/compare?a=${aId}&b=${e.target.value}`)}>
        <option value="" disabled>选择 trace…</option>
        {candidates.map((t) => (
          <option key={t.id} value={t.id}>
            {(t.name || t.id.slice(0, 8))} · {t.model_summary || "?"} · {formatCost(t.total_cost)} · {t.origin}
          </option>
        ))}
      </select>
    </div>
  );
}

function TraceHeader({ t, side }: { t: TraceDetail; side: string }) {
  return (
    <div className="flex-1 px-3 py-2 text-sm">
      <span className="text-xs text-gray-400 mr-2">{side}</span>
      <Link href={`/traces/${t.id}`} className="font-semibold hover:text-[#6366F1]">
        {t.name || t.id.slice(0, 8)}
      </Link>
      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
        t.origin === "replay" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
        {t.origin}
      </span>
    </div>
  );
}

function CompareContent() {
  const params = useSearchParams();
  const aId = params.get("a");
  const bId = params.get("b");
  const [a, setA] = useState<TraceDetail | null>(null);
  const [b, setB] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setA(null); setB(null); setError(null);
    if (aId) api.getTrace(aId).then(setA).catch((e) => setError(String(e)));
    if (bId) api.getTrace(bId).then(setB).catch((e) => setError(String(e)));
  }, [aId, bId]);

  const rows = useMemo(() => (a && b ? alignTraces(a.observations, b.observations) : []),
                       [a, b]);

  if (!aId) {
    return <p className="text-sm text-gray-400">缺少参数——从 Traces 列表勾选两条 trace 进入对比。</p>;
  }
  if (error) return <p className="text-sm text-red-500">加载失败：{error}</p>;
  if (!a) return <p className="text-sm text-gray-400">加载中…</p>;
  if (!bId) return <PickB aId={aId} />;
  if (!b) return <p className="text-sm text-gray-400">加载中…</p>;

  return (
    <>
      <Summary a={a} b={b} />
      <div className="bg-white rounded-t-lg border border-b-0 border-[#E5E7EB] flex divide-x divide-[#F3F4F6]">
        <TraceHeader t={a} side="A" />
        <div className="w-16 shrink-0" />
        <TraceHeader t={b} side="B" />
      </div>
      <AlignedTraceView rows={rows} />
      <JudgePanel subjectId={a.id} compareId={b.id} />
    </>
  );
}

export default function ComparePage() {
  return (
    <main className="max-w-6xl mx-auto p-6">
      <h2 className="text-base font-semibold mb-4">对比工作台</h2>
      <Suspense fallback={<p className="text-sm text-gray-400">加载中…</p>}>
        <CompareContent />
      </Suspense>
    </main>
  );
}
