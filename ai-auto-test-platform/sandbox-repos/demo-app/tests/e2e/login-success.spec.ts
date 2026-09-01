import { test, expect } from "@playwright/test";

test("使用正确账号密码登录成功", async ({ page }) => {
  // Given 用户在登录页面
  await page.goto("/login");

  // When 在用户名输入框输入 admin
  await page.fill("#username", "admin");

  // When 在密码输入框输入 123456
  await page.fill("#password", "123456");

  // When 点击登录按钮提交表单
  await page.click('[aria-label="登录按钮"]');

  // Then 系统校验通过并跳转到控制台页面
  await expect(page).toHaveURL(/\/dashboard/);

  // And 不会显示错误提示
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
});
