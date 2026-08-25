import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { toUserMessage } from "../../../lib/error-messages";
import type { Variables } from "../../../types";
import { DomainService } from "../service";

const RequestSchema = z.object({
  name: z.string().trim().min(1).openapi({ example: "example.com" }),
  registry: z.enum(["kitaqsign", "kitaqnic"]).openapi({ example: "kitaqsign" }),
}).openapi("DomainCheckRequest");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: z.object({
    avail: z.boolean(),
  }),
  error: z.null(),
}).openapi("DomainCheckSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("DomainCheckError");

const route = createRoute({
  method: "post",
  path: "/api/v1/secure/domains/check",
  request: { body: { content: { "application/json": { schema: RequestSchema } } } },
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "空き確認成功" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = new OpenAPIHono<{ Bindings: CloudflareBindings; Variables: Variables }>();

export const checkDomainRouteHandler = app.openapi(route, async (ctx) => {
  const { name, registry } = ctx.req.valid("json");
  const result = await DomainService.check({ name, registry, env: ctx.env });
  if (!result.success) {
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 200);
});
