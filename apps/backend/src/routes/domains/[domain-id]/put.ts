import { createRoute, z } from "@hono/zod-openapi";
import { createDBClient } from "../../../lib/db";
import { domainNameSchema } from "../../../lib/domain-name-schema";
import { isMaintenanceError, toUserMessage } from "../../../lib/error-messages";
import { createOpenAPIHono } from "../../../lib/openapi-hono";
import { DomainService } from "../service";

const ParamsSchema = z.object({
  "domain-id": z.string().openapi({ example: "dom-123" }),
}).openapi("DomainUpdateParams");

// Issue #107: Swagger の DomainChangeSet.statuses は 5 種類の enum のみ許可。
// `ok` / `inactive` / `pending*` は自動導出、`server*` 系はレジストリのみ設定可なので、
// クライアント (会員 API) から指定できるのはこの 5 つだけに絞る。
// 過去は `z.array(z.string())` で任意文字列を受けていた (Issue #107 の (2))。
const ClientProhibitedStatus = z.enum([
  "clientHold",
  "clientTransferProhibited",
  "clientUpdateProhibited",
  "clientDeleteProhibited",
  "clientRenewProhibited",
]);

const RequestSchema = z.object({
  // Issue #76: ネームサーバーもホスト名なので、ドメイン名と同じ形式で検証する。
  // ここだけ素通りだと、日本語や打ち間違いがレジストリまで届いて
  // referenced_object_not_found など理由の分かりにくいエラーになる。
  // 台数の上限 (EPP 一般の 13) はフロントも見ているが、DevTools で強引に
  // 増やされたときの受け皿としてここでも弾く。
  nameServers: z.array(domainNameSchema()).max(13, "too_many_name_servers").optional(),
  addStatuses: z.array(ClientProhibitedStatus).optional(),
  remStatuses: z.array(ClientProhibitedStatus).optional(),
  chg: z.object({
    registrant: z.string().optional(),
    // B18: Swagger 上 authInfo は 1〜64 文字
    authInfo: z.string().min(1).max(64).optional(),
  }).optional(),
  // Issue #24: 自動更新設定
  autoRenew: z.boolean().optional().openapi({
    example: true,
    description: "自動更新の ON/OFF。true なら期限切れ前に自動 renew される（別途 Cron 実装）",
  }),
}).refine(
  (data) => {
    if (data.addStatuses && data.remStatuses) {
      const addSet = new Set(data.addStatuses);
      return !data.remStatuses.some((s) => addSet.has(s));
    }
    return true;
  },
  { message: "addStatuses と remStatuses に同じ値を指定することはできません" },
).openapi("DomainUpdateRequest");

const DomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  registry: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  ownerUserId: z.string(),
  autoRenew: z.boolean(),
  // GET と同じ形。update 直後は必ずレジストリに届いているので常に true。
  registryAvailable: z.boolean(),
  // 登録者の氏名（自社 DB 由来）。レジストリの registrant は内部 ID なので画面には出さない。
  ownerName: z.string(),
  registryUnavailableReason: z.string().nullable(),
  statuses: z.array(z.string()),
  registrant: z.string(),
  contacts: z.record(z.string(), z.string()),
  nameservers: z.array(z.string()),
  rgpStatus: z.array(z.string()),
  upDate: z.string().nullable(),
  trDate: z.string().nullable(),
}).openapi("DomainUpdated");

const SuccessSchema = z.object({
  success: z.literal(true),
  data: DomainSchema,
  error: z.null(),
}).openapi("DomainUpdateSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("DomainUpdateError");

const route = createRoute({
  method: "put",
  path: "/api/v1/secure/domains/{domain-id}",
  request: {
    params: ParamsSchema,
    body: { content: { "application/json": { schema: RequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "更新成功" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "参照先オブジェクト（ネームサーバー等）が不在" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "権限なし (sponsoring registrar 以外の呼び出し)" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "不在" },
    409: { content: { "application/json": { schema: ErrorSchema } }, description: "操作不可" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
    503: { content: { "application/json": { schema: ErrorSchema } }, description: "レジストリがメンテナンス中のため一時的に利用できない" },
  },
});

const app = createOpenAPIHono();

export const updateDomainRouteHandler = app.openapi(route, async (ctx) => {
  const { "domain-id": domainId } = ctx.req.valid("param");
  const payload = ctx.req.valid("json");
  const userId = ctx.get("userId");
  const db = createDBClient(ctx.env);
  const result = await DomainService.update({ domainId, ...payload, userId, db, env: ctx.env });
  if (!result.success) {
    if (result.error === "not_found" || result.error === "domain_not_found") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 404);
    }
    // not_sponsored (レジストリの 403 = 当社では預かっていないドメイン) は権限問題ではなく
    // DB とレジストリの食い違い。409 に倒して状態不一致であることを伝える。
    if (
      result.error === "domain_pending_transfer" ||
      result.error === "operation_prohibited" ||
      result.error === "not_sponsored"
    ) {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 409);
    }
    if (result.error === "referenced_object_not_found") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 400);
    }
    if (result.error === "forbidden") {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 403);
    }
    // メンテナンスは「内部で異常が起きた」のではなく「待てば戻る」状態なので、
    // 500 ではなく 503 を返す。監視側で定期メンテと障害を切り分けられるようにする。
    if (isMaintenanceError(result.error)) {
      return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 503);
    }
    return ctx.json({ success: false as const, data: null, error: toUserMessage(result.error) }, 500);
  }
  return ctx.json({ success: true as const, data: result.data, error: null }, 200);
});
