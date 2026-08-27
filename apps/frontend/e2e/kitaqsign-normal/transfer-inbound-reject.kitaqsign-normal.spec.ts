import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import { setupInboundPending } from "../helpers/transfer";

/**
 * @registry-kitaqsign-normal — 移管 inbound reject (kitaqsign / .com)
 *
 * apps/backend/scripts/transfer/transfer-inbound-reject-e2e-kitaqsign.sh の TS 版。
 * 却下するとドメインは手元に残る。
 */
test.describe(
  "移管 inbound reject (.com)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY / T2_* が無いためスキップ");

    test("却下するとドメインが手元に残る", async ({ page }) => {
      const user = await createSeedUser({ label: "tr-in-reject" });
      await loginAndExpectDashboard(page, user);

      const { fullDomain } = await setupInboundPending(page, "kitaqsign", "tr-in-r");

      const rejectButton = page.getByRole("button", { name: "却下して手元に残す" });
      await expect(rejectButton).toBeVisible({ timeout: 20_000 });
      await rejectButton.click();

      // 却下成功後、ダッシュボードにドメインが残っている
      await page.goto("/dashboard");
      await expect(
        page.getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) }),
      ).toBeVisible({ timeout: 15_000 });
    });
  },
);
