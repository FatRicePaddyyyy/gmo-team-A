import type { Context, Next } from "hono";

// timing-safe な bytewise 比較。secret 一致判定でタイミング攻撃を防ぐ。
// クライアント/サーバの長さが違ってもかならず全長走査する。
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  // 長さが違う場合も比較コストは同じにしたいので、長い方に合わせて走査する。
  const len = Math.max(ea.length, eb.length);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  }
  return diff === 0;
}

// アプリ全体で統一している ErrorSchema shape を返す。
function errorBody(message: string) {
  return { success: false as const, data: null, error: message };
}

// S-F 対策:
//  - レスポンス shape を { success, data, error } に統一 (他 middleware / route と一致)
//  - Bearer token の比較を timing-safe に変更
export const apiKeyAuthMiddleware = async (
  ctx: Context<{ Bindings: CloudflareBindings }>,
  next: Next,
) => {
  try {
    const authorizationHeader = ctx.req.header("Authorization");

    if (!authorizationHeader) {
      return ctx.json(errorBody("認証ヘッダーが必要です。"), 401);
    }
    const bearerTokenPrefix = "Bearer ";
    if (!authorizationHeader.startsWith(bearerTokenPrefix)) {
      return ctx.json(errorBody("認証形式が無効です。形式: Bearer <token>"), 401);
    }

    const clientToken = authorizationHeader.substring(bearerTokenPrefix.length);

    if (!clientToken) {
      return ctx.json(errorBody("トークンが必要です。"), 401);
    }

    const serverApiKey = ctx.env.SECRET_KEY;

    if (!serverApiKey) {
      console.error("SECRET_KEY環境変数が設定されていません");
      return ctx.json(errorBody("サーバー設定エラー"), 500);
    }

    if (!timingSafeEqual(clientToken, serverApiKey)) {
      return ctx.json(errorBody("無効なトークンです。"), 401);
    }

    await next();
  } catch (error) {
    console.error("APIキー認証ミドルウェアエラー:", error);
    return ctx.json(errorBody("認証に失敗しました。"), 500);
  }
};
