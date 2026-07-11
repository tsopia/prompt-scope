import type { TraceSummary } from "./api";

export interface TraceGroup {
  name: string;
  traces: TraceSummary[];
}

// 按 trace name（agent）分组，保留原有顺序（后端已按 created_at desc 返回）。
export function groupTracesByName(traces: TraceSummary[]): TraceGroup[] {
  const order: string[] = [];
  const map = new Map<string, TraceSummary[]>();
  for (const t of traces) {
    const key = t.name || "(未命名)";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(t);
  }
  return order.map((name) => ({ name, traces: map.get(name)! }));
}

export function pickerSubtitle(t: TraceSummary | undefined): string | null {
  return t?.summary || t?.input_preview || null;
}

// trace 已经从 /compare Hub 的一次 getTraces 拉取里取到时，直接复用其 summary/
// input_preview 做副标题；拉不到（不在已加载的 200 条内、或已删除）时不额外发请求，
// 静默跳过副标题展示。
export function buildTraceById(traces: TraceSummary[]): Map<string, TraceSummary> {
  return new Map(traces.map((t) => [t.id, t]));
}
