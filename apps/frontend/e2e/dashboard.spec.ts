import { test, expect } from "@playwright/test";
import { DashboardPage } from "./pages/dashboard.page";
import { login, logout } from "./helpers/auth";

test.describe("ダッシュボード", () => {
  test("未ログイン状態では「ログインページへ」ボタンが表示される", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(page.getByRole("button", { name: "ログインページへ" })).toBeVisible();
  });

  test("ダッシュボードのタイトルが表示される", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.heading).toBeVisible();
  });

  test("ログイン後はログイン済み状態が表示される", async ({ page }) => {
    await login(page);
    const dashboard = new DashboardPage(page);
    await expect(dashboard.loginStatusText).toBeVisible();
  });

  test("ログアウトするとログインページに戻る", async ({ page }) => {
    await login(page);
    await logout(page);
    await expect(page).toHaveURL("/login");
  });
});
