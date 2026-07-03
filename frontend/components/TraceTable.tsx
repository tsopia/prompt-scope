"use client";
import { useRouter } from "next/navigation";
import { TraceSummary } from "@/lib/api";
import { formatCost, formatLatency, formatTokens } from "@/lib/format";

export function TraceTable({ traces }: { traces: TraceSummary[] }) {
  const router = useRouter();

  if (traces.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-gray-400">
        暂无 trace 数据 — 用 examples/report_agent_run.py 上报一条试试
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-400 uppercase tracking-wider border-b border-[#E5E7EB]">
          <th className="px-4 py-2">名称</th>
          <th className="px-4 py-2">来源</th>
          <th className="px-4 py-2">模型</th>
          <th className="px-4 py-2">步数</th>
          <th className="px-4 py-2">Tokens (in/out)</th>
          <th className="px-4 py-2">成本</th>
          <th className="px-4 py-2">延迟</th>
          <th className="px-4 py-2">时间</th>
        </tr>
      </thead>
      <tbody>
        {traces.map((t) => (
          <tr
            key={t.id}
            onClick={() => router.push(`/traces/${t.id}`)}
            className="border-b border-[#F3F4F6] hover:bg-[#F5F6FF] cursor-pointer"
          >
            <td className="px-4 py-3 font-medium">{t.name || t.id.slice(0, 8)}</td>
            <td className="px-4 py-3">
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  t.origin === "replay"
                    ? "bg-purple-100 text-purple-700"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {t.origin}
              </span>
            </td>
            <td className="px-4 py-3 text-gray-600">{t.model_summary || "—"}</td>
            <td className="px-4 py-3">{t.observation_count}</td>
            <td className="px-4 py-3 text-gray-600">
              {formatTokens(t.total_input_tokens)} / {formatTokens(t.total_output_tokens)}
            </td>
            <td className="px-4 py-3 font-mono">{formatCost(t.total_cost)}</td>
            <td className="px-4 py-3">{formatLatency(t.latency_ms)}</td>
            <td className="px-4 py-3 text-gray-400 text-xs">
              {new Date(t.created_at).toLocaleString("zh-CN")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
