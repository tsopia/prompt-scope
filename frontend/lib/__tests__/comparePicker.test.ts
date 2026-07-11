import { describe, expect, it } from "vitest";
import { groupTracesByName, pickerSubtitle } from "../comparePicker";
import type { TraceSummary } from "@/lib/api";

const trace = (over: Partial<TraceSummary>): TraceSummary => ({
  id: "t-0",
  name: "agent-a",
  origin: "live",
  status: "success",
  model_summary: "gpt-4o",
  observation_count: 1,
  total_input_tokens: 10,
  total_output_tokens: 5,
  total_cost: 0.001,
  latency_ms: 100,
  started_at: null,
  created_at: "2026-01-01T00:00:00Z",
  divergence_count: 0,
  summary: null,
  input_preview: null,
  replay_source: null,
  ...over,
});

describe("groupTracesByName", () => {
  it("groups traces by name, preserving first-seen order, with correct counts", () => {
    const traces = [
      trace({ id: "1", name: "agent-a" }),
      trace({ id: "2", name: "agent-b" }),
      trace({ id: "3", name: "agent-a" }),
    ];
    const groups = groupTracesByName(traces);
    expect(groups.map((g) => g.name)).toEqual(["agent-a", "agent-b"]);
    expect(groups[0].traces.map((t) => t.id)).toEqual(["1", "3"]);
    expect(groups[1].traces.map((t) => t.id)).toEqual(["2"]);
  });

  it("buckets unnamed traces under a single (未命名) group", () => {
    const traces = [trace({ id: "1", name: "" }), trace({ id: "2", name: "" })];
    const groups = groupTracesByName(traces);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("(未命名)");
    expect(groups[0].traces).toHaveLength(2);
  });
});

describe("pickerSubtitle", () => {
  it("prefers summary over input_preview", () => {
    expect(pickerSubtitle(trace({ summary: "摘要", input_preview: "预览" }))).toBe("摘要");
  });

  it("falls back to input_preview when summary is absent", () => {
    expect(pickerSubtitle(trace({ summary: null, input_preview: "预览" }))).toBe("预览");
  });

  it("returns null when the trace is unresolved (undefined) or has neither field", () => {
    expect(pickerSubtitle(undefined)).toBeNull();
    expect(pickerSubtitle(trace({ summary: null, input_preview: null }))).toBeNull();
  });
});
