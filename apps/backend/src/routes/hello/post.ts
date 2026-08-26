import { createRoute, z } from "@hono/zod-openapi";
import { createOpenAPIHono } from "../../lib/openapi-hono";

const HelloRequestSchema = z
  .object({
    text: z.string().trim().min(1, "テキストが必要です").max(250, "テキストが長すぎます").openapi({
      example: "こんにちは",
      description: "ユーザーが入力したテキスト",
    }),
  })
  .openapi("EchoRequest");

const HelloResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      message: z.string().openapi({
        example: "あなたはこんにちはと言いましたよ",
        description: "エコーされたメッセージ",
      }),
    }),
    error: z.null(),
  })
  .openapi("EchoResponse");

// S-E 対策: バリデーション失敗は createOpenAPIHono の defaultHook が処理し、
// アプリ全体の統一形式 { success:false, data:null, error:"..." } で返される。
// ここでは 400 のスキーマも同じ shape に揃える。
const ErrorResponseSchema = z
  .object({
    success: z.literal(false),
    data: z.null(),
    error: z.string().openapi({
      example: "入力内容に誤りがあります。項目を確認してください。",
      description: "エラーメッセージ",
    }),
  })
  .openapi("EchoErrorResponse");

const echoRouteSchema = createRoute({
  method: "post",
  path: "/api/v1/secure/hello",
  request: {
    body: {
      content: {
        "application/json": {
          schema: HelloRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: HelloResponseSchema,
        },
      },
      description: "エコー成功",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "不正なリクエスト（バリデーションエラー）",
    },
  },
});

const app = createOpenAPIHono();

// S-E 対策: reachable でない try/catch を削除。
// ctx.req.valid("json") はバリデーション失敗時に throw せず defaultHook を経由するため、
// try/catch は無意味だった。
export const helloRouteHandler = app.openapi(echoRouteSchema, (ctx) => {
  const { text } = ctx.req.valid("json");
  const userId = ctx.get("userId");
  return ctx.json(
    {
      success: true as const,
      data: {
        message: `あなたは${text}と言いましたよ。\n ユーザーID: ${userId}`,
      },
      error: null,
    },
    200,
  );
});
