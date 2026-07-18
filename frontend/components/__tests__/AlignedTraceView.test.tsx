import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AlignedRow } from "@/lib/align";
import type { ObservationNode } from "@/lib/api";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AlignedTraceView } from "../AlignedTraceView";

function renderRows(rows: AlignedRow[]) {
  return render(
    <TooltipProvider>
      <AlignedTraceView rows={rows} />
    </TooltipProvider>,
  );
}

const node = (over: Partial<ObservationNode>): ObservationNode => ({
  id: Math.random().toString(36).slice(2), parent_id: null, type: "llm",
  name: "plan", seq: 0, status: "success", error: null, started_at: null,
  ended_at: null, latency_ms: 120, model: "gpt-4o", model_params: null,
  messages: null, tool_definitions: null, tool_calls: null, completion: null,
  input_tokens: null, output_tokens: null, cost: null, tool_input: null,
  tool_output: null, metadata: null, children: [], ...over,
});

describe("AlignedTraceView — 3-column marker rendering", () => {
  it("labels a matched, non-diverging row 双侧一致", () => {
    const rows: AlignedRow[] = [
      { left: node({ name: "plan" }), right: node({ name: "plan" }), status: "matched", paramDiff: false },
    ];
    renderRows(rows);
    expect(screen.getByText("双侧一致")).toBeDefined();
  });

  it("labels a matched row with differing tool params 参数偏离", () => {
    const rows: AlignedRow[] = [
      {
        left: node({ type: "tool", name: "search", tool_input: { q: "a" } }),
        right: node({ type: "tool", name: "search", tool_input: { q: "b" } }),
        status: "matched",
        paramDiff: true,
      },
    ];
    renderRows(rows);
    expect(screen.getByText("参数偏离")).toBeDefined();
  });

  it("labels a left-only row 仅 A and a right-only row 仅 B", () => {
    const rows: AlignedRow[] = [
      { left: node({ name: "only-here" }), right: null, status: "only_left", paramDiff: false },
      { left: null, right: node({ name: "only-there" }), status: "only_right", paramDiff: false },
    ];
    renderRows(rows);
    expect(screen.getByText("仅 A")).toBeDefined();
    expect(screen.getByText("仅 B")).toBeDefined();
  });

  it("renders nothing when both traces have zero observations", () => {
    render(<AlignedTraceView rows={[]} />);
    expect(screen.getByText("两条 trace 都没有 observation")).toBeDefined();
  });
});
