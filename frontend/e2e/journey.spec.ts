import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { BACKEND_URL, PYTHON_BIN } from "../playwright.config";

const PROJECT_NAME = "e2e-proj";
const INGEST_SCRIPT = path.join(__dirname, "scripts", "ingest_e2e.py");

test.describe.configure({ mode: "serial" });

let apiKey = "";

test("full journey: project -> ingest -> traces -> compare -> judge -> replay -> prompts -> theme", async ({
  page,
}) => {
  // ---- Step 1: create project + API key from /settings ----
  await page.goto("/settings");
  await page.getByRole("tab", { name: "项目与密钥" }).click();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByPlaceholder("项目名称").fill(PROJECT_NAME);
  await page.getByRole("dialog").getByRole("button", { name: "创建" }).click();
  await expect(page.getByText("项目已创建")).toBeVisible();

  // Newly created project becomes current; wait for its key panel.
  await expect(page.getByText(`${PROJECT_NAME} · API Key`)).toBeVisible();
  await page.getByRole("button", { name: "新建 API Key" }).click();

  const keyDialog = page.getByRole("dialog").filter({ hasText: "API Key 已创建" });
  await expect(keyDialog).toBeVisible();
  const codeText = await keyDialog.locator("pre code").innerText();
  const match = codeText.match(/ps-[A-Za-z0-9_-]+/);
  expect(match).toBeTruthy();
  apiKey = match![0];
  await keyDialog.getByRole("button", { name: "我已保存，关闭" }).click();

  // ---- Step 2: ingest fixture traces via the Python SDK ----
  execFileSync(PYTHON_BIN, [INGEST_SCRIPT], {
    env: { ...process.env, PS_URL: BACKEND_URL, PS_KEY: apiKey },
    stdio: "inherit",
  });

  // ---- Step 3: switch to e2e-proj via sidebar project switcher, verify traces list ----
  await page.goto("/traces");
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: PROJECT_NAME }).click();

  await expect(page.getByText(/共 3 条/)).toBeVisible();
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(3);

  // search filter
  await page.getByPlaceholder("按名称搜索…").fill("weather");
  await expect(page.getByText(/共 2 条/)).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(2);

  // origin filter: everything here is "live" so filtering to live keeps 2, still text-matched
  await page.getByRole("button", { name: "Live" }).click();
  await expect(page.locator("table tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "全部" }).click();
  await page.getByPlaceholder("按名称搜索…").fill("");
  await expect(page.getByText(/共 3 条/)).toBeVisible();

  // ---- Step 4: trace detail — click a node, assert detail changes ----
  const weatherRow = page.locator("table tbody tr", { hasText: "e2e-weather-agent" }).first();
  await weatherRow.click();
  await expect(page).toHaveURL(/\/traces\//);

  await page.getByText("get_weather", { exact: true }).first().click();
  await expect(page.locator("main").getByText("入参")).toBeVisible();

  // ---- Step 5: back to list, select two weather traces, compare tray ----
  await page.goto("/traces");
  await page.getByPlaceholder("按名称搜索…").fill("weather");
  await expect(page.locator("table tbody tr")).toHaveCount(2);
  const weatherRows = page.locator("table tbody tr");
  await weatherRows.nth(0).getByRole("checkbox").click();
  await weatherRows.nth(1).getByRole("checkbox").click();

  await expect(page.getByRole("link", { name: "开始对比" })).toBeVisible();
  await page.getByRole("link", { name: "开始对比" }).click();
  await expect(page).toHaveURL(/\/compare\?a=.+&b=.+/);

  // four metric cards (rendered twice — desktop grid + mobile tabs duplicate)
  await expect(page.getByText("总成本").first()).toBeVisible();
  await expect(page.getByText("总延迟").first()).toBeVisible();
  await expect(page.getByText("Tokens (in)").first()).toBeVisible();
  await expect(page.getByText("步数").first()).toBeVisible();

  // aligned rows with a param mismatch warning badge (different city args)
  await expect(page.getByText("⚠").first()).toBeVisible();

  // ---- Step 6: settings -> fake provider + pricing -> back to compare -> run judge ----
  await page.goto("/settings");
  await page.getByRole("tab", { name: "模型 Provider" }).click();
  await page.getByPlaceholder("名称").fill("e2e-fake-provider");
  await page.getByPlaceholder("Base URL（openai 兼容含 /v1；anthropic 填根地址）").fill("https://fake.invalid/v1");
  await page.getByPlaceholder("API Key").fill("sk-fake");
  await page.getByRole("button", { name: "添加" }).click();
  await expect(page.getByText("Provider 已创建")).toBeVisible();

  await page.getByRole("tab", { name: "定价" }).click();
  await page.getByPlaceholder("模型名（如 gpt-4o）").fill("gpt-4o");
  await page.getByPlaceholder("Input $/1K").fill("0.005");
  await page.getByPlaceholder("Output $/1K").fill("0.015");
  // link the pricing row to the fake provider so gpt-4o becomes a judge model
  const pricingProviderSelect = page.locator("form, div").filter({ hasText: "添加" }).getByRole("combobox").last();
  await pricingProviderSelect.click();
  await page.getByRole("option", { name: "e2e-fake-provider" }).click();
  await page.getByRole("button", { name: "添加" }).click();
  await expect(page.getByText("定价已创建")).toBeVisible();

  await page.goto("/traces");
  await page.getByPlaceholder("按名称搜索…").fill("weather");
  await expect(page.locator("table tbody tr")).toHaveCount(2);
  const rowsAgain = page.locator("table tbody tr");
  await rowsAgain.nth(0).getByRole("checkbox").click();
  await rowsAgain.nth(1).getByRole("checkbox").click();
  await page.getByRole("link", { name: "开始对比" }).click();
  await expect(page).toHaveURL(/\/compare\?a=.+&b=.+/);

  const judgeModelLabel = page.locator("label", { hasText: "gpt-4o" });
  await judgeModelLabel.getByRole("checkbox").click();
  await page.getByRole("button", { name: "运行 Judge ▶" }).click();
  // The fake provider has a bogus base URL, so the judge call must fail with
  // a real error surfaced in the panel — never a fabricated result.
  await expect(page.getByText(/gpt-4o:/)).toBeVisible({ timeout: 20_000 });

  // ---- Step 7: replay from trace detail, expect a real failure (fake provider) ----
  await page.goto("/traces");
  await page.getByPlaceholder("按名称搜索…").fill("weather");
  await page.locator("table tbody tr").first().click();
  await page.getByRole("link", { name: "回放 ▶" }).click();
  await expect(page).toHaveURL(/\/replay\//);

  const overrideModelSelect = page.locator("label", { hasText: "覆盖模型" }).locator("..").locator("select");
  await overrideModelSelect.selectOption({ label: "gpt-4o (e2e-fake-provider)" });
  await page.getByRole("button", { name: "运行回放 ▶" }).click();

  // Either a toast.error appears, or the history timeline shows a failed entry.
  const failedToast = page.getByText(/回放失败|error|fail/i).first();
  const failedHistoryBadge = page.locator("text=failed").first();
  await expect(failedToast.or(failedHistoryBadge)).toBeVisible({ timeout: 30_000 });

  // ---- Step 8: prompts — create prompt, fork to v2, diff ----
  await page.goto("/prompts");
  await page.getByRole("button", { name: "新建 Prompt" }).click();
  await page.getByPlaceholder("名称").fill("e2e-prompt");
  await page.getByPlaceholder("初始版本内容").fill("You are a helpful assistant.\nBe concise.");
  await page.getByRole("dialog").getByRole("button", { name: "创建" }).click();

  await expect(page.getByText("e2e-prompt 版本历史")).toBeVisible();
  await page.getByRole("button", { name: "基于此版本新建" }).click();
  const forkTextarea = page.getByRole("dialog").locator("textarea");
  await forkTextarea.fill("You are a helpful assistant.\nBe concise.\nAlways greet the user.");
  await page.getByRole("button", { name: "提交新版本" }).click();

  await expect(page.getByText("v2").first()).toBeVisible();
  // check both version cards to trigger the diff view
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).click();
  await checkboxes.nth(1).click();

  await expect(page.getByText("v1 → v2")).toBeVisible();
  await expect(page.getByText("+ Always greet the user.")).toBeVisible();

  // ---- Step 9: theme toggle in sidebar, verify html class + reload persistence ----
  await page.getByRole("button", { name: "浅色" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
