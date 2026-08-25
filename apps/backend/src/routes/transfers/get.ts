import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { toUserMessage } from "../../lib/error-messages";
import type { Variables } from "../../types";
import { TransferService } from "./service";

// B16: gaining ユーザー自身の transfer 一覧。cancel 対象を見つけるための最小 API。
const TransferSchema = z.object({
  id: z.string(),
  domainId: z.string(),
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

const app = new OpenAPIHono<{ Bindings: CloudflareBindings; Variables: Variables }>();

export const listTransfersRouteHandler = app.openapi(route, async (ctx) => {
  const userId = ctx.get("userId");
  const result = await TransferService.listMine({ userId, env: ctx.env });
  if (!result.success) {
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({
    success: true as const,
    data: result.data.map(t => ({
      id: t.id,
      domainId: t.domainId,
      registry: t.registry,
      status: t.status,
      createdAt: new Date(t.createdAt).toISOString(),
    })),
    error: null,
  }, 200);
});
