import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { toUserMessage } from "../../lib/error-messages";
import type { Variables } from "../../types";
import { DomainService } from "./service";

const RequestSchema = z.object({
  name: z.string().trim().min(1).openapi({ example: "example.com" }),
  registry: z.enum(["kitaqsign", "kitaqnic"]).openapi({ example: "kitaqsign" }),
  period: z.object({
    unit: z.enum(["Y", "M"]).openapi({ example: "Y" }),
    value: z.number().int().min(1).max(10).openapi({ example: 1 }),
  }),
  nameServers: z.array(z.string()).optional().openapi({ example: ["ns1.example.com"] }),
}).openapi("DomainCreateRequest");

const DomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  registry: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  ownerUserId: z.string(),
}).openapi("Domain");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: DomainSchema,
  error: z.null(),
}).openapi("DomainCreateSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("DomainCreateError");

const route = createRoute({
  method: "post",
  path: "/api/v1/secure/domains",
  request: { body: { content: { "application/json": { schema: RequestSchema } } } },
  responses: {
    201: { content: { "application/json": { schema: SuccessSchema } }, description: "登録成功" },
    409: { content: { "application/json": { schema: ErrorSchema } }, description: "ドメイン既存" },
    422: { content: { "application/json": { schema: ErrorSchema } }, description: "TLD違反" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = new OpenAPIHono<{ Bindings: CloudflareBindings; Variables: Variables }>();

export const createDomainRouteHandler = app.openapi(route, async (ctx) => {
  const payload = ctx.req.valid("json");
  const userId = ctx.get("userId");
  const result = await DomainService.create({ ...payload, userId, env: ctx.env });
  if (!result.success) {
    if (result.error === "domain_exists") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 409);
    }
    if (result.error === "invalid_tld") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 422);
    }
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 201);
});
