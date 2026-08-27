import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { SeededUser } from "./seed-user";

/**
 * E2E テスト用のログインヘルパ。
 *
 * どのテストからも `login(page, user)` を呼ぶだけで、
 * /login → フォーム入力 → 送信 → ログイン後の画面表示待ち までを一気に済ませる。
 *
 * ログイン後の遷移先は `usePasswordLogin` の実装により、確定済みの注文が
 * あるかで /cart/payment / /dashboard のどちらかに分かれる。呼び出し側で
 * 遷移先を検証したいので、この関数では遷移完了までは待たず「ログインボタンを
 * 押したところ」で返す。遷移先の assertion はテスト側の責務にする。
 */

export interface LoginOptions {
  /** テスト単位でタイムアウトを上げたいときに使う（ミリ秒） */
  timeout?: number;
}

export async function login(
  page: Page,
  user: Pick<SeededUser, "email" | "password">,
  options: LoginOptions = {},
): Promise<void> {
  await page.goto("/login");
  // Next.js のハイドレーションが終わる前にクリックすると、RHF の preventDefault が
  // 効かず、フォームがネイティブ GET submit に落ちる（`?email=…&password=…` が URL に付く）。
  // networkidle を待ってから入力・送信する
  await page.waitForLoadState("networkidle");

  await page.getByLabel("メールアドレス").fill(user.email);
  await page.getByLabel("パスワード", { exact: true }).fill(user.password);

  // クリック直後に URL 遷移が始まるので、送信自体は fire-and-forget でよい。
  // 遷移先の検証はテスト側で行う（複数の遷移先があるため）
  await page
    .getByRole("button", { name: "ログインする" })
    .click({ timeout: options.timeout });
}

/**
 * 手っ取り早く「ログイン済み状態でダッシュボードにいる」まで運ぶ。
 * 確定済み注文が無い前提のセットアップで使う（購入フロー以外のテスト向け）。
 */
export async function loginAndExpectDashboard(
  page: Page,
  user: Pick<SeededUser, "email" | "password">,
): Promise<void> {
  await login(page, user);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "マイドメイン" })).toBeVisible();
}
