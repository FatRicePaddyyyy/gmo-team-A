import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";

/**
 * @registry-kitaqsign-normal — kitaqsign が動いている時間帯にだけ緑になる正常系。
 *
 * ログイン → `.com` 検索 → 取得 → マイドメイン確認 のフルフロー。
 * kitaqsign 側の hello が失敗しているとき (メンテ時間帯) には失敗する。それが期待動作。
 *
 * 前提の env:
 *  - NEXT_PUBLIC_BACKEND_URL: backend baseURL (例: http://localhost:8787)
 *  - SECRET_KEY: /api/v1/secret/create-seed-user を叩く Bearer
 */

// ミリ秒 + 乱数。並列・連続実行での検索名の衝突を避ける
function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
}

test.describe(
  "ログイン→検索→.com 取得のフルフロー",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    // シード API が使える環境 (SECRET_KEY 設定済み) でのみ走らせる。
    // ローカルで env を渡し忘れたときは、スイート全体を skip にして落ちない
    test.skip(
      !hasSeedEnv(),
      "SECRET_KEY が無いためスキップ。ローカルは backend の .env から export して再実行",
    );

    test("ログイン後、選んだ .com ドメインを取得してマイドメインに到達する", async ({
      page,
    }) => {
      const user = await createSeedUser({ label: "purchase-flow-ks" });

      // 1. ログインしてダッシュボードに着地
      await loginAndExpectDashboard(page, user);

      // 2. 検索。他のテストと重複しにくいユニークな名前で1件だけヒットさせる
      const domainName = `e2e-${uniqueSuffix()}`;
      await page.goto(`/?q=${domainName}`);
      await expect(page.getByRole("region", { name: "検索結果" })).toBeVisible();

      // 3. .com を選ぶ (kitaqsign 管轄)
      const proceedButton = page.getByRole("button", {
        name: new RegExp(`このドメインで進む.*${domainName}\\.com`),
      });
      await expect(proceedButton).toBeVisible();
      await proceedButton.click();

      // 4. 内容確認 (/cart/complete)。ログイン済みなので「お支払い方法の選択に進む」
      await expect(page).toHaveURL(/\/cart\/complete/);
      await expect(
        page.getByRole("region", { name: /確認したドメイン/ }),
      ).toBeVisible();
      await page.getByText("お支払い方法の選択に進む").click();

      // 5. 支払い方法。デモなのでデフォルト (クレジットカード) のまま確定
      await expect(page).toHaveURL(/\/cart\/payment/);
      await page.getByRole("button", { name: /この内容で確定する/ }).click();

      // 6. 取得完了ページ (/cart/done) に遷移し、達成の演出が出る
      await expect(page).toHaveURL(/\/cart\/done/, { timeout: 15_000 });
      await expect(
        page.getByRole("heading", { name: "ドメインを取得しました" }),
      ).toBeVisible();
      await expect(
        page.getByRole("list", { name: "取得したドメイン" }).getByText(`${domainName}.com`),
      ).toBeVisible();

      // 7. 「マイドメインで管理する」で /dashboard へ
      await page.getByText("マイドメインで管理する").click();
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole("heading", { name: "マイドメイン" })).toBeVisible();

      // 8. 取得したドメインが一覧に載っている
      await expect(page.getByText(`${domainName}.com`)).toBeVisible();
    });
  },
);
