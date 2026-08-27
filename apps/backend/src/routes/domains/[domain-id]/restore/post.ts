import { createRoute, z } from "@hono/zod-openapi";
import { createDBClient } from "../../../../lib/db";
import { toUserMessage } from "../../../../lib/error-messages";
import { createOpenAPIHono } from "../../../../lib/openapi-hono";
import { DomainService } from "../../service";

const ParamsSchema = z.object({
  "domain-id": z.string().openapi({ example: "dom-123" }),
}).openapi("DomainRestoreParams");

const DomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  registry: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  ownerUserId: z.string(),
  autoRenew: z.boolean(),
}).openapi("DomainRestored");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: DomainSchema,
  error: z.null(),
}).openapi("DomainRestoreSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("DomainRestoreError");

const route = createRoute({
  method: "post",
  path: "/api/v1/secure/domains/{domain-id}/restore",
  request: { params: ParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "復旧成功" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "権限なし" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "不在" },
    409: { content: { "application/json": { schema: ErrorSchema } }, description: "Grace Period 終了" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const restoreDomainRouteHandler = app.openapi(route, async (ctx) => {
  const { "domain-id": domainId } = ctx.req.valid("param");
  const userId = ctx.get("userId");
  const db = createDBClient(ctx.env);
  const result = await DomainService.restore({ domainId, userId, db, env: ctx.env });
  if (!result.success) {
    if (result.error === "not_found" || result.error === "domain_not_found") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 404);
    }
    if (result.error === "forbidden") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 403);
    }
    if (result.error === "operation_prohibited") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 409);
    }
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 200);
});
