import { test, expect } from "@playwright/test";

test("访问首页并展示欢迎信息", async ({ page }) => {
  // Given 用户在浏览器中打开应用首页
  await page.goto("/");

  // When 页面加载完成
  await page.waitForLoadState("load");

  // Then 页面展示欢迎使用 Demo App 的标题
  await expect(page.locator("h1")).toHaveText("欢迎使用 Demo App");

  // And 页面上显示前往登录的链接，点击可进入登录页
  const loginLink = page.getByTestId("go-login");
  await expect(loginLink).toHaveText("前往登录");
  await expect(loginLink).toHaveAttribute("href", "/login");
  await loginLink.click();
  await expect(page).toHaveURL(/\/login/);
});
