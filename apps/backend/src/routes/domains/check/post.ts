import { createRoute, z } from "@hono/zod-openapi";
import { domainNameSchema } from "../../../lib/domain-name-schema";
import { createOpenAPIHono } from "../../../lib/openapi-hono";
import { DomainService } from "../service";

// 空き確認は認証不要の /api/v1/public/* に配置。
// registry フィールドは廃止。バックエンドが両レジストリの hello を並列で叩いて自動解決する。
// 複数ドメインをまとめて渡せる（Issue #45 B-3）。項目ごとに成否があるため、
// レスポンスは常に 200 + 項目ごとの avail/failed で返す。

// Issue #76: 名前の検証は domainNameSchema に一元化する。
// 検索窓は 1 つの名前 + 候補 TLD 群を names に展開して送ってくるので、
// 1 件でも形式が不正なら全件が不正 (名前部分が共通のため)。まとめて 400 で返してよい。
const RequestSchema = z.object({
  names: z.array(domainNameSchema()).min(1).openapi({ example: ["example.com", "example.net"] }),
}).openapi("DomainCheckRequest");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("DomainCheckError");

const DomainCheckItemSchema = z.object({
  name: z.string(),
  avail: z.boolean(),
  /** 通信障害・レジストリ障害などで確認自体ができなかった */
  failed: z.boolean(),
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
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "ドメイン名の形式が不正" },
  },
});

const app = createOpenAPIHono();

export const checkDomainRouteHandler = app.openapi(route, async (ctx) => {
  const { names } = ctx.req.valid("json");
  const results = await DomainService.checkBulk({ names, env: ctx.env });
  return ctx.json({ success: true as const, data: { results }, error: null }, 200);
});
