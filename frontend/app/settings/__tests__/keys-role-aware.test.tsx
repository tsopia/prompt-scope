import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { api, ApiError, type CurrentUser, type Member, type Project } from "@/lib/api";
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
    },
  };
});

const project: Project = { id: "proj-1", name: "Test Project", summary_model: null };

const memberUser: CurrentUser = {
  id: "user-member",
  email: "member@example.com",
  display_name: "Member",
  auth_source: "local",
};

const ownerUser: CurrentUser = {
  id: "user-owner",
  email: "owner@example.com",
  display_name: "Owner",
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

function renderSettingsPage() {
  return render(
    <AuthProvider>
      <ProjectProvider>
        <SettingsPage />
      </ProjectProvider>
    </AuthProvider>
  );
}

describe("API 密钥 tab — member (non-owner)", () => {
  beforeEach(() => {
    vi.mocked(api.getMe).mockResolvedValue(memberUser);
    vi.mocked(api.getProjects).mockResolvedValue([project]);
    vi.mocked(api.getMembers).mockResolvedValue(members);
    vi.mocked(api.getProviders).mockResolvedValue([]);
    vi.mocked(api.getPricing).mockResolvedValue([]);
    // GET /api/projects/{id}/keys is owner-only server-side — a member gets a 403.
    vi.mocked(api.getProjectKeys).mockRejectedValue(new ApiError(403, "owner role required"));
  });

  it("shows a graceful empty-state instead of an error, and hides 新建密钥", async () => {
    renderSettingsPage();

    await waitFor(() => {
      expect(screen.getByText("仅 owner 可管理 API 密钥")).toBeDefined();
    });
    expect(screen.queryByText("新建密钥")).toBeNull();
    expect(screen.queryByText("owner role required")).toBeNull();
  });

  it("shows a read-only note and disables 项目名称 on 项目信息", async () => {
    renderSettingsPage();

    await waitFor(() => {
      expect(screen.getByLabelText("项目名称")).toBeDefined();
    });
    expect(screen.getByLabelText("项目名称")).toHaveProperty("disabled", true);
    expect(screen.getByText("仅 owner 可修改")).toBeDefined();
  });
});

describe("API 密钥 tab — owner", () => {
  beforeEach(() => {
    vi.mocked(api.getMe).mockResolvedValue(ownerUser);
    vi.mocked(api.getProjects).mockResolvedValue([project]);
    vi.mocked(api.getMembers).mockResolvedValue(members);
    vi.mocked(api.getProviders).mockResolvedValue([]);
    vi.mocked(api.getPricing).mockResolvedValue([]);
    vi.mocked(api.getProjectKeys).mockResolvedValue([]);
  });

  it("shows the 新建密钥 control and an enabled 项目名称 input", async () => {
    renderSettingsPage();

    await waitFor(() => {
      expect(screen.getByText("新建密钥")).toBeDefined();
    });
    expect(screen.queryByText("仅 owner 可管理 API 密钥")).toBeNull();
    expect(screen.getByLabelText("项目名称")).toHaveProperty("disabled", false);
    expect(screen.queryByText("仅 owner 可修改")).toBeNull();
  });
});
