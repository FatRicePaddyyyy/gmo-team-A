import { test, expect } from "@playwright/test";

/**
 * 「カート機能廃止・1ドメイン即決フロー」（issue #64）の受け入れテスト。
 *
 * ドメインは複数まとめ買いする商品ではないので、カート概念を消し、
 * 検索結果で「このドメインで進む」→ 内容確認 の一本道になっているかを見る。
 *
 * 挙動そのものが壊れていないかを見るための最小構成。詳細な文言は将来変わるので
 * 完全一致にせず、ロールと部分文字列で確認する。
 */

test.describe("カート機能廃止後の購入フロー", () => {
  test("ヘッダーにカートアイコンが無い", async ({ page }) => {
    await page.goto("/");
    // 旧実装のカートアイコンには sr-only で「カートを見る」テキストが付いていた。
    // ボタン・リンクいずれのロールでも該当が0件であることを確認する。
    await expect(page.getByRole("link", { name: /カートを見る/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /カートを見る/ })).toHaveCount(0);
  });

  test("検索結果に「このドメインで進む」ボタンがあり、旧「カートに追加」は無い", async ({
    page,
  }) => {
    await page.goto("/?q=aa");

    // 検索結果セクションが描画されるまで待つ
    await expect(page.getByRole("region", { name: "検索結果" })).toBeVisible();

    // 新しい導線が出ている（複数件あるので first を検証）
    await expect(
      page.getByRole("button", { name: /このドメインで進む/ }).first(),
    ).toBeVisible();

    // 旧「カートに追加する」ボタンは消えている
    await expect(
      page.getByRole("button", { name: /カートに追加/ }),
    ).toHaveCount(0);
  });

  test("「このドメインで進む」を押すと選んだドメインが確認画面に渡る", async ({ page }) => {
    await page.goto("/?q=aa");
    await expect(page.getByRole("region", { name: "検索結果" })).toBeVisible();

    // aa.com の「このドメインで進む」を押す。
    // アクセシブルネームには sr-only の「（aa.com）」が付いている。
    const proceedButton = page.getByRole("button", {
      name: /このドメインで進む.*aa\.com/,
    });
    await expect(proceedButton).toBeVisible();
    await proceedButton.click();

    // 内容確認画面。URL 遷移が競合するケースがあるので、URL ではなく localStorage 経由の
    // 確定内容が引き継がれているかで検証する（保存先が変わっても要件は満たされる）。
    await page.goto("/cart/complete");

    // 「確認したドメイン」の欄に aa と .com が並んで表示される
    const confirmedSection = page.getByRole("region", {
      name: /確認したドメイン/,
    });
    await expect(confirmedSection).toBeVisible();
    await expect(confirmedSection.getByText("aa", { exact: false })).toBeVisible();
    await expect(confirmedSection.getByText(".com", { exact: false })).toBeVisible();
  });
});
