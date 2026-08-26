import { createRoute, z } from "@hono/zod-openapi";
import { toUserMessage } from "../../../lib/error-messages";
import { createOpenAPIHono } from "../../../lib/openapi-hono";
import { DomainService } from "../service";

const ParamsSchema = z.object({
  "domain-id": z.string().openapi({ example: "dom-123" }),
}).openapi("DomainUpdateParams");

const RequestSchema = z.object({
  nameServers: z.array(z.string()).optional(),
  addStatuses: z.array(z.string()).optional(),
  remStatuses: z.array(z.string()).optional(),
  chg: z.object({
    registrant: z.string().optional(),
    // B18: Swagger 上 authInfo は 1〜64 文字
    authInfo: z.string().min(1).max(64).optional(),
  }).optional(),
  // Issue #24: 自動更新設定
  autoRenew: z.boolean().optional().openapi({
    example: true,
    description: "自動更新の ON/OFF。true なら期限切れ前に自動 renew される（別途 Cron 実装）",
  }),
}).refine(
  (data) => {
    if (data.addStatuses && data.remStatuses) {
      const addSet = new Set(data.addStatuses);
      return !data.remStatuses.some((s) => addSet.has(s));
    }
    return true;
  },
  { message: "addStatuses と remStatuses に同じ値を指定することはできません" },
).openapi("DomainUpdateRequest");

const DomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  registry: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  ownerUserId: z.string(),
  autoRenew: z.boolean(),
  statuses: z.array(z.string()),
  registrant: z.string(),
  contacts: z.record(z.string(), z.string()),
  nameservers: z.array(z.string()),
  rgpStatus: z.array(z.string()),
  upDate: z.string().nullable(),
  trDate: z.string().nullable(),
}).openapi("DomainUpdated");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: DomainSchema,
  error: z.null(),
}).openapi("DomainUpdateSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("DomainUpdateError");

const route = createRoute({
  method: "put",
  path: "/api/v1/secure/domains/{domain-id}",
  request: {
    params: ParamsSchema,
    body: { content: { "application/json": { schema: RequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "更新成功" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "参照先オブジェクト（ネームサーバー等）が不在" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "不在" },
    409: { content: { "application/json": { schema: ErrorSchema } }, description: "操作不可" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const updateDomainRouteHandler = app.openapi(route, async (ctx) => {
  const { "domain-id": domainId } = ctx.req.valid("param");
  const payload = ctx.req.valid("json");
  const userId = ctx.get("userId");
  const result = await DomainService.update({ domainId, ...payload, userId, env: ctx.env });
  if (!result.success) {
    if (result.error === "not_found" || result.error === "domain_not_found") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 404);
    }
    if (result.error === "domain_pending_transfer" || result.error === "operation_prohibited") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 409);
    }
    if (result.error === "referenced_object_not_found") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 400);
    }
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 200);
});
