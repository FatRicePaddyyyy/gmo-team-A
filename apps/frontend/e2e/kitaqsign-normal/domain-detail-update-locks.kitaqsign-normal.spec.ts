import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import {
  openDomainDetail,
  purchaseKitaqsignDomain,
  setLocks,
} from "../helpers/domain-detail";

/**
 * @registry-kitaqsign-normal — ドメイン詳細「アップデート」機能 (保護ロック連動編)。
 *
 * 「保護」タブで各 clientXxxProhibited をトグルしたとき、詳細画面の他タブの
 * ボタン活性/理由文言が期待どおりに変わることを確認する:
 *
 *  - S6: ロック 5 種の追加/解除がレジストリに保存され、overview に反映される
 *  - S7: clientRenewProhibited を立てると renew カードが消え、解除案内が出る
 *  - S8: clientDeleteProhibited を立てると廃止ボタンが消え、解除案内が出る
 *  - S9: clientUpdateProhibited を立てると ns/authInfo は不可、locks 自身は可 (自己解除)
 *
 * kitaqsign 側の反映は Issue #107 の修正後 (2026-08-27) から動く。ここが赤くなったら
 * レジストリ回帰を疑う。
 *
 * ロックを 1 種類ずつ切り替えるたびに詳細画面をリロードして
 * サーバー側の永続化を経由した状態を確認する (テスト内で状態を積み上げない)。
 */

test.describe(
  "ドメイン詳細画面のアップデート機能 (保護ロック連動)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(
      !hasSeedEnv(),
      "SECRET_KEY が無いためスキップ。ローカルは backend の .env から export して再実行",
    );

    test("clientTransferProhibited をトグル ON/OFF できる (S6)", async ({
      page,
    }) => {
      const user = await createSeedUser({ label: "detail-locks-transfer" });
      await loginAndExpectDashboard(page, user);
      const { fullDomain } = await purchaseKitaqsignDomain(
        page,
        "detail-locks-transfer",
      );
      await openDomainDetail(page, fullDomain);

      // 取得直後の clientTransferProhibited の既定値はレジストリによって異なる
      // (kitaqnic は ON、kitaqsign は OFF)。ここは初期値を assume せず、
      // 「OFF に揃える → 別ロックを立てる → 元に戻す」の往復で検証する。
      await setLocks(page, {
        clientTransferProhibited: false,
        clientDeleteProhibited: true,
      });

      // overview の「レジストリ上の状態」で反映を確認
      await page.getByRole("tab", { name: "現在の状態" }).click();
      const statusesRow = page
        .getByRole("tabpanel", { name: "現在の状態" })
        .getByRole("term")
        .filter({ hasText: "レジストリ上の状態" })
        .locator("xpath=following-sibling::dd[1]");
      await expect(statusesRow).toContainText("clientDeleteProhibited");
      await expect(statusesRow).not.toContainText("clientTransferProhibited");

      // 逆方向: TransferProhibited を ON に、DeleteProhibited を OFF に
      await setLocks(page, {
        clientTransferProhibited: true,
        clientDeleteProhibited: false,
      });
      await page.getByRole("tab", { name: "現在の状態" }).click();
      await expect(statusesRow).toContainText("clientTransferProhibited");
      await expect(statusesRow).not.toContainText("clientDeleteProhibited");
    });

    test("clientRenewProhibited を立てると renew タブが操作不可になる (S7)", async ({
      page,
    }) => {
      const user = await createSeedUser({ label: "detail-locks-renew" });
      await loginAndExpectDashboard(page, user);
      const { fullDomain } = await purchaseKitaqsignDomain(
        page,
        "detail-locks-renew",
      );
      await openDomainDetail(page, fullDomain);

      // ロック前: renew カードが出て「次へ」ボタンがある
      await page.getByRole("tab", { name: "有効期限を延ばす" }).click();
      await expect(page.getByRole("button", { name: "次へ" })).toBeVisible();

      // clientRenewProhibited を ON
      await setLocks(page, { clientRenewProhibited: true });

      // ロック後: renew カードが消え、解除案内が出る
      await page.getByRole("tab", { name: "有効期限を延ばす" }).click();
      await expect(page.getByRole("button", { name: "次へ" })).toHaveCount(0);
      await expect(
        page.getByText(/「保護」タブで更新を禁止する設定/),
      ).toBeVisible();

      // 解除して元に戻せる
      await setLocks(page, { clientRenewProhibited: false });
      await page.getByRole("tab", { name: "有効期限を延ばす" }).click();
      await expect(page.getByRole("button", { name: "次へ" })).toBeVisible();
    });

    test("clientDeleteProhibited を立てると廃止ボタンが消え、解除案内が出る (S8)", async ({
      page,
    }) => {
      const user = await createSeedUser({ label: "detail-locks-delete" });
      await loginAndExpectDashboard(page, user);
      const { fullDomain } = await purchaseKitaqsignDomain(
        page,
        "detail-locks-delete",
      );
      await openDomainDetail(page, fullDomain);

      // ロック前
      await page.getByRole("tab", { name: "廃止・復旧" }).click();
      await expect(
        page.getByRole("button", { name: "廃止する" }),
      ).toBeVisible();

      // ロック
      await setLocks(page, { clientDeleteProhibited: true });

      // ロック後: 廃止ボタンが消え、案内文
      await page.getByRole("tab", { name: "廃止・復旧" }).click();
      await expect(
        page.getByRole("button", { name: "廃止する" }),
      ).toHaveCount(0);
      await expect(
        page.getByText(/「保護」タブで廃止を禁止する設定/),
      ).toBeVisible();
    });

    test("clientUpdateProhibited は NS/AuthCode を止めるが Locks は自己解除できる (S9)", async ({
      page,
    }) => {
      const user = await createSeedUser({ label: "detail-locks-update" });
      await loginAndExpectDashboard(page, user);
      const { fullDomain } = await purchaseKitaqsignDomain(
        page,
        "detail-locks-update",
      );
      await openDomainDetail(page, fullDomain);

      // ロック
      await setLocks(page, { clientUpdateProhibited: true });

      // NS フォームは disabled
      await page.getByRole("tab", { name: "ネームサーバー" }).click();
      await expect(page.getByLabel("1 台目")).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "ネームサーバーを保存" }),
      ).toBeDisabled();
      await expect(
        page.getByText(/「保護」タブで設定変更を禁止する設定/),
      ).toBeVisible();

      // AuthCode 入力も disabled
      await page.getByRole("tab", { name: "他のレジストラへ渡す" }).click();
      await expect(
        page.getByPlaceholder("新しい認証コードを入力"),
      ).toBeDisabled();

      // 「保護」タブ自体は依然として編集できる (自己解除)
      await page.getByRole("tab", { name: "保護" }).click();
      await expect(
        page.getByRole("checkbox", { name: /^設定変更を禁止する/ }),
      ).toBeEnabled();
      await setLocks(page, { clientUpdateProhibited: false });

      // 解除後は NS 入力欄が再び活性になる。保存ボタンは isUnchanged で
      // disabled のままなので、そちらは触らない (S3 が別 spec でカバー済み)。
      await page.getByRole("tab", { name: "ネームサーバー" }).click();
      await expect(page.getByLabel("1 台目")).toBeEnabled();

      // AuthCode 入力も再び活性
      await page.getByRole("tab", { name: "他のレジストラへ渡す" }).click();
      await expect(
        page.getByPlaceholder("新しい認証コードを入力"),
      ).toBeEnabled();
    });
  },
);
