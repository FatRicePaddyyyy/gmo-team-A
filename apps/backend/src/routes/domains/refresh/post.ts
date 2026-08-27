import { createRoute, z } from "@hono/zod-openapi";
import { createDBClient } from "../../../lib/db";
import { toUserMessage } from "../../../lib/error-messages";
import { createOpenAPIHono } from "../../../lib/openapi-hono";
import { DomainService } from "../service";

// マイドメイン一覧の「最新にする」ボタンから明示的に叩かれる副作用ありエンドポイント。
// GET /domains を idempotent に保つため、レジストリと突き合わせて掃除する処理は
// ここに切り出している。
//
// - 自分が owner のドメイン全件について RegistryBridge.info を並列に打つ
// - 2303 (domain_not_found) が返ったものは DB から物理削除
// - 通信断・メンテ (registry_unreachable 系) は残す
// - pendingTransfer は transfer-cron-poll に委ね、対象外
//
// レスポンスには削除できたドメイン名の配列だけ返す。呼び出し側は続けて GET /domains
// で最新一覧を取り直すことを想定している。

const SuccessSchema = z.object({
  success: z.literal(true),
  data: z.object({
    deleted: z.array(z.string()),
  }),
  error: z.null(),
}).openapi("DomainRefreshSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("DomainRefreshError");

const route = createRoute({
  method: "post",
  path: "/api/v1/secure/domains/refresh",
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "同期完了" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const refreshDomainsRouteHandler = app.openapi(route, async (ctx) => {
  const userId = ctx.get("userId");
  const db = createDBClient(ctx.env);
  const result = await DomainService.refreshMyDomains({ userId, db, env: ctx.env });
  if (!result.success) {
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 200);
});
