import { createRoute, z } from "@hono/zod-openapi";
import { createDBClient } from "../../../lib/db";
import { toUserMessage } from "../../../lib/error-messages";
import { createOpenAPIHono } from "../../../lib/openapi-hono";
import { DomainService } from "../service";

const ParamsSchema = z.object({
  "domain-id": z.string().openapi({ example: "dom-123" }),
}).openapi("DomainGetParams");

const DomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  registry: z.string(),
  // DB上の主要ステータス（ok / redemptionPeriod / pendingDelete / pendingTransfer）
  // redemptionPeriod = 廃止したがまだ復旧できる、pendingDelete = 削除待ちで復旧できない
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  ownerUserId: z.string(),
  autoRenew: z.boolean(),
  // レジストリから取得した詳細
  statuses: z.array(z.string()),
  registrant: z.string(),
  contacts: z.record(z.string(), z.string()),
  nameservers: z.array(z.string()),
  rgpStatus: z.array(z.string()),
  upDate: z.string().nullable(),
  trDate: z.string().nullable(),
}).openapi("DomainDetail");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: DomainSchema,
  error: z.null(),
}).openapi("DomainGetSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("DomainGetError");

const route = createRoute({
  method: "get",
  path: "/api/v1/secure/domains/{domain-id}",
  request: { params: ParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "取得成功" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "不在" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const getDomainRouteHandler = app.openapi(route, async (ctx) => {
  const { "domain-id": domainId } = ctx.req.valid("param");
  const userId = ctx.get("userId");
  const db = createDBClient(ctx.env);
  const result = await DomainService.info({ domainId, userId, db, env: ctx.env });
  if (!result.success) {
    if (result.error === "not_found" || result.error === "domain_not_found") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 404);
    }
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 200);
});
