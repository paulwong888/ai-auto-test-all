import { test, expect } from "@playwright/test";

test("使用正确账号密码登录并进入控制台", async ({ page }) => {
  // Given 用户打开登录页面
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "用户登录" })).toBeVisible();

  // When 在用户名输入框中输入 admin
  await page.getByRole("textbox", { name: "用户名" }).fill("admin");

  // When 在密码输入框中输入 123456
  await page.getByRole("textbox", { name: "密码" }).fill("123456");

  // When 点击登录按钮
  await page.getByRole("button", { name: "登录" }).click();

  // Then 跳转到控制台页面并展示登录成功，欢迎回来的提示
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "控制台" })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "登录成功，欢迎回来" })
  ).toBeVisible();
});

test("登录成功后查看控制台统计概览", async ({ page }) => {
  // Given 用户已成功登录并进入控制台页面
  await page.goto("/login");
  await page.getByRole("textbox", { name: "用户名" }).fill("admin");
  await page.getByRole("textbox", { name: "密码" }).fill("123456");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "控制台" })).toBeVisible();

  // When 控制台页面加载完成
  const statsSection = page.getByRole("region", { name: "统计概览" });
  await expect(statsSection).toBeVisible();

  // Then 页面展示今日概览统计数据，包括活跃用户数和待办事项数
  await expect(statsSection.getByRole("heading", { name: "今日概览" })).toBeVisible();
  await expect(statsSection).toContainText("活跃用户：128");
  await expect(statsSection).toContainText("待办事项：5");

  // And 页面显示登录成功，欢迎回来的状态提示
  await expect(
    page.getByRole("status").filter({ hasText: "登录成功，欢迎回来" })
  ).toBeVisible();
});

test("输入错误账号密码后显示错误提示", async ({ page }) => {
  // Given 用户打开登录页面
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "用户登录" })).toBeVisible();

  // When 在用户名输入框中输入任意非 admin 的用户名
  await page.getByRole("textbox", { name: "用户名" }).fill("wronguser");

  // When 在密码输入框中输入错误密码
  await page.getByRole("textbox", { name: "密码" }).fill("wrongpass");

  // When 点击登录按钮
  await page.getByRole("button", { name: "登录" }).click();

  // Then 页面显示用户名或密码错误的提示，并停留在登录页
  await expect(page.getByRole("alert")).toHaveText("用户名或密码错误");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "用户登录" })).toBeVisible();
});
