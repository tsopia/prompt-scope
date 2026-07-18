import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { api, type Evaluation, type JudgeModel, type JudgeTemplate } from "@/lib/api";
import { TooltipProvider } from "@/components/ui/tooltip";
import { JudgePanel } from "../JudgePanel";

// jsdom 未实现 scrollIntoView / hasPointerCapture，Radix Select 打开下拉时会调用它们。
Element.prototype.scrollIntoView = vi.fn();
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = vi.fn();
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = vi.fn();
}

// Node 25's built-in `localStorage` global shadows jsdom's and lacks
// getItem/setItem without `--localstorage-file`; JudgePanel persists the last
// chosen judge template there, so provide a minimal in-memory stub.
const memoryStorage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => memoryStorage.set(key, value),
  removeItem: (key: string) => memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getJudgeModels: vi.fn(),
      getJudgeTemplates: vi.fn(),
      getEvaluations: vi.fn(),
      evaluate: vi.fn(),
    },
  };
});

const judgeModels: JudgeModel[] = [{ model: "gpt-4o", provider_name: "OpenAI" }];

const judgeTemplates: JudgeTemplate[] = [
  {
    id: "tmpl-1",
    project_id: "proj-1",
    name: "严格版",
    content: "你是一名严厉的评审……",
    created_by: "user-owner",
    created_by_name: "Owner",
    created_at: "2026-01-03T00:00:00Z",
  },
];

const evaluation: Evaluation = {
  id: "eval-1",
  subject_trace_id: "trace-a",
  compare_trace_id: "trace-b",
  judge_model: "gpt-4o",
  context_mode: "output_only",
  score: 8,
  score_b: 6,
  verdict: "not_replaceable",
  reasoning: "A 更完整",
  cost: 0.01,
  created_at: "2026-01-04T00:00:00Z",
  judge_template_id: "tmpl-1",
  judge_template_name: "严格版",
  dimensions: null,
  evidence: null,
  evidence_step: null,
  confidence: null,
};

function renderPanel() {
  return render(
    <TooltipProvider>
      <JudgePanel subjectId="trace-a" compareId="trace-b" projectId="proj-1" />
    </TooltipProvider>,
  );
}

// 选中裁判模型：先打开 DropdownMenu（触发按钮文案是「已选 N 个模型」，不是模型名本身），
// 再用 role 定位 checkbox item —— 该 item 内部是「gpt-4o」文本节点 + 嵌套 <span>(OpenAI)</span>，
// 没有单一元素的 textContent 恰好等于 "gpt-4o"，默认 getByText 精确匹配找不到它。
// Radix's DropdownMenuTrigger opens on `pointerdown`, not `click` — a plain click
// event never toggles it in jsdom.
// The menu stays open after a checkbox item is clicked (onSelect calls
// preventDefault so multiple models can be toggled without re-opening) — Radix
// hides the rest of the page from the accessibility tree while it's open
// (aria-hidden focus scoping), so close it with Escape once done.
async function selectJudgeModel(model: string) {
  fireEvent.pointerDown(screen.getByText(/已选 \d+ 个模型/), { button: 0 });
  const item = await screen.findByRole("menuitemcheckbox", { name: new RegExp(model) });
  fireEvent.click(item);
  fireEvent.keyDown(item, { key: "Escape" });
}

