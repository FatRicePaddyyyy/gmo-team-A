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
// レート制限は現状かけていない。承認・却下の反映を待たされる体感を優先する。
// (以前 KV で 10 秒グローバルロックをかけていたが、承認直後の frontend 側からの
//  自動ポーリングで「まだ反映されていない」表示になる不具合が続いたため撤去した)
// 認証ユーザー限定 (/secure/ 配下) なので、外部からの DoS リスクは限定的。

const SuccessSchema = z.object({
  success: z.literal(true),
  data: z.object({
    // 常に true。以前はレート制限で skip する余地があったが、いまは毎回走らせる。
    // 呼び出し側の互換のためスキーマは残す。
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
    200: { content: { "application/json": { schema: SuccessSchema } }, description: "poll 実行" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "サーバーエラー" },
  },
});

const app = createOpenAPIHono();

export const pollNowTransferRouteHandler = app.openapi(route, async (ctx) => {
  try {
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
