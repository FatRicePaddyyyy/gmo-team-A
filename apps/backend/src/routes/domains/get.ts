import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { toUserMessage } from "../../lib/error-messages";
import type { Variables } from "../../types";
import { DomainService } from "./service";

const DomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  registry: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  ownerUserId: z.string(),
}).openapi("DomainListItem");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: z.array(DomainSchema),
  error: z.null(),
}).openapi("DomainListSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("DomainListError");

const route = createRoute({
  method: "get",
  path: "/api/v1/secure/domains",
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "一覧取得成功" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = new OpenAPIHono<{ Bindings: CloudflareBindings; Variables: Variables }>();

export const listDomainsRouteHandler = app.openapi(route, async (ctx) => {
  const userId = ctx.get("userId");
  const result = await DomainService.list({ userId, env: ctx.env });
  if (!result.success) {
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 200);
});
