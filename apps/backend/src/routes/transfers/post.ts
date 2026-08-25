import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { toUserMessage } from "../../lib/error-messages";
import { detectRegistry } from "../../lib/registry-policy";
import type { Variables } from "../../types";
import { TransferService } from "./service";

// Issue #25: registry は省略可能。省略時は TLD から自動判定する。
// B15: name は FQDN 形式に絞る (ラベル + ドット + TLD)。IDN は今のところ扱わない。
const RequestSchema = z.object({
  name: z.string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(253)
    .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, "FQDN 形式で入力してください")
    .openapi({ example: "example.com" }),
  authInfo: z.string().min(1).max(64).openapi({ example: "s3cr3t-pass" }),
  registry: z.enum(["kitaqsign", "kitaqnic"]).optional().openapi({
    example: "kitaqsign",
    description: "省略時は TLD から自動判定",
  }),
}).openapi("TransferRequestBody");

// B13: gainingUserId をレスポンスから除外。誰が奪おうとしているかを他所に晒さない。
const TransferSchema = z.object({
  id: z.string(),
  domainId: z.string(),
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
  },
});

const app = new OpenAPIHono<{ Bindings: CloudflareBindings; Variables: Variables }>();

export const requestTransferRouteHandler = app.openapi(route, async (ctx) => {
  const { name, authInfo, registry: explicitRegistry } = ctx.req.valid("json");
  const gainingUserId = ctx.get("userId");
  const registry = explicitRegistry ?? detectRegistry(name);
  if (!registry) {
    return ctx.json({ success: false as const, data: null, error: "ドメイン名の形式が正しくありません。TLD（.com など）を含めて入力してください。" }, 400);
  }

  const result = await TransferService.request({ name, authInfo, registry, gainingUserId, env: ctx.env });
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
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }

  const transfer = result.data;
  return ctx.json({
    success: true as const,
    data: {
      id: transfer.id,
      domainId: transfer.domainId,
      registry: transfer.registry,
      status: transfer.status,
      createdAt: new Date(transfer.createdAt).toISOString(),
    },
    error: null,
  }, 202);
});
