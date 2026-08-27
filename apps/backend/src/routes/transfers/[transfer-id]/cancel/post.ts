import { createRoute, z } from "@hono/zod-openapi";
import { createDBClient } from "../../../../lib/db";
import { toUserMessage } from "../../../../lib/error-messages";
import { createOpenAPIHono } from "../../../../lib/openapi-hono";
import { TransferService } from "../../service";

const ParamsSchema = z.object({
  "transfer-id": z.string().openapi({ example: "tr-123" }),
}).openapi("TransferCancelParams");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: z.null(),
  error: z.null(),
}).openapi("TransferCancelSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("TransferCancelError");

const route = createRoute({
  method: "post",
  path: "/api/v1/secure/transfers/{transfer-id}/cancel",
  request: { params: ParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "移管取消成功" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "権限なし" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "不在" },
    409: { content: { "application/json": { schema: ErrorSchema } }, description: "取消不可" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const cancelTransferRouteHandler = app.openapi(route, async (ctx) => {
  const { "transfer-id": transferId } = ctx.req.valid("param");
  const userId = ctx.get("userId");
  const db = createDBClient(ctx.env);

  const result = await TransferService.cancel({ transferId, userId, db, env: ctx.env });
  if (!result.success) {
    if (result.error === "transfer_not_found" || result.error === "domain_not_found") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 404);
    }
    if (result.error === "forbidden") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 403);
    }
    if (result.error === "transfer_not_cancellable") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 409);
    }
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: null, error: null }, 200);
});
