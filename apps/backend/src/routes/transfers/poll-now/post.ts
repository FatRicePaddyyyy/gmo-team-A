import { createRoute, z } from "@hono/zod-openapi";
import { toUserMessage } from "../../../lib/error-messages";
import { createOpenAPIHono } from "../../../lib/openapi-hono";
import { handleTransferCronPoll } from "../../../scheduled/transfer-cron-poll";

// 移管の poll を「今すぐ」1 回走らせるユーザートリガー。
//
// 通常は 1 分ごとの cron (wrangler.jsonc の triggers.crons) が両レジストリを
// drain するが、UI 側で「最新にする」を押した時や、移管画面を開いている間の
// 短周期ポーリングで、cron を 1 分待たずに反映させたいことがある。
// エンドポイント自体は cron と同じ handleTransferCronPoll を叩くだけ。
//
// レート/コスト保護:
//   認証ユーザー限定 (/secure/ 配下)。
//   さらに KV (REGISTRY_HELLO_CACHE を流用) で "10 秒に 1 回"のグローバルロック
//   を掛け、多数ユーザーが同時に叩いても実際に走るのは 10 秒あたり 1 回だけ。
//   ロック中の呼び出しは 200 + skipped=true で返す (UX を止めない)。
//   これでレジストリ側 hello / poll の負荷は cron の 6 倍が上限になる。

const SuccessSchema = z.object({
  success: z.literal(true),
  data: z.object({
    // 実際に poll を走らせたか (false ならロックで skip された)
    ran: z.boolean(),
  }),
  error: z.null(),
}).openapi("PollNowSuccess");

const ErrorSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.string(),
}).openapi("PollNowError");

const route = createRoute({
  method: "post",
  path: "/api/v1/secure/transfers/poll-now",
  responses: {
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "poll 実行 or スロットル済" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

// KV のキー名。cron の poll は同じ実装なので、cron が走ったばかりの直後は
// ユーザー起点でも走らせない (負荷が二重になる)。逆に cron 側からは書かない
// ので、cron の直後に「今すぐ」を押すと 10 秒だけロックが効く形になる。
const POLL_LOCK_KEY = "transfer-poll:lock";
const POLL_LOCK_TTL_SECONDS = 10;

const app = createOpenAPIHono();

export const pollNowTransferRouteHandler = app.openapi(route, async (ctx) => {
  try {
    // KV に「今 poll 中」の印があれば skip。put(nx) 相当が KV に無いので
    // get → put の TOCTOU は許容 (最悪同時 2 回走る程度で、cron と同じ実装なので実害なし)。
    const held = await ctx.env.REGISTRY_HELLO_CACHE.get(POLL_LOCK_KEY);
    if (held) {
      return ctx.json({ success: true as const, data: { ran: false }, error: null }, 200);
    }
    await ctx.env.REGISTRY_HELLO_CACHE.put(POLL_LOCK_KEY, "1", {
      expirationTtl: POLL_LOCK_TTL_SECONDS,
    });

    await handleTransferCronPoll(ctx.env, new Date());
    return ctx.json({ success: true as const, data: { ran: true }, error: null }, 200);
  } catch (e) {
    console.error("pollNowTransferRouteHandler unexpected exception", e);
    return ctx.json(
      { success: false as const, data: null, error: toUserMessage("internal_error") },
      500,
    );
  }
});
