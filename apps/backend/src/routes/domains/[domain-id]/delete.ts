import { createRoute, z } from "@hono/zod-openapi";
import { createDBClient } from "../../../lib/db";
import { toUserMessage } from "../../../lib/error-messages";
import { createOpenAPIHono } from "../../../lib/openapi-hono";
import { DomainService } from "../service";

const ParamsSchema = z.object({
  "domain-id": z.string().openapi({ example: "dom-123" }),
}).openapi("DomainDeleteParams");

const DomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  registry: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  ownerUserId: z.string(),
  autoRenew: z.boolean(),
}).openapi("DomainDeleted");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: DomainSchema,
  error: z.null(),
}).openapi("DomainDeleteSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("DomainDeleteError");

const route = createRoute({
  method: "delete",
  path: "/api/v1/secure/domains/{domain-id}",
  request: { params: ParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "廃止成功" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "権限なし (sponsoring registrar 以外の呼び出し)" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "不在" },
    409: { content: { "application/json": { schema: ErrorSchema } }, description: "操作不可" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const deleteDomainRouteHandler = app.openapi(route, async (ctx) => {
  const { "domain-id": domainId } = ctx.req.valid("param");
  const userId = ctx.get("userId");
  const db = createDBClient(ctx.env);
  const result = await DomainService.delete({ domainId, userId, db, env: ctx.env });
  if (!result.success) {
    if (result.error === "not_found" || result.error === "domain_not_found") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 404);
    }
    if (result.error === "operation_prohibited" || result.error === "domain_pending_transfer") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 409);
    }
    if (result.error === "forbidden") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 403);
    }
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 200);
});
