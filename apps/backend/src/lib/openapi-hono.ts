import { OpenAPIHono } from "@hono/zod-openapi";
import type { Variables } from "../types";
import { toUserMessage } from "./error-messages";

// アプリ標準の OpenAPIHono ファクトリ。
// Zod バリデーション失敗時に統一的な日本語 ErrorSchema 形式を返す defaultHook を設定する。
//
// - 従来: @hono/zod-openapi のデフォルトで英語の Zod issues 詳細が返る (ユーザーに技術的で不親切)
// - これ以降: { success: false, data: null, error: "入力内容に誤りがあります。..." } と統一
//
// 全ルートで `new OpenAPIHono(...)` の代わりに `createOpenAPIHono()` を使うこと。
export function createOpenAPIHono(): OpenAPIHono<{
  Bindings: CloudflareBindings;
  Variables: Variables;
}> {
  return new OpenAPIHono<{
    Bindings: CloudflareBindings;
    Variables: Variables;
  }>({
    defaultHook: (result, ctx) => {
      if (!result.success) {
        // Zod issue 配列は console.error でログに残しつつ、ユーザーには汎用日本語で返す。
        console.warn("Zod validation error:", JSON.stringify(result.error.issues));
        return ctx.json(
          {
            success: false as const,
            data: null,
            error: toUserMessage("validation_error"),
          },
          400,
        );
      }
    },
  });
}
