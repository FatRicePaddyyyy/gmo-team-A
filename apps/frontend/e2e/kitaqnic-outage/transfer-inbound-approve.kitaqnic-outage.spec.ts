import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";

/**
 * @registry-kitaqnic-outage — 移管 inbound approve (kitaqnic / .xyz) を、
 * kitaqnic が落ちている時間帯に試すと、.xyz の空き確認が「確認できませんでした」枠に落ちて
 * 「このドメインで進む」ボタンが出ない → シナリオを開始できない。
 *
 * kitaqnic が動いている時間帯にはこのテストは失敗する (期待動作)。
 */
test.describe(
  "kitaqnic 障害時: inbound approve シナリオが開始できない",
  { tag: "@registry-kitaqnic-outage" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY が無いためスキップ");

    test(".xyz の「このドメインで進む」ボタンが出ず、失敗枠に載る", async ({ page }) => {
      const user = await createSeedUser({ label: "tr-in-a-outage" });
      await loginAndExpectDashboard(page, user);

      const name = `tr-nic-in-a-${Date.now()}${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0")}`;
      await page.goto(`/?q=${name}.xyz`);
      await expect(page.getByRole("region", { name: "検索結果", exact: true })).toBeVisible();

      // 「空き状況を確認できませんでした」枠に .xyz が出る
      await expect(page.getByText("空き状況を確認できませんでした")).toBeVisible();
      await expect(page.getByText(`${name}.xyz`).first()).toBeVisible();

      // 「このドメインで進む」ボタンは出ていない
      await expect(
        page.getByRole("button", { name: new RegExp(`このドメインで進む.*${name}\\.xyz`) }),
      ).toHaveCount(0);
    });
  },
);
