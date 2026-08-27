import { test, expect, request } from "@playwright/test";
import { createSeedUser, hasSeedEnv } from "../helpers/seed-user";
import { loginAndExpectDashboard } from "../helpers/login";

/**
 * @registry-kitaqsign-normal — 自分のドメインへの移管申請 (self_transfer)
 *
 * Issue #107 追記の 状態別プロセス検証の一部。
 *
 * 二重防御:
 *   - フロント: 検索/一覧に既に自分のドメインとして載っているものは、UI で先に
 *     「このドメインはすでにここにあるので、引き取る必要はありません」と止める。
 *   - backend: それでも POST /secure/transfers が届いた場合は
 *     `domain.ownerUserId === gainingUserId` チェックで 403 + `self_transfer`
 *     に落とす (backend service.ts B1)。
 *
 * このテストはフロントの一次防御が働くことを確認する。UI 経由で叩けば必ず
 * フロントのメッセージが先に出るので、それを保証する。
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8787";

test.describe(
  "自分のドメインへの移管申請 (.com)",
  { tag: "@registry-kitaqsign-normal" },
  () => {
    test.skip(!hasSeedEnv(), "SECRET_KEY が無いためスキップ");

    test("自分が持つドメインへの移管申請はフロントで「すでにここにある」アラート", async ({
      page,
    }) => {
      const owner = await createSeedUser({ label: "tr-self" });
      await loginAndExpectDashboard(page, owner);

      // owner が自分でドメインを取る
      const fullDomain = `tr-self-${Date.now()}${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0")}.com`;

      const cookies = await page.context().cookies();
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      const api = await request.newContext({
        extraHTTPHeaders: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
      });
      const createRes = await api.post(`${BACKEND_URL}/api/v1/secure/domains`, {
        data: { name: fullDomain, period: { unit: "Y", value: 1 } },
      });
      expect(createRes.ok(), "ドメイン取得成功").toBe(true);
      await api.dispose();

      // 同じユーザーのままフロントの /transfer で申請
      await page.goto("/transfer");
      await page.getByRole("textbox", { name: "移管したいドメイン名" }).fill(fullDomain);
      // authInfo は self_transfer 判定より後の bridge チェックなので何でもよい (弾かれない)
      await page.getByRole("textbox", { name: "認証コード（AuthCode）" }).fill("dummy-authinfo");
      await page.getByRole("button", { name: "移管を申請する" }).click();

      // フロントの一次防御: 「このドメインはすでにここにあるので、引き取る必要はありません。」
      await expect(page.getByRole("alert")).toContainText(
        "このドメインはすでにここにあるので",
      );
      await expect(page.getByText("まだ移管を申請していません。")).toBeVisible();
    });
  },
);
