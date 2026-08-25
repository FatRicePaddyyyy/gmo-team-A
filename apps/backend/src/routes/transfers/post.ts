import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { toUserMessage } from "../../lib/error-messages";
import { detectRegistry } from "../../lib/registry-policy";
import type { Variables } from "../../types";
import { TransferService } from "./service";

// Issue #25: registry は省略可能。省略時は TLD から自動判定する。
const RequestSchema = z.object({
  name: z.string().trim().min(1).openapi({ example: "example.com" }),
  authInfo: z.string().min(1).max(64).openapi({ example: "s3cr3t-pass" }),
  registry: z.enum(["kitaqsign", "kitaqnic"]).optional().openapi({
    example: "kitaqsign",
    description: "省略時は TLD から自動判定",
  }),
}).openapi("TransferRequestBody");

const TransferSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  registry: z.string(),
  status: z.string(),
  gainingUserId: z.string(),
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
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "ドメイン不在" },
    409: { content: { "application/json": { schema: ErrorSchema } }, description: "authInfo不一致" },
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
      gainingUserId: transfer.gainingUserId,
      createdAt: new Date(transfer.createdAt).toISOString(),
    },
    error: null,
  }, 202);
});
