"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ObservationNode, TraceDetail } from "@/lib/api";
import { formatCost, formatLatency, formatTokens } from "@/lib/format";
import { TraceTree } from "@/components/TraceTree";
import { ObservationDetail } from "@/components/ObservationDetail";

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

  if (error) return <main className="p-8 text-sm text-red-500">加载失败：{error}</main>;
  if (!trace) return <main className="p-8 text-sm text-gray-400">加载中…</main>;

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="mb-4">
        <Link href="/traces" className="text-xs text-[#6366F1]">← 返回列表</Link>
        <div className="flex items-center gap-3 mt-2">
          <h2 className="text-base font-semibold">{trace.name || trace.id.slice(0, 8)}</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            trace.origin === "replay" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
          }`}>{trace.origin}</span>
          {trace.status === "error" && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">error</span>
          )}
          <Link href={`/compare?a=${trace.id}`}
                className="text-xs px-3 py-1 rounded-md border border-[#6366F1] text-[#6366F1] hover:bg-[#EEF0FF]">
            加入对比
          </Link>
          <span className="ml-auto text-xs text-gray-500 font-mono">
            {formatTokens(trace.total_input_tokens)} / {formatTokens(trace.total_output_tokens)} tokens
            · {formatCost(trace.total_cost)} · {formatLatency(trace.latency_ms)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(280px,2fr)_3fr] gap-4">
        <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-y-auto max-h-[70vh]">
          <div className="px-3 py-2 border-b border-[#F3F4F6]">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">调用链路</p>
          </div>
          <TraceTree nodes={trace.observations} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-y-auto max-h-[70vh]">
          {selected ? (
            <ObservationDetail node={selected} />
          ) : (
            <div className="p-8 text-sm text-gray-400">点击左侧节点查看详情</div>
          )}
        </div>
      </div>
    </main>
  );
}
