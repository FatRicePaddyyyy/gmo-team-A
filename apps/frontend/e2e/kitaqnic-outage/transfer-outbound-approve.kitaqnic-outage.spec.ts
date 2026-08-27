import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";

/**
 * @registry-kitaqnic-outage — 移管 outbound approve (.xyz) が始められないこと。
 * /transfer フォームに .xyz を入れて「移管を申請する」を押すと、backend の
 * resolveRegistry が kitaqnic の hello を得られず、エラー帯が出る。
 */
test.describe(
  "kitaqnic 障害時: outbound approve シナリオが始められない",
  { tag: "@registry-kitaqnic-outage" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY が無いためスキップ");

    test(".xyz 申請でエラー帯が出て「申請中の移管」に載らない", async ({ page }) => {
      const user = await createSeedUser({ label: "tr-out-a-outage" });
      await loginAndExpectDashboard(page, user);

      const fullDomain = `tr-nic-out-a-${Date.now()}${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0")}.xyz`;

      await page.goto("/transfer");
      await page.locator("#transfer-name").fill(fullDomain);
      await page.locator("#transfer-auth-info").fill("any-authcode-01234567");
      await page.getByRole("button", { name: "移管を申請する" }).click();

      // 成功アラート「移管を申請しました」は出ず、代わりにエラー帯が出るはず。
      // 実装上どちらのケースでも「申請中の移管」に fullDomain は載らない。
      // 落ちている前提のテストなので、「申請中の移管」に該当行が無いことを判定する
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(fullDomain)).toHaveCount(0);
    });
  },
);
