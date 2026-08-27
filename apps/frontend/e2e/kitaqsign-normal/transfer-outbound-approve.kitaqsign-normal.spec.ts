import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import { fireCron, setupOutboundPending, t2TransferOp } from "../helpers/transfer";

/**
 * @registry-kitaqsign-normal — 移管 outbound approve (kitaqsign / .com)
 *
 * apps/backend/scripts/transfer/transfer-outbound-approve-e2e-kitaqsign.sh の TS 版。
 * teama-2 が持つドメインを teama が引き取る → teama-2 が approve → teama backend cron で完了検知 →
 * マイドメインに載る + /transfer 一覧で「承認されました」badge。
 */
test.describe(
  "移管 outbound approve (.com)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY / T2_* が無いためスキップ");

    test("teama-2 approve でドメインがマイドメインに載る", async ({ page }) => {
      const user = await createSeedUser({ label: "tr-out-approve" });
      await loginAndExpectDashboard(page, user);

      const { fullDomain } = await setupOutboundPending(page, "kitaqsign", "tr-out-a");

      // teama-2 が approve
      await t2TransferOp("kitaqsign", fullDomain, "approve");
      await fireCron();

      // teama マイドメインに新規ドメインが載っている
      await page.goto("/dashboard");
      await expect(
        page.getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) }),
      ).toBeVisible({ timeout: 15_000 });

      // /transfer 一覧で対応行が「承認されました」badge に
      await page.goto("/transfer");
      await expect(page.getByText(fullDomain).first()).toBeVisible();
      await expect(page.getByText("承認されました").first()).toBeVisible();
    });
  },
);
