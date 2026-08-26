import { createRoute, z } from "@hono/zod-openapi";
import { toUserMessage } from "../../../lib/error-messages";
import { createOpenAPIHono } from "../../../lib/openapi-hono";
import { DomainService } from "../service";

// 空き確認は認証不要の /api/v1/public/* に配置。
// registry フィールドは廃止。バックエンドが両レジストリの hello を並列で叩いて自動解決する。

const RequestSchema = z.object({
  name: z.string().trim().min(1).openapi({ example: "example.com" }),
}).openapi("DomainCheckRequest");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: z.object({
    avail: z.boolean(),
    registry: z.enum(["kitaqsign", "kitaqnic"]),
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
  path: "/api/v1/public/domains/check",
  request: { body: { content: { "application/json": { schema: RequestSchema } } } },
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "空き確認成功" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "ドメイン名不正 / 非対応TLD" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const checkDomainRouteHandler = app.openapi(route, async (ctx) => {
  const { name } = ctx.req.valid("json");
  const result = await DomainService.check({ name, env: ctx.env });
  if (!result.success) {
    if (result.error === "invalid_domain_name" || result.error === "unsupported_tld") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 400);
    }
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 200);
});
