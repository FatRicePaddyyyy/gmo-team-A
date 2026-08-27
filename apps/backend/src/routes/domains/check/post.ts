import { createRoute, z } from "@hono/zod-openapi";
import { toUserMessage } from "../../../lib/error-messages";
import { createOpenAPIHono } from "../../../lib/openapi-hono";
import { DomainService } from "../service";

// 空き確認は認証不要の /api/v1/public/* に配置。
// registry フィールドは廃止。バックエンドが両レジストリの hello を並列で叩いて自動解決する。
// 複数ドメインをまとめて渡せる（Issue #45 B-3）。項目ごとに成否があるため、
// レスポンスは常に 200 + 項目ごとの avail/failed で返す。

const RequestSchema = z.object({
  names: z.array(z.string().trim().min(1)).min(1).openapi({ example: ["example.com", "example.net"] }),
}).openapi("DomainCheckRequest");

const DomainCheckItemSchema = z.object({
  name: z.string(),
  avail: z.boolean(),
  /** 通信障害・レジストリ障害などで確認自体ができなかった */
  failed: z.boolean(),
  // 確認できなかった理由。メンテナンス中かどうかで利用者の行動が変わるため返す。
  reason: z.string().optional(),
}).openapi("DomainCheckItem");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: z.object({ results: z.array(DomainCheckItemSchema) }),
  error: z.null(),
}).openapi("DomainCheckSuccess");

const route = createRoute({
  method: "post",
  path: "/api/v1/public/domains/check",
  request: { body: { content: { "application/json": { schema: RequestSchema } } } },
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "空き確認結果（項目ごとにavail/failedを持つ）" },
  },
});

const app = createOpenAPIHono();

export const checkDomainRouteHandler = app.openapi(route, async (ctx) => {
  const { names } = ctx.req.valid("json");
  const results = await DomainService.checkBulk({ names, env: ctx.env });
  // 内部エラーコードをそのまま外に出さない（error-messages と同じ扱い）
  const withMessages = results.map((item) =>
    item.reason ? { ...item, reason: toUserMessage(item.reason) } : item,
  );
  return ctx.json({ success: true as const, data: { results: withMessages }, error: null }, 200);
});
