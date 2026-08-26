import { type Page } from "@playwright/test";
import { LoginPage } from "../pages/login.page";

// CI では ci.yml の "Seed test user" が /api/v1/secret/create-seed-user で
// このユーザーを先に作る。ローカルで動かすときは /signup から同じ値で登録しておく。
export const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "admin@example.com";
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "admin123";

export async function login(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) {
  // セレクタは LoginPage に一本化する。画面の文言が変わったときに
  // 直す場所が 2 箇所に散らないようにするため。
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(email, password);
  await page.waitForURL("/dashboard", { timeout: 15_000 });
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "ログアウト" }).click();
  await page.waitForURL("/login", { timeout: 10_000 });
}
