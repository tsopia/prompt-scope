import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { E2E_USER_EMAIL, E2E_USER_PASSWORD, login } from "./scripts/auth";

const SCREENSHOT_DIR = path.join(__dirname, "..", "e2e-screenshots");

interface PageTarget {
  name: string;
  path: () => Promise<string>;
}

async function fetchJson(page: Page, url: string) {
  const resp = await page.request.get(url);
  expect(resp.ok()).toBeTruthy();
  return resp.json();
}

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test("theme screenshots: two themes x six pages", async ({ page }) => {
  // This test runs in its own browser context (a fresh session per Playwright
  // test), so it must log back in as the same user journey.spec.ts registered
  // to retain membership visibility on the project/traces/prompts it created.
  await login(page, E2E_USER_EMAIL, E2E_USER_PASSWORD);

  // Resolve the e2e-proj project id and real ids created by journey.spec.ts.
  const projects: Array<{ id: string; name: string }> = await fetchJson(page, "/api/projects");
  const project = projects.find((p) => p.name === "e2e-proj");
  expect(project, "e2e-proj must exist — run journey.spec.ts first").toBeTruthy();

  const tracesResult = await fetchJson(
    page,
    `/api/traces?project_id=${project!.id}&limit=50&offset=0`
  );
  const traces: Array<{ id: string; name: string; origin: string }> = tracesResult.items;
  const weatherTraces = traces.filter((t) => t.name === "e2e-weather-agent");
  expect(weatherTraces.length).toBeGreaterThanOrEqual(2);
  const detailTraceId = weatherTraces[0].id;
  const compareAId = weatherTraces[0].id;
  const compareBId = weatherTraces[1].id;
  const replayTraceId = weatherTraces[0].id;

  const prompts: Array<{ id: string; name: string }> = await fetchJson(
    page,
    `/api/prompts?project_id=${project!.id}`
  );
  const prompt = prompts.find((p) => p.name === "e2e-prompt");
  expect(prompt, "e2e-prompt must exist — run journey.spec.ts first").toBeTruthy();

  // Switch active project (localStorage-backed) before navigating to pages
  // that read from ProjectContext.
  await page.evaluate((id) => localStorage.setItem("promptscope.projectId", id), project!.id);

  const targets: PageTarget[] = [
    { name: "traces", path: async () => "/traces" },
    { name: "detail", path: async () => `/traces/${detailTraceId}` },
    { name: "compare", path: async () => `/compare?a=${compareAId}&b=${compareBId}` },
    { name: "replay", path: async () => `/replay/${replayTraceId}` },
    { name: "prompts", path: async () => "/prompts" },
    { name: "settings", path: async () => "/settings" },
  ];

  for (const theme of ["light", "dark"] as const) {
    // Set theme once per iteration via the sidebar toggle (persists in localStorage).
    await page.goto("/traces");
    await page.getByRole("button", { name: theme === "light" ? "浅色" : "深色" }).click();
    if (theme === "light") {
      await expect(page.locator("html")).not.toHaveClass(/dark/);
    } else {
      await expect(page.locator("html")).toHaveClass(/dark/);
    }

    for (const target of targets) {
      const url = await target.path();
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${target.name}-${theme}.png`),
        fullPage: true,
      });
    }
  }
});
