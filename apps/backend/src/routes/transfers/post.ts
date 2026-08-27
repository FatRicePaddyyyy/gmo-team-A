import { createRoute, z } from "@hono/zod-openapi";
import { RegistryBridge } from "../../lib/bridge";
import { createDBClient } from "../../lib/db";
import { toUserMessage } from "../../lib/error-messages";
import { createOpenAPIHono } from "../../lib/openapi-hono";
import { FQDN_REGEX } from "../../lib/registry-policy";
import { TransferService } from "./service";

// Issue #25: registry は省略可能。省略時は TLD から自動判定する。
// B15/NB-4: name は FQDN 形式に絞る (RFC 1035)。regex は lib/registry-policy に一元化。
const RequestSchema = z.object({
  name: z.string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(253)
    .regex(FQDN_REGEX, "FQDN 形式で入力してください")
    .openapi({ example: "example.com" }),
  authInfo: z.string().min(1).max(64).openapi({ example: "s3cr3t-pass" }),
  registry: z.enum(["kitaqsign", "kitaqnic"]).optional().openapi({
    example: "kitaqsign",
    description: "省略時は TLD から自動判定",
  }),
}).openapi("TransferRequestBody");

// B13: gainingUserId をレスポンスから除外。誰が奪おうとしているかを他所に晒さない。
// domainId は inbound (自 backend の既存 domain を移管) のときのみ入る。
// domainName は常に入る (outbound では自 backend に domain 行が無いので name 直接返す)。
const TransferSchema = z.object({
  id: z.string(),
  kind: z.enum(["inbound", "outbound"]),
  domainName: z.string(),
  domainId: z.string().nullable(),
  registry: z.string(),
  status: z.string(),
  createdAt: z.string(),
}).openapi("Transfer");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: TransferSchema,
  error: z.null(),
}).openapi("TransferRequestSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("TransferRequestError");

const route = createRoute({
  method: "post",
  path: "/api/v1/secure/transfers",
  request: { body: { content: { "application/json": { schema: RequestSchema } } } },
  responses: {
    202: { content: { "application/json": { schema: SuccessSchema } }, description: "移管申請受付" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "ドメイン名不正" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "自己移管" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "ドメイン不在" },
    409: { content: { "application/json": { schema: ErrorSchema } }, description: "authInfo不一致 / 既に処理中 / 状態不可" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
    503: { content: { "application/json": { schema: ErrorSchema } }, description: "Queue バインディング欠落" },
  },
});

const app = createOpenAPIHono();

export const requestTransferRouteHandler = app.openapi(route, async (ctx) => {
  const { name, authInfo, registry: explicitRegistry } = ctx.req.valid("json");
  const gainingUserId = ctx.get("userId");
  // 引数 registry があれば尊重、無ければ hello (supportedTlds) から解決する。
  // 引数 registry が指定されている場合は service 層で hello との整合チェックが走る (B17)。
  let registry = explicitRegistry;
  if (!registry) {
    const resolved = await RegistryBridge.resolveRegistry({ name, env: ctx.env });
    if (!resolved.success) {
      if (resolved.error === "unsupported_tld" || resolved.error === "invalid_domain_name") {
        return ctx.json({ success: false as const, data: null, error: toUserMessage(resolved.error) }, 400);
      }
      return ctx.json({ success: false as const, data: null, error: toUserMessage(resolved.error) }, 500);
    }
    registry = resolved.data;
  }

  const db = createDBClient(ctx.env);
  const result = await TransferService.request({ name, authInfo, registry, gainingUserId, db, env: ctx.env });
  if (!result.success) {
    if (result.error === "domain_not_found") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 404);
    }
    if (result.error === "authInfo_mismatch") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 409);
    }
    if (result.error === "self_transfer") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 403);
    }
    if (result.error === "transfer_already_pending") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 409);
    }
    if (result.error === "domain_not_transferable") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 409);
    }
    if (result.error === "invalid_domain_name" || result.error === "invalid_domain_registry") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 400);
    }
    if (result.error === "queue_unavailable") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 503);
    }
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }

  // TransferService.request は inbound (自 backend の domain) と outbound (別レジストラの domain)
  // 2 系統の結果を返す。それぞれ domainId/domainName の有無が違うので統一形に落とす。
  if (result.data.kind === "inbound") {
    const { transfer } = result.data;
    // inbound の domainName は Transfer 行に無いので、name 引数 (正規化済み) をそのまま使う。
    return ctx.json({
      success: true as const,
      data: {
        id: transfer.id,
        kind: "inbound" as const,
        domainName: name,
        domainId: transfer.domainId,
        registry: transfer.registry,
        status: transfer.status,
        createdAt: new Date(transfer.createdAt).toISOString(),
      },
      error: null,
    }, 202);
  } else {
    const { request } = result.data;
    return ctx.json({
      success: true as const,
      data: {
        id: request.id,
        kind: "outbound" as const,
        domainName: request.domainName,
        domainId: null,
        registry: request.registry,
        status: request.status,
        createdAt: new Date(request.createdAt).toISOString(),
      },
      error: null,
    }, 202);
  }
});
