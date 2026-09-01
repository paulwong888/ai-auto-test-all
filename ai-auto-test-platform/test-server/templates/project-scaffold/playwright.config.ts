import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8037";
/** 若使用 auth.setup.ts，改為 tests/e2e/.auth/user.json 並加入 setup 專案 */
const authFile = process.env.PLAYWRIGHT_STORAGE_STATE;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: {
    baseURL,
    trace: "on-first-retry",
    ignoreHTTPSErrors: true,
    ...(authFile ? { storageState: authFile } : {}),
  },
  projects: authFile
    ? [
        { name: "setup", testMatch: /auth\.setup\.ts/ },
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"], storageState: authFile },
          dependencies: ["setup"],
          testIgnore: /auth\.setup\.ts/,
        },
      ]
    : [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