describe("JudgePanel — 评分模板", () => {
  beforeEach(() => {
    memoryStorage.clear();
    vi.mocked(api.getJudgeModels).mockReset().mockResolvedValue(judgeModels);
    vi.mocked(api.getJudgeTemplates).mockReset().mockResolvedValue(judgeTemplates);
    vi.mocked(api.getEvaluations).mockReset().mockResolvedValue([]);
    vi.mocked(api.evaluate)
      .mockReset()
      .mockResolvedValue({
        results: [{ judge_model: "gpt-4o", status: "ok", evaluation, error: null }],
      });
  });

  it("degrades to 系统默认-only when the template fetch fails", async () => {
    vi.mocked(api.getJudgeTemplates).mockRejectedValue(new Error("network error"));
    renderPanel();

    await waitFor(() => expect(screen.getByText("系统默认")).toBeDefined());
    // No crash, no error surfaced for the template fetch itself.
    expect(screen.queryByText("network error")).toBeNull();
  });

  it("lists project templates alongside 系统默认 in the select", async () => {
    renderPanel();

    await waitFor(() => expect(api.getJudgeTemplates).toHaveBeenCalledWith("proj-1"));
    const trigger = screen.getByText("系统默认");
    fireEvent.click(trigger);

    await screen.findByText("严格版", { selector: "[role=option] *, [role=option]" });
  });

  it("omits judge_template_id from the evaluate body when 系统默认 is selected", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText(/已选 \d+ 个模型/)).toBeDefined());

    await selectJudgeModel("gpt-4o");
    fireEvent.click(screen.getByRole("button", { name: "运行评分" }));

    await waitFor(() => expect(api.evaluate).toHaveBeenCalled());
    const body = vi.mocked(api.evaluate).mock.calls[0][0];
    expect(body.judge_template_id).toBeUndefined();
  });

  it("includes judge_template_id in the evaluate body once a template is selected, and persists the choice", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText(/已选 \d+ 个模型/)).toBeDefined());

    const templateTrigger = screen.getByText("系统默认");
    fireEvent.click(templateTrigger);
    const option = await screen.findByText("严格版", { selector: "[role=option] *, [role=option]" });
    fireEvent.click(option);

    await waitFor(() => {
      expect(localStorage.getItem("promptscope.judgeTemplate.proj-1")).toBe("tmpl-1");
    });

    await selectJudgeModel("gpt-4o");
    fireEvent.click(screen.getByRole("button", { name: "运行评分" }));

    await waitFor(() => expect(api.evaluate).toHaveBeenCalled());
    const body = vi.mocked(api.evaluate).mock.calls[0][0];
    expect(body.judge_template_id).toBe("tmpl-1");
  });

  it("shows the 模板 · {name} chip on a result card when judge_template_name is present", async () => {
    vi.mocked(api.getEvaluations).mockResolvedValue([evaluation]);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("模板 · 严格版")).toBeDefined();
    });
  });
});

describe("JudgePanel — 上下文模式", () => {
  beforeEach(() => {
    memoryStorage.clear();
    vi.mocked(api.getJudgeModels).mockReset().mockResolvedValue(judgeModels);
    vi.mocked(api.getJudgeTemplates).mockReset().mockResolvedValue([]);
    vi.mocked(api.getEvaluations).mockReset().mockResolvedValue([]);
  });

  it("offers all three context modes, including the new 工具输出对齐", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("仅最终输出")).toBeDefined());

    fireEvent.click(screen.getByText("仅最终输出"));
    await screen.findByText("完整对话", { selector: "[role=option] *, [role=option]" });
    expect(screen.getByText("工具输出对齐", { selector: "[role=option] *, [role=option]" })).toBeDefined();
  });
});

describe("JudgePanel — 陪审团式评分结果（维度/证据/置信）", () => {
  const baseEval = evaluation;

  beforeEach(() => {
    memoryStorage.clear();
    vi.mocked(api.getJudgeModels).mockReset().mockResolvedValue(judgeModels);
    vi.mocked(api.getJudgeTemplates).mockReset().mockResolvedValue([]);
  });

  it("omits dimension bars, evidence block and confidence dots when all three are null", async () => {
    vi.mocked(api.getEvaluations).mockReset().mockResolvedValue([baseEval]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("gpt-4o")).toBeDefined());
    expect(screen.queryByText("证据")).toBeNull();
    expect(screen.queryByText("置信")).toBeNull();
  });

  it("renders dimension split bars, evidence block and confidence dots when present", async () => {
    const richEval: Evaluation = {
      ...baseEval,
      dimensions: [
        { name: "准确性", score: null, score_a: 8, score_b: 6 },
        { name: "完整性", score: null, score_a: 7, score_b: 7 },
      ],
      evidence: "B 在 charge_payment 使用了 saved_card，与 A 的 default_card 不一致。",
      evidence_step: "step 4",
      confidence: 3,
    };
    vi.mocked(api.getEvaluations).mockReset().mockResolvedValue([richEval]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("准确性")).toBeDefined());
    expect(screen.getByText("完整性")).toBeDefined();
    expect(screen.getByText("证据")).toBeDefined();
    expect(screen.getByText("step 4")).toBeDefined();
    expect(screen.getByText(/charge_payment/)).toBeDefined();
    expect(screen.getByText("置信")).toBeDefined();
  });

  it("aggregates verdicts into a 合议汇总 tally and consensus sentence", async () => {
    const judgeB: Evaluation = {
      ...baseEval, id: "eval-2", judge_model: "claude-3.5-sonnet",
      verdict: "replaceable", score: 8, score_b: 9,
    };
    vi.mocked(api.getEvaluations).mockReset().mockResolvedValue([baseEval, judgeB]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("合议汇总")).toBeDefined());
    expect(screen.getByText("2 位裁判")).toBeDefined();
  });
});
