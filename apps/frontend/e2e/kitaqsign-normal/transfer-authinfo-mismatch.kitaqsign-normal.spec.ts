import { test, expect } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";
import { t2CreateContact, t2CreateDomain, uniqueDomainName, randomHex } from "../helpers/transfer";

/**
 * @registry-kitaqsign-normal — authInfo 不一致での移管申請
 *
 * Issue #107 追記の状態別プロセス検証。
 *
 * TransferService.request のフロー:
 *   backend DB に無いドメイン (別レジストラのドメイン) は outbound 経路に入る。
 *   OutboundTransferRequestRepository.create で pending を INSERT した後、
 *   RegistryBridge.transferRequest を実 EPP に送る。レジストリが authInfo 不一致を
 *   検出すると:
 *     - Kitaqnic: HTTP 401
 *     - Kitaqsign: HTTP 403 + result.code 2202、または HTTP 202/200 + code 2202
 *   backend は共通して `authInfo_mismatch` に写像し、handler は 409 で返す。
 *
 * 期待挙動:
 *   実 kitaqsign にドメインは存在するが authInfo が間違っている状態で申請 →
 *   HTTP 409 相当 → フロントは「認証コード（AuthCode）が正しくありません」の日本語アラート
 */
test.describe(
  "authInfo 不一致での移管申請 (.com)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY / T2_* が無いためスキップ");

    test("正しいドメインで間違った authInfo → 409 + 「認証コード」アラート", async ({
      page,
    }) => {
      const gaining = await createSeedUser({ label: "tr-ai-mismatch" });
      await loginAndExpectDashboard(page, gaining);

      // teama-2 (別 registrar) 側で実 kitaqsign にドメインを作成
      const contactId = await t2CreateContact("kitaqsign");
      const realAuthInfo = randomHex(12);
      const fullDomain = uniqueDomainName("tr-ai", "kitaqsign");
      await t2CreateDomain("kitaqsign", {
        domain: fullDomain,
        contactId,
        authInfo: realAuthInfo,
      });

      // teama backend で /transfer からわざと間違った authInfo で申請
      await page.goto("/transfer");
      await page.locator("#transfer-name").fill(fullDomain);
      await page.locator("#transfer-auth-info").fill(`wrong-${randomHex(6)}`);
      await page.getByRole("button", { name: "移管を申請する" }).click();

      // 「認証コード（AuthCode）が正しくありません」(authInfo_mismatch の日本語)
      await expect(page.getByRole("alert")).toContainText("認証コード");
      await expect(page.getByRole("alert")).toContainText("正しくありません");
    });
  },
);
