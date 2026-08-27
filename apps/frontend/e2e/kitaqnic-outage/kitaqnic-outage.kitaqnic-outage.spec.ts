import { test, expect } from "@playwright/test";

/**
 * @registry-kitaqnic-outage — kitaqnic が落ちている時間帯にだけ緑になる異常系。
 *
 * kitaqnic 側の hello が返らないとき、`/api/v1/public/domains/check` は kitaqnic 管轄の
 * TLD (`.xyz` など) を「確認できませんでした」枠に落とす想定。ユーザーには
 * 「取得可能かは今分からない、時間をおいて再検索して」という UX が伝わる必要がある。
 *
 * kitaqnic が動いている時間帯には失敗する。それが期待動作。
 */
test.describe(
  "kitaqnic 障害時: .xyz が「確認できませんでした」枠に出る",
  { tag: "@registry-kitaqnic-outage" },
  () => {
    test(".xyz を含む検索で kitaqnic 側の TLD が失敗表示になる", async ({ page }) => {
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

      // kitaqnic 管轄 (.xyz) が失敗枠に載っている
      await expect(page.getByText(`${name}.xyz`)).toBeVisible();
    });
  },
);
