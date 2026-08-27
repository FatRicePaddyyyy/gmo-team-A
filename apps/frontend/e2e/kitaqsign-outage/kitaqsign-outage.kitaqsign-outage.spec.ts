import { test, expect } from "@playwright/test";

/**
 * @registry-kitaqsign-outage — kitaqsign が落ちている時間帯にだけ緑になる異常系。
 *
 * kitaqsign 側の hello が返らないとき、`/api/v1/public/domains/check` は kitaqsign 管轄の
 * TLD (`.com` など) を「確認できませんでした」枠に落とす想定。ユーザーには
 * 「取得可能かは今分からない、時間をおいて再検索して」という UX が伝わる必要がある。
 *
 * kitaqsign が動いている時間帯には失敗する。それが期待動作
 * (「動いていないと見せていいはずのメッセージ」が出ていないため)。
 */
test.describe(
  "kitaqsign 障害時: .com が「確認できませんでした」枠に出る",
  { tag: "@registry-kitaqsign-outage" },
  () => {
    test(".com を含む検索で kitaqsign 側の TLD が失敗表示になる", async ({ page }) => {
      const name = `e2e-outage-${Date.now()}${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0")}`;
      await page.goto(`/?q=${name}`);
      await expect(page.getByRole("region", { name: "検索結果", exact: true })).toBeVisible();

      // 確認できなかったことが伝わる見出しが出ている。
      // 落ちている理由によって文言が変わる（メンテナンス中はそう明示する）ので、
      // どちらかが出ていればよい。
      await expect(
        page
          .getByText("空き状況を確認できませんでした")
          .or(page.getByText("ドメイン登録機関がメンテナンス中です")),
      ).toBeVisible();

      // kitaqsign 管轄 (.com) が失敗枠に載っている
      await expect(page.getByText(`${name}.com`)).toBeVisible();
    });
  },
);
