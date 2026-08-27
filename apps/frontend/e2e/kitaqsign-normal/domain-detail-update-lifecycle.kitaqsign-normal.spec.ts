import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import {
  openDomainDetail,
  purchaseKitaqsignDomain,
} from "../helpers/domain-detail";

/**
 * @registry-kitaqsign-normal — ドメイン詳細「アップデート」機能 (廃止/復旧編)。
 *
 * S10: 廃止 → 復旧 → 「使えます」に戻る、の一連の遷移を検証する。
 * S11: 廃止済み (redemptionPeriod) の状態では他タブの更新操作が全て止まる。
 *
 * pendingDelete (45日経過) は現実的に作れないので対象外。
 */

test.describe(
  "ドメイン詳細画面のアップデート機能 (廃止・復旧)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(
      !hasSeedEnv(),
      "SECRET_KEY が無いためスキップ。ローカルは backend の .env から export して再実行",
    );

    test("廃止 → 復旧の往復で状態と操作可否が期待どおりに切り替わる (S10, S11)", async ({
      page,
    }) => {
      const user = await createSeedUser({ label: "detail-lifecycle" });
      await loginAndExpectDashboard(page, user);
      const { fullDomain } = await purchaseKitaqsignDomain(
        page,
        "detail-lifecycle",
      );
      await openDomainDetail(page, fullDomain);

      // ── 廃止 ─────────────────────────────
      await page.getByRole("tab", { name: "廃止・復旧" }).click();
      await page.getByRole("button", { name: "廃止する" }).click();
      // 確認ダイアログの「廃止する」ボタン (ConfirmAction 内)
      await page
        .getByRole("button", { name: "廃止する" })
        .last()
        .click();
      await expect(
        page.getByText("このドメインを廃止しました"),
      ).toBeVisible({ timeout: 30_000 });

      // ── S11 検証: 廃止済みでは他タブの操作が止まる ──

      // overview: 「廃止済み（まだ戻せます）」
      await page.getByRole("tab", { name: "現在の状態" }).click();
      await expect(
        page.getByText("廃止済み（まだ戻せます）").first(),
      ).toBeVisible();

      // renew: カード非表示、statusHint が出る
      await page.getByRole("tab", { name: "有効期限を延ばす" }).click();
      await expect(page.getByRole("button", { name: "次へ" })).toHaveCount(0);
      await expect(
        page.getByText(/廃止しましたが、猶予期間のうちなら元に戻せます/),
      ).toBeVisible();

      // 自動更新はレジストリと無関係なので依然として操作できる
      await expect(
        page.getByRole("switch", { name: "自動更新" }),
      ).toBeEnabled();

      // ns: 入力欄も保存ボタンも disabled
      await page.getByRole("tab", { name: "ネームサーバー" }).click();
      await expect(page.getByLabel("1 台目")).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "ネームサーバーを保存" }),
      ).toBeDisabled();

      // transfer: AuthCode 入力欄が disabled
      await page.getByRole("tab", { name: "他のレジストラへ渡す" }).click();
      await expect(
        page.getByPlaceholder("新しい認証コードを入力"),
      ).toBeDisabled();

      // locks: 保護のチェックボックスも disabled (canUpdateLocks=false)
      await page.getByRole("tab", { name: "保護" }).click();
      await expect(
        page.getByRole("checkbox", {
          name: /^他のレジストラへの移管を禁止する/,
        }),
      ).toBeDisabled();

      // ── 復旧 ─────────────────────────────
      await page.getByRole("tab", { name: "廃止・復旧" }).click();
      await page.getByRole("button", { name: "復旧する" }).click();
      await expect(
        page.getByText("このドメインを復旧しました"),
      ).toBeVisible({ timeout: 30_000 });

      // overview で「使えます」に戻る
      await page.getByRole("tab", { name: "現在の状態" }).click();
      await expect(
        page
          .getByRole("tabpanel", { name: "現在の状態" })
          .getByText("使えます")
          .first(),
      ).toBeVisible();

      // 他タブが再び活性
      await page.getByRole("tab", { name: "有効期限を延ばす" }).click();
      await expect(page.getByRole("button", { name: "次へ" })).toBeVisible();

      await page.getByRole("tab", { name: "ネームサーバー" }).click();
      await expect(page.getByLabel("1 台目")).toBeEnabled();
    });
  },
);
