import { test, expect } from "@playwright/test";

test("登录成功后查看控制台概览", async ({ page }) => {
  // Given 用户已成功登录并进入控制台页面
  await page.goto("/dashboard");

  // When 看到欢迎回来的提示
  await expect(page.getByRole("status")).toContainText("欢迎回来");

  // When 查看今日概览区域
  const overview = page.getByRole("region", { name: "统计概览" });
  await expect(overview.getByRole("heading", { name: "今日概览" })).toBeVisible();

  // Then 页面显示登录成功的欢迎信息
  await expect(page.getByRole("heading", { name: "控制台" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("登录成功，欢迎回来");

  // And 统计概览中显示活跃用户和待办事项数量
  await expect(overview).toContainText("活跃用户：128");
  await expect(overview).toContainText("待办事项：5");
});
