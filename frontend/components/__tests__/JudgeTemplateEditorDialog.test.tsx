import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { api, ApiError, type JudgeTemplate } from "@/lib/api";
import { JudgeTemplateEditorDialog } from "../JudgeTemplateEditorDialog";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      createJudgeTemplate: vi.fn(),
      updateJudgeTemplate: vi.fn(),
    },
  };
});

const existingTemplate: JudgeTemplate = {
  id: "tmpl-1",
  project_id: "proj-1",
  name: "严格版",
  content: "你是一名严厉的评审……",
  created_by: "user-owner",
  created_by_name: "Owner",
  created_at: "2026-01-03T00:00:00Z",
};

describe("JudgeTemplateEditorDialog", () => {
  beforeEach(() => {
    vi.mocked(api.createJudgeTemplate).mockReset();
    vi.mocked(api.updateJudgeTemplate).mockReset();
  });

  it("shows a live char count and disables submit above the 8000 char limit", () => {
    render(
      <JudgeTemplateEditorDialog
        open
        onOpenChange={() => {}}
        mode={{ kind: "create", projectId: "proj-1", existingNames: [], onSaved: () => {} }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("模板名称（同项目内唯一）"), {
      target: { value: "新模板" },
    });
    const contentBox = screen.getByPlaceholderText(/描述评审身份与标准/);
    fireEvent.change(contentBox, { target: { value: "a".repeat(100) } });
    expect(screen.getByText("100 / 8000 字符")).toBeDefined();

    const submitButton = screen.getByRole("button", { name: "创建" }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);

    fireEvent.change(contentBox, { target: { value: "a".repeat(8001) } });
    expect(screen.getByText("8001 / 8000 字符")).toBeDefined();
    expect(submitButton.disabled).toBe(true);
  });

  it("disables submit when the name duplicates another existing template", () => {
    render(
      <JudgeTemplateEditorDialog
        open
        onOpenChange={() => {}}
        mode={{
          kind: "create",
          projectId: "proj-1",
          existingNames: ["严格版"],
          onSaved: () => {},
        }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("模板名称（同项目内唯一）"), {
      target: { value: "严格版" },
    });
    fireEvent.change(screen.getByPlaceholderText(/描述评审身份与标准/), {
      target: { value: "内容" },
    });

    expect(screen.getByText("已存在同名模板")).toBeDefined();
    const submitButton = screen.getByRole("button", { name: "创建" }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
  });

  it("prefills name/content in edit mode and calls updateJudgeTemplate on submit", async () => {
    vi.mocked(api.updateJudgeTemplate).mockResolvedValue(existingTemplate);
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();

    render(
      <JudgeTemplateEditorDialog
        open
        onOpenChange={onOpenChange}
        mode={{ kind: "edit", template: existingTemplate, existingNames: [], onSaved }}
      />
    );

    expect(screen.getByDisplayValue("严格版")).toBeDefined();
    expect(screen.getByDisplayValue("你是一名严厉的评审……")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(api.updateJudgeTemplate).toHaveBeenCalledWith("tmpl-1", {
        name: "严格版",
        content: "你是一名严厉的评审……",
      });
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSaved).toHaveBeenCalled();
  });

  it("surfaces a 409 conflict inline instead of closing", async () => {
    vi.mocked(api.createJudgeTemplate).mockRejectedValue(new ApiError(409, "duplicate"));
    const onOpenChange = vi.fn();

    render(
      <JudgeTemplateEditorDialog
        open
        onOpenChange={onOpenChange}
        mode={{ kind: "create", projectId: "proj-1", existingNames: [], onSaved: () => {} }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("模板名称（同项目内唯一）"), {
      target: { value: "新模板" },
    });
    fireEvent.change(screen.getByPlaceholderText(/描述评审身份与标准/), {
      target: { value: "内容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(screen.getByText("已存在同名模板")).toBeDefined();
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("expands the read-only 系统将自动注入 section on click", () => {
    render(
      <JudgeTemplateEditorDialog
        open
        onOpenChange={() => {}}
        mode={{ kind: "create", projectId: "proj-1", existingNames: [], onSaved: () => {} }}
      />
    );

    expect(screen.queryByText("任务输入 / 输出")).toBeNull();
    fireEvent.click(screen.getByText("系统将自动注入"));
    expect(screen.getByText("任务输入 / 输出")).toBeDefined();
    expect(screen.getByText(/JSON 输出格式/)).toBeDefined();
  });
});
