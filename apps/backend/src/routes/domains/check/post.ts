import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { toUserMessage } from "../../../lib/error-messages";
import { detectRegistry } from "../../../lib/registry-policy";
import type { Variables } from "../../../types";
import { DomainService } from "../service";

// Issue #26: 空き確認は認証不要の /api/v1/public/* に配置。
// Issue #25: registry は省略可能。省略時は TLD から自動判定する。

const RequestSchema = z.object({
  name: z.string().trim().min(1).openapi({ example: "example.com" }),
  registry: z.enum(["kitaqsign", "kitaqnic"]).optional().openapi({
    example: "kitaqsign",
    description: "省略時は TLD から自動判定（.com/.net/.org/.info は kitaqsign、それ以外は kitaqnic）",
  }),
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
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "ドメイン名不正" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = new OpenAPIHono<{ Bindings: CloudflareBindings; Variables: Variables }>();

export const checkDomainRouteHandler = app.openapi(route, async (ctx) => {
  const { name, registry: explicitRegistry } = ctx.req.valid("json");
  const registry = explicitRegistry ?? detectRegistry(name);
  if (!registry) {
    return ctx.json({ success: false as const, data: null, error: "ドメイン名の形式が正しくありません。TLD（.com など）を含めて入力してください。" }, 400);
  }
  const result = await DomainService.check({ name, registry, env: ctx.env });
  if (!result.success) {
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: { avail: result.data.avail, registry }, error: null }, 200);
});
