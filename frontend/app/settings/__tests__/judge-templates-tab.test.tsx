import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { api, type CurrentUser, type JudgeTemplate, type Member, type Project } from "@/lib/api";
import SettingsPage from "../page";

// Node 25's built-in `localStorage` global shadows jsdom's and lacks
// getItem/setItem without `--localstorage-file`; ProjectContext relies on
// localStorage, so provide a minimal in-memory stub for this test file.
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
      getJudgeTemplates: vi.fn(),
      deleteJudgeTemplate: vi.fn(),
    },
  };
});

const project: Project = { id: "proj-1", name: "Test Project", summary_model: null };

const ownerUser: CurrentUser = {
  id: "user-owner",
  email: "owner@example.com",
  display_name: "Owner",
  auth_source: "local",
};

const memberUser: CurrentUser = {
  id: "user-member",
  email: "member@example.com",
  display_name: "Member",
  auth_source: "local",
};

const members: Member[] = [
  {
    user_id: "user-owner",
    email: "owner@example.com",
    display_name: "Owner",
    role: "owner",
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    user_id: "user-member",
    email: "member@example.com",
    display_name: "Member",
    role: "member",
    created_at: "2026-01-02T00:00:00Z",
  },
];

const templates: JudgeTemplate[] = [
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

function renderSettingsPage() {
  return render(
    <AuthProvider>
      <ProjectProvider>
        <SettingsPage />
      </ProjectProvider>
    </AuthProvider>
  );
}

async function openJudgeTemplatesTab() {
  const tabTrigger = await screen.findByText("评分模板");
  // Radix TabsTrigger activates on mousedown (not click); see components/ui/tabs.tsx.
  fireEvent.mouseDown(tabTrigger, { button: 0 });
}

describe("评分模板 tab", () => {
  beforeEach(() => {
    vi.mocked(api.getProjects).mockResolvedValue([project]);
    vi.mocked(api.getProviders).mockResolvedValue([]);
    vi.mocked(api.getPricing).mockResolvedValue([]);
    vi.mocked(api.getProjectKeys).mockResolvedValue([]);
    vi.mocked(api.getJudgeTemplates).mockResolvedValue(templates);
  });

  it("renders the 系统默认 pseudo-row with its fixed description and 不可编辑 chip", async () => {
    vi.mocked(api.getMe).mockResolvedValue(ownerUser);
    vi.mocked(api.getMembers).mockResolvedValue(members);
    renderSettingsPage();

    await openJudgeTemplatesTab();

    await waitFor(() => {
      expect(screen.getByText("系统默认")).toBeDefined();
    });
    expect(screen.getByText("不可编辑")).toBeDefined();
    expect(
      screen.getByText("内置通用评审标准（正确性/完整性/遵循指令/简洁性）"),
    ).toBeDefined();
    // Real template also rendered.
    expect(screen.getByText("严格版")).toBeDefined();
  });

  it("shows enabled edit/delete for the owner", async () => {
    vi.mocked(api.getMe).mockResolvedValue(ownerUser);
    vi.mocked(api.getMembers).mockResolvedValue(members);
    renderSettingsPage();

    await openJudgeTemplatesTab();
    await waitFor(() => expect(screen.getByText("严格版")).toBeDefined());

    const row = screen.getByText("严格版").closest(".p-4") as HTMLElement;
    const editButton = within(row).getByTitle("编辑");
    expect(editButton).toHaveProperty("disabled", false);
  });

  it("disables edit/delete for a non-creator member with a tooltip", async () => {
    vi.mocked(api.getMe).mockResolvedValue(memberUser);
    vi.mocked(api.getMembers).mockResolvedValue(members);
    renderSettingsPage();

    await openJudgeTemplatesTab();
    await waitFor(() => expect(screen.getByText("严格版")).toBeDefined());

    const row = screen.getByText("严格版").closest(".p-4") as HTMLElement;
    const buttons = within(row).getAllByRole("button");
    // Both edit and delete buttons should be disabled (title attribute omitted when disabled).
    buttons.forEach((btn) => expect(btn).toHaveProperty("disabled", true));
  });

  it("deletes a template via the confirmation dialog", async () => {
    vi.mocked(api.getMe).mockResolvedValue(ownerUser);
    vi.mocked(api.getMembers).mockResolvedValue(members);
    vi.mocked(api.deleteJudgeTemplate).mockResolvedValue({ deleted: true });
    renderSettingsPage();

    await openJudgeTemplatesTab();
    await waitFor(() => expect(screen.getByText("严格版")).toBeDefined());

    const row = screen.getByText("严格版").closest(".p-4") as HTMLElement;
    fireEvent.click(within(row).getByTitle("删除"));

    const confirmButton = await screen.findByRole("button", { name: "确认删除" });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(api.deleteJudgeTemplate).toHaveBeenCalledWith("tmpl-1");
    });
  });
});
