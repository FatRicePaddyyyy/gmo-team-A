import { test, expect } from "@playwright/test";

// 最小の smoke テスト。トップページが 200 で描画されて SiteHeader が出るかだけ確認する。
// 具体的な機能テストはあとで追加する前提の"骨だけ"。
// - 認証不要のページを選ぶ (auth まわりのフィクスチャを持ち込まずに済ませる)
// - タイトル存在 + ヘッダー可視 の 2 点だけを見る (壊れやすいテキスト assertion は避ける)
test("トップページが表示される", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.+/);
  await expect(page.getByRole("banner")).toBeVisible();
});
