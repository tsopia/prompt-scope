import type { StatusBadgeKind } from "@/components/StatusBadge";
import type { TraceSummary, TraceDetail } from "./api";

// 共享的 trace 状态判定：链路列表 (TraceTable)、详情页、对比选择器都要用同一套
// success/error/running/偏离(warning) 判定，避免各处各写一份漂移。
export function traceStatusKind(
  t: Pick<TraceSummary | TraceDetail, "status" | "divergence_count">,
): { kind: StatusBadgeKind; label: string } {
  if (t.status === "success" && t.divergence_count > 0) return { kind: "warning", label: "偏离" };
  if (t.status === "error") return { kind: "error", label: "失败" };
  if (t.status === "running") return { kind: "running", label: "运行中" };
  return { kind: "success", label: "通过" };
}
