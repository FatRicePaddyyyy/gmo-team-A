import { z } from "@hono/zod-openapi";
import { FQDN_MAX_LENGTH, FQDN_REGEX } from "./registry-policy";

// ドメイン名を受け取る全エンドポイント共通の Zod 断片 (Issue #76)。
//
// 画面ごとに強度がばらつくと、同じ日本語入力でも「TLD が違う」「通信失敗」と
// 見え方が変わってしまうため、入力の受け口はここ 1 箇所に揃える。
//
// message に日本語ではなくエラーコードを書いているのは意図的。
// createOpenAPIHono の defaultHook がコードを拾って error-messages.ts の
// 定型文言に変換する (そうしないと汎用の「入力内容に誤りがあります」しか返らない)。
export function domainNameSchema() {
  return z.string()
    .trim()
    .toLowerCase()
    .min(1, "invalid_domain_name")
    .max(FQDN_MAX_LENGTH, "invalid_domain_name")
    .regex(FQDN_REGEX, "invalid_domain_name");
}
