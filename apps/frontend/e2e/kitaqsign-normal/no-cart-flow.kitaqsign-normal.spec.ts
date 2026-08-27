import { test, expect } from "@playwright/test";

/**
 * @registry-kitaqsign-normal — kitaqsign 動作時にだけ緑になる正常系。
 *
 * カート機能廃止フローのうち、検索結果に「.com」が並ぶことに依存する 2 テスト。
 * `.com` は kitaqsign 管轄なので、kitaqsign 側の hello が返らない時間帯は失敗する
 * (それが期待動作)。
 */
test.describe(
  "カート機能廃止後: 検索結果と選択",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test("検索結果に「このドメインで進む」ボタンがあり、旧「カートに追加」は無い", async ({
      page,
    }) => {
      await page.goto("/?q=aa");

      // 検索結果セクションが描画されるまで待つ
      await expect(page.getByRole("region", { name: "検索結果", exact: true })).toBeVisible();

      // 新しい導線が出ている（複数件あるので first を検証）
      await expect(
        page.getByRole("button", { name: /このドメインで進む/ }).first(),
      ).toBeVisible();

      // 旧「カートに追加する」ボタンは消えている
      await expect(
        page.getByRole("button", { name: /カートに追加/ }),
      ).toHaveCount(0);
    });

    test("「このドメインで進む」を押すと選んだドメインが確認画面に渡る", async ({
      page,
    }) => {
      // 短い名前は実レジストリで既に取得済みで avail=false のことが多い。
      // e2e-<ランダム> のような十中八九空いている名前を使う
      const name = `e2e-nc-${Date.now()}${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0")}`;
      await page.goto(`/?q=${name}`);
      await expect(page.getByRole("region", { name: "検索結果", exact: true })).toBeVisible();

      // <name>.com の「このドメインで進む」を押す。
      // アクセシブルネームには sr-only の「（<name>.com）」が付いている。
      const proceedButton = page.getByRole("button", {
        name: new RegExp(`このドメインで進む.*${name}\\.com`),
      });
      await expect(proceedButton).toBeVisible();
      await proceedButton.click();

      // 内容確認画面。URL 遷移が競合するケースがあるので、URL ではなく localStorage 経由の
      // 確定内容が引き継がれているかで検証する（保存先が変わっても要件は満たされる）。
      await page.goto("/cart/complete");

      // 「確認したドメイン」の欄に <name> と .com が並んで表示される
      const confirmedSection = page.getByRole("region", {
        name: /確認したドメイン/,
      });
      await expect(confirmedSection).toBeVisible();
      await expect(confirmedSection.getByText(name, { exact: false })).toBeVisible();
      await expect(confirmedSection.getByText(".com", { exact: false })).toBeVisible();
    });
  },
);
