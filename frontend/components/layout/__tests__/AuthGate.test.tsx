import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { api, type CurrentUser, type Project } from "@/lib/api";
import { AuthGate } from "../AuthGate";

const memoryStorage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => memoryStorage.set(key, value),
  removeItem: (key: string) => memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/traces",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
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
    },
  };
});

const me: CurrentUser = {
  id: "user-1",
  email: "a@x.com",
  display_name: "A",
  auth_source: "local",
};

const project: Project = { id: "proj-1", name: "项目 A", summary_model: null };

function renderGate() {
  return render(
    <AuthProvider>
      <AuthGate>
        <div>PAGE-CONTENT</div>
      </AuthGate>
    </AuthProvider>
  );
}

describe("AuthGate first-run onboarding screen", () => {
  beforeEach(() => {
    memoryStorage.clear();
    vi.mocked(api.getMe).mockResolvedValue(me);
    vi.mocked(api.getMembers).mockResolvedValue([]);
  });

  it("does not flash the first-run screen while the projects fetch is still pending", async () => {
    let resolveProjects: (p: Project[]) => void;
    vi.mocked(api.getProjects).mockReturnValue(
      new Promise((resolve) => {
        resolveProjects = resolve;
      })
    );

    renderGate();

    await screen.findByText("PAGE-CONTENT");
    expect(screen.queryByText("创建你的第一个项目")).toBeNull();

    resolveProjects!([]);
    await waitFor(() => {
      expect(screen.getByText("创建你的第一个项目")).toBeDefined();
    });
  });

  it("shows the first-run screen once projects have loaded and are empty", async () => {
    vi.mocked(api.getProjects).mockResolvedValue([]);

    renderGate();

    await waitFor(() => {
      expect(screen.getByText("创建你的第一个项目")).toBeDefined();
    });
    expect(screen.queryByText("PAGE-CONTENT")).toBeNull();
  });

  it("hides the first-run screen and renders page content when projects exist", async () => {
    vi.mocked(api.getProjects).mockResolvedValue([project]);

    renderGate();

    await screen.findByText("PAGE-CONTENT");
    expect(screen.queryByText("创建你的第一个项目")).toBeNull();
  });
});
