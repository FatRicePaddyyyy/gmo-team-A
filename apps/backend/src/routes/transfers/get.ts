import { createRoute, z } from "@hono/zod-openapi";
import { createDBClient } from "../../lib/db";
import { toUserMessage } from "../../lib/error-messages";
import { createOpenAPIHono } from "../../lib/openapi-hono";
import { TransferService } from "./service";

// B16: gaining ユーザー自身の transfer 一覧。cancel 対象を見つけるための最小 API。
//
// inbound (自 backend の domain 行に紐づく) と outbound (別レジストラの domain を
// 取りに行く申請) を統一 shape で返す。inbound は domainId 有り、outbound は null。
const TransferSchema = z.object({
  id: z.string(),
  kind: z.enum(["inbound", "outbound"]),
  domainId: z.string().nullable(),
  // ID だけでは何の申請か分からないので名前も返す
  domainName: z.string(),
  registry: z.string(),
  status: z.string(),
  createdAt: z.string(),
}).openapi("TransferListItem");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: z.array(TransferSchema),
  error: z.null(),
}).openapi("TransferListSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("TransferListError");

const route = createRoute({
  method: "get",
  path: "/api/v1/secure/transfers",
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "取得成功" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const listTransfersRouteHandler = app.openapi(route, async (ctx) => {
  const userId = ctx.get("userId");
  const db = createDBClient(ctx.env);
  const result = await TransferService.listMine({ userId, db });
  if (!result.success) {
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({
    success: true as const,
    data: result.data.map(t => ({
      id: t.id,
      kind: t.kind,
      domainId: t.domainId,
      domainName: t.domainName,
      registry: t.registry,
      status: t.status,
      createdAt: new Date(t.createdAt).toISOString(),
    })),
    error: null,
  }, 200);
});
