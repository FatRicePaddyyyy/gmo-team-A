import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "./helpers/seed-user";
import { loginAndExpectDashboard } from "./helpers/login";

/**
 * ログイン → 検索 → ドメイン取得 までを一本道で通す E2E テスト。
 *
 * CI の `playwright` ジョブでは backend の wrangler dev + D1 マイグレーションが
 * 既に走っているので、そのまま実サーバー相手にテストする。ローカルで走らせるときは
 * `pnpm dev`（frontend / backend の両方）が起動している前提。
 *
 * 前提の env:
 *  - NEXT_PUBLIC_BACKEND_URL: バックエンドの baseURL（例: http://localhost:8787）
 *  - SECRET_KEY: /api/v1/secret/create-seed-user を叩くための Bearer トークン
 *
 * ユーザー作成・ログインは helpers/ に切り出してあるので、他の E2E からも
 * 同じ手順で使える。テストの独立性を優先しユーザーの後片付けはしない。
 */

// ミリ秒 + 乱数。並列・連続実行での検索名の衝突を避ける
function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
}

test.describe("ログイン→検索→ドメイン取得のフルフロー", () => {
  // シード API が使える環境（SECRET_KEY 設定済み）でのみ走らせる。
  // ローカルで env を渡し忘れたときは、スイート全体を skip にして落ちない
  test.skip(
    !hasSeedEnv(),
    "SECRET_KEY が無いためスキップ。ローカルは backend の .env から export して再実行",
  );

  test("ログイン後、選んだドメインを取得してマイドメインに到達する", async ({ page }) => {
    const user = await createSeedUser({ label: "purchase-flow" });

    // 1. ログインしてダッシュボードに着地
    await loginAndExpectDashboard(page, user);

    // 2. 検索。他のテストと重複しにくいユニークな名前で1件だけヒットさせる
    const domainName = `e2e-${uniqueSuffix()}`;
    await page.goto(`/?q=${domainName}`);
    await expect(page.getByRole("region", { name: "検索結果" })).toBeVisible();

    // 3. .com を選ぶ（.com は取得可能な想定。ランダム文字列なのでほぼ空き）
    const proceedButton = page.getByRole("button", {
      name: new RegExp(`このドメインで進む.*${domainName}\\.com`),
    });
    await expect(proceedButton).toBeVisible();
    await proceedButton.click();

    // 4. 内容確認 (/cart/complete)。ログイン済みなので「お支払い方法の選択に進む」が出る
    await expect(page).toHaveURL(/\/cart\/complete/);
    await expect(
      page.getByRole("region", { name: /確認したドメイン/ }),
    ).toBeVisible();
    // shadcn の Button は Link に render されているが、ロールが link/button の
    // どちらで露出するかは実装依存。ロールに依存せず名前で拾う
    await page.getByText("お支払い方法の選択に進む").click();

    // 5. 支払い方法。デモなのでデフォルト（クレジットカード）のまま確定する
    await expect(page).toHaveURL(/\/cart\/payment/);
    await page.getByRole("button", { name: /この内容で確定する/ }).click();

    // 6. 取得完了ページ（/cart/done）に遷移し、達成の演出が出る。
    //    dashboard 直行だった旧フローの反対。ここに寄って初めて「取れた」実感を出す
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
});
