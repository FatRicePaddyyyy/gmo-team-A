import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import { setupOutboundPending } from "../helpers/transfer";

/**
 * @registry-kitaqsign-normal — 移管 outbound cancel (kitaqsign / .com)
 *
 * apps/backend/scripts/transfer/transfer-outbound-cancel-e2e-kitaqsign.sh の TS 版。
 * teama が自分で /transfer 画面から取消 → マイドメインに載らず、
 * /transfer 一覧で「取り消しました」表示。
 */
test.describe(
  "移管 outbound cancel (.com)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY / T2_* が無いためスキップ");

    test("teama が自分で取消するとドメインは載らず、取消ステータスになる", async ({ page }) => {
      const user = await createSeedUser({ label: "tr-out-cancel" });
      await loginAndExpectDashboard(page, user);

      const { fullDomain } = await setupOutboundPending(page, "kitaqsign", "tr-out-c");

      // /transfer 一覧で対象カードの「申請を取り消す」→ 確認ダイアログで「取り消す」
      await page.goto("/transfer");
      await expect(page.getByText(fullDomain).first()).toBeVisible();
      await page.getByRole("button", { name: "申請を取り消す" }).click();
      // ConfirmAction ダイアログの「取り消す」
      await page.getByRole("button", { name: "取り消す" }).click();

      // 一覧で「取り消しました」badge
      await expect(page.getByText("取り消しました").first()).toBeVisible({ timeout: 10_000 });

      // マイドメインに載っていない
      await page.goto("/dashboard");
      await expect(
        page.getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) }),
      ).toHaveCount(0);
    });
  },
);
