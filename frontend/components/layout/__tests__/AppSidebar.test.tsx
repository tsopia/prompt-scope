import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import { api, type CurrentUser, type Project } from "@/lib/api";
import { AppSidebar } from "../AppSidebar";

const memoryStorage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => memoryStorage.set(key, value),
  removeItem: (key: string) => memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/traces",
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getMe: vi.fn(),
      getProjects: vi.fn(),
      getMembers: vi.fn(),
      createProject: vi.fn(),
    },
  };
});

const me: CurrentUser = {
  id: "user-1",
  email: "a@x.com",
  display_name: "A",
  auth_source: "local",
};

const project: Project = { id: "proj-1", name: "现有项目", summary_model: null };

function renderSidebar() {
  return render(
    <AuthProvider>
      <ProjectProvider>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </ProjectProvider>
    </AuthProvider>
  );
}

describe("AppSidebar workspace switcher", () => {
  beforeEach(() => {
    memoryStorage.clear();
    vi.mocked(api.getMe).mockResolvedValue(me);
    vi.mocked(api.getProjects).mockResolvedValue([project]);
    vi.mocked(api.getMembers).mockResolvedValue([]);
  });

  it("shows a 新建项目 item after opening the dropdown, which opens the create-project dialog", async () => {
    renderSidebar();

    const trigger = await screen.findByLabelText("切换项目");
    expect(screen.queryByText("新建项目")).toBeNull();

    fireEvent.click(trigger);

    const createItem = await screen.findByText("新建项目");
    expect(createItem).toBeDefined();

    fireEvent.click(createItem);

    await waitFor(() => {
      expect(screen.getByText("创建后你将成为该项目的 owner")).toBeDefined();
    });
    // Dropdown panel itself should close once the create dialog opens (the
    // panel's project item has an aria-label of the project name; the
    // trigger button's own accessible name is "切换项目", not this).
    expect(screen.queryByRole("button", { name: "现有项目" })).toBeNull();
  });

  it("creates a project, refreshes the list, and switches to it on success", async () => {
    const created: Project = { id: "proj-2", name: "新项目", summary_model: null };
    vi.mocked(api.createProject).mockResolvedValue({ ...created, created_at: "2026-01-01T00:00:00Z" });

    renderSidebar();

    const trigger = await screen.findByLabelText("切换项目");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText("新建项目"));

    const input = await screen.findByPlaceholderText("项目名称");
    fireEvent.change(input, { target: { value: "新项目" } });

    vi.mocked(api.getProjects).mockResolvedValue([project, created]);

    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(api.createProject).toHaveBeenCalledWith({ name: "新项目" });
    });
    await waitFor(() => {
      // WorkspaceAvatar/trigger label reflects the newly switched-to project.
      expect(screen.getByText("新项目")).toBeDefined();
    });
  });
});
