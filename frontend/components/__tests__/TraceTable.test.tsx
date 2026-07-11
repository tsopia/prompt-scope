import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TraceTable } from "../TraceTable";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { TraceSummary } from "@/lib/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const trace = (over: Partial<TraceSummary>): TraceSummary => ({
  id: "trace-0123456789",
  name: "my-agent",
  origin: "live",
  status: "success",
  model_summary: "gpt-4o",
  observation_count: 3,
  total_input_tokens: 100,
  total_output_tokens: 50,
  total_cost: 0.01,
  latency_ms: 500,
  started_at: null,
  created_at: new Date().toISOString(),
  divergence_count: 0,
  summary: null,
  input_preview: null,
  replay_source: null,
  ...over,
});

function renderTable(traces: TraceSummary[]) {
  render(
    <TooltipProvider>
      <TraceTable
        traces={traces}
        compareIds={[]}
        onToggleCompare={() => {}}
        onToggleAll={() => {}}
      />
    </TooltipProvider>,
  );
}

describe("TraceTable subtitle priority", () => {
  it("shows summary when present, taking priority over input_preview and id", () => {
    const t = trace({ summary: "用户请求退款并要求加急处理", input_preview: "帮我退款" });
    renderTable([t]);
    expect(screen.getByText("用户请求退款并要求加急处理")).toBeDefined();
    expect(screen.queryByText("帮我退款")).toBeNull();
  });

  it("falls back to input_preview when summary is absent", () => {
    const t = trace({ summary: null, input_preview: "帮我退款" });
    renderTable([t]);
    expect(screen.getByText("帮我退款")).toBeDefined();
  });

  it("falls back to the mono trace id as the subtitle when neither summary nor input_preview exist", () => {
    const t = trace({ summary: null, input_preview: null });
    renderTable([t]);
    expect(screen.getByText(t.id)).toBeDefined();
  });

  it("always keeps the mono id visible (as a hover title and, when a richer subtitle is shown, as a small third line)", () => {
    const t = trace({ summary: "一句话摘要" });
    renderTable([t]);
    // 富副标题存在时，mono id 仍以极小第三行渲染（非 hover 门控，保持可选中复制）
    expect(screen.getAllByText(t.id).length).toBeGreaterThan(0);
  });
});

describe("TraceTable replay lineage subtitle", () => {
  it("renders lineage subtitle for a replay trace with replay_source, truncating a long source name", () => {
    const t = trace({
      origin: "replay",
      summary: "被血缘副标题优先覆盖的摘要",
      replay_source: {
        source_trace_id: "src-000000001",
        source_trace_name: "这是一个非常非常非常长超过二十个字符的来源trace名称",
        override_model: "gpt-4o-mini",
        thinking: true,
      },
    });
    renderTable([t]);
    expect(screen.queryByText("被血缘副标题优先覆盖的摘要")).toBeNull();
    const cell = screen.getByText(/回放自/);
    expect(cell.textContent).toContain("回放自");
    expect(cell.textContent).toContain("gpt-4o-mini");
    expect(cell.textContent).toContain("思考");
    // 截断到 20 字符 + 省略号
    expect(cell.textContent).toContain("…");
  });

  it("renders 非思考 when thinking is false", () => {
    const t = trace({
      origin: "replay",
      replay_source: { source_trace_id: "src-1", thinking: false },
    });
    renderTable([t]);
    expect(screen.getByText(/回放自/).textContent).toContain("非思考");
  });

  it("falls back to the priority-1 rule (id) for a replay trace with no replay_source (老数据)", () => {
    const t = trace({ origin: "replay", replay_source: null, summary: null, input_preview: null });
    renderTable([t]);
    expect(screen.getByText(t.id)).toBeDefined();
    expect(screen.queryByText(/回放自/)).toBeNull();
  });
});
