import { test, expect, request } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { login, loginAndExpectDashboard } from "../helpers/login";

/**
 * @registry-kitaqsign-normal — clientTransferProhibited が付いたドメインへの移管申請
 *
 * Issue #107 の受け入れテスト。
 *
 * 期待挙動:
 *   owner が自分のドメインに clientTransferProhibited を付けた状態で、別ユーザーが
 *   /transfer から同ドメインへの移管を申請する →
 *     - HTTP 409 相当 (フロントは「移管が禁止されています」の日本語アラートで見せる)
 *     - backend の transfers テーブルには pending 行が入らない (事前チェックで弾かれる)
 *
 * 修正前は「レジストリから予期しない応答がありました (…Object status prohibits operation)」と
 * いう「一時障害風」の 500 が返っていて、ユーザーが誤って何度も再試行してしまう問題があった。
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8787";

test.describe(
  "移管禁止ドメインへの移管申請 (.com)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY が無いためスキップ");

    test("clientTransferProhibited 付きドメインへの申請は 409 + 「移管が禁止」の日本語アラートになる", async ({
      page,
    }) => {
      // 1. owner ユーザーを作って login → ドメイン取得
      const owner = await createSeedUser({ label: "tr-lock-owner" });
      await loginAndExpectDashboard(page, owner);

      const domainName = `tr-lock-${Date.now()}${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0")}`;
      const fullDomain = `${domainName}.com`;

      const cookies = await page.context().cookies();
      const cookieHeader = cookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");

      const api = await request.newContext({
        extraHTTPHeaders: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
      });

      // 2. 実 backend にドメイン登録 (実 kitaqsign へ届く)
      const createRes = await api.post(`${BACKEND_URL}/api/v1/secure/domains`, {
        data: { name: fullDomain, period: { unit: "Y", value: 1 } },
      });
      const createBody = (await createRes.json()) as {
        success: boolean;
        data?: { id: string };
      };
      expect(createRes.ok(), "ドメイン取得成功").toBe(true);
      const domainId = createBody.data!.id;

      // 3. clientTransferProhibited を PUT で付与
      const lockRes = await api.put(
        `${BACKEND_URL}/api/v1/secure/domains/${domainId}`,
        { data: { addStatuses: ["clientTransferProhibited"] } },
      );
      expect(lockRes.ok(), "clientTransferProhibited の付与").toBe(true);

      // 4. info で反映確認 (レジストリが受理していなければテストの前提が崩れるので skip 相当)
      const infoRes = await api.get(
        `${BACKEND_URL}/api/v1/secure/domains/${domainId}`,
      );
      const infoBody = (await infoRes.json()) as {
        success: boolean;
        data?: { statuses: string[] };
      };
      await api.dispose();
      test.skip(
        !infoBody.data?.statuses.includes("clientTransferProhibited"),
        "レジストリが clientTransferProhibited を反映していない (レジストリ側の未対応)",
      );

      // 5. 別ユーザー (gaining) にログインし直す
      const gaining = await createSeedUser({ label: "tr-lock-gaining" });
      // 現ユーザーの cookie を明示的に消す (login helper は /login への遷移だけで自動 sign-out しない)
      await page.context().clearCookies();
      await login(page, gaining);
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

      // 6. /transfer で移管申請
      await page.goto("/transfer");
      await page
        .getByRole("textbox", { name: "移管したいドメイン名" })
        .fill(fullDomain);
      await page
        .getByRole("textbox", { name: "認証コード（AuthCode）" })
        .fill("dummy-authinfo");
      await page.getByRole("button", { name: "移管を申請する" }).click();

      // 7. 「移管が禁止」のアラートが出る (backend が 409 + transfer_prohibited を返している)
      await expect(page.getByRole("alert")).toContainText("移管が禁止");

      // 8. 「申請中の移管」欄は空のまま (事前チェックで pending 行が作られない)
      await expect(page.getByText("まだ移管を申請していません。")).toBeVisible();
    });
  },
);
