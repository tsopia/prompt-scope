import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TraceTree } from "../TraceTree";
import type { ObservationNode } from "@/lib/api";

const node = (over: Partial<ObservationNode>): ObservationNode => ({
  id: "x", parent_id: null, type: "span", name: "", seq: 0, status: "success",
  error: null, started_at: null, ended_at: null, latency_ms: null, model: null,
  model_params: null, messages: null, tool_definitions: null, tool_calls: null,
  completion: null, input_tokens: null, output_tokens: null, cost: null,
  tool_input: null, tool_output: null, children: [], ...over,
});

const tree: ObservationNode[] = [
  node({
    id: "llm-1", type: "llm", name: "plan", model: "gpt-4o", cost: 0.001,
    latency_ms: 900,
    children: [
      node({ id: "tool-1", type: "tool", name: "search", latency_ms: 120 }),
    ],
  }),
];

describe("TraceTree", () => {
  it("renders nested nodes with type badges", () => {
    render(<TraceTree nodes={tree} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText("plan")).toBeDefined();
    expect(screen.getByText("search")).toBeDefined();
    expect(screen.getByText("llm")).toBeDefined();
    expect(screen.getByText("tool")).toBeDefined();
  });

  it("fires onSelect with node id when clicked", () => {
    const onSelect = vi.fn();
    render(<TraceTree nodes={tree} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("search"));
    expect(onSelect).toHaveBeenCalledWith("tool-1");
  });
});
