import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { BACKEND_URL, PYTHON_BIN } from "../playwright.config";
import { E2E_USER_EMAIL, E2E_USER_PASSWORD, registerAndLogin } from "./scripts/auth";

const PROJECT_NAME = "e2e-proj";
const INGEST_SCRIPT = path.join(__dirname, "scripts", "ingest_e2e.py");

test.describe.configure({ mode: "serial" });

let apiKey = "";

test("full journey: project -> ingest -> traces -> compare -> judge -> replay -> prompts -> theme", async ({
  page,
}) => {
  // ---- Step 0: register + log in (backend is auth-gated end to end) ----
  await registerAndLogin(page, E2E_USER_EMAIL, E2E_USER_PASSWORD);

  // ---- Step 1: fresh user lands on the first-run screen; create project there ----
  // A brand-new user has zero projects, so the global first-run screen replaces
  // page content. Creating through it exercises the real onboarding path and
  // records an "owner" project_members row, so every membership-gated read below succeeds.
  await expect(page.getByText("创建你的第一个项目")).toBeVisible();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByPlaceholder("项目名称").fill(PROJECT_NAME);
  await page.getByRole("dialog").getByRole("button", { name: "创建" }).click();
  await expect(page.getByText("项目已创建")).toBeVisible();

  // Project becomes current; settings now manages the current project only.
  await page.goto("/settings");
  await page.getByRole("tab", { name: "项目与密钥" }).click();
  await expect(page.getByLabel("项目名称")).toHaveValue(PROJECT_NAME);
  await page.getByRole("button", { name: "新建密钥" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "创建" }).click();

  const keyDialog = page.getByRole("dialog").filter({ hasText: "密钥已创建" });
  await expect(keyDialog).toBeVisible();
  const codeText = await keyDialog.locator("pre code").innerText();
  const match = codeText.match(/ps-[A-Za-z0-9_-]+/);
  expect(match).toBeTruthy();
  apiKey = match![0];
  await keyDialog.getByRole("button", { name: "我已保存，完成" }).click();

  // ---- Step 2: ingest fixture traces via the Python SDK ----
  execFileSync(PYTHON_BIN, [INGEST_SCRIPT], {
    env: { ...process.env, PS_URL: BACKEND_URL, PS_KEY: apiKey },
    stdio: "inherit",
  });

  // ---- Step 3: switch to e2e-proj via sidebar project switcher, verify traces list ----
  await page.goto("/traces");
  await page.getByRole("button", { name: "切换项目" }).click();
  await page.getByRole("button", { name: PROJECT_NAME, exact: true }).click();

  await expect(page.getByText(/3 条 · 共 3/)).toBeVisible();
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(3);

  // search filter
  await page.getByPlaceholder("按名称搜索链路…").fill("weather");
  await expect(page.getByText(/2 条 · 共 2/)).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(2);

  // origin filter: every fixture trace is "live" (this journey never produces a
  // replay-origin trace — the replay in Step 7 fails on the first LLM call, so
  // result_trace_id stays null and no origin=replay trace is ever created).
  // Filtering to "Live" would be a no-op (still 2 rows); filtering to "回放"
  // (replay) is the assertion with actual discriminating power: it must show
  // zero rows plus the origin-specific empty state (not the project-level
  // onboarding card, since the project does have data — just none matching
  // this filter).
  await page.getByPlaceholder("按名称搜索链路…").fill("");
  await page.getByRole("button", { name: "回放" }).click();
  await expect(page.locator("table tbody tr")).toHaveCount(0);
  await expect(page.getByText("该来源下暂无 trace")).toBeVisible();

  await page.getByRole("button", { name: "全部" }).click();
  await expect(page.getByText(/3 条 · 共 3/)).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(3);

  // ---- Step 4: trace detail — click a node, assert detail changes ----
  const weatherRow = page.locator("table tbody tr", { hasText: "e2e-weather-agent" }).first();
  await weatherRow.click();
  await expect(page).toHaveURL(/\/traces\//);

  await page.getByText("get_weather", { exact: true }).first().click();
  await expect(page.locator("main").getByText("input")).toBeVisible();

  // ---- Step 5: back to list, select two weather traces, compare tray ----
  await page.goto("/traces");
  await page.getByPlaceholder("按名称搜索链路…").fill("weather");
  await expect(page.locator("table tbody tr")).toHaveCount(2);
  const weatherRows = page.locator("table tbody tr");
  await weatherRows.nth(0).getByRole("checkbox").click();
  await weatherRows.nth(1).getByRole("checkbox").click();

  await expect(page.getByRole("link", { name: "开始对比" })).toBeVisible();
  await page.getByRole("link", { name: "开始对比" }).click();
  await expect(page).toHaveURL(/\/compare\?a=.+&b=.+/);

  // 差异摘要 four metric cards (陪审团改版后标签：成本/延迟/输入 token/输出 token)
  await expect(page.getByText("差异摘要").first()).toBeVisible();
  await expect(page.getByText("成本", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("延迟", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("输入 token").first()).toBeVisible();
  await expect(page.getByText("输出 token").first()).toBeVisible();

  // aligned rows with a param mismatch warning chip (different city args)
  await expect(page.getByText("参数偏离").first()).toBeVisible();

  // ---- Step 6: settings -> fake provider + pricing -> back to compare -> run judge ----
  await page.goto("/settings");
  await page.getByRole("tab", { name: "模型 Provider" }).click();
  await page.getByRole("button", { name: "新增 Provider" }).click();
  const providerDialog = page.getByRole("dialog");
  await providerDialog.locator("button", { hasText: "官方直连" }).click();
  await providerDialog.getByPlaceholder("如 OpenRouter、自建网关").fill("e2e-fake-provider");
  await providerDialog.getByPlaceholder("https://api.openai.com/v1").fill("https://fake.invalid/v1");
  await providerDialog.locator('input[type="password"]').fill("sk-fake");
  await providerDialog.getByRole("button", { name: "添加 Provider" }).click();
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
  await page.getByPlaceholder("按名称搜索链路…").fill("weather");
  await expect(page.locator("table tbody tr")).toHaveCount(2);
  const rowsAgain = page.locator("table tbody tr");
  await rowsAgain.nth(0).getByRole("checkbox").click();
  await rowsAgain.nth(1).getByRole("checkbox").click();
  await page.getByRole("link", { name: "开始对比" }).click();
  await expect(page).toHaveURL(/\/compare\?a=.+&b=.+/);

  await page.getByRole("button", { name: /已选 \d+ 个模型/ }).click();
  await page.getByRole("menuitemcheckbox", { name: /gpt-4o/ }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "运行评分" }).click();
  // The fake provider has a bogus base URL, so the judge call must fail with
  // a real error surfaced in the panel — never a fabricated result.
  // 新结果卡结构：错误结果 = 「评分失败」StatusBadge + mono 模型名同卡呈现。
  await expect(page.getByText("评分失败").first()).toBeVisible({ timeout: 20_000 });

  // ---- Step 7: replay from trace detail, expect a real failure (fake provider) ----
  await page.goto("/traces");
  await page.getByPlaceholder("按名称搜索链路…").fill("weather");
  await page.locator("table tbody tr").first().click();
  await page.getByRole("link", { name: "回放整条" }).click();
  await expect(page).toHaveURL(/\/replay\//);

  // 覆盖模型现在是自定义 Select（Radix combobox），main 内第一个 combobox 就是它
  // （System Prompt 基准选择器是 main 内第二个）。
  await page.locator("main").getByRole("combobox").first().click();
  await page.getByRole("option", { name: /gpt-4o/ }).click();
  await page.getByRole("button", { name: "运行回放" }).click();

  // The fake provider has a bogus base URL, so the run must land as a failed
  // result: kind="error" rendered with the explicit Chinese label "失败" (see
  // ResultCard/HistoryEntry in app/replay/[id]/page.tsx), and the real error is
  // surfaced unconditionally in the result card's "回放失败" banner (never a
  // fabricated success) — no click-to-expand needed to see it.
  await expect(page.getByText("失败", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("回放失败")).toBeVisible();

  // ---- Step 8: prompts — create prompt, fork to v2, diff ----
  await page.goto("/prompts");
  await page.getByRole("button", { name: "新建 prompt" }).click();
  await page.getByPlaceholder("prompt 名称（唯一）").fill("e2e-prompt");
  // 大编辑器对话框：内容文本域无 placeholder，用 dialog 作用域定位
  await page.getByRole("dialog").locator("textarea").fill("You are a helpful assistant.\nBe concise.");
  await page.getByRole("dialog").getByRole("button", { name: "创建", exact: true }).click();

  await expect(page.getByRole("heading", { name: "e2e-prompt" })).toBeVisible();
  await page.getByRole("button", { name: "基于此版本新建" }).click();
  const forkTextarea = page.getByRole("dialog").locator("textarea");
  await forkTextarea.fill("You are a helpful assistant.\nBe concise.\nAlways greet the user.");
  await page.getByRole("dialog").getByRole("button", { name: "创建", exact: true }).click();

  await expect(page.getByText("v2").first()).toBeVisible();
  // check both version cards to trigger the diff view
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).click();
  await checkboxes.nth(1).click();

  const diffHeader = page.getByTestId("diff-version-range");
  await expect(diffHeader).toContainText("v1");
  await expect(diffHeader).toContainText("v2");
  await expect(page.getByTestId("diff-panel").getByText("Always greet the user.")).toBeVisible();

  // ---- Step 9: theme toggle in sidebar, verify html class + reload persistence ----
  await page.getByRole("button", { name: "浅色" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
