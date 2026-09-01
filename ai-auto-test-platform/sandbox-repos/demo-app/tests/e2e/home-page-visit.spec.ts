import { test, expect } from "@playwright/test";

test("用户访问欢迎首页", async ({ page }) => {
  // Given 用户打开应用首页
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);

  // When 看到页面上的欢迎标题
  await expect(
    page.getByRole("heading", { name: "欢迎使用 Demo App" })
  ).toBeVisible();

  // Then 页面显示欢迎信息和应用说明（位於欢迎首页上）
  await expect(
    page.getByText("这是一个用于 AI 自动化测试平台审计的沙箱前端项目。")
  ).toBeVisible();

  // Then 跳转到登录页面
  await page.getByTestId("go-login").click();
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("heading", { name: "用户登录" })
  ).toBeVisible();

  // And 顶部导航栏提供首页、登录、控制台三个入口（導覽列為全域，登入頁亦顯示）
  const nav = page.locator("nav");
  await expect(nav.getByRole("link", { name: "首页" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "登录" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "控制台" })).toBeVisible();
});
