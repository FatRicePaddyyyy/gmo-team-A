import { createRoute, z } from "@hono/zod-openapi";
import { createDBClient } from "../../../lib/db";
import { toUserMessage } from "../../../lib/error-messages";
import { createOpenAPIHono } from "../../../lib/openapi-hono";
import { DomainService } from "../service";

// losing (現オーナー) 目線: 自分のドメインに来た移管申請のうち、渡さずに終わったもの。
//
// pending-inbound-transfers は決着すると一覧から消えるため、これが無いと
// 「誰かが自分のドメインを取ろうとした」記録がどこにも残らない。
// 身に覚えのない申請が繰り返されていても気づけないので、履歴として残す。
//
// 承認済みは含まない (repository のコメント参照)。渡したあとは
// ドメインごと手元から消えるか、所有者が変わって別人の履歴になってしまうため。
//
// gainingUserId は含めない (pending 側と同じ方針: 情報漏洩防止)。
const InboundTransferHistorySchema = z.object({
  transferId: z.string(),
  domainId: z.string(),
  domainName: z.string(),
  registry: z.enum(["kitaqsign", "kitaqnic"]),
  requestedAt: z.string(),
  // clientRejected / clientCancelled / expired
  status: z.string(),
}).openapi("InboundTransferHistory");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: z.array(InboundTransferHistorySchema),
  error: z.null(),
}).openapi("InboundTransferHistorySuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("InboundTransferHistoryError");

const route = createRoute({
  method: "get",
  path: "/api/v1/secure/domains/inbound-transfer-history",
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "取得成功" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const listInboundTransferHistoryRouteHandler = app.openapi(route, async (ctx) => {
  const userId = ctx.get("userId");
  const db = createDBClient(ctx.env);
  const result = await DomainService.listInboundTransferHistory({ userId, db });
  if (!result.success) {
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 200);
});
