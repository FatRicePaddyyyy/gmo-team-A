import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/login.page";
import { TEST_EMAIL, TEST_PASSWORD } from "./helpers/auth";

test.describe("ログインページ", () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test("ページが正しく表示される", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
  });

  test("フォームの入力フィールドが正しい type を持つ", async () => {
    await expect(loginPage.emailInput).toHaveAttribute("type", "email");
    await expect(loginPage.passwordInput).toHaveAttribute("type", "password");
  });

  test("メールアドレスを入力できる", async () => {
    await loginPage.emailInput.fill("test@example.com");
    await expect(loginPage.emailInput).toHaveValue("test@example.com");
  });

  test("誤ったパスワードでログインするとエラーメッセージが表示される", async () => {
    await loginPage.login("wrong@example.com", "wrongpassword");
    await expect(loginPage.errorMessage).toBeVisible({ timeout: 10_000 });
  });

  test("正しい認証情報でログインするとダッシュボードに遷移する", async ({ page }) => {
    await loginPage.login(TEST_EMAIL, TEST_PASSWORD);
    await expect(page).toHaveURL("/dashboard", { timeout: 15_000 });
  });
});
