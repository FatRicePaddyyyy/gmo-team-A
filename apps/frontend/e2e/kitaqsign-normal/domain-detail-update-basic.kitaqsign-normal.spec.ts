import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import {
  openDomainDetail,
  purchaseKitaqsignDomain,
} from "../helpers/domain-detail";

/**
 * @registry-kitaqsign-normal — kitaqsign 稼働時のドメイン詳細「アップデート」機能 (基本編)。
 *
 * 「使えます (ok)」状態のドメイン 1 つに対して、詳細画面の各タブで
 * 期待どおりに更新できることを確認する:
 *
 *  - 有効期限を延ばす: 期間選択 → 支払い確認 → 有効期限が +1 年
 *  - 自動更新: トグルの永続化 (ON→OFF、リロード後も維持)
 *  - ネームサーバー: 2 台以上入力して保存 → overview で反映
 *  - ネームサーバーのバリデーション: 台数不足・不正・重複はサーバーに届かない
 *  - AuthCode: 8 文字未満のエラー、正しい値での成功バナーと発行済み表示
 *
 * 前提の env:
 *  - NEXT_PUBLIC_BACKEND_URL / SECRET_KEY (seed-user と共通)
 *
 * ロック連動 (S6-S9) と廃止/復旧 (S10-S11) はそれぞれ別 spec に切り出す。
 */

