import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { api, type CurrentUser, type Member, type Project } from "@/lib/api";
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
      addMember: vi.fn(),
      removeMember: vi.fn(),
      getProviders: vi.fn(),
      getPricing: vi.fn(),
      getProjectKeys: vi.fn(),
    },
  };
});

const me: CurrentUser = {
  id: "user-owner",
  email: "owner@example.com",
  display_name: "Owner",
  auth_source: "local",
};

const project: Project = { id: "proj-1", name: "Test Project" };

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

describe("MembersTab", () => {
  beforeEach(() => {
    vi.mocked(api.getMe).mockResolvedValue(me);
    vi.mocked(api.getProjects).mockResolvedValue([project]);
    vi.mocked(api.getMembers).mockResolvedValue(members);
    vi.mocked(api.getProviders).mockResolvedValue([]);
    vi.mocked(api.getPricing).mockResolvedValue([]);
    vi.mocked(api.getProjectKeys).mockResolvedValue([]);
  });

  it("renders both member emails and shows remove only for the non-self member", async () => {
    renderSettingsPage();

    const membersTabTrigger = await screen.findByText("成员");
    // Radix TabsTrigger activates on mousedown (not click); see components/ui/tabs.tsx.
    fireEvent.mouseDown(membersTabTrigger, { button: 0 });

    await waitFor(() => {
      expect(screen.queryByText("owner@example.com")).toBeDefined();
      expect(screen.queryByText("member@example.com")).toBeDefined();
    });

    const removeButtons = await screen.findAllByText("移除");
    expect(removeButtons.length).toBe(1);

    const memberRow = screen.getByText("member@example.com").closest("tr");
    const ownerRow = screen.getByText("owner@example.com").closest("tr");
    expect(memberRow?.textContent?.includes("移除")).toBe(true);
    expect(ownerRow?.textContent?.includes("移除")).toBe(false);

    expect(screen.queryByPlaceholderText("邀请已注册用户的邮箱")).toBeDefined();
  });
});
