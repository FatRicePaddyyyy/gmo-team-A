import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import { clickRefresh, setupInboundPending, t2TransferOp } from "../helpers/transfer";

/**
 * @registry-kitaqsign-normal — 移管 inbound cancel (kitaqsign / .com)
 *
 * apps/backend/scripts/transfer/transfer-inbound-cancel-e2e-kitaqsign.sh の TS 版。
 * teama-2 側が申請を取り消したあと、teama にはドメインが残ったまま。
 * incoming transfer カードは消える。
 */
test.describe(
  "移管 inbound cancel (.com)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY / T2_* が無いためスキップ");

    test("teama-2 が取消するとカードが消え、ドメインは手元に残る", async ({ page }) => {
      const user = await createSeedUser({ label: "tr-in-cancel" });
      await loginAndExpectDashboard(page, user);

      const { fullDomain } = await setupInboundPending(page, "kitaqsign", "tr-in-c");

      // incoming transfer カードが出ていることを確認
      await expect(
        page.getByRole("heading", { name: "他のレジストラへの引き渡しを求められています" }),
      ).toBeVisible({ timeout: 20_000 });

      // teama-2 側で cancel
      await t2TransferOp("kitaqsign", fullDomain, "cancel");
      // 詳細ページの「最新にする」で poll-now を叩いて反映を待つ
      await clickRefresh(page);

      // ドメインは手元に残っている
      await page.goto("/dashboard");
      await expect(
        page.getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) }),
      ).toBeVisible({ timeout: 15_000 });

      // 詳細画面に戻ると incoming transfer カードは消えている
      await page
        .getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) })
        .click();
      await page.getByRole("tab", { name: "他のレジストラへ渡す" }).click();
      await expect(
        page.getByRole("heading", { name: "他のレジストラへの引き渡しを求められています" }),
      ).toHaveCount(0);
    });
  },
);
