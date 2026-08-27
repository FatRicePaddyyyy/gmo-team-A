import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";

/**
 * @registry-kitaqnic-outage — 移管 inbound cancel (.xyz) シナリオが開始できないこと。
 */
test.describe(
  "kitaqnic 障害時: inbound cancel シナリオが開始できない",
  { tag: "@registry-kitaqnic-outage" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY が無いためスキップ");

    test(".xyz が失敗枠に出て「このドメインで進む」ボタンが出ない", async ({ page }) => {
      const user = await createSeedUser({ label: "tr-in-c-outage" });
      await loginAndExpectDashboard(page, user);

      const name = `tr-nic-in-c-${Date.now()}${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0")}`;
      await page.goto(`/?q=${name}.xyz`);
      await expect(page.getByRole("region", { name: "検索結果", exact: true })).toBeVisible();

      await expect(page.getByText("空き状況を確認できませんでした")).toBeVisible();
      await expect(page.getByText(`${name}.xyz`).first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: new RegExp(`このドメインで進む.*${name}\\.xyz`) }),
      ).toHaveCount(0);
    });
  },
);
