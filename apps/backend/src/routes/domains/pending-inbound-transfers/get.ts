import { createRoute, z } from "@hono/zod-openapi";
import { createDBClient } from "../../../lib/db";
import { toUserMessage } from "../../../lib/error-messages";
import { createOpenAPIHono } from "../../../lib/openapi-hono";
import { DomainService } from "../service";

// losing (現オーナー) 目線: 自分のドメインに対して来ている pendingTransfer 一覧。
// frontend はこの結果を使って「あなたのドメイン xxx.com に移管申請があります → 承認 / 拒否」の UI を出す。
// gainingUserId は含めない (情報漏洩防止 = B13 と同じ方針)。
const InboundTransferSchema = z.object({
  transferId: z.string(),
  domainId: z.string(),
  domainName: z.string(),
  registry: z.enum(["kitaqsign", "kitaqnic"]),
  requestedAt: z.string(),
}).openapi("InboundPendingTransfer");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: z.array(InboundTransferSchema),
  error: z.null(),
}).openapi("InboundPendingTransfersSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("InboundPendingTransfersError");

const route = createRoute({
  method: "get",
  path: "/api/v1/secure/domains/pending-inbound-transfers",
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "取得成功" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const listInboundPendingTransfersRouteHandler = app.openapi(route, async (ctx) => {
  const userId = ctx.get("userId");
  const db = createDBClient(ctx.env);
  const result = await DomainService.listInboundPendingTransfers({ userId, db });
  if (!result.success) {
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 200);
});
