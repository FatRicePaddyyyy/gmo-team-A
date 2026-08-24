import { type Page } from "@playwright/test";

export const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "admin@example.com";
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "admin123";

export async function login(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL("/dashboard", { timeout: 15_000 });
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "ログアウト" }).click();
  await page.waitForURL("/login", { timeout: 10_000 });
}
