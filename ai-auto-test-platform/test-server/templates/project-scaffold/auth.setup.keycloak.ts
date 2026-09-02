import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const authDir = path.join(__dirname, ".auth");
const authFile = path.join(authDir, "user.json");

setup("Keycloak 登入並保存 storageState", async ({ page, baseURL }) => {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error("缺少 E2E_USERNAME / E2E_PASSWORD（請配置 .env.e2e）");
  }

  fs.mkdirSync(authDir, { recursive: true });

  const appOrigin = new URL(baseURL ?? "__TARGET_URL__").origin;

  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 120_000 });

  await page.waitForURL(/rhsso|auth.*login|openid-connect|keycloak/i, {
    timeout: 120_000,
  });

  const usernameInput = page.locator("#username, input[name='username']").first();
  const passwordInput = page.locator("#password, input[name='password']").first();
  const submitBtn = page.locator("#kc-login, input[type='submit'], button[type='submit']").first();

  await usernameInput.fill(username);
  await passwordInput.fill(password);
  await submitBtn.click();

  const invalidLogin = page.getByText(/invalid username or password/i);
  if (await invalidLogin.isVisible({ timeout: 5_000 }).catch(() => false)) {
    throw new Error(
      `Keycloak 登入失敗：帳密不正確（${username}）。請更新 .env.e2e 後重跑 auth.setup。`,
    );
  }

  await page.waitForURL(
    (url) => {
      const href = url.toString();
      return href.startsWith(appOrigin) && !/rhsso|auth.*login|openid-connect|keycloak/i.test(href);
    },
    { timeout: 180_000 },
  );

  await page.context().storageState({ path: authFile });
});
