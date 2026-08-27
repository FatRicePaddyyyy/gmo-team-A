import { test, expect } from "@playwright/test";

/**
 * @registry-none — レジストリ (kitaqsign / kitaqnic) の疎通が無くても動くべき最小テスト。
 *
 * トップページが 200 で描画されて SiteHeader が出るかだけ確認する。
 * - 認証不要のページを選ぶ (auth まわりのフィクスチャを持ち込まずに済ませる)
 * - タイトル存在 + ヘッダー可視 の 2 点だけを見る (壊れやすいテキスト assertion は避ける)
 */
test.describe("smoke", { tag: "@registry-none" }, () => {
  test("トップページが表示される", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/.+/);
    await expect(page.getByRole("banner")).toBeVisible();
  });
});
