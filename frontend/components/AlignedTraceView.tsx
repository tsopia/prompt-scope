"use client";
import { AlignedRow } from "@/lib/align";
import { ObservationNode } from "@/lib/api";
import { formatCost, formatLatency } from "@/lib/format";

const TYPE_STYLES: Record<string, string> = {
  llm: "bg-purple-100 text-purple-700",
  tool: "bg-emerald-100 text-emerald-700",
  span: "bg-gray-100 text-gray-600",
};

function Cell({ node, missing, missingLabel }: {
  node: ObservationNode | null; missing?: boolean; missingLabel?: string;
}) {
  if (!node) {
    return (
      <div className={`flex-1 px-3 py-2 text-xs italic ${
        missing ? "text-gray-300 bg-gray-50" : "text-gray-300"}`}>
        {missingLabel ?? "—"}
      </div>
    );
  }
  return (
    <div className="flex-1 px-3 py-2 flex items-center gap-2 text-sm min-w-0">
      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${TYPE_STYLES[node.type]}`}>
        {node.type}
      </span>
      <span className="font-medium truncate">{node.name || node.id.slice(0, 8)}</span>
      {node.model && <span className="text-xs text-gray-400 shrink-0">{node.model}</span>}
      <span className="ml-auto text-xs text-gray-400 font-mono shrink-0">
        {node.cost !== null ? formatCost(node.cost) : ""} {formatLatency(node.latency_ms)}
      </span>
    </div>
  );
}

export function AlignedTraceView({ rows }: { rows: AlignedRow[] }) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] divide-y divide-[#F3F4F6]">
      {rows.map((row, i) => (
        <div key={i} className={`flex items-stretch ${
          row.status === "only_left" ? "bg-red-50/50" :
          row.status === "only_right" ? "bg-green-50/50" : ""}`}>
          <Cell node={row.left} missing={row.status === "only_right"}
                missingLabel="－ 此步仅存在于右侧" />
          <div className="w-16 shrink-0 flex items-center justify-center text-xs">
            {row.status === "matched" && row.paramDiff && (
              <span className="text-amber-600" title="工具入参与另一侧不一致">⚠ 参数</span>
            )}
            {row.status === "matched" && !row.paramDiff && (
              <span className="text-gray-300">=</span>
            )}
            {row.status === "only_left" && <span className="text-red-400">－</span>}
            {row.status === "only_right" && <span className="text-green-500">＋</span>}
          </div>
          <Cell node={row.right} missing={row.status === "only_left"}
                missingLabel="－ 此步仅存在于左侧" />
        </div>
      ))}
      {rows.length === 0 && (
        <div className="p-6 text-sm text-gray-400 text-center">两条 trace 都没有 observation</div>
      )}
    </div>
  );
}
