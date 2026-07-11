import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { api, type Project, type PromptDetail, type PromptSummary } from "@/lib/api";
import PromptsPage from "../page";

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

// VersionCard always mounts ReplayWithVersionDialog (regardless of whether it's
// open), which calls next/navigation's useRouter() — outside a real Next.js app
// router tree that throws, so provide a minimal mock.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getProjects: vi.fn(),
      getPrompts: vi.fn(),
      getPrompt: vi.fn(),
      createPrompt: vi.fn(),
      addPromptVersion: vi.fn(),
    },
  };
});

const project: Project = { id: "proj-1", name: "Test Project", summary_model: null };

const prompts: PromptSummary[] = [
  {
    id: "prompt-1",
    name: "checkout_agent.system",
    version_count: 3,
    latest_version: 3,
    created_at: "2026-01-01T00:00:00Z",
  },
];

const detail: PromptDetail = {
  id: "prompt-1",
  name: "checkout_agent.system",
  project_id: "proj-1",
  versions: [
    { id: "v3", version: 3, content: "v3 content here", created_at: "2026-01-03T00:00:00Z" },
    { id: "v2", version: 2, content: "v2 content here", created_at: "2026-01-02T00:00:00Z" },
  ],
};

function renderPage() {
  return render(
    <ProjectProvider>
      <PromptsPage />
    </ProjectProvider>
  );
}

describe("PromptsPage 左列", () => {
  beforeEach(() => {
    vi.mocked(api.getProjects).mockResolvedValue([project]);
    vi.mocked(api.getPrompts).mockResolvedValue(prompts);
    vi.mocked(api.getPrompt).mockResolvedValue(detail);
  });

  it("renders the version-count/updated-time meta line and the latest-version chip", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("checkout_agent.system")).toBeDefined();
    });

    // meta line: "{N} 版本 · {更新时间}"
    expect(screen.getByText(/3 版本 ·/)).toBeDefined();
    // latest-version chip
    expect(screen.getByText("v3")).toBeDefined();
  });
});

describe("PromptsPage 新建 prompt 大编辑器 dialog", () => {
  beforeEach(() => {
    vi.mocked(api.getProjects).mockResolvedValue([project]);
    vi.mocked(api.getPrompts).mockResolvedValue(prompts);
    vi.mocked(api.getPrompt).mockResolvedValue(detail);
  });

  it("disables 创建 until both name and content are filled, then calls createPrompt", async () => {
    const created: PromptDetail = {
      id: "prompt-new",
      name: "new_prompt",
      project_id: "proj-1",
      versions: [{ id: "v1", version: 1, content: "hello", created_at: "2026-01-04T00:00:00Z" }],
    };
    vi.mocked(api.createPrompt).mockResolvedValue(created);

    renderPage();
    await waitFor(() => expect(screen.getByText("checkout_agent.system")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /新建 prompt/ }));

    // "新建 prompt" text now appears twice (trigger button + dialog title) —
    // assert on the dialog's unique 名称 field label instead.
    await screen.findByText("名称");

    const createButton = screen.getByRole("button", { name: "创建" });
    expect(createButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByPlaceholderText("prompt 名称（唯一）"), {
      target: { value: "new_prompt" },
    });
    expect(createButton).toHaveProperty("disabled", true);

    const textareas = document.querySelectorAll("textarea");
    fireEvent.change(textareas[textareas.length - 1], { target: { value: "hello" } });

    await waitFor(() => expect(createButton).toHaveProperty("disabled", false));

    fireEvent.click(createButton);

    await waitFor(() => {
      expect(api.createPrompt).toHaveBeenCalledWith({
        project_id: "proj-1",
        name: "new_prompt",
        content: "hello",
      });
    });
  });

  it("disables 创建 for a name duplicating an existing prompt", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("checkout_agent.system")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /新建 prompt/ }));
    await screen.findByText("名称");

    fireEvent.change(screen.getByPlaceholderText("prompt 名称（唯一）"), {
      target: { value: "checkout_agent.system" },
    });
    const textareas = document.querySelectorAll("textarea");
    fireEvent.change(textareas[textareas.length - 1], { target: { value: "anything" } });

    expect(await screen.findByText("已存在同名 prompt")).toBeDefined();
    expect(screen.getByRole("button", { name: "创建" })).toHaveProperty("disabled", true);
  });
});

describe("PromptsPage 基于此版本新建 fork dialog", () => {
  beforeEach(() => {
    vi.mocked(api.getProjects).mockResolvedValue([project]);
    vi.mocked(api.getPrompts).mockResolvedValue(prompts);
    vi.mocked(api.getPrompt).mockResolvedValue(detail);
  });

  it("prefills the textarea with the source version's content and shows an origin note", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("checkout_agent.system")).toBeDefined());

    fireEvent.click(screen.getByText("checkout_agent.system"));
    await waitFor(() => expect(screen.getAllByText(/基于此版本新建/).length).toBeGreaterThan(0));

    const forkButtons = screen.getAllByRole("button", { name: /基于此版本新建/ });
    fireEvent.click(forkButtons[0]);

    expect(await screen.findByText("基于 v3 新建版本")).toBeDefined();
    expect(screen.getByText(/checkout_agent.system v3/)).toBeDefined();

    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("v3 content here");
  });
});
