import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";

/**
 * @registry-kitaqnic-outage — 移管 outbound reject (.xyz) が始められないこと。
 */
test.describe(
  "kitaqnic 障害時: outbound reject シナリオが始められない",
  { tag: "@registry-kitaqnic-outage" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY が無いためスキップ");

    test(".xyz 申請で「申請中の移管」に載らない", async ({ page }) => {
      const user = await createSeedUser({ label: "tr-out-r-outage" });
      await loginAndExpectDashboard(page, user);

      const fullDomain = `tr-nic-out-r-${Date.now()}${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0")}.xyz`;

      await page.goto("/transfer");
      await page.locator("#transfer-name").fill(fullDomain);
      await page.locator("#transfer-auth-info").fill("any-authcode-01234567");
      await page.getByRole("button", { name: "移管を申請する" }).click();

      await page.waitForLoadState("networkidle");
      await expect(page.getByText(fullDomain)).toHaveCount(0);
    });
  },
);
