import { test, expect } from "@playwright/test";

/**
 * @registry-none — カート機能廃止（issue #64）のうち、レジストリ疎通が要らない部分。
 *
 * ヘッダー上のカート導線が消えたことの確認のみ。検索結果に依存するテストは
 * kitaqsign 側の spec に移した (`e2e/kitaqsign/proceed-to-complete.kitaqsign.spec.ts`)。
 */
test.describe(
  "カート機能廃止後: ヘッダー",
  { tag: "@registry-none" },
  () => {
    test("ヘッダーにカートアイコンが無い", async ({ page }) => {
      await page.goto("/");
      // 旧実装のカートアイコンには sr-only で「カートを見る」テキストが付いていた。
      // ボタン・リンクいずれのロールでも該当が0件であることを確認する。
      await expect(page.getByRole("link", { name: /カートを見る/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /カートを見る/ })).toHaveCount(0);
    });
  },
);
