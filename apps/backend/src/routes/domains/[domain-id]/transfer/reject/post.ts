import { createRoute, z } from "@hono/zod-openapi";
import { toUserMessage } from "../../../../../lib/error-messages";
import { createOpenAPIHono } from "../../../../../lib/openapi-hono";
import { DomainService } from "../../../service";

const ParamsSchema = z.object({
  "domain-id": z.string().openapi({ example: "dom-123" }),
}).openapi("TransferRejectParams");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: z.null(),
  error: z.null(),
}).openapi("TransferRejectSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("TransferRejectError");

const route = createRoute({
  method: "post",
  path: "/api/v1/secure/domains/{domain-id}/transfer/reject",
  request: { params: ParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "移管拒否成功" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "権限なし" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "不在" },
    409: { content: { "application/json": { schema: ErrorSchema } }, description: "申請不在" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const rejectTransferRouteHandler = app.openapi(route, async (ctx) => {
  const { "domain-id": domainId } = ctx.req.valid("param");
  const userId = ctx.get("userId");

  const result = await DomainService.rejectTransfer({ domainId, userId, env: ctx.env });
  if (!result.success) {
    if (result.error === "domain_not_found") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 404);
    }
    if (result.error === "forbidden") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 403);
    }
    if (result.error === "transfer_not_found") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 409);
    }
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: null, error: null }, 200);
});
