import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import { clickRefresh, setupOutboundPending, t2TransferOp } from "../helpers/transfer";

/**
 * @registry-kitaqnic-normal — 移管 outbound reject (kitaqnic / .xyz)
 *
 * apps/backend/scripts/transfer/transfer-outbound-reject-e2e-kitaqnic.sh の TS 版。
 * teama-2 が reject → teama backend cron で反映 → マイドメインに載らず、
 * /transfer 一覧で「却下されました」表示。
 */
test.describe(
  "移管 outbound reject (.xyz)",
  { tag: "@registry-kitaqnic-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY / T2_* が無いためスキップ");

    test("teama-2 reject でドメインは載らず、却下ステータスになる", async ({ page }) => {
      const user = await createSeedUser({ label: "tr-out-reject-xyz" });
      await loginAndExpectDashboard(page, user);

      const { fullDomain } = await setupOutboundPending(page, "kitaqnic", "tr-out-r-xyz");

      await t2TransferOp("kitaqnic", fullDomain, "reject");
      // /transfer 上の「最新にする」で poll-now を叩いて反映を待つ
      await clickRefresh(page);

      await page.goto("/dashboard");
      await expect(
        page.getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) }),
      ).toHaveCount(0);

      await page.goto("/transfer");
      await expect(page.getByText(fullDomain).first()).toBeVisible();
      await expect(page.getByText("却下されました").first()).toBeVisible();
    });
  },
);
