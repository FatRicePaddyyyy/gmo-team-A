import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { login, loginAndExpectDashboard } from "../helpers/login";

/**
 * @registry-kitaqsign-normal — clientTransferProhibited が付いたドメインへの移管申請
 *
 * Issue #107 の受け入れテスト。
 *
 * 期待挙動:
 *   owner が自分のドメインを検索・購入 → 詳細ページの「保護」タブで
 *   「他のレジストラへの移管を禁止する」トグルを ON → 別ユーザーが /transfer から
 *   同ドメインへの移管を申請 →
 *     - HTTP 409 相当 (フロントは「移管が禁止されています」の日本語アラートで見せる)
 *     - backend の transfers テーブルには pending 行が入らない (事前チェックで弾かれる)
 *
 * 修正前は「レジストリから予期しない応答がありました (…Object status prohibits operation)」と
 * いう「一時障害風」の 500 が返っていて、ユーザーが誤って何度も再試行してしまう問題があった。
 *
 * このテストは UI だけで全ステップを完結させる (API 直叩きなし)。
 */

test.describe(
  "移管禁止ドメインへの移管申請 (.com)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY が無いためスキップ");

    test("保護タブで移管禁止 ON → 別ユーザーの申請が 409 + 「移管が禁止」アラートになる", async ({
      page,
    }) => {
      // 1. owner ユーザーを作って login → 検索→購入で .com を取得
      const owner = await createSeedUser({ label: "tr-lock-owner" });
      await loginAndExpectDashboard(page, owner);

      const domainBase = `tr-lock-${Date.now()}${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0")}`;
      const fullDomain = `${domainBase}.com`;

      // 検索 → 「このドメインで進む」→ 内容確認 → 支払い → 完了
      await page.goto(`/?q=${fullDomain}`);
      await expect(page.getByRole("region", { name: "検索結果", exact: true })).toBeVisible();
      await page
        .getByRole("button", {
          name: new RegExp(`このドメインで進む.*${domainBase}\\.com`),
        })
        .click();
      await expect(page).toHaveURL(/\/cart\/complete/);
      await page.getByText("お支払い方法の選択に進む").click();
      await expect(page).toHaveURL(/\/cart\/payment/);
      await page.getByRole("button", { name: /この内容で確定する/ }).click();
      await expect(page).toHaveURL(/\/cart\/done/, { timeout: 15_000 });

      // 2. マイドメイン → 詳細ページ → 「保護」タブ → 「他のレジストラへの移管を禁止する」ON → 保存
      await page.goto("/dashboard");
      await page
        .getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) })
        .click();
      await page.getByRole("tab", { name: "保護" }).click();
      await page
        .getByRole("checkbox", { name: /他のレジストラへの移管を禁止する/ })
        .check();
      await page.getByRole("button", { name: "保護設定を保存する" }).click();

      // verify が「info の statuses に反映されている」を確認するので、
      // 成功メッセージが出れば実レジストリに clientTransferProhibited が入ったことが保証される。
      // レジストリ側が反映しない場合は「レジストリは変更を受け付けましたが、実際には反映されませんでした」の
      // エラーメッセージになるので、そのケースは skip 相当とする。
      const feedback = page.getByRole("alert").first();
      await expect(feedback).toBeVisible({ timeout: 10_000 });
      const feedbackText = (await feedback.textContent()) ?? "";
      test.skip(
        feedbackText.includes("実際には反映されませんでした"),
        "レジストリが clientTransferProhibited を反映していない (既知の未対応)",
      );
      expect(feedbackText).toContain("保護設定を更新しました");

      // 3. 別ユーザー (gaining) にログインし直す
      const gaining = await createSeedUser({ label: "tr-lock-gaining" });
      await page.context().clearCookies();
      await login(page, gaining);
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

      // 4. /transfer で移管申請
      await page.goto("/transfer");
      await page.locator("#transfer-name").fill(fullDomain);
      await page.locator("#transfer-auth-info").fill("dummy-authinfo");
      await page.getByRole("button", { name: "移管を申請する" }).click();

      // 5. 「移管が禁止」のアラートが出る (backend が 409 + transfer_prohibited を返している)
      await expect(page.getByRole("alert")).toContainText("移管が禁止");

      // 6. 「申請中の移管」欄は空のまま (事前チェックで pending 行が作られない)
      await expect(page.getByText("まだ移管を申請していません。")).toBeVisible();
    });
  },
);
