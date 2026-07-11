import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ObservationDetail } from "../ObservationDetail";
import type { ObservationNode } from "@/lib/api";

const node = (over: Partial<ObservationNode>): ObservationNode => ({
  id: "x", parent_id: null, type: "llm", name: "plan", seq: 0, status: "success",
  error: null, started_at: null, ended_at: null, latency_ms: null, model: "deepseek-chat",
  model_params: null, messages: [], tool_definitions: null, tool_calls: null,
  completion: null, input_tokens: null, output_tokens: null, cost: null,
  tool_input: null, tool_output: null, metadata: null, children: [], ...over,
});

describe("ObservationDetail 思考过程 (reasoning_content)", () => {
  it("renders the 思考过程 section in full detail when metadata.reasoning_content is present", () => {
    const n = node({ metadata: { reasoning_content: "先分析问题，再给出结论。" } });
    render(<ObservationDetail node={n} />);
    expect(screen.getByText("思考过程")).toBeDefined();
  });

  it("hides the 思考过程 section in full detail when reasoning_content is absent", () => {
    const n = node({ metadata: null });
    render(<ObservationDetail node={n} />);
    expect(screen.queryByText("思考过程")).toBeNull();
  });

  it("renders the 思考过程 section in compact detail when metadata.reasoning_content is present", () => {
    const n = node({ metadata: { reasoning_content: "推理内容" } });
    render(<ObservationDetail node={n} compact />);
    expect(screen.getByText("思考过程")).toBeDefined();
  });

  it("hides the 思考过程 section in compact detail when reasoning_content is absent", () => {
    const n = node({ metadata: {} });
    render(<ObservationDetail node={n} compact />);
    expect(screen.queryByText("思考过程")).toBeNull();
  });

  it("shows the char count in the collapsed header", () => {
    const content = "x".repeat(312);
    const n = node({ metadata: { reasoning_content: content } });
    render(<ObservationDetail node={n} />);
    expect(screen.getByText(`· ${content.length} 字`)).toBeDefined();
  });

  it("does not render the section for a non-llm node even if metadata carries reasoning_content", () => {
    const n = node({ type: "tool", name: "search", tool_input: {}, metadata: { reasoning_content: "不应出现" } });
    render(<ObservationDetail node={n} />);
    expect(screen.queryByText("思考过程")).toBeNull();
  });
});
