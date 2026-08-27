import { OpenAPIHono } from "@hono/zod-openapi";
import type { Variables } from "../types";
import { hasUserMessage, toUserMessage } from "./error-messages";

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
        // Zod issue 配列は console.warn でログに残しつつ、ユーザーには日本語で返す。
        console.warn("Zod validation error:", JSON.stringify(result.error.issues));
        // スキーマ側が message にエラーコード (例: "invalid_domain_name") を書いている場合は
        // そのコードの定型文言を返す。汎用の「入力内容に誤りがあります」だけだと
        // 「どの入力がなぜ駄目なのか」が伝わらないため (Issue #76)。
        const coded = result.error.issues.find(issue => hasUserMessage(issue.message));
        return ctx.json(
          {
            success: false as const,
            data: null,
            error: toUserMessage(coded?.message ?? "validation_error"),
          },
          400,
        );
      }
    },
  });
}
