import { test, expect } from "@playwright/test";

test("使用错误账号密码登录失败", async ({ page }) => {
  // Given 用户在登录页面
  await page.goto("/login");

  // When 输入错误的用户名或密码
  await page.getByLabel("用户名").fill("wronguser");
  await page.getByLabel("密码").fill("wrongpass");

  // When 点击登录按钮提交表单
  await page.getByRole("button", { name: "登录" }).click();

  // Then 页面显示“用户名或密码错误”的红色错误提示
  const errorAlert = page.getByRole("alert");
  await expect(errorAlert).toHaveText("用户名或密码错误");
  await expect(errorAlert).toHaveCSS("color", "rgb(220, 20, 60)"); // crimson

  // And 用户仍停留在登录页面，不会跳转到控制台
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "用户登录" })).toBeVisible();
});
