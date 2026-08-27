import { createRoute, z } from "@hono/zod-openapi";
import { RegistryBridge } from "../../lib/bridge";
import { createDBClient } from "../../lib/db";
import { domainNameSchema } from "../../lib/domain-name-schema";
import { toUserMessage } from "../../lib/error-messages";
import { createOpenAPIHono } from "../../lib/openapi-hono";
import { DomainService } from "./service";

// Issue #25: registry は省略可能。省略時は TLD から自動判定する。
const RequestSchema = z.object({
  name: domainNameSchema().openapi({ example: "example.com" }),
  registry: z.enum(["kitaqsign", "kitaqnic"]).optional().openapi({
    example: "kitaqsign",
    description: "省略時は TLD から自動判定",
  }),
  period: z.object({
    unit: z.enum(["Y", "M"]).openapi({ example: "Y" }),
    value: z.number().int().min(1).max(10).openapi({ example: 1 }),
  }),
  // Issue #76: ネームサーバーもホスト名なので name と同じ形式で検証する。
  nameServers: z.array(domainNameSchema()).optional().openapi({ example: ["ns1.example.com"] }),
}).openapi("DomainCreateRequest");

const DomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  registry: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  ownerUserId: z.string(),
  autoRenew: z.boolean(),
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
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "ドメイン名不正" },
    409: { content: { "application/json": { schema: ErrorSchema } }, description: "ドメイン既存" },
    422: { content: { "application/json": { schema: ErrorSchema } }, description: "TLD違反" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const createDomainRouteHandler = app.openapi(route, async (ctx) => {
  const payload = ctx.req.valid("json");
  const userId = ctx.get("userId");
  // 引数 registry があれば尊重、無ければ hello (supportedTlds) から解決する。
  // 静的テーブルではなく実レジストリの hello を根拠にすることで、対応 TLD 変更を追随できる。
  let registry = payload.registry;
  if (!registry) {
    const resolved = await RegistryBridge.resolveRegistry({ name: payload.name, env: ctx.env });
    if (!resolved.success) {
      if (resolved.error === "unsupported_tld" || resolved.error === "invalid_domain_name") {
        return ctx.json({ success: false as const, data: null, error: toUserMessage(resolved.error) }, 400);
      }
      return ctx.json({ success: false as const, data: null, error: toUserMessage(resolved.error) }, 500);
    }
    registry = resolved.data;
  }
  const db = createDBClient(ctx.env);
  const result = await DomainService.create({ ...payload, registry, userId, db, env: ctx.env });
  if (!result.success) {
    if (result.error === "domain_exists") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 409);
    }
    if (result.error === "invalid_domain_name") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 400);
    }
    if (result.error === "invalid_tld" || result.error === "unsupported_tld") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 422);
    }
    if (result.error === "invalid_contact_payload") {
      // createContact が レジストリの postalInfo 制約 (許可名 / 予約ドメインメール / cc: JP US 等) で
      // 弾かれたケース。ユーザーの氏名やメールに起因するので 400 で意図を伝える。
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 400);
    }
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 201);
});