test.describe(
  "ドメイン詳細画面のアップデート機能 (基本)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(
      !hasSeedEnv(),
      "SECRET_KEY が無いためスキップ。ローカルは backend の .env から export して再実行",
    );

    test("使える状態の .com で renew / autoRenew / nameServers / authInfo が期待どおりに動く", async ({
      page,
    }) => {
      const user = await createSeedUser({ label: "detail-basic" });
      await loginAndExpectDashboard(page, user);

      // 1 個買って詳細画面へ
      const { fullDomain } = await purchaseKitaqsignDomain(page, "detail-basic");
      await openDomainDetail(page, fullDomain);

      // ── 現在の有効期限を控える (renew の前後比較用) ──
      const expiresBeforeText = await page
        .getByRole("tabpanel", { name: "現在の状態" })
        .getByRole("term")
        .filter({ hasText: "有効期限" })
        .locator("xpath=following-sibling::dd[1]")
        .innerText();
      // "2027年8月28日" のような文字列。年だけを取り出す。
      const yearBefore = Number(expiresBeforeText.match(/(\d{4})年/)?.[1]);
      expect(yearBefore).toBeGreaterThanOrEqual(2026);

      // ── S1: renew ─────────────────────────────
      await page.getByRole("tab", { name: "有効期限を延ばす" }).click();
      // 1 年 (デフォルト) のまま「次へ」→「この内容で確定する」
      await page.getByRole("button", { name: "次へ" }).click();
      await page.getByRole("button", { name: "この内容で確定する" }).click();

      await expect(
        page.getByText("有効期限を 1 年延長しました"),
      ).toBeVisible({ timeout: 30_000 });

      // overview に戻り +1 年されているか
      await page.getByRole("tab", { name: "現在の状態" }).click();
      const expiresAfterText = await page
        .getByRole("tabpanel", { name: "現在の状態" })
        .getByRole("term")
        .filter({ hasText: "有効期限" })
        .locator("xpath=following-sibling::dd[1]")
        .innerText();
      const yearAfter = Number(expiresAfterText.match(/(\d{4})年/)?.[1]);
      expect(yearAfter).toBe(yearBefore + 1);

      // ── S2: 自動更新トグル ─────────────────────
      await page.getByRole("tab", { name: "有効期限を延ばす" }).click();
      const autoRenewSwitch = page.getByRole("switch", { name: "自動更新" });
      // 購入直後は autoRenew=false から始まる (backend の既定)。
      // まず ON にして永続化を確認する。
      await autoRenewSwitch.click();
      await expect(page.getByText("自動更新をオンにしました")).toBeVisible({
        timeout: 15_000,
      });

      // リロードして永続化を確認
      await page.reload();
      await page.getByRole("tab", { name: "有効期限を延ばす" }).click();
      await expect(
        page.getByRole("switch", { name: "自動更新" }),
      ).toBeChecked();

      // OFF に戻す
      await page.getByRole("switch", { name: "自動更新" }).click();
      await expect(page.getByText("自動更新をオフにしました")).toBeVisible({
        timeout: 15_000,
      });

      // ── S3: ネームサーバー保存 ─────────────────
      await page.getByRole("tab", { name: "ネームサーバー" }).click();
      // 1 台目・2 台目のテキストボックスに ns1.example.com / ns2.example.com を入れる。
      // 既存値があれば上書きするため fill(...) を使う。
      await page.getByLabel("1 台目").fill("ns1.example.com");
      await page.getByLabel("2 台目").fill("ns2.example.com");
      await page
        .getByRole("button", { name: "ネームサーバーを保存" })
        .click();
      await expect(
        page.getByText("ネームサーバーを変更しました"),
      ).toBeVisible({ timeout: 30_000 });

      // overview に反映されているか
      await page.getByRole("tab", { name: "現在の状態" }).click();
      const overviewNs = page
        .getByRole("tabpanel", { name: "現在の状態" })
        .getByRole("term")
        .filter({ hasText: "ネームサーバー" })
        .locator("xpath=following-sibling::dd[1]");
      await expect(overviewNs).toContainText("ns1.example.com");
      await expect(overviewNs).toContainText("ns2.example.com");

      // ── S4: ネームサーバー入力バリデーション ─────────────
      await page.getByRole("tab", { name: "ネームサーバー" }).click();

      // 1 台だけ → 「2 台以上を指定してください」
      await page.getByLabel("1 台目").fill("ns1.example.com");
      await page.getByLabel("2 台目").fill("");
      await page.getByRole("button", { name: "ネームサーバーを保存" }).click();
      await expect(
        page.getByText("ネームサーバーは 2 台以上を指定してください"),
      ).toBeVisible();

      // 不正な形式
      await page.getByLabel("1 台目").fill("not_a_hostname");
      await page.getByLabel("2 台目").fill("ns2.example.com");
      await page.getByRole("button", { name: "ネームサーバーを保存" }).click();
      await expect(
        page.getByText(/ホスト名の形式ではありません/),
      ).toBeVisible();

      // 重複
      await page.getByLabel("1 台目").fill("ns1.example.com");
      await page.getByLabel("2 台目").fill("ns1.example.com");
      await page.getByRole("button", { name: "ネームサーバーを保存" }).click();
      await expect(
        page.getByText("同じネームサーバーが重複しています"),
      ).toBeVisible();

      // ── S5: AuthCode 設定 ─────────────────────
      await page.getByRole("tab", { name: "他のレジストラへ渡す" }).click();

      // 7 文字 → 「8 文字以上」
      await page.getByPlaceholder("新しい認証コードを入力").fill("1234567");
      await page
        .getByRole("button", { name: "認証コードを設定する" })
        .click();
      await expect(
        page.getByText("認証コードは 8 文字以上にしてください"),
      ).toBeVisible();

      // 12 文字の有効値
      const authInfo = "e2eAuth12345";
      await page.getByPlaceholder("新しい認証コードを入力").fill(authInfo);
      await page
        .getByRole("button", { name: "認証コードを設定する" })
        .click();
      await expect(
        page.getByText("認証コード（AuthCode）を再発行しました"),
      ).toBeVisible({ timeout: 20_000 });
      // 発行後の再表示ブロックにも同じ値がある (「いま設定した認証コード」)
      await expect(
        page.getByText("いま設定した認証コード"),
      ).toBeVisible();
      await expect(page.getByText(authInfo).first()).toBeVisible();

      // 発行成功後はステップインジケータが ② に進んでいる
      await expect(
        page.getByText("移管先に伝える"),
      ).toBeVisible();
    });
  },
);
