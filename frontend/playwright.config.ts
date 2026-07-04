import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const REPO_ROOT = path.resolve(__dirname, "..");
export const PYTHON_BIN = path.join(REPO_ROOT, "backend", ".venv", "bin", "python");
export const BACKEND_URL = "http://localhost:8100";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "journey",
      testMatch: /journey\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "theme",
      testMatch: /theme\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["journey"],
    },
  ],
  webServer: [
    {
      command:
        'bash -c "cd ../backend && rm -f db/e2e.db && DATABASE_URL=sqlite:///./db/e2e.db .venv/bin/uvicorn main:app --port 8100"',
      port: 8100,
      reuseExistingServer: false,
      timeout: 30_000,
      cwd: __dirname,
    },
    {
      command: 'bash -c "API_PROXY_HOST=http://localhost:8100 npm run dev -- --port 3100"',
      port: 3100,
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: __dirname,
    },
  ],
});
