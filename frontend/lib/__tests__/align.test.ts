import { describe, expect, it } from "vitest";
import { alignTraces, flattenTree } from "../align";
import type { ObservationNode } from "../api";

const node = (over: Partial<ObservationNode>): ObservationNode => ({
  id: Math.random().toString(36).slice(2), parent_id: null, type: "span",
  name: "", seq: 0, status: "success", error: null, started_at: null,
  ended_at: null, latency_ms: null, model: null, model_params: null,
  messages: null, tool_definitions: null, tool_calls: null, completion: null,
  input_tokens: null, output_tokens: null, cost: null, tool_input: null,
  tool_output: null, children: [], ...over,
});

describe("flattenTree", () => {
  it("pre-order flattens nested children", () => {
    const tree = [node({ name: "root", children: [node({ name: "child" })] }),
                  node({ name: "sibling" })];
    expect(flattenTree(tree).map((n) => n.name)).toEqual(["root", "child", "sibling"]);
  });
});

describe("alignTraces", () => {
  it("matches identical sequences", () => {
    const a = [node({ type: "llm", name: "plan" }), node({ type: "tool", name: "search" })];
    const b = [node({ type: "llm", name: "plan" }), node({ type: "tool", name: "search" })];
    const rows = alignTraces(a, b);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "matched")).toBe(true);
  });

  it("reports extra step on the right as only_right", () => {
    const a = [node({ type: "llm", name: "plan" })];
    const b = [node({ type: "llm", name: "plan" }), node({ type: "tool", name: "extra" })];
    const rows = alignTraces(a, b);
    expect(rows.map((r) => r.status)).toEqual(["matched", "only_right"]);
    expect(rows[1].left).toBeNull();
  });

  it("reports renamed tool as only_left + only_right", () => {
    const a = [node({ type: "tool", name: "old_tool" })];
    const b = [node({ type: "tool", name: "new_tool" })];
    const statuses = alignTraces(a, b).map((r) => r.status).sort();
    expect(statuses).toEqual(["only_left", "only_right"]);
  });

  it("flags param diff on matched tools", () => {
    const a = [node({ type: "tool", name: "search", tool_input: { q: "x" } })];
    const b = [node({ type: "tool", name: "search", tool_input: { q: "y" } })];
    const rows = alignTraces(a, b);
    expect(rows[0].status).toBe("matched");
    expect(rows[0].paramDiff).toBe(true);
  });

  it("no param diff when tool inputs equal", () => {
    const a = [node({ type: "tool", name: "search", tool_input: { q: "x" } })];
    const b = [node({ type: "tool", name: "search", tool_input: { q: "x" } })];
    expect(alignTraces(a, b)[0].paramDiff).toBe(false);
  });
});
