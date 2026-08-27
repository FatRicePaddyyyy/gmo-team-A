import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";

/**
 * @registry-kitaqnic-normal — kitaqnic が動いている時間帯にだけ緑になる正常系。
 *
 * ログイン → `.xyz` 検索 → 取得 → マイドメイン確認 のフルフロー。
 * kitaqnic 側の hello が失敗しているとき (メンテ時間帯) には失敗する。それが期待動作。
 *
 * 前提の env:
 *  - NEXT_PUBLIC_BACKEND_URL: backend baseURL (例: http://localhost:8787)
 *  - SECRET_KEY: /api/v1/secret/create-seed-user を叩く Bearer
 */

function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
}

test.describe(
  "ログイン→検索→.xyz 取得のフルフロー",
  { tag: "@registry-kitaqnic-normal" },
  () => {
    test.skip(
      !hasSeedEnv(),
      "SECRET_KEY が無いためスキップ。ローカルは backend の .env から export して再実行",
    );

    test("ログイン後、選んだ .xyz ドメインを取得してマイドメインに到達する", async ({
      page,
    }) => {
      const user = await createSeedUser({ label: "purchase-flow-kn" });

      // 1. ログインしてダッシュボードに着地
      await loginAndExpectDashboard(page, user);

      // 2. 検索。ランダム名で1件 .xyz を必ず空きにする
      const domainName = `e2e-${uniqueSuffix()}`;
      await page.goto(`/?q=${domainName}.xyz`);
      await expect(page.getByRole("region", { name: "検索結果" })).toBeVisible();

      // 3. .xyz を選ぶ (kitaqnic 管轄)
      const proceedButton = page.getByRole("button", {
        name: new RegExp(`このドメインで進む.*${domainName}\\.xyz`),
      });
      await expect(proceedButton).toBeVisible();
      await proceedButton.click();

      // 4. 内容確認 (/cart/complete)
      await expect(page).toHaveURL(/\/cart\/complete/);
      await expect(
        page.getByRole("region", { name: /確認したドメイン/ }),
      ).toBeVisible();
      await page.getByText("お支払い方法の選択に進む").click();

      // 5. 支払い方法
      await expect(page).toHaveURL(/\/cart\/payment/);
      await page.getByRole("button", { name: /この内容で確定する/ }).click();

      // 6. 取得完了ページ
      await expect(page).toHaveURL(/\/cart\/done/, { timeout: 15_000 });
      await expect(
        page.getByRole("heading", { name: "ドメインを取得しました" }),
      ).toBeVisible();
      await expect(
        page.getByRole("list", { name: "取得したドメイン" }).getByText(`${domainName}.xyz`),
      ).toBeVisible();

      // 7. マイドメインへ
      await page.getByText("マイドメインで管理する").click();
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole("heading", { name: "マイドメイン" })).toBeVisible();

      // 8. 取得したドメインが一覧に載っている
      await expect(page.getByText(`${domainName}.xyz`)).toBeVisible();
    });
  },
);
