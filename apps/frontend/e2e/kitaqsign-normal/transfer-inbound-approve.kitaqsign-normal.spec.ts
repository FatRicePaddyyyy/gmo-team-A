import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import { setupInboundPending } from "../helpers/transfer";

/**
 * @registry-kitaqsign-normal — 移管 inbound approve (kitaqsign / .com)
 *
 * apps/backend/scripts/transfer/transfer-inbound-approve-e2e-kitaqsign.sh の TS 版。
 * 承認するとマイドメインから対象ドメインが消える。
 */
test.describe(
  "移管 inbound approve (.com)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY / T2_* が無いためスキップ");

    test("承認するとマイドメインからドメインが消える", async ({ page }) => {
      const user = await createSeedUser({ label: "tr-in-approve" });
      await loginAndExpectDashboard(page, user);

      const { fullDomain } = await setupInboundPending(page, "tr-in-a");

      const approveButton = page.getByRole("button", { name: "承認して引き渡す" });
      await expect(approveButton).toBeVisible({ timeout: 10_000 });
      await approveButton.click();

      await page.goto("/dashboard");
      await expect(
        page.getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) }),
      ).toHaveCount(0, { timeout: 15_000 });
    });
  },
);
