import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import { setupInboundPending } from "../helpers/transfer";

/**
 * @registry-kitaqnic-normal — 移管 inbound reject (kitaqnic / .xyz)
 *
 * apps/backend/scripts/transfer/transfer-inbound-reject-e2e-kitaqnic.sh の TS 版。
 * 却下するとドメインは手元に残る。
 */
test.describe(
  "移管 inbound reject (.xyz)",
  { tag: "@registry-kitaqnic-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY / T2_* が無いためスキップ");

    test("却下するとドメインが手元に残る", async ({ page }) => {
      const user = await createSeedUser({ label: "tr-in-reject-xyz" });
      await loginAndExpectDashboard(page, user);

      const { fullDomain } = await setupInboundPending(page, "kitaqnic", "tr-in-r-xyz");

      const rejectButton = page.getByRole("button", { name: "却下して手元に残す" });
      await expect(rejectButton).toBeVisible({ timeout: 10_000 });
      await rejectButton.click();

      await page.goto("/dashboard");
      await expect(
        page.getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) }),
      ).toBeVisible({ timeout: 15_000 });
    });
  },
);
