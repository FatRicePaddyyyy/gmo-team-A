import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import { setupOutboundPending } from "../helpers/transfer";

/**
 * @registry-kitaqsign-normal — 二重移管申請 (transfer_already_pending)
 *
 * Issue #107 追記の 状態別プロセス検証の一部。
 *
 * TransferService.request の分岐:
 *   `domain.status === "pendingTransfer"` の場合、既に処理中の申請があるので
 *   409 + `transfer_already_pending` で拒否する (backend service.ts B4)。
 *   DB の partial UNIQUE index (domainId WHERE status='pendingTransfer') により
 *   race で 2 件目が来ても insert 時に落ちるが、ここで早期に弾く。
 *
 * 期待挙動:
 *   1 回目 申請 → 202 で受理
 *   2 回目 同じドメインで申請 → HTTP 409 相当
 *   → フロントは「既に処理中の移管申請があります」の日本語アラート
 */
test.describe(
  "二重移管申請 (.com)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY / T2_* が無いためスキップ");

    test("既に pendingTransfer のドメインへの申請は 409 + 「既に処理中」アラート", async ({
      page,
    }) => {
      const user = await createSeedUser({ label: "tr-dup" });
      await loginAndExpectDashboard(page, user);

      // 1 回目: outbound で pending 状態を作る (teama-2 で作ったドメインを teama が引き取る)
      const { fullDomain, authInfo } = await setupOutboundPending(
        page,
        "kitaqsign",
        "tr-dup",
      );

      // 2 回目: 同じドメインで再申請
      await page.goto("/transfer");
      await page.locator("#transfer-name").fill(fullDomain);
      await page.locator("#transfer-auth-info").fill(authInfo);
      await page.getByRole("button", { name: "移管を申請する" }).click();

      // 409 + 「既に処理中の移管申請があります」
      await expect(page.getByRole("alert")).toContainText("既に処理中");
    });
  },
);
