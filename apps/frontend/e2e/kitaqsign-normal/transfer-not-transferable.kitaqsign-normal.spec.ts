import { test, expect, request } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";

/**
 * @registry-kitaqsign-normal — 移管不可な状態のドメインへの移管申請
 *
 * Issue #107 追記の状態別プロセス検証 (残り)。
 *
 * TransferService.request の分岐:
 *   `domain.status !== "ok"` かつ `pendingTransfer` 以外の場合、
 *   409 + `domain_not_transferable` で拒否する (backend service.ts B7)。
 *
 * 具体的に検証する状態:
 *   (a) redemptionPeriod  ← delete 後の猶予期間中
 *   (b) inactive          ← NS 未設定 (create 時に nameservers 省略)
 *
 * 期待挙動: 両ケースとも
 *   - HTTP 409 相当
 *   - フロントは「現在の状態では移管できません」の日本語アラート
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8787";

async function apiWithCookies(page: import("@playwright/test").Page) {
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return await request.newContext({
    extraHTTPHeaders: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
    },
  });
}

async function tryTransferAndExpectNotTransferable(
  page: import("@playwright/test").Page,
  fullDomain: string,
): Promise<void> {
  // gaining ユーザーに切り替えないと self_transfer で先に弾かれる。
  // フロント経由の /transfer は「マイドメインに載っているものは弾く」一次防御があるので、
  // ここでは別ユーザーに sign-in し直す。
  const gaining = await createSeedUser({ label: "tr-nt-gaining" });
  await page.context().clearCookies();
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("メールアドレス").fill(gaining.email);
  await page.getByLabel("パスワード", { exact: true }).fill(gaining.password);
  await page.getByRole("button", { name: "ログインする" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  await page.goto("/transfer");
  await page.getByRole("textbox", { name: "移管したいドメイン名" }).fill(fullDomain);
  await page.getByRole("textbox", { name: "認証コード（AuthCode）" }).fill("dummy");
  await page.getByRole("button", { name: "移管を申請する" }).click();

  // 「現在の状態では移管できません」(domain_not_transferable の日本語)
  await expect(page.getByRole("alert")).toContainText("現在の状態では移管できません");
  await expect(page.getByText("まだ移管を申請していません。")).toBeVisible();
}

test.describe(
  "移管不可な状態への申請 (.com)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY が無いためスキップ");

    test("(a) redemptionPeriod のドメインへの申請は 409 + 「現在の状態では移管できません」", async ({
      page,
    }) => {
      const owner = await createSeedUser({ label: "tr-nt-redemption" });
      await loginAndExpectDashboard(page, owner);

      const fullDomain = `tr-nt-red-${Date.now()}${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0")}.com`;

      const api = await apiWithCookies(page);
      const createRes = await api.post(`${BACKEND_URL}/api/v1/secure/domains`, {
        data: { name: fullDomain, period: { unit: "Y", value: 1 } },
      });
      expect(createRes.ok(), "ドメイン取得成功").toBe(true);
      const domainId = (await createRes.json() as { data: { id: string } }).data.id;

      // delete → redemptionPeriod に遷移
      const delRes = await api.delete(
        `${BACKEND_URL}/api/v1/secure/domains/${domainId}`,
      );
      expect(delRes.ok(), "delete 成功").toBe(true);

      // info で redemptionPeriod を確認 (レジストリが反映していないと前提が崩れるので skip 相当)
      const infoRes = await api.get(
        `${BACKEND_URL}/api/v1/secure/domains/${domainId}`,
      );
      const info = (await infoRes.json()) as {
        data?: { status: string };
      };
      await api.dispose();
      test.skip(
        info.data?.status !== "redemptionPeriod",
        `レジストリ状態が redemptionPeriod ではない (got ${info.data?.status ?? "?"})`,
      );

      await tryTransferAndExpectNotTransferable(page, fullDomain);
    });

    test("(b) inactive (NS 未設定) のドメインへの申請は 409 + 「現在の状態では移管できません」", async ({
      page,
    }) => {
      const owner = await createSeedUser({ label: "tr-nt-inactive" });
      await loginAndExpectDashboard(page, owner);

      const fullDomain = `tr-nt-ina-${Date.now()}${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0")}.com`;

      // NS 未指定で作成 → kitaqsign は inactive を返す (実測: mock/mock-registry.mjs のコメントにも同記載)
      const api = await apiWithCookies(page);
      const createRes = await api.post(`${BACKEND_URL}/api/v1/secure/domains`, {
        data: { name: fullDomain, period: { unit: "Y", value: 1 } },
      });
      expect(createRes.ok(), "ドメイン取得成功").toBe(true);
      const domainId = (await createRes.json() as { data: { id: string } }).data.id;

      // info で inactive を確認 (create 時に NS 未指定でも実 kitaqsign が ok を返す場合は skip 相当)
      const infoRes = await api.get(
        `${BACKEND_URL}/api/v1/secure/domains/${domainId}`,
      );
      const info = (await infoRes.json()) as {
        data?: { status: string };
      };
      await api.dispose();
      test.skip(
        info.data?.status !== "inactive",
        `レジストリ状態が inactive ではない (got ${info.data?.status ?? "?"})`,
      );

      await tryTransferAndExpectNotTransferable(page, fullDomain);
    });
  },
);
