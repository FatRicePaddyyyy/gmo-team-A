import { test, expect } from "@playwright/test";
import { DashboardPage } from "./pages/dashboard.page";
import { login, logout } from "./helpers/auth";

test.describe("ダッシュボード", () => {
  test("未ログイン状態では「ログインページへ」ボタンが表示される", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.loginPrompt).toBeVisible();
    // Button に nativeButton={false} を付けているため、<a> でも role は button になる
    await expect(
      page.getByRole("button", { name: "ログインページへ" }),
    ).toBeVisible();
  });

  test("ログイン後はマイドメインの見出しが表示される", async ({ page }) => {
    await login(page);
    const dashboard = new DashboardPage(page);
    await expect(dashboard.signedInHeading).toBeVisible();
  });

  test("ログイン後は取得済みドメインのセクションが表示される", async ({ page }) => {
    await login(page);
    const dashboard = new DashboardPage(page);
    await expect(dashboard.domainSection).toBeVisible();
  });

  test("ログアウトするとログインページに戻る", async ({ page }) => {
    await login(page);
    await logout(page);
    await expect(page).toHaveURL("/login");
  });
});
