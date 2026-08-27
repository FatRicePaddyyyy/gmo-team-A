import { createRoute, z } from "@hono/zod-openapi";
import { createDBClient } from "../../../../lib/db";
import { toUserMessage } from "../../../../lib/error-messages";
import { createOpenAPIHono } from "../../../../lib/openapi-hono";
import { DomainService } from "../../service";

const ParamsSchema = z.object({
  "domain-id": z.string().openapi({ example: "dom-123" }),
}).openapi("DomainRenewParams");

const RequestSchema = z.object({
  period: z.object({
    unit: z.enum(["Y", "M"]).openapi({ example: "Y" }),
    value: z.number().int().min(1).max(10).openapi({ example: 1 }),
  }),
}).openapi("DomainRenewRequest");

const DomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  registry: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  ownerUserId: z.string(),
  autoRenew: z.boolean(),
}).openapi("DomainRenewed");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: DomainSchema,
  error: z.null(),
}).openapi("DomainRenewSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("DomainRenewError");

const route = createRoute({
  method: "post",
  path: "/api/v1/secure/domains/{domain-id}/renew",
  request: {
    params: ParamsSchema,
    body: { content: { "application/json": { schema: RequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "更新成功" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "不在" },
    409: { content: { "application/json": { schema: ErrorSchema } }, description: "操作不可" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const renewDomainRouteHandler = app.openapi(route, async (ctx) => {
  const { "domain-id": domainId } = ctx.req.valid("param");
  const { period } = ctx.req.valid("json");
  const userId = ctx.get("userId");
  const db = createDBClient(ctx.env);
  const result = await DomainService.renew({ domainId, period, userId, db, env: ctx.env });
  if (!result.success) {
    if (result.error === "not_found" || result.error === "domain_not_found") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 404);
    }
    if (result.error === "domain_pending_transfer" || result.error === "invalid_period") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 409);
    }
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 200);
});
