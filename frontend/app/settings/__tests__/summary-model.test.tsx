import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { api, type CurrentUser, type JudgeModel, type Project } from "@/lib/api";
import SettingsPage from "../page";

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
      getMe: vi.fn(),
      getProjects: vi.fn(),
      getMembers: vi.fn(),
      getProviders: vi.fn(),
      getPricing: vi.fn(),
      getProjectKeys: vi.fn(),
      getJudgeModels: vi.fn(),
      updateProject: vi.fn(),
    },
  };
});

const me: CurrentUser = {
  id: "user-owner",
  email: "owner@example.com",
  display_name: "Owner",
  auth_source: "local",
};

const judgeModels: JudgeModel[] = [
  { model: "gpt-4o", provider_name: "OpenAI" },
  { model: "claude-3-5-sonnet", provider_name: "Anthropic" },
];

function renderSettingsPage() {
  return render(
    <AuthProvider>
      <ProjectProvider>
        <SettingsPage />
      </ProjectProvider>
    </AuthProvider>
  );
}

describe("ProjectInfoCard 摘要模型", () => {
  beforeEach(() => {
    vi.mocked(api.getMe).mockResolvedValue(me);
    vi.mocked(api.getMembers).mockResolvedValue([]);
    vi.mocked(api.getProviders).mockResolvedValue([]);
    vi.mocked(api.getPricing).mockResolvedValue([]);
    vi.mocked(api.getProjectKeys).mockResolvedValue([]);
    vi.mocked(api.getJudgeModels).mockResolvedValue(judgeModels);
  });

  it("shows 关闭（默认） when project.summary_model is null", async () => {
    const project: Project = { id: "proj-1", name: "Test Project", summary_model: null };
    vi.mocked(api.getProjects).mockResolvedValue([project]);

    renderSettingsPage();

    await waitFor(() => {
      expect(screen.getByLabelText("摘要模型")).toBeDefined();
    });
    expect(screen.getByText("关闭（默认）")).toBeDefined();
    expect(
      screen.getByText(/配置后，新上报的链路会用该模型自动生成一句话摘要/),
    ).toBeDefined();
  });

  it("shows the configured model when project.summary_model is set", async () => {
    const project: Project = { id: "proj-1", name: "Test Project", summary_model: "gpt-4o" };
    vi.mocked(api.getProjects).mockResolvedValue([project]);

    renderSettingsPage();

    await waitFor(() => {
      expect(screen.getByText("gpt-4o")).toBeDefined();
    });
  });

  it("saves with summary_model: null via updateProject when 关闭（默认） is chosen from a configured state", async () => {
    const project: Project = { id: "proj-1", name: "Test Project", summary_model: "gpt-4o" };
    vi.mocked(api.getProjects).mockResolvedValue([project]);
    vi.mocked(api.updateProject).mockResolvedValue({
      id: "proj-1",
      name: "Test Project",
      summary_model: null,
      created_at: "2026-01-01T00:00:00Z",
    });

    renderSettingsPage();
    await waitFor(() => expect(screen.getByText("gpt-4o")).toBeDefined());

    const trigger = screen.getByLabelText("摘要模型");
    fireEvent.click(trigger);

    const option = await screen.findByText("关闭（默认）", { selector: "[role=option] *, [role=option]" });
    fireEvent.click(option);

    await waitFor(() => {
      expect(api.updateProject).toHaveBeenCalledWith("proj-1", {
        name: "Test Project",
        summary_model: null,
      });
    });
  });
});
