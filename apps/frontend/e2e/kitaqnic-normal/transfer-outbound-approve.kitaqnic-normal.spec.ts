import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import { fireCron, setupOutboundPending, t2TransferOp } from "../helpers/transfer";

/**
 * @registry-kitaqnic-normal — 移管 outbound approve (kitaqnic / .xyz)
 *
 * apps/backend/scripts/transfer/transfer-outbound-approve-e2e-kitaqnic.sh の TS 版。
 * teama-2 が持つドメインを teama が引き取る → teama-2 が approve → teama backend cron で完了検知 →
 * マイドメインに載る + /transfer 一覧で「承認されました」badge。
 */
test.describe(
  "移管 outbound approve (.xyz)",
  { tag: "@registry-kitaqnic-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY / T2_* が無いためスキップ");

    test("teama-2 approve でドメインがマイドメインに載る", async ({ page }) => {
      const user = await createSeedUser({ label: "tr-out-approve-xyz" });
      await loginAndExpectDashboard(page, user);

      const { fullDomain } = await setupOutboundPending(page, "kitaqnic", "tr-out-a-xyz");

      await t2TransferOp("kitaqnic", fullDomain, "approve");
      await fireCron();

      await page.goto("/dashboard");
      await expect(
        page.getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) }),
      ).toBeVisible({ timeout: 15_000 });

      await page.goto("/transfer");
      await expect(page.getByText(fullDomain).first()).toBeVisible();
      await expect(page.getByText("承認されました").first()).toBeVisible();
    });
  },
);
