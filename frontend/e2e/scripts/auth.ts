import { expect, type Page } from "@playwright/test";

// Shared across journey.spec.ts (registers this user) and theme.spec.ts
// (logs back in as this same user in its own browser context) so the
// theme suite can see the project/traces/prompts the journey created.
export const E2E_USER_EMAIL = "journey@example.com";
export const E2E_USER_PASSWORD = "e2e-password-123";

/**
 * Registers a fresh user through the /login UI (registration is on by
 * default in the e2e backend) and waits for the post-auth redirect to
 * /traces. Any project created afterwards by this same page will be owned
 * by (and thus visible to) this user, since project creation also inserts
 * a ProjectMember row for the creator.
 */
export async function registerAndLogin(page: Page, email: string, password = "e2e-password-123") {
  await page.goto("/login");
  await page.getByText("没有账号？去注册").click();
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("显示名").fill("E2E User");
  await page.getByPlaceholder("密码（至少 8 位）").fill(password);
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/traces/);
}

/**
 * Logs in as an already-registered user (e.g. the one journey.spec.ts
 * registered). Each Playwright test gets a fresh browser context/session,
 * so tests that depend on journey.spec.ts's data but run afterwards in a
 * new context (like theme.spec.ts) must log back in as that same user to
 * retain membership visibility on that data.
 */
export async function login(page: Page, email: string, password = "e2e-password-123") {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码（至少 8 位）").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/traces/);
}
