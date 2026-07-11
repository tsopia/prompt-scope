import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { api, type CurrentUser, type Project } from "@/lib/api";
import SettingsPage from "../page";

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
    },
  };
});

const me: CurrentUser = {
  id: "user-owner",
  email: "owner@example.com",
  display_name: "Owner",
  auth_source: "local",
};

const current: Project = { id: "proj-1", name: "当前项目", summary_model: null };
const other: Project = { id: "proj-2", name: "另一个项目", summary_model: null };

function renderSettingsPage() {
  return render(
    <AuthProvider>
      <ProjectProvider>
        <SettingsPage />
      </ProjectProvider>
    </AuthProvider>
  );
}

describe("项目与密钥 tab — single column, current-project-only", () => {
  beforeEach(() => {
    memoryStorage.clear();
    vi.mocked(api.getMe).mockResolvedValue(me);
    vi.mocked(api.getProjects).mockResolvedValue([current, other]);
    vi.mocked(api.getMembers).mockResolvedValue([]);
    vi.mocked(api.getProviders).mockResolvedValue([]);
    vi.mocked(api.getPricing).mockResolvedValue([]);
    vi.mocked(api.getProjectKeys).mockResolvedValue([]);
    vi.mocked(api.getJudgeModels).mockResolvedValue([]);
  });

  it("renders 项目信息 and API 密钥 for the current project only, with no project-switch list or 新建项目 button", async () => {
    renderSettingsPage();

    await waitFor(() => {
      expect(screen.getByText("项目信息")).toBeDefined();
    });
    expect(screen.getByText("API 密钥")).toBeDefined();
    expect(screen.getByLabelText("项目名称")).toHaveProperty("value", "当前项目");

    // The other project must not appear as a switchable list item in this tab.
    expect(screen.queryByText("另一个项目")).toBeNull();
    // Project creation moved to the sidebar switcher — no create control here.
    expect(screen.queryByText("新建项目")).toBeNull();
  });
});
